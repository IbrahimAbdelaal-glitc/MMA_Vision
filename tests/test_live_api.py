"""Design 7, 11, 13, 14 and 16.2: the live-session API with a fake engine process."""

import hashlib
import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from helpers import ROOT, make_job, read_status, wait_until
from api import live_api, main
from live import constants as K
from live.probe import ProbeRejected, ProbeUnavailable
from live.sessions import SessionManager

FAKE = str(ROOT / "tests" / "fake_engine.py")
VIDEO = b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 40

PROBE = {"accepted": True, "fps": 60.0, "frame_count": 360, "width": 1920, "height": 1020,
         "start_offset_ms": 36.0, "timestamps_ms": [i * 1000 / 60 for i in range(360)],
         "backend": "FFMPEG", "rules": {}}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def env(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    monkeypatch.setattr(main, "JOBS_DIR", jobs)
    scheduled = []
    monkeypatch.setattr(main, "run_pipeline", lambda job_id: scheduled.append(job_id))
    monkeypatch.setattr(K, "STOP_WAIT_SECONDS", 1.0)
    monkeypatch.setattr(K, "TERMINATE_WAIT_SECONDS", 1.0)
    mode = {"value": "normal"}
    clock = Clock()
    manager = SessionManager(
        tmp_path / "live_sessions", lambda: main.JOBS_DIR,
        engine_command=lambda s: [sys.executable, FAKE, "--mode", mode["value"], "--out", str(s.live_dir)],
        clock=clock, watchdog=False)
    monkeypatch.setattr(live_api, "manager", manager)
    probe = {"result": PROBE, "error": None}

    def fake_probe(path, timeout=None):
        if probe["error"]:
            raise probe["error"]
        return dict(probe["result"])

    monkeypatch.setattr(live_api, "run_probe", fake_probe)
    monkeypatch.setattr(live_api, "run_self_check", lambda: {"passed": True})
    monkeypatch.setattr(live_api, "_self_check_cache", {})
    client = TestClient(main.app)
    yield SimpleNamespace(client=client, manager=manager, mode=mode, clock=clock, jobs=jobs,
                          scheduled=scheduled, probe=probe, root=tmp_path / "live_sessions")
    manager.shutdown()


def upload(env, content=VIDEO, name="fight.mp4"):
    return env.client.post("/live-sessions", files={"file": (name, content, "video/mp4")})


def started(env, mode="normal"):
    env.mode["value"] = mode
    response = upload(env)
    assert response.status_code == 201, response.text
    session = env.manager.get(response.json()["session_id"])
    if mode != "garbage":
        assert wait_until(lambda: session.state == "live", 10)
    return session


def received(session):
    path = session.live_dir / "received.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def stream(env, session):
    return env.client.websocket_connect(f"/live-sessions/{session.id}/stream")


def until_type(ws, kind, limit=50):
    seen = []
    for _ in range(limit):
        message = ws.receive_json()
        seen.append(message)
        if message["type"] == kind:
            return message, seen
    raise AssertionError(f"no {kind} in {seen}")


# ------------------------------------------------------------------ upload

def test_create_returns_201_with_video_facts_and_starts_the_engine(env):
    response = upload(env)
    assert response.status_code == 201
    body = response.json()
    assert body["video"] == {"fps": 60.0, "frame_count": 360, "width": 1920, "height": 1020,
                             "duration_seconds": 6.0, "start_offset_ms": 36.0}
    session = env.manager.get(body["session_id"])
    assert wait_until(lambda: session.state == "live", 10)
    assert (session.live_dir / "probe.json").exists()
    summary = json.loads((session.live_dir / "session.json").read_text())
    assert summary["provisional"] is True and summary["state"] == "live"
    assert session.input_path.read_bytes() == VIDEO


def test_409_while_a_session_is_live_and_none_once_it_has_ended(env):
    session = started(env)
    assert upload(env).status_code == 409
    env.manager.stop(session, "stopped")
    assert session.state == "ended"
    assert upload(env).status_code == 201


class HeldTasks:
    """BackgroundTasks stand-in that keeps the task instead of running it."""

    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *args):
        self.tasks.append((fn, args))


