import csv
import json
import os
import sys
import uuid
import subprocess

from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse


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

    temp_file.replace(status_file)


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
# CREATE JOB / UPLOAD VIDEO
# ============================================================

@app.post("/jobs", status_code=202)
async def create_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No filename provided."
        )

    extension = Path(file.filename).suffix.lower()

    if extension != ".mp4":
        raise HTTPException(
            status_code=400,
            detail="Only MP4 videos are supported."
        )

    job_id = str(uuid.uuid4())

    job_dir = JOBS_DIR / job_id

    input_dir = job_dir / "input"
    results_dir = job_dir / "results"
    videos_dir = job_dir / "videos"

    input_dir.mkdir(parents=True)
    results_dir.mkdir()
    videos_dir.mkdir()

    video_path = input_dir / "input.mp4"

    file_size = 0

    try:

        with video_path.open("wb") as destination:

            while True:

                chunk = await file.read(CHUNK_SIZE)

                if not chunk:
                    break

                file_size += len(chunk)

                if file_size > MAX_UPLOAD_SIZE:

                    raise HTTPException(
                        status_code=413,
                        detail="Video exceeds the 500 MB upload limit."
                    )

                destination.write(chunk)

        if file_size == 0:

            raise HTTPException(
                status_code=400,
                detail="Uploaded video is empty."
            )

    except Exception:

        import shutil
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    finally:
        await file.close()

    now = datetime.now(timezone.utc).isoformat()

    initial_status = {
        "job_id": job_id,
        "status": "queued",
        "original_filename": Path(file.filename).name,
        "file_size_bytes": file_size,
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

    background_tasks.add_task(run_pipeline, job_id)

    return {
        "message": "Video uploaded successfully. Analysis started.",
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

    return get_status(job_dir)


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