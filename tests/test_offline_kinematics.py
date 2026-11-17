"""Regression tests for movement speed in src/movement_analysis.py.

Bug 1: speed was distance * fps against the last frame the fighter was seen,
so after a 10-frame detection gap the speed was 10x too high.
Bug 2: box corners were cast to int before the centre was taken, so body
speed could only take values 30 * sqrt(a^2 + b^2) px/s at 60 fps (measured on
real jobs: 0, 30, 42.43, 60, 67.08, ...) and small movements read as 0.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from kinematics import MAX_FRAME_GAP, box_center, step_speed  # noqa: E402


def test_one_frame_step_is_distance_times_fps():
    assert step_speed(5.0, 1, 60.0) == pytest.approx(300.0)


def test_a_gap_divides_by_the_real_elapsed_time():
    # 6 px over 3 frames at 60 fps is 120 px/s, not 360 px/s.
    assert step_speed(6.0, 3, 60.0) == pytest.approx(120.0)


@pytest.mark.parametrize("gap", [0, -1, MAX_FRAME_GAP + 1, 10])
def test_unusable_gaps_give_no_speed(gap):
    assert step_speed(6.0, gap, 60.0) is None


def test_invalid_fps_or_distance_give_no_speed():
    assert step_speed(6.0, 1, 0.0) is None
    assert step_speed(float("nan"), 1, 60.0) is None


def test_box_centre_keeps_sub_pixel_precision():
    assert box_center([10.2, 20.4, 30.7, 40.9]) == pytest.approx((20.45, 30.65))


def test_sub_pixel_motion_is_not_quantised_to_zero():
    before = box_center([100.0, 100.0, 200.0, 300.0])
    after = box_center([100.3, 100.0, 200.3, 300.0])
    distance = ((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2) ** 0.5
    assert step_speed(distance, 1, 60.0) == pytest.approx(18.0)
