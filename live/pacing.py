"""Design 8: pacing the engine by the browser's playback clock.

The most recent clock message sets the advance limit. Each target is the
latest verified frame at or before that limit (latest frame wins); frames in
between are grabbed without decoding and counted as skipped. The engine never
rewinds and never analyses a frame later than the limit in force when it
chose the frame.
"""

from __future__ import annotations

from bisect import bisect_right
from typing import Optional, Sequence

from live.constants import BACKWARD_TOLERANCE_SECONDS, SILENT_CLIENT_SECONDS

LIMIT_EPSILON = 1e-6


class Pacer:
    def __init__(self, timestamps_s: Sequence[float]):
        self.ts = list(timestamps_s)
        self.limit: Optional[float] = None
        self.playing = False
        self.last_clock_at: Optional[float] = None
        self.last_analysed = -1
        self.analysed = 0
        self.skipped = 0

    @property
    def position(self) -> Optional[float]:
        return self.ts[self.last_analysed] if self.last_analysed >= 0 else None

    @property
    def finished(self) -> bool:
        return self.last_analysed == len(self.ts) - 1

    def apply_clock(self, t: float, playing: bool, now: float) -> Optional[str]:
        """Record a clock message. Returns "rejected" for a backward jump."""

        self.limit = float(t)
        self.playing = bool(playing)
        self.last_clock_at = now
        position = self.position
        if position is not None and t < position - BACKWARD_TOLERANCE_SECONDS:
            return "rejected"
        return None

    def next_target(self, now: float) -> Optional[int]:
        """The frame to analyse next, or None to idle."""

        if not self.playing or self.limit is None or self.last_clock_at is None:
            return None
        if now - self.last_clock_at > SILENT_CLIENT_SECONDS:
            return None
        # LIMIT_EPSILON absorbs float rounding between the browser's time and the
        # verified timestamps (i/60 vs i*1000/60/1000); it is far below a frame.
        target = bisect_right(self.ts, self.limit + LIMIT_EPSILON) - 1
        if target <= self.last_analysed:
            return None
        return target

    def mark_analysed(self, index: int) -> None:
        if index <= self.last_analysed:
            raise ValueError("frames are analysed in increasing order")
        self.skipped += index - self.last_analysed - 1
        self.analysed += 1
        self.last_analysed = index
