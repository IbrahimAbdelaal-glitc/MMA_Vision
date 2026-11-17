"""Design 10.1-10.2 and 8: per-frame metrics, analysed rate, events per minute.

A metric is null unless everything it depends on was measured.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Optional

from live import constants as K


def frame_metrics(t: float, persons: dict, previous: Optional[tuple], diagonal: float,
                  events_per_minute: Optional[float]) -> dict:
    """persons: corner -> Person (tracked) or None. previous: (t, persons) of the last analysed frame."""

    blue, red = persons.get("blue"), persons.get("red")
    distance = None
    if blue is not None and red is not None:
        (bx, by), (rx, ry) = blue.center, red.center
        distance = math.hypot(bx - rx, by - ry)

    speeds = {}
    for corner in ("blue", "red"):
        speeds[corner] = None
        person = persons.get(corner)
        if person is None or previous is None:
            continue
        t_prev, prev_persons = previous
        before = prev_persons.get(corner)
        dt = t - t_prev
        if before is None or dt <= 0 or dt > K.MAX_STEP_SECONDS + 1e-9:
            continue
        (x1, y1), (x0, y0) = person.center, before.center
        speeds[corner] = math.hypot(x1 - x0, y1 - y0) / dt

    tracked = [p for p in (blue, red) if p is not None]
    confidences = [float(p.keypoints[j][2]) for p in tracked for j in K.BODY_JOINTS]
    return {
        "distance_px": distance,
        "distance_percent_diagonal": None if distance is None else 100.0 * distance / diagonal,
        "blue_speed_px_s": speeds["blue"],
        "red_speed_px_s": speeds["red"],
        "keypoint_confidence": sum(confidences) / len(confidences) if confidences else None,
        "fighters_tracked": len(tracked),
        "keypoints_tracked": sum(1 for c in confidences if c >= K.KEYPOINT_CONFIDENCE),
        "strike_like_events_per_minute": events_per_minute,
    }


class RateMeter:
    """Analysed frames per second over the last 2 s of video time (plan decision 3)."""

    def __init__(self):
        self.times: deque = deque()
        self.first: Optional[float] = None

    def update(self, t: float) -> tuple:
        if self.first is None:
            self.first = t
        self.times.append(t)
        window = min(K.RATE_WINDOW_SECONDS, t - self.first)
        while self.times and self.times[0] < t - window - 1e-9:
            self.times.popleft()
        if window < K.RATE_MIN_WINDOW_SECONDS:
            return False, None, "measuring the analysed rate"
        rate = (len(self.times) - 1) / window
        if rate < K.MIN_ANALYSED_RATE:
            return False, rate, f"analysed rate {rate:.1f} frames/s is below {K.MIN_ANALYSED_RATE:.0f}"
        return True, rate, None


class EventRate:
    """Provisional strike-like events per minute (10.2)."""

    def __init__(self):
        self.basis = 0.0
        self.count = 0
        self.unscored = 0
        self.per_corner = {c: {"scored": 0, "unscored": 0, "counted": 0} for c in ("blue", "red")}

    def add_interval(self, dt: float) -> None:
        if 0 < dt <= K.MAX_STEP_SECONDS + 1e-9:
            self.basis += dt

    def add_event(self, event: dict) -> None:
        corner = self.per_corner[event["corner"]]
        if event["score_status"] != "scored":
            self.unscored += 1
            corner["unscored"] += 1
            return
        corner["scored"] += 1
        if event["kinematic_score"] >= K.CLASS_STRONG:
            self.count += 1
            corner["counted"] += 1

    @property
    def per_minute(self) -> Optional[float]:
        if self.basis < K.EVENTS_PER_MINUTE_MIN_BASIS:
            return None
        return self.count / (self.basis / 60.0)
