"""Shared helpers for the API tests: throwaway jobs in a temporary folder."""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The API is started as `uvicorn api.main:app` from the project root, so the
# tests import it the same way.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import main  # noqa: E402


def make_job(jobs_dir: Path, job_id: str, status: str = "completed") -> Path:
    """A job folder laid out the way POST /jobs creates it."""

    job_dir = jobs_dir / job_id
    for folder in ("input", "results", "videos"):
        (job_dir / folder).mkdir(parents=True)

    (job_dir / "status.json").write_text(
        json.dumps({
            "job_id": job_id,
            "status": status,
            "original_filename": "clip.mp4",
            "file_size_bytes": 1,
            "progress": 100 if status == "completed" else 0,
            "stages_completed": 9 if status == "completed" else 0,
            "total_stages": 9,
            "current_stage": "Completed" if status == "completed" else "Queued",
            "error": None,
            "created_at": "2026-11-17T00:00:00+00:00",
            "updated_at": "2026-11-17T00:00:00+00:00",
        }),
        encoding="utf-8",
    )
    return job_dir


def read_status(job_dir: Path) -> dict:
    return json.loads((job_dir / "status.json").read_text(encoding="utf-8"))


def wait_until(condition, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if condition():
                return True
        except (OSError, ValueError):
            pass  # status.json is replaced atomically, but be lenient
        time.sleep(0.05)
    return False
