"""Design 13 and 14: the live-session endpoints and the WebSocket relay.

Included by api/main.py. `api.main` is imported lazily (inside functions) so
there is no import cycle, and tests that monkeypatch `main.JOBS_DIR`,
`main.MAX_UPLOAD_SIZE` or `main.run_pipeline` affect these endpoints too.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Response, UploadFile, WebSocket
from fastapi.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect

from live.compare import compare
from live.probe import ProbeRejected, ProbeUnavailable, run_probe, run_self_check
from live.sessions import SessionManager

ROOT = Path(__file__).resolve().parent.parent
LIVE_SESSIONS_DIR = ROOT / "live_sessions"

router = APIRouter()


def _main():
    from api import main
    return main


manager = SessionManager(LIVE_SESSIONS_DIR, lambda: _main().JOBS_DIR)

# The backend self-check (6.4) runs once per API process.
_self_check_cache: dict = {}


def _ensure_self_check() -> None:
    if "result" not in _self_check_cache:
        _self_check_cache["result"] = run_self_check()
    result = _self_check_cache["result"]
    if not result.get("passed"):
        _self_check_cache.pop("result", None)          # retry on the next upload
        raise ProbeUnavailable(
            "OpenCV's FFMPEG backend did not report real frame timestamps on the bundled check "
            f"video ({result.get('detail', 'no detail')}), so no file can be verified."
        )


@asynccontextmanager
async def lifespan(app):
    manager.sweep()
    yield
    await run_in_threadpool(manager.shutdown)


# ------------------------------------------------------------ POST /live-sessions

@router.post("/live-sessions", status_code=201)
async def create_live_session(file: UploadFile = File(...)):
    main = _main()

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")
    if Path(file.filename).suffix.lower() != ".mp4":
        raise HTTPException(status_code=400, detail="Only MP4 videos are supported.")
    if manager.busy():
        raise HTTPException(status_code=409, detail="A live session is already running. End it before starting another.")
    if _main().offline_job_active():
        raise HTTPException(status_code=409, detail="An offline analysis is running. Wait for it to finish: one analysis uses the GPU at a time.")

    session_id, folder = manager.new_folder()
    video_path = folder / "input.mp4"
    size = 0
    try:
        with video_path.open("wb") as destination:
            while True:
                chunk = await file.read(main.CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > main.MAX_UPLOAD_SIZE:
                    raise HTTPException(status_code=413, detail="Video exceeds the 500 MB upload limit.")
                destination.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video is empty.")

        await run_in_threadpool(_ensure_self_check)
        probe = await run_in_threadpool(run_probe, video_path)
        session = await run_in_threadpool(
            manager.register, session_id, folder, Path(file.filename).name, size, probe)
        if session is None:
            raise HTTPException(status_code=409, detail="A live session is already running. End it before starting another.")
    except ProbeRejected as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=422, detail={
            "message": f"This video cannot be analysed live: {error}",
            "rules": error.rules,
        }) from error
    except ProbeUnavailable as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=503, detail=f"Live verification is unavailable: {error}") from error
    except RuntimeError as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=503, detail=str(error)) from error
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        await file.close()

    return {"session_id": session.id, "state": session.state, "video": session.video()}


@router.get("/live-sessions/{session_id}")
def get_live_session(session_id: str):
    session = manager.get(session_id)
    if session is None or session.removed:
        raise HTTPException(status_code=404, detail="Live session not found.")
    return {**session.summary(), "video": session.video()}


# ------------------------------------------------------------ WebSocket

@router.websocket("/live-sessions/{session_id}/stream")
async def live_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = manager.get(session_id)
    if session is None or session.removed:
        await websocket.close(code=4404)
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def listener(message: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, message)

    status, replay = manager.attach(session, listener)
    if status == "busy":
        await websocket.close(code=4409)
        return
    if status == "ended":
        for message in replay:
            await websocket.send_json(message)
        await websocket.close(code=1000)
        return
    for message in replay:
        queue.put_nowait(message)

    async def outgoing():
        while True:
            message = await queue.get()
            if message.get("type") == "_close":
                await websocket.close(code=1000)
                return
            await websocket.send_json(message)

    async def incoming():
        while True:
            text = await websocket.receive_text()
            try:
                message = json.loads(text)
            except ValueError:
                continue
            if isinstance(message, dict):
                manager.relay(session, message)

    tasks = {asyncio.create_task(outgoing()), asyncio.create_task(incoming())}
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            error = task.exception()
            if error is not None and not isinstance(error, (WebSocketDisconnect, RuntimeError)):
                raise error
    finally:
        manager.detach(session, listener)


# ------------------------------------------------------------ hand-off and removal

@router.post("/live-sessions/{session_id}/analyse", status_code=202)
def analyse_live_session(session_id: str, background_tasks: BackgroundTasks):
    main = _main()
    try:
        found, result = manager.take(session_id, manager.hand_off)
    except (OSError, RuntimeError) as error:
        raise HTTPException(status_code=500, detail=f"The live session could not be handed off: {error}") from error
    if not found:
        raise HTTPException(status_code=404, detail="Live session not found.")
    job_id, original_filename, size = result
    return main.start_job(job_id, original_filename, size, background_tasks)


@router.delete("/live-sessions/{session_id}", status_code=204)
def delete_live_session(session_id: str):
    found, _ = manager.take(session_id, manager.delete)
    if not found:
        raise HTTPException(status_code=404, detail="Live session not found.")
    return Response(status_code=204)


# ------------------------------------------------------------ identity check

@router.get("/jobs/{job_id}/identity-check")
def identity_check(job_id: str):
    main = _main()
    job_dir = main.get_job_directory(job_id)
    status = main.get_status(job_dir)
    if status.get("status") != "completed":
        raise HTTPException(status_code=409, detail="The identity check is available once the analysis has completed.")
    return compare(job_dir / "live", job_dir / "results" / "movement_metrics.csv")
