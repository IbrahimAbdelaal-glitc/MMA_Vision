"""src/pose_pass.py: when the Pose Estimation stage may reuse the shared pass, and device choice.

Reuse must happen only when the keypoint rows are exactly those this stage would
compute itself; anything doubtful must make it run the pass again.
"""

import json
import os
import sys
import time
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import pose_pass  # noqa: E402


@pytest.fixture
def finished_pass(tmp_path):
    """A results folder as Movement Analysis leaves it after a complete pass."""
    video = tmp_path / "input.mp4"
    video.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"x" * 1000)
    results = tmp_path / "results"
    results.mkdir()
    (results / pose_pass.KEYPOINTS_CSV).write_text("frame,time_seconds,fighter\n0,0.0,blue\n", encoding="utf-8")
    pose_pass.write_provenance(results, pose_pass.provenance(video, "cpu", 1))
    return results, video


def record(results):
    return json.loads((results / pose_pass.PROVENANCE_JSON).read_text(encoding="utf-8"))


def rewrite(results, **changes):
    data = {**record(results), **changes}
    (results / pose_pass.PROVENANCE_JSON).write_text(json.dumps(data), encoding="utf-8")


def test_a_finished_pass_over_the_same_video_is_reused(finished_pass):
    results, video = finished_pass
    assert pose_pass.reusable(results, video)


def test_the_device_of_the_pass_does_not_prevent_reuse(finished_pass):
    results, video = finished_pass
    rewrite(results, device="cuda:0")
    assert pose_pass.reusable(results, video)


@pytest.mark.parametrize("missing", [pose_pass.PROVENANCE_JSON, pose_pass.KEYPOINTS_CSV])
def test_a_missing_record_or_csv_is_not_reused(finished_pass, missing):
    results, video = finished_pass
    (results / missing).unlink()
    assert not pose_pass.reusable(results, video)


@pytest.mark.parametrize("content", ["{not json", "null", "[]", '"text"', ""])
def test_a_malformed_record_is_not_reused_and_does_not_crash(finished_pass, content):
    results, video = finished_pass
    (results / pose_pass.PROVENANCE_JSON).write_text(content, encoding="utf-8")
    assert not pose_pass.reusable(results, video)


def test_a_different_video_is_not_reused(finished_pass, tmp_path):
    results, _ = finished_pass
    other = tmp_path / "other.mp4"
    other.write_bytes(b"different")
    assert not pose_pass.reusable(results, other)


def test_a_replaced_video_at_the_same_path_is_not_reused(finished_pass):
    results, video = finished_pass
    time.sleep(0.01)
    video.write_bytes(video.read_bytes() + b"more")
    assert not pose_pass.reusable(results, video)


