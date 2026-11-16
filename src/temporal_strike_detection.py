import os
import pandas as pd
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", BASE_DIR / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

INPUT_FILE = RESULTS_DIR / "joint_features.csv"
OUTPUT_FILE = RESULTS_DIR / "temporal_strike_candidates.csv"
REPORT_FILE = RESULTS_DIR / "temporal_strike_report.txt"

if not INPUT_FILE.exists():
    raise FileNotFoundError(f"Joint features dataset not found: {INPUT_FILE}")

FPS = 60

MAX_VALID_SPEED = 3000
MIN_SPEED_THRESHOLD = 400

PRE_FRAMES = 8
POST_FRAMES = 12
MIN_PEAK_GAP = 15

df = pd.read_csv(INPUT_FILE)
df = df.sort_values(["fighter", "frame"]).reset_index(drop=True)

events = []


def safe_median(values):
    values = values.dropna()
    return values.median() if len(values) else np.nan


def analyze_limb(group, fighter, side, limb_type):

    if limb_type == "punch":

        speed_col = f"{side}_wrist_speed"
        extension_col = f"{side}_arm_extension"
        angle_col = f"{side}_elbow_angle"

        confidence_cols = [
            f"{side}_shoulder_confidence",
            f"{side}_elbow_confidence",
            f"{side}_wrist_confidence"
        ]

    else:

        speed_col = f"{side}_ankle_speed"
        extension_col = f"{side}_leg_extension"
        angle_col = f"{side}_knee_angle"

        confidence_cols = [
            f"{side}_hip_confidence",
            f"{side}_knee_confidence",
            f"{side}_ankle_confidence"
        ]

    data = group.copy().reset_index(drop=True)

    # Remove extreme velocities
    data.loc[
        (data[speed_col] > MAX_VALID_SPEED) |
        (data[speed_col] < 0),
        speed_col
    ] = np.nan

    # Smooth noisy measurements
    data["smooth_speed"] = (
        data[speed_col]
        .rolling(3, center=True, min_periods=2)
        .median()
    )

    data["smooth_extension"] = (
        data[extension_col]
        .rolling(3, center=True, min_periods=2)
        .median()
    )

    data["smooth_angle"] = (
        data[angle_col]
        .rolling(3, center=True, min_periods=2)
        .median()
    )

    # Adaptive speed threshold
    speed_threshold = max(
        MIN_SPEED_THRESHOLD,
        data["smooth_speed"].quantile(0.90)
    )

    # Identify local speed peaks
    peaks = []

    for i in range(2, len(data) - POST_FRAMES):

        speed = data.loc[i, "smooth_speed"]

        if pd.isna(speed) or speed < speed_threshold:
            continue

        nearby = data.loc[
            i - 2:i + 2, "smooth_speed"
        ].dropna()

        if len(nearby) == 0 or speed < nearby.max():
            continue

        peaks.append(i)

    # Avoid repeatedly detecting the same movement
    selected_peaks = []

    for peak in peaks:

        if (
            not selected_peaks or
            peak - selected_peaks[-1] >= MIN_PEAK_GAP
        ):
            selected_peaks.append(peak)

        elif (
            data.loc[peak, "smooth_speed"] >
            data.loc[selected_peaks[-1], "smooth_speed"]
        ):
            selected_peaks[-1] = peak

    # Analyze each movement sequence
    for peak in selected_peaks:

        start = max(0, peak - PRE_FRAMES)
        end = min(len(data) - 1, peak + POST_FRAMES)

        before_start = max(0, peak - 6)
        before_end = max(0, peak - 2)

        after_start = min(len(data) - 1, peak + 5)
        after_end = min(len(data) - 1, peak + 12)

        baseline_extension = safe_median(
            data.loc[before_start:before_end, extension_col]
        )

        peak_extension = safe_median(
            data.loc[peak - 1:peak + 2, extension_col]
        )

        post_extension = safe_median(
            data.loc[after_start:after_end, extension_col]
        )

        baseline_angle = safe_median(
            data.loc[before_start:before_end, angle_col]
        )

        peak_angle = safe_median(
            data.loc[peak - 1:peak + 2, angle_col]
        )

        if any(pd.isna(v) for v in [
            baseline_extension,
            peak_extension,
            baseline_angle,
            peak_angle
        ]):
            continue

        extension_gain = peak_extension - baseline_extension
        angle_gain = peak_angle - baseline_angle

        # Retraction evidence
        if pd.notna(post_extension):
            retraction = peak_extension - post_extension
        else:
            retraction = np.nan

        # Confidence in the relevant keypoints
        keypoint_confidence = data.loc[
            peak - 1:peak + 2,
            confidence_cols
        ].mean().mean()

        if pd.isna(keypoint_confidence):
            keypoint_confidence = 0

        # Score individual characteristics
        speed_score = min(
            25,
            25 * data.loc[peak, "smooth_speed"] /
            max(speed_threshold, 1)
        )

        extension_score = (
            25 if extension_gain >= 0.04 else 0
        )

        angle_score = (
            20 if angle_gain >= 8 else 0
        )

        retraction_score = (
            20 if pd.notna(retraction) and retraction >= 0.03
            else 0
        )

        confidence_score = 10 * min(
            1,
            max(0, keypoint_confidence)
        )

        total_score = (
            speed_score +
            extension_score +
            angle_score +
            retraction_score +
            confidence_score
        )

        # Preserve every candidate for inspection
        if total_score >= 35:

            if total_score >= 70:
                confidence_label = "High"
            elif total_score >= 50:
                confidence_label = "Medium"
            else:
                confidence_label = "Low"

            events.append({

                "fighter": fighter,
                "limb": side,

                "event_type": (
                    "punch-like" if limb_type == "punch"
                    else "kick-like"
                ),

                "start_time": data.loc[start, "time_seconds"],
                "peak_time": data.loc[peak, "time_seconds"],
                "end_time": data.loc[end, "time_seconds"],

                "peak_speed_px_s": data.loc[
                    peak, "smooth_speed"
                ],

                "extension_gain": extension_gain,
                "angle_gain": angle_gain,
                "retraction": retraction,

                "keypoint_confidence": keypoint_confidence,

                "event_score": total_score,
                "confidence_label": confidence_label,

                "speed_threshold": speed_threshold

            })


