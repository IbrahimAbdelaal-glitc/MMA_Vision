# Phase 5 live engine — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-17-live-engine-design.md` (treated as
approved by the user on 2026-11-17, with authority to resolve contradictions
and continue).

**Goal:** a working live-monitoring workflow on recorded 60 fps MP4s, a
hand-off to the unchanged offline pipeline, and the dashboard wired to both.

**Architecture:** a new `live/` Python package holds pure, unit-tested logic
(timing rules, pacing, identity, metrics, detector, comparison) plus two
process entry points (`live/probe.py`, `live/engine.py`). `api/live_api.py`
adds the new endpoints and the session registry; `api/main.py` gains only
`start_job`, the router include and a lifespan. The frontend adds a live
session hook, a WebSocket client, an overlay canvas and an identity panel.

**Tech stack:** Python 3.13 (Anaconda), FastAPI/Starlette, OpenCV 5.0.0
(FFMPEG backend), ultralytics YOLO11n-pose on CUDA, the 2013 ffprobe;
React 19, TypeScript 7, Vite 8, Vitest 5, oxlint.

## Global constraints

- No change to the nine pipeline scripts, the scorecard, or any existing
  endpoint or response contract. `POST /jobs` keeps its exact behaviour.
- No invented values: unknown is null; no contact, damage, winner or
  probability; every live value carries `"provisional": true`.
- One engine at a time; the engine never runs with the offline pipeline;
  hand-off only after `poll()` confirms the engine exited.
- No new dependency is installed. PyAV is not installed (see M10). (Later approved by the user: PyAV 19.0.2, for the drift fixture only; see Status.)
- No commit or push without asking the user.
- Run Python as `python`. Import ultralytics
  (torch) before cv2 is fine, cv2 before torch is fine, but `import torch`
  then `import cv2` aborts with a duplicate OpenMP runtime: the engine
  imports cv2 first.

## Decisions taken while planning (contradictions resolved)

1. **Package location.** The spec names `live/probe.py`, `live/sessions.py`
   and `live/fixtures/`. They live in a new top-level `live/` package, next
   to `api/` and `src/`; nothing existing moves.
2. **Reading stdin "between frames".** Windows pipes cannot be polled with
   `select`, so a reader thread queues stdin lines and the engine loop drains
   the queue between frames. Messages that arrive during a frame therefore
   take effect after it, exactly as §8 requires.
3. **Analysed rate at the start.** §8 measures the rate "over the last 2 s".
   During the first 2 s the window is the time since the first analysed
   frame (at least 0.1 s); otherwise detection would be inactive for the
   first 2 s of every session, which a 6 s clip cannot afford. The rate is
   intervals divided by window length.
4. **Self-check fixture.** `live/fixtures/timestamp_check.mp4` (7 KB, 64x36,
   60 frames, a 100 ms jump between frames 29 and 30) was made with the
   2013 ffmpeg (`-vsync 0`, libx264) from the earlier design fixture.
5. **No property-testing library** is installed, so the pacing property test
   uses seeded `random` sequences (500 sequences).
6. **Start offset.** The spec's Phase 6 browser check is run in this phase
   (Playwright, `requestVideoFrameCallback`) because the frontend is wired
   now. Its result decides the clock mapping (M9).

## Review focus

1. A backward clock after a reconnect must never rewind the engine.
2. `analyse` while a frame is running must not move files before exit.
3. A video whose packets are reordered (B-frames) must still be accepted.
4. A 30 fps upload must be refused live but still analysable offline.
5. A session with no events must show dashes, not zeros.

## Milestones

Each milestone is test-first: the listed tests are written, seen failing,
then the code is written until they pass, then the whole suite runs.

### M1 — `POST /jobs` characterisation, then `start_job`

- Files: `tests/test_jobs_contract.py` (new), `api/main.py`.
- Tests (written against the unrefactored code and passing there first):
  success body and `status.json` field by field; no filename 400; non-MP4
  400; empty 400 with no folder left; oversize 413 with no folder left
  (`MAX_UPLOAD_SIZE` patched small); pipeline scheduled.
- Then extract `start_job(job_id, original_filename, file_size_bytes,
  background_tasks) -> dict` and re-run the same tests unchanged.

### M2 — timing rules and probe (§6)

- Files: `live/constants.py`, `live/timing.py`, `live/probe.py`,
  `live/fixtures/timestamp_check.mp4`, `tests/test_live_timing.py`,
  `tests/test_live_probe.py`.