def test_a_touched_video_is_not_reused(finished_pass):
    results, video = finished_pass
    stat = video.stat()
    os.utime(video, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert not pose_pass.reusable(results, video)


def test_an_edited_keypoint_csv_is_not_reused(finished_pass):
    results, video = finished_pass
    path = results / pose_pass.KEYPOINTS_CSV
    path.write_text(path.read_text(encoding="utf-8") + "1,0.0167,red\n", encoding="utf-8")
    assert not pose_pass.reusable(results, video)


def test_a_truncated_keypoint_csv_is_not_reused(finished_pass):
    results, video = finished_pass
    path = results / pose_pass.KEYPOINTS_CSV
    path.write_bytes(path.read_bytes()[:10])
    assert not pose_pass.reusable(results, video)


@pytest.mark.parametrize("key, value", [
    ("model_sha256", "0" * 64),
    ("settings", {**pose_pass.TRACK_SETTINGS, "conf": 0.5}),
    ("settings", {**pose_pass.TRACK_SETTINGS, "tracker": "botsort.yaml"}),
    ("keypoint_threshold", 0.5),
    ("ultralytics", "0.0.1"),
    ("fighters", {"1": "red", "2": "blue"}),
])
def test_a_pass_with_other_inputs_is_not_reused(finished_pass, key, value):
    results, video = finished_pass
    rewrite(results, **{key: value})
    assert not pose_pass.reusable(results, video)


def test_a_record_missing_an_input_is_not_reused(finished_pass):
    # For example a record written by an older version without the model hash.
    results, video = finished_pass
    data = record(results)
    del data["model_sha256"]
    (results / pose_pass.PROVENANCE_JSON).write_text(json.dumps(data), encoding="utf-8")
    assert not pose_pass.reusable(results, video)


def test_a_different_model_file_is_not_reused(finished_pass, tmp_path, monkeypatch):
    results, video = finished_pass
    other_model = tmp_path / "yolo11n-pose.pt"
    other_model.write_bytes(b"other weights")
    monkeypatch.setattr(pose_pass, "MODEL_PATH", other_model)
    assert not pose_pass.reusable(results, video)


def test_the_keypoint_row_blanks_low_confidence_points():
    points = [[float(i), float(i) + 0.5, 0.9] for i in range(17)]
    points[9][2] = 0.2                                     # left wrist below 0.35
    row = pose_pass.keypoint_row(30, 60.0, 2, points)

    assert row["fighter"] == "red" and row["time_seconds"] == 0.5
    assert row["left_wrist_x"] is None and row["left_wrist_confidence"] == 0.2
    assert row["right_wrist_x"] == 10.0 and row["right_wrist_y"] == 10.5


# -------------------------------------------------------------------- device
class FakeCuda:
    def __init__(self, available, count=1):
        self.available, self.count = available, count

    def is_available(self):
        return self.available

    def device_count(self):
        return self.count


@pytest.fixture
def cuda(monkeypatch):
    # A stand-in torch module: importing the real one before cv2 aborts the
    # process on Windows (duplicate OpenMP runtime), and these tests must not
    # depend on the machine's GPU anyway.
    def set_cuda(available, count=1):
        monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(cuda=FakeCuda(available, count)))
    return set_cuda


@pytest.mark.parametrize("value", [None, "auto", "AUTO", "", "  auto "])
def test_auto_uses_the_gpu_when_there_is_one(monkeypatch, cuda, value):
    cuda(True)
    if value is None:
        monkeypatch.delenv("MMA_OFFLINE_DEVICE", raising=False)
    else:
        monkeypatch.setenv("MMA_OFFLINE_DEVICE", value)
    assert pose_pass.select_device() == "cuda:0"


def test_auto_falls_back_to_the_cpu_without_a_gpu(monkeypatch, cuda):
    cuda(False)
    monkeypatch.delenv("MMA_OFFLINE_DEVICE", raising=False)
    assert pose_pass.select_device() == "cpu"


def test_cpu_can_be_forced_on_a_gpu_machine(monkeypatch, cuda):
    cuda(True)
    monkeypatch.setenv("MMA_OFFLINE_DEVICE", "cpu")
    assert pose_pass.select_device() == "cpu"


@pytest.mark.parametrize("value, expected", [("cuda", "cuda:0"), ("cuda:1", "cuda:1"), ("CUDA:0", "cuda:0")])
def test_an_existing_cuda_device_is_used(monkeypatch, cuda, value, expected):
    cuda(True, count=2)
    monkeypatch.setenv("MMA_OFFLINE_DEVICE", value)
    assert pose_pass.select_device() == expected


@pytest.mark.parametrize("available, count, value", [
    (False, 0, "cuda"),          # no GPU: an explicit request is an error, not a silent CPU run
    (True, 1, "cuda:3"),         # no such GPU
    (True, 1, "cuda:x"),
    (True, 1, "gpu"),
])
def test_an_unusable_device_request_fails_clearly(monkeypatch, cuda, available, count, value):
    cuda(available, count)
    monkeypatch.setenv("MMA_OFFLINE_DEVICE", value)
    with pytest.raises(pose_pass.DeviceUnavailable, match="MMA_OFFLINE_DEVICE"):
        pose_pass.select_device()
