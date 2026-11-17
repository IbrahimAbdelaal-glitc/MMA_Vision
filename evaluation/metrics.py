"""Accuracy of strike-like event detection against a reviewer's labels.

    python -m evaluation.metrics review1.json [review2.json ...] [--out report.json]

Input: exports of evaluation/review.html (JSON, or its CSV export). Each
detected event carries the reviewer's verdict; missed events are added by the
reviewer. Definitions (docs/validation.md):

* correct        a real movement of the reported type, by the reported fighter
* wrong_type     a real strike-like movement, but the other type
* false_positive no strike-like movement (footwork, guard, feint, ...)
* duplicate      the same movement already counted by another event
* uncertain      the reviewer cannot tell: counted in neither direction
* unreviewed     not looked at yet: counted in neither direction

precision = correct / (correct + wrong_type + false_positive + duplicate)
recall    = correct / (correct + missed + wrong_type)    (a wrong type also misses the real type)
Recall and F1 are withheld unless the reviewer searched the whole video for
missed events (missed_events_complete). Nothing here estimates accuracy that
was not labelled; below MIN_EVENTS_FOR_CLAIMS reviewed events or
MIN_MINUTES_FOR_CLAIMS minutes of reviewed video the report says real-world
accuracy is not yet established.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path
from typing import Iterable, Optional

VERDICTS = ("correct", "wrong_type", "false_positive", "duplicate", "uncertain", "unreviewed")
TYPES = ("punch-like", "kick-like")
FIGHTERS = ("blue", "red")

# A reporting rule, not a statistical guarantee: below these the numbers are
# shown as counts from a small sample and no accuracy claim is made.
MIN_EVENTS_FOR_CLAIMS = 100
MIN_MINUTES_FOR_CLAIMS = 10.0


# --------------------------------------------------------------------- load
def _csv_review(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    meta = {}
    if lines and lines[0].startswith("#"):
        for part in lines[0][1:].strip().split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                meta[k.strip()] = v.strip()
        lines = lines[1:]
    events, missed = [], []
    for row in csv.DictReader(lines):
        true_t = float(row["true_t"]) if row.get("true_t") else None
        if row["row_kind"] == "missed":
            missed.append({"t": float(row["t"]), "fighter": row["fighter"], "type": row["type"],
                           "notes": row.get("notes", "")})
        else:
            events.append({"id": row["id"], "t": float(row["t"]), "fighter": row["fighter"],
                           "side": row.get("side"), "type": row["type"], "verdict": row["verdict"] or "unreviewed",
                           "actual": row.get("actual") or None, "true_t": true_t, "notes": row.get("notes", "")})
    return {"video": {"name": meta.get("video"), "size": meta.get("size"),
                      "duration": float(meta["duration"]) if meta.get("duration") else None},
            "source": {"name": meta.get("source")},
            "missed_events_complete": meta.get("missed_events_complete", "false").lower() == "true",
            "events": events, "missed": missed}


def load(paths: Iterable[Path]) -> list:
    reviews = []
    for path in paths:
        path = Path(path)
        if path.suffix.lower() == ".csv":
            reviews.append(_csv_review(path))
        else:
            reviews.append(json.loads(path.read_text(encoding="utf-8")))
    return reviews


# ------------------------------------------------------------------ compute
def _empty() -> dict:
    return {"correct": 0, "wrong_type": 0, "false_positives": 0, "duplicates": 0, "uncertain": 0,
            "unreviewed": 0, "missed": 0, "_errors": []}


def _ratio(a: float, b: float) -> Optional[float]:
    return a / b if b else None


def _finish(c: dict, minutes: float, complete: bool) -> dict:
    detections = c["correct"] + c["wrong_type"] + c["false_positives"] + c["duplicates"]
    precision = _ratio(c["correct"], detections)
    recall = _ratio(c["correct"], c["correct"] + c["missed"] + c["wrong_type"]) if complete else None
    f1 = None
    if precision is not None and recall is not None:
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    errors = c.pop("_errors")
    timing: dict = {"n": len(errors)}
    if errors:
        timing.update({"mean_signed_s": statistics.fmean(errors),
                       "mean_abs_s": statistics.fmean(abs(e) for e in errors),
                       "median_abs_s": statistics.median(abs(e) for e in errors),
                       "max_abs_s": max(abs(e) for e in errors)})
    return {**c, "reviewed_detections": detections + c["uncertain"],
            "precision": precision, "recall": recall, "f1": f1,
            "false_positives_per_minute": _ratio(c["false_positives"] + c["duplicates"], minutes),
            "timestamp_error": timing}


def compute(reviews) -> dict:
    if isinstance(reviews, dict):
        reviews = [reviews]
    overall, agnostic = _empty(), _empty()
    by_fighter = {f: _empty() for f in FIGHTERS}
    by_type = {t: _empty() for t in TYPES}
    minutes = 0.0
    complete = True
    for review in reviews:
        minutes += float(review["video"].get("duration") or 0.0) / 60.0
        complete = complete and bool(review.get("missed_events_complete"))
        for e in review["events"]:
            verdict = e.get("verdict") or "unreviewed"
            if verdict not in VERDICTS:
                raise ValueError(f"unknown verdict {verdict!r} (expected one of {VERDICTS})")
            fighter, kind = e.get("fighter"), e.get("type")
            buckets = [overall, by_fighter.get(fighter, _empty()), by_type.get(kind, _empty())]
            key = {"correct": "correct", "wrong_type": "wrong_type", "false_positive": "false_positives",
                   "duplicate": "duplicates", "uncertain": "uncertain", "unreviewed": "unreviewed"}[verdict]
            for b in buckets:
                b[key] += 1
            if verdict == "wrong_type":
                actual = e.get("actual")
                if actual in by_type:
                    by_type[actual]["missed"] += 1
                agnostic["correct"] += 1
            else:
                agnostic[key] += 1
            if verdict == "correct" and e.get("true_t") is not None:
                error = float(e["t"]) - float(e["true_t"])
                for b in buckets:
                    b["_errors"].append(error)
                agnostic["_errors"].append(error)
        for m in review.get("missed", []):
            for b in (overall, by_fighter.get(m.get("fighter"), _empty()), by_type.get(m.get("type"), _empty()),
                      agnostic):
                b["missed"] += 1

    result = {
        "videos": len(reviews),
        "reviewed_minutes": minutes,
        "missed_events_complete": complete,
        "overall": _finish(overall, minutes, complete),
        "type_agnostic": _finish(agnostic, minutes, complete),
        "by_fighter": {f: _finish(c, minutes, complete) for f, c in by_fighter.items()},
        "by_type": {t: _finish(c, minutes, complete) for t, c in by_type.items()},
    }
    reviewed = result["overall"]["reviewed_detections"]
    enough = reviewed >= MIN_EVENTS_FOR_CLAIMS and minutes >= MIN_MINUTES_FOR_CLAIMS
    result["sufficient_for_claims"] = enough
    result["verdict"] = (
        f"Measured on {reviewed} reviewed detections over {minutes:.1f} min of labelled video."
        if enough else
        f"Real-world accuracy is not yet established: {reviewed} reviewed detections over "
        f"{minutes:.1f} min of labelled video (a claim needs at least {MIN_EVENTS_FOR_CLAIMS} "
        f"and {MIN_MINUTES_FOR_CLAIMS:.0f} min). The numbers below describe this sample only."
    )
    return result


# ---------------------------------------------------------------------- cli
def _fmt(v) -> str:
    if v is None:
        return "n/a"
    return f"{v:.3f}" if isinstance(v, float) else str(v)


def render(result: dict) -> str:
    lines = [result["verdict"], ""]
    def row(name, m):
        te = m["timestamp_error"]
        timing = f"{te['mean_abs_s'] * 1000:.0f} ms (n={te['n']})" if te["n"] else "n/a"
        return (f"{name:<14} P {_fmt(m['precision'])}  R {_fmt(m['recall'])}  F1 {_fmt(m['f1'])}  "
                f"correct {m['correct']}  FP {m['false_positives']}  dup {m['duplicates']}  "
                f"wrong-type {m['wrong_type']}  missed {m['missed']}  uncertain {m['uncertain']}  "
                f"FP/min {_fmt(m['false_positives_per_minute'])}  |t err| {timing}")
    lines.append(row("overall", result["overall"]))
    lines.append(row("any type", result["type_agnostic"]))
    for f, m in result["by_fighter"].items():
        lines.append(row(f, m))
    for t, m in result["by_type"].items():
        lines.append(row(t, m))
    if not result["missed_events_complete"]:
        lines.append("Recall and F1 withheld: not every review searched its whole video for missed events.")
    return "\n".join(lines)


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evaluation.metrics")
    parser.add_argument("reviews", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    result = compute(load(args.reviews))
    print(render(result))
    if args.out:
        args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