def test_409_while_an_offline_job_runs_so_gpu_use_stays_sequential(env):
    make_job(env.jobs, "job-busy")
    held = HeldTasks()
    main.start_job("job-busy", "fight.mp4", 10, held)
    response = upload(env)
    assert response.status_code == 409
    assert "offline analysis" in response.json()["detail"]
    assert not env.root.exists() or not any(env.root.iterdir())     # nothing kept
    fn, args = held.tasks[0]
    fn(*args)                                   # the pipeline runs and finishes
    assert env.scheduled == ["job-busy"]
    assert upload(env).status_code == 201


def test_a_failing_pipeline_still_frees_the_gpu_for_live(env, monkeypatch):
    def boom(job_id):
        raise RuntimeError("pipeline crashed")

    monkeypatch.setattr(main, "run_pipeline", boom)
    make_job(env.jobs, "job-crash")
    held = HeldTasks()
    main.start_job("job-crash", "fight.mp4", 10, held)
    fn, args = held.tasks[0]
    with pytest.raises(RuntimeError):
        fn(*args)
    assert not main.offline_job_active()


@pytest.mark.parametrize("error,code", [
    (ProbeRejected("rule T9 failed: 30 fps", {"T9": {"passed": False}}), 422),
    (ProbeUnavailable("ffprobe was not found"), 503),
])
def test_verification_failures_leave_no_session_or_file(env, error, code):
    env.probe["error"] = error
    response = upload(env)
    assert response.status_code == code
    assert env.manager.sessions == {}
    assert list(env.root.iterdir()) == []
    if code == 422:
        assert response.json()["detail"]["rules"] == {"T9": {"passed": False}}


def test_failed_self_check_gives_503(env, monkeypatch):
    monkeypatch.setattr(live_api, "run_self_check", lambda: {"passed": False, "detail": "index/fps"})
    response = upload(env)
    assert response.status_code == 503 and "bundled check video" in response.json()["detail"]
    assert list(env.root.iterdir()) == []


@pytest.mark.parametrize("name,content,code,message", [
    ("clip.avi", VIDEO, 400, "Only MP4 videos are supported."),
    ("clip.mp4", b"", 400, "Uploaded video is empty."),
])
def test_upload_errors_match_post_jobs(env, name, content, code, message):
    response = upload(env, content, name)
    assert (response.status_code, response.json()["detail"]) == (code, message)
    assert not env.root.exists() or list(env.root.iterdir()) == []


def test_oversize_upload_gives_413_and_leaves_nothing(env, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_SIZE", 10)
    monkeypatch.setattr(main, "CHUNK_SIZE", 4)
    response = upload(env)
    assert (response.status_code, response.json()["detail"]) == (413, "Video exceeds the 500 MB upload limit.")
    assert list(env.root.iterdir()) == []


# ------------------------------------------------------------------ WebSocket

def test_websocket_relays_both_ways(env):
    session = started(env)
    with stream(env, session) as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "clock", "t": 0.5, "playing": True})
        frame, _ = until_type(ws, "frame")
        assert frame["t"] == 0.5 and frame["provisional"] is True
        ws.send_json({"type": "swap", "extra": "dropped"})
        identity, _ = until_type(ws, "identity")
        assert identity["kind"] == "swap"
    assert {"type": "swap"} in received(session)


def test_unknown_session_closes_4404(env):
    with pytest.raises(WebSocketDisconnect) as info:
        with env.client.websocket_connect("/live-sessions/nope/stream") as ws:
            ws.receive_json()
    assert info.value.code == 4404


def test_second_client_is_closed_with_4409(env):
    session = started(env)
    with stream(env, session) as first:
        assert first.receive_json()["type"] == "ready"
        with pytest.raises(WebSocketDisconnect) as info:
            with stream(env, session) as second:
                second.receive_json()
        assert info.value.code == 4409


