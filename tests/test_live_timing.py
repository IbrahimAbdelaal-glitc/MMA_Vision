"""Design 6.3 acceptance rules T1-T9 and the 6.6 runtime check, on lists."""

import random

import pytest

from helpers import ROOT  # noqa: F401  (puts the project root on sys.path)
from live.timing import Meta, check_rules, runtime_check

PERIOD = 1000 / 60


def meta(fps=60.0, frames=60, backend="FFMPEG", width=64, height=36):
    return Meta(backend=backend, fps=fps, frame_count=frames, width=width, height=height)


def cfr(n=60, fps=60.0, offset=0.0):
    return [offset + i * 1000 / fps for i in range(n)]


def failed(report):
    return report.failed


def test_a_clean_60_fps_list_passes_every_rule():
    ts = cfr()
    report = check_rules(meta(), ts, list(ts))
    assert failed(report) == []
    assert report.ok


def test_packets_in_decoding_order_match_by_sorted_position():
    ts = cfr()
    packets = list(ts)
    # B-frame style: I P B B -> packet order 0 3 1 2, 4 7 5 6, ...
    reordered = []
    for k in range(0, 60, 4):
        group = packets[k:k + 4]
        reordered += [group[0], group[3], group[1], group[2]]
    report = check_rules(meta(), ts, reordered)
    assert failed(report) == []


def test_packet_times_are_taken_relative_to_the_earliest():
    ts = cfr()
    packets = [t + 36.0 for t in ts]
    random.Random(1).shuffle(packets)
    report = check_rules(meta(), ts, packets)
    assert failed(report) == []
    assert report.start_offset_ms == pytest.approx(36.0)


@pytest.mark.parametrize("change", ["missing", "repeated", "extra_decoded", "missing_decoded"])
def test_t4_rejects_packet_and_frame_disagreements(change):
    ts = cfr()
    packets = list(ts)
    decoded = list(ts)
    m = meta()
    if change == "missing":
        packets[10] = None
    elif change == "repeated":
        packets[11] = packets[10]
    elif change == "extra_decoded":
        decoded.append(decoded[-1] + PERIOD)
    elif change == "missing_decoded":
        decoded.pop()
    report = check_rules(m, decoded, packets)
    assert "T4" in failed(report)


def test_t4_rejects_a_decoded_time_off_by_more_than_half_a_millisecond():
    ts = cfr()
    decoded = list(ts)
    decoded[20] += 0.6
    assert "T4" in failed(check_rules(meta(), decoded, list(ts)))
    decoded[20] = ts[20] + 0.4
    assert "T4" not in failed(check_rules(meta(), decoded, list(ts)))


def test_t1_requires_the_ffmpeg_backend():
    ts = cfr()
    assert "T1" in failed(check_rules(meta(backend="MSMF"), ts, list(ts)))


@pytest.mark.parametrize("kwargs", [{"fps": 0.0}, {"fps": float("nan")}, {"frames": 0}, {"width": 0}, {"height": 0}])
def test_t2_requires_metadata(kwargs):
    ts = cfr()
    m = meta(**kwargs)
    assert "T2" in failed(check_rules(m, ts, list(ts)))


def test_t3_rejects_missing_timestamps():
    ts = cfr()
    decoded = list(ts)
    decoded[5] = 0.0
    assert "T3" in failed(check_rules(meta(), decoded, list(ts)))
    decoded[5] = float("nan")
    assert "T3" in failed(check_rules(meta(), decoded, list(ts)))


def test_t5_requires_the_first_frame_near_zero():
    ts = cfr(offset=10.0)
    assert "T5" in failed(check_rules(meta(), ts, None))


def test_t6_requires_strictly_increasing_times():
    ts = cfr()
    ts[30], ts[31] = ts[31], ts[30]
    assert "T6" in failed(check_rules(meta(), ts, None))


def test_t7_and_t8_reject_a_jump():
    ts = cfr()
    ts = ts[:30] + [t + 100 for t in ts[30:]]
    f = failed(check_rules(meta(), ts, None))
    assert "T7" in f and "T8" in f


def test_synthetic_drift_fails_t8_only():
    """Design 6.3: 30 gaps 0.9 ms long, then 29 gaps 0.9 ms short."""
    t = [0.0]
    for k in range(59):
        t.append(t[-1] + PERIOD + (0.9 if k < 30 else -0.9))
    report = check_rules(meta(), t, None)
    assert report.failed == ["T8"]
    assert report.results["T4"].passed is None  # no container to compare with


def test_t9_accepts_only_60_fps():
    ts30 = cfr(fps=30.0)
    assert check_rules(meta(fps=30.0), ts30, list(ts30)).failed == ["T9"]
    ts50 = cfr(fps=50.0)
    assert check_rules(meta(fps=50.0), ts50, list(ts50)).failed == ["T9"]
    ntsc = 60000 / 1001
    ts = cfr(fps=ntsc)
    assert check_rules(meta(fps=ntsc), ts, list(ts)).failed == []
    for fps in (59.89, 60.11):
        ts = cfr(fps=fps)
        assert check_rules(meta(fps=fps), ts, list(ts)).failed == ["T9"]


def test_reported_fps_that_disagrees_with_timestamps_is_rejected():
    ts = cfr()
    # Each gap is only 0.26 ms off the 60.962 fps period (inside T7), but the
    # error accumulates, so T8 rejects it; T9 rejects the rate as well.
    f = failed(check_rules(meta(fps=60.962), ts, list(ts)))
    assert f == ["T8", "T9"]


def test_report_explains_each_rule():
    ts = cfr()
    report = check_rules(meta(fps=30.0), ts, list(ts))
    assert set(report.results) == {f"T{i}" for i in range(1, 10)}
    assert "30" in report.results["T9"].detail


# ---------------------------------------------------------------- runtime

VERIFIED = cfr(n=10)


def test_runtime_check_accepts_the_verified_time():
    assert runtime_check(3, VERIFIED[3] + 0.3, VERIFIED, 60.0) is None


def test_runtime_check_rejects_a_time_far_from_the_verified_one():
    assert runtime_check(3, VERIFIED[3] + 0.6, VERIFIED, 60.0) is not None


def test_runtime_check_rejects_a_time_that_breaks_t8():
    drifted = list(VERIFIED)
    drifted[5] += 1.4  # the verified list itself would have failed T8
    assert runtime_check(5, drifted[5], drifted, 60.0) is not None


def test_runtime_check_rejects_an_index_past_the_end():
    assert runtime_check(10, VERIFIED[-1] + PERIOD, VERIFIED, 60.0) is not None
