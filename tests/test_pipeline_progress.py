"""E1: a job's status follows the pipeline's stage markers while it runs."""

import threading

from helpers import main, make_job, read_status, wait_until

# Stands in for src/pipeline.py: it prints a stage marker the same way the
# real one does (a plain print, no flush) and then waits, as a long stage
# would, until the test lets it finish.
FAKE_PIPELINE = '''
import time
from pathlib import Path

print("=" * 55)
print("RUNNING: Movement Analysis")
print("=" * 55)

release = Path(__file__).with_name("release")
deadline = time.time() + 30
while not release.exists() and time.time() < deadline:
    time.sleep(0.05)

print("COMPLETED: Movement Analysis")
'''


def test_status_shows_the_running_stage_before_the_pipeline_ends(tmp_path, monkeypatch):
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "pipeline.py").write_text(FAKE_PIPELINE, encoding="utf-8")

    monkeypatch.setattr(main, "JOBS_DIR", tmp_path / "jobs")
    monkeypatch.setattr(main, "SRC_DIR", src_dir)
    # The fix must not depend on the shell that started the API.
    monkeypatch.delenv("PYTHONUNBUFFERED", raising=False)

    job_dir = make_job(tmp_path / "jobs", "job-1", status="queued")
    runner = threading.Thread(target=main.run_pipeline, args=("job-1",))
    runner.start()

    try:
        reported = wait_until(
            lambda: read_status(job_dir)["current_stage"] == "Movement Analysis",
            timeout=10,
        )
        # The stage is reported while it is still running, not at the end.
        assert reported, f"status stayed {read_status(job_dir)['current_stage']!r}"
        assert runner.is_alive()
        assert read_status(job_dir)["status"] == "processing"
    finally:
        (src_dir / "release").touch()
        runner.join(timeout=30)

    final = read_status(job_dir)
    assert final["status"] == "completed"
    assert final["progress"] == 100
