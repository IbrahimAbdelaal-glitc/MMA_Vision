# Live engine (Phase 5)

The live engine analyses a fight video **while it plays in the browser**.
Everything it shows is **provisional**. The final scorecard always comes
from the unchanged nine-stage offline pipeline (`POST /jobs`), which the
live session hands its file to when it ends.

Design: `docs/superpowers/specs/2026-11-17-live-engine-design.md`.
Plan and the contradictions resolved while planning:
`docs/superpowers/plans/2026-11-17-live-engine-implementation-plan.md`.

## Running it

Two terminals from the project root (`MMA_Vision/MMA_Vision`):

```powershell
# 1. Backend (FastAPI, port 8000). Use the Anaconda Python that has torch + ultralytics.
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000

# 2. Frontend (Vite dev server; proxies /api, including the WebSocket, to port 8000)
cd frontend
npm run dev
```

Open the address Vite prints (normally http://localhost:5173).

1. **Select video** (or drop an MP4 on the stage). It plays locally.
2. **Start live** uploads the file to `POST /live-sessions`. The backend
   checks its frame timing (ffprobe and OpenCV must agree on every frame,
   constant 60 fps; design 6). A refused video says which rule failed;
   it can still be analysed offline with **Analyse video**.
3. The engine loads YOLO11n-pose (GPU when CUDA works, else CPU) and runs
   a warm-up inference. The first start takes about 20 s.
4. **Play / Pause** drive the video, and so the engine: the browser sends
   its playback clock about every 200 ms and the engine analyses the
   newest frame it can reach ("latest frame wins"). Seeking forward skips
   frames; the engine never goes back.
5. **Swap** exchanges Blue and Red from this moment on; it is logged.
6. **End**, or the video ending, stops the engine and frees the GPU.
   Then **Analyse offline** runs the nine-stage pipeline on the same file
   (no second upload) and the dashboard moves to Match Ended, which adds
   an **Identity check**: where the live Blue/Red labels agreed with the
   final ones. **Discard** deletes the session instead.

Only one analysis runs at a time: Start live is disabled while an offline
job runs, and a live session must end before another video is chosen.

### Settings

| Variable | Effect |
|---|---|
| `MMA_FFPROBE` | Path of the ffprobe used by the timing check (default: `PATH`, then next to `MMA_FFMPEG`). |
| `MMA_FFMPEG` | Path of ffmpeg, as for the offline pipeline. |
| `VITE_API_BASE_URL` (frontend `.env`) | Backend address the dev proxy forwards to (default http://127.0.0.1:8000). |

Session folders live in `live_sessions/<id>/` (git-ignored) until handed
off, discarded, or removed one hour after ending. A handed-off session's
files move into the job: `jobs/<job_id>/live/`.

## API

| Method | Path | Result |
|---|---|---|
| `POST` | `/live-sessions` | 201 `{session_id, state, video}`; 400/413 as `/jobs`; 409 busy; 422 `{message, rules}` timing refused; 503 engine self-check failed |
| `GET` | `/live-sessions/{id}` | session summary (added: read-only) |
| `WS` | `/live-sessions/{id}/stream` | engine messages out (`ready`, `frame`, `event`, `identity`, `stats`, `clock_rejected`, `error`, `ended`); `clock`, `swap`, `stop` in. Close 4404 unknown, 4409 second tab |
| `POST` | `/live-sessions/{id}/analyse` | 202 `{job_id}`: the ended session becomes an offline job |
| `DELETE` | `/live-sessions/{id}` | 204 |
| `GET` | `/jobs/{id}/identity-check` | live vs final labels for a job that came from a live session |

`POST /jobs` is unchanged; it and the hand-off share one `start_job`
helper (characterised by `tests/test_jobs_contract.py` before the change).

## Code map

| Module | Role |
|---|---|
| `live/probe.py`, `live/timing.py` | ffprobe + OpenCV timestamp cross-check, rules T1–T9, start offset |
| `live/pacing.py` | browser clock → frame index (latest frame wins, never rewinds) |
| `live/identity.py` | Blue/Red continuity, re-association, uncertainty, manual swap |
| `live/metrics.py` | per-frame provisional metrics, analysed-rate gate, events per minute |
| `live/detector.py` | causal strike-like detector; a score is frozen once emitted |
| `live/constants.py` | every threshold, with the offline source line it mirrors |
| `live/engine.py` | the engine child process (stdin JSON in, stdout JSON out) |
| `live/sessions.py` | process lifecycle: reader, watchdog, stop escalation, cleanup |
| `live/compare.py` | identity comparison (design 12) |
| `api/live_api.py` | REST + WebSocket endpoints |
| `live/realcheck.py` | measurement script: drives the API with a real MP4 like a browser |
| `frontend/src/hooks/useLiveSession.ts` | upload, socket, clock, reconnect, hand-off |
| `frontend/src/components/video/LiveOverlay.tsx` | boxes and skeletons, hidden when stale |

## Decisions taken during implementation

- **Browser clock offset (measured).** Chrome reports media time including
  the container start offset: the 6 s clip's frame *i* presents at
  0.036 + i/60 s (requestVideoFrameCallback, residual 0). The frontend
  sends `t = max(0, currentTime − start_offset)`; on `ended` it sends the
  full duration so the engine reaches the last frame.
- **Engine warm-up before `ready`.** The first CUDA inference took ~20 s
  and would otherwise have consumed the start of playback; the trackers
  are reset after the warm-up so it leaves no identity state.
- **Escalated stop keeps its reason.** If an engine needs terminate/kill
  after a user stop or disconnect, the session ends `stopped` /
  `disconnected`, not `crashed`.
- **`strike_type` field.** Event messages carry `strike_type`, because
  `type` already names the message.
- **Pacing epsilon.** `bisect_right(ts, limit + 1e-6)` absorbs float
  rounding that otherwise skipped a frame exactly on its timestamp.
- **Status bar follows the live session.** On Live Monitoring, a live
  session's phase replaces the old job wording, which had said the live
  engine was "not connected" while it ran.
- **Identity check hides on 404.** A job without a live record shows no
  identity panel; any other failure is shown.
- **No live start while an offline job runs (server side).** The design
  kept the GPU sequential only in the frontend. The browser test showed a
  second client could start the engine during a pipeline run, so
  `POST /live-sessions` now answers 409 while a job this API process
  started is still running (`main.offline_job_active()`, tracked in
  memory so a crashed server's stale `processing` status cannot block live
  analysis forever). `POST /jobs` itself is unchanged: it is not refused
  while a live session runs; the dashboard blocks that instead.
- **Overlay while playing (pacing vs display rules).** The engine never
  analyses beyond the last clock the browser sent (design 8), so its
  newest result always trails the picture by about
  `playback rate x (clock age + inference + transport)`: 0.15-0.4 s at 1x.
  The display rule draws a result only within one analysed-frame interval
  (16.7 ms at 60 analysed fps). Together they hide the skeleton during
  almost all playback (measured: drawn on 1 % of animation frames). Safest
  choice kept: never draw a stale skeleton on the wrong pose. Instead the
  stage says "Pose overlay hidden while playing: the newest result is N ms
  behind the picture", the clock is sent every 33 ms (design 8 as amended
  by the fast-clock design), and on Pause the engine reaches the paused frame and the
  overlay is exact (measured at 1x: the note read 400-450 ms behind with
  a 200 ms clock, 350 ms with 100 ms). Showing the overlay during playback needs a design
  change: either draw late results with their lag stated, or let the
  engine extrapolate the clock (weakening the stop-within-one-frame
  guarantee of Pause). The user confirmed this safe behaviour on
  2026-11-17: no late skeletons; lag message while playing; exact overlay
  when paused.

## Tests

```powershell
python -m pytest tests -q        # backend
cd frontend; npm test; npm run typecheck; npm run lint; npm run build
python -m live.realcheck --video jobs/<id>/input/input.mp4 --rate 1 --rate 0.1 --analyse
```

The real check needs the backend running; it reports GPU memory before,
during and after each session and at the moment the hand-off returns.

Final results on 2026-11-17, on the committed code:

| Command | Result |
|---|---|
| `python -m pytest tests` (Anaconda Python 3.13.9, PyAV installed) | 169 passed, 0 skipped |
| `npm test` (vitest) | 312 passed, 27 files |
| `npm run typecheck` (`tsc -b`) | exit 0 |
| `npm run lint` (oxlint) | exit 0, no findings |
| `npm run build` | built |

**PyAV is a fixture-building tool, not a runtime dependency.** PyAV 19.0.2
(`av`, with its own FFmpeg libraries, libavformat 63.1) was installed into
the Anaconda base environment on 2026-11-17 with the user's approval, only
to build `tests/fixtures/drift_60.mp4`. It is not in `requirements.txt`:
the API, the engine and the main drift test do not import it. Without
PyAV, `pytest` still runs the drift test on the committed file and skips
only the two checks that need PyAV (the independent packet read and the
no-drift control).

### Real-MP4 drift test

`tests/fixtures/make_drift_fixture.py` writes a real MP4 (MPEG-4 Part 2, no
B-frames, 128x72, 61 frames) in a 1/60000 s time base, setting every
packet's timestamp and duration directly: gaps 1-30 are one period +
0.9 ms, gaps 31-60 one period - 0.9 ms, and every packet lasts one
period. This is design 6.3's drift example in a file: each gap is within
T7's 1 ms tolerance, frame 30 is 27 ms late, the last frame is on time,
and the container reports exactly 60 fps (the failure of design 6.7's
attempt 2).

```powershell
python -m pytest tests/test_live_probe.py -v -k drift
```

| Test | Result |
|---|---|
| `test_real_mp4_drift_fixture_is_rejected_by_t8_alone` | passed: the real probe (OpenCV FFMPEG decode + ffprobe packets) rejects the file with **only T8 failing**, "worst deviation 27.000 ms at frame 30 (tolerance 1.000)"; T4 passes (decoded vs packet within 0.0003 ms), T7 passes (worst gap error 0.900 ms), T9 passes (60.000 fps) |
| `test_drift_fixture_packets_carry_the_drift` | passed: PyAV reads the committed file's packets, independently of the probe, and finds exactly the generated timestamps |
| `test_same_fixture_without_drift_is_accepted` | passed: the same generator with zero drift is accepted (T1-T9), so the rejection comes from the drift, not the codec or container |

No rule, tolerance or assertion was changed to obtain these results.

## Measured on the real 6 s clip (2026-11-17)

`live.realcheck` through the running API, laptop on AC power, NVIDIA GeForce RTX 4050 Laptop GPU
(`cuda:0`). Clip: 360 frames, 60 fps, 1920x1020, start offset 36 ms.

| | 1x playback | 0.1x playback |
|---|---|---|
| Upload + timing check | 2.6 s (accepted) | 2.8 s (accepted) |
| Model ready (incl. warm-up) | 26.3 s | 21.9 s |
| Frames analysed / skipped | 27 / 333 | 356 / 4 |
| Analysed rate | 4.5 /s | 60 /s |
| Event detection | inactive: "analysed rate 4.5 frames/s is below 10" | active, 5.9 s |
| Events (scored / unscored warm-up) | 0 | 24 (2 / 22) |
| End reason | `video_end` | `video_end` |
| GPU memory baseline / peak / after exit | 0 / 171 / 0 MiB | 0 / 171 / 0 MiB |

**Normal-speed live detection is not reliable on this hardware.** At 1x
the engine analysed 4.5 frames per second, below the 10 frames-per-second
threshold, so detection stayed inactive and emitted nothing. The 0.1x run
is a separate test observation: slowing playback gives the engine time to
analyse every frame, which is how the detector itself was exercised on
real video. It does not show what 1x would give on faster hardware.

Hand-off of the 0.1x session: GPU memory **0 MiB** at the moment
`/analyse` returned (no Python process on the GPU); the offline job
completed in 419 s. Identity check: **agree**, 6.0 s compared of 6.0 s,
nothing uncompared.

Live vs offline events (same stream, peaks within 2 frames): 18 of the
24 live events match one of the 25 offline candidates; 6 live-only,
7 offline-only. **Every matched live peak is exactly one frame (16.7 ms)
later than offline.** That is the shift design 10.4 predicts from the
trailing smoothing window (10.3 step 2: offline smooths with a centred
3-sample median). Of the two scored live events, one matches the offline
class (Strong) and one does not (live 61.0 Review, offline 40.1 Low): the
one-frame shift moves the feature windows too. A centred median could be
finalised causally one frame later (16.7 ms more delay) and would remove
the shift; that changes an approved design rule, so it is not done.

Browser (Playwright, Chromium, Vite dev server + the API, same clip at
0.1x): Start live disabled with a reason until a file is chosen; live in
36 s on `cuda:0`; Pause froze the engine (100 frames analysed before and
3 s after); two Swaps; video end; the HUDs, metrics and event feed filled
from engine messages, all labelled provisional; skeletons aligned with
both fighters on the paused/ended frame; Analyse offline handed off and
the page followed the job, with Start live disabled ("one analysis runs
at a time") and a direct `POST /live-sessions` answered 409. After the job completed, Match Ended showed the identity check with one
disagreement interval, 00:03.000-00:04.000, exactly between the two
Swaps, linked to the logged swap; the scorecard itself is not relabelled.
A second session at 1x showed the hidden-overlay note while playing, the
exact overlay on Pause, and Discard removed the session folder.

## CUDA Graph inference (2026-11-17)

Design: `docs/superpowers/specs/2026-11-17-live-cuda-graph-design.md`.
The network forward (only that: ultralytics' preprocessing, NMS, keypoint
scaling and ByteTrack are unchanged; fp32, `imgsz` 640) is captured as a
CUDA Graph during the warm-up before `ready` and replayed for every frame
(`live/cuda_graph.py`, hooked in `YoloModel.warm_up`). On CPU, or if
capture fails, the engine runs the standard forward; the reason goes to
`engine.log`. `ready.inference` is `"cuda_graph"` or `"eager"` and the
dashboard's engine row shows "CUDA graph" or "standard inference".

Parity: the graphed and standard models gave **identical** tracker IDs,
boxes and keypoints on every frame of both real clips
(`test_graphed_model_matches_eager_on_every_frame_of_the_real_clips`).
A capture that fails midway leaves PyTorch on the capture stream with a
pending CUDA error; `_recover()` restores the stream and consumes the
error so the engine can continue eager (tested).
If a frame ever letterboxes to another shape than the captured one, the
graph is retired for good and the engine reports `eager` (logged as "CUDA
graph retired"): an eager forward at another shape makes the pose head
reallocate its cached anchors, which the graph points at, so replaying
later would silently read freed memory (found in review, reproduced and
tested).

Measured on the 6 s clip, AC power:

| | Before (eager) | With CUDA graph |
|---|---|---|
| Raw network forward (median) | 45-126 ms | 2.3 ms |
| One `YoloModel` call (median / p90) | 89.7 / 193 ms | 72.0 / 83.7 ms |
| `live.realcheck` 1x analysed rate | 4.5 /s | 9.2 /s (55 analysed, 305 skipped) |
| Browser 1x analysed rate (stats each second) | not measured | 10.0-12.9 /s |
| Event detection at 1x | inactive | realcheck: active only at the last tick; browser: active throughout |
| Events at 1x | 0 | 0 (both runs) |
| 0.1x | 60 /s, 24 events | 59.5 /s, 24 events, 19 matched offline, identity agree |
| GPU memory peak / after exit | 171 / 0 MiB | 275 / 0 MiB (hand-off: 0 MiB) |

Where a graphed frame's 72 ms goes now: ultralytics preprocess 10.6 ms
(CPU letterbox, upload), inference 16.6 ms (copy in, replay, output
copies), postprocess 25.9 ms (NMS, keypoint scaling), about 19 ms
ByteTrack, `.cpu()` transfers and list building. These are outside the
approved design (network forward only).

**Why 1x still finds no events, even with detection reported active.**
Limb speed is computed only between samples at most 3 frames (0.05 s)
apart (`LIMB_SPEED_MAX_GAP_FRAMES`, carried from offline
`analyze_strikes.py:198`). At 10-13 analysed frames per second of a 60 fps
video, analysed frames are about 5-6 frames apart, so every speed is null
and no peak can form. Detection can only emit events at roughly 20 or more
analysed frames per second, but the status turns "Active" at 10
(`MIN_ANALYSED_RATE`). This mismatch predated the CUDA graph; the user
chose to fix it by raising the threshold (next section).

## Detection threshold raised to 20 analysed frames per second (2026-11-17)

User decision (option a): the "detection active" threshold is now derived
from the speed rule instead of set beside it,
`MIN_ANALYSED_RATE = 1 / LIMB_SPEED_MAX_GAP` = 20 analysed frames per
second (`live/constants.py`). The detector itself is unchanged: same speed
gap, same peaks, same scores. Only what the status reports changes: 10-19
analysed fps, which could never produce an event, now reads inactive with
the reason "analysed rate N frames/s is below 20, the rate limb speed needs
(a sample every 0.05 s)", instead of "Active".

Measured after the change, 6 s clip at 1x (`live.realcheck`): CUDA graph,
57 analysed / 303 skipped, 9.5 analysed per second of video, detection
**inactive** with that reason, 0 events, GPU 0 MiB after exit. Tests:
`test_detection_threshold_is_the_rate_limb_speed_needs`,
`test_12_analysed_frames_per_second_is_reported_inactive_not_active`,
`test_30_analysed_frames_per_second_still_detects_the_punches`.

## Lean inference path (2026-11-17)

Design: `docs/superpowers/specs/2026-11-17-live-lean-inference-design.md`.
After warm-up (still through `model.track()`, which builds the predictor,
letterbox, ByteTrack and CUDA graph), each real frame goes through
`live/inference.py` `lean_track`: the predictor's own preprocess and graphed
inference, one copy of the raw predictions to the CPU, ultralytics' NMS and
box/keypoint scaling on the CPU with the predictor's own arguments, the
configured ByteTrack, and the same edge clipping `Results.update` applies.
Results objects and callbacks are skipped. `YoloModel(lean=False)` keeps
`model.track()` for comparison.

Parity (user accepted CPU vs GPU float rounding): same people, tracker IDs
and order on every frame of both real clips, boxes and keypoints within
0.001 (`tests/test_live_lean.py`). The test caught the edge clipping, which
the first version missed (69.6 px at the frame edge).

| 6 s clip, every 3rd frame, alternating runs | median | p90 |
|---|---|---|
| `model.track()` (graphed) | 77.4 ms | 97.6 ms |
| Lean path | **33.9 ms** | 56.3 ms |

**1x is capped at 10 analysed frames per second by the clock, not by
inference.** The engine never analyses past the last browser clock
(design 8) and picks the newest frame at or before it; the browser and
`live.realcheck` send the clock every 100 ms (design: "every 100-250 ms
while playing"). So at most one new frame becomes eligible per 100 ms.
Measured with the lean path: `live.realcheck` 1x 60 analysed / 300 skipped
(10.0 per second of video), browser 10.0 /s after start-up; both inactive
with the 20 /s reason, 0 events. Every 1x run since the CUDA graph
settled at about 10 /s; start-up readings up to 12.9 /s come from the extra
clocks the browser sends on play/playing/seeked events and the short
initial rate window. 0.1x unchanged: 59.5 /s, 24 events, 19 matched
offline, identity agree. GPU memory (whole device, `nvidia-smi`): baseline
101 MiB before the session, peak 376 MiB, 101 MiB after exit and at the
hand-off, with no Python process listed (only Figma). The engine released
everything it used; the 101 MiB was already in use before it started.

The parity guard needs the two real clips in `jobs/`, which git ignores; on
a machine without them it skips. ultralytics is not pinned in
`requirements.txt` (changing dependency files needs the user's approval),
so after an ultralytics upgrade run `tests/test_live_lean.py` where the clips
exist before trusting the lean path.

## 33 ms clock (2026-11-17)

Design: `docs/superpowers/specs/2026-11-17-live-fast-clock-design.md`.
The browser (`CLOCK_INTERVAL_MS`) and `live.realcheck` (`CLOCK_INTERVAL_S`)
now send the playing clock every 33 ms instead of 100 ms, which lifts the
1x ceiling from 10 to about 30 eligible frames per second. The pacing rule
is unchanged: the engine never analyses past the last clock.

Measured on the 6 s clip, lean path, CUDA graph:

| | 1x before (100 ms) | 1x now (33 ms) | 0.1x now |
|---|---|---|---|
| `live.realcheck` analysed / skipped | 60 / 300 | 176 / 184 | 360 / 0 |
| Analysed per second of video | 10.0 | **29.3** (last window 28.5) | 60.0 |
| Detection active at end | no (20 /s reason) | **yes** | yes |
| Events emitted (scored) | 0 | 18 (0, all ranking warm-up) | 23 (2) |
| Browser analysed / skipped | about 10 /s | 163 / 197 (**27.2 /s**), events listed | not re-run |
| GPU memory (`nvidia-smi`) after exit / Discard | 0 extra | 0 MiB | 0 MiB |

Hand-off after the 0.1x run: offline completed, 25 offline candidates vs
23 live events, 19 matched, identity check agree over the full 6.0 s.
None of the 1x events is scored because the first four candidates per
limb are ranking warm-up and a 6 s clip at 30 /s produces fewer candidates
per limb than at 60 /s. This is expected behaviour, not a regression.

## Known limitations

- **Drift rejection is verified on one constructed real file.** The
  drift test covers design 6.3's pattern (0.9 ms per gap, 27 ms at frame
  30) in an MPEG-4 Part 2 file. It does not cover every encoder or
  container. Verification remains two readers agreeing (OpenCV's FFmpeg
  and the 2013 ffprobe), so a demuxer error shared by both cannot be
  ruled out (design 17).
- **Analysed rate decides whether events are detected.** Below 20
  analysed frames per second (the rate the 0.05 s limb-speed gap needs),
  detection is reported inactive with the reason. With the lean path and
  the 33 ms clock this laptop reaches about 27-29 analysed fps at 1x on
  the 6 s clip, so detection is active at normal speed (see "33 ms clock").
  The margin over 20 /s is about 7-9 fps; a slower GPU, a busier laptop or
  battery power can drop below it, and the dashboard then says so.
- **Overlay hidden during playback** (see Decisions): exact when paused.
- **Live event peaks are one frame (16.7 ms) late** relative to offline, on
  every matched event, as design 10.4 predicts from the trailing smoothing
  window; scores and classes can differ as a result.
- **Live scores rank against earlier events only**; the first four
  candidates per limb are unscored warm-up, so short clips differ from
  the offline run.
- **Only 59.9–60.1 fps video is accepted live** (the offline detector
  assumes 60 fps). Other files can still be analysed offline.
- **Tracker ID swaps while both IDs stay present are not detected**;
  use Swap.
- Seeding copies the offline rule (tracker IDs 1 and 2), so a referee
  given one of those IDs is mislabelled identically live and offline.
