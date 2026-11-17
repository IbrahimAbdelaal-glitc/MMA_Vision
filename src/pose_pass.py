"""One pose-estimation pass shared by the two offline stages that need it.

movement_analysis.py and strike_estimation.py used to run the same YOLO11n-pose
+ ByteTrack pass (same model, settings and frames) over the whole video, one
after the other. movement_analysis.py now also writes the keypoint rows that
strike_estimation.py needs, with a provenance record; strike_estimation.py
reuses them only when the record matches the video (path, size, modification
time), the model file's contents, the tracking settings, the keypoint
threshold and the ultralytics version it would use itself, and the keypoint
file is unchanged since the record was written. Otherwise it runs the pass as
before.

Device: MMA_OFFLINE_DEVICE = "auto" (default: the first CUDA GPU when PyTorch
sees one, else the CPU), "cpu", or a device such as "cuda:0". The API never
runs offline analysis while a live session holds the GPU.
"""

import hashlib
import json
import os
from importlib import metadata
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


class DeviceUnavailable(RuntimeError):
    pass


def select_device() -> str:
    """MMA_OFFLINE_DEVICE: "auto" (CUDA if PyTorch sees it, else CPU), "cpu" or "cuda[:N]".

    "auto" falls back to the CPU. An explicit CUDA device that does not exist is
    an error, not a silent switch to the CPU.
    """
    import torch   # after ultralytics/cv2 (the caller's imports), never before them
    requested = os.environ.get("MMA_OFFLINE_DEVICE", "auto").strip().lower() or "auto"
    if requested == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if requested == "cpu":
        return "cpu"
    if requested == "cuda" or requested.startswith("cuda:"):
        index = 0 if requested == "cuda" else requested.split(":", 1)[1]
        if not str(index).isdigit():
            raise DeviceUnavailable(f"MMA_OFFLINE_DEVICE={requested!r}: expected auto, cpu, cuda or cuda:N")
        if not torch.cuda.is_available():
            raise DeviceUnavailable(
                f"MMA_OFFLINE_DEVICE={requested!r} but PyTorch sees no CUDA GPU "
                "(use auto or cpu, or install the CUDA build of PyTorch)")
        if int(index) >= torch.cuda.device_count():
            raise DeviceUnavailable(
                f"MMA_OFFLINE_DEVICE={requested!r} but only {torch.cuda.device_count()} CUDA device(s) exist")
        return f"cuda:{int(index)}"
    raise DeviceUnavailable(f"MMA_OFFLINE_DEVICE={requested!r}: expected auto, cpu, cuda or cuda:N")


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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _ultralytics_version() -> str:
    try:
        return metadata.version("ultralytics")
    except metadata.PackageNotFoundError:
        return "unknown"


# Everything that decides the keypoint rows. Reuse requires all of it to match.
INPUT_KEYS = ("video", "video_size", "video_mtime_ns", "model", "model_sha256", "settings",
              "keypoint_threshold", "keypoints", "fighters", "ultralytics")


def provenance(video_path: Path, device: str, frames: int) -> dict:
    stat = Path(video_path).stat()
    return {
        "video": str(Path(video_path).resolve()),
        "video_size": stat.st_size,
        "video_mtime_ns": stat.st_mtime_ns,
        "model": str(MODEL_PATH),
        "model_sha256": _sha256(MODEL_PATH),
        "settings": TRACK_SETTINGS,
        "keypoint_threshold": CONFIDENCE_THRESHOLD,
        "keypoints": KEYPOINTS,
        "fighters": {str(k): v for k, v in FIGHTERS.items()},
        "ultralytics": _ultralytics_version(),
        "device": device,
        "frames": frames,
    }


def write_provenance(results_dir: Path, record: dict) -> None:
    """Record the pass, with a fingerprint of the keypoint file it produced (written last)."""
    results_dir = Path(results_dir)
    record = {**record, "keypoints_csv_sha256": _sha256(results_dir / KEYPOINTS_CSV)}
    (results_dir / PROVENANCE_JSON).write_text(json.dumps(record, indent=2), encoding="utf-8")


def reusable(results_dir: Path, video_path: Path) -> bool:
    """True only when results_dir holds the unchanged keypoint rows of a finished pass
    over this video with this model, these settings and this library version.

    Any doubt (missing, unreadable or malformed record, changed or truncated CSV,
    any input different) means False: the caller then runs the pass itself.
    """
    results_dir = Path(results_dir)
    record_file = results_dir / PROVENANCE_JSON
    csv_file = results_dir / KEYPOINTS_CSV
    if not record_file.is_file() or not csv_file.is_file():
        return False
    try:
        record = json.loads(record_file.read_text(encoding="utf-8"))
        if not isinstance(record, dict):
            return False
        current = provenance(video_path, "", 0)
        if record.get("keypoints_csv_sha256") != _sha256(csv_file):
            return False
    except (OSError, ValueError):
        return False
    # JSON turns tuples into lists: compare in JSON form.
    current = json.loads(json.dumps(current))
    return all(k in record and record[k] == current[k] for k in INPUT_KEYS)