def test_ended_session_sends_ended_then_closes(env):
    session = started(env, "video_end")
    with stream(env, session) as ws:
        ws.receive_json()
        ws.send_json({"type": "clock", "t": 0.2, "playing": True})
        ended, _ = until_type(ws, "ended")
        assert ended["reason"] == "video_end"
    assert session.state == "ended" and session.end_reason == "video_end"
    with stream(env, session) as ws:
        assert ws.receive_json() == {"type": "ended", "reason": "video_end", "provisional": True}
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
        assert info.value.code == 1000


def test_disconnect_pauses_the_engine_and_reconnect_replays_ready_and_stats(env):
    session = started(env)
    with stream(env, session) as ws:
        ws.receive_json()
        ws.send_json({"type": "clock", "t": 1.0, "playing": True})
        until_type(ws, "stats")
    assert wait_until(lambda: received(session)[-1] == {"type": "clock", "t": 1.0, "playing": False}, 5)
    with stream(env, session) as ws:
        assert ws.receive_json()["type"] == "ready"
        stats = ws.receive_json()
        assert stats["type"] == "stats" and stats["position_t"] == 1.0
        ws.send_json({"type": "clock", "t": 0.2, "playing": True})
        rejected, _ = until_type(ws, "clock_rejected")
        assert rejected["position"] == 1.0
        ws.send_json({"type": "clock", "t": 1.5, "playing": True})
        frame, _ = until_type(ws, "frame")
        assert frame["t"] == 1.5


def test_disconnected_after_60_s_without_a_client(env):
    session = started(env)
    env.clock.now += 59.0
    env.manager.tick()
    assert session.active
    env.clock.now += 1.0
    env.manager.tick()
    assert wait_until(lambda: session.state == "ended", 10)
    assert session.end_reason == "disconnected"
    assert {"type": "stop", "reason": "disconnected"} in received(session)


def test_disconnected_counts_from_the_last_client(env):
    session = started(env)
    env.clock.now += 50
    with stream(env, session) as ws:
        ws.receive_json()
    env.clock.now += 59
    env.manager.tick()
    assert session.active
    env.clock.now += 1
    env.manager.tick()
    assert wait_until(lambda: session.end_reason == "disconnected", 10)


def test_client_stop_message_ends_the_session_as_stopped(env):
    session = started(env)
    with stream(env, session) as ws:
        ws.receive_json()
        ws.send_json({"type": "stop", "reason": "video_end"})       # the browser cannot choose the reason
        ended, _ = until_type(ws, "ended")
    assert ended["reason"] == "stopped" and session.end_reason == "stopped"


# ------------------------------------------------------------------ stop, crash

def test_engine_ignoring_stop_is_escalated_and_analyse_waits_for_its_exit(env):
    session = started(env, "ignore_stop")
    response = env.client.post(f"/live-sessions/{session.id}/analyse")
    assert response.status_code == 202
    assert session.process.poll() is not None
    assert session.end_reason == "stopped"
    job_dir = env.jobs / response.json()["job_id"]
    assert (job_dir / "input" / "input.mp4").read_bytes() == VIDEO


def test_analyse_while_inside_a_frame_moves_nothing_until_the_exit(env):
    session = started(env, "block")
    results = {}
    thread = threading.Thread(target=lambda: results.update(
        r=env.client.post(f"/live-sessions/{session.id}/analyse")))
    thread.start()
    assert wait_until(lambda: {"type": "stop", "reason": "stopped"} in received(session), 5)
    assert session.process.poll() is None
    assert session.input_path.exists() and (session.live_dir / "engine.log").exists()
    assert env.jobs.exists() and list(env.jobs.iterdir()) == []
    (session.live_dir / "release").write_text("go")
    thread.join(15)
    assert results["r"].status_code == 202
    job_dir = env.jobs / results["r"].json()["job_id"]
    assert (job_dir / "live" / "engine.log").exists()      # moved: no handle was left open
    assert not session.folder.exists()


