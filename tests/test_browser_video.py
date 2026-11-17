"""E2: GET /jobs/{job_id}/video serves a browser-playable H.264 copy of the
processed video, and leaves every existing endpoint as it was."""

import sys

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from helpers import main, make_job

WIDTH, HEIGHT, FPS, FRAMES = 64, 48, 30, 30


def write_mp4v_video(path):
    """A short clip written the way movement_analysis.py writes its output."""

    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT)
    )
    for index in range(FRAMES):
        writer.write(np.full((HEIGHT, WIDTH, 3), index * 8, dtype=np.uint8))
    writer.release()


def describe(path):
    capture = cv2.VideoCapture(str(path))
    fourcc = int(capture.get(cv2.CAP_PROP_FOURCC))
    info = {
        "codec": "".join(chr((fourcc >> 8 * i) & 255) for i in range(4)),
        "frames": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
        "fps": round(capture.get(cv2.CAP_PROP_FPS)),
    }
    capture.release()
    return info


@pytest.fixture
def jobs_dir(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    monkeypatch.setattr(main, "JOBS_DIR", jobs)
    return jobs


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def completed_job(jobs_dir):
    job_dir = make_job(jobs_dir, "job-done")
    write_mp4v_video(job_dir / "videos" / "movement_analysis.mp4")
    return job_dir


def browser_copy(job_dir):
    return job_dir / "browser" / "movement_analysis_h264.mp4"


def test_refuses_a_job_that_has_not_completed(client, jobs_dir):
    job_dir = make_job(jobs_dir, "job-running", status="processing")
    write_mp4v_video(job_dir / "videos" / "movement_analysis.mp4")

    response = client.get("/jobs/job-running/video")

    assert response.status_code == 409
    assert "processing" in response.json()["detail"]


def test_says_when_the_processed_video_is_missing(client, jobs_dir):
    make_job(jobs_dir, "job-novideo")

    response = client.get("/jobs/job-novideo/video")

    assert response.status_code == 404
    assert response.json()["detail"] == "Processed video not found."


def test_unknown_job_is_a_404(client, jobs_dir):
    assert client.get("/jobs/no-such-job/video").status_code == 404


def test_explains_when_no_ffmpeg_is_available(client, completed_job, tmp_path, monkeypatch):
    monkeypatch.setenv("MMA_FFMPEG", str(tmp_path / "missing-ffmpeg.exe"))

    response = client.get("/jobs/job-done/video")

    assert response.status_code == 503
    assert "MMA_FFMPEG" in response.json()["detail"]
    assert not browser_copy(completed_job).exists()


def test_a_failed_conversion_leaves_no_partial_file(client, completed_job, monkeypatch):
    # The Python interpreter rejects ffmpeg's options and exits non-zero:
    # a stand-in for an ffmpeg that cannot do the conversion.
    monkeypatch.setenv("MMA_FFMPEG", sys.executable)

    response = client.get("/jobs/job-done/video")

    assert response.status_code == 500
    assert response.json()["detail"].startswith("Could not convert the processed video")
    browser_dir = completed_job / "browser"
    assert not browser_dir.exists() or list(browser_dir.iterdir()) == []


needs_ffmpeg = pytest.mark.skipif(
    main.find_ffmpeg() is None if hasattr(main, "find_ffmpeg") else False,
    reason="no ffmpeg on PATH or in MMA_FFMPEG",
)


@needs_ffmpeg
def test_serves_an_h264_copy_with_the_same_frames(client, completed_job):
    response = client.get("/jobs/job-done/video")

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    # Played in the page, not offered as a download.
    assert "attachment" not in response.headers.get("content-disposition", "")

    copy = browser_copy(completed_job)
    assert response.content == copy.read_bytes()
    assert describe(copy) == {"codec": "h264", "frames": FRAMES, "fps": FPS}
    # The mp4v original is left exactly where it was.
    assert describe(completed_job / "videos" / "movement_analysis.mp4")["codec"] == "FMP4"


@needs_ffmpeg
def test_converts_once_and_reuses_the_copy(client, completed_job):
    assert client.get("/jobs/job-done/video").status_code == 200
    first = browser_copy(completed_job).stat().st_mtime_ns

    assert client.get("/jobs/job-done/video").status_code == 200

    assert browser_copy(completed_job).stat().st_mtime_ns == first


@needs_ffmpeg
def test_answers_range_requests_so_the_browser_can_seek(client, completed_job):
    size = len(client.get("/jobs/job-done/video").content)

    response = client.get("/jobs/job-done/video", headers={"Range": "bytes=100-199"})

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes 100-199/{size}"
    assert len(response.content) == 100


@needs_ffmpeg
def test_existing_endpoints_do_not_list_or_serve_the_copy(client, completed_job):
    assert client.get("/jobs/job-done/video").status_code == 200

    listed = client.get("/jobs/job-done/artifacts").json()
    assert [a["filename"] for a in listed["artifacts"]] == ["videos/movement_analysis.mp4"]

    response = client.get("/jobs/job-done/files/browser/movement_analysis_h264.mp4")
    assert response.status_code == 403
