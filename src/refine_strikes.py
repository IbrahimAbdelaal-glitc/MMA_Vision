import os
import pandas as pd
import numpy as np
from pathlib import Path

# ==============================
# PATHS
# ==============================

ROOT = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

INPUT = RESULTS_DIR / "temporal_strike_candidates.csv"

OUTPUT = RESULTS_DIR / "refined_strike_candidates.csv"
REPORT = RESULTS_DIR / "refined_strike_report.txt"

if not INPUT.exists():
    raise FileNotFoundError(f"Temporal candidates not found: {INPUT}")

# ==============================
# SETTINGS
# ==============================

MIN_EXTENSION = 0.0
MIN_ANGLE_GAIN = -5.0
MIN_CONFIDENCE = 0.85
MIN_EVENT_GAP = 0.35

# One kick moves both ankles: the kicking leg and the pivoting standing leg.
# A fighter cannot kick with both legs within MIN_EVENT_GAP, so kick-like
# candidates of one fighter on opposite legs that close together are one
# movement and only the stronger is kept (docs/validation.md, "One kick,
# several events"). Punches are not merged: a 1-2 is two strikes. Mirrored by
# live/constants.py CROSS_LEG_KICK_DUPLICATES.
CROSS_LEG_KICK_DUPLICATES = True

# ==============================
# LOAD DATA
# ==============================

df = pd.read_csv(INPUT)

original_count = len(df)

required_columns = [
    "fighter",
    "limb",
    "event_type",
    "peak_time",
    "peak_speed_px_s",
    "extension_gain",
    "angle_gain",
    "retraction",
    "keypoint_confidence"
]

missing = [c for c in required_columns if c not in df.columns]

if missing:
    raise ValueError(f"Missing columns: {missing}")

# Preserve original score separately
if "event_score" in df.columns:
    df = df.rename(columns={"event_score": "legacy_event_score"})

# ==============================
# BASIC QUALITY FILTERING
# ==============================

df["extension_gain"] = pd.to_numeric(
    df["extension_gain"], errors="coerce"
)

df["angle_gain"] = pd.to_numeric(
    df["angle_gain"], errors="coerce"
)

df["keypoint_confidence"] = pd.to_numeric(
    df["keypoint_confidence"], errors="coerce"
)

df["peak_speed_px_s"] = pd.to_numeric(
    df["peak_speed_px_s"], errors="coerce"
)

df["retraction"] = pd.to_numeric(
    df["retraction"], errors="coerce"
)

df = df.dropna(subset=required_columns)

after_missing = len(df)

# Apply evidence-based gates
df = df[
    (df["extension_gain"] > MIN_EXTENSION) &
    (df["angle_gain"] >= MIN_ANGLE_GAIN) &
    (df["keypoint_confidence"] >= MIN_CONFIDENCE)
].copy()

after_gates = len(df)

# ==============================
# NEW KINEMATIC SCORE
# ==============================

# Speed percentile within each fighter/limb/type group.
group_columns = ["fighter", "limb", "event_type"]

df["speed_component"] = (
    df.groupby(group_columns)["peak_speed_px_s"]
    .rank(pct=True) * 20
)

# Extension: stronger positive extension earns more points.
df["extension_component"] = (
    (df["extension_gain"].clip(0, 0.30) / 0.30) * 30
)

# Joint angle opening.
df["angle_component"] = (
    (df["angle_gain"].clip(0, 30) / 30) * 20
)

# Pose confidence.
df["confidence_component"] = (
    df["keypoint_confidence"] * 20
)

# Retraction is a small supporting feature.
# Negative values receive no points, but are not rejected.
df["retraction_component"] = (
    (df["retraction"].clip(0, 0.30) / 0.30) * 10
)

df["kinematic_score"] = (
    df["speed_component"] +
    df["extension_component"] +
    df["angle_component"] +
    df["confidence_component"] +
    df["retraction_component"]
).round(2)

# ==============================
# SAME-LIMB DUPLICATE REMOVAL
# ==============================

# Keep the strongest event when two events are too close.
df = df.sort_values(
    "kinematic_score",
    ascending=False
).copy()

kept_indices = []

for idx, row in df.iterrows():

    group = df.loc[
        kept_indices
    ] if kept_indices else pd.DataFrame()

    duplicate = False

    if not group.empty:

        if CROSS_LEG_KICK_DUPLICATES and row["event_type"] == "kick-like":
            same_limb = pd.Series(True, index=group.index)   # either leg
        else:
            same_limb = group["limb"] == row["limb"]

        same_group = group[
            (group["fighter"] == row["fighter"]) &
            same_limb &
            (group["event_type"] == row["event_type"])
        ]

        if not same_group.empty:

            gaps = abs(
                same_group["peak_time"] - row["peak_time"]
            )

            if (gaps < MIN_EVENT_GAP).any():
                duplicate = True

    if not duplicate:
        kept_indices.append(idx)

df = df.loc[kept_indices].copy()

after_dedup = len(df)

# ==============================
# PROVISIONAL LABELS
# ==============================

df["quality_label"] = np.where(
    df["kinematic_score"] >= 70,
    "High",
    "Medium"
)

# Explicitly identify these as movement candidates.
df["detection_label"] = "Strike-like movement candidate"

# Restore chronological order.
df = df.sort_values(
    ["fighter", "peak_time"]
).reset_index(drop=True)

# ==============================
# SAVE RESULTS
# ==============================

df.to_csv(OUTPUT, index=False)

# ==============================
# REPORT
# ==============================

lines = []

lines.append("MMA VISION - REFINED STRIKE DETECTION")
lines.append("=" * 45)

lines.append(f"Original events: {original_count}")
lines.append(f"After missing-value checks: {after_missing}")
lines.append(f"After quality gates: {after_gates}")
lines.append(f"After duplicate removal: {after_dedup}")

lines.append("")
lines.append("FINAL EVENT COUNTS")

for fighter in ["blue", "red"]:

    subset = df[df["fighter"] == fighter]

    lines.append(f"\n{fighter.upper()}")

    for event_type in ["punch-like", "kick-like"]:

        count = len(
            subset[subset["event_type"] == event_type]
        )

        lines.append(f"{event_type}: {count}")

    lines.append(
        f"High: {(subset['quality_label'] == 'High').sum()}"
    )

    lines.append(
        f"Medium: {(subset['quality_label'] == 'Medium').sum()}"
    )

lines.append("")
lines.append("QUALITY STATISTICS")

for col in [
    "kinematic_score",
    "peak_speed_px_s",
    "extension_gain",
    "angle_gain",
    "retraction",
    "keypoint_confidence"
]:

    lines.append(f"\n{col}")

    lines.append(
        df[col].describe().round(3).to_string()
    )

lines.append("")
lines.append("IMPORTANT:")
lines.append(
    "Scores are heuristic rankings, not probabilities."
)
lines.append(
    "Candidates are not confirmed landed strikes."
)

report_text = "\n".join(lines)

REPORT.write_text(report_text, encoding="utf-8")

print(report_text)

print("\nFiles saved:")
print(OUTPUT)
print(REPORT)