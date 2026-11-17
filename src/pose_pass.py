"""One pose-estimation pass shared by the two offline stages that need it.

movement_analysis.py and strike_estimation.py used to run the same YOLO11n-pose
+ ByteTrack pass (same model, settings and frames) over the whole video, one
after the other. movement_analysis.py now also writes the keypoint rows that
strike_estimation.py needs, with a provenance record; strike_estimation.py
reuses them only when the record matches the video, model and settings it
would use itself, and otherwise runs the pass as before.

Device: MMA_OFFLINE_DEVICE = "auto" (default: the first CUDA GPU when PyTorch
sees one, else the CPU), "cpu", or a device such as "cuda:0". The API never
runs offline analysis while a live session holds the GPU.
"""

import json
import os
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "yolo11n-pose.pt"

# The settings both stages pass to model.track(); part of the provenance.
TRACK_SETTINGS = {"classes": [0], "conf": 0.35, "imgsz": 640, "tracker": "bytetrack.yaml"}

FIGHTERS = {1: "blue", 2: "red"}

KEYPOINTS = {
    "left_shoulder": 5, "right_shoulder": 6,
    "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10,
    "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14,
    "left_ankle": 15, "right_ankle": 16,
}

CONFIDENCE_THRESHOLD = 0.35
KEYPOINTS_CSV = "fighter_keypoints.csv"
PROVENANCE_JSON = "pose_pass.json"


def select_device() -> str:
    requested = os.environ.get("MMA_OFFLINE_DEVICE", "auto").strip().lower()
    if requested and requested != "auto":
        return requested
    import torch   # after ultralytics/cv2 (the caller's imports), never before them
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def keypoint_row(frame_number: int, fps: float, track_id, points) -> dict:
    """One fighter_keypoints.csv row, exactly as strike_estimation.py writes it.

    points: the person's 17 x 3 array (x, y, confidence) from result.keypoints.data.
    """
    row = {
        "frame": frame_number,
        "time_seconds": frame_number / fps,
        "fighter": FIGHTERS[int(track_id)],
        "track_id": track_id,
    }
    for name, index in KEYPOINTS.items():
        x, y = points[index][0], points[index][1]
        confidence = points[index][2]
        if confidence < CONFIDENCE_THRESHOLD:
            x, y = None, None
        row[f"{name}_x"] = x
        row[f"{name}_y"] = y
        row[f"{name}_confidence"] = confidence
    return row


def provenance(video_path: Path, device: str, frames: int) -> dict:
    stat = Path(video_path).stat()
    model = MODEL_PATH.stat()
    return {
        "video": str(Path(video_path).resolve()),
        "video_size": stat.st_size,
        "video_mtime_ns": stat.st_mtime_ns,
        "model": str(MODEL_PATH),
        "model_size": model.st_size,
        "settings": TRACK_SETTINGS,
        "device": device,
        "frames": frames,
    }


def write_provenance(results_dir: Path, record: dict) -> None:
    (Path(results_dir) / PROVENANCE_JSON).write_text(json.dumps(record, indent=2), encoding="utf-8")


def reusable(results_dir: Path, video_path: Path) -> bool:
    """True when results_dir holds keypoint rows from a finished pass over this video."""
    results_dir = Path(results_dir)
    record_file = results_dir / PROVENANCE_JSON
    if not record_file.is_file() or not (results_dir / KEYPOINTS_CSV).is_file():
        return False
    try:
        record = json.loads(record_file.read_text(encoding="utf-8"))
        current = provenance(video_path, record.get("device", ""), record.get("frames", 0))
    except (OSError, ValueError):
        return False
    keys = ("video", "video_size", "video_mtime_ns", "model", "model_size", "settings")
    return all(record.get(k) == current[k] for k in keys)
