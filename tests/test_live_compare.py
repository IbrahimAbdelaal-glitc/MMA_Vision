"""Design 12: identity comparison."""

import json

import pytest

from helpers import ROOT  # noqa: F401
from live.compare import compare, frame_outcome, read_complete_rows, summarise

DIAG = 1000.0
FPS = 60.0
OFF = {"blue": (100.0, 100.0), "red": (600.0, 100.0)}


def live(t, frame, blue=("tracked", 100, 100), red=("tracked", 600, 100)):
    return {"frame": frame, "t": t, "blue": blue, "red": red}


def test_same_pairing_agrees_and_crossed_disagrees():
    assert frame_outcome(live(0, 0), OFF, DIAG) == ("agree", None)
    crossed = live(0, 0, blue=("tracked", 600, 100), red=("tracked", 100, 100))
    assert frame_outcome(crossed, OFF, DIAG) == ("disagree", None)


def test_tie_and_clinch_are_ambiguous():
    tie = live(0, 0, blue=("tracked", 350, 100), red=("tracked", 350, 100))
    assert frame_outcome(tie, OFF, DIAG) == ("not_compared", "ambiguous")
    clinch_off = {"blue": (300.0, 100.0), "red": (310.0, 100.0)}
    clinch = live(0, 0, blue=("tracked", 302, 100), red=("tracked", 308, 100))
    assert frame_outcome(clinch, clinch_off, DIAG) == ("not_compared", "ambiguous")


def test_far_from_both_is_ambiguous_by_the_gate():
    far = live(0, 0, blue=("tracked", 100, 300), red=("tracked", 600, 300))   # 0.2 of the diagonal away
    assert frame_outcome(far, OFF, DIAG) == ("not_compared", "ambiguous")


def test_not_compared_reasons_in_order():
    both = live(0, 0, blue=("uncertain", None, None), red=("lost", None, None))
    assert frame_outcome(both, OFF, DIAG) == ("not_compared", "live_uncertain")
    lost = live(0, 0, red=("lost", None, None))
    assert frame_outcome(lost, OFF, DIAG) == ("not_compared", "live_lost")
    assert frame_outcome(live(0, 0), None, DIAG) == ("not_compared", "offline_missing")


def test_both_live_fighters_never_match_one_offline_fighter():
    # Both live fighters next to final Blue: neither pairing puts both on Blue,
    # and the crossed pairing fails the gate, so the frame is ambiguous.
    both_on_blue = live(0, 0, blue=("tracked", 100, 100), red=("tracked", 110, 100))
    assert frame_outcome(both_on_blue, OFF, DIAG) == ("not_compared", "ambiguous")


def frames_at(n, step=1 / 60, **kw):
    return [live(i * step, i, **kw) for i in range(n)]


def test_time_accounting_and_final_frame_covers_one_period():
    frames = frames_at(10) + [live(10 / 60 + 0.5, 40)]     # a 0.5 s gap before the last frame
    offline = {f["frame"]: OFF for f in frames}
    r = summarise(frames, offline, DIAG, FPS, [])
    assert r["state"] == "agree"
    assert r["covered_seconds"] == pytest.approx(9 / 60 + 0.25 + 1 / 60, abs=1e-3)
    assert r["live_span_seconds"] == pytest.approx(10 / 60 + 0.5 + 1 / 60, abs=1e-3)
    assert r["uncovered_seconds"] == pytest.approx(0.5 + 1 / 60 - 0.25, abs=1e-3)   # gap 9/60 -> 10/60 + 0.5
    assert r["covered_seconds"] == pytest.approx(r["compared_seconds"] + sum(r["not_compared_seconds"].values()))


def test_disagreement_interval_excludes_trailing_not_compared_frames():
    swapped = ("tracked", 600, 100), ("tracked", 100, 100)
    frames = (frames_at(5)
              + [live(i / 60, i, blue=swapped[0], red=swapped[1]) for i in range(5, 10)]
              + [live(i / 60, i, red=("lost", None, None)) for i in range(10, 13)]
              + [live(i / 60, i) for i in range(13, 20)])
    offline = {f["frame"]: OFF for f in frames}
    log = [{"kind": "re-association", "corner": "blue", "t": "0.09"}]
    r = summarise(frames, offline, DIAG, FPS, log)
    assert r["state"] == "disagree"
    assert len(r["intervals"]) == 1
    interval = r["intervals"][0]
    assert interval["start"] == pytest.approx(5 / 60, abs=1e-3)
    assert interval["end"] == pytest.approx(10 / 60, abs=1e-3)
    assert interval["not_compared_seconds"] == 0
    assert interval["identity_log_entry"] == "re-association (blue) at 0.09 s"


def test_not_compared_frames_inside_an_interval_are_reported():
    sw = dict(blue=("tracked", 600, 100), red=("tracked", 100, 100))
    frames = ([live(0, 0, **sw), live(1 / 60, 1, red=("lost", None, None)), live(2 / 60, 2, **sw)]
              + [live(3 / 60, 3)])
    r = summarise(frames, {f["frame"]: OFF for f in frames}, DIAG, FPS, [])
    assert r["intervals"][0]["not_compared_seconds"] == pytest.approx(1 / 60, abs=1e-3)


def test_interval_reaching_the_final_frame_closes_at_that_frame_end():
    sw = dict(blue=("tracked", 600, 100), red=("tracked", 100, 100))
    frames = frames_at(3) + [live(i / 60, i, **sw) for i in range(3, 6)]
    r = summarise(frames, {f["frame"]: OFF for f in frames}, DIAG, FPS, [])
    assert r["intervals"][0]["end"] == pytest.approx(6 / 60, abs=1e-3)


def test_no_compared_frame_gives_not_compared_never_agree():
    frames = frames_at(5, red=("lost", None, None))
    r = summarise(frames, {}, DIAG, FPS, [])
    assert r["state"] == "not_compared" and r["compared_seconds"] == 0


def write_live(tmp_path, rows, tail=""):
    live_dir = tmp_path / "live"
    live_dir.mkdir()
    (live_dir / "probe.json").write_text(json.dumps({"fps": 60, "width": 800, "height": 600}))
    text = "frame,t,corner,state,track_id,center_x,center_y,x1,y1,x2,y2,keypoint_confidence\n"
    for frame, corner, x in rows:
        text += f"{frame},{frame / 60},{corner},tracked,1,{x},100,,,,,0.9\n"
    (live_dir / "track.csv").write_text(text + tail)
    return live_dir


def write_offline(tmp_path, frames):
    path = tmp_path / "movement_metrics.csv"
    text = "frame,time_seconds,blue_detected,blue_x,blue_y,red_detected,red_x,red_y\n"
    for f in frames:
        text += f"{f},{f / 60},1,100.0,100.0,1,600.0,100.0\n"
    path.write_text(text)
    return path


def test_incomplete_last_line_is_ignored(tmp_path):
    rows = [(f, c, 100 if c == "blue" else 600) for f in range(4) for c in ("blue", "red")]
    live_dir = write_live(tmp_path, rows, tail="4,0.0666,blue,trac")
    assert len(read_complete_rows(live_dir / "track.csv")) == 8
    r = compare(live_dir, write_offline(tmp_path, range(5)))
    assert r["state"] == "agree"
    assert r["compared_seconds"] == pytest.approx(4 / 60, abs=1e-3)


def test_unavailable_without_a_live_record(tmp_path):
    assert compare(tmp_path / "live", tmp_path / "m.csv") == {"state": "unavailable"}
