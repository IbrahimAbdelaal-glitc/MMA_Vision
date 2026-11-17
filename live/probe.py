"""Live-input verification (design section 6).

Run as a short-lived subprocess so the API process never loads OpenCV and a
hung probe can be killed:

    python -m live.probe <video.mp4>          # prints one JSON object
    python -m live.probe --self-check         # checks the bundled fixture

`run_probe` and `run_self_check` are what the API calls.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "timestamp_check.mp4"


class ProbeUnavailable(Exception):
    """503: the check could not be run at all."""


class ProbeRejected(Exception):
    """422: the file failed, or could not be shown to pass, a rule."""

    def __init__(self, message: str, rules: Optional[dict] = None):
        super().__init__(message)
        self.rules = rules or {}


def find_ffprobe() -> Optional[str]:
    """MMA_FFPROBE, then PATH, then next to the ffmpeg used for E2."""

    configured = os.environ.get("MMA_FFPROBE")
    if configured:
        return configured if Path(configured).is_file() else None
    found = shutil.which("ffprobe")
    if found:
        return found
    ffmpeg = os.environ.get("MMA_FFMPEG") or shutil.which("ffmpeg")
    if ffmpeg:
        for name in ("ffprobe.exe", "ffprobe"):
            candidate = Path(ffmpeg).with_name(name)
            if candidate.is_file():
                return str(candidate)
    return None


# ------------------------------------------------------------ in the subprocess

def read_decoded(path: str) -> dict:
    """OpenCV's FFMPEG backend: metadata and every decoded frame's timestamp."""

    import cv2

    capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
    try:
        if not capture.isOpened():
            return {"error": "OpenCV could not open the file"}
        info = {
            "backend": capture.getBackendName(),
            "opencv_version": cv2.__version__,
            "fps": float(capture.get(cv2.CAP_PROP_FPS)),
            "frame_count": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
            "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        }
        decoded = []
        while capture.grab():
            decoded.append(float(capture.get(cv2.CAP_PROP_POS_MSEC)))
        info["decoded_ms"] = decoded
        return info
    finally:
        capture.release()


def read_packets(path: str, ffprobe: str) -> list:
    """Container presentation timestamps of every packet of the first video stream.

    Read without decoding; a packet with no timestamp is returned as None.
    """

    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "packet=pts_time", "-of", "csv=p=0", path],
        capture_output=True, text=True, errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or "").strip().splitlines()[-1:] or ["ffprobe failed"])
    packets = []
    for line in result.stdout.splitlines():
        value = line.strip().rstrip(",")
        if not value:
            continue
        try:
            packets.append(float(value) * 1000.0)
        except ValueError:
            packets.append(None)  # "N/A"
    return packets


def probe_file(path: str, ffprobe: str) -> dict:
    from live.timing import Meta, check_rules

    decoded = read_decoded(path)
    if "error" in decoded:
        return {"accepted": False, "reason": decoded["error"], "rules": {}}
    try:
        packets = read_packets(path, ffprobe)
    except Exception as error:  # noqa: BLE001 - reported as a rejection
        return {"accepted": False, "reason": f"ffprobe could not read packets: {error}", "rules": {}}

    meta = Meta(decoded["backend"], decoded["fps"], decoded["frame_count"],
                decoded["width"], decoded["height"])
    report = check_rules(meta, decoded["decoded_ms"], packets)
    out = {
        "accepted": report.ok,
        "rules": report.as_dict(),
        "fps": decoded["fps"],
        "frame_count": decoded["frame_count"],
        "width": decoded["width"],
        "height": decoded["height"],
        "backend": decoded["backend"],
        "opencv_version": decoded["opencv_version"],
        "ffprobe": ffprobe,
        "start_offset_ms": report.start_offset_ms,
    }
    if report.ok:
        out["timestamps_ms"] = decoded["decoded_ms"]
    else:
        out["reason"] = "; ".join(f"{name}: {report.results[name].detail}" for name in report.failed)
    return out


def self_check_result() -> dict:
    """Does this OpenCV build report the fixture's real 100 ms jump?"""

    from live.constants import CROSS_CHECK_TOLERANCE_MS, SELF_CHECK_JUMP_FRAME, SELF_CHECK_JUMP_MS

    decoded = read_decoded(str(FIXTURE))
    ts = decoded.get("decoded_ms") or []
    if len(ts) <= SELF_CHECK_JUMP_FRAME or decoded.get("backend") != "FFMPEG":
        return {"passed": False, "detail": f"read {len(ts)} frames with {decoded.get('backend')}"}
    gaps = [b - a for a, b in zip(ts, ts[1:])]
    normal = gaps[0]
    jump = ts[SELF_CHECK_JUMP_FRAME] - ts[SELF_CHECK_JUMP_FRAME - 1] - normal
    passed = abs(jump - SELF_CHECK_JUMP_MS) <= CROSS_CHECK_TOLERANCE_MS
    return {"passed": passed, "detail": f"jump of {jump:.3f} ms reported at frame {SELF_CHECK_JUMP_FRAME}"}


def main(argv: list) -> int:
    if argv and argv[0] == "--self-check":
        print(json.dumps(self_check_result()))
        return 0
    if len(argv) != 2:
        print(json.dumps({"error": "usage: python -m live.probe <video> <ffprobe>"}))
        return 2
    print(json.dumps(probe_file(argv[0], argv[1])))
    return 0


# ------------------------------------------------------------- in the API process

def _run(args: list, timeout: float) -> dict:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "live.probe", *args],
            cwd=ROOT, capture_output=True, text=True, errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise TimeoutError(f"the probe ran longer than {timeout:.0f} s") from error
    except OSError as error:
        raise ProbeUnavailable(f"the probe could not be started: {error}") from error
    lines = [line for line in result.stdout.splitlines() if line.strip().startswith("{")]
    if result.returncode != 0 or not lines:
        raise ProbeUnavailable(
            "the probe failed: " + ((result.stderr or "").strip().splitlines() or ["no output"])[-1]
        )
    return json.loads(lines[-1])


def run_self_check(timeout: float = 60.0) -> dict:
    try:
        return _run(["--self-check"], timeout)
    except TimeoutError as error:
        raise ProbeUnavailable(str(error)) from error


def run_probe(path: Path, timeout: Optional[float] = None) -> dict:
    """The verified probe result for an accepted file. Raises ProbeRejected / ProbeUnavailable."""

    from live.constants import PROBE_TIMEOUT_SECONDS

    ffprobe = find_ffprobe()
    if ffprobe is None:
        raise ProbeUnavailable(
            "ffprobe was not found. Set MMA_FFPROBE, put ffprobe on PATH, or install it next to ffmpeg."
        )
    try:
        result = _run([str(path), ffprobe], timeout or PROBE_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise ProbeRejected(f"Verification timed out: {error}.") from error
    if not result.get("accepted"):
        raise ProbeRejected(result.get("reason") or "the video failed verification", result.get("rules"))
    return result


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
