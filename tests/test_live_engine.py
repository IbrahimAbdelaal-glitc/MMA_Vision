"""Design 7, 8, 14: the engine core with an injected capture, model and clock."""

import csv

import pytest

from helpers import ROOT  # noqa: F401
from live.engine import EngineCore
from live.identity import Person
from live_synth import FIVE_PUNCHES, punching_pose, static_pose

FPS = 60.0


class FakeCapture:
    def __init__(self, n, fps=FPS, drift_at=None):
        self.n, self.fps, self.drift_at = n, fps, drift_at
        self.index = -1
        self.retrieved = []

    def grab(self):
        if self.index + 1 >= self.n:
            return False
        self.index += 1
        return True

    def pos_msec(self):
        ms = self.index * 1000.0 / self.fps
        if self.drift_at is not None and self.index >= self.drift_at:
            ms += 5.0
        return ms

    def retrieve(self):
        self.retrieved.append(self.index)
        return self.index


def box_for(kps):
    xs = [p[0] for p in kps if p[2] > 0.5]
    ys = [p[1] for p in kps if p[2] > 0.5]
    return (min(xs) - 20, min(ys) - 60, max(xs) + 20, max(ys) + 20)


class FakeModel:
    """Blue is tracker ID 1 and punches; Red is tracker ID 2 and stands still."""

    def __init__(self, punches=()):
        self.punches = list(punches)
        self.calls = 0

    def __call__(self, frame_index):
        self.calls += 1
        t = frame_index / FPS
        blue = punching_pose(t, self.punches)
        red = static_pose(400)
        return [Person(1, box_for(blue), blue), Person(2, box_for(red), red)]


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def make(n=120, punches=(), out_dir=None, drift_at=None):
    messages = []
    clock = Clock()
    core = EngineCore(timestamps_ms=[i * 1000.0 / FPS for i in range(n)], fps=FPS,
                      width=1280, height=720, capture=FakeCapture(n, drift_at=drift_at),
                      model=FakeModel(punches), emit=messages.append, out_dir=out_dir,
                      clock=clock, stats_interval=1e9)
    return core, messages, clock


def of(messages, kind):
    return [m for m in messages if m["type"] == kind]


def play_through(core, clock, n, step_frames=1):
    """Advance the browser clock frame by frame, one engine step per clock tick."""
    reason = None
    i = 0
    while i < n:
        clock.now += step_frames / FPS
        core.inbox.put({"type": "clock", "t": i / FPS, "playing": True})
        reason = core.step()
        if reason not in (None, "idle"):
            return reason
        i += step_frames
    return reason


def test_ready_reports_device_and_video_and_every_message_is_provisional():
    core, messages, _ = make()
    core.ready()
    ready = messages[0]
    assert ready["type"] == "ready" and ready["device"] == "cpu"
    assert ready["video"] == {"fps": FPS, "frame_count": 120, "width": 1280, "height": 720}
    assert all(m["provisional"] is True for m in messages)


def test_nothing_is_analysed_without_a_playing_clock():
    core, messages, clock = make()
    assert core.step() == "idle"
    core.inbox.put({"type": "clock", "t": 0.5, "playing": False})
    assert core.step() == "idle"
    assert of(messages, "frame") == []


def test_latest_frame_wins_and_skipped_frames_are_grabbed_not_decoded():
    core, messages, clock = make()
    core.inbox.put({"type": "clock", "t": 0.5, "playing": True})
    assert core.step() is None
    frames = of(messages, "frame")
    assert [f["frame_index"] for f in frames] == [30]
    assert core.capture.retrieved == [30]
    assert core.pacer.skipped == 30
    assert frames[0]["t"] == pytest.approx(0.5)


def test_frame_message_has_corners_and_null_safe_metrics():
    core, messages, clock = make()
    core.inbox.put({"type": "clock", "t": 0.0, "playing": True})
    core.step()
    frame = of(messages, "frame")[0]
    assert frame["corners"]["blue"]["state"] == "tracked"
    assert frame["corners"]["blue"]["track_id"] == 1
    assert len(frame["corners"]["red"]["keypoints"]) == 17
    metrics = frame["metrics"]
    assert metrics["fighters_tracked"] == 2
    assert metrics["blue_speed_px_s"] is None          # no previous frame yet
    assert metrics["strike_like_events_per_minute"] is None


def test_backward_clock_is_rejected_and_never_rewinds():
    core, messages, clock = make()
    core.inbox.put({"type": "clock", "t": 1.0, "playing": True})
    core.step()
    core.inbox.put({"type": "clock", "t": 0.2, "playing": True})
    assert core.step() == "idle"
    rejected = of(messages, "clock_rejected")
    assert len(rejected) == 1 and rejected[0]["position"] == pytest.approx(1.0)
    assert [f["frame_index"] for f in of(messages, "frame")] == [60]


