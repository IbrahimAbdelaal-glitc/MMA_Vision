"""One kick moves both ankles: the kicking leg and the pivoting standing leg.

Observed on real footage (docs/validation.md, "One kick, several events"): a
single low kick produced kick-like peaks on the right and the left ankle
0.21 s apart, each counted as a separate movement because duplicates were
only removed within one limb. A fighter cannot kick with both legs within
DUPLICATE_GAP_SECONDS, so opposite-leg kick-like candidates of one fighter
that close together are one movement: only the stronger is emitted. Punches
are not merged: a 1-2 combination really is two strikes 0.2 s apart.
"""

from live import detector as D
from live.constants import DUPLICATE_GAP_SECONDS, KP
from tests.live_synth import CONF, extension_at, punching_pose, run, static_pose

# Chambered and extended positions of each leg (torso 100 px, see live_synth),
# mirrored about each hip. Hip-to-ankle reach grows steadily from 1.05 to 1.50
# torso lengths along the path, and the knee opens from about 125 to 180 degrees.
LEGS = {
    "right": {"knee": ((530, 450), (560, 445)), "ankle": ((505, 505), (620, 490))},
    "left": {"knee": ((430, 450), (400, 445)), "ankle": ((455, 505), (340, 490))},
}


def kicking_pose(t, kicks):
    """kicks = {"right": [(start, amplitude)], "left": [...]}; arms stay in guard."""
    pts = static_pose()
    for side, motions in kicks.items():
        e = extension_at(t, motions)
        for joint, (g, x) in LEGS[side].items():
            pts[KP[f"{side}_{joint}"]] = [g[0] + (x[0] - g[0]) * e, g[1] + (x[1] - g[1]) * e, CONF]
    # Legs not listed stay chambered, so the static pose is the same for all.
    for side in ("right", "left"):
        if side not in kicks:
            for joint, (g, _) in LEGS[side].items():
                pts[KP[f"{side}_{joint}"]] = [g[0], g[1], CONF]
    return pts


def kick_frames(duration, kicks, fps=60.0):
    n = int(round(duration * fps))
    return [(i, i / fps, {"blue": kicking_pose(i / fps, kicks), "red": static_pose(400)}) for i in range(n)]


def kick_events(events):
    return [e for e in events if e["corner"] == "blue" and e["type"] == "kick-like"]


def test_pivot_of_the_standing_leg_is_not_a_second_kick():
    # Right leg kicks; the left (standing) leg pivots 0.1 s later, more weakly.
    seq = kick_frames(2.0, {"right": [(0.5, 1.0)], "left": [(0.6, 0.6)]})

    merged = kick_events(run(D.Detector(), seq))
    separate = kick_events(run(D.Detector(cross_leg_kick_duplicates=False), seq))

    assert [e["side"] for e in separate] == ["right", "left"]      # the old behaviour: two kicks
    assert [e["side"] for e in merged] == ["right"]                 # one movement, the stronger leg


def test_kicks_with_alternate_legs_further_apart_both_count():
    gap = DUPLICATE_GAP_SECONDS + 0.15
    seq = kick_frames(2.5, {"right": [(0.5, 1.0)], "left": [(0.5 + gap, 1.0)]})

    events = kick_events(run(D.Detector(), seq))

    assert [e["side"] for e in events] == ["right", "left"]


def test_weaker_kick_first_still_loses_to_a_stronger_pivot_peak_later():
    # Same rule as within one limb: the stronger candidate wins, whichever came first.
    seq = kick_frames(2.0, {"right": [(0.5, 0.6)], "left": [(0.6, 1.0)]})

    events = kick_events(run(D.Detector(), seq))

    assert [e["side"] for e in events] == ["left"]


def test_simultaneous_equal_peaks_on_both_legs_emit_exactly_one():
    # A tie must not suppress both (or neither): exactly one survives, deterministically.
    seq = kick_frames(2.0, {"right": [(0.5, 1.0)], "left": [(0.5, 1.0)]})

    first = kick_events(run(D.Detector(), seq))
    second = kick_events(run(D.Detector(), seq))

    assert len(first) == 1
    assert first == second


def test_punch_combinations_on_both_arms_are_not_merged():
    # A 1-2: right hand, then a left hand 0.2 s later. Both are real strikes.
    def pose(t):
        pts = punching_pose(t, [(0.5, 1.0)])
        e = extension_at(t, [(0.7, 1.0)])
        for name, g, x in (("left_elbow", (430, 340), (410, 300)), ("left_wrist", (450, 310), (360, 300))):
            pts[KP[name]] = [g[0] + (x[0] - g[0]) * e, g[1] + (x[1] - g[1]) * e, CONF]
        return pts

    seq = [(i, i / 60, {"blue": pose(i / 60), "red": static_pose(400)}) for i in range(120)]

    events = [e for e in run(D.Detector(), seq) if e["corner"] == "blue" and e["type"] == "punch-like"]

    assert sorted(e["side"] for e in events) == ["left", "right"]


def test_cross_leg_suppression_is_counted_as_a_duplicate():
    seq = kick_frames(2.0, {"right": [(0.5, 1.0)], "left": [(0.6, 0.6)]})
    detector = D.Detector()

    run(detector, seq)

    assert detector.discarded_duplicates == 1
