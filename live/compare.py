"""Design 12: live corner labels vs. the final (offline) labels.

Each analysed live frame is compared with the offline row with the same frame
index in results/movement_metrics.csv. Not-compared time never counts as
agreement, and the offline scorecard is never relabelled.
"""

from __future__ import annotations

import csv
import io
import json
import math
from pathlib import Path
from typing import Optional

from live.constants import C_GATE, C_MARGIN, MAX_STEP_SECONDS

REASONS = ("ambiguous", "live_uncertain", "live_lost", "offline_missing")


def read_complete_rows(path: Path) -> list:
    """CSV rows, ignoring a final line with no line ending (an engine killed mid-row)."""

    text = path.read_text(encoding="utf-8", errors="replace")
    if text and not text.endswith("\n"):
        cut = text.rfind("\n")
        text = text[: cut + 1] if cut >= 0 else ""
    return list(csv.DictReader(io.StringIO(text)))


def _float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def live_frames(track_rows: list) -> list:
    """[{frame, t, blue: (state, x, y), red: (...)}] in frame order, complete frames only."""

    by_frame: dict = {}
    for row in track_rows:
        frame = int(row["frame"])
        entry = by_frame.setdefault(frame, {"frame": frame, "t": _float(row["t"])})
        entry[row["corner"]] = (row["state"], _float(row["center_x"]), _float(row["center_y"]))
    return [by_frame[f] for f in sorted(by_frame) if "blue" in by_frame[f] and "red" in by_frame[f]]


def offline_positions(metric_rows: list) -> dict:
    out = {}
    for row in metric_rows:
        frame = int(float(row["frame"]))
        if row.get("blue_detected") in ("1", "1.0", "True") and row.get("red_detected") in ("1", "1.0", "True"):
            b = (_float(row["blue_x"]), _float(row["blue_y"]))
            r = (_float(row["red_x"]), _float(row["red_y"]))
            if None not in b and None not in r:
                out[frame] = {"blue": b, "red": r}
    return out


def frame_outcome(live: dict, offline: Optional[dict], diagonal: float) -> tuple:
    """('agree' | 'disagree' | 'not_compared', reason or None)."""

    states = (live["blue"][0], live["red"][0])
    if "uncertain" in states:
        return "not_compared", "live_uncertain"
    if any(s != "tracked" for s in states):
        return "not_compared", "live_lost"
    if offline is None:
        return "not_compared", "offline_missing"

    def d(a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1]) / diagonal

    lb, lr = live["blue"][1:], live["red"][1:]
    same = (d(lb, offline["blue"]), d(lr, offline["red"]))
    crossed = (d(lb, offline["red"]), d(lr, offline["blue"]))
    s, c = sum(same), sum(crossed)
    chosen, outcome = (same, "agree") if s < c else (crossed, "disagree")
    if abs(s - c) < C_MARGIN or max(chosen) > C_GATE:
        return "not_compared", "ambiguous"
    return outcome, None


def compare(live_dir: Path, metrics_csv: Path) -> dict:
    track = live_dir / "track.csv"
    probe_file = live_dir / "probe.json"
    if not track.exists() or not probe_file.exists():
        return {"state": "unavailable"}
    probe = json.loads(probe_file.read_text(encoding="utf-8"))
    fps = float(probe["fps"])
    diagonal = math.hypot(float(probe["width"]), float(probe["height"]))
    frames = live_frames(read_complete_rows(track))
    if not frames:
        return {"state": "unavailable"}
    offline = offline_positions(read_complete_rows(metrics_csv)) if metrics_csv.exists() else {}
    log_rows = []
    if (live_dir / "identity_log.csv").exists():
        log_rows = read_complete_rows(live_dir / "identity_log.csv")
    return summarise(frames, offline, diagonal, fps, log_rows)


def summarise(frames: list, offline: dict, diagonal: float, fps: float, log_rows: list) -> dict:
    n = len(frames)
    widths = []
    for i, f in enumerate(frames):
        if i + 1 < n:
            widths.append(min(frames[i + 1]["t"] - f["t"], MAX_STEP_SECONDS))
        else:
            widths.append(1.0 / fps)
    outcomes = [frame_outcome(f, offline.get(f["frame"]), diagonal) for f in frames]

    compared = 0.0
    not_compared = {r: 0.0 for r in REASONS}
    for (outcome, reason), w in zip(outcomes, widths):
        if outcome == "not_compared":
            not_compared[reason] += w
        else:
            compared += w
    covered = compared + sum(not_compared.values())
    span = frames[-1]["t"] + widths[-1] - frames[0]["t"]

    intervals = []
    current = None
    for i, (outcome, _) in enumerate(outcomes):
        if outcome == "disagree":
            if current is None:
                current = {"first": i, "last": i}
            else:
                current["last"] = i
        elif outcome == "agree" and current is not None:
            intervals.append(current)
            current = None
    if current is not None:
        intervals.append(current)

    result_intervals = []
    for item in intervals:
        first, last = item["first"], item["last"]
        start = frames[first]["t"]
        gap = sum(widths[k] for k in range(first, last + 1) if outcomes[k][0] == "not_compared")
        result_intervals.append({
            "start": round(start, 3),
            "end": round(frames[last]["t"] + widths[last], 3),
            "live": "blue", "final": "red",
            "not_compared_seconds": round(gap, 3),
            "identity_log_entry": _log_entry_near(log_rows, start),
        })

    if result_intervals:
        state = "disagree"
    elif compared > 0:
        state = "agree"
    else:
        state = "not_compared"
    return {
        "state": state,
        "provisional_labels": True,
        "live_span_seconds": round(span, 3),
        "covered_seconds": round(covered, 3),
        "uncovered_seconds": round(span - covered, 3),
        "compared_seconds": round(compared, 3),
        "not_compared_seconds": {r: round(v, 3) for r, v in not_compared.items()},
        "intervals": result_intervals,
    }


def _log_entry_near(rows: list, start: float) -> Optional[str]:
    for row in rows:
        t = _float(row.get("t"))
        if t is not None and abs(t - start) <= 0.5:
            corner = f" ({row['corner']})" if row.get("corner") else ""
            return f"{row.get('kind')}{corner} at {t:.2f} s"
    return None