# Analyze both fighters
for fighter, group in df.groupby("fighter"):

    print(f"\nAnalyzing {fighter.upper()} fighter...")

    for side in ["left", "right"]:

        analyze_limb(group, fighter, side, "punch")
        analyze_limb(group, fighter, side, "kick")


# Save results
events_df = pd.DataFrame(events)

if not events_df.empty:

    events_df = events_df.sort_values(
        ["fighter", "peak_time"]
    )

    events_df.to_csv(OUTPUT_FILE, index=False)

    report = [
        "MMA VISION - TEMPORAL STRIKE DETECTION",
        "=" * 45
    ]

    for fighter in ["blue", "red"]:

        subset = events_df[
            events_df["fighter"] == fighter
        ]

        report.append(f"\n{fighter.upper()} FIGHTER")

        for event_type in ["punch-like", "kick-like"]:

            selected = subset[
                subset["event_type"] == event_type
            ]

            report.append(
                f"{event_type}: {len(selected)}"
            )

        for level in ["High", "Medium", "Low"]:

            count = len(
                subset[subset["confidence_label"] == level]
            )

            report.append(
                f"{level} confidence: {count}"
            )

    report.append(
        f"\nTotal candidate events: {len(events_df)}"
    )

    report_text = "\n".join(report)

else:

    report_text = "No temporal candidate events detected."

REPORT_FILE.write_text(report_text, encoding="utf-8")

print("\n" + report_text)

print(f"\nResults saved to: {OUTPUT_FILE}")
print(f"Report saved to: {REPORT_FILE}")