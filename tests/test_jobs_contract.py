"""Characterisation of POST /jobs, written against the code before the Phase 5
refactor and kept unchanged after it (design 13.2, 16.2).

Every status code, message, response field, file and status.json field the
current endpoint produces is pinned here, so the shared start_job helper can
be introduced without any observable change.
"""

import json

import pytest
from fastapi.testclient import TestClient

from helpers import main


@pytest.fixture
def jobs_dir(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    monkeypatch.setattr(main, "JOBS_DIR", jobs)
    return jobs


@pytest.fixture
def scheduled(monkeypatch):
    """Replaces the pipeline run, recording which jobs were scheduled."""
    calls = []
    monkeypatch.setattr(main, "run_pipeline", lambda job_id: calls.append(job_id))
    return calls


@pytest.fixture
def client():
    return TestClient(main.app)


def upload(client, name="fight.mp4", body=b"\x00\x00\x00\x18ftypmp42" + b"x" * 100):
    return client.post("/jobs", files={"file": (name, body, "video/mp4")})


def test_success_body_files_status_and_pipeline(client, jobs_dir, scheduled):
    body = b"0123456789" * 50
    response = upload(client, "My Fight.MP4", body)

    assert response.status_code == 202
    data = response.json()
    job_id = data["job_id"]
    assert data == {
        "message": "Video uploaded successfully. Analysis started.",
        "job_id": job_id,
        "status": "queued",
        "status_url": f"/jobs/{job_id}",
        "results_url": f"/jobs/{job_id}/results",
    }

    job_dir = jobs_dir / job_id
    assert sorted(p.name for p in job_dir.iterdir()) == ["input", "results", "status.json", "videos"]
    assert (job_dir / "input" / "input.mp4").read_bytes() == body
    assert list((job_dir / "results").iterdir()) == []
    assert list((job_dir / "videos").iterdir()) == []

    status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
    assert set(status) == {
        "job_id", "status", "original_filename", "file_size_bytes", "progress",
        "stages_completed", "total_stages", "current_stage", "error",
        "created_at", "updated_at",
    }
    assert status["job_id"] == job_id
    assert status["status"] == "queued"
    assert status["original_filename"] == "My Fight.MP4"
    assert status["file_size_bytes"] == len(body)
    assert status["progress"] == 0
    assert status["stages_completed"] == 0
    assert status["total_stages"] == 9
    assert status["current_stage"] == "Queued"
    assert status["error"] is None
    assert status["created_at"] == status["updated_at"]
    assert status["created_at"].endswith("+00:00")

    assert scheduled == [job_id]


def test_status_json_is_indented_by_four_spaces(client, jobs_dir, scheduled):
    job_id = upload(client).json()["job_id"]
    text = (jobs_dir / job_id / "status.json").read_text(encoding="utf-8")
    assert text.startswith('{\n    "job_id"')


def test_no_filename_is_rejected(client, jobs_dir, scheduled):
    response = client.post("/jobs", files={"file": ("", b"abc", "video/mp4")})
    # A multipart part with an empty filename reaches FastAPI as a plain
    # string, so validation answers 422 before the endpoint's own 400 check.
    assert response.status_code == 422
    assert list(jobs_dir.iterdir()) == []
    assert scheduled == []


def test_non_mp4_is_rejected(client, jobs_dir, scheduled):
    response = upload(client, "fight.avi")
    assert response.status_code == 400
    assert response.json() == {"detail": "Only MP4 videos are supported."}
    assert list(jobs_dir.iterdir()) == []
    assert scheduled == []


def test_empty_upload_is_rejected_and_leaves_no_folder(client, jobs_dir, scheduled):
    response = upload(client, body=b"")
    assert response.status_code == 400
    assert response.json() == {"detail": "Uploaded video is empty."}
    assert list(jobs_dir.iterdir()) == []
    assert scheduled == []


def test_oversize_upload_is_rejected_and_leaves_no_folder(client, jobs_dir, scheduled, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_SIZE", 10)
    monkeypatch.setattr(main, "CHUNK_SIZE", 4)
    response = upload(client, body=b"x" * 11)
    assert response.status_code == 413
    assert response.json() == {"detail": "Video exceeds the 500 MB upload limit."}
    assert list(jobs_dir.iterdir()) == []
    assert scheduled == []


def test_upload_at_the_limit_is_accepted(client, jobs_dir, scheduled, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_SIZE", 10)
    monkeypatch.setattr(main, "CHUNK_SIZE", 4)
    response = upload(client, body=b"x" * 10)
    assert response.status_code == 202
    assert len(scheduled) == 1
