import os
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

INPUT = RESULTS_DIR / "refined_strike_candidates.csv"

OUTPUT_ALL = RESULTS_DIR / "classified_strike_candidates.csv"
OUTPUT_SELECTED = RESULTS_DIR / "final_strike_candidates.csv"
REPORT = RESULTS_DIR / "final_strike_report.txt"

if not INPUT.exists():
    raise FileNotFoundError(f"Refined candidates not found: {INPUT}")

df = pd.read_csv(INPUT)

# Classify candidates using kinematic score
def classify(score):
    if score >= 80:
        return "Very Strong"
    elif score >= 65:
        return "Strong"
    elif score >= 50:
        return "Review"
    return "Low"

df["detection_class"] = df["kinematic_score"].apply(classify)

# Keep only strong candidates for main results
selected = df[df["kinematic_score"] >= 65].copy()

# Sort by fighter and event time
selected = selected.sort_values(
    ["fighter", "peak_time"]
)

# Save both datasets
df.to_csv(OUTPUT_ALL, index=False)
selected.to_csv(OUTPUT_SELECTED, index=False)

# Generate report
lines = []

lines.append("MMA VISION - FINAL STRIKE DETECTION")
lines.append("=" * 45)

lines.append(f"Original candidates: {len(df)}")
lines.append(f"Selected candidates: {len(selected)}")
lines.append(f"Filtered candidates: {len(df) - len(selected)}")

lines.append("\nCLASSIFICATION COUNTS")

lines.append(
    df["detection_class"].value_counts().to_string()
)

lines.append("\nSELECTED EVENTS BY FIGHTER")

lines.append(
    selected["fighter"].value_counts().to_string()
)

lines.append("\nSELECTED EVENT TYPES")

lines.append(
    selected["event_type"].value_counts().to_string()
)

lines.append("\nSELECTED EVENTS")

if len(selected):
    lines.append(
        selected[
            [
                "fighter",
                "peak_time",
                "event_type",
                "limb",
                "kinematic_score",
                "detection_class"
            ]
        ].to_string(index=False)
    )
else:
    lines.append("No candidates passed the threshold.")

lines.append("\nNOTE:")
lines.append(
    "Scores are heuristic rankings, not probabilities."
)
lines.append(
    "Selected events are estimated striking actions, "
    "not automatically confirmed landed strikes."
)

report = "\n".join(lines)

REPORT.write_text(report, encoding="utf-8")

print(report)

print("\nFiles saved:")
print(OUTPUT_ALL)
print(OUTPUT_SELECTED)
print(REPORT)