import os
import cv2
import pandas as pd
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_PATH = os.environ.get("MMA_VIDEO_PATH")

CANDIDATES = RESULTS_DIR / "classified_strike_candidates.csv"
KEYPOINTS = RESULTS_DIR / "joint_features.csv"

OUTPUT = RESULTS_DIR / "opponent_direction_analysis.csv"
REPORT = RESULTS_DIR / "opponent_direction_report.txt"


def normalize_fighter(value):
    value = str(value).strip().lower()

    if "blue" in value:
        return "blue"
    if "red" in value:
        return "red"

    return value


def get_torso_center(row):
    points = []

    for joint in [
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip"
    ]:
        x = row.get(f"{joint}_x", np.nan)
        y = row.get(f"{joint}_y", np.nan)
        confidence = row.get(f"{joint}_confidence", 1)

        if (
            pd.notna(x)
            and pd.notna(y)
            and pd.notna(confidence)
            and confidence >= 0.3
        ):
            points.append((float(x), float(y)))

    if not points:
        return None

    return np.mean(points, axis=0)


def get_endpoint(row, side, event_type):
    if "punch" in event_type:
        joint = f"{side}_wrist"
    else:
        joint = f"{side}_ankle"

    x = row.get(f"{joint}_x", np.nan)
    y = row.get(f"{joint}_y", np.nan)
    confidence = row.get(f"{joint}_confidence", 0)

    if pd.isna(x) or pd.isna(y) or pd.isna(confidence):
        return None

    if confidence < 0.3:
        return None

    return np.array([float(x), float(y)])


def analyze_event(event, data, fps):
    fighter = normalize_fighter(event["fighter"])
    opponent = "red" if fighter == "blue" else "blue"

    peak_frame = int(round(float(event["peak_time"]) * fps))

    side = str(event["limb"]).lower()
    event_type = str(event["event_type"]).lower()

    distances = []
    endpoint_positions = []
    opponent_positions = []

    for frame in range(peak_frame - 8, peak_frame + 4):

        current = data[data["frame"] == frame]

        fighter_rows = current[
            current["fighter_normalized"] == fighter
        ]

        opponent_rows = current[
            current["fighter_normalized"] == opponent
        ]

        if fighter_rows.empty or opponent_rows.empty:
            continue

        fighter_row = fighter_rows.iloc[0]
        opponent_row = opponent_rows.iloc[0]

        endpoint = get_endpoint(
            fighter_row, side, event_type
        )

        opponent_center = get_torso_center(opponent_row)

        if endpoint is None or opponent_center is None:
            continue

        distance = np.linalg.norm(
            opponent_center - endpoint
        )

        distances.append((frame, distance))
        endpoint_positions.append((frame, endpoint))
        opponent_positions.append((frame, opponent_center))

    if len(distances) < 4:
        return {
            "approach_change_px": np.nan,
            "direction_alignment": np.nan,
            "valid_samples": len(distances)
        }

    early_distances = [
        d for f, d in distances
        if peak_frame - 8 <= f <= peak_frame - 3
    ]

    peak_distances = [
        d for f, d in distances
        if peak_frame - 1 <= f <= peak_frame + 1
    ]

    if not early_distances or not peak_distances:
        approach_change = np.nan
    else:
        approach_change = (
            np.median(early_distances)
            - np.median(peak_distances)
        )

    early_points = [
        (p, o)
        for f, p in endpoint_positions
        for of, o in opponent_positions
        if f == of and peak_frame - 8 <= f <= peak_frame - 3
    ]

    peak_points = [
        (p, o)
        for f, p in endpoint_positions
        for of, o in opponent_positions
        if f == of and peak_frame - 1 <= f <= peak_frame + 1
    ]

    alignment = np.nan

    if early_points and peak_points:
        start_endpoint = np.mean(
            [p for p, o in early_points], axis=0
        )

        start_opponent = np.mean(
            [o for p, o in early_points], axis=0
        )

        end_endpoint = np.mean(
            [p for p, o in peak_points], axis=0
        )

        movement = end_endpoint - start_endpoint
        target_direction = start_opponent - start_endpoint

        movement_norm = np.linalg.norm(movement)
        target_norm = np.linalg.norm(target_direction)

        if movement_norm > 0 and target_norm > 0:
            alignment = np.dot(
                movement / movement_norm,
                target_direction / target_norm
            )

    return {
        "approach_change_px": approach_change,
        "direction_alignment": alignment,
        "valid_samples": len(distances)
    }


