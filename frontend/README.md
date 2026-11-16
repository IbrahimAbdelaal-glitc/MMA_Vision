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
   every file the run wrote.

The address bar keeps the job: `http://localhost:5173/?job=<job_id>` reopens
that job after a reload, or on another tab.

While a job runs, the progress shown is exactly what `GET /jobs/{job_id}`
reports. With the current backend that stays at "Starting pipeline", 0 %,
until the run ends, because `pipeline.py` does not flush its stage markers.

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
    timeline/      latest event, recent detections, event timeline
    analytics/     Match Ended panels (scores, comparison, reports, files)
  hooks/           chosen video, video clock, analysis job, backend health
  services/        API calls, response checks, polling, results loading
  types/           shared data types, including the API's
  utils/           formatting, CSV and number parsing, scoring rules
  test/            test setup, fake backend, real-run fixtures
```

## Current status

Phase 2: connected to the backend. Videos are uploaded and analysed, and Match
Ended shows the real results of a completed job.

Not yet built: event-by-event rows, movement and direction charts, and replay
(Phase 3); live tracking. The Live Monitoring counters, overlays and metrics
stay empty until the live engine exists. An offline analysis job never fills
them.
