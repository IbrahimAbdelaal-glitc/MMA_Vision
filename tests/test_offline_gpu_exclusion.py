"""Offline analysis and the GPU: one analysis at a time.

Offline pose estimation now uses the GPU when there is one (src/pose_pass.py).
Live sessions were already refused while a job ran; these tests pin the other
side: no offline job while a live session runs, and no two pipelines at once.
"""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from helpers import main


@pytest.fixture
def jobs_dir(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    monkeypatch.setattr(main, "JOBS_DIR", jobs)
    return jobs


def upload(client):
    return client.post("/jobs", files={"file": ("fight.mp4", b"\x00" * 64, "video/mp4")})


def test_upload_is_refused_while_a_live_session_runs(jobs_dir, monkeypatch):
    scheduled = []
    monkeypatch.setattr(main, "run_pipeline", lambda job_id: scheduled.append(job_id))
    monkeypatch.setattr(main, "live_session_active", lambda: True)

    response = upload(TestClient(main.app))

    assert response.status_code == 409
    assert "live session is running" in response.json()["detail"]
    assert scheduled == []
    assert list(jobs_dir.iterdir()) == []          # nothing written


def test_upload_is_accepted_when_no_live_session_runs(jobs_dir, monkeypatch):
    monkeypatch.setattr(main, "run_pipeline", lambda job_id: None)
    monkeypatch.setattr(main, "live_session_active", lambda: False)

    assert upload(TestClient(main.app)).status_code == 202


def test_two_pipelines_never_run_at_the_same_time(monkeypatch):
    running, overlap = [0], []
    lock = threading.Lock()

    def slow_pipeline(job_id):
        with lock:
            running[0] += 1
            overlap.append(running[0])
        time.sleep(0.2)
        with lock:
            running[0] -= 1

    monkeypatch.setattr(main, "run_pipeline", slow_pipeline)
    with main._active_jobs_guard:
        main._active_jobs.update({"a", "b"})

    threads = [threading.Thread(target=main._run_tracked, args=(job,)) for job in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)

    assert overlap == [1, 1]
    assert not main.offline_job_active()           # both released their slot


def test_the_live_check_reads_the_session_manager(monkeypatch):
    from api import live_api

    monkeypatch.setattr(live_api.manager, "busy", lambda: True)
    assert main.live_session_active() is True
    monkeypatch.setattr(live_api.manager, "busy", lambda: False)
    assert main.live_session_active() is False
