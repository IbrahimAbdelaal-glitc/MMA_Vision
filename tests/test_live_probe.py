"""The probe on real files: OpenCV's FFMPEG backend plus ffprobe packets (design 6)."""

from pathlib import Path

import pytest

from helpers import ROOT
from live import probe

FIXTURES = Path(__file__).resolve().parent / "fixtures"

# The user's two real clips, when they are on this machine (the jobs/ folder
# is not version-controlled). Identified by size: 6 s clip and 15 s clip.
REAL = {}
for path in sorted((ROOT / "jobs").glob("*/input/input.mp4")):
    REAL.setdefault(path.stat().st_size, path)
CLIP_6S = REAL.get(6119753)
CLIP_15S = REAL.get(15230609)

needs_ffprobe = pytest.mark.skipif(probe.find_ffprobe() is None, reason="ffprobe not installed")


@needs_ffprobe
def test_self_check_passes_on_the_bundled_fixture():
    result = probe.run_self_check()
    assert result["passed"], result["detail"]


@needs_ffprobe
def test_60_fps_b_frame_fixture_is_accepted_by_sorted_matching():
    result = probe.run_probe(FIXTURES / "bframes_60.mp4")
    assert result["accepted"]
    assert result["frame_count"] == 120
    assert len(result["timestamps_ms"]) == 120
    assert result["start_offset_ms"] == pytest.approx(0.0)


@needs_ffprobe
def test_30_fps_fixture_is_rejected_by_t9_alone():
    with pytest.raises(probe.ProbeRejected) as caught:
        probe.run_probe(FIXTURES / "bframes_30.mp4")
    failed = [name for name, rule in caught.value.rules.items() if rule["passed"] is False]
    assert failed == ["T9"]


@needs_ffprobe
def test_timestamp_jump_fixture_is_rejected_by_t7_t8_t9_and_passes_t4():
    with pytest.raises(probe.ProbeRejected) as caught:
        probe.run_probe(probe.FIXTURE)
    rules = caught.value.rules
    assert rules["T4"]["passed"] is True
    assert {n for n, r in rules.items() if r["passed"] is False} == {"T7", "T8", "T9"}


@needs_ffprobe
def test_a_file_that_is_not_a_video_is_rejected(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video at all")
    with pytest.raises(probe.ProbeRejected):
        probe.run_probe(bad)


def test_missing_ffprobe_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("MMA_FFPROBE", str(tmp_path / "nowhere.exe"))
    with pytest.raises(probe.ProbeUnavailable):
        probe.run_probe(FIXTURES / "bframes_60.mp4")


@needs_ffprobe
def test_a_probe_that_runs_too_long_is_rejected():
    with pytest.raises(probe.ProbeRejected, match="timed out"):
        probe.run_probe(FIXTURES / "bframes_60.mp4", timeout=0.01)


@needs_ffprobe
@pytest.mark.skipif(CLIP_6S is None, reason="6 s real clip not on this machine")
def test_real_6s_clip_is_accepted_with_its_36_ms_start_offset():
    result = probe.run_probe(CLIP_6S)
    assert result["accepted"]
    assert result["frame_count"] == 360
    assert result["start_offset_ms"] == pytest.approx(36.0, abs=0.01)


@needs_ffprobe
@pytest.mark.skipif(CLIP_15S is None, reason="15 s real clip not on this machine")
def test_real_15s_clip_with_b_frames_is_accepted():
    result = probe.run_probe(CLIP_15S)
    assert result["accepted"]
    assert result["frame_count"] == 900


# drift_60.mp4 is built by tests/fixtures/make_drift_fixture.py (PyAV). 61 frames
# in a 1/60000 s time base: gaps 1-30 are period + 0.9 ms, gaps 31-60 period - 0.9 ms,
# so every gap passes T7, frame 30 is 27 ms late, and the last frame is on time.
DRIFT_FIXTURE = FIXTURES / "drift_60.mp4"


@needs_ffprobe
def test_real_mp4_drift_fixture_is_rejected_by_t8_alone():
    """Design 6.3: T8 rejects drift that T7 cannot see, in a real file (OpenCV + ffprobe)."""

    with pytest.raises(probe.ProbeRejected) as caught:
        probe.run_probe(DRIFT_FIXTURE)
    rules = caught.value.rules
    failed = [name for name, rule in rules.items() if rule["passed"] is False]
    assert failed == ["T8"]
    assert rules["T8"]["detail"].startswith("worst deviation 27.000 ms at frame 30")
    # Decoded frames really carry the file's packet timestamps, at a reported 60 fps,
    # and each single gap stays inside T7's tolerance.
    assert rules["T4"]["passed"] is True
    assert rules["T2"]["detail"].startswith("fps 60.0, 61 frames")
    assert rules["T7"]["detail"].startswith("worst gap error 0.900 ms")
    assert rules["T9"]["passed"] is True


def test_drift_fixture_packets_carry_the_drift():
    """Read the committed file's packets directly, independent of the probe's two readers."""

    av = pytest.importorskip("av")
    from fixtures.make_drift_fixture import presentation_ticks

    with av.open(str(DRIFT_FIXTURE)) as container:
        stream = container.streams.video[0]
        assert stream.time_base.denominator == 60000
        pts = [p.pts for p in container.demux(stream) if p.pts is not None]
    assert pts == presentation_ticks()
    assert pts[30] - 30 * 1000 == 30 * 54          # 27 ms late at frame 30
    assert pts[-1] == 60 * 1000                    # on time at the last frame


@needs_ffprobe
def test_same_fixture_without_drift_is_accepted(tmp_path):
    """Control: the identical generator with constant spacing passes T1-T9,
    so the rejection above comes from the drift, not from the codec or container."""

    pytest.importorskip("av")
    from fixtures.make_drift_fixture import build

    path = tmp_path / "steady_60.mp4"
    build(path, drift=0)
    result = probe.run_probe(path)
    assert result["accepted"]
    assert result["frame_count"] == 61
    assert result["fps"] == pytest.approx(60.0)