def test_analyse_and_delete_together_exactly_one_succeeds(env):
    session = started(env, "block")
    codes = []

    def call(method):
        response = getattr(env.client, method)(f"/live-sessions/{session.id}" + ("/analyse" if method == "post" else ""))
        codes.append((method, response.status_code, response.text[:120]))

    threads = [threading.Thread(target=call, args=(m,)) for m in ("post", "delete")]
    for t in threads:
        t.start()
    assert wait_until(lambda: received(session), 5)
    (session.live_dir / "release").write_text("go")
    for t in threads:
        t.join(15)
    statuses = sorted(code for _, code, _ in codes)
    assert statuses in ([202, 404], [204, 404])
    assert not session.folder.exists()
    jobs = list(env.jobs.iterdir())
    if 202 in statuses:
        assert len(jobs) == 1 and (jobs[0] / "input" / "input.mp4").exists() and (jobs[0] / "live").is_dir()
    else:
        assert jobs == []


def test_crash_sends_error_keeps_files_and_analyse_still_works(env):
    session = started(env, "crash")
    with stream(env, session) as ws:
        ws.receive_json()
        ws.send_json({"type": "clock", "t": 0.1, "playing": True})
        error, _ = until_type(ws, "error")
        ended, _ = until_type(ws, "ended")
    assert "exited with code 1" in error["message"]
    assert any("simulated failure" in line for line in error["log_tail"])
    assert ended["reason"] == "crashed"
    assert (session.live_dir / "track.csv").read_text().endswith("blue,trac")
    response = env.client.post(f"/live-sessions/{session.id}/analyse")
    assert response.status_code == 202
    job_dir = env.jobs / response.json()["job_id"]
    assert (job_dir / "live" / "track.csv").read_text().endswith("blue,trac")


def test_three_lines_that_are_not_json_count_as_a_crash(env):
    session = started(env, "garbage")
    assert wait_until(lambda: session.state == "ended", 10)
    assert session.end_reason == "crashed"


# ------------------------------------------------------------------ hand-off

def test_hand_off_job_matches_a_post_jobs_job(env):
    session = started(env)
    response = env.client.post(f"/live-sessions/{session.id}/analyse")
    assert response.status_code == 202
    body = response.json()
    job_id = body["job_id"]
    direct = env.client.post("/jobs", files={"file": ("fight.mp4", VIDEO, "video/mp4")}).json()

    def without_ids(b):
        return {k: v.replace(b["job_id"], "ID") if isinstance(v, str) else v for k, v in b.items() if k != "job_id"}

    assert without_ids(body) == without_ids(direct)
    live_status, direct_status = read_status(env.jobs / job_id), read_status(env.jobs / direct["job_id"])
    for key in ("job_id", "created_at", "updated_at"):
        live_status.pop(key)
        direct_status.pop(key)
    assert live_status == direct_status
    job_dir = env.jobs / job_id
    assert sorted(p.name for p in job_dir.iterdir()) == ["input", "live", "results", "status.json", "videos"]
    assert hashlib.sha256((job_dir / "input" / "input.mp4").read_bytes()).hexdigest() == hashlib.sha256(VIDEO).hexdigest()
    assert (job_dir / "live" / "probe.json").exists() and (job_dir / "live" / "session.json").exists()
    assert env.scheduled == [job_id, direct["job_id"]]
    assert env.client.post(f"/live-sessions/{session.id}/analyse").status_code == 404


def test_delete_removes_the_session_folder(env):
    session = started(env)
    assert env.client.delete(f"/live-sessions/{session.id}").status_code == 204
    assert not session.folder.exists()
    assert env.client.delete(f"/live-sessions/{session.id}").status_code == 404


# ------------------------------------------------------------------ housekeeping

def test_retention_removes_ended_sessions_after_one_hour_and_never_live_ones(env):
    live_one = started(env)
    env.clock.now += K.RETENTION_SECONDS + 10
    with stream(env, live_one) as ws:          # keep it connected so it is not "disconnected"
        ws.receive_json()
        env.manager.tick()
        assert live_one.active and live_one.folder.exists()
    env.manager.stop(live_one, "stopped")
    env.clock.now += K.RETENTION_SECONDS - 1
    env.manager.tick()
    assert live_one.folder.exists()
    env.clock.now += 1
    env.manager.tick()
    assert not live_one.folder.exists() and env.manager.get(live_one.id) is None