def test_malformed_clock_messages_are_ignored():
    core, messages, clock = make()
    for bad in ({"type": "clock"}, {"type": "clock", "t": "x"}, {"type": "clock", "t": float("nan")}):
        core.inbox.put(dict(bad, playing=True))
    assert core.step() == "idle"
    assert of(messages, "frame") == [] and of(messages, "clock_rejected") == []


def test_silent_client_pauses_analysis():
    core, messages, clock = make()
    core.inbox.put({"type": "clock", "t": 0.1, "playing": True})
    core.step()
    clock.now = 2.5                                     # 2.5 s without a clock message
    core.pacer.limit = 1.0
    assert core.step() == "idle"


def test_swap_moves_identity_and_is_logged():
    core, messages, clock = make()
    core.inbox.put({"type": "clock", "t": 0.1, "playing": True})
    core.step()
    core.inbox.put({"type": "swap"})
    core.inbox.put({"type": "clock", "t": 0.2, "playing": True})
    core.step()
    swaps = [m for m in of(messages, "identity") if m.get("kind") == "swap"]
    assert len(swaps) == 1
    last = of(messages, "frame")[-1]
    assert last["corners"]["blue"]["track_id"] == 2
    assert last["corners"]["red"]["track_id"] == 1


def test_stop_message_ends_the_session_with_its_reason():
    core, messages, clock = make()
    core.inbox.put({"type": "stop", "reason": "stopped"})
    assert core.step() == "stopped"
    core.finish("stopped")
    assert of(messages, "ended")[-1]["reason"] == "stopped"


def test_stdin_eof_ends_the_session():
    core, messages, clock = make()
    core.inbox.put({"type": "eof"})
    assert core.step() == "stopped"


def test_full_playback_reaches_video_end_and_emits_strike_like_events(tmp_path):
    n = int(3.6 * FPS)
    core, messages, clock = make(n=n, punches=FIVE_PUNCHES, out_dir=tmp_path)
    reason = play_through(core, clock, n)
    assert reason == "video_end"
    core.finish(reason)
    events = of(messages, "event")
    assert len(events) == 5
    assert all(e["strike_type"] == "punch-like" and e["corner"] == "blue" for e in events)
    assert [e["score_status"] for e in events] == ["unscored_warm_up"] * 4 + ["scored"]
    assert events[-1]["detection_class"] in {"Very Strong", "Strong", "Review", "Low"}
    stats = of(messages, "stats")[-1]
    assert stats["frames_analysed"] == n and stats["frames_skipped"] == 0
    assert stats["unscored_event_count"] == 4
    assert of(messages, "ended")[-1]["reason"] == "video_end"
    with (tmp_path / "events.csv").open(encoding="utf-8") as f:
        assert len(list(csv.DictReader(f))) == 5
    with (tmp_path / "track.csv").open(encoding="utf-8") as f:
        assert len(list(csv.DictReader(f))) == 2 * n


def test_events_per_minute_appears_after_5_s_of_active_detection():
    n = int(6 * FPS)
    core, messages, clock = make(n=n, punches=FIVE_PUNCHES)
    play_through(core, clock, n)
    values = [f["metrics"]["strike_like_events_per_minute"] for f in of(messages, "frame")]
    assert values[int(4.5 * FPS)] is None
    assert values[-1] is not None


def test_slow_analysis_inactivates_detection_and_gives_no_events():
    n = int(3.6 * FPS)
    core, messages, clock = make(n=n, punches=FIVE_PUNCHES)
    play_through(core, clock, n, step_frames=8)       # 7.5 analysed frames per second
    assert of(messages, "event") == []
    stats = core.stats()
    assert stats["detection_active"] is False
    assert "below 10" in stats["detection_inactive_reason"]
    assert stats["frames_skipped"] > 0


def test_timing_mismatch_stops_with_an_error_and_exit_code_3():
    core, messages, clock = make(drift_at=10)
    core.inbox.put({"type": "clock", "t": 0.5, "playing": True})
    assert core.run() == 3
    errors = of(messages, "error")
    assert len(errors) == 1 and "verified timing" in errors[0]["message"]


def test_run_loop_ends_on_stop_and_writes_ended(tmp_path):
    core, messages, clock = make(out_dir=tmp_path)
    core.inbox.put({"type": "clock", "t": 0.3, "playing": True})
    core.inbox.put({"type": "stop", "reason": "stopped"})
    assert core.run(idle_sleep=0.001) == 0
    assert messages[0]["type"] == "ready"
    assert messages[-1] == {"type": "ended", "reason": "stopped", "provisional": True}
    assert core.logs is None                           # files closed
