# MMA Vision — simplified offline workflow

This version removes the video-upload and live-session routes from the FastAPI application and replaces them with folder-based offline analysis.

## Input video

Place exactly one `.mp4` file in:

```text
videos/input/
```

The API copies that file into a unique job directory before running the existing nine-stage pipeline. This keeps each run isolated and preserves the original input file.

## Start the backend

From the repository root, activate the Python environment and run:

```powershell
python -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

API documentation: `http://127.0.0.1:8000/docs`

## Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## Dashboard workflow

1. Ensure there is exactly one MP4 in `videos/input/`.
2. Click **Start Analysis**.
3. The frontend polls the job status over HTTP.
4. When the pipeline completes, the browser loads the annotated video and the final event list.
5. The event panel reads `final_strike_candidates.csv`, so it shows only events selected by the backend filter (kinematic score >= 65), not every preliminary candidate.
6. The final scorecards and generated files are displayed below.

## API routes used by this dashboard

- `GET /` — backend health
- `POST /analysis/start` — start analysis from the single MP4 in `videos/input/`
- `GET /analysis/current` — restore the most recently started job
- `GET /jobs/{job_id}` — processing status
- `GET /jobs/{job_id}/results` — final scorecard and report
- `GET /jobs/{job_id}/artifacts` — generated artifact list
- `GET /jobs/{job_id}/files/{file_path}` — artifact download
- `GET /jobs/{job_id}/video` — browser-playable annotated video

The nine-stage offline CV pipeline and its scoring logic are unchanged. Live-session routes are no longer registered by `api/main.py`.

## Important

The event kinematic score is a heuristic ranking from 0 to 100, not a probability. The events are estimated striking actions, not proof of physical contact or landed strikes. The final activity score is a separate experimental scorecard.