def test_start_up_sweep_touches_only_live_sessions(tmp_path):
    root = tmp_path / "live_sessions"
    (root / "old").mkdir(parents=True)
    (root / "old" / "input.mp4").write_bytes(b"x")
    (tmp_path / "jobs" / "keep").mkdir(parents=True)
    manager = SessionManager(root, lambda: tmp_path / "jobs", watchdog=False)
    manager.sweep()
    assert list(root.iterdir()) == []
    assert (tmp_path / "jobs" / "keep").exists()


# ------------------------------------------------------------------ identity check

def write_record(job_dir, blue_x, red_x, offline=True):
    live = job_dir / "live"
    live.mkdir()
    (live / "probe.json").write_text(json.dumps({"fps": 60, "width": 1000, "height": 0}))
    rows = "frame,t,corner,state,track_id,center_x,center_y,x1,y1,x2,y2,keypoint_confidence\n"
    for f in range(10):
        rows += f"{f},{f / 60},blue,tracked,1,{blue_x},100,,,,,0.9\n{f},{f / 60},red,tracked,2,{red_x},100,,,,,0.9\n"
    (live / "track.csv").write_text(rows)
    if offline:
        text = "frame,time_seconds,blue_detected,blue_x,blue_y,red_detected,red_x,red_y\n"
        text += "".join(f"{f},{f / 60},1,100.0,100.0,1,600.0,100.0\n" for f in range(10))
        (job_dir / "results" / "movement_metrics.csv").write_text(text)


def test_identity_check_states(env):
    assert env.client.get("/jobs/missing/identity-check").status_code == 404
    running = make_job(env.jobs, "running", status="processing")
    assert env.client.get("/jobs/running/identity-check").status_code == 409
    make_job(env.jobs, "plain")
    assert env.client.get("/jobs/plain/identity-check").json() == {"state": "unavailable"}
    write_record(make_job(env.jobs, "agree"), 100, 600)
    assert env.client.get("/jobs/agree/identity-check").json()["state"] == "agree"
    write_record(make_job(env.jobs, "crossed"), 600, 100)
    crossed = env.client.get("/jobs/crossed/identity-check").json()
    assert crossed["state"] == "disagree" and len(crossed["intervals"]) == 1
    write_record(make_job(env.jobs, "nocompare"), 100, 600, offline=False)
    assert env.client.get("/jobs/nocompare/identity-check").json()["state"] == "not_compared"
    assert running.exists()


def _real_clip(size):
    for path in sorted((ROOT / "jobs").glob("*/input/input.mp4")):
        if path.stat().st_size == size:
            return path
    return None


SIX_SECOND_CLIP = _real_clip(6119753)


@pytest.mark.skipif(SIX_SECOND_CLIP is None, reason="the real 6 s clip is not on this machine")
def test_real_clip_through_the_real_probe_reports_its_start_offset(env, monkeypatch):
    from live import probe as real_probe

    monkeypatch.setattr(live_api, "run_probe", real_probe.run_probe)
    monkeypatch.setattr(live_api, "run_self_check", real_probe.run_self_check)
    response = env.client.post("/live-sessions", files={"file": ("fight.mp4", SIX_SECOND_CLIP.read_bytes(), "video/mp4")})
    assert response.status_code == 201, response.text
    video = response.json()["video"]
    assert video["frame_count"] == 360 and video["fps"] == 60.0
    assert video["duration_seconds"] == 6.0
    assert abs(video["start_offset_ms"] - 36.0) < 0.01
    session = env.manager.get(response.json()["session_id"])
    stored = json.loads((session.live_dir / "probe.json").read_text())
    assert abs(stored["start_offset_ms"] - 36.0) < 0.01 and len(stored["timestamps_ms"]) == 360
