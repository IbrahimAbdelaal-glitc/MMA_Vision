"""Synthetic fighters for the detector and engine tests.

A Blue fighter throws right-arm punch-like movements on a smooth cosine
profile; everything else stays still. Positions are chosen so extension,
angle and speed can be checked by hand: torso 100 px, guard wrist at
(510, 310), extended wrist 90 px further out.
"""

import math

from live.constants import KP

CONF = 0.9


def static_pose(dx=0.0):
    pts = [[0.0, 0.0, CONF] for _ in range(17)]
    base = {
        "left_shoulder": (460, 300), "right_shoulder": (500, 300),
        "left_elbow": (430, 340), "right_elbow": (530, 340),
        "left_wrist": (450, 310), "right_wrist": (510, 310),
        "left_hip": (460, 400), "right_hip": (500, 400),
        "left_knee": (460, 460), "right_knee": (500, 460),
        "left_ankle": (460, 520), "right_ankle": (500, 520),
    }
    for name, (x, y) in base.items():
        pts[KP[name]] = [x + dx, y, CONF]
    return pts


def extension_at(t, punches):
    """0 (guard) .. amplitude (extended) for punches = [(start, amplitude)]."""
    rise, hold, fall = 0.1, 0.03, 0.15
    e = 0.0
    for start, amplitude in punches:
        u = t - start
        if 0 <= u < rise:
            e = max(e, amplitude * (1 - math.cos(math.pi * u / rise)) / 2)
        elif rise <= u < rise + hold:
            e = max(e, amplitude)
        elif rise + hold <= u < rise + hold + fall:
            v = (u - rise - hold) / fall
            e = max(e, amplitude * (1 + math.cos(math.pi * v)) / 2)
    return e


def punching_pose(t, punches, dx=0.0):
    pts = static_pose(dx)
    e = extension_at(t, punches)
    guard_elbow, ext_elbow = (530, 340), (550, 300)
    guard_wrist, ext_wrist = (510, 310), (600, 300)
    for name, g, x in (("right_elbow", guard_elbow, ext_elbow), ("right_wrist", guard_wrist, ext_wrist)):
        pts[KP[name]] = [g[0] + (x[0] - g[0]) * e + dx, g[1] + (x[1] - g[1]) * e, CONF]
    return pts


def frames(duration, punches, fps=60.0, red=True):
    """[(index, t, {"blue": kps, "red": kps})] at a constant rate."""
    out = []
    n = int(round(duration * fps))
    for i in range(n):
        t = i / fps
        out.append((i, t, {"blue": punching_pose(t, punches), "red": static_pose(400) if red else None}))
    return out


def run(detector, seq, active=True, finish=True):
    events = []
    for index, t, kps in seq:
        events += detector.add_frame(index, t, kps, active)
    if finish:
        events += detector.finish(seq[-1][1])
    return events


# Five punches more than 0.35 s apart, rising in strength.
FIVE_PUNCHES = [(0.3 + 0.5 * k, 0.7 + 0.06 * k) for k in range(5)]
