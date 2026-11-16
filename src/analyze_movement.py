import os
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

# ==========================================
# 1. PROJECT PATHS
# ==========================================

ROOT = Path(__file__).resolve().parents[1]

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

CHARTS_DIR = RESULTS_DIR / "charts"

INPUT_CSV = RESULTS_DIR / "movement_metrics.csv"

CHARTS_DIR.mkdir(parents=True, exist_ok=True)

if not INPUT_CSV.exists():
    raise FileNotFoundError(f"CSV not found: {INPUT_CSV}")

# ==========================================
# 2. LOAD DATASET
# ==========================================

df = pd.read_csv(INPUT_CSV)

print("Loaded movement dataset")
print(f"Frames: {len(df)}")
print(f"Columns: {len(df.columns)}")

# ==========================================
# 3. SMOOTH MOVEMENT DATA
# ==========================================

speed_columns = [
    "blue_movement_speed_px_s",
    "red_movement_speed_px_s",
    "blue_wrist_speed_px_s",
    "red_wrist_speed_px_s",
    "blue_ankle_speed_px_s",
    "red_ankle_speed_px_s",
]

# Preserve original measurements.
# Generate separate smoothed columns.
for column in speed_columns:

    values = df[column].interpolate(
        limit=6,
        limit_direction="both"
    )

    # Rolling median reduces isolated spikes.
    smoothed = values.rolling(
        window=9,
        center=True,
        min_periods=1
    ).median()

    # Rolling mean makes the chart easier to read.
    smoothed = smoothed.rolling(
        window=5,
        center=True,
        min_periods=1
    ).mean()

    df[f"{column}_smoothed"] = smoothed

# Smooth fighter distance separately.
df["fighter_distance_smoothed"] = (
    df["fighter_distance_px"]
    .rolling(window=9, center=True, min_periods=1)
    .median()
)

# ==========================================
# 4. SAVE CLEANED DATASET
# ==========================================

cleaned_csv = RESULTS_DIR / "movement_metrics_cleaned.csv"

df.to_csv(cleaned_csv, index=False)

print(f"\nCleaned dataset saved: {cleaned_csv}")

# ==========================================
# 5. CHART 1 - FIGHTER MOVEMENT SPEED
# ==========================================

plt.figure(figsize=(12, 5))

plt.plot(
    df["time_seconds"],
    df["blue_movement_speed_px_s_smoothed"],
    label="Blue Corner"
)

plt.plot(
    df["time_seconds"],
    df["red_movement_speed_px_s_smoothed"],
    label="Red Corner"
)

plt.title("Fighter Movement Speed")
plt.xlabel("Time (seconds)")
plt.ylabel("Movement Speed (pixels/second)")
plt.legend()
plt.grid(True)

plt.tight_layout()

plt.savefig(CHARTS_DIR / "fighter_movement_speed.png")
plt.close()

# ==========================================
# 6. CHART 2 - LIMB ACTIVITY
# ==========================================

plt.figure(figsize=(12, 5))

plt.plot(
    df["time_seconds"],
    df["blue_wrist_speed_px_s_smoothed"],
    label="Blue Wrist Activity"
)

plt.plot(
    df["time_seconds"],
    df["red_wrist_speed_px_s_smoothed"],
    label="Red Wrist Activity"
)

plt.title("Wrist Movement Activity")
plt.xlabel("Time (seconds)")
plt.ylabel("Wrist Speed (pixels/second)")
plt.legend()
plt.grid(True)

plt.tight_layout()

plt.savefig(CHARTS_DIR / "wrist_activity.png")
plt.close()

# ==========================================
# 7. CHART 3 - FIGHTER DISTANCE
# ==========================================

plt.figure(figsize=(12, 5))

plt.plot(
    df["time_seconds"],
    df["fighter_distance_smoothed"],
    label="Distance Between Fighters"
)

plt.title("Distance Between Fighters")
plt.xlabel("Time (seconds)")
plt.ylabel("Distance (pixels)")
plt.legend()
plt.grid(True)

plt.tight_layout()

plt.savefig(CHARTS_DIR / "fighter_distance.png")
plt.close()

# ==========================================
# 8. CHART 4 - CUMULATIVE MOVEMENT
# ==========================================

plt.figure(figsize=(12, 5))

plt.plot(
    df["time_seconds"],
    df["blue_total_movement_px"],
    label="Blue Corner"
)

plt.plot(
    df["time_seconds"],
    df["red_total_movement_px"],
    label="Red Corner"
)

plt.title("Cumulative Fighter Movement")
plt.xlabel("Time (seconds)")
plt.ylabel("Total Movement (pixels)")
plt.legend()
plt.grid(True)

plt.tight_layout()

plt.savefig(CHARTS_DIR / "cumulative_movement.png")
plt.close()

# ==========================================
# 9. GENERATE STATISTICS REPORT
# ==========================================

report = RESULTS_DIR / "movement_report.txt"

with open(report, "w", encoding="utf-8") as file:

    file.write("MMA VISION - MOVEMENT ANALYSIS REPORT\n")
    file.write("=" * 45 + "\n\n")

    file.write(f"Frames analyzed: {len(df)}\n")
    file.write(
        f"Video duration: {df['time_seconds'].iloc[-1]:.2f} seconds\n\n"
    )

    for fighter, prefix in [
        ("Blue Corner", "blue"),
        ("Red Corner", "red")
    ]:

        file.write(f"\n{fighter}\n")
        file.write("-" * 30 + "\n")

        for metric in [
            "movement_speed_px_s",
            "wrist_speed_px_s",
            "ankle_speed_px_s"
        ]:

            column = f"{prefix}_{metric}_smoothed"

            file.write(
                f"{metric}: "
                f"Median = {df[column].median():.2f} px/s | "
                f"95th percentile = {df[column].quantile(0.95):.2f} px/s\n"
            )

        total = df[f"{prefix}_total_movement_px"].iloc[-1]

        file.write(f"Total movement: {total:.2f} pixels\n")

    file.write("\nFIGHTER DISTANCE\n")
    file.write("-" * 30 + "\n")

    file.write(
        f"Average distance: {df['fighter_distance_px'].mean():.2f} pixels\n"
    )

    file.write(
        f"Minimum distance: {df['fighter_distance_px'].min():.2f} pixels\n"
    )

    file.write(
        f"Maximum distance: {df['fighter_distance_px'].max():.2f} pixels\n"
    )

print("\nANALYSIS COMPLETED!")
print(f"Charts saved in: {CHARTS_DIR}")
print(f"Statistics report: {report}")