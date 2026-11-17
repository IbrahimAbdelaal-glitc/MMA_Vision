"""Limb speed relative to the torso (Detector(speed_reference="torso")).

The default ("image") measures wrist/ankle speed in image pixels, as the offline
pipeline does, so a step, footwork or a camera pan moves every keypoint and is
counted as limb speed. Reviewing real events (docs/validation.md) found steps
reported as kick-like and walking guards reported as punch-like. "torso"
subtracts the movement of the fighter's own torso centre first.
"""
import math

import pytest

from live import constants as K
from live.detector import Detector, body_centre
from live_synth import FIVE_PUNCHES, punching_pose, run

FPS = 60.0


def step_dx(t, steps, distance=60.0, duration=0.15):
    """Whole-body x offset: smooth steps of `distance` px starting at each time in `steps`."""
    dx = 0.0
    for start in steps:
        u = (t - start) / duration
        if u >= 1:
            dx += distance
        elif u > 0:
            dx += distance * (1 - math.cos(math.pi * u)) / 2
    return dx


STEPS = [0.3 + 0.5 * k for k in range(5)]
# The guard hand drifts a little during each step: a small, real extension gain.
BOBS = [(s, 0.12) for s in STEPS]


def stepping(duration=3.0, punches=BOBS, pan=False):
    out = []
    for i in range(int(round(duration * FPS))):
        t = i / FPS
        dx = step_dx(t, STEPS)
        red_dx = 400 + (dx if pan else 0.0)
        out.append((i, t, {"blue": punching_pose(t, punches, dx=dx), "red": punching_pose(t, [], dx=red_dx)}))
    return out


def still_punches(duration=3.0):
    return [(i, i / FPS, {"blue": punching_pose(i / FPS, FIVE_PUNCHES), "red": punching_pose(i / FPS, [], dx=400)})
            for i in range(int(round(duration * FPS)))]


def test_default_is_image_speed_as_the_offline_pipeline():
    assert Detector().speed_reference == "image"


def test_unknown_reference_is_refused():
    with pytest.raises(ValueError):
        Detector(speed_reference="hips")


def test_image_speed_reports_steps_with_a_drifting_guard_as_punch_like():
    """The limitation, pinned: in image speed a step is limb speed."""
    events = run(Detector(), stepping())
    assert any(e["corner"] == "blue" and e["type"] == "punch-like" for e in events)


def test_torso_speed_does_not_report_steps_with_a_drifting_guard():
    assert run(Detector(speed_reference="torso"), stepping()) == []


def test_torso_speed_does_not_report_a_camera_pan():
    events = run(Detector(speed_reference="torso"), stepping(punches=[], pan=True))
    assert events == []


def test_torso_speed_still_reports_every_punch():
    image = run(Detector(), still_punches())
    torso = run(Detector(speed_reference="torso"), still_punches())
    assert len(torso) == len(image) == 5
    assert [round(e["peak_t"], 4) for e in torso] == [round(e["peak_t"], 4) for e in image]


def test_torso_speed_reports_punches_thrown_while_stepping():
    punches = [(s + 0.02, 0.8) for s in STEPS]
    events = run(Detector(speed_reference="torso"), stepping(punches=punches))
    blue_punches = [e for e in events if e["corner"] == "blue" and e["type"] == "punch-like"]
    assert len(blue_punches) == 5


def test_no_torso_centre_means_no_speed_rather_than_image_speed():
    pose = punching_pose(0.0, [])
    for joint in ("left_shoulder", "right_shoulder", "left_hip"):
        pose[K.KP[joint]][2] = 0.1          # only one confident torso point left
    assert body_centre(pose) is None
    detector = Detector(speed_reference="torso")
    detector.add_frame(0, 0.0, {"blue": pose, "red": None}, True)
    moved = [[x + 30, y, c] for x, y, c in pose]
    assert detector._limb_speeds("blue", 1 / FPS, moved) == {}
