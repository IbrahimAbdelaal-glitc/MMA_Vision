import os
import pandas as pd
import numpy as np
from pathlib import Path

# Project paths
BASE_DIR = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", BASE_DIR / "results")
)

INPUT_FILE = RESULTS_DIR / "fighter_keypoints.csv"
OUTPUT_FILE = RESULTS_DIR / "joint_features.csv"

if not INPUT_FILE.exists():
    raise FileNotFoundError(f"Keypoint dataset not found: {INPUT_FILE}")

FPS = 60
CONFIDENCE_THRESHOLD = 0.35

df = pd.read_csv(INPUT_FILE)

# Ensure chronological order
df = df.sort_values(["fighter", "frame"]).reset_index(drop=True)


# Calculate angle between three points
def calculate_angle(a, b, c):

    if any(np.isnan(v) for v in [*a, *b, *c]):
        return np.nan

    a = np.array(a)
    b = np.array(b)
    c = np.array(c)

    ba = a - b
    bc = c - b

    denominator = np.linalg.norm(ba) * np.linalg.norm(bc)

    if denominator == 0:
        return np.nan

    cosine = np.dot(ba, bc) / denominator
    cosine = np.clip(cosine, -1.0, 1.0)

    return np.degrees(np.arccos(cosine))


# Get a valid joint position
def get_point(row, joint):

    confidence = row[f"{joint}_confidence"]

    if pd.isna(confidence) or confidence < CONFIDENCE_THRESHOLD:
        return None

    x = row[f"{joint}_x"]
    y = row[f"{joint}_y"]

    if pd.isna(x) or pd.isna(y):
        return None

    return (x, y)


# Calculate distance between two points
def distance(a, b):

    if a is None or b is None:
        return np.nan

    return np.linalg.norm(np.array(a) - np.array(b))


# Calculate joint features for each fighter
def process_fighter(group):

    group = group.copy()

    feature_columns = [
        "left_elbow_angle",
        "right_elbow_angle",
        "left_knee_angle",
        "right_knee_angle",
        "left_arm_extension",
        "right_arm_extension",
        "left_leg_extension",
        "right_leg_extension",
        "left_wrist_speed",
        "right_wrist_speed",
        "left_ankle_speed",
        "right_ankle_speed"
    ]

    for column in feature_columns:
        group[column] = np.nan

    previous_points = {}

    for index, row in group.iterrows():

        points = {
            joint: get_point(row, joint)
            for joint in [
                "left_shoulder", "right_shoulder",
                "left_elbow", "right_elbow",
                "left_wrist", "right_wrist",
                "left_hip", "right_hip",
                "left_knee", "right_knee",
                "left_ankle", "right_ankle"
            ]
        }

        # Elbow angles
        group.at[index, "left_elbow_angle"] = calculate_angle(
            points["left_shoulder"],
            points["left_elbow"],
            points["left_wrist"]
        ) if all(points[j] is not None for j in [
            "left_shoulder", "left_elbow", "left_wrist"
        ]) else np.nan

        group.at[index, "right_elbow_angle"] = calculate_angle(
            points["right_shoulder"],
            points["right_elbow"],
            points["right_wrist"]
        ) if all(points[j] is not None for j in [
            "right_shoulder", "right_elbow", "right_wrist"
        ]) else np.nan

        # Knee angles
        group.at[index, "left_knee_angle"] = calculate_angle(
            points["left_hip"],
            points["left_knee"],
            points["left_ankle"]
        ) if all(points[j] is not None for j in [
            "left_hip", "left_knee", "left_ankle"
        ]) else np.nan

        group.at[index, "right_knee_angle"] = calculate_angle(
            points["right_hip"],
            points["right_knee"],
            points["right_ankle"]
        ) if all(points[j] is not None for j in [
            "right_hip", "right_knee", "right_ankle"
        ]) else np.nan

        # Normalize limb extension by torso length
        left_torso = distance(
            points["left_shoulder"], points["left_hip"]
        )

        right_torso = distance(
            points["right_shoulder"], points["right_hip"]
        )

        if left_torso > 0 and not np.isnan(left_torso):
            group.at[index, "left_arm_extension"] = (
                distance(points["left_shoulder"], points["left_wrist"])
                / left_torso
            )

            group.at[index, "left_leg_extension"] = (
                distance(points["left_hip"], points["left_ankle"])
                / left_torso
            )

        if right_torso > 0 and not np.isnan(right_torso):
            group.at[index, "right_arm_extension"] = (
                distance(points["right_shoulder"], points["right_wrist"])
                / right_torso
            )

            group.at[index, "right_leg_extension"] = (
                distance(points["right_hip"], points["right_ankle"])
                / right_torso
            )

        # Individual wrist and ankle velocities
        for joint in [
            "left_wrist", "right_wrist",
            "left_ankle", "right_ankle"
        ]:

            previous = previous_points.get(joint)
            current = points[joint]

            speed = np.nan

            if previous is not None and current is not None:
                frame_difference = (
                    row["frame"] - previous["frame"]
                )

                if 0 < frame_difference <= 3:
                    time_difference = frame_difference / FPS

                    speed = (
                        distance(current, previous["point"])
                        / time_difference
                    )

            group.at[index, f"{joint.replace('_', '_')}_speed"] = speed

            previous_points[joint] = {
                "point": current,
                "frame": row["frame"]
            } if current is not None else None

    return group


# Process both fighters separately
processed = []

for fighter, group in df.groupby("fighter"):

    print(f"Analyzing {fighter} fighter...")

    processed.append(process_fighter(group))

# Combine results
result = pd.concat(processed).sort_values(
    ["frame", "fighter"]
)

result.to_csv(OUTPUT_FILE, index=False)

print("\nJoint feature analysis completed!")
print(f"Records analyzed: {len(result)}")
print(f"Output saved to: {OUTPUT_FILE}")

print("\nAverage joint angles:")

for fighter, group in result.groupby("fighter"):

    print(f"\n{fighter.upper()}")

    for column in [
        "left_elbow_angle",
        "right_elbow_angle",
        "left_knee_angle",
        "right_knee_angle"
    ]:
        print(f"{column}: {group[column].median():.2f} degrees")