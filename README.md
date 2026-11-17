# MMA Vision

Experimental analysis of MMA fight video from pose estimation. MMA Vision
tracks the two fighters with YOLO11n-pose and ByteTrack, measures their
movement and spacing, estimates **strike-like movements** (punch-like and
kick-like) from limb speed, extension and joint angles, and produces an
**experimental activity scorecard**.

> **What it is not.** MMA Vision does not detect contact, landed strikes or
> damage, does not judge fights or pick a winner, and gives no probabilities.
> Distances are in image pixels, not metres. Real-world detection accuracy is
> **not established** yet: see [docs/validation.md](docs/validation.md).

## Features

* **Offline analysis** (authoritative): a nine-stage pipeline over the whole
  video produces the final strike-like event candidates, movement metrics,
  charts, an annotated video and the experimental scorecard.
* **Live monitoring** (provisional): analyses the video *while it plays* in
  the browser, paced by the browser's playback clock, with Blue/Red identity
  tracking, live metrics and provisional events. When it ends, the same file
  is handed to the offline pipeline and an identity check compares the live
  Blue/Red labels with the final ones.
* **Dashboard**: React app for both, with downloads of every report and CSV.
* **Validation tools**: a frame-accurate review page for labelling detected
  and missed events, metrics (precision, recall, F1, false positives per
  minute, timing error), and a deterministic replay of the live detector.

## Architecture

```
frontend/ (React 19, TypeScript, Vite)          api/ (FastAPI)
  Live Monitoring | Match Ended   --/api-->      POST /jobs ......... offline pipeline (src/, 9 stages, subprocess)
  WebSocket (clock in, frames/events out)        /live-sessions ..... live engine (live/, child process)
                                                     probe: ffprobe + OpenCV timing check
                                                     engine: YOLO11n-pose (CUDA graph, lean path) + ByteTrack
                                                             -> identity (Blue/Red) -> causal detector -> metrics
models/yolo11n-pose.pt     jobs/<id>/ (results)     live_sessions/<id>/ (until hand-off or discard)
```

Only one analysis uses the GPU at a time: a live session cannot start while an
offline job runs, and the engine exits before the hand-off to offline.

| Path | Contents |
|---|---|
| `api/` | FastAPI app: offline jobs (`main.py`), live sessions (`live_api.py`) |
| `src/` | The nine offline stages (`pipeline.py` runs them in order); `pose_pass.py` (one shared pose pass, device choice), `kinematics.py` (speed between observations) |
| `live/` | Live engine: timing probe, pacing, identity, detector, metrics, CUDA graph, lean inference, replay tool |
| `evaluation/` | `review.html` labelling page, `metrics.py` (scores a labelled list), `score.py` (scores any detector against labelled ground truth; dataset layout) |
| `frontend/` | Dashboard |
| `tests/` | Backend tests (pytest) |
| `docs/` | Engineering docs: [live engine](docs/live-engine.md), [validation](docs/validation.md), designs and plans |

## Prerequisites

* Python 3.13 with PyTorch (the version it is developed and tested on; older
  versions are untested). A CUDA GPU is optional: the
  live engine falls back to the CPU, but see "GPU and CPU" below.
