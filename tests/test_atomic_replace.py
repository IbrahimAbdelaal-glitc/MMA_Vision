"""Regression: a job failed with "[WinError 5] Access is denied: status.tmp -> status.json".

On Windows a rename onto a file that another process holds open (OneDrive
sync, antivirus, or the API reading status.json for a poll) fails until that
handle closes. The rename is now retried for a short, bounded time.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

import pytest

from live.atomic import replace_retrying


def test_replace_retries_until_the_destination_is_released(tmp_path: Path, monkeypatch):
    src, dst = tmp_path / "a.tmp", tmp_path / "a.json"
    src.write_text("new", encoding="utf-8")
    dst.write_text("old", encoding="utf-8")
    calls = {"n": 0}
    real_replace = Path.replace

    def flaky(self, target):
        calls["n"] += 1
        if calls["n"] <= 3:
            raise PermissionError(13, "Access is denied")
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky)
    replace_retrying(src, dst, delay=0.001)
    assert calls["n"] == 4
    assert dst.read_text(encoding="utf-8") == "new"


def test_replace_gives_up_after_its_time_budget(tmp_path: Path, monkeypatch):
    src, dst = tmp_path / "a.tmp", tmp_path / "a.json"
    src.write_text("new", encoding="utf-8")

    def always_denied(self, target):
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(Path, "replace", always_denied)
    started = time.monotonic()
    with pytest.raises(PermissionError):
        replace_retrying(src, dst, attempts=5, delay=0.01)
    assert time.monotonic() - started < 1.0


def test_other_errors_are_not_retried(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        replace_retrying(tmp_path / "missing.tmp", tmp_path / "x.json", delay=0.001)


@pytest.mark.skipif(sys.platform != "win32", reason="the sharing violation is Windows behaviour")
def test_update_status_survives_a_reader_holding_status_json_open(tmp_path: Path):
    from api import main

    job_dir = tmp_path / "job"
    job_dir.mkdir()
    (job_dir / "status.json").write_text(json.dumps({"status": "queued"}), encoding="utf-8")

    handle = open(job_dir / "status.json", "rb")       # what a scanner or a poll does
    releaser = threading.Timer(0.3, handle.close)
    releaser.start()
    try:
        main.update_status(job_dir, status="processing")
    finally:
        releaser.join()
        handle.close()
    assert json.loads((job_dir / "status.json").read_text(encoding="utf-8"))["status"] == "processing"
