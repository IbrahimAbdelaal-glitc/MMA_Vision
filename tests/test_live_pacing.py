"""Design 8: the browser clock paces the engine; latest frame wins; never rewinds."""

import random

from helpers import ROOT  # noqa: F401
from live.pacing import Pacer

TS = [i / 60 for i in range(360)]  # verified times in seconds


def make():
    return Pacer(TS)


def test_idles_until_playing():
    p = make()
    assert p.next_target(now=0) is None
    p.apply_clock(0.5, False, now=0)
    assert p.next_target(now=0) is None


def test_latest_frame_wins_and_counts_skipped_frames():
    p = make()
    p.apply_clock(0.0, True, now=0)
    assert p.next_target(now=0) == 0
    p.mark_analysed(0)
    p.apply_clock(0.1, True, now=0.1)   # frame 6 is the last with t <= 0.1
    assert p.next_target(now=0.1) == 6
    p.mark_analysed(6)
    assert p.skipped == 5
    assert p.analysed == 2


def test_nothing_new_to_analyse_idles():
    p = make()
    p.apply_clock(0.1, True, now=0)
    p.mark_analysed(p.next_target(now=0))
    assert p.next_target(now=0.05) is None


def test_silent_client_idles_after_two_seconds():
    p = make()
    p.apply_clock(1.0, True, now=0)
    assert p.next_target(now=1.9) == 60
    assert p.next_target(now=2.1) is None


def test_backward_jump_is_rejected_and_never_rewinds():
    p = make()
    p.apply_clock(2.0, True, now=0)
    p.mark_analysed(p.next_target(now=0))
    assert p.apply_clock(1.85, True, now=0.1) == "rejected"
    assert p.next_target(now=0.1) is None
    # A small step back (within 0.1 s) is not a rejection, just nothing to do.
    assert p.apply_clock(1.95, True, now=0.2) is None
    assert p.next_target(now=0.2) is None
    # Once the clock passes the position again, analysis resumes.
    p.apply_clock(2.1, True, now=0.3)
    assert p.next_target(now=0.3) == 126


def test_end_of_video():
    p = make()
    p.apply_clock(6.0, True, now=0)
    target = p.next_target(now=0)
    assert target == 359
    p.mark_analysed(target)
    assert p.finished


def test_pause_stops_after_the_frame_in_progress():
    p = make()
    p.apply_clock(1.0, True, now=0)
    target = p.next_target(now=0)
    # pause arrives while `target` is being analysed
    p.apply_clock(1.0, False, now=0.01)
    p.mark_analysed(target)
    assert p.next_target(now=0.02) is None


def test_property_never_passes_the_clock_and_always_increases():
    rng = random.Random(20261117)
    for _ in range(500):
        p = make()
        now = 0.0
        clock = 0.0
        last_read_t = None
        analysed = []
        for _ in range(60):
            now += rng.uniform(0, 0.3)
            kind = rng.choice(["play", "pause", "waiting", "forward", "back", "frame", "frame"])
            if kind in ("play", "forward"):
                clock += rng.uniform(0, 1.5 if kind == "forward" else 0.3)
                p.apply_clock(clock, True, now=now)
                last_read_t = clock
            elif kind in ("pause", "waiting"):
                p.apply_clock(clock, False, now=now)
                last_read_t = clock
            elif kind == "back":
                clock = max(0.0, clock - rng.uniform(0, 1.0))
                p.apply_clock(clock, True, now=now)
                last_read_t = clock
            else:
                target = p.next_target(now=now)
                if target is not None:
                    assert last_read_t is not None
                    assert TS[target] <= last_read_t + 1e-12
                    assert not analysed or target > analysed[-1]
                    analysed.append(target)
                    p.mark_analysed(target)


def test_float_rounding_of_the_clock_does_not_skip_a_frame():
    ts = [i * 1000.0 / 60 / 1000.0 for i in range(200)]
    pacer = Pacer(ts)
    for i in range(200):
        pacer.apply_clock(i / 60, True, now=0.0)
        assert pacer.next_target(0.0) == i
        pacer.mark_analysed(i)
    assert pacer.skipped == 0
