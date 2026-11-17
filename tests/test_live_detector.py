"""Design 10.3 / 16.2: the causal detector."""

import math

import pytest

from helpers import ROOT  # noqa: F401
from live import detector as D
from live.constants import KP
from live_synth import frames, punching_pose, run, static_pose

# Five punches more than 0.35 s apart, rising in strength.
FIVE = [(0.3 + 0.5 * k, 0.7 + 0.06 * k) for k in range(5)]


def blue(events):
    return [e for e in events if e["corner"] == "blue"]


# ---------------------------------------------------------------- features

def test_limb_features_by_hand():
    pose = static_pose()
    f = D.limb_features(pose, "right", "punch-like")
    # shoulder (500,300), wrist (510,310), torso 100 px
    assert f["extension"] == pytest.approx(math.hypot(10, 10) / 100)
    # elbow (530,340): angle between (-30,-40) and (-20,-30)
    expected = math.degrees(math.acos((600 + 1200) / (50 * math.hypot(20, 30))))
    assert f["angle"] == pytest.approx(expected)


def test_keypoints_below_035_are_not_used():
    pose = static_pose()
    pose[KP["right_wrist"]][2] = 0.34
    f = D.limb_features(pose, "right", "punch-like")
    assert f["extension"] is None and f["angle"] is None
    pose[KP["right_wrist"]][2] = 0.35
    assert D.limb_features(pose, "right", "punch-like")["extension"] is not None


def test_limb_speed_needs_a_gap_of_at_most_005_s_and_a_plausible_value():
    det = D.Detector()
    a, b = static_pose(), static_pose()
    b[KP["right_wrist"]][0] += 10
    det.previous["blue"] = (0.0, a)
    assert det._limb_speeds("blue", 3 / 60, b)[("right", "punch-like")] == pytest.approx(200)
    assert ("right", "punch-like") not in det._limb_speeds("blue", 4 / 60, b)
    b[KP["right_wrist"]][0] += 100     # 110 px in 1/60 s = 6600 px/s
    assert ("right", "punch-like") not in det._limb_speeds("blue", 1 / 60, b)


def test_untracked_corner_records_null_features():
    det = D.Detector()
    det.add_frame(0, 0.0, {"blue": None, "red": None}, True)
    s = det.streams["blue"][("right", "punch-like")].store.samples[0]
    assert s.speed is None and s.extension is None and s.confidences is None


# ------------------------------------------------- smoothing and threshold

def test_trailing_median_and_threshold_warm_up():
    stream = D.Stream("right", "punch-like")
    s0 = stream.record(0, 0.0, 100.0, None)
    assert s0.smoothed is None                      # one value only
    s1 = stream.record(1, 1 / 60, 300.0, None)
    assert s1.smoothed == pytest.approx(200.0)      # median of two
    s2 = stream.record(2, 2 / 60, 900.0, None)
    assert s2.smoothed == pytest.approx(300.0)      # median of three
    s3 = stream.record(3, 3 / 60 + 0.1, 50.0, None) # earlier samples too old
    assert s3.smoothed is None
    assert s0.smoothed is None and s1.smoothed == pytest.approx(200)  # never revised


def test_threshold_is_400_until_60_samples_then_the_running_p90():
    stream = D.Stream("right", "punch-like")
    t = 0.0
    for i in range(61):
        s = stream.record(i, t, 1000.0 + i, None)
        t += 1 / 60
        if len(stream.threshold_values) < 60:
            assert s.threshold == 400.0
    assert len(stream.threshold_values) == 60
    assert s.threshold > 1000.0


# ---------------------------------------------------- events end to end

def test_five_punches_first_four_unscored_fifth_scored():
    events = blue(run(D.Detector(), frames(3.2, FIVE)))
    assert len(events) == 5
    assert [e["score_status"] for e in events] == ["unscored_warm_up"] * 4 + ["scored"]
    for e in events[:4]:
        assert e["kinematic_score"] is None and e["detection_class"] is None
    assert events[4]["pool_size"] == 5
    assert all(e["type"] == "punch-like" and e["side"] == "right" for e in events)


def test_speed_component_matches_the_formula():
    events = blue(run(D.Detector(), frames(3.2, FIVE)))
    last = events[-1]
    speeds = [e["smoothed_peak_speed"] for e in events]
    lower = sum(1 for v in speeds[:-1] if v < last["smoothed_peak_speed"])
    equal = sum(1 for v in speeds[:-1] if v == last["smoothed_peak_speed"]) + 1
    speed_component = 20 * (lower + (equal + 1) / 2) / 5
    rest = (30 * min(max(last["extension_gain"], 0), 0.3) / 0.3
            + 20 * min(max(last["angle_gain"], 0), 30) / 30
            + 20 * last["keypoint_confidence"]
            + 10 * min(max(last["retraction"], 0), 0.3) / 0.3)
    assert last["kinematic_score"] == pytest.approx(round(speed_component + rest, 2))


