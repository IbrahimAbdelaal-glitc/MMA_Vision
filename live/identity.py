"""Design 9: Blue/Red identity through tracker ID changes, with a manual swap.

Each analysed frame, every corner is `tracked`, `uncertain` or `lost`. A
corner is assigned only by seeding (tracker IDs 1 and 2, as offline), by
continuity on its tracker ID, or by the gated re-association rules of 9.3.
Ties never resolve by order; nothing is guessed, carried forward or
interpolated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import permutations
from typing import Optional, Sequence

from live.constants import G_BASE, G_MAX, G_RATE, M_TRACK, R_MAX, SEED_IDS

CORNERS = ("blue", "red")


@dataclass
class Person:
    track_id: int
    box: tuple                  # x1, y1, x2, y2 in pixels
    keypoints: list             # 17 x (x, y, confidence)

    @property
    def center(self) -> tuple:
        # movement_analysis.py:200-208 truncates the box to ints first.
        x1, y1, x2, y2 = (int(v) for v in self.box)
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    @property
    def area(self) -> float:
        x1, y1, x2, y2 = self.box
        return max(0.0, (x2 - x1)) * max(0.0, (y2 - y1))


@dataclass
class CornerTrack:
    seeded: bool = False
    track_id: Optional[int] = None
    open: bool = False
    last_center: Optional[tuple] = None
    last_area: Optional[float] = None
    last_time: Optional[float] = None
    state: str = "lost"


@dataclass
class IdentityResult:
    states: dict                       # corner -> "tracked" | "uncertain" | "lost"
    persons: dict                      # corner -> Person or None
    log: list = field(default_factory=list)


def gate(dt: float) -> float:
    return min(G_BASE + G_RATE * dt, G_MAX)


def cost(track: CornerTrack, person: Person, t: float, diagonal: float) -> Optional[float]:
    """The 9.3 cost, or None when the candidate is not eligible."""

    if track.last_center is None or track.last_time is None or not track.last_area or person.area <= 0:
        return None
    dt = max(0.0, t - track.last_time)
    g = gate(dt)
    cx, cy = person.center
    px, py = track.last_center
    d = math.hypot(cx - px, cy - py) / diagonal
    r = max(person.area / track.last_area, track.last_area / person.area)
    if d > g or r > R_MAX:
        return None
    return d / g + math.log(r) / math.log(R_MAX)


class IdentityTracker:
    def __init__(self, diagonal: float):
        self.diagonal = diagonal
        self.tracks = {corner: CornerTrack() for corner in CORNERS}

    # ---------------------------------------------------------------- swap
    def swap(self, frame: int, t: float) -> dict:
        self.tracks["blue"], self.tracks["red"] = self.tracks["red"], self.tracks["blue"]
        return {"kind": "swap", "frame": frame, "t": t, "reason": "manual correction"}

    # -------------------------------------------------------------- update
    def update(self, frame: int, t: float, people: Sequence[Person]) -> IdentityResult:
        by_id = {}
        for person in people:
            by_id.setdefault(person.track_id, person)
        log = []
        assigned = {corner: None for corner in CORNERS}

        # Seeding and continuity.
        for corner in CORNERS:
            track = self.tracks[corner]
            if not track.seeded:
                seed = SEED_IDS[corner]
                other = self.tracks[_other(corner)]
                if seed in by_id and not (other.track_id == seed and not other.open):
                    track.seeded = True
                    track.track_id = seed
                    assigned[corner] = by_id[seed]
                    log.append({"kind": "seeded", "corner": corner, "frame": frame, "t": t,
                                "track_id": seed, "reason": f"tracker ID {seed} first seen"})
                continue
            if track.track_id in by_id:
                assigned[corner] = by_id[track.track_id]

        # Corners whose ID is absent open up.
        open_corners = [c for c in CORNERS if self.tracks[c].seeded and assigned[c] is None]
        for corner in open_corners:
            self.tracks[corner].open = True

        held = {assigned[c].track_id for c in CORNERS if assigned[c] is not None}
        candidates = [p for p in people if p.track_id not in held]
        candidates.sort(key=lambda p: p.track_id)  # only so logs are reproducible

        states = {}
        if len(open_corners) == 1:
            corner = open_corners[0]
            states[corner] = self._one_open(corner, candidates, frame, t, assigned, log)
        elif len(open_corners) == 2:
            self._two_open(candidates, frame, t, assigned, states, log)

        # Final states and bookkeeping.
        for corner in CORNERS:
            track = self.tracks[corner]
            person = assigned[corner]
            if person is not None:
                state = "tracked"
                track.open = False
                track.track_id = person.track_id
                track.last_center = person.center
                track.last_area = person.area
                track.last_time = t
            elif corner in states:
                state = states[corner]
            else:
                state = "lost"   # not yet seeded
            if state != track.state and state != "tracked":
                log.append({"kind": state, "corner": corner, "frame": frame, "t": t,
                            "reason": "no unassigned person" if state == "lost"
                            else "no assignment passes the rules"})
            track.state = state
        return IdentityResult(states={c: self.tracks[c].state for c in CORNERS},
                              persons=assigned, log=log)

    # ------------------------------------------------------------- helpers
    def _one_open(self, corner, candidates, frame, t, assigned, log) -> str:
        track = self.tracks[corner]
        scored = []
        for person in candidates:
            c = cost(track, person, t, self.diagonal)
            if c is not None:
                scored.append((c, person))
        if not scored:
            return "uncertain" if candidates else "lost"
        scored.sort(key=lambda item: item[0])
        c1 = scored[0][0]
        c2 = scored[1][0] if len(scored) > 1 else math.inf
        if c2 - c1 >= M_TRACK:
            person = scored[0][1]
            assigned[corner] = person
            log.append({"kind": "re-association", "corner": corner, "frame": frame, "t": t,
                        "track_id": person.track_id, "cost": round(c1, 4),
                        "margin": None if math.isinf(c2) else round(c2 - c1, 4),
                        "reason": f"tracker ID {person.track_id} matched by position and size"})
            return "tracked"
        return "uncertain"

    def _two_open(self, candidates, frame, t, assigned, states, log) -> None:
        blue, red = self.tracks["blue"], self.tracks["red"]
        costs = {}
        for person in candidates:
            costs[("blue", person.track_id)] = cost(blue, person, t, self.diagonal)
            costs[("red", person.track_id)] = cost(red, person, t, self.diagonal)
        complete = []
        for pb, pr in permutations(candidates, 2):
            cb, cr = costs[("blue", pb.track_id)], costs[("red", pr.track_id)]
            if cb is not None and cr is not None:
                complete.append((cb + cr, pb, pr, cb, cr))
        if complete:
            complete.sort(key=lambda item: item[0])
            total_1 = complete[0][0]
            total_2 = complete[1][0] if len(complete) > 1 else math.inf
            if total_2 - total_1 >= M_TRACK:
                _, pb, pr, cb, cr = complete[0]
                margin = None if math.isinf(total_2) else round(total_2 - total_1, 4)
                for corner, person, c in (("blue", pb, cb), ("red", pr, cr)):
                    assigned[corner] = person
                    log.append({"kind": "re-association", "corner": corner, "frame": frame,
                                "t": t, "track_id": person.track_id, "cost": round(c, 4),
                                "margin": margin, "reason": "simultaneous assignment"})
                states["blue"] = states["red"] = "tracked"
            else:
                states["blue"] = states["red"] = "uncertain"
            return
        # No complete assignment: each corner alone, with candidates eligible only for it.
        both = [p for p in candidates
                if costs[("blue", p.track_id)] is not None and costs[("red", p.track_id)] is not None]
        if both:
            states["blue"] = states["red"] = "uncertain"
            return
        for corner in ("blue", "red"):
            own = [p for p in candidates if costs[(corner, p.track_id)] is not None]
            if own:
                states[corner] = self._one_open(corner, own, frame, t, assigned, log)
            else:
                states[corner] = "uncertain" if candidates else "lost"


def _other(corner: str) -> str:
    return "red" if corner == "blue" else "blue"
