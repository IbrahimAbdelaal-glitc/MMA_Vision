"""Speed between two observations of a fighter, shared by the offline stages.

A fighter is not detected in every frame. The previous observation can be
several frames old, so a displacement must be divided by the real time between
the two frames, not by one frame period. Beyond MAX_FRAME_GAP frames the two
positions may belong to a re-acquired track (or the fighter moved unseen), so
no speed is reported, the same rule analyze_strikes.py applies to limb speed
(0 < frame difference <= 3).
"""

import math
from typing import Optional

MAX_FRAME_GAP = 3


def step_speed(distance_px: float, frame_gap: int, fps: float) -> Optional[float]:
    """Pixels per second over `frame_gap` frames, or None when the gap is not usable."""
    if fps <= 0 or not (0 < frame_gap <= MAX_FRAME_GAP):
        return None
    if distance_px is None or not math.isfinite(distance_px):
        return None
    return distance_px * fps / frame_gap


def box_center(xyxy) -> tuple:
    """Centre of a box from its float corners (no rounding: speeds are not quantised)."""
    x1, y1, x2, y2 = (float(v) for v in xyxy)
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