- `check_rules(meta, decoded_ms, packet_ms) -> RuleReport` implements
  T1–T9; `runtime_check(i, p_ms, verified, fps) -> str|None` implements 6.6.
- Probe: `python -m live.probe <file>` prints JSON; `run_probe(path)` wraps
  it with a 120 s timeout; `self_check()` uses the fixture.
- Tests: every row of the 16.2 Probe, matching/B-frames, frame-rate,
  synthetic drift, self-check and runtime-check rows. Real clips from
  `jobs/*/input/input.mp4` are used when present (skipped otherwise, and
  reported as skipped).

### M3 — pacing (§8)

- Files: `live/pacing.py`, `tests/test_live_pacing.py`.
- `Pacer` holds the advance limit and returns the next target from the
  verified timestamps; tests include latest-frame-wins, pause, silent
  client, forward jump, backward rejection, end of video and the seeded
  property test.

### M4 — identity (§9) and metrics (§10.1–10.2)

- Files: `live/identity.py`, `live/metrics.py`, tests for each.

### M5 — causal detector (§10.3)

- Files: `live/detector.py`, `tests/test_live_detector.py`.
- Every 16.2 Detector row, including streaming causality, `video_end`
  finalisation with an instrumented sample store, and the three policies.

### M6 — engine process (§6.6, §8, §14)

- Files: `live/engine.py` (`EngineCore` with injectable capture and model;
  `main()` wires OpenCV and YOLO), `tests/test_live_engine.py`.
- Blocking fake model for the "messages during a frame" tests.

### M7 — sessions and API (§7, §11, §13)

- Files: `live/sessions.py`, `api/live_api.py`, `api/main.py` (router and
  lifespan only), `tests/test_live_api.py`, `tests/fake_engine.py`.
- Every 16.2 API test, including mid-frame `analyse`/`DELETE`, the lock,
  half-written rows and the hand-off SHA-256.

### M8 — identity comparison (§12)

- Files: `live/compare.py`, endpoint in `api/live_api.py`,
  `tests/test_live_compare.py`.

### M9 — frontend (Phase 6 scope pulled in)

- Files: `services/liveApi.ts`, `services/liveSocket.ts`,
  `hooks/useLiveSession.ts`, `components/video/LiveOverlay.tsx`,
  `components/analytics/IdentityCheck.tsx`, edits to `LiveMonitoring`,
  `MonitoringControls`, `FighterHud`, `LatestEvent`, `RecentDetections`,
  `App.tsx`, `vite.config.ts` (`ws: true`), types; tests for each.
- Controls: Start live (uploads to `/live-sessions`), Pause/Resume (the
  video element), End (stop), Analyse offline (hand-off), Swap corners.

### M10 — real-video and browser verification

- Script `live/realcheck.py`: probe, engine run on the 6 s clip with GPU,
  `nvidia-smi` before/after, event counts, live vs offline comparison.
- Playwright: full workflow in the browser; `requestVideoFrameCallback`
  start-offset measurement.
- Real-MP4 drift fixture: the installed tools cannot write per-packet
  durations (design 6.7). Everything else is finished first; the user is
  then asked to approve `pip install av` (PyAV 14+, ~30 MB wheel with its
  own FFmpeg libraries, installed into the Anaconda base environment). The
  test is written and marked skipped until then; it stays "unverified".

### M11 — documentation and final checks

- `docs/live-engine.md` (run instructions), README pointers; full backend
  and frontend suites, typecheck, lint, build.

## Status (2026-11-17)

M1–M11 implemented and committed on `dashboard`. Results, measurements and
decisions taken during implementation: `docs/live-engine.md`.

- Real-MP4 drift fixture (M10): done after the user approved PyAV 19.0.2.
  `tests/fixtures/drift_60.mp4` is rejected by T8 alone (27.000 ms at
  frame 30); the same file without drift is accepted. Final totals:
  169 pytest passed, 0 skipped; 312 vitest passed; typecheck, lint and
  build clean.
- Found during M10 and fixed: the server did not refuse a live start while
  an offline job ran (GPU sequencing was frontend-only).
- Found during M10: the overlay is hidden during playback (pacing vs
  display rules); the user confirmed keeping this safe behaviour. Live
  peaks are one frame late (trailing smoothing, as designed); kept and
  documented. Both are explained in `docs/live-engine.md`.
