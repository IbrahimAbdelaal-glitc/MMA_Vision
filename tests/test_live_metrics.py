"""Design 10.1-10.2 and 8: metrics, analysed rate, events per minute."""

import pytest

from helpers import ROOT  # noqa: F401
from live.identity import Person
from live.metrics import EventRate, RateMeter, frame_metrics


def person(x, y, conf=0.9):
    return Person(1, (x - 50, y - 100, x + 50, y + 100), [[0, 0, conf]] * 17)


def test_distance_and_speed_use_verified_times():
    prev = (1.0, {"blue": person(100, 100), "red": person(400, 500)})
    m = frame_metrics(1.1, {"blue": person(130, 140), "red": person(400, 500)}, prev, 1000.0, None)
    assert m["blue_speed_px_s"] == pytest.approx(50 / 0.1)
    assert m["red_speed_px_s"] == pytest.approx(0.0)
    assert m["distance_px"] == pytest.approx(((270) ** 2 + 360 ** 2) ** 0.5)
    assert m["distance_percent_diagonal"] == pytest.approx(m["distance_px"] / 10)
    assert m["fighters_tracked"] == 2
    assert m["keypoints_tracked"] == 24
    assert m["keypoint_confidence"] == pytest.approx(0.9)


def test_nulls_when_a_fighter_is_missing_or_the_gap_is_too_long():
    prev = (1.0, {"blue": person(100, 100), "red": None})
    m = frame_metrics(1.01, {"blue": person(110, 100), "red": None}, prev, 1000.0, None)
    assert m["distance_px"] is None and m["red_speed_px_s"] is None
    m = frame_metrics(1.3, {"blue": person(110, 100), "red": None}, prev, 1000.0, None)
    assert m["blue_speed_px_s"] is None
    m = frame_metrics(1.0, {"blue": None, "red": None}, None, 1000.0, None)
    assert m["keypoint_confidence"] is None and m["fighters_tracked"] == 0


def test_detection_threshold_is_the_rate_limb_speed_needs():
    """Limb speed is only measured between samples at most 0.05 s apart
    (LIMB_SPEED_MAX_GAP), so detection cannot work below 20 analysed frames
    per second; the threshold is derived from that rule, not set beside it."""
    from live import constants as K
    assert K.LIMB_SPEED_MAX_GAP == pytest.approx(0.05)
    assert K.MIN_ANALYSED_RATE == pytest.approx(1.0 / K.LIMB_SPEED_MAX_GAP)
    assert K.MIN_ANALYSED_RATE == pytest.approx(20.0)


def test_rate_meter_reports_detection_active_from_20_frames_per_second():
    meter = RateMeter()
    results = [meter.update(i / 24) for i in range(60)]
    assert results[0][0] is False
    assert results[-1][0] is True and results[-1][1] == pytest.approx(24, abs=1.2)
    meter = RateMeter()
    results = [meter.update(i / 12) for i in range(40)]       # active under the old 10 /s rule
    assert results[-1][0] is False
    assert "below 20" in results[-1][2] and "0.05 s" in results[-1][2]


def scored(score, corner="blue"):
    return {"corner": corner, "score_status": "scored", "kinematic_score": score}


def unscored(corner="blue"):
    return {"corner": corner, "score_status": "unscored_warm_up", "kinematic_score": None}


def test_events_per_minute_counts_only_scored_events_at_65_or_more():
    rate = EventRate()
    for e in (scored(65.0), scored(64.99), scored(80.0), unscored(), scored(50.0, "red")):
        rate.add_event(e)
    for _ in range(600):
        rate.add_interval(1 / 60)        # 10 s of active detection
    assert rate.count == 2
    assert rate.unscored == 1
    assert rate.per_minute == pytest.approx(2 / (10 / 60))
    assert rate.per_corner["blue"] == {"scored": 3, "unscored": 1, "counted": 2}


def test_events_per_minute_is_null_below_5_s_and_ignores_long_gaps():
    rate = EventRate()
    rate.add_event(scored(90))
    rate.add_interval(4.9)       # one interval this long is a gap, not detection time
    assert rate.basis == 0
    for _ in range(294):
        rate.add_interval(1 / 60)
    assert rate.per_minute is None
    for _ in range(12):
        rate.add_interval(1 / 60)
    assert rate.per_minute is not None


def test_same_value_whether_or_not_frames_were_skipped():
    a, b = EventRate(), EventRate()
    for _ in range(600):
        a.add_interval(1 / 60)
    for _ in range(200):
        b.add_interval(3 / 60)
    assert a.basis == pytest.approx(b.basis)
