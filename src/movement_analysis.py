import os
from pathlib import Path
import cv2
import csv
import numpy as np
from ultralytics import YOLO

from kinematics import box_center, step_speed
import pose_pass

# ==========================================
# 1. PROJECT CONFIGURATION
# ==========================================

ROOT = Path(__file__).resolve().parents[1]

# Job-specific paths, with existing project paths as defaults
RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

OUTPUT_DIR = Path(
    os.environ.get("MMA_OUTPUT_DIR", ROOT / "videos" / "output")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# IDs confirmed from our previous tests
FIGHTERS = {
    1: {
        "name": "BLUE CORNER - FIGHTER B",
        "color": (255, 0, 0)
    },
    2: {
        "name": "RED CORNER - FIGHTER A",
        "color": (0, 0, 255)
    }
}

CONF_THRESHOLD = 0.35

# COCO keypoint indexes
LEFT_WRIST = 9
RIGHT_WRIST = 10
LEFT_ANKLE = 15
RIGHT_ANKLE = 16

WRISTS = [LEFT_WRIST, RIGHT_WRIST]
ANKLES = [LEFT_ANKLE, RIGHT_ANKLE]

# ==========================================
# 2. FIND INPUT VIDEO
# ==========================================

# Use the video assigned to this job.
# Fall back to the original input folder for standalone execution.
input_video = os.environ.get("MMA_VIDEO_PATH")

if input_video:
    video_path = Path(input_video)
else:
    INPUT_DIR = ROOT / "videos" / "input"
    videos = list(INPUT_DIR.glob("*.mp4"))

    if not videos:
        raise FileNotFoundError("No MP4 video found in videos/input")

    if len(videos) > 1:
        raise RuntimeError("Multiple MP4 files found. Specify MMA_VIDEO_PATH.")

    video_path = videos[0]

if not video_path.exists():
    raise FileNotFoundError(f"Input video not found: {video_path}")

output_video = OUTPUT_DIR / "movement_analysis.mp4"
output_csv = RESULTS_DIR / "movement_metrics.csv"
keypoints_csv = RESULTS_DIR / pose_pass.KEYPOINTS_CSV

print(f"Input video: {video_path.name}")

# ==========================================
# 3. LOAD MODEL AND VIDEO
# ==========================================

MODEL_PATH = pose_pass.MODEL_PATH
model = YOLO(str(MODEL_PATH))
DEVICE = pose_pass.select_device()
print(f"Device: {DEVICE}")

# This pass also produces the keypoint rows of the Pose Estimation stage;
# any record of an earlier pass is removed until this one has finished.
(RESULTS_DIR / pose_pass.PROVENANCE_JSON).unlink(missing_ok=True)
keypoint_rows = []

cap = cv2.VideoCapture(str(video_path))

fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

if fps <= 0:
    fps = 30

frame_diagonal = np.sqrt(width**2 + height**2)

writer = cv2.VideoWriter(
    str(output_video),
    cv2.VideoWriter_fourcc(*"mp4v"),
    fps,
    (width, height)
)

# ==========================================
# 4. MOVEMENT TRACKING VARIABLES
# ==========================================

previous = {}
total_movement = {1: 0.0, 2: 0.0}

frame_count = 0
csv_rows = []

# ==========================================
# 5. HELPER FUNCTION
# ==========================================

def calculate_joint_speed(current, previous_points, indexes, fps, frame_gap):

    speeds = []

    for index in indexes:

        current_point = current[index]
        previous_point = previous_points[index]

        if (
            current_point[2] >= CONF_THRESHOLD
            and previous_point[2] >= CONF_THRESHOLD
        ):

            distance = np.linalg.norm(
                current_point[:2] - previous_point[:2]
            )

            speed = step_speed(float(distance), frame_gap, fps)

            if speed is not None:
                speeds.append(speed)

    if speeds:
        return float(np.mean(speeds))

    return None


# ==========================================
# 6. PROCESS VIDEO
# ==========================================

print("Starting movement analysis...")

while cap.isOpened():

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

    frame_data = {
        "frame": frame_count,
        "time_seconds": frame_count / fps
    }

    current_fighters = {}

    if (
        result.boxes is not None
        and result.boxes.id is not None
        and result.keypoints is not None
    ):

        boxes = result.boxes
        keypoints = result.keypoints.data.cpu().numpy()

        track_ids = boxes.id.cpu().numpy().astype(int)

        for index, box in enumerate(boxes):

            track_id = int(box.id[0])

            if track_id not in FIGHTERS:
                continue

            points = keypoints[index]

            # The Pose Estimation stage's row for this person (pose_pass.py).
            keypoint_rows.append(
                pose_pass.keypoint_row(frame_count, fps, track_ids[index], points)
            )

            corners = box.xyxy[0].cpu().tolist()

            # Integers for drawing only; the centre keeps sub-pixel precision.
            x1, y1, x2, y2 = map(int, corners)

            center = np.array(box_center(corners))

            current_fighters[track_id] = {
                "center": center,
                "points": points
            }

            # Draw fighter box
            color = FIGHTERS[track_id]["color"]

            cv2.rectangle(
                frame,
                (x1, y1),
                (x2, y2),
                color,
                2
            )

            cv2.putText(
                frame,
                FIGHTERS[track_id]["name"],
                (x1, max(y1 - 10, 25)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2
            )

            # Draw skeleton
            skeleton = [
                (5, 6),
                (5, 7), (7, 9),
                (6, 8), (8, 10),
                (5, 11), (6, 12),
                (11, 12),
                (11, 13), (13, 15),
                (12, 14), (14, 16)
            ]

            for start, end in skeleton:

                if (
                    points[start][2] >= CONF_THRESHOLD
                    and points[end][2] >= CONF_THRESHOLD
                ):

                    p1 = tuple(points[start][:2].astype(int))
                    p2 = tuple(points[end][:2].astype(int))

                    cv2.line(frame, p1, p2, color, 2)

    # ======================================
    # 7. CALCULATE EACH FIGHTER'S MOVEMENT
    # ======================================

    for track_id in [1, 2]:

        prefix = "blue" if track_id == 1 else "red"

        frame_data[f"{prefix}_detected"] = 0
        frame_data[f"{prefix}_x"] = None
        frame_data[f"{prefix}_y"] = None
        frame_data[f"{prefix}_movement_speed_px_s"] = None
        frame_data[f"{prefix}_total_movement_px"] = total_movement[track_id]
        frame_data[f"{prefix}_wrist_speed_px_s"] = None
        frame_data[f"{prefix}_ankle_speed_px_s"] = None

        if track_id not in current_fighters:
            continue

        fighter = current_fighters[track_id]

        center = fighter["center"]
        points = fighter["points"]

        frame_data[f"{prefix}_detected"] = 1
        frame_data[f"{prefix}_x"] = float(center[0])
        frame_data[f"{prefix}_y"] = float(center[1])

        if track_id in previous:

            old = previous[track_id]

            # Frames since this fighter was last seen: speeds are divided by
            # the real elapsed time and withheld after a long gap (kinematics.py).
            frame_gap = frame_count - old["frame"]

            # Bounding-box center movement
            center_distance = float(np.linalg.norm(
                center - old["center"]
            ))

            movement_speed = step_speed(center_distance, frame_gap, fps)

            if movement_speed is not None:

                # A jump across a long gap is not counted as movement.
                total_movement[track_id] += center_distance

                frame_data[f"{prefix}_movement_speed_px_s"] = float(
                    movement_speed
                )

            # Arm movement
            wrist_speed = calculate_joint_speed(
                points,
                old["points"],
                WRISTS,
                fps,
                frame_gap
            )

            frame_data[f"{prefix}_wrist_speed_px_s"] = wrist_speed

            # Leg movement
            ankle_speed = calculate_joint_speed(
                points,
                old["points"],
                ANKLES,
                fps,
                frame_gap
            )

            frame_data[f"{prefix}_ankle_speed_px_s"] = ankle_speed

        frame_data[f"{prefix}_total_movement_px"] = float(
            total_movement[track_id]
        )

        previous[track_id] = {
            "frame": frame_count,
            "center": center.copy(),
            "points": points.copy()
        }

    # ======================================
    # 8. CALCULATE DISTANCE BETWEEN FIGHTERS
    # ======================================

    if 1 in current_fighters and 2 in current_fighters:

        blue_center = current_fighters[1]["center"]
        red_center = current_fighters[2]["center"]

        distance = np.linalg.norm(
            blue_center - red_center
        )

        frame_data["fighter_distance_px"] = float(distance)

        frame_data["fighter_distance_percent_diagonal"] = float(
            (distance / frame_diagonal) * 100
        )

    else:

        frame_data["fighter_distance_px"] = None
        frame_data["fighter_distance_percent_diagonal"] = None

    # ======================================
    # 9. SAVE FRAME DATA
    # ======================================

    csv_rows.append(frame_data)

    writer.write(frame)

    frame_count += 1

    if frame_count % 100 == 0:
        print(f"Processed {frame_count} frames")

# ==========================================
# 10. EXPORT CSV
# ==========================================

cap.release()
writer.release()

if csv_rows:

    with open(output_csv, "w", newline="", encoding="utf-8") as file:

        writer_csv = csv.DictWriter(
            file,
            fieldnames=csv_rows[0].keys()
        )

        writer_csv.writeheader()
        writer_csv.writerows(csv_rows)

# Keypoint rows for the Pose Estimation stage, then the record that lets it
# reuse them (written last, so an interrupted pass is never reused).
if keypoint_rows:

    with open(keypoints_csv, "w", newline="") as file:

        writer_keypoints = csv.DictWriter(
            file,
            fieldnames=keypoint_rows[0].keys()
        )

        writer_keypoints.writeheader()
        writer_keypoints.writerows(keypoint_rows)

    pose_pass.write_provenance(
        RESULTS_DIR,
        pose_pass.provenance(video_path, DEVICE, frame_count)
    )

# ==========================================
# 11. FINAL RESULTS
# ==========================================

print("\nMovement analysis completed!")

print(f"Frames processed: {frame_count}")

print(
    f"Blue fighter total movement: "
    f"{total_movement[1]:.2f} pixels"
)

print(
    f"Red fighter total movement: "
    f"{total_movement[2]:.2f} pixels"
)

print(f"\nCSV dataset saved to: {output_csv}")
print(f"Annotated video saved to: {output_video}")