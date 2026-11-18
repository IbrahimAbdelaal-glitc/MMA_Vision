import csv
import json
import os
import shutil
import sys
import threading
import uuid
import subprocess

from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse

from live.atomic import replace_retrying


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(__file__).resolve().parent.parent

API_DIR = ROOT / "api"
JOBS_DIR = ROOT / "jobs"
SRC_DIR = ROOT / "src"

MAX_UPLOAD_SIZE = 500 * 1024 * 1024  # 500 MB
CHUNK_SIZE = 1024 * 1024

PIPELINE_STAGES = [
    "Movement Analysis",
    "Movement Data Analysis",
    "Pose Estimation",
    "Joint Feature Analysis",
    "Temporal Strike Detection",
    "Strike Refinement",
    "Strike Classification",
    "Opponent Direction Analysis",
    "Experimental Scorecard",
]

JOBS_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="MMA Vision API",
    description="Computer Vision-based MMA Fight Analysis API",
    version="1.0.0"
)


# ============================================================
# JOB UTILITIES
# ============================================================

def get_job_directory(job_id: str) -> Path:

    job_dir = (JOBS_DIR / job_id).resolve()

    if job_dir.parent != JOBS_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid job ID.")

    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job not found.")

    return job_dir


def get_status(job_dir: Path) -> dict:

    status_file = job_dir / "status.json"

    if not status_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Job status not found."
        )

    return json.loads(status_file.read_text(encoding="utf-8"))


def update_status(job_dir: Path, **updates):

    status = get_status(job_dir)

    status.update(updates)
    status["updated_at"] = datetime.now(timezone.utc).isoformat()

    status_file = job_dir / "status.json"
    temp_file = job_dir / "status.tmp"

    temp_file.write_text(
        json.dumps(status, indent=4),
        encoding="utf-8"
    )

    replace_retrying(temp_file, status_file)


# ============================================================
# PIPELINE EXECUTION
# ============================================================

def run_pipeline(job_id: str):

    job_dir = JOBS_DIR / job_id

    input_dir = job_dir / "input"
    results_dir = job_dir / "results"
    videos_dir = job_dir / "videos"

    video_path = input_dir / "input.mp4"

    results_dir.mkdir(parents=True, exist_ok=True)
    videos_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()

    env["MMA_VIDEO_PATH"] = str(video_path.resolve())
    env["MMA_RESULTS_DIR"] = str(results_dir.resolve())
    env["MMA_OUTPUT_DIR"] = str(videos_dir.resolve())

    # Python buffers its output in 8 KB blocks when it writes to a pipe, so
    # pipeline.py's "RUNNING:" / "COMPLETED:" markers only reached the loop
    # below when the whole run ended. Unbuffered output sends each line as it
    # is printed. pipeline.py passes this environment on to every stage.
    env["PYTHONUNBUFFERED"] = "1"

    log_file = job_dir / "pipeline.log"

    try:

        update_status(
            job_dir,
            status="processing",
            current_stage="Starting pipeline",
            progress=0,
            stages_completed=0,
            error=None
        )

        process = subprocess.Popen(
            [
                sys.executable,
                str(SRC_DIR / "pipeline.py")
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1
        )

        with log_file.open("w", encoding="utf-8") as log:

            for line in process.stdout:

                log.write(line)
                log.flush()

                print(f"[{job_id}] {line}", end="")

                for index, stage in enumerate(PIPELINE_STAGES):

                    if f"RUNNING: {stage}" in line:

                        update_status(
                            job_dir,
                            current_stage=stage,
                            progress=round(
                                index / len(PIPELINE_STAGES) * 100
                            ),
                            stages_completed=index
                        )

                    elif f"COMPLETED: {stage}" in line:

                        completed = index + 1

                        update_status(
                            job_dir,
                            stages_completed=completed,
                            progress=round(
                                completed / len(PIPELINE_STAGES) * 100
                            )
                        )

            return_code = process.wait()

        if return_code != 0:

            raise RuntimeError(
                f"Pipeline exited with code {return_code}. "
                f"Check pipeline.log."
            )

        update_status(
            job_dir,
            status="completed",
            current_stage="Completed",
            progress=100,
            stages_completed=len(PIPELINE_STAGES),
            error=None
        )

    except Exception as error:

        update_status(
            job_dir,
            status="failed",
            current_stage="Failed",
            error=str(error)
        )

        print(f"\nJob {job_id} failed: {error}")


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
def home():

    return {
        "message": "MMA Vision API is running.",
        "version": "1.0.0",
        "docs": "/docs"
    }


# ============================================================
# START ANALYSIS FROM videos/input
# ============================================================

INPUT_DIR = ROOT / "videos" / "input"
CURRENT_JOB_FILE = JOBS_DIR / "current_job.json"


@app.post("/analysis/start", status_code=202)
def start_folder_analysis(background_tasks: BackgroundTasks):
    """Start the existing offline pipeline using the sole MP4 in videos/input."""

    videos = sorted(INPUT_DIR.glob("*.mp4")) if INPUT_DIR.exists() else []
    if not videos:
        raise HTTPException(
            status_code=404,
            detail="No MP4 video found. Place one video in videos/input/ and try again.",
        )
    if len(videos) > 1:
        raise HTTPException(
            status_code=409,
            detail="More than one MP4 was found in videos/input/. Keep exactly one video there.",
        )

    source = videos[0]
    if source.stat().st_size == 0:
        raise HTTPException(status_code=400, detail="The input video is empty.")

    with _active_jobs_guard:
        if _active_jobs:
            raise HTTPException(status_code=409, detail="An analysis is already running.")

    job_id = str(uuid.uuid4())
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True)
    (job_dir / "results").mkdir()
    (job_dir / "videos").mkdir()

    # Copy into the job folder so the pipeline works on a stable snapshot even
    # if the source file is later replaced in videos/input.
    video_path = input_dir / "input.mp4"
    shutil.copy2(source, video_path)

    response = start_job(
        job_id,
        source.name,
        video_path.stat().st_size,
        background_tasks,
    )
    CURRENT_JOB_FILE.write_text(
        json.dumps({"job_id": job_id}, indent=2), encoding="utf-8"
    )
    response["message"] = "Analysis started using the video in videos/input."
    return response


@app.get("/analysis/current")
def get_current_analysis():
    if not CURRENT_JOB_FILE.exists():
        raise HTTPException(status_code=404, detail="No analysis has been started yet.")
    data = json.loads(CURRENT_JOB_FILE.read_text(encoding="utf-8"))
    job_id = data.get("job_id")
    if not isinstance(job_id, str):
        raise HTTPException(status_code=500, detail="Current analysis reference is invalid.")
    get_job_directory(job_id)
    return {"job_id": job_id}


# ============================================================
# SHARED JOB START (POST /jobs and the live-session hand-off)
# ============================================================

# Jobs this API process has scheduled and not yet finished. The live engine
# refuses to start while one runs, so the GPU is used by one analysis at a
# time. Kept in memory: a status.json left at "processing" by a crashed
# server must not block live analysis forever.
_active_jobs: set = set()
_active_jobs_guard = threading.Lock()

# One pipeline runs at a time: pose estimation uses the GPU when there is one
# (src/pose_pass.py), and two passes at once would compete for its memory.
# A later job waits, with status "queued", until the earlier one ends.
_pipeline_slot = threading.Lock()


def offline_job_active() -> bool:
    with _active_jobs_guard:
        return bool(_active_jobs)


def _job_is_active(job_id: str) -> bool:
    with _active_jobs_guard:
        return job_id in _active_jobs


def _run_tracked(job_id: str):
    try:
        with _pipeline_slot:
            run_pipeline(job_id)
    finally:
        with _active_jobs_guard:
            _active_jobs.discard(job_id)


def start_job(
    job_id: str,
    original_filename: str,
    file_size_bytes: int,
    background_tasks: BackgroundTasks
) -> dict:
    """Write status.json, schedule the offline pipeline and return the 202 body.

    The caller must first place a stable video copy at
    jobs/<job_id>/input/input.mp4.
    """

    job_dir = JOBS_DIR / job_id

    now = datetime.now(timezone.utc).isoformat()

    initial_status = {
        "job_id": job_id,
        "status": "queued",
        "original_filename": original_filename,
        "file_size_bytes": file_size_bytes,
        "progress": 0,
        "stages_completed": 0,
        "total_stages": len(PIPELINE_STAGES),
        "current_stage": "Queued",
        "error": None,
        "created_at": now,
        "updated_at": now
    }

    (job_dir / "status.json").write_text(
        json.dumps(initial_status, indent=4),
        encoding="utf-8"
    )

    with _active_jobs_guard:
        _active_jobs.add(job_id)
    background_tasks.add_task(_run_tracked, job_id)

    return {
        "message": "Analysis started.",
        "job_id": job_id,
        "status": "queued",
        "status_url": f"/jobs/{job_id}",
        "results_url": f"/jobs/{job_id}/results"
    }


# ============================================================
# GET JOB STATUS
# ============================================================

@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):

    job_dir = get_job_directory(job_id)
    status = get_status(job_dir)

    # A server restart or interruption can leave status.json at "processing"
    # after its in-memory background task has disappeared. Report that job as
    # interrupted on the next poll instead of making the dashboard spin forever.
    if status.get("status") in {"queued", "processing"} and not _job_is_active(job_id):
        # Re-read after checking the task registry in case the task finished
        # between the first status read and that check.
        status = get_status(job_dir)
        if status.get("status") in {"queued", "processing"}:
            update_status(
                job_dir,
                status="failed",
                current_stage="Interrupted",
                error="Analysis was interrupted before it completed. Start a new analysis to try again.",
            )
            status = get_status(job_dir)

    return status


# ============================================================
# GET JOB RESULTS
# ============================================================

@app.get("/jobs/{job_id}/results")
def get_job_results(job_id: str):

    job_dir = get_job_directory(job_id)

    status = get_status(job_dir)

    if status["status"] != "completed":

        raise HTTPException(
            status_code=409,
            detail=f"Analysis is not complete. Current status: {status['status']}"
        )

    results_dir = job_dir / "results"

    scorecard_file = results_dir / "experimental_scorecard.csv"
    report_file = results_dir / "experimental_scorecard_report.txt"

    if not scorecard_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Scorecard not found."
        )

    with scorecard_file.open(
        "r",
        encoding="utf-8",
        newline=""
    ) as file:

        scorecard = list(csv.DictReader(file))

    report = (
        report_file.read_text(encoding="utf-8")
        if report_file.exists()
        else None
    )

    return {
        "job_id": job_id,
        "status": "completed",
        "scorecard": scorecard,
        "report": report
    }


# ============================================================
# LIST GENERATED ARTIFACTS
# ============================================================

@app.get("/jobs/{job_id}/artifacts")
def list_artifacts(job_id: str):

    job_dir = get_job_directory(job_id)

    artifacts = []

    for folder_name in ["results", "videos"]:

        folder = job_dir / folder_name

        for path in folder.rglob("*"):

            if path.is_file():

                artifacts.append({
                    "filename": path.relative_to(job_dir).as_posix(),
                    "size_bytes": path.stat().st_size,
                    "download_url": (
                        f"/jobs/{job_id}/files/"
                        f"{path.relative_to(job_dir).as_posix()}"
                    )
                })

    return {
        "job_id": job_id,
        "total_artifacts": len(artifacts),
        "artifacts": artifacts
    }


# ============================================================
# DOWNLOAD ARTIFACT
# ============================================================

@app.get("/jobs/{job_id}/files/{file_path:path}")
def download_artifact(job_id: str, file_path: str):

    job_dir = get_job_directory(job_id)

    requested_file = (
        job_dir / file_path
    ).resolve()

    allowed_directories = [
        (job_dir / "results").resolve(),
        (job_dir / "videos").resolve()
    ]

    if not any(
        requested_file.is_relative_to(folder)
        for folder in allowed_directories
    ):

        raise HTTPException(
            status_code=403,
            detail="Access to this file is not allowed."
        )

    if not requested_file.is_file():

        raise HTTPException(
            status_code=404,
            detail="Artifact not found."
        )

    return FileResponse(
        path=requested_file,
        filename=requested_file.name
    )


# ============================================================
# BROWSER-PLAYABLE PROCESSED VIDEO
# ============================================================
#
# movement_analysis.py writes its annotated video with OpenCV's mp4v codec
# (MPEG-4 Part 2), which Chrome, Edge and Firefox cannot play. This endpoint
# serves an H.264 copy, made with ffmpeg the first time it is asked for and
# kept in the job's browser/ folder. That folder is outside results/ and
# videos/, so /artifacts and /files return exactly what they did before.

PROCESSED_VIDEO = Path("videos") / "movement_analysis.mp4"
BROWSER_VIDEO = Path("browser") / "movement_analysis_h264.mp4"
CONVERSION_TIMEOUT_SECONDS = 30 * 60

_conversion_locks: dict = {}
_conversion_locks_guard = threading.Lock()


def find_ffmpeg() -> Optional[str]:
    """MMA_FFMPEG if it is set, otherwise the ffmpeg on PATH."""

    configured = os.environ.get("MMA_FFMPEG")

    if configured:
        return configured if Path(configured).is_file() else None

    return shutil.which("ffmpeg")


def conversion_lock(job_id: str) -> threading.Lock:
    """One lock per job, so two requests never convert the same video at once."""

    with _conversion_locks_guard:
        return _conversion_locks.setdefault(job_id, threading.Lock())


def convert_to_h264(source: Path, target: Path):

    ffmpeg = find_ffmpeg()

    if ffmpeg is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "No ffmpeg was found to make a browser-playable copy. "
                "Install ffmpeg or set MMA_FFMPEG to its path."
            )
        )

    target.parent.mkdir(parents=True, exist_ok=True)

    # Written under a temporary name and renamed when complete, so a
    # half-written file is never served.
    temp_file = target.with_name(target.stem + ".partial.mp4")

    try:
        result = subprocess.run(
            [
                ffmpeg, "-y", "-loglevel", "error",
                "-i", str(source),
                "-an",                       # the processed video has no audio
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",       # the pixel format browsers decode
                "-movflags", "+faststart",   # index first, so playback starts at once
                str(temp_file)
            ],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=CONVERSION_TIMEOUT_SECONDS
        )
        if result.returncode == 0 and temp_file.is_file():
            failure = None
        else:
            # ffmpeg's last line of output usually names the problem.
            lines = (result.stderr or "").strip().splitlines()
            failure = lines[-1] if lines else f"ffmpeg exited with code {result.returncode}"

    except (OSError, subprocess.TimeoutExpired) as error:
        failure = str(error)

    if failure is not None:

        temp_file.unlink(missing_ok=True)

        if not any(target.parent.iterdir()):
            target.parent.rmdir()

        raise HTTPException(
            status_code=500,
            detail=f"Could not convert the processed video: {failure}"
        )

    replace_retrying(temp_file, target)


@app.get("/jobs/{job_id}/video")
def get_browser_video(job_id: str):

    job_dir = get_job_directory(job_id)

    status = get_status(job_dir)

    if status["status"] != "completed":

        raise HTTPException(
            status_code=409,
            detail=f"Analysis is not complete. Current status: {status['status']}"
        )

    source = job_dir / PROCESSED_VIDEO
    target = job_dir / BROWSER_VIDEO

    if not source.is_file():

        raise HTTPException(
            status_code=404,
            detail="Processed video not found."
        )

    with conversion_lock(job_dir.name):

        # Made again if the processed video is newer than the copy.
        if (
            not target.is_file()
            or target.stat().st_mtime < source.stat().st_mtime
        ):
            convert_to_h264(source, target)

    # No filename, so the browser plays it in the page instead of
    # downloading it. FileResponse answers Range requests, which seeking needs.
    return FileResponse(path=target, media_type="video/mp4")

