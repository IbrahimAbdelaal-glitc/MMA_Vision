import os
import sys
import cv2
import csv
from pathlib import Path
from ultralytics import YOLO

import pose_pass

# Project paths
BASE_DIR = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", BASE_DIR / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Select input video
input_video = os.environ.get("MMA_VIDEO_PATH")

if input_video:
    video_path = Path(input_video)
else:
    INPUT_DIR = BASE_DIR / "videos" / "input"
    videos = list(INPUT_DIR.glob("*.mp4"))

    if not videos:
        raise FileNotFoundError("No MP4 video found in videos/input")

    if len(videos) > 1:
        raise RuntimeError("Multiple MP4 files found. Specify MMA_VIDEO_PATH.")

    video_path = videos[0]

if not video_path.exists():
    raise FileNotFoundError(f"Input video not found: {video_path}")

output_path = RESULTS_DIR / pose_pass.KEYPOINTS_CSV

# Movement Analysis runs the same pose pass (model, settings, frames) and
# writes these rows with a provenance record; reuse them instead of running
# the model a second time (pose_pass.py).
if pose_pass.reusable(RESULTS_DIR, video_path):
    print(f"Processing: {video_path.name}")
    print("\nReusing the pose pass of the Movement Analysis stage "
          f"({pose_pass.PROVENANCE_JSON} matches this video, model and settings).")
    print(f"Dataset: {output_path}")
    sys.exit(0)

print("No reusable pose pass for this video, model and settings: running pose estimation.")

# Load pose model
MODEL_PATH = pose_pass.MODEL_PATH
model = YOLO(str(MODEL_PATH))
DEVICE = pose_pass.select_device()

# Confirmed fighter IDs from the previous test
FIGHTERS = {
    1: "blue",
    2: "red"
}

# COCO pose keypoint indexes
KEYPOINTS = {
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16
}

CONFIDENCE_THRESHOLD = 0.35

cap = cv2.VideoCapture(str(video_path))

fps = cap.get(cv2.CAP_PROP_FPS)
if fps <= 0:
    fps = 30

frame_number = 0
rows = []

print(f"Processing: {video_path.name}")

while True:
    success, frame = cap.read()

    if not success:
        break

    results = model.track(
        frame,
        persist=True,
        device=DEVICE,
        verbose=False,
        **pose_pass.TRACK_SETTINGS
    )

    result = results[0]

    if result.boxes is not None and result.keypoints is not None:
        boxes = result.boxes
        keypoints = result.keypoints

        if boxes.id is not None:
            track_ids = boxes.id.cpu().numpy().astype(int)
            coordinates = keypoints.xy.cpu().numpy()
            confidences = keypoints.conf.cpu().numpy()

            for i, track_id in enumerate(track_ids):

                if track_id not in FIGHTERS:
                    continue

                fighter = FIGHTERS[track_id]

                row = {
                    "frame": frame_number,
                    "time_seconds": frame_number / fps,
                    "fighter": fighter,
                    "track_id": track_id
                }

                for name, index in KEYPOINTS.items():

                    x, y = coordinates[i][index]
                    confidence = confidences[i][index]

                    if confidence < CONFIDENCE_THRESHOLD:
                        x, y = None, None

                    row[f"{name}_x"] = x
                    row[f"{name}_y"] = y
                    row[f"{name}_confidence"] = confidence

                rows.append(row)

    frame_number += 1

    if frame_number % 100 == 0:
        print(f"Processed {frame_number} frames")

cap.release()

# Save keypoint dataset
if rows:
    with open(output_path, "w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

print("\nKeypoint extraction completed!")
print(f"Frames processed: {frame_number}")
print(f"Fighter records: {len(rows)}")
print(f"Dataset saved to: {output_path}")