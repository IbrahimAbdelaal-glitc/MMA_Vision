"""Design 16.2, "Real check": drive a running API with a real MP4, like the browser does.

    python -m live.realcheck --video jobs/<id>/input/input.mp4 [--rate 1.0 --rate 0.1] [--analyse]

For each playback rate it uploads the video to POST /live-sessions, follows
the WebSocket, sends `clock` messages as a browser playing at that rate
would, and reports the analysed rate, event counts and GPU memory (before,
peak during, after the engine exits). With --analyse, the last session is
handed off to the offline pipeline; GPU memory is read again the moment the
hand-off returns, the job is followed to completion, and the live events are
compared with the offline run's classified candidates and identity check.

Nothing here is used by the API; it is a measurement tool.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
MATCH_TOLERANCE = 2 / 60


def gpu_memory_mib():
    smi = shutil.which("nvidia-smi")
    if not smi:
        return None
    try:
        out = subprocess.run([smi, "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        return int(out[0]) if out else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def gpu_processes():
    smi = shutil.which("nvidia-smi")
    if not smi:
        return None
    out = subprocess.run([smi, "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader"],
                         capture_output=True, text=True, timeout=10).stdout.strip()
    return [line for line in out.splitlines() if line.strip()]


class Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak = None
        self.stop = threading.Event()

    def run(self):
        while not self.stop.wait(0.5):
            value = gpu_memory_mib()
            if value is not None:
                self.peak = value if self.peak is None else max(self.peak, value)


def run_session(api: str, video: Path, rate: float, ws_base: str) -> dict:
    baseline = gpu_memory_mib()
    started = time.monotonic()
    with video.open("rb") as handle:
        response = httpx.post(f"{api}/live-sessions", files={"file": (video.name, handle, "video/mp4")}, timeout=300)
    if response.status_code != 201:
        return {"rate": rate, "error": f"POST /live-sessions answered {response.status_code}: {response.text}"}
    body = response.json()
    session_id, facts = body["session_id"], body["video"]
    upload_seconds = time.monotonic() - started

    messages = []
    sampler = Sampler()
    sampler.start()
    with connect(f"{ws_base}/live-sessions/{session_id}/stream", max_size=None) as ws:
        ready_at = None
        while ready_at is None:
            message = json.loads(ws.recv(timeout=180))
            messages.append(message)
            if message["type"] == "ready":
                ready_at = time.monotonic()
        duration = facts["duration_seconds"]
        play_start = time.monotonic()
        done = threading.Event()

        def receive():
            try:
                while True:
                    m = json.loads(ws.recv(timeout=300))
                    messages.append(m)
                    if m["type"] == "ended":
                        done.set()
                        return
            except Exception:  # noqa: BLE001 - the socket closes after ended
                done.set()

        reader = threading.Thread(target=receive, daemon=True)
        reader.start()
        while not done.is_set():
            t = (time.monotonic() - play_start) * rate
            if t >= duration:
                ws.send(json.dumps({"type": "clock", "t": duration, "playing": True}))   # the `ended` event
                break
            ws.send(json.dumps({"type": "clock", "t": t, "playing": True}))
            time.sleep(0.1)
        done.wait(120)
        played_seconds = time.monotonic() - play_start
    sampler.stop.set()

    status = httpx.get(f"{api}/live-sessions/{session_id}", timeout=30).json()
    after = None
    for _ in range(40):                       # the engine exited; memory should return to baseline
        after = gpu_memory_mib()
        if after is None or baseline is None or after <= baseline + 50:
            break
        time.sleep(0.25)

    events = [m for m in messages if m["type"] == "event"]
    stats = [m for m in messages if m["type"] == "stats"]
    final_stats = stats[-1] if stats else {}
    ended = [m for m in messages if m["type"] == "ended"]
    scored = [e for e in events if e["score_status"] == "scored"]
    return {
        "rate": rate,
        "session_id": session_id,
        "video": facts,
        "upload_and_verify_seconds": round(upload_seconds, 2),
        "model_ready_seconds": round(ready_at - started - upload_seconds, 2),
        "device": next((m.get("device") for m in messages if m["type"] == "ready"), None),
        "played_seconds": round(played_seconds, 2),
        "end_reason": ended[-1]["reason"] if ended else None,
        "session_state": status.get("state"),
        "frames_analysed": final_stats.get("frames_analysed"),
        "frames_skipped": final_stats.get("frames_skipped"),
        "analysed_rate_last": final_stats.get("analysed_rate"),
        "analysed_per_second_of_video": round(final_stats.get("frames_analysed", 0) / duration, 2),
        "detection_active_at_end": final_stats.get("detection_active"),
        "detection_inactive_reason": final_stats.get("detection_inactive_reason"),
        "active_detection_seconds": final_stats.get("events_per_minute_basis_seconds"),
        "events_emitted": len(events),
        "events_scored": len(scored),
        "events_unscored": len(events) - len(scored),
        "events_counted_65_or_more": sum(1 for e in scored if e["kinematic_score"] >= 65),
        "events_per_minute": final_stats.get("strike_like_events_per_minute"),
        "duplicates_discarded": final_stats.get("duplicates_discarded"),
        "held_discarded_by_resets": final_stats.get("held_candidates_discarded_by_resets"),
        "gpu_mib": {"baseline": baseline, "peak_during": sampler.peak, "after_exit": after},
        "events": events,
        "identity_messages": sum(1 for m in messages if m["type"] == "identity"),
    }


def offline_candidates(job_dir: Path) -> list:
    path = job_dir / "results" / "classified_strike_candidates.csv"
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def compare_events(live_events: list, offline: list) -> dict:
    pairs, unmatched_live = [], []
    used = set()
    for e in live_events:
        best = None
        for i, row in enumerate(offline):
            if i in used or row["fighter"] != e["corner"] or row["limb"] != e["side"] or row["event_type"] != e["strike_type"]:
                continue
            gap = abs(float(row["peak_time"]) - e["peak_t"])
            if gap <= MATCH_TOLERANCE + 1e-9 and (best is None or gap < best[1]):
                best = (i, gap)
        if best is None:
            unmatched_live.append(e)
            continue
        used.add(best[0])
        row = offline[best[0]]
        pairs.append({
            "stream": f"{e['corner']} {e['side']} {e['strike_type']}",
            "live_peak_t": e["peak_t"], "offline_peak_time": round(float(row["peak_time"]), 4),
            "live_score": e["kinematic_score"], "live_status": e["score_status"],
            "offline_score": float(row["kinematic_score"]), "offline_class": row["detection_class"],
            "live_class": e["detection_class"],
        })
    return {
        "offline_candidates": len(offline),
        "live_events": len(live_events),
        "matched": len(pairs),
        "live_only": len(unmatched_live),
        "offline_only": len(offline) - len(used),
        "pairs": pairs,
    }


def hand_off(api: str, session_id: str, live_events: list) -> dict:
    response = httpx.post(f"{api}/live-sessions/{session_id}/analyse", timeout=120)
    gpu_at_hand_off = gpu_memory_mib()
    processes_at_hand_off = gpu_processes()
    if response.status_code != 202:
        return {"error": f"analyse answered {response.status_code}: {response.text}"}
    job_id = response.json()["job_id"]
    started = time.monotonic()
    status = {}
    while time.monotonic() - started < 3600:
        status = httpx.get(f"{api}/jobs/{job_id}", timeout=30).json()
        if status["status"] in ("completed", "failed"):
            break
        time.sleep(5)
    result = {
        "job_id": job_id,
        "gpu_mib_when_analyse_returned": gpu_at_hand_off,
        "gpu_processes_when_analyse_returned": processes_at_hand_off,
        "offline_status": status.get("status"),
        "offline_seconds": round(time.monotonic() - started, 1),
    }
    if status.get("status") == "completed":
        result["identity_check"] = httpx.get(f"{api}/jobs/{job_id}/identity-check", timeout=60).json()
        result["events"] = compare_events(live_events, offline_candidates(ROOT / "jobs" / job_id))
    else:
        result["offline_error"] = status.get("error")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--rate", type=float, action="append")
    parser.add_argument("--analyse", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    rates = args.rate or [1.0]
    ws_base = args.api.replace("http://", "ws://").replace("https://", "wss://")

    report = {"self_check_and_probe": "run by POST /live-sessions (a 201 means both passed)", "sessions": []}
    for n, rate in enumerate(rates):
        result = run_session(args.api, args.video, rate, ws_base)
        report["sessions"].append(result)
        last = n == len(rates) - 1
        if "error" in result:
            break
        if last and args.analyse:
            report["hand_off"] = hand_off(args.api, result["session_id"], result["events"])
        else:
            httpx.delete(f"{args.api}/live-sessions/{result['session_id']}", timeout=60)
    text = json.dumps(report, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
