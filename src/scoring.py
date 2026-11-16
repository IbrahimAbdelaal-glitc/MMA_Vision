import os
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

INPUT_FILE = RESULTS_DIR / "final_strike_candidates.csv"

OUTPUT_CSV = RESULTS_DIR / "experimental_scorecard.csv"
OUTPUT_REPORT = RESULTS_DIR / "experimental_scorecard_report.txt"

POINTS = {
    "Very Strong": 3,
    "Strong": 2,
    "Review": 0,
    "Low": 0
}


def main():

    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Input file not found: {INPUT_FILE}"
        )

    df = pd.read_csv(INPUT_FILE)

    required_columns = [
        "fighter",
        "event_type",
        "detection_class"
    ]

    missing = [
        col for col in required_columns
        if col not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing required columns: {missing}"
        )

    df["fighter"] = (
        df["fighter"]
        .astype(str)
        .str.lower()
        .str.strip()
    )

    df["detection_class"] = (
        df["detection_class"]
        .astype(str)
        .str.strip()
    )

    df["event_type"] = (
        df["event_type"]
        .astype(str)
        .str.lower()
        .str.strip()
    )

    unknown_fighters = set(df["fighter"]) - {"blue", "red"}

    if unknown_fighters:
        raise ValueError(
            f"Unexpected fighter labels: {unknown_fighters}"
        )

    unknown_classes = (
        set(df["detection_class"]) - set(POINTS.keys())
    )

    if unknown_classes:
        raise ValueError(
            f"Unexpected detection classes: {unknown_classes}"
        )

    df["points"] = df["detection_class"].map(POINTS)

    scorecard = []

    for fighter in ["blue", "red"]:

        fighter_df = df[df["fighter"] == fighter]

        very_strong = (
            fighter_df["detection_class"] == "Very Strong"
        ).sum()

        strong = (
            fighter_df["detection_class"] == "Strong"
        ).sum()

        punch_events = (
            fighter_df["event_type"] == "punch-like"
        ).sum()

        kick_events = (
            fighter_df["event_type"] == "kick-like"
        ).sum()

        total_events = len(fighter_df)

        total_points = int(fighter_df["points"].sum())

        scorecard.append({
            "fighter": fighter.capitalize(),
            "total_events": total_events,
            "punch_like": punch_events,
            "kick_like": kick_events,
            "strong_events": strong,
            "very_strong_events": very_strong,
            "activity_score": total_points
        })

    result = pd.DataFrame(scorecard)

    result.to_csv(OUTPUT_CSV, index=False)

    blue_score = int(
        result.loc[result["fighter"] == "Blue", "activity_score"].iloc[0]
    )

    red_score = int(
        result.loc[result["fighter"] == "Red", "activity_score"].iloc[0]
    )

    if blue_score > red_score:
        comparison = "BLUE has the higher experimental strike activity score."

    elif red_score > blue_score:
        comparison = "RED has the higher experimental strike activity score."

    else:
        comparison = "Both fighters have equal experimental strike activity scores."

    report = f"""
================================================
       MMA VISION - EXPERIMENTAL SCORECARD
================================================

SCORING RULES
------------------------------------------------
Very Strong event: 3 points
Strong event:      2 points
Review event:      0 points
Low event:         0 points

FIGHTER COMPARISON
------------------------------------------------

                 BLUE          RED

Total Events     {result.iloc[0]['total_events']:<13} {result.iloc[1]['total_events']}
Punch-like       {result.iloc[0]['punch_like']:<13} {result.iloc[1]['punch_like']}
Kick-like        {result.iloc[0]['kick_like']:<13} {result.iloc[1]['kick_like']}
Strong           {result.iloc[0]['strong_events']:<13} {result.iloc[1]['strong_events']}
Very Strong      {result.iloc[0]['very_strong_events']:<13} {result.iloc[1]['very_strong_events']}

------------------------------------------------
EXPERIMENTAL STRIKE ACTIVITY SCORE

BLUE: {blue_score}
RED:  {red_score}

{comparison}

================================================
IMPORTANT NOTE
================================================
This scorecard summarizes computer-vision strike
activity candidates using heuristic classifications.

It does not confirm physical contact, damage, or
official MMA judging criteria.

This is an experimental analysis tool, not an
official fight result.
================================================
"""

    OUTPUT_REPORT.write_text(
        report.strip(),
        encoding="utf-8"
    )

    print(report)

    print("\nFILES GENERATED")
    print("------------------------------")
    print(f"CSV report: {OUTPUT_CSV}")
    print(f"Text report: {OUTPUT_REPORT}")


if __name__ == "__main__":
    main()
