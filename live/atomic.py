"""Atomic file replacement that survives short-lived Windows sharing violations.

`Path.replace` is atomic, but on Windows it fails with PermissionError
(WinError 5, "Access is denied") while any other handle has the destination
open: OneDrive syncing a file it just saw, an antivirus scan, or the API
reading status.json to answer a poll. Those handles close within
milliseconds, so the rename is retried for a bounded time (default about
2 s) and only then is the error raised. Other errors are raised at once.
"""
from __future__ import annotations

import time
from pathlib import Path


def replace_retrying(src: Path, dst: Path, attempts: int = 40, delay: float = 0.05) -> None:
    """Atomically move `src` over `dst`, retrying PermissionError up to `attempts` times."""
    src, dst = Path(src), Path(dst)
    for attempt in range(1, attempts + 1):
        try:
            src.replace(dst)
            return
        except PermissionError:
            if attempt == attempts:
                raise
            time.sleep(delay)
