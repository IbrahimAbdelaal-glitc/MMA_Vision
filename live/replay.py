"""Replay the live detector over a real video, deterministically, for evaluation.

Two stages, so detector experiments do not need the GPU every time:

    # 1. GPU, once per video: the live engine's model and identity tracker on
    #    every frame; keypoints per corner are cached in an .npz file.
    python -m live.replay extract --video clip.mp4 --out cache.npz

    # 2. CPU, seconds: the causal live Detector over the cached keypoints at a
    #    chosen analysed rate (60 = every frame, 30 = every 2nd, ...), writing
    #    events with diagnostics, and optionally matching them to an offline job.
    python -m live.replay detect --cache cache.npz --rate 30 --out events.csv \
        [--offline-job jobs/<id>]

Times are frame_index / fps (the verified 60 fps grid), the same time base as
the offline pipeline's peak_time, so events can be compared directly. The
detector sees only frames up to the current one, exactly as in the engine.
Nothing here changes what the engine or the offline pipeline do.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Optional

import cv2  # noqa: F401  (cv2 before torch, as in the engine)
import numpy as np

from live import constants as K
from live.detector import SPEED_REFERENCES, Detector, body_centre
from live.identity import IdentityTracker

CORNERS = ("blue", "red")
MATCH_TOLERANCE = 2 / 60     # live.realcheck: one frame of documented lag plus one of slack


# ------------------------------------------------------------------ extract
def extract(video: Path, out: Path, device: Optional[str] = None) -> dict:
    import torch
    from live.engine import YoloModel

    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS)
    width, height = int(capture.get(3)), int(capture.get(4))
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    device = device or ("cuda:0" if torch.cuda.is_available() else "cpu")
    model = YoloModel(device)
    model.warm_up(width, height)
    tracker = IdentityTracker(math.hypot(width, height))

    keypoints = np.full((count, 2, 17, 3), np.nan, dtype=np.float32)
    track_ids = np.full((count, 2), -1, dtype=np.int32)
    boxes = np.full((count, 2, 4), np.nan, dtype=np.float32)
    people_count = np.zeros(count, dtype=np.int16)
    swaps = []
    index = 0
    while index < count:
        ok, frame = capture.read()
        if not ok:
            break
        people = model(frame)
        people_count[index] = len(people)
        result = tracker.update(index, index / fps, people)
        swaps += [e for e in result.log if e.get("kind") not in ("seeded",)]
        for c, corner in enumerate(CORNERS):
            person = result.persons[corner]
            if person is not None:
                keypoints[index, c] = np.asarray(person.keypoints, dtype=np.float32)
                track_ids[index, c] = person.track_id
                boxes[index, c] = np.asarray(person.box, dtype=np.float32)
        index += 1
    capture.release()
    np.savez_compressed(out, keypoints=keypoints[:index], track_ids=track_ids[:index],
                        boxes=boxes[:index], people_count=people_count[:index],
                        fps=fps, width=width, height=height, video=str(video))
    return {"frames": index, "fps": fps, "identity_log_entries": len(swaps), "device": device}


def load(cache: Path) -> dict:
    data = np.load(cache, allow_pickle=False)
    return {k: data[k] for k in data.files}


# ------------------------------------------------------------------- detect
def _kps(row: np.ndarray):
    if np.isnan(row).all():
        return None
    return [tuple(float(v) for v in joint) for joint in row]


def diagnostics(data: dict, frame: int, corner: str, side: str, kind: str, rate_step: int) -> dict:
    """Facts about the motion at an event's peak, measured from the same keypoints.

    end_speed: speed of the wrist/ankle; torso_speed: speed of the torso centre over
    the same interval; relative_speed: speed of the wrist/ankle relative to the torso.
    A ratio torso/end near 1 means the whole body moved (a step), not the limb.
    """
    c = CORNERS.index(corner)
    fps = float(data["fps"])
    joint = "wrist" if kind == "punch-like" else "ankle"
    j = K.KP[f"{side}_{joint}"]
    a, b = frame - rate_step, frame
    out = {"end_speed": None, "torso_speed": None, "relative_speed": None, "torso_ratio": None,
           "track_id": int(data["track_ids"][frame, c]), "people_in_frame": int(data["people_count"][frame])}
    if a < 0:
        return out
    ka, kb = _kps(data["keypoints"][a, c]), _kps(data["keypoints"][b, c])
    if ka is None or kb is None:
        return out
    dt = (b - a) / fps
    pa, pb = ka[j], kb[j]
    ca, cb = body_centre(ka), body_centre(kb)
    if pa[2] >= K.KEYPOINT_CONFIDENCE and pb[2] >= K.KEYPOINT_CONFIDENCE:
        out["end_speed"] = math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / dt
        if ca is not None and cb is not None:
            out["torso_speed"] = math.hypot(cb[0] - ca[0], cb[1] - ca[1]) / dt
            rel = ((pb[0] - cb[0]) - (pa[0] - ca[0]), (pb[1] - cb[1]) - (pa[1] - ca[1]))
            out["relative_speed"] = math.hypot(*rel) / dt
            if out["end_speed"] > 0:
                out["torso_ratio"] = out["torso_speed"] / out["end_speed"]
    return out


def detect(data: dict, rate: float, detector: Optional[Detector] = None,
           speed_reference: str = "image", cross_leg_kick_duplicates: bool = True) -> list:
    """Run the causal detector over every `round(fps / rate)`-th frame."""
    fps = float(data["fps"])
    step = max(1, round(fps / rate))
    if detector is None:
        detector = Detector(speed_reference=speed_reference,
                            cross_leg_kick_duplicates=cross_leg_kick_duplicates)
    events = []
    frames = range(0, len(data["keypoints"]), step)
    last = None
    for frame in frames:
        kps = {corner: _kps(data["keypoints"][frame, c]) for c, corner in enumerate(CORNERS)}
        for e in detector.add_frame(frame, frame / fps, kps, True):
            events.append(e)
        last = frame
    if last is not None:
        events += detector.finish(last / fps)
    for e in events:
        e.update(diagnostics(data, e["peak_frame"], e["corner"], e["side"], e["type"], step))
    return events


# -------------------------------------------------------------- comparison
def offline_rows(job_dir: Path) -> list:
    with (job_dir / "results" / "classified_strike_candidates.csv").open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def match_offline(events: list, offline: list) -> None:
    """Annotate each event with its offline counterpart (same stream, within 2/60 s)."""
    used = set()
    for e in events:
        best = None
        for i, row in enumerate(offline):
            if i in used or row["fighter"] != e["corner"] or row["limb"] != e["side"] or row["event_type"] != e["type"]:
                continue
            gap = abs(float(row["peak_time"]) - e["peak_t"])
            if gap <= MATCH_TOLERANCE + 1e-9 and (best is None or gap < best[1]):
                best = (i, gap)
        if best is None:
            e["offline_match"] = "live_only"
            continue
        used.add(best[0])
        row = offline[best[0]]
        e["offline_match"] = "matched"
        e["offline_peak_time"] = round(float(row["peak_time"]), 4)
        e["offline_class"] = row["detection_class"]
    for i, row in enumerate(offline):
        if i not in used:
            events.append({"corner": row["fighter"], "side": row["limb"], "type": row["event_type"],
                           "peak_t": round(float(row["peak_time"]), 4), "offline_match": "offline_only",
                           "offline_peak_time": round(float(row["peak_time"]), 4),
                           "offline_class": row["detection_class"]})
    events.sort(key=lambda e: e["peak_t"])


COLUMNS = ["corner", "side", "type", "peak_t", "peak_frame", "smoothed_peak_speed", "extension_gain",
           "angle_gain", "retraction", "keypoint_confidence", "first_stage_score", "pool_size",
           "score_status", "kinematic_score", "detection_class", "end_speed", "torso_speed",
           "relative_speed", "torso_ratio", "track_id", "people_in_frame", "offline_match",
           "offline_peak_time", "offline_class"]


def write_events(events: list, out: Path) -> None:
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for e in events:
            writer.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in e.items()})


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m live.replay", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    ex = sub.add_parser("extract", help="run the model and identity tracker; cache keypoints")
    ex.add_argument("--video", required=True, type=Path)
    ex.add_argument("--out", required=True, type=Path)
    ex.add_argument("--device", default=None)
    de = sub.add_parser("detect", help="run the live detector over cached keypoints")
    de.add_argument("--cache", required=True, type=Path)
    de.add_argument("--rate", type=float, default=60.0, help="analysed frames per second")
    de.add_argument("--out", required=True, type=Path)
    de.add_argument("--offline-job", type=Path, default=None)
    de.add_argument("--speed-reference", choices=SPEED_REFERENCES, default="image")
    de.add_argument("--per-limb-duplicates", action="store_true",
                    help="remove duplicates within one limb only (the rule before cross-leg kick duplicates)")
    args = parser.parse_args(argv)

    if args.command == "extract":
        print(json.dumps(extract(args.video, args.out, args.device)))
        return 0
    data = load(args.cache)
    events = detect(data, args.rate, speed_reference=args.speed_reference,
                    cross_leg_kick_duplicates=not args.per_limb_duplicates)
    summary = {"events": len(events)}
    if args.offline_job:
        match_offline(events, offline_rows(args.offline_job))
        for kind in ("matched", "live_only", "offline_only"):
            summary[kind] = sum(1 for e in events if e.get("offline_match") == kind)
    write_events(events, args.out)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
