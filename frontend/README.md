# MMA Vision dashboard

The single-dashboard frontend for MMA Vision. It has two states, **Live
Monitoring** and **Match Ended**, and never shows a number the backend did not
produce.

Built with React, TypeScript, Vite and Tailwind CSS.

## Run it

Start the FastAPI backend from the project root (the folder that contains
`api/` and `src/`):

```
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Then start the dashboard:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The backend address is set in `.env` (`VITE_API_BASE_URL`). The dev server
forwards `/api/*` to that address, so the browser needs no CORS setup and never
talks to the backend directly.

## Analyse a video

1. **Select MP4** (or drop a file on the stage). The video plays locally as a
   preview; nothing is uploaded yet.
2. **Analyse video** uploads it to `POST /jobs`. The job card then shows the
   status the backend reports, checked every 2.5 seconds.
3. When the job completes, the dashboard switches to **Match Ended** with the
   backend's scorecard, event counts, Review/Low counts, scorecard report and
   every file the run wrote, and the run event by event (below).

The address bar keeps the job: `http://localhost:5173/?job=<job_id>` reopens
that job after a reload, or on another tab.

While a job runs, the progress shown is exactly what `GET /jobs/{job_id}`
reports: the current stage and how many of the nine are complete. The backend
updates it as each stage starts and ends, so the bar steps by about 11 % and
holds still within a long stage.

## Match Ended, event by event

Everything here is read from the files the run wrote, through
`/jobs/{job_id}/files/...`. Nothing is recomputed that the backend reports
itself, and nothing is filled in when a file is missing: the panel says which
file it could not read.

- **Event timeline**: the candidate events of
  `classified_strike_candidates.csv`. It lists the scored events (Strong and
  Very Strong) by default, every candidate on request, and draws them on a
  strip with one lane per fighter.
- **Selected event**: an event's measurements and its opponent-direction
  values from `opponent_direction_analysis.csv`, with previous and next.
- **Replay**: the annotated video by default, from `GET /jobs/{job_id}/video`.
  The backend makes an H.264 copy of `movement_analysis.mp4` the first time
  it is asked for, frame for frame. The original footage is the other
  source, played from your own copy: the API does not serve the uploaded
  video, so it plays the file uploaded from this page or, for a job opened
  from its address, a copy you choose again with exactly the upload's size.
  Selecting an event jumps either video to the event's start.
- **Movement over time**: redrawn from `movement_metrics_cleaned.csv`, from
  the same columns the backend's PNG charts plot. The figures beside it are
  quoted from `movement_report.txt`, and the backend's own chart is one click
  away.
- **Opponent direction by event**: each event's direction alignment or
  approach change, grouped by detection class, with the class averages of
  `opponent_direction_report.txt`.

The annotated video, `movement_analysis.mp4`, is saved with the mp4v codec,
which Chrome, Edge and Firefox cannot play. The dashboard never plays that
file; it offers it as a download, and the replay plays the backend's H.264
copy. Making that copy needs ffmpeg with libx264 on the backend machine (on
PATH, or set `MMA_FFMPEG`).

## Check it

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm test`          | Runs the test suite once        |
| `npm run typecheck` | Type-checks the whole project   |
| `npm run lint`      | Lints the source                |
| `npm run build`     | Type-checks and builds `dist/`  |

The tests run the whole dashboard against an in-memory stand-in for the API
(`src/test/fakeBackend.ts`) that answers with the data of a real pipeline run.
Only `fetch` and `XMLHttpRequest` are replaced.

## Where things are

```
src/
  components/
    common/        top bar, state tabs, status bar, shared styles
    dashboard/     the two states, and the wording for each job state
    job/           the analysis job card (upload, queue, progress, outcome)
    video/         video stage, playback clock, timeline rail
    fighter-hud/   the Blue and Red corner HUDs
    live-metrics/  live metrics panel and monitoring controls
    timeline/      latest event, recent detections, event table and strip
    replay/        the replay player and the selected-event card
    charts/        line chart, playhead, legend swatches, series colours
    analytics/     Match Ended panels (scores, comparison, movement and
                   direction charts, reports, files)
  hooks/           chosen video, video clock, analysis job, backend health,
                   replay video, element width
  services/        API calls, response checks, polling, results loading,
                   event, movement and direction readers
  types/           shared data types, including the API's
  utils/           formatting, CSV and number parsing, scoring rules, chart
                   scales, seeking
  test/            test setup, fake backend, real-run fixtures
```

## Current status

Phase 3: Match Ended shows a completed job event by event: the event table
and strip, the selected event, a replay of the original footage, and the
movement and opponent-direction charts.

Phase 4: job progress follows the stages while a run is going, and the
replay plays the annotated video.

Not yet built: live tracking. The Live Monitoring counters, overlays and
metrics stay empty until the live engine exists. An offline analysis job
never fills them.