def main():

    # Resolve input video
    if VIDEO_PATH:
        video_path = Path(VIDEO_PATH)
    else:
        video_dir = ROOT / "videos" / "input"
        videos = list(video_dir.glob("*.mp4"))

        if not videos:
            raise FileNotFoundError(
                "No input MP4 video found in videos/input."
            )

        if len(videos) > 1:
            raise RuntimeError(
                "Multiple MP4 files found. Specify MMA_VIDEO_PATH."
            )

        video_path = videos[0]

    if not video_path.exists():
        raise FileNotFoundError(
            f"Input video not found: {video_path}"
        )

    # Check required datasets
    if not CANDIDATES.exists():
        raise FileNotFoundError(
            f"Candidate file not found: {CANDIDATES}"
        )

    if not KEYPOINTS.exists():
        raise FileNotFoundError(
            f"Keypoint file not found: {KEYPOINTS}"
        )

    # Read video FPS
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()

    if fps <= 0:
        raise ValueError("Could not read valid FPS from video.")

    print(f"Video: {video_path.name}")
    print(f"FPS: {fps:.2f}")

    # Load datasets
    candidates = pd.read_csv(CANDIDATES)
    keypoints = pd.read_csv(KEYPOINTS)

    required_candidate_columns = [
        "fighter",
        "peak_time",
        "event_type",
        "limb",
        "detection_class"
    ]

    missing_candidates = [
        col for col in required_candidate_columns
        if col not in candidates.columns
    ]

    if missing_candidates:
        raise ValueError(
            f"Candidate file is missing columns: {missing_candidates}"
        )

    required_keypoint_columns = [
        "frame",
        "fighter",
        "left_shoulder_x",
        "left_shoulder_y",
        "right_shoulder_x",
        "right_shoulder_y",
        "left_hip_x",
        "left_hip_y",
        "right_hip_x",
        "right_hip_y"
    ]

    missing_keypoints = [
        col for col in required_keypoint_columns
        if col not in keypoints.columns
    ]

    if missing_keypoints:
        raise ValueError(
            f"Keypoint file is missing columns: {missing_keypoints}"
        )

    keypoints["fighter_normalized"] = (
        keypoints["fighter"].apply(normalize_fighter)
    )

    results = []

    print("\nAnalyzing candidate events...")

    for index, event in candidates.iterrows():

        features = analyze_event(event, keypoints, fps)

        result = event.to_dict()
        result.update(features)
        results.append(result)

        print(
            f"Processed event {index + 1}/{len(candidates)}",
            end="\r"
        )

    # Save analysis CSV
    output = pd.DataFrame(results)
    output.to_csv(OUTPUT, index=False)

    # Generate report
    report_lines = [
        "MMA VISION - OPPONENT DIRECTION ANALYSIS",
        "=" * 45,
        f"Events analyzed: {len(output)}",
        "",
        "APPROACH CHANGE",
        "Positive = endpoint moved closer to opponent.",
        "Negative = endpoint moved farther away.",
        "",
        "DIRECTION ALIGNMENT",
        "Closer to +1 = movement toward opponent.",
        "Around 0 = sideways movement.",
        "Closer to -1 = movement away from opponent.",
        ""
    ]

    for category in ["Very Strong", "Strong", "Review", "Low"]:

        subset = output[
            output["detection_class"] == category
        ]

        if subset.empty:
            continue

        report_lines.extend([
            category,
            "-" * 25,
            f"Events: {len(subset)}",
            f"Average approach change: "
            f"{subset['approach_change_px'].mean():.2f} px",
            f"Average direction alignment: "
            f"{subset['direction_alignment'].mean():.3f}",
            f"Average valid samples: "
            f"{subset['valid_samples'].mean():.2f}",
            ""
        ])

    report_text = "\n".join(report_lines)

    REPORT.write_text(report_text, encoding="utf-8")

    print("\n\n" + report_text)
    print(f"\nCSV saved: {OUTPUT}")
    print(f"Report saved: {REPORT}")


if __name__ == "__main__":
    main()
