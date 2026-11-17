"""Design 7 and 11: the live-session registry, engine lifecycle and hand-off.

Threads, not asyncio, surround the engine process:

- one stdout reader thread per session parses JSON lines, keeps the replay
  state (`ready`, latest `stats`) and hands each message to the connected
  WebSocket's listener (a non-blocking `call_soon_threadsafe`);
- one watchdog thread per manager applies the 60 s disconnect rule and the
  1 h retention, using an injectable clock so tests can move time.

A session becomes `ended` only after the engine process has exited, so
anything after that can rely on the GPU being free and every file closed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from live import constants as K

ROOT = Path(__file__).resolve().parent.parent


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Session:
    def __init__(self, session_id: str, folder: Path, original_filename: str, size: int,
                 probe: dict, created: float):
        self.id = session_id
        self.folder = folder
        self.original_filename = original_filename
        self.size = size
        self.probe = probe
        self.state = "starting"
        self.end_reason: Optional[str] = None
        self.requested_reason: Optional[str] = None
        self.created = created
        self.ended_at: Optional[float] = None
        self.started_iso = _now_iso()
        self.ended_iso: Optional[str] = None
        self.process: Optional[subprocess.Popen] = None
        self.reader: Optional[threading.Thread] = None
        self.lock = threading.Lock()          # analyse / DELETE / retention / shutdown
        self.mx = threading.Lock()            # listener and replay state
        self.stdin_lock = threading.Lock()
        self.listener: Optional[Callable[[dict], None]] = None
        self.client_gone_since: Optional[float] = created
        self.ready_message: Optional[dict] = None
        self.latest_stats: Optional[dict] = None
        self.last_clock_t: float = 0.0
        self.engine_error: Optional[str] = None
        self.got_ended = False
        self.end_reason_reported: Optional[str] = None
        self.ended_event = threading.Event()
        self.removed = False

    @property
    def live_dir(self) -> Path:
        return self.folder / "live"

    @property
    def input_path(self) -> Path:
        return self.folder / "input.mp4"

    @property
    def active(self) -> bool:
        return self.state in ("starting", "live")

    def video(self) -> dict:
        p = self.probe
        return {"fps": p["fps"], "frame_count": p["frame_count"], "width": p["width"],
                "height": p["height"], "duration_seconds": p["frame_count"] / p["fps"],
                "start_offset_ms": p["start_offset_ms"]}

    def summary(self) -> dict:
        stats = self.latest_stats or {}
        return {
            "provisional": True,
            "session_id": self.id,
            "device": (self.ready_message or {}).get("device"),
            "state": self.state,
            "end_reason": self.end_reason,
            "frames_analysed": stats.get("frames_analysed", 0),
            "frames_skipped": stats.get("frames_skipped", 0),
            "last_analysed_t": stats.get("position_t"),
            "started_at": self.started_iso,
            "ended_at": self.ended_iso,
        }


class SessionManager:
    def __init__(self, root: Path, jobs_dir: Callable[[], Path], *,
                 engine_command: Optional[Callable[[Session], list]] = None,
                 clock: Callable[[], float] = time.monotonic, watchdog: bool = True):
        self.root = root
        self.jobs_dir = jobs_dir
        self.engine_command = engine_command or default_engine_command
        self.clock = clock
        self.sessions: dict = {}
        self.registry_lock = threading.Lock()
        self._stop_watchdog = threading.Event()
        self._watchdog = None
        if watchdog:
            self._watchdog = threading.Thread(target=self._watch, daemon=True, name="live-watchdog")
            self._watchdog.start()

    # ------------------------------------------------------------ registry
    def get(self, session_id: str) -> Optional[Session]:
        with self.registry_lock:
            return self.sessions.get(session_id)

    def busy(self) -> bool:
        with self.registry_lock:
            return any(s.active for s in self.sessions.values())

    def new_folder(self) -> tuple:
        session_id = str(uuid.uuid4())
        folder = self.root / session_id
        (folder / "live").mkdir(parents=True)
        return session_id, folder

    def register(self, session_id: str, folder: Path, original_filename: str, size: int,
                 probe: dict) -> Optional[Session]:
        """Store the probe and launch the engine. None if another session became active."""

        with self.registry_lock:
            if any(s.active for s in self.sessions.values()):
                return None
            session = Session(session_id, folder, original_filename, size, probe, self.clock())
            self.sessions[session_id] = session
        (session.live_dir / "probe.json").write_text(json.dumps(probe), encoding="utf-8")
        self._write_summary(session)
        try:
            self._launch(session)
        except OSError as error:
            with self.registry_lock:
                self.sessions.pop(session_id, None)
            raise RuntimeError(f"the engine could not be started: {error}") from error
        return session

    # ------------------------------------------------------------ process
    def _launch(self, session: Session) -> None:
        log = (session.live_dir / "engine.log").open("w", encoding="utf-8")
        try:
            session.process = subprocess.Popen(
                self.engine_command(session), cwd=ROOT, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=log, text=True, encoding="utf-8",
                errors="replace", bufsize=1,
            )
        finally:
            log.close()        # the engine holds its own handle; the API keeps none
        session.reader = threading.Thread(target=self._read, args=(session,), daemon=True,
                                          name=f"live-reader-{session.id[:8]}")
        session.reader.start()

    def send(self, session: Session, message: dict) -> bool:
        process = session.process
        if process is None or process.poll() is not None or process.stdin is None:
            return False
        with session.stdin_lock:
            try:
                process.stdin.write(json.dumps(message) + "\n")
                process.stdin.flush()
                return True
            except (OSError, ValueError):
                return False

    def _deliver(self, session: Session, message: dict) -> None:
        with session.mx:
            kind = message.get("type")
            if kind == "ready":
                session.ready_message = message
            elif kind == "stats":
                session.latest_stats = message
            if session.listener is not None:
                session.listener(message)

    def _read(self, session: Session) -> None:
        process = session.process
        bad = 0
        crashed_reason = None
        assert process is not None and process.stdout is not None
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise ValueError("not an object")
            except ValueError:
                bad += 1
                if bad >= K.BAD_LINES_BEFORE_CRASH:
                    crashed_reason = f"{bad} consecutive engine output lines were not valid JSON"
                    self._kill(process)
                    break
                continue
            bad = 0
            kind = message.get("type")
            if kind == "ready" and session.state == "starting":
                session.state = "live"
                self._write_summary(session)
            if kind == "error":
                session.engine_error = message.get("message")
                continue          # delivered with the log tail once the exit is confirmed
            if kind == "ended":
                session.got_ended = True
                session.end_reason_reported = message.get("reason")
                continue          # delivered once the exit is confirmed
            self._deliver(session, message)
        process.wait()
        self._finish(session, crashed_reason)

    def _finish(self, session: Session, crashed_reason: Optional[str]) -> None:
        code = session.process.returncode if session.process else None
        reported = session.end_reason_reported
        if crashed_reason is None and session.got_ended and code == 0 and reported:
            reason = reported
        elif crashed_reason is None and session.requested_reason and session.engine_error is None:
            reason = session.requested_reason       # the API's own stop procedure ended it
        else:
            reason = "crashed"
        final = []
        if reason == "crashed":
            detail = crashed_reason or session.engine_error or (
                f"the engine exited with code {code}" if code else "the engine stopped without ending the session")
            final.append({"type": "error", "provisional": True, "message": detail,
                          "log_tail": self.log_tail(session)})
        final.append({"type": "ended", "reason": reason, "provisional": True})
        # One block under the listener lock: a client attaching concurrently
        # either receives the whole ending or finds the session already ended.
        with session.mx:
            session.end_reason = reason
            session.state = "ended"
            session.ended_at = self.clock()
            session.ended_iso = _now_iso()
            if session.listener is not None:
                for message in final + [{"type": "_close"}]:
                    session.listener(message)
        self._write_summary(session)
        session.ended_event.set()

    @staticmethod
    def _kill(process: subprocess.Popen) -> None:
        try:
            process.kill()
        except OSError:
            pass

    def log_tail(self, session: Session, lines: int = 20) -> list:
        try:
            text = (session.live_dir / "engine.log").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        return text.splitlines()[-lines:]

    def stop(self, session: Session, reason: str) -> None:
        """Design 7 stop procedure. Returns once the exit is confirmed and the session is ended."""

        process = session.process
        if process is not None and process.poll() is None:
            if session.requested_reason is None:
                session.requested_reason = reason
            self.send(session, {"type": "stop", "reason": reason})
            try:
                process.wait(K.STOP_WAIT_SECONDS)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(K.TERMINATE_WAIT_SECONDS)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        if process is not None:
            session.ended_event.wait(K.STOP_WAIT_SECONDS)

    # ------------------------------------------------------------ clients
    def attach(self, session: Session, listener: Callable[[dict], None]) -> tuple:
        """Connect the only client: ("ok", replay) | ("busy", []) | ("ended", [ended])."""

        with session.mx:
            if session.state == "ended":
                return "ended", [{"type": "ended", "reason": session.end_reason, "provisional": True}]
            if session.listener is not None:
                return "busy", []
            session.listener = listener
            session.client_gone_since = None
            return "ok", [m for m in (session.ready_message, session.latest_stats) if m is not None]

    def detach(self, session: Session, listener) -> None:
        with session.mx:
            if session.listener is not listener:
                return
            session.listener = None
            session.client_gone_since = self.clock()
        if session.active:
            self.send(session, {"type": "clock", "t": session.last_clock_t, "playing": False})

    def relay(self, session: Session, message: dict) -> None:
        """Browser to engine: only clock, swap and stop, with only their own fields."""

        kind = message.get("type")
        if kind == "clock":
            try:
                t = float(message.get("t"))
            except (TypeError, ValueError):
                return
            session.last_clock_t = t
            self.send(session, {"type": "clock", "t": t, "playing": bool(message.get("playing"))})
        elif kind == "swap":
            self.send(session, {"type": "swap"})
        elif kind == "stop":
            if session.requested_reason is None:
                session.requested_reason = "stopped"
            self.send(session, {"type": "stop", "reason": "stopped"})

    # ------------------------------------------------------------ hand-off
    def take(self, session_id: str, action: Callable[[Session], object]) -> tuple:
        """Run `action` under the session lock, stopping the engine first.

        Returns (True, action result), or (False, None) if the session is gone:
        "found" is kept apart from the result, which may itself be None.
        """

        session = self.get(session_id)
        if session is None:
            return False, None
        with session.lock:
            if session.removed:
                return False, None
            if session.active:
                self.stop(session, "stopped")
            if not session.ended_event.wait(K.STOP_WAIT_SECONDS + K.TERMINATE_WAIT_SECONDS):
                raise RuntimeError("the engine did not exit")
            result = action(session)
            session.removed = True
            with self.registry_lock:
                self.sessions.pop(session.id, None)
            return True, result

    def hand_off(self, session: Session) -> tuple:
        """Move input.mp4 and live/ into a new job folder laid out like POST /jobs."""

        job_id = str(uuid.uuid4())
        job_dir = self.jobs_dir() / job_id
        (job_dir / "input").mkdir(parents=True)
        (job_dir / "results").mkdir()
        (job_dir / "videos").mkdir()
        try:
            os.replace(session.input_path, job_dir / "input" / "input.mp4")
            shutil.move(str(session.live_dir), str(job_dir / "live"))
        except OSError:
            # Put back what moved so the session can be analysed again.
            if (job_dir / "input" / "input.mp4").exists() and not session.input_path.exists():
                os.replace(job_dir / "input" / "input.mp4", session.input_path)
            shutil.rmtree(job_dir, ignore_errors=True)
            raise
        shutil.rmtree(session.folder, ignore_errors=True)
        return job_id, session.original_filename, session.size

    def delete(self, session: Session) -> None:
        shutil.rmtree(session.folder, ignore_errors=True)

    # ------------------------------------------------------------ housekeeping
    def tick(self) -> None:
        """Disconnect and retention rules. Called by the watchdog and by tests."""

        now = self.clock()
        with self.registry_lock:
            sessions = list(self.sessions.values())
        for session in sessions:
            if session.active:
                gone = session.client_gone_since
                if gone is not None and now - gone >= K.CLIENT_TIMEOUT_SECONDS:
                    threading.Thread(target=self.stop, args=(session, "disconnected"), daemon=True).start()
            elif session.ended_at is not None and now - session.ended_at >= K.RETENTION_SECONDS:
                self.take(session.id, self.delete)

    def _watch(self) -> None:
        while not self._stop_watchdog.wait(0.5):
            try:
                self.tick()
            except Exception as error:  # noqa: BLE001 - the watchdog must keep running
                print(f"live watchdog: {error}", file=sys.stderr)

    def sweep(self) -> None:
        """Start-up: remove every folder under live_sessions/ and nothing else."""

        if self.root.exists():
            for child in self.root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
        self.root.mkdir(parents=True, exist_ok=True)

    def shutdown(self) -> None:
        self._stop_watchdog.set()
        with self.registry_lock:
            sessions = list(self.sessions.values())
        for session in sessions:
            if session.active:
                with session.lock:
                    self.stop(session, "stopped")

    def _write_summary(self, session: Session) -> None:
        if session.removed or not session.live_dir.exists():
            return
        target = session.live_dir / "session.json"
        temp = session.live_dir / "session.tmp"
        try:
            temp.write_text(json.dumps(session.summary(), indent=2), encoding="utf-8")
            os.replace(temp, target)
        except OSError:
            pass


def default_engine_command(session: Session) -> list:
    return [sys.executable, "-m", "live.engine", "--video", str(session.input_path),
            "--probe", str(session.live_dir / "probe.json"), "--out", str(session.live_dir)]
