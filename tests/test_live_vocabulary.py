"""Design 15: every live message is provisional, has only allowed fields, and
never uses verdict vocabulary. Messages come from a real EngineCore run."""

import re

from helpers import ROOT  # noqa: F401
from live_synth import FIVE_PUNCHES
from test_live_engine import FPS, make, play_through

ALLOWED = {
    "ready": {"type", "provisional", "device", "model", "video"},
    "frame": {"type", "provisional", "t", "frame_index", "corners", "metrics"},
    "event": {"type", "provisional", "corner", "side", "strike_type", "peak_t", "peak_frame",
              "smoothed_peak_speed", "extension_gain", "angle_gain", "retraction",
              "keypoint_confidence", "first_stage_score", "pool_size", "score_status",
              "kinematic_score", "detection_class"},
    "identity": {"type", "provisional", "kind", "corner", "frame", "t", "track_id", "cost",
                 "margin", "reason"},
    "stats": {"type", "provisional", "frames_analysed", "frames_skipped", "analysed_rate",
              "detection_active", "detection_inactive_reason", "events_emitted",
              "strike_like_events_per_minute", "events_per_minute_basis_seconds",
              "unscored_event_count", "per_corner", "held_candidates_discarded_by_resets",
              "duplicates_discarded", "position_t"},
    "clock_rejected": {"type", "provisional", "t", "position", "reason"},
    "ended": {"type", "provisional", "reason"},
    "error": {"type", "provisional", "message", "log_tail"},
}
CORNER_FIELDS = {"state", "track_id", "box", "keypoints"}
METRIC_FIELDS = {"distance_px", "distance_percent_diagonal", "blue_speed_px_s", "red_speed_px_s",
                 "keypoint_confidence", "fighters_tracked", "keypoints_tracked",
                 "strike_like_events_per_minute"}
FORBIDDEN = re.compile(r"\b(landed|hit|hits|damage|winner|probability|confidence_percent)\b", re.I)


def all_text(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k)
            yield from all_text(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from all_text(v)
    elif isinstance(value, str):
        yield value


def messages_from_a_full_run():
    n = int(6 * FPS)
    core, messages, clock = make(n=n, punches=FIVE_PUNCHES)
    core.ready()
    play_through(core, clock, n // 2)
    core.inbox.put({"type": "swap"})
    core.inbox.put({"type": "clock", "t": 0.1, "playing": True})     # backward: rejected
    core.step()
    play_through(core, clock, n)
    core.finish("video_end")
    messages.append({"type": "error", "provisional": True, "message": "the engine exited with code 1",
                     "log_tail": ["loading yolo11n-pose.pt on cpu"]})
    return messages


def test_every_message_type_is_covered_and_within_its_allow_list():
    messages = messages_from_a_full_run()
    assert set(ALLOWED) == {m["type"] for m in messages}
    for m in messages:
        assert set(m) <= ALLOWED[m["type"]], (m["type"], set(m) - ALLOWED[m["type"]])
        assert m["provisional"] is True
        if m["type"] == "frame":
            assert set(m["metrics"]) <= METRIC_FIELDS
            for corner in m["corners"].values():
                assert set(corner) <= CORNER_FIELDS


def test_no_verdict_vocabulary_anywhere():
    for m in messages_from_a_full_run():
        for text in all_text(m):
            assert not FORBIDDEN.search(text), (m["type"], text)


def test_the_forbidden_pattern_catches_each_term():
    for term in ("landed", "hit", "damage", "winner", "probability", "confidence_percent"):
        assert FORBIDDEN.search(f"a {term} here")
    assert not FORBIDDEN.search("white keypoints")
