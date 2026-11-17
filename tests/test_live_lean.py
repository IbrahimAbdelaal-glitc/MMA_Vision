"""Lean per-frame inference path (design 2026-11-17-live-lean-inference).

The lean path calls the configured ultralytics predictor's own pieces
directly, with NMS and scaling on the CPU. It must give the same people,
tracker IDs and order as `model.track()` on every frame of the real clips,
with boxes and keypoints within 0.001 (CPU vs GPU float rounding).
"""
from pathlib import Path

import cv2  # noqa: F401  (before torch: OpenMP clash, see the live-engine plan)
import numpy as np
import pytest
import torch

from live.engine import YoloModel

needs_cuda = pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a CUDA device")
TOLERANCE = 1e-3

ROOT = Path(__file__).resolve().parents[1]
REAL: dict = {}
for _path in sorted((ROOT / "jobs").glob("*/input/input.mp4")):
    REAL.setdefault(_path.stat().st_size, _path)
CLIPS = {"6s": REAL.get(6119753), "15s": REAL.get(15230609)}


def frames_of(path):
    capture = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG)
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                return
            yield frame
    finally:
        capture.release()


def max_difference(a, b) -> float:
    return float(np.max(np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)))) if len(a) else 0.0


@needs_cuda
@pytest.mark.parametrize("name", ["6s", "15s"])
def test_lean_path_matches_model_track_on_every_frame_of_the_real_clips(name):
    clip = CLIPS[name]
    if clip is None:
        pytest.skip(f"the real {name} clip is not in jobs/")
    first = next(frames_of(clip))
    height, width = first.shape[:2]
    full, lean = YoloModel("cuda:0", lean=False), YoloModel("cuda:0", lean=True)
    full.warm_up(width, height)
    lean.warm_up(width, height)
    frames = people = 0
    worst_box = worst_keypoint = 0.0
    for index, frame in enumerate(frames_of(clip)):
        expected, got = full(frame), lean(frame)
        assert [p.track_id for p in got] == [p.track_id for p in expected], f"frame {index}: IDs differ"
        for e, g in zip(expected, got):
            worst_box = max(worst_box, max_difference(e.box, g.box))
            worst_keypoint = max(worst_keypoint, max_difference(e.keypoints, g.keypoints))
        frames += 1
        people += len(got)
    assert worst_box <= TOLERANCE, worst_box
    assert worst_keypoint <= TOLERANCE, worst_keypoint
    assert lean.inference == "cuda_graph"
    assert frames > 300 and people > frames


def test_lean_path_runs_on_cpu():
    model = YoloModel("cpu", lean=True)
    model.warm_up(64, 36)
    assert model(np.zeros((36, 64, 3), dtype=np.uint8)) == []


@needs_cuda
def test_blank_frame_returns_nothing_and_still_advances_the_tracker():
    model = YoloModel("cuda:0", lean=True)
    model.warm_up(320, 180)
    tracker = model.model.predictor.trackers[0]
    before = tracker.frame_id
    blank = np.zeros((180, 320, 3), dtype=np.uint8)
    assert model(blank) == [] and model(blank) == []
    assert tracker.frame_id == before + 2
