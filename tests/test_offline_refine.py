"""refine_strikes.py duplicate removal, run as the pipeline runs it (a script).

Regression for "one kick, several events" (docs/validation.md): kick-like
candidates of one fighter on opposite legs within 0.35 s are one movement.
"""

import csv
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

COLUMNS = ["fighter", "limb", "event_type", "peak_time", "peak_speed_px_s", "extension_gain",
           "angle_gain", "retraction", "keypoint_confidence", "event_score"]


def candidate(fighter, limb, kind, t, extension=0.2, speed=1500.0):
    return {"fighter": fighter, "limb": limb, "event_type": kind, "peak_time": t,
            "peak_speed_px_s": speed, "extension_gain": extension, "angle_gain": 20.0,
            "retraction": 0.1, "keypoint_confidence": 0.95, "event_score": 60}


def refine(tmp_path, rows):
    with (tmp_path / "temporal_strike_candidates.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    env = {**os.environ, "MMA_RESULTS_DIR": str(tmp_path)}
    subprocess.run([sys.executable, str(ROOT / "src" / "refine_strikes.py")], cwd=ROOT, env=env,
                   check=True, capture_output=True)
    with (tmp_path / "refined_strike_candidates.csv").open(encoding="utf-8") as handle:
        return [(r["fighter"], r["limb"], r["event_type"], float(r["peak_time"])) for r in csv.DictReader(handle)]


def test_opposite_leg_kicks_within_035_s_keep_only_the_stronger(tmp_path):
    rows = [candidate("red", "right", "kick-like", 11.0167, extension=0.12),
            candidate("red", "left", "kick-like", 11.2333, extension=0.30)]

    assert refine(tmp_path, rows) == [("red", "left", "kick-like", 11.2333)]


def test_opposite_leg_kicks_further_apart_are_both_kept(tmp_path):
    rows = [candidate("red", "right", "kick-like", 11.0),
            candidate("red", "left", "kick-like", 11.5)]

    assert len(refine(tmp_path, rows)) == 2


def test_kicks_of_different_fighters_are_never_merged(tmp_path):
    rows = [candidate("red", "right", "kick-like", 11.0),
            candidate("blue", "left", "kick-like", 11.1)]

    assert len(refine(tmp_path, rows)) == 2


def test_punches_on_both_arms_within_035_s_are_both_kept(tmp_path):
    # A 1-2 combination is two strikes.
    rows = [candidate("blue", "left", "punch-like", 2.0),
            candidate("blue", "right", "punch-like", 2.2)]

    assert len(refine(tmp_path, rows)) == 2


def test_same_limb_duplicates_are_still_removed(tmp_path):
    rows = [candidate("blue", "right", "punch-like", 2.0, extension=0.25),
            candidate("blue", "right", "punch-like", 2.2, extension=0.10)]

    assert refine(tmp_path, rows) == [("blue", "right", "punch-like", 2.0)]


def test_a_one_two_one_combination_keeps_three_punches(tmp_path):
    rows = [candidate("blue", "right", "punch-like", 2.0),
            candidate("blue", "left", "punch-like", 2.2),
            candidate("blue", "right", "punch-like", 2.4)]

    assert len(refine(tmp_path, rows)) == 3


def test_three_alternating_kicks_half_a_second_apart_are_all_kept(tmp_path):
    rows = [candidate("red", "right", "kick-like", 5.0),
            candidate("red", "left", "kick-like", 5.5),
            candidate("red", "right", "kick-like", 6.0)]

    assert [r[1] for r in sorted(refine(tmp_path, rows), key=lambda r: r[3])] == ["right", "left", "right"]


def test_a_kick_and_a_punch_at_the_same_moment_are_both_kept(tmp_path):
    rows = [candidate("red", "left", "kick-like", 5.0),
            candidate("red", "right", "punch-like", 5.05)]

    assert len(refine(tmp_path, rows)) == 2
