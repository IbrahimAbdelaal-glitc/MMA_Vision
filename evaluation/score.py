"""Score any detector output against reviewed ground truth.

evaluation.metrics scores the one event list a reviewer labelled. To compare
detectors (offline candidates, live events at 1x, a replay with a rule
changed) without labelling each again, this module turns a *complete* review
into a ground-truth list of strike-like movements and matches any event list
against it in time.

Ground truth from a review (missed_events_complete must be true):
  * a "correct" event      -> a movement of its type at true_t (or its time)
  * a "wrong_type" event   -> a movement of the reviewer's actual type
  * every missed event     -> a movement of its type
  * an "uncertain" event   -> an ignore zone: detections there count nowhere
  * an unreviewed event    -> the review is refused: every event needs a verdict
  "false_positive" and "duplicate" events add nothing.

Matching (same fighter; each truth matched once, nearest first):
  * a detection within TOLERANCE of an unmatched truth of its type -> correct
  * ... of a truth of the other type only                           -> wrong type
  * within TOLERANCE of an already matched truth                    -> duplicate
  * within TOLERANCE of an ignore zone                              -> ignored
  * otherwise                                                       -> false positive
  * a truth no detection matched                                    -> missed

Fighter labels must agree: truth uses the Blue/Red labels of the reviewed
output. Live and offline usually agree (see the identity check); if a system
labelled the fighters the other way round, every event counts as wrong.

Layout of a reusable dataset (validation/ is git-ignored: footage stays local):

    validation/datasets/<clip>/
        manifest.json         video file, fps, duration, provenance (python -m evaluation.score init)
        truth.json            a complete review.html export, used as ground truth
        reviews/*.json        optional further reviews (inter-reviewer agreement)
        detections/<name>.csv event lists to score (live events.csv, offline
                              classified_strike_candidates.csv, live.replay output)

    python -m evaluation.score dataset validation/datasets [--tolerance 0.25] [--out report.json]
    python -m evaluation.score file --truth truth.json --detections events.csv
    python -m evaluation.score init --video clip.mp4 --name clip01 [--root validation/datasets]
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path
from typing import Optional

from evaluation.metrics import (FIGHTERS, MIN_EVENTS_FOR_CLAIMS, MIN_MINUTES_FOR_CLAIMS, TYPES,
                                _empty, _finish, load as load_reviews, render)

# Seconds between a detection's peak and the reviewer's moment for them to be
# the same movement. A matching rule (one strike lasts about 0.3-0.5 s), not a
# tuned value: report results at the tolerance you choose (--tolerance).
TOLERANCE = 0.25


class IncompleteReview(ValueError):
    pass


# ------------------------------------------------------------------- truth
def truth_from_review(review: dict) -> dict:
    if not review.get("missed_events_complete"):
        raise IncompleteReview(
            "this review did not search the whole video for missed events, so it cannot serve as ground "
            "truth (tick 'I searched the whole video for missed events' in review.html)")
    unreviewed = sum(1 for e in review.get("events", []) if (e.get("verdict") or "unreviewed") == "unreviewed")
    if unreviewed:
        # An unlabelled event may be a real movement: with it missing from the truth,
        # other detectors' hits there would count as false positives and recall would
        # be computed over the labelled part only (found by the end-to-end test).
        raise IncompleteReview(
            f"{unreviewed} event(s) of this review have no verdict; ground truth needs every event "
            "labelled (Uncertain is a verdict)")
    movements, ignore = [], []
    for e in review.get("events", []):
        verdict = e.get("verdict") or "unreviewed"
        t = float(e["true_t"]) if e.get("true_t") is not None else float(e["t"])
        fighter = (e.get("fighter") or "").lower()
        if verdict == "correct":
            movements.append({"t": t, "fighter": fighter, "type": e.get("type")})
        elif verdict == "wrong_type" and e.get("actual") in TYPES:
            movements.append({"t": t, "fighter": fighter, "type": e["actual"]})
        elif verdict == "uncertain" or (verdict == "wrong_type" and e.get("actual") not in TYPES):
            ignore.append({"t": t, "fighter": fighter})
    for m in review.get("missed", []):
        movements.append({"t": float(m["t"]), "fighter": (m.get("fighter") or "").lower(), "type": m.get("type")})
    return {"movements": sorted(movements, key=lambda m: m["t"]), "ignore": ignore,
            "duration": float(review.get("video", {}).get("duration") or 0.0),
            "video": review.get("video", {}).get("name")}


# -------------------------------------------------------------- detections
def load_detections(path: Path) -> list:
    """Live events.csv, offline classified/final candidates, or live.replay output."""
    out = []
    with Path(path).open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("offline_match") == "offline_only":
                continue                       # a replay's unmatched offline rows are not its events
            raw_t = row.get("peak_t") or row.get("peak_time") or row.get("t")
            if not raw_t:
                continue
            out.append({"t": float(raw_t),
                        "fighter": (row.get("corner") or row.get("fighter") or "").lower(),
                        "type": (row.get("type") or row.get("event_type") or "").lower()})
    return sorted(out, key=lambda d: d["t"])


# ------------------------------------------------------------------ scoring
def score(detections: list, truth: dict, tolerance: float = TOLERANCE) -> dict:
    """Counts and metrics in the shape evaluation.metrics produces."""
    overall, agnostic = _empty(), _empty()
    by_fighter = {f: _empty() for f in FIGHTERS}
    by_type = {t: _empty() for t in TYPES}
    movements = truth["movements"]
    matched = [False] * len(movements)

    def buckets(fighter, kind):
        return [overall, by_fighter.get(fighter, _empty()), by_type.get(kind, _empty())]

    # Nearest pairs first, so a detection between two movements takes the closer one.
    pairs = sorted(
        (abs(d["t"] - m["t"]), i, j)
        for i, d in enumerate(detections) for j, m in enumerate(movements)
        if d["fighter"] == m["fighter"] and d["type"] == m["type"] and abs(d["t"] - m["t"]) <= tolerance + 1e-9)
    outcome: list = [None] * len(detections)
    for gap, i, j in pairs:
        if outcome[i] is None and not matched[j]:
            outcome[i], matched[j] = ("correct", j), True

    for i, d in enumerate(detections):
        if outcome[i] is not None:
            continue
        near = [j for j, m in enumerate(movements)
                if m["fighter"] == d["fighter"] and abs(m["t"] - d["t"]) <= tolerance + 1e-9]
        same_type = [j for j in near if movements[j]["type"] == d["type"]]
        other_free = [j for j in near if movements[j]["type"] != d["type"] and not matched[j]]
        if same_type:
            outcome[i] = ("duplicate", None)
        elif other_free:
            j = min(other_free, key=lambda j: abs(movements[j]["t"] - d["t"]))
            matched[j] = True
            outcome[i] = ("wrong_type", j)
        elif any(z["fighter"] == d["fighter"] and abs(z["t"] - d["t"]) <= tolerance + 1e-9 for z in truth["ignore"]):
            outcome[i] = ("ignored", None)
        else:
            outcome[i] = ("false_positive", None)

    for i, d in enumerate(detections):
        kind, j = outcome[i]
        if kind == "ignored":
            for b in buckets(d["fighter"], d["type"]) + [agnostic]:
                b["uncertain"] += 1
            continue
        key = {"correct": "correct", "wrong_type": "wrong_type", "duplicate": "duplicates",
               "false_positive": "false_positives"}[kind]
        for b in buckets(d["fighter"], d["type"]):
            b[key] += 1
        agnostic["correct" if kind == "wrong_type" else key] += 1
        if kind == "wrong_type":
            by_type.get(movements[j]["type"], _empty())["missed"] += 1
        if kind == "correct":
            error = d["t"] - movements[j]["t"]
            for b in buckets(d["fighter"], d["type"]) + [agnostic]:
                b["_errors"].append(error)

    for j, m in enumerate(movements):
        if not matched[j]:
            for b in buckets(m["fighter"], m["type"]) + [agnostic]:
                b["missed"] += 1

    return {"overall": overall, "type_agnostic": agnostic, "by_fighter": by_fighter, "by_type": by_type}


def _merge(total: Optional[dict], part: dict) -> dict:
    if total is None:
        return json.loads(json.dumps(part))
    def add(a, b):
        for k, v in b.items():
            a[k] = a[k] + v if k != "_errors" else a[k] + list(v)
    add(total["overall"], part["overall"])
    add(total["type_agnostic"], part["type_agnostic"])
    for f in FIGHTERS:
        add(total["by_fighter"][f], part["by_fighter"][f])
    for t in TYPES:
        add(total["by_type"][t], part["by_type"][t])
    return total


def finish(counts: dict, minutes: float, clips: int, tolerance: float) -> dict:
    result = {
        "videos": clips,
        "reviewed_minutes": minutes,
        "missed_events_complete": True,
        "tolerance_s": tolerance,
        "overall": _finish(counts["overall"], minutes, True),
        "type_agnostic": _finish(counts["type_agnostic"], minutes, True),
        "by_fighter": {f: _finish(c, minutes, True) for f, c in counts["by_fighter"].items()},
        "by_type": {t: _finish(c, minutes, True) for t, c in counts["by_type"].items()},
    }
    reviewed = result["overall"]["reviewed_detections"]
    enough = reviewed >= MIN_EVENTS_FOR_CLAIMS and minutes >= MIN_MINUTES_FOR_CLAIMS
    result["sufficient_for_claims"] = enough
    result["verdict"] = (
        f"Measured on {reviewed} detections over {minutes:.1f} min of labelled video."
        if enough else
        f"Real-world accuracy is not yet established: {reviewed} detections over {minutes:.1f} min of "
        f"labelled video (a claim needs at least {MIN_EVENTS_FOR_CLAIMS} and {MIN_MINUTES_FOR_CLAIMS:.0f} min). "
        "The numbers below describe this sample only.")
    return result


# ------------------------------------------------------------------ dataset
def score_dataset(root: Path, tolerance: float = TOLERANCE) -> dict:
    """{detector name: result} over every clip that has truth.json and detections/<name>.csv."""
    totals: dict = {}
    minutes: dict = {}
    clips: dict = {}
    skipped = []
    for clip in sorted(p for p in Path(root).iterdir() if p.is_dir()):
        truth_file = clip / "truth.json"
        if not truth_file.is_file():
            skipped.append(f"{clip.name}: no truth.json")
            continue
        try:
            truth = truth_from_review(load_reviews([truth_file])[0])
        except IncompleteReview as error:
            skipped.append(f"{clip.name}: {error}")
            continue
        for detections_file in sorted((clip / "detections").glob("*.csv")):
            name = detections_file.stem
            totals[name] = _merge(totals.get(name), score(load_detections(detections_file), truth, tolerance))
            minutes[name] = minutes.get(name, 0.0) + truth["duration"] / 60.0
            clips[name] = clips.get(name, 0) + 1
    results = {name: finish(totals[name], minutes[name], clips[name], tolerance) for name in sorted(totals)}
    return {"detectors": results, "skipped": skipped}


def init_clip(video: Path, name: str, root: Path, copy: bool = False) -> Path:
    import cv2
    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()
    folder = Path(root) / name
    (folder / "detections").mkdir(parents=True, exist_ok=True)
    (folder / "reviews").mkdir(exist_ok=True)
    target = video
    if copy:
        target = folder / Path(video).name
        shutil.copy2(video, target)
    manifest = {
        "name": name,
        "video": str(Path(target).resolve()),
        "fps": fps,
        "frames": frames,
        "duration_seconds": round(frames / fps, 3) if fps else None,
        "source": "", "rights": "", "camera": "", "fighters": {"blue": "", "red": ""},
        "notes": "Fill in where the footage comes from and that you may use it. Footage stays out of git.",
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return folder


# ---------------------------------------------------------------------- cli
def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evaluation.score", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    ds = sub.add_parser("dataset", help="score every detections/*.csv of every clip against its truth.json")
    ds.add_argument("root", type=Path)
    ds.add_argument("--tolerance", type=float, default=TOLERANCE)
    ds.add_argument("--out", type=Path, default=None)
    fl = sub.add_parser("file", help="score one event list against one complete review")
    fl.add_argument("--truth", type=Path, required=True)
    fl.add_argument("--detections", type=Path, required=True)
    fl.add_argument("--tolerance", type=float, default=TOLERANCE)
    fl.add_argument("--out", type=Path, default=None)
    it = sub.add_parser("init", help="create validation/datasets/<name>/ for a video")
    it.add_argument("--video", type=Path, required=True)
    it.add_argument("--name", required=True)
    it.add_argument("--root", type=Path, default=Path("validation") / "datasets")
    it.add_argument("--copy", action="store_true", help="copy the video into the clip folder")
    args = parser.parse_args(argv)

    if args.command == "init":
        folder = init_clip(args.video, args.name, args.root, args.copy)
        print(f"Created {folder}. Next: review events in evaluation/review.html, export the complete review "
              f"as {folder / 'truth.json'}, and put event lists to score in {folder / 'detections'}.")
        return 0

    if args.command == "file":
        try:
            truth = truth_from_review(load_reviews([args.truth])[0])
        except IncompleteReview as error:
            print(f"Cannot score: {error}", file=sys.stderr)
            return 2
        result = finish(score(load_detections(args.detections), truth, args.tolerance),
                        truth["duration"] / 60.0, 1, args.tolerance)
        print(render(result))
        out = result
    else:
        out = score_dataset(args.root, args.tolerance)
        if not out["detectors"]:
            print("No clip has both truth.json and detections/*.csv yet.")
        for name, result in out["detectors"].items():
            print(f"== {name}  (tolerance {args.tolerance:.2f} s, {result['videos']} clip(s))")
            print(render(result))
            print()
        for line in out["skipped"]:
            print(f"skipped {line}")
    if args.out:
        args.out.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