* Node.js 20.19+ or 22.12+ (Vite 8's requirement; developed on 26) and npm.
* `ffmpeg` and `ffprobe` on `PATH` (or set `MMA_FFMPEG` / `MMA_FFPROBE`):
  ffprobe for the live timing check, ffmpeg for the browser-playable video.

## Setup (Windows, VS Code, PowerShell)

Open the repository folder in VS Code and a PowerShell terminal
(**Terminal > New Terminal**). Every command below starts from the repository
root, `C:\...\MMA_Vision`.

```powershell
# 1. Python environment (either a venv ...)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
#    If PowerShell refuses to run the script, allow local scripts once for your user:
#    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#    (... or an existing Anaconda environment: conda activate <env>)

# 2. PyTorch: the CUDA build for an NVIDIA GPU (omit --index-url for CPU only)
pip install torch --index-url https://download.pytorch.org/whl/cu126

# 3. Backend packages: runtime + test tools (requirements.txt is runtime only)
pip install -r requirements-dev.txt

# 4. Check: the second value must be True to use the GPU
python -c "import cv2, torch; print(torch.__version__, torch.cuda.is_available())"

# 5. Frontend
cd frontend
npm install
Copy-Item .env.example .env     # optional: the default backend address is http://127.0.0.1:8000
cd ..
```

In VS Code, choose the same interpreter for the editor:
**Ctrl+Shift+P > Python: Select Interpreter** > `.venv` (or the conda env).

> **"OMP: Error #15 ... libiomp5md.dll already initialized"** (seen with
> Anaconda): two copies of the OpenMP runtime were loaded, which happens when
> `torch` is imported *before* `cv2`/`ultralytics` in the same Python process.
> The project always imports `cv2` first. In your own scripts, do the same; do
> not set `KMP_DUPLICATE_LIB_OK=TRUE` (it can silently corrupt results).

### Model

`models/yolo11n-pose.pt` (Ultralytics YOLO11n-pose, about 6 MB) is in the
repository and is loaded from that path by both the pipeline and the live
engine. If it is missing, download `yolo11n-pose.pt` from Ultralytics and put it
there. **Licence:** Ultralytics YOLO models and the `ultralytics` package are
published under AGPL-3.0 (an Enterprise licence is also offered). Check that
your use and distribution of this repository complies.

## Running

Two PowerShell terminals in VS Code (the **+** in the terminal panel opens a
second one), both from the repository root with the Python environment active:

```powershell
# Terminal 1: backend (FastAPI on port 8000)
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000

# Terminal 2: dashboard (Vite dev server)
cd frontend
npm run dev
```

Stop either with **Ctrl+C**.

Open the address Vite prints (normally http://localhost:5173). The dev server
forwards `/api/*`, including the live WebSocket, to the backend. If the
dashboard says *"its /api proxy is not active"*, stop and restart
`npm run dev`.

### Offline analysis

Select an MP4 (or drop it on the stage) and choose **Analyse video**. The job
runs the nine stages with live progress, then **Match Ended** shows the
experimental scorecard, event comparisons, movement analysis, charts, the
annotated replay and downloads of every report and CSV.

Only one offline analysis runs at a time (a second upload waits as *queued*),
and none starts while a live session runs: both use the GPU.

### Reading the results

* **Experimental Activity Score** = 3 points per *Very Strong* + 2 per
  *Strong* strike-like movement (*Review* and *Low* score 0). The fighter with
  more points has the **Higher Experimental Activity Score**. It is a count of
  pose-estimated movement, not judging, not landed strikes, not a winner.
* **Strike-like movement** (punch-like, kick-like): a peak of wrist or ankle
  speed with the limb extending and the joint opening, from pose keypoints
  alone. The kinematic score (0-100) ranks candidates; it is not a probability.
* **Measured values**: distance between the fighters' box centres in pixels
  and as a percentage of the frame diagonal; movement speed in pixels per
  second (box centre, wrists, ankles); the pose model's own keypoint
  confidence (0-1). No metres: the camera is not calibrated.
* **Heuristic estimates**: event type, detection class, kinematic score and
  the activity score.

### Live monitoring

1. Select an MP4 and choose **Start live**. The upload is checked first:
   OpenCV and ffprobe must agree on every frame's timestamp at a constant
   60 fps. A refused video says which rule failed and can still be analysed
   offline.
2. The engine loads the model (warm-up about 7-20 s), then **Play** drives the
   analysis: the browser sends its playback time every 33 ms and the engine
   analyses the newest frame at or before it. It never runs ahead of the
   picture. Seeking forward skips frames; the engine never goes back.
3. The engine status shows the device and inference mode, the analysed rate
   and whether event detection is **active**. Detection needs at least 20
   analysed frames per second (limb speed is measured between samples at most
   0.05 s apart); below that it says *inactive* and why.
4. **Pause** shows the pose overlay exactly on the paused frame (during
   playback it is hidden rather than drawn late). **Swap** exchanges Blue and
   Red from that moment and is logged.
5. **End** (or the video ending) stops the engine and frees the GPU. Then
   **Analyse offline** runs the pipeline on the same file and adds the
   **identity check**, or **Discard** deletes the session.

Everything live is labelled provisional. The final analytics come only from
the offline pipeline, which the live session never changes.

## API

Interactive docs: http://127.0.0.1:8000/docs while the backend runs.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | health check: message, version, link to `/docs` |
| `POST` | `/jobs` | upload an MP4 (multipart `file`, up to 500 MB) and start offline analysis; 202 `{job_id}` |
| `GET` | `/jobs/{id}` | status and stage progress |
| `GET` | `/jobs/{id}/results` | scorecard and summary |
| `GET` | `/jobs/{id}/artifacts` | downloadable files |
| `GET` | `/jobs/{id}/files/{path}` | one artifact (reports, CSVs, charts, annotated video) |
| `GET` | `/jobs/{id}/video` | browser-playable (H.264) copy of the annotated video |
| `POST` | `/live-sessions` | upload and verify a video for live monitoring; 201, or 409 busy, 422 timing refused |
| `GET` | `/live-sessions/{id}` | session summary |
| `WS` | `/live-sessions/{id}/stream` | live engine messages; the browser sends `clock`, `swap`, `stop` |
| `POST` | `/live-sessions/{id}/analyse` | hand the ended session's file to offline analysis |
| `DELETE` | `/live-sessions/{id}` | discard a session (stops the engine, deletes its files) |
| `GET` | `/jobs/{id}/identity-check` | live vs final Blue/Red labels for a handed-off job |

Message formats and lifecycle rules: [docs/live-engine.md](docs/live-engine.md).

## GPU and CPU

* With CUDA, the live engine replays the network as a CUDA graph and uses a
  lean inference path. Measured on the development laptop: about 29 analysed
  frames per second at 1x on the 15 s test clip, GPU peak 275 MiB, released on
  exit.
* Without CUDA it runs on the CPU (measured 16.8 analysed frames per second at
  1x): live event detection is then reported **inactive** with the reason, and
  slower playback (for example 0.25x) gives it enough frames.
* Offline analysis runs one pose pass over the video (Movement Analysis; the
  Pose Estimation stage reuses its keypoints, see `src/pose_pass.py`) on the
  GPU when PyTorch sees one. Set `MMA_OFFLINE_DEVICE` to choose: `auto`
  (default: GPU if available, else CPU), `cpu`, or `cuda` / `cuda:N`. An
  explicit CUDA device that does not exist stops the job with a clear error
  instead of silently running on the CPU. The keypoints are reused only when
  the video, the model file's contents, the tracking settings, the keypoint
  threshold and the ultralytics version all match and the keypoint file is
  unchanged; otherwise the stage runs its own pass. Measured on the 6 s clip, the two pose stages took
  66 s before (two CPU passes), 39 s with one CPU pass and 21 s on the GPU
  (RTX 4050 Laptop, including model load and writing the annotated video).
  On the CPU the one pass is byte-identical to the two before. GPU and CPU
  keypoints are not identical: on the 15 s test clip the median difference
  was 0.02 px, but 11 of 1,800 fighter rows differed by more than 5 px (up to
  38 px, frames where the model is unsure), and one borderline event changed
  from punch-like (CPU) to kick-like (GPU), so Blue's Experimental Activity
  Score was 8 on the CPU and 7 on the GPU; the other 10 final events were the
  same. Neither device is known to be more accurate (there is no labelled
  ground truth). Use `MMA_OFFLINE_DEVICE=cpu` when results must match the
  earlier CPU-only versions. Full pipeline on that clip: 235 s before this
  change (two CPU passes), 158 s with one CPU pass, 72 s on the GPU.

## Videos

* MP4, up to 500 MB.
* Live monitoring: constant 60 fps (59.9-60.1) with verifiable timestamps.
* Offline analysis: the strike stages assume 60 fps, so other frame rates give
  unreliable strike-like timings.
* Uploaded videos and all outputs stay in `jobs/`, `live_sessions/`, `results/`
  and `videos/`, which git ignores. Do not commit fight footage you do not have
  the rights to.

## Testing

```powershell
python -m pytest tests -q          # backend; GPU/real-clip tests skip without CUDA or local clips
cd frontend
npm test                           # unit and integration tests (Vitest)
npm run typecheck
npm run lint
npm run build
cd ..
```

End-to-end checks with real footage (backend running):
`python -m live.realcheck --video C:\path\to\clip.mp4 --rate 1 --rate 0.1 --analyse`.

## Validating detection on your own footage

Accuracy can only be measured against people's labels. The tools:

1. **Label**: open `evaluation\review.html` in a browser (double-click it; no
   server, no network). Choose the MP4 and an events CSV (offline
   `classified_strike_candidates.csv` from the Match Ended downloads, or the
   live `events.csv`). Mark each event Correct / Wrong type / False positive /
   Duplicate / Uncertain, set the true peak time, add every missed movement,
   tick *I searched the whole video for missed events*, and export JSON.
2. **Metrics for that list**: `python -m evaluation.metrics review.json`.
3. **Compare detectors on the same labels**: put the export in
   `validation\datasets\<clip>\truth.json` (create the folder with
   `python -m evaluation.score init --video C:\path\to\clip.mp4 --name <clip>`),
   event lists in its `detections\`, then
   `python -m evaluation.score dataset validation\datasets`.

Precision, recall, F1, false positives per minute, duplicates, missed events
and timing error are reported overall, per fighter and per type. Below 100
reviewed detections and 10 minutes of video the report says accuracy is not
yet established. Details, and what has been measured so far:
[docs/validation.md](docs/validation.md).

## Known limitations

* **Detection accuracy is not established** (no human-labelled ground truth
  yet). Reviewing real events found footwork reported as kick-like, walking
  with the guard up reported as punch-like, and camera pans and zooms counted
  as limb speed. Pose alone cannot tell a feint from a strike or a landed
  strike from a missed one.
* One kick can still give two events: the leg landing after the kick can be a
  second kick-like event, and the arm swing during it a punch-like one. (The
  pivot of the standing leg is no longer counted: opposite-leg kick-like
  events within 0.35 s are one movement.)
* At 1x (about 30 analysed frames per second) live events mostly differ from
  the offline candidates, which are defined on 60 fps frame speeds.
* Live scores rank each candidate against earlier ones on the same limb; the
  first four per limb are unscored.
* Blue/Red are seeded from the first two tracker IDs; a referee given one of
  them is mislabelled. Use **Swap** to correct identities live.
* More in [docs/live-engine.md](docs/live-engine.md#known-limitations).

## Third-party software

ultralytics (AGPL-3.0), PyTorch (BSD-3-Clause), OpenCV (Apache-2.0), FastAPI
(MIT), Uvicorn (BSD-3-Clause), pandas, NumPy, Matplotlib; React (MIT), Vite (MIT),
Tailwind CSS (MIT), lucide-react (ISC). ffmpeg/ffprobe (LGPL/GPL, used as
external programs).

## Licence

MMA Vision is licensed under the GNU Affero General Public License v3.0
([LICENSE](LICENSE)), the licence of the Ultralytics package and YOLO models it
builds on. If you run a modified version as a network service, the AGPL
requires you to offer its source code to the service's users.