def test_pools_of_streams_are_independent():
    det = D.Detector()
    run(det, frames(3.2, FIVE))
    assert len(det.streams["blue"][("right", "punch-like")].pool) == 5
    assert all(len(s.pool) == 0 for k, s in det.streams["blue"].items() if k != ("right", "punch-like"))
    assert all(len(s.pool) == 0 for s in det.streams["red"].values())


def test_no_event_message_before_the_decision_time():
    det = D.Detector()
    for index, t, kps in frames(3.2, FIVE):
        for e in det.add_frame(index, t, kps, True):
            assert t >= e["peak_t"] + D.DECISION_DELAY - D.EPS


def test_streaming_causality_prefix_matches_full_run():
    seq = frames(3.2, FIVE)
    full = D.Detector()
    decided_at = []
    for index, t, kps in seq:
        for e in full.add_frame(index, t, kps, True):
            decided_at.append((t, e))
    for f in range(0, len(seq), 7):
        prefix = D.Detector()
        emitted = []
        for index, t, kps in seq[: f + 1]:
            emitted += prefix.add_frame(index, t, kps, True)
        t_f = seq[f][1]
        expected = [e for (t, e) in decided_at if t <= t_f]
        assert emitted == expected


def test_low_analysed_rate_gives_no_events_while_60_fps_does():
    seq = frames(3.2, FIVE)
    at_12 = [item for item in seq if item[0] % 5 == 0]
    assert blue(run(D.Detector(), at_12)) == []
    assert len(blue(run(D.Detector(), seq))) == 5


def test_stronger_later_rival_within_035_s_wins():
    # Two punches 0.3 s apart: separate peaks (>= 0.25 s) but rivals (< 0.35 s).
    punches = FIVE[:4] + [(2.5, 0.7), (2.8, 1.0)]
    events = blue(run(D.Detector(), frames(4.0, punches)))
    late = [e for e in events if e["peak_t"] > 2.4]
    assert len(late) == 1 and late[0]["peak_t"] > 2.8
    times = sorted(e["peak_t"] for e in events)
    assert all(b - a >= 0.35 - D.EPS for a, b in zip(times, times[1:]))


def test_stronger_earlier_rival_within_035_s_wins():
    punches = FIVE[:4] + [(2.5, 1.0), (2.8, 0.7)]
    events = blue(run(D.Detector(), frames(4.0, punches)))
    late = [e for e in events if e["peak_t"] > 2.4]
    assert len(late) == 1 and late[0]["peak_t"] < 2.7


def test_unscored_rivals_are_compared_by_smoothed_peak_speed():
    # Policy 2: during warm-up both are unscored; the faster one wins.
    events = blue(run(D.Detector(), frames(1.5, [(0.3, 0.6), (0.6, 1.0)])))
    assert len(events) == 1
    assert events[0]["score_status"] == "unscored_warm_up"
    assert events[0]["peak_t"] > 0.6


def test_mixed_scored_and_unscored_rivals_compare_by_speed():
    det = D.Detector()
    stream = det.streams["blue"][("right", "punch-like")]
    peak_a = D.Sample(0, 1.0, None, 900.0, 400.0, None, None, None)
    peak_b = D.Sample(1, 1.2, None, 1000.0, 400.0, None, None, None)
    a = D.Candidate(peak_a, {}, 90, 5, "held", "scored", 95.0, "Very Strong")
    b = D.Candidate(peak_b, {}, 90, 3, "held", "unscored_warm_up", None, None)
    assert b.beats(a) and not a.beats(b)      # the scored one has the higher score but the lower speed
    stream.pool += [a, b]


def test_equal_scores_keep_the_earlier_peak():
    pa = D.Sample(0, 1.0, None, 900.0, 400.0, None, None, None)
    pb = D.Sample(1, 1.2, None, 900.0, 400.0, None, None, None)
    a = D.Candidate(pa, {}, 90, 5, "held", "scored", 80.0, "Very Strong")
    b = D.Candidate(pb, {}, 90, 6, "held", "scored", 80.0, "Very Strong")
    assert a.beats(b) and not b.beats(a)


def test_classes_at_their_boundaries():
    assert [D.classify(s) for s in (80.0, 79.99, 65.0, 64.99, 50.0, 49.99)] == [
        "Very Strong", "Strong", "Strong", "Review", "Review", "Low"]


def test_frozen_scores_do_not_change_when_later_candidates_arrive():
    short = blue(run(D.Detector(), frames(3.2, FIVE)))
    longer = blue(run(D.Detector(), frames(5.0, FIVE + [(3.4, 1.2), (4.0, 0.5)])))
    assert longer[:5] == short


# ---------------------------------------------------------------- resets

def test_gap_over_025_s_discards_held_candidates_and_keeps_pools():
    seq = frames(3.2, FIVE)
    det = D.Detector()
    events = []
    # Punch 1 peaks near 0.35 s, becomes a held candidate near 0.63 s and would
    # be decided near 0.98 s. A 0.3 s gap in between discards it.
    cut = [item for item in seq if not (0.65 < item[1] < 0.95)]
    events = blue(run(det, cut))
    pool = det.streams["blue"][("right", "punch-like")].pool
    assert pool[0].status == "reset"              # punch 1, held at the gap
    assert det.discarded_by_resets == 1
    assert all(e["peak_t"] > 1.0 for e in events)  # punch 1 never emitted
    assert len(pool) == 4                          # but it stays in the ranking pool


def test_inactive_detection_resets_and_records_nothing():
    det = D.Detector()
    seq = frames(1.0, FIVE[:1])
    for index, t, kps in seq[:30]:
        det.add_frame(index, t, kps, True)
    stream = det.streams["blue"][("right", "punch-like")]
    assert stream.held or stream.pending
    det.add_frame(30, 30 / 60, seq[30][2], False)
    assert not stream.held and stream.pending is None
    assert stream.store.samples == []


# ------------------------------------------------------------------ swap

def test_swap_moves_history_and_held_candidates_with_the_person():
    seq = frames(3.2, FIVE)
    det = D.Detector()
    events = []
    swapped = False
    for index, t, kps in seq:
        if not swapped and t >= 2.45:
            det.swap()
            swapped = True
        if swapped:
            kps = {"blue": kps["red"], "red": kps["blue"]}
        events += det.add_frame(index, t, kps, True)
    events += det.finish(seq[-1][1])
    # Punches 1-3 were emitted before the swap and keep Blue. Punch 4 (peak
    # about 1.87 s, decided about 2.50 s) was held at the swap, and punch 5
    # came after it: both are emitted under Red, the person's new corner.
    before = [e for e in events if e["peak_t"] < 1.5]
    after = [e for e in events if e["peak_t"] > 1.5]
    assert [e["corner"] for e in before] == ["blue"] * 3
    assert [e["corner"] for e in after] == ["red", "red"]
    assert after[-1]["score_status"] == "scored"     # the person's own pool of 4 came along
    assert all(len(s.pool) == 0 for s in det.streams["blue"].values())


# ------------------------------------------------------------ session end

class SpyStore(D.SampleStore):
    reads = []

    def window(self, t0, t1):
        out = super().window(t0, t1)
        SpyStore.reads += [s.t for s in out]
        return out


def test_video_end_finalises_with_recorded_samples_only(monkeypatch):
    monkeypatch.setattr(D, "SampleStore", SpyStore)
    SpyStore.reads = []
    # Last punch peaks about 0.05 s after 2.8 s; the video ends at 3.15 s:
    # its decision time (about 3.48 s) never comes, so only finish() can emit it.
    seq = frames(3.15, FIVE[:4] + [(2.8, 1.0)])
    det = D.Detector()
    during = []
    for index, t, kps in seq:
        during += det.add_frame(index, t, kps, True)
    t_last = seq[-1][1]
    SpyStore.reads = []
    final = det.finish(t_last)
    assert all(t <= t_last + D.EPS for t in SpyStore.reads)
    assert len(blue(final)) == 1 and blue(final)[0]["peak_t"] > 2.8
    assert final == sorted(final, key=lambda e: e["peak_t"])


def test_peak_too_close_to_the_end_is_never_emitted():
    # Peak about 0.1 s before the end: its post window cannot be complete.
    seq = frames(3.0, FIVE[:4] + [(2.85, 1.0)])
    final_events = blue(run(D.Detector(), seq))
    assert all(e["peak_t"] < 2.8 for e in final_events)


def test_peak_with_no_usable_post_window_sample_is_discarded_not_filled():
    seq = frames(1.2, [(0.3, 1.0)])
    for index, t, kps in seq:
        if 0.44 <= t <= 0.58:          # the whole post window: wrist hidden
            kps["blue"] = [list(p) for p in kps["blue"]]
            kps["blue"][KP["right_wrist"]][2] = 0.1
    assert blue(run(D.Detector(), seq)) == []


@pytest.mark.parametrize("reason", ["stopped", "disconnected", "crashed"])
def test_other_end_reasons_discard_unfinished_candidates(reason):
    seq = frames(3.15, FIVE[:4] + [(2.8, 1.0)])
    det = D.Detector()
    emitted = []
    for index, t, kps in seq:
        emitted += det.add_frame(index, t, kps, True)
    snapshot = [dict(e) for e in emitted]
    dropped = det.discard()
    assert dropped >= 1
    assert emitted == snapshot
    with pytest.raises(RuntimeError):
        det.add_frame(999, 9.0, {"blue": punching_pose(9.0, []), "red": None}, True)
