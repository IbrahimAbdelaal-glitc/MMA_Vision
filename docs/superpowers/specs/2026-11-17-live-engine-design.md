# Phase 5: live analysis engine — design

**Status: Draft awaiting final approval. No Phase 5 implementation has started.**

## 1. Purpose and scope

The dashboard's Live Monitoring state exists, but every live value in it
is empty. Phase 5 builds the backend engine that fills it. While a
recorded MP4 plays at real-time pace, the engine tracks both fighters and
streams its measurements and provisional strike-like events to the
browser. The offline nine-stage pipeline remains the only source of the
final scorecard. Every live value is provisional and labelled as such.

Phase 5 delivers:

- the engine;
- its API;
- tests;
- a scripted end-to-end check.

Phase 6 delivers the dashboard side:

- the live state and its overlays;
- the Start live control;
- the identity flag in Match Ended.

## 2. Approved decisions

1. **Architecture.**
   - One child process per live session.
   - A WebSocket between the browser and the API.
   - The browser's playback clock is the timing authority.
   - Latest-frame-wins processing.
2. **Identity.**
   - Blue/Red identity is kept through tracker ID changes.
   - The user can correct it manually.
   - Live labels are compared with the final offline labels, and Match
     Ended shows both and flags disagreement.
   - The offline scorecard is never altered.
3. **Session flow.** The video is uploaded once and analysed live first.
   The engine process then exits, releasing the GPU, and the existing
   offline pipeline runs on the same file.
4. **Job creation.** A shared helper creates jobs.
   - `POST /jobs` is refactored internally to use it, keeping its exact
     external contract and behaviour.
   - Regression tests cover normal job creation and the live-to-offline
     hand-off.
5. **Identity comparison.** One-to-one: the same pairing against the
   crossed pairing, with an ambiguity margin (section 12).
6. **Live input.** Only constant-frame-rate video whose real decoded-frame
   timestamps are verified before the engine starts. Anything unverified
   is rejected (section 6). Live analysis accepts only 60 fps video
   (rule T9), because the offline detector assumes 60 fps.
7. **Events per minute.** The denominator is the elapsed video time while
   event detection is active, reported in seconds (section 10).
8. **Live event scoring.** The speed component of the live kinematic
   score ranks each event only against earlier events of the same
   fighter, limb side and event type. Each event's score and class are
   fixed before it is emitted and never revised. Events that cannot yet
   be ranked are emitted unscored and are not counted per minute
   (section 10).

Earlier approved decisions still apply:

- MP4 first, webcam later.
- Pose keypoint confidence.
- Distance in pixels and as % of the frame diagonal.
- The kinematic score is labelled as a heuristic.
- No strike confidence percentages, and no metres.
- Live detection is causal, provisional and separate from the scorecard.
- The result wording is "Higher Experimental Activity Score".

## 3. Goals, non-goals, anti-goals

**Goals**

- Analyse a verified constant-frame-rate MP4 live, in step with the
  browser's playback.
- Stream the following, each tied to a video frame:
  - both fighters' boxes and keypoints;
  - the `LiveMetrics` fields;
  - provisional strike-like events.
- Keep Blue/Red identity through tracker ID changes, with a manual swap.
- Once the engine has exited, hand the stored file to the offline pipeline.
- Record what the engine saw, so the final labels can be compared with it.

**Non-goals**

- Webcam input.
- Seeking during a live session.
- Any change to the nine pipeline scripts, their outputs or the scorecard.
- Dashboard UI (Phase 6).

**Anti-goals** (failures even if everything else works)

- A live value presented as final, or able to change the scorecard.
- A value that was not measured: invented, interpolated or carried forward.
- Implying that every frame was analysed when frames were skipped.
- A live event changed, withdrawn or relabelled after it was emitted.
- Contact claims (landed, hit, damage), strike probabilities, or metres.
- A live score total, leader or winner.

## 4. Constraints and environment

- **Additive backend changes only**, except the approved internal refactor
  of `POST /jobs`. No existing endpoint or response contract changes, and
  `GET /jobs/{id}` never reports a new status value.
- **Pipeline rules are restated, not imported.** The pipeline scripts run
  code when imported (`movement_analysis.py` loads YOLO at import), so the
  engine restates the constants it needs, each citing its source file and
  line.
- **Hardware.** 15.7 GB of RAM, often with under 3 GB free, and an RTX 4050
  laptop GPU.
  - At most one engine runs at a time.
  - The engine never runs at the same time as the offline pipeline.
  - The engine uses CUDA when available, otherwise the CPU, and reports
    which.
  - The offline pipeline keeps `device="cpu"`.
- **Software.** Windows, Anaconda Python 3.13, OpenCV 5.0.0 (FFMPEG
  backend), ultralytics, CUDA torch, fastapi, uvicorn and websockets.
- **ffprobe.** The only ffprobe is a 2013 build in Python313\Scripts.
  - On both real clips, its packet timestamps agreed with OpenCV's
    decoded timestamps within 0.0007 ms (6.7).
  - Its frame decoding is unreliable: it reported 359 frames for a
    360-frame clip.
  - So it is used only for packet timestamps (section 6), and its limits
    are listed in 6.2.

## 5. Alternatives considered and rejected

| Decision | Rejected alternative | Reason |
|---|---|---|
| Where the engine runs | A thread inside the API process | Torch keeps GPU memory and the CUDA context until the server stops, and an engine crash would take the API down. |
| Where the engine runs | A separate engine server | Two services to run on one laptop. |
| Transport | Server-Sent Events plus POST controls | Splits one conversation across two channels. |
| Pacing | The engine's own 1x clock | Drifts from the picture whenever the browser pauses or buffers. |

## 6. Live input policy: verified real timestamps at a constant frame rate

Live analysis accepts an MP4 only if both of these are verified before a
session or engine exists:

- its decoded frames carry real presentation timestamps;
- those timestamps are evenly spaced, and each one lies on its expected
  constant-frame-rate time.

A file that fails, or cannot be checked, is rejected.

### 6.1 Timing sources and matching

1. **Decoded-frame timestamps.**
   - The probe opens the file with `cv2.VideoCapture(path, cv2.CAP_FFMPEG)`.
     It requires `getBackendName()` to be `"FFMPEG"`, so OpenCV never falls
     back to another backend silently.
   - After each `grab()`, it reads `CAP_PROP_POS_MSEC`. In the source of
     OpenCV's FFMPEG backend, that value is the decoded frame's
     best-effort presentation timestamp, relative to the stream's start
     time, and 0 when a frame has none. The design does not rely on that
     description: rule T4 checks every value against the container.
2. **Packet timestamps.** These are the container's presentation
   timestamps for every packet of the first video stream, read by ffprobe
   without decoding (`-select_streams v:0 -show_entries packet=pts_time`).
   This source is independent of OpenCV.

**Matching decoded frames to packets.**

- Packets are stored in decoding order. When a file has B-frames, the
  decoding order differs from the presentation order, so packet
  timestamps do not increase in file order. Both real clips are like this
  (6.7).
- The decoder outputs frames in presentation order. So the `i`-th decoded
  frame corresponds to the `i`-th packet once the packets are sorted by
  presentation timestamp.
- The probe therefore requires every packet timestamp to be present and
  distinct, sorts them, takes them relative to the earliest, and matches
  them to the decoded frames by position.
- Matching is by position only; it never looks for the closest
  timestamp. Any disagreement fails T4 and rejects the file: a count mismatch, a missing or repeated
  timestamp, or a frame that either tool drops or adds.

The probe runs in a short-lived subprocess (`live/probe.py`), so the API
process never loads OpenCV and a hung probe can be killed.

### 6.2 What the checks establish

**Backend self-check.** This runs once per API process, before its first
live upload is accepted.

- The probe reads a small bundled fixture,
  `live/fixtures/timestamp_check.mp4`: 60 frames, 64x36 pixels, with a
  known 100 ms timestamp jump at frame 30. It passes only if the backend
  reports that jump within 0.5 ms.
- **It establishes** that this OpenCV build, through
  `CAP_PROP_POS_MSEC`, reports the container's per-frame timestamps on
  that one file, not `index / fps`.
- **It does not establish** anything about any other file: not its
  B-frames, its start offset, its edit list or its timestamps. It is a
  capability check. It refuses live uploads up front with 503 ("this
  OpenCV build does not report real frame timestamps") instead of
  rejecting every upload through T4, and it confirms that the runtime
  check (6.6) reads real per-frame times.

**Per-file cross-check (rule T4).**

- **It establishes**, for the uploaded file, that each decoded frame's
  reported time equals a distinct container presentation timestamp, in
  presentation order, as read by a second and separate FFmpeg build,
  within 0.5 ms.
- This holds however OpenCV computes the value. A value synthesised from
  `index / fps` that differs from the container's timestamp fails T4.
  The guarantee for an accepted file therefore rests on T4, not on the
  self-check.

**What neither check establishes.**

- When the frames were captured. The guarantee is about the container's
  presentation timestamps, which are what players use.
- How the browser maps its playback clock to frames (6.5).
- Freedom from a demuxer error that both FFmpeg builds share. The two
  builds are years apart but share code, and the installed tools offer no
  third reader.

**Limits of the 2013 ffprobe, and the safe response.**

- It may handle MP4 edit lists, discarded packets or unusual timestamps
  differently from the newer FFmpeg inside OpenCV. Any such difference
  changes the count or the timestamps, so T4 fails and the file is
  rejected. The probe fails closed: a disagreement is never resolved in
  favour of accepting.
- Its frame decoding is unreliable (section 4), so it is never used for
  frame counts or decoded timing.
- So the verification is exactly this: two separate readers agree on
  every frame's timestamp. Nothing stronger is claimed, and any file on
  which they disagree is refused.

### 6.3 Acceptance rules

Every rule must pass. Throughout:

- `period = 1000 / fps` ms;
- `tolerance = max(1 ms, 2 % of period)`;
- `expected_i = i × period`, the timestamp frame `i` would have at a
  perfectly constant frame rate.

T7 and T8 share the same tolerance. At 60 fps it is 1 ms, which is under
a sixteenth of a frame period. So no frame can be mistaken for its
neighbour, and the drift T8 allows cannot grow with the length of the
video.

| Rule | Requirement |
|---|---|
| T1 Backend | Opened with `CAP_FFMPEG`, and `getBackendName()` is `"FFMPEG"`. |
| T2 Metadata | The reported fps is finite and above 0; the frame count, width and height are all above 0. |
| T3 Timestamps present | Every decoded timestamp is finite and at least 0, and none after the first frame equals 0. |
| T4 Real timestamps | The decoded frame count equals the reported frame count and the packet count. Every packet timestamp is present and distinct. Packet timestamps are sorted into presentation order and taken relative to the earliest, and the `i`-th decoded timestamp equals the `i`-th sorted packet timestamp within 0.5 ms (6.1). |
| T5 Start | The first decoded timestamp is within half a period of 0. |
| T6 Order | Decoded timestamps strictly increase. |
| T7 Constant spacing | Every gap between consecutive decoded timestamps is within the tolerance of the period. |
| T8 Absolute timing | Every decoded frame `i`, from the first to the last, satisfies `abs(t_i − expected_i) ≤ tolerance`. |
| T9 Live frame rate | The reported fps is between 59.9 and 60.1. |

T7 alone allows small errors that add up, and a check on the last frame
alone allows those errors to cancel out by the end. For example, in a
60-frame video at 60 fps, each of the first 30 gaps could be 0.9 ms long
and each of the next 29 gaps 0.9 ms short. Every gap would pass T7, and
the last frame would land within 0.9 ms of its expected time, yet frame 30
would be 27 ms late. T8 checks every frame against its own expected time,
so drift like this is rejected. T8 also covers the last frame, so no
separate end-of-video rule is needed.

The reported fps (`CAP_PROP_FPS`) is container metadata and is never
trusted by itself. It sets `period`, and T7 and T8 then reject any file
whose decoded timestamps disagree with it.

**Frame-rate policy (T9).** The offline detector converts frame counts
to time at a fixed 60 fps (`temporal_strike_detection.py:21`,
`analyze_strikes.py:19`), and the live detector mirrors its windows
(10.3). Live analysis therefore accepts only 60 fps video. The range
59.9–60.1 admits 59.94 fps (60000/1001), whose frame period differs
from 60 fps by 0.1 %. T7 and T8 still use the reported fps. Video at any
other frame rate is rejected for live analysis with 422, and can still
be analysed offline, where the pipeline is unchanged.

### 6.4 Results

- **Accepted.** The probe writes `probe.json` (section 11) with:
  - the fps;
  - the frame count, width and height;
  - the backend name and OpenCV version;
  - the ffprobe path;
  - the start offset, `start_offset_ms`: the earliest packet timestamp,
    as an absolute time;
  - the full list of verified decoded timestamps.
- **Rejected (422).** Any failed rule, including inconclusive files:
  - no metadata;
  - a decode error;
  - missing timestamps;
  - mismatched counts;
  - missing or repeated packet timestamps;
  - a frame rate outside 59.9–60.1 fps (T9);
  - a probe that runs longer than its 120 s limit.

  The response names the rule and the values found, and gives the remedy:
  "Use Analyse video, or re-encode the video at a constant frame rate."
- **Unavailable (503).** Any of these:
  - ffprobe cannot be found (looked for in `MMA_FFPROBE`, then on PATH,
    then next to the ffmpeg found for E2);
  - the probe cannot be started;
  - the backend self-check fails.
- **No unchecked files.** The stored upload is deleted after any 422 or
  503. No file is ever accepted unchecked.

### 6.5 Video time

The video time of frame `i` is its verified timestamp, `t_i`, from
`probe.json`. Rule T8 guarantees that every `t_i` equals `expected_i`
(that is, `i / fps`) within the tolerance. The offline run computes
`time_seconds` as `frame / fps`, so live and offline rows correspond by
frame index.

**Browser clock mapping (unverified).**

- `t_i` is relative to the stream's earliest timestamp. The 6 s clip's
  earliest packet is at 36 ms, about two frames, and the 15 s clip's is
  at 0 (6.7).
- Whether the browser's `currentTime` for frame `i` is `t_i` or `t_i`
  plus the start offset depends on the browser's own demuxer. It has
  not been measured, and Phase 5 has no browser in which to measure it.
- **Restriction.** The start offset is recorded in `probe.json` and
  returned in the 201 response. A required Phase 6 check measures, with
  `requestVideoFrameCallback`, the browser's media time for presented
  frames of both clips. Until it passes, frame-accurate alignment is not
  claimed for a file with a non-zero start offset. If it shows that the
  browser uses absolute times, files with a non-zero start offset are
  rejected for live analysis until a tested correction exists.

### 6.6 Runtime check

- **Same basis.** The engine opens the file the same way as the probe:
  `CAP_FFMPEG`, with the backend name checked.
- **Every frame.** After every `grab()`, including frames skipped without
  decoding, the engine reads `CAP_PROP_POS_MSEC` as `p_i`. It then
  applies the same per-frame basis the probe verified:
  - `abs(p_i − t_i) ≤ 0.5 ms`, where `t_i` is the verified timestamp from
    `probe.json` (the T4 cross-check tolerance);
  - `abs(p_i − expected_i) ≤ tolerance` (rule T8, with the same
    tolerance);
  - the frame index stays below the verified frame count.

  Spacing (T7) needs no separate runtime check: each grab is pinned to a
  verified `t_i`, and those timestamps passed T7 at upload.
- **On mismatch.** The engine sends `error` ("frame timing differs from
  the verified timing") and exits non-zero. The session ends as `crashed`
  (section 7). The record kept so far stays usable.

### 6.7 Evidence gathered while designing

This section records only checks that were actually run, on 2026-11-17,
before any Phase 5 code existed. The probe itself does not exist yet.

- **How they were run.** A throwaway script outside the project applied
  T1–T8 exactly as written in 6.3. Decoded timestamps were read with
  OpenCV 5.0.0 through the FFMPEG backend, and packet timestamps with the
  2013 ffprobe. The script is not project code, and it is not a
  substitute for the tests in section 16.

| Input | Decoded frames, packets | Reported fps | Failed rules | Worst decoded vs. packet (T4) | Worst gap error (T7) | Worst `abs(t_i − expected_i)` (T8) |
|---|---|---|---|---|---|---|
| 6 s clip | 360, 360 | 60.000 | None | 0.0003 ms | 0.000 ms | 0.000 ms |
| 15 s clip | 900, 900 | 60.000 | None | 0.0007 ms | 0.000 ms | 0.000 ms |
| Fixture with a 100 ms jump | 60, 60 | 54.545 | T7, T8 | 0.0003 ms | 98.3 ms | 50.0 ms |
| Fixture with alternating gaps | 60, 60 | 59.016 | T7, T8 | 0.0004 ms | 16.9 ms | 16.4 ms |
| Synthetic drift list (6.3 example, no file) | 60, not applicable | 60 (given) | T8 only (T4 not applicable) | Not applicable | 0.900 ms | 27.0 ms at frame 30; last frame 0.900 ms |
| Drift MP4, attempt 1 (2013 ffmpeg, `setpts`) | 60, 60 | 60.000 | T7, T8 | 0.0003 ms | 16.7 ms | 16.7 ms |
| Drift MP4, attempt 2 (2013 ffmpeg, `setpts`, 90 kHz output rate) | 60, 60 | 60.962 | T7, T8 | 0.0004 ms | 1.17 ms | 34.9 ms |

What these results show:

- **The two real clips pass every rule.** Their deviation from
  `expected_i` was 0.000 ms, well inside the 1 ms tolerance.
- **The two variable-frame-rate fixtures fail T7 and T8, and pass T4.**
  Their timestamps are real, but they are not constant-frame-rate.
- **The timestamps are real, not synthesised.** On both fixtures, the
  backend reported their actual timing rather than `index / fps`.
- **T8 catches drift that T7 misses.** On the synthetic drift list, every
  gap passes T7 and only T8 fails.
- **The real drift MP4 has not been verified.** Neither attempt produced
  a file that isolates T8:
  - attempt 1: the 2013 libx264 encoder rounded every timestamp to a
    whole 1/60 s step, which removed the drift and moved frames by whole
    periods;
  - attempt 2: the drift survived, but the container's reported fps
    became 60.962, because it is derived from the file's duration and the
    last frame received almost no duration. The period then no longer
    matched, so T7 also failed.

  Both files were rejected, as they must be, but neither proves that T8
  alone rejects drift in a real file. Building that fixture needs a tool
  that sets each packet's timestamp and duration directly (section 16).
- **Reported fps is checked, not trusted.** Attempt 2 shows a file whose
  fps metadata disagrees with its timestamps being rejected by T7 and T8.
- **The 2013 ffprobe's frame decoding is unreliable.** In a separate run,
  also on 2026-11-17, it reported 359 frames for the 6 s clip, with uneven
  start timestamps. That is why the decoded timestamps come from OpenCV.

**Packet order and start offset,** also run on 2026-11-17 with the same
script. "Out-of-order steps" counts adjacent packets in file order where
the later one has the earlier timestamp. The two B-frame fixtures were
made with the 2013 ffmpeg (libx264, `-bf 3`, 2 s cut from the 6 s clip).

| Input | Packets | Out-of-order steps | Earliest packet timestamp | Failed rules (T1–T8) |
|---|---|---|---|---|
| 6 s clip | 360 | 228 | 36.000 ms | None |
| 15 s clip | 900 | 570 | 0.000 ms | None |
| B-frame fixture, 60 fps | 120 | 29 | 0.000 ms | None |
| B-frame fixture, 30 fps | 60 | 16 | 0.000 ms | None |

- **Both real clips have reordered packets,** and sorting the packet
  timestamps matched every decoded frame, so matching by sorted position
  (6.1) is required and works on these files.
- **The 6 s clip has a 36 ms start offset.** Both tools take times
  relative to the start, so it passes. The browser side is open (6.5).
- **T1–T8 accept a 30 fps file.** That is why T9 exists. T9 was added
  after these runs, so neither table applies it. Under T9, the 30 fps
  fixture, both variable-frame-rate fixtures (54.545 and 59.016 fps) and
  drift attempt 2 (60.962 fps) are also rejected by T9.

## 7. Session lifecycle

The session registry is held in memory by the API (`live/sessions.py`).
Every session is in exactly one state.

| State | Meaning |
|---|---|
| `starting` | The upload is verified and stored. The engine process has been launched but has not sent `ready`. |
| `live` | The engine has sent `ready` and is analysing. |
| `ended` | The engine process has exited. The session stays available for the hand-off for 1 hour after it ended. |

| From | To | Trigger |
|---|---|---|
| (none) | `starting` | `POST /live-sessions` succeeds |
| `starting` | `live` | The engine sends `ready` |
| `starting` or `live` | `ended` | The engine process has exited, for one of the end reasons below |
| `ended` | Leaves the registry | Hand-off by `analyse`; removal by `DELETE`; or removal 1 hour after ending |

**Invariant.** A session becomes `ended` only after `poll()` confirms its
engine process has exited. Everything after that point can rely on two
things:

- the GPU is free;
- every session file is closed. On Windows, an open file cannot be moved.
  The API closes its own handle to `engine.log` immediately after
  launching the engine, so the only open handles belong to the engine,
  and the operating system closes them when it exits.

| End reason | Cause |
|---|---|
| `video_end` | The engine analysed the last frame and exited by itself. |
| `stopped` | A `stop` message, `analyse`, `DELETE`, or API shutdown. |
| `disconnected` | No WebSocket client for 60 s while `starting` or `live`. The 60 s counts from creation if no client ever connected. |
| `crashed` | Any of these: the engine exited non-zero; its stdout closed without an `ended` message; three consecutive stdout lines were not valid JSON; or the runtime timing check failed (6.6). |

**Stop procedure.** This is the only way an engine is stopped:

1. Send `stop` on stdin.
2. Wait up to 10 s for the process to exit.
3. If it is still running, terminate it and wait 5 s.
4. If it is still running, kill it.

The caller continues only once the exit is confirmed. The engine reads
stdin only between frames, so a `stop` that arrives during a frame takes
effect once that frame is finished; step 2 allows for this.

**Concurrency.**

- `POST /live-sessions` returns 409 while any session is `starting` or
  `live`. Sessions in `ended` do not block a new one.
- Only one WebSocket client may be connected to a session at a time.
- Each session has a lock. `analyse`, `DELETE`, the retention clean-up
  and API shutdown each hold it while they run, so they never overlap.
  After a hand-off or a deletion, the next of them finds no session and
  returns 404.

**Disconnects.**

- When the client disconnects, the API sends the engine
  `clock {t: last reported t, playing: false}`, so the engine idles
  exactly as when paused.
- A client may reconnect while the session is `starting` or `live`. It
  then receives `ready` (once that has been sent) and the latest `stats`,
  and the engine continues from the client's clock.

**Crashes.**

- The connected client receives `error`, with the last lines of
  `engine.log`, and then the socket closes.
- The files recorded so far are kept, and `analyse` remains available.

**Orphan protection.** The engine exits when its stdin closes. If the API
process dies, no engine is left holding the GPU.

**API shutdown and start-up.**

- On shutdown (the FastAPI lifespan), every `starting` or `live` session
  is stopped with the stop procedure.
- On start-up, every folder under `live_sessions/` is removed. The
  registry is in memory, so sessions cannot resume after a restart.

**Clean-up scope.** Clean-up only ever touches `live_sessions/`. It never
touches `jobs/` or the pipeline's files.

## 8. Frame timing and pacing

The browser sends `clock {t, playing}`:

- every 33 ms while playing (was 100–250 ms; amended by `2026-11-17-live-fast-clock-design.md`);
- immediately on play, pause and seeking;
- immediately on `waiting` (buffering), with `playing: false`, and on
  `playing` (playback resumed), with `playing: true`;
- on the video's `ended` event, with `t` equal to the video's duration.

The engine's target frame is the last frame `i` with `t_i ≤ t`.

**Advance limit.**

- Between frames, the engine reads every message waiting on stdin, in
  order. The most recent clock message sets the advance limit, whether
  it moved forward or was answered with `clock_rejected`.
- Each target is chosen from the limit in force at that moment. The
  engine never grabs or analyses a frame whose `t_i` is greater than the
  limit.
- A message that arrives during a frame takes effect after that frame.
  So after a pause, at most the frame already in progress finishes, and
  it was chosen within the limit in force when it started.
- Many clock messages that arrive during one frame collapse to the most
  recent one: latest frame wins.

| Situation | Engine behaviour |
|---|---|
| `playing` is false | Idles. |
| `playing` is true, but no clock update for 2 s | Idles until the next update. |
| The target is at or behind the last analysed frame, and `t` is no more than 0.1 s before that frame's time | Idles: there is nothing new to analyse. |
| `t` is more than 0.1 s before the last analysed frame's time | Replies `clock_rejected` and keeps its position. It never rewinds. |
| The target is ahead | `grab()`s forward without decoding, counting the frames passed over as skipped (each still timing-checked, 6.6). Then it decodes and analyses the target. It never seeks. |
| The target is the last frame | Analyses it, then ends with `video_end`. |

**Gaps between analysed frames.**

- **Over 0.25 s apart** in video time: movement speed for that step is
  null, and the detector resets (10.3).
- **Detection needs at least 10 analysed frames per second,** measured
  over the last 2 s of video time.
  - Below that rate, `stats` reports detection as inactive, with the
    reason, and no events are emitted.
  - Measurements continue regardless.
- **Always reported:** frames analysed, frames skipped, and the analysed
  rate.

**Display (Phase 6).** A `frame` result is drawn only while its `t` is
within one analysed-frame interval of the video's current time.

## 9. Live identity tracking

This section covers identity during live analysis. The comparison with
the final labels is in section 12, and its thresholds are separate.

**Model.** The engine uses the offline settings:

- `yolo11n-pose.pt`, run with `model.track`;
- `persist=True`, `conf=0.35`, `imgsz=640`;
- `tracker="bytetrack.yaml"`.

### 9.1 Corner states

In every analysed frame, each corner is in exactly one state.

| State | Meaning | Emitted for the corner |
|---|---|---|
| `tracked` | Assigned to a person in this frame | Box, 17 keypoints (x, y, confidence), tracker ID |
| `uncertain` | Unassigned people are present, but no assignment passes the rules in 9.3 | Nothing positional; dependent metrics are null |
| `lost` | No unassigned person is present, or the corner has not yet been seeded | Nothing positional; dependent metrics are null |

### 9.2 Seeding and continuity

- **Seeding** follows the offline run. Tracker ID 1 becomes Blue and
  tracker ID 2 becomes Red, each when it first appears. Until then, the
  corner is `lost`.
- **Continuity.** While a corner's tracker ID is present in the frame, the
  corner stays `tracked` on that ID.
- **Opening.** When the ID is absent, the corner becomes *open*. It keeps
  its last tracked centre `p_c`, box area `A_c` and video time `τ_c`.
- **Candidates.** The candidates for an open corner are the people in the
  current frame whose tracker IDs are not held by the other corner.

### 9.3 Re-association

These rules apply in every analysed frame while a corner is open. Here,
`D` is the frame diagonal and `Δt = t − τ_c`. For a candidate `k` with
centre `q_k` and box area `B_k`:

| Quantity | Definition |
|---|---|
| Distance `d` | `‖q_k − p_c‖ / D` |
| Distance gate `G(Δt)` | `min(G_base + G_rate × Δt, G_max)` |
| Size ratio `r` | `max(B_k / A_c, A_c / B_k)` |
| Size gate | `r ≤ R_max` |
| Eligibility | `d ≤ G(Δt)` and `r ≤ R_max` |
| Cost | `d / G(Δt) + ln(r) / ln(R_max)`, between 0 and 2 for eligible candidates |

**One open corner.**

1. If there are no eligible candidates, the corner is `uncertain` if any
   candidate is present and `lost` otherwise.
2. Otherwise, let `c1` be the lowest cost and `c2` the second lowest
   (infinity if there is only one).
3. The best candidate is accepted only if `c2 − c1 ≥ M_track`.
4. Any smaller difference, including an exact tie, leaves the corner
   `uncertain`.

**Two open corners (simultaneous assignment).**

1. List every complete assignment of two different candidates, one
   eligible for Blue and one eligible for Red. Its total cost is the sum
   of the two costs.
2. If at least one complete assignment exists, let `total_1` be the
   lowest total and `total_2` the second lowest (infinity if there is only
   one). The lowest-total assignment is accepted only if
   `total_2 − total_1 ≥ M_track`.
   Otherwise both corners are `uncertain`.
3. If no complete assignment exists, each corner follows the one-open-
   corner rule, using only candidates that are eligible for that corner
   alone. A candidate eligible for both corners leaves both corners
   `uncertain`.

**Determinism.**

- The outcome never depends on processing order.
- Ties are never broken by order: they leave corners `uncertain`.
- Candidates are listed in ascending tracker ID only so that logs are
  reproducible.

**Never guessing.** No other path assigns a corner. A corner is never
guessed, carried forward or interpolated.

### 9.4 Manual swap and logging

- **Swap.** A manual swap exchanges the two corners' assignments and open
  states from the current frame onwards. It is logged as a manual
  correction.
- **Logging.** Every seeding, re-association, change to `uncertain` or
  `lost`, and swap is written to `identity_log.csv` and emitted as an
  `identity` message. Re-associations include the costs and the margin.

## 10. Measurements and provisional events

### 10.1 Metrics

The definitions follow `movement_analysis.py`. A metric is null unless
everything it depends on was measured.

| Metric | Definition | Needs |
|---|---|---|
| Distance | Between the fighters' centres, in pixels and as % of the frame diagonal | Both corners `tracked` |
| Movement speed (px/s) | Centre displacement divided by `t_i − t_prev`, the verified times of the two analysed frames | The corner `tracked` in both frames, and a gap of 0.25 s or less |
| Mean keypoint confidence | Mean over the keypoints of `tracked` corners | At least one `tracked` corner |
| Fighters tracked | Number of `tracked` corners | Nothing |
| Keypoints tracked | Keypoints at or above the offline confidence threshold | Nothing |
| Provisional strike-like events per minute | Defined in 10.2 | At least 5 s of basis |

### 10.2 Provisional strike-like events per minute

This is emitted as `strike_like_events_per_minute`, always together with
`events_per_minute_basis_seconds` and `unscored_event_count`.

- **Numerator.** Emitted provisional events whose frozen kinematic score
  is 65 or more (Strong and Very Strong), mirroring what the scorecard
  counts (`filter_strikes.py:37`). Review and Low events are emitted but
  not counted.
- **Unscored events are never counted.** An event emitted during the
  ranking warm-up (10.3, step 8) has no score, so whether it would reach
  65 is unknown. It is excluded from the numerator, never later added,
  and counted in `unscored_event_count` instead, so the rate is always
  shown with the number of events it leaves out.
- **Denominator (`events_per_minute_basis_seconds`).** The elapsed video
  time while event detection was active (section 8). It is the sum of
  `t_i − t_prev` over consecutive analysed frames while detection was
  active.
  - Skipped frames inside those intervals count toward it.
  - Paused time adds nothing, because video time does not advance.
  - Periods of inactive detection add nothing.
  - The analysed-frame count and wall-clock processing time are never
    used.
- **Formula.** `count / (basis_seconds / 60)`. The value is null until
  the basis reaches 5 s.
- **Emission delay.** An event is emitted about 0.63 s of video after its
  peak (10.3, step 9), so the most recent strike-like movements are not
  yet in the numerator.
- **Per-corner counts.** Per-corner counts of provisional events may be
  emitted, with scored and unscored events counted separately. There is
  no score total, no leader and no winner.

### 10.3 Causal detector

The detector restates the offline rules of `analyze_strikes.py`,
`temporal_strike_detection.py`, `refine_strikes.py` and
`filter_strikes.py`. Every constant cites the file and line it mirrors,
and is changed only if those scripts change. Frame-based windows are
converted to seconds at the offline pipeline's 60 fps
(`temporal_strike_detection.py:21`, `analyze_strikes.py:19`). Live input
is 60 fps (T9), so these windows cover the same frames as offline.

**Streams.** Detection runs separately on each *stream*: one corner, one
side (left or right) and one type (punch-like from the wrist, kick-like
from the ankle). Each corner has four streams. The ranking pool, the
threshold samples, the pending peak and the held candidates all belong to
one stream.

**Causality.** Every step uses only analysed frames already seen, and
only samples recorded since the stream's last reset. A value, once
computed, is never recomputed from later frames.

**Step 1. Per-frame features** (`analyze_strikes.py:53-211`). For each
analysed frame in which the corner is `tracked`:

- a keypoint is used only if its confidence is at least 0.35
  (`analyze_strikes.py:20, 53-66`);
- the joint angle is at the elbow (shoulder, elbow, wrist) or the knee
  (hip, knee, ankle);
- the extension is the shoulder-to-wrist (arm) or hip-to-ankle (leg)
  distance divided by the same side's shoulder-to-hip torso length. It is
  null when the torso length is 0 or cannot be measured;
- the limb speed is the wrist or ankle displacement divided by
  `t_i − t_prev`, where `t_prev` is the previous analysed frame in which
  the corner was `tracked`. It is null unless the keypoint was usable in
  both frames and the gap is at most 0.05 s (3 frames,
  `analyze_strikes.py:186-211`), allowing the timestamp tolerance from
  6.3;
- a speed below 0 or above 3000 px/s is set to null
  (`temporal_strike_detection.py:23, 70-74`).

When the corner is not `tracked`, every feature is null for that frame.

**Step 2. Trailing smoothing** (`temporal_strike_detection.py:77-81`).
The smoothed speed at sample `i` is the median of the non-null speeds
among sample `i` and the up to two analysed samples before it, counting
only samples within 0.05 s before `t_i`. It is null if fewer than 2
non-null values are available. The offline window is centred; this one is
trailing, so it never waits for later frames. Extension and angle are not
smoothed: the offline script smooths them but its features use the raw
values (`temporal_strike_detection.py:150-166`).

**Step 3. Speed threshold** (`temporal_strike_detection.py:24, 96-99`).
The threshold at sample `i` is the larger of 400 px/s and the 90th
percentile of every non-null smoothed speed the stream has recorded so
far, including sample `i`. The percentile uses linear interpolation, as
pandas `quantile` does. During the threshold warm-up, while the stream
has recorded fewer than 60 non-null smoothed speeds, the threshold is
400 px/s. Samples recorded while detection is inactive are not included.

**Step 4. Peaks** (`temporal_strike_detection.py:104-118`). Sample `p` is
a peak if its smoothed speed is at least the threshold at `p`, and at
least every non-null smoothed speed of the stream within 2/60 s before
and after `t_p`. Equal values pass, as offline. The peak is recognised
once an analysed sample with `t ≥ t_p + 2/60 s` has been recorded.

**Step 5. Minimum gap** (`temporal_strike_detection.py:28, 123-135`).
Each stream holds at most one pending peak `s`.

- A new peak less than 0.25 s after `s` replaces `s` if its smoothed
  speed is strictly greater. Otherwise it is discarded.
- `s` becomes final at the first analysed frame with
  `t ≥ t_s + 0.25 s + 2/60 s`. By then every peak that could replace it
  has been recognised.
- A peak 0.25 s or more after `s` becomes the new pending peak; `s` is
  already final by the time it is recognised.

**Step 6. Candidate features** (`temporal_strike_detection.py:140-193`).
When `s` becomes final, these are computed from the stream's raw
samples:

| Window | Offline frames | Live video time |
|---|---|---|
| Baseline | peak − 6 to peak − 2 | `t_s − 0.1 s` to `t_s − 2/60 s` |
| Peak | peak − 1 to peak + 2 | `t_s − 1/60 s` to `t_s + 2/60 s` |
| Post | peak + 5 to peak + 12 | `t_s + 5/60 s` to `t_s + 0.2 s` |

- The baseline, peak and post extension, and the baseline and peak
  angle, are medians of the non-null values in their windows.
- Extension gain is peak minus baseline extension. Angle gain is peak
  minus baseline angle. Retraction is peak minus post extension.
- Keypoint confidence is the mean, over the three joints of the limb
  (shoulder, elbow and wrist, or hip, knee and ankle), of each joint's
  mean confidence in the peak window. It is 0 if none was recorded
  (`temporal_strike_detection.py:187-193`).
- A peak whose post window runs past the last frame of the video never
  becomes a candidate. The offline script likewise skips the last 12
  frames (`temporal_strike_detection.py:104`).

**Step 7. Filters,** applied in the offline order. A peak that fails any
of them is discarded and never emitted.

1. **Missing features.** The baseline or peak extension, or the baseline
   or peak angle, is null (`temporal_strike_detection.py:169-175`); or the
   retraction is null (`refine_strikes.py:88`).
2. **Candidate cut-off of 35** (`temporal_strike_detection.py:196-229`).
   The first-stage score is the sum of:
   - `min(25, 25 × smoothed peak speed / max(threshold at the peak, 1))`;
   - 25 if the extension gain is at least 0.04;
   - 20 if the angle gain is at least 8;
   - 20 if the retraction is at least 0.03;
   - `10 × min(1, max(0, keypoint confidence))`.

   The peak is discarded if this score is below 35.
3. **Gates** (`refine_strikes.py:30-32, 93-97`). The extension gain must
   be above 0.0, the angle gain at least −5.0, and the keypoint confidence
   at least 0.85.

A peak that passes all three is a *gated candidate*. At that moment it
joins its stream's ranking pool.

**Step 8. Kinematic score and ranking warm-up** (`refine_strikes.py:105-140`).

- **The pool.** A candidate is ranked only against the gated candidates
  of its own stream that joined the pool before it, plus itself. No
  later candidate ever affects it. The pool includes earlier candidates
  that were unscored, or that were later discarded as duplicates, as the
  offline ranking does (it ranks before removing duplicates).
- **Ranking warm-up (live-engine policy).** The offline pipeline has no
  equivalent: it ranks every event against the whole clip. If fewer than
  `N_rank_min` earlier candidates are in the pool (section 18), the
  candidate is *unscored*: its kinematic
  score and detection class are null, and its `score_status` is
  `"unscored_warm_up"`. A percentile against no earlier events is always
  100 %, whatever the speed, so it would be a number without a
  comparison behind it. An unscored event is still emitted, provisional,
  with its measured features. It never receives a score later.
- **Scored candidates.** Otherwise `score_status` is `"scored"` and the
  kinematic score is the sum of these components, rounded to 2 decimals
  (`refine_strikes.py:134-140`):

  | Component | Value |
  |---|---|
  | Speed | `20 × (L + (k + 1) / 2) / n`: `n` is the pool size including the candidate, `L` the number of pool members with a lower smoothed peak speed, and `k` the number with an equal one, including the candidate (the percentile rank pandas computes, ties averaged) |
  | Extension | `30 × clip(extension gain, 0, 0.30) / 0.30` |
  | Angle | `20 × clip(angle gain, 0, 30) / 30` |
  | Keypoint confidence | `20 × keypoint confidence` |
  | Retraction | `10 × clip(retraction, 0, 0.30) / 0.30` |

- **Classes** (`filter_strikes.py:25-32`): 80 or more Very Strong, 65 or
  more Strong, 50 or more Review, otherwise Low.
- **Frozen.** The score, class and status are computed once, when the
  candidate joins the pool, and are never recomputed.

**Step 9. Duplicates and emission** (`refine_strikes.py:33, 146-182`).

- **Hold.** A gated candidate `c` is held until its decision, at the first
  analysed frame with `t ≥ t_c + 0.35 s + 0.25 s + 2/60 s` (about 0.63 s
  after the peak). A rival whose peak is less than 0.35 s after `t_c`
  joins the pool, at the latest, 0.25 s + 2/60 s after its own peak, so
  every rival has joined by the decision. Nothing about `c` is emitted
  before its decision.
- **Rivals** are the gated candidates of the same stream whose peaks are
  less than 0.35 s from `t_c`, before or after it, and that have not been
  discarded as duplicates. A peak exactly 0.35 s away is not a rival.
- **Comparison.** If both candidates are scored, the higher kinematic
  score wins, as offline. If either is unscored, the higher smoothed peak
  speed wins. This is a live-engine policy, not an offline equivalent:
  offline every candidate has a score. On an exact tie, the earlier peak
  wins.
- **Decision.** `c` is emitted if it wins against every rival. Otherwise
  it is discarded as a duplicate, written to `engine.log` and never
  emitted.
- **Order within a frame.** Candidates join the pool before any decision
  in the same frame is made, and decisions are made in peak order.
- **Never revised.** An emitted event is final. It is never changed,
  withdrawn or relabelled. An already-emitted rival always beat `c` at
  its own decision, because `c` was already in the pool then, so two
  emitted events on one stream are never less than 0.35 s apart.

**Resets.** When two consecutive analysed frames are more than 0.25 s
apart, or detection becomes inactive (section 8), every stream discards
its smoothing window, its pending peak and its held candidates. None of
them is emitted. The number of held candidates discarded this way is
reported in `stats`. The ranking pools and the threshold samples are
kept. While detection stays inactive, the detector records no samples.

**Manual swap (live-engine policy).** The offline pipeline has no manual
swap. A swap (9.4) exchanges the complete detector state of the two
corners (smoothing windows, threshold samples, pending peaks, held
candidates and ranking pools), so each history stays with the person it
was measured on. Events already emitted keep their original corner.

**End of the session.**

- **`video_end` finalisation.** This runs once, after the last frame
  (time `t_last`) has been analysed and its samples recorded, and before
  `ended`. It uses only samples already recorded. It never creates,
  extends or interpolates a sample. A window counts as complete only if
  its time range ends at or before `t_last`.
  1. **Peaks near the end.** A sample within 0.2 s of `t_last` can never
     become a candidate, because its post window cannot be complete. This
     is the live form of the offline rule that skips the last 12 frames
     (`temporal_strike_detection.py:104`).
  2. **Pending peaks.** No later peak can arrive, so each stream's pending
     peak becomes final now if its post window is complete, and is
     discarded otherwise. A peak that it replaced earlier is not
     restored. This is a live-engine difference from offline, which never
     lets such a peak replace another (10.4).
  3. **Candidates.** Each final peak's features are computed from the
     recorded samples in its windows (step 6), and every filter in step 7
     applies unchanged. A window with no usable sample gives a null
     feature, and filter 1 discards the peak.
  4. **Decisions.** New gated candidates join the pool first and are
     scored by step 8. Then every held candidate is decided by the step 9
     rules, in peak order. Every possible rival has now either joined the
     pool or been discarded, so deciding before the normal decision time
     changes no outcome.
  5. **Emission.** The emitted events are sent in peak order, then
     `ended`.
- On `stopped`, `disconnected` or `crashed`, pending peaks and held
  candidates are discarded, because later frames could still have changed
  them.

### 10.4 Where live and offline events can differ

Live events are provisional and are never merged into the scorecard.

**Live-engine policies.** Three rules in 10.3 are deliberate choices for
the live engine, not equivalents of anything offline:

1. a candidate needs `N_rank_min` (4) earlier gated candidates in its
   stream before it can receive a live kinematic score (step 8);
2. a duplicate comparison that involves an unscored candidate compares
   smoothed peak speeds (step 9);
3. a manual swap moves the complete detector history with the person,
   and previously emitted events keep their original corner.

**Differences.** Live events are expected to differ from the offline run
in these ways:

- **Early ranking.** Offline, the speed component ranks each event against
  every event in the clip. Live, it ranks against earlier events only. An
  early event is compared with few others, so its score can differ from
  the offline score for the same movement, and a score near 65 can land
  on either side of the counting boundary.
- **Unscored events.** The first `N_rank_min` gated candidates of each
  stream are unscored and never counted per minute. Offline, every event
  is scored. Early in the fight, and in short clips, the live rate can
  therefore be much lower than the offline count, with
  `unscored_event_count` showing how many events it leaves out. In a 6 s
  clip most events may be unscored.
- **Threshold.** Offline, the speed threshold is the whole clip's 90th
  percentile. Live, it is the 90th percentile so far, and 400 px/s during
  the threshold warm-up, so early peaks are tested against a different
  threshold, and the first-stage score uses it too.
- **Smoothing.** The trailing window can shift smoothed values, and so
  peak times, by about one frame.
- **Duplicate chains.** Offline, duplicates are removed greedily from the
  highest score down. Live, a candidate is discarded as soon as a rival
  beats it. With three candidates each less than 0.35 s from the next and
  scores rising (70, 80, 90), offline keeps the first and the third, and
  live keeps only the third. On an exact tie, live keeps the earlier
  peak; the offline order for ties is not specified by the script.
- **Skipped frames and resets.** Offline analyses every frame. Live, limb
  speed keeps the offline limit: it is null when consecutive usable
  samples are more than 0.05 s apart (step 1). Detection is reported
  active from 10 analysed frames per second (section 8). Between about 10
  and 20 analysed frames per second, detection can therefore be reported
  active while producing few or no qualifying events, because usable
  consecutive limb samples are too far apart. Neither limit is relaxed to
  raise event counts. Resets discard held candidates.
- **Session end.** Candidates still held when a session is stopped,
  disconnected or crashes are never emitted. At `video_end`, a peak in
  the last 0.45 s that was replaced by a later peak whose post window
  runs past the end is not restored; offline would keep it.
- **Identity.** Live events take the live corner. Where live and final
  labels disagree (section 12), the same movement is attributed to
  different corners.
- **Frame rate.** Live analysis accepts only 60 fps video (T9), so the
  windows cover the same frames as offline. At 59.94 fps they differ
  from the offline frames by 0.1 %.

## 11. Session files and ownership

Each file has exactly one writer. While the session exists, its files
live under `live_sessions/<id>/`.

| File | Writer | Contents |
|---|---|---|
| `input.mp4` | API, at upload | The uploaded video |
| `live/probe.json` | API, from the probe's output | The section 6.4 results, including the verified timestamps |
| `live/track.csv` | Engine, flushed every row | One row per analysed frame and corner: frame index, video time, corner, state, tracker ID, centre, box, mean keypoint confidence |
| `live/events.csv` | Engine, flushed every row | Emitted provisional events: stream, peak time and frame, features, first-stage score, pool size, score status, and the frozen kinematic score and class (null when unscored) |
| `live/identity_log.csv` | Engine, flushed every row | Seeding, re-associations with costs, changes to `uncertain` or `lost`, swaps |
| `live/engine.log` | Engine, through stderr redirected by the API | Diagnostics |
| `live/session.json` | API, on every state change | `"provisional": true`, device, state, end reason, frames analysed and skipped, last analysed frame, start and end times |

- **Crash safety.** Rows are flushed as they are written, so a crash keeps
  everything recorded up to that point. An engine killed in the middle
  of a row can leave one incomplete last line. Every reader of these
  files ignores a final line that has no line ending.
- **Hand-off.** `input.mp4` moves to `jobs/<job_id>/input/input.mp4`, and
  `live/` moves to `jobs/<job_id>/live/`. The session folder is then
  removed.
- **Not served.** Neither location is served by `/artifacts` or `/files`.

## 12. Identity comparison: live labels vs. final labels

This is served by `GET /jobs/{id}/identity-check` once the job has
completed. Each analysed live frame `i` is compared with the offline row
with the same frame index in `results/movement_metrics.csv`, using
`blue_x`, `blue_y`, `red_x`, `red_y` and the `*_detected` columns. Its
thresholds are `C_margin` and `C_gate` (section 18), which are separate
from the tracking thresholds in section 9.

### 12.1 Frame outcome

1. **Eligibility.** A frame is compared only if both live corners are
   `tracked` and both offline fighters are detected. Otherwise it is *not
   compared*, with the reason `live_uncertain`, `live_lost` or
   `offline_missing` (checked in that order).
2. **Pairings.** Distances are measured as a fraction of the frame
   diagonal. There are exactly two pairings:
   - **Same:** `S = d(live Blue, final Blue) + d(live Red, final Red)`.
   - **Crossed:** `C = d(live Blue, final Red) + d(live Red, final Blue)`.

   Each pairing assigns every live fighter to a different offline
   fighter, so both live fighters can never match the same offline
   fighter.
3. **Reliability.** The lower-cost pairing is accepted only if both of
   these hold:
   - the absolute difference between `S` and `C` is at least `C_margin`;
   - each of its two distances is at most `C_gate`.

   Otherwise the frame is *not compared*, with the reason `ambiguous`. An
   exact tie is ambiguous, and so is a clinch, where the two centres
   nearly coincide.
4. **Outcome.** Same pairing: `agree`. Crossed pairing: `disagree`, which
   means live Blue is final Red and live Red is final Blue.

### 12.2 Time accounting

- **Coverage of a frame.** Analysed frame `i` covers video time from
  `t_i` to `t_i + w_i`, where:
  - `w_i = min(t_next − t_i, 0.25 s)` when a next analysed frame exists;
  - `w_i = 1 / fps` (one frame period) for the final analysed frame of
    the record.

  The final frame therefore covers exactly its own frame, however the
  session ended.
- **Fields.**
  - `covered_seconds` is the sum of all `w_i`. It equals
    `compared_seconds` plus the sum of `not_compared_seconds`.
  - `live_span_seconds` is the final frame's `t + w`, minus the first
    analysed frame's `t`.
  - `uncovered_seconds` is `live_span_seconds − covered_seconds`: the
    parts of gaps over 0.25 s.

### 12.3 Disagreement intervals

1. **Start.** An interval starts at `t_i` of a `disagree` frame that does
   not already belong to an interval.
2. **Extent.** It extends through later frames until the next `agree`
   frame, or the end of the record.
3. **End.** It ends at `t_j + w_j`, where `j` is the last `disagree` frame
   before that point. Not-compared frames after `j` are not part of the
   interval.
4. **At the end of the record.** An interval still open when the record
   ends closes at its last `disagree` frame's `t_j + w_j`. Because the
   final frame's coverage is one frame period, an interval that runs to
   the final frame ends exactly at the end of that frame.
5. **Contents.** Each interval reports the not-compared seconds between
   its first and last `disagree` frames, and the first identity log entry
   within 0.5 s of its start, if there is one.

### 12.4 Result

```json
{"state": "agree | disagree | not_compared | unavailable",
 "live_span_seconds": 6.0,
 "covered_seconds": 5.9,
 "uncovered_seconds": 0.1,
 "compared_seconds": 4.7,
 "not_compared_seconds": {"ambiguous": 0.4, "live_uncertain": 0.3,
                          "live_lost": 0.0, "offline_missing": 0.5},
 "intervals": [{"start": 2.4, "end": 4.1, "live": "blue", "final": "red",
                "not_compared_seconds": 0.2,
                "identity_log_entry": "re-association at 2.4 s"}]}
```

| State | Meaning |
|---|---|
| `unavailable` | The job has no live record. |
| `not_compared` | A live record exists, but no frame was compared. |
| `disagree` | At least one interval exists. |
| `agree` | At least one frame was compared, and none disagree. |

- Not-compared time never counts as agreement.
- The offline scorecard is never relabelled.
- Phase 6 shows both labels and the flag.

## 13. API

All endpoints here are new. The only change to existing code is the
internal refactor in 13.2.

### 13.1 Endpoints

**`POST /live-sessions`** (multipart upload)

- **201.** Body: `{session_id, video: {fps, frame_count, width, height,
  duration_seconds, start_offset_ms}}`, where `duration_seconds` is
  `frame_count / fps` and `start_offset_ms` is as in 6.4.
  The session is `starting`.
- **400.** The upload has no filename, is not an MP4, or is empty. The
  messages are the same as `POST /jobs`.
- **413.** The file is too large. The message is the same as
  `POST /jobs`.
- **422.** Verification failed (section 6.4), including a frame rate
  outside 59.9–60.1 fps (T9).
- **503.** Verification was unavailable (section 6.4).
- **409.** A session is already `starting` or `live`.
- **After any error,** no session exists and no upload is left.

**`WS /live-sessions/{id}/stream`**

- **`starting` or `live`.** Relays the protocol (section 14).
- **`ended`.** Sends `ended` with the end reason, then closes with code
  1000.
- **Close 4404.** Unknown session.
- **Close 4409.** Another client is already connected.

**`POST /live-sessions/{id}/analyse`**

- **202.** The body is the same as for `POST /jobs`. The steps are:
  1. if the session is `starting` or `live`, run the stop procedure (end
     reason `stopped`);
  2. wait until the session is `ended`;
  3. move the files (section 11);
  4. call `start_job`.
- Works after any end reason, including `crashed`.
- **404.** Unknown session, including one already handed off.

**`DELETE /live-sessions/{id}`**

- **204.** If the session is `starting` or `live`, the stop procedure runs
  first. Then the session folder is removed.
- **404.** Unknown session.

**`GET /jobs/{id}/identity-check`**

- **200.** The section 12 result.
- **404.** Unknown job.
- **409.** The job is not complete.

### 13.2 Shared job-creation helper

`start_job(job_id, original_filename, file_size_bytes, background_tasks)`
expects `jobs/<job_id>/input/input.mp4` to exist already. It:

1. writes `status.json`, with the same fields and initial values as today;
2. schedules `run_pipeline`;
3. returns the response body.

The two callers:

- **`POST /jobs`** keeps its own validation, and streams the upload into
  the job folder. It then calls `start_job`.
- **The hand-off** creates `jobs/<job_id>/input/`, `results/` and
  `videos/` (the layout `POST /jobs` creates), and moves the stored file
  and `live/` into place. It then calls `start_job`.

`POST /jobs` keeps all of its external behaviour:

- status codes;
- error messages;
- response body;
- files written;
- `status.json` contents;
- the observable order of effects (for example, an oversize upload leaves
  no folder);
- the background start.

The characterisation tests in 16.2 pin each of these.

## 14. WebSocket protocol

Every engine message carries `"provisional": true`.

**Browser to engine** (relayed by the API)

| Message | Meaning |
|---|---|
| `clock {t, playing}` | Playback position and state (section 8) |
| `swap` | Manual Blue/Red swap from the current frame on (9.4) |
| `stop` | End the session with `stopped` |

**Engine to browser**

| Message | Contents |
|---|---|
| `ready` | Device, model, video facts |
| `frame` | `t` and `frame_index`; for each corner, its state, plus box, keypoints and tracker ID when `tracked`; `metrics`, null where not measured |
| `event` | Corner, peak time and frame, type (punch-like or kick-like), limb side, smoothed peak speed, extension gain, angle gain, retraction, keypoint confidence, pool size, `score_status` (`scored` or `unscored_warm_up`), and the frozen kinematic score (heuristic) and detection class, both null when unscored. Sent once per event, at its decision (10.3) |
| `identity` | Seeding, re-association (with costs), change to `uncertain` or `lost`, or swap, with frame and reason |
| `stats` | About once a second: frames analysed and skipped, analysed rate, whether detection is active (or why not), `events_per_minute_basis_seconds`, `unscored_event_count`, the number of held candidates discarded by resets |
| `clock_rejected` | A backward jump was refused |
| `ended` | End reason |
| `error` | Message; for a crash, the last lines of `engine.log` |

## 15. Honesty rules

- **Labelled provisional.** Every live message carries
  `"provisional": true`, and so does `session.json`. Phase 6 labels every
  live value, overlay and count "Provisional", and labels the identity
  flag "Live (provisional)" beside "Final scorecard".
- **Wording.** "Strike-like event", "punch-like" and "kick-like". The
  kinematic score is labelled a heuristic.
- **No filled-in values.** Unknown values are null. Nothing is
  interpolated, carried forward or estimated across skipped frames.
- **No verdicts.** No live score total, leader, winner, contact claim or
  probability is computed or emitted.
- **Enforced by a test.** A test checks every message type against an
  allow-list of fields, and fails on the terms `landed`, `hit`, `damage`,
  `winner`, `probability` and `confidence_percent`.
- **The final scorecard** stays the offline pipeline's, unchanged, with
  the "Higher Experimental Activity Score" wording.

## 16. Testing

### 16.1 Existing tests, run on 2026-11-17

These were run at commit `29f9a62` on the `dashboard` branch, before any
Phase 5 change.

| Suite | Command | Result |
|---|---|---|
| Backend: `tests/test_browser_video.py` (9 tests) and `tests/test_pipeline_progress.py` (1 test) | `python -m pytest tests` | 10 passed, with 1 deprecation warning from the Starlette test client |
| Frontend: 21 test files | `npm test` | 278 passed |
| Frontend types | `npm run typecheck` (`tsc -b`) | Exit code 0, no diagnostics printed |
| Frontend lint | `npm run lint` (`oxlint`) | Exit code 0, no diagnostics printed |

`npm run build` was not run on this date.

None of these existing tests covers `POST /jobs`. No characterisation
tests for `POST /jobs` exist yet; they are planned in 16.2. These suites
are the regression baseline, and they must still pass after every
Phase 5 change.

### 16.2 Planned tests

Every test in this subsection is a required implementation test. None of
them has been written or run yet. The design-time checks in 6.7 do not
count as these tests.

Test-driven: each test is seen failing before the code that passes it.

**`POST /jobs` characterisation (planned; to be written before the
refactor).** These tests do not exist yet. They will be written against
the current, unrefactored `POST /jobs`, and must pass there before the
refactor starts. The same tests, unchanged, must then
pass after the refactor. They check the exact status codes and messages
the current code returns:

- success, with the body and `status.json` checked field by field;
- an upload with no filename (400);
- a non-MP4 upload (400);
- an empty upload (400, with no folder left);
- an oversize upload (413, with no folder left);
- the pipeline is started.

**Hand-off.**

- A job created by `analyse` matches a `POST /jobs` job, apart from IDs
  and times.
- Its input is byte-identical to the upload (equal SHA-256).
- The live files are under `jobs/<job_id>/live/`.

**Unit tests.**

| Area | Tests |
|---|---|
| Probe | Both real clips accepted. Both variable-frame-rate fixtures rejected by T7 and T8, and also by T9, because their reported fps is not 60. A failing case for each of T1–T9. A file whose reported fps disagrees with its timestamps is rejected. A timeout gives 422. A missing ffprobe gives 503. |
| Probe: matching and B-frames | Both real clips, whose packets are out of order in file order, are matched by sorted position and accepted; the 60 fps B-frame fixture (2013 ffmpeg, libx264 `-bf 3`) is accepted. Using fake probe outputs: a missing packet timestamp, a repeated one, one decoded frame too many and one too few are each rejected by T4. The 6 s clip's `probe.json` and 201 body report `start_offset_ms` = 36. |
| Probe: frame rate (T9) | The 30 fps B-frame fixture is rejected by T9 alone. A 59.94 fps timestamp list passes T9 and every other applicable rule; 59.89 and 60.11 fail T9. A 50 fps timestamp list fails T9 alone. |
| Probe: drift (synthetic) | The 6.3 drift sequence (60 frames at 60 fps; 30 gaps 0.9 ms long, then 29 gaps 0.9 ms short) is given to the rule checker as a timestamp list. T7 must pass, T8 must fail, and every other applicable rule must pass. |
| Probe: drift (real MP4) | The same sequence as a real MP4 whose reported fps is exactly 60, with a 90 kHz timescale so that 0.9 ms and the 1/60 s period are exact. It goes through the actual OpenCV/FFMPEG probe and ffprobe, and must be rejected by T8 alone. Before the test is trusted, the fixture's packet timestamps and reported fps are checked to match the sequence. The installed 2013 ffmpeg could not build this file (6.7), so it needs a tool that sets each packet's timestamp and duration directly. Proposed tool: PyAV (`pip install av`), whose wheel bundles its own FFmpeg libraries, writing each packet's timestamp and duration in a 1/90000 time base into an MP4. The implementation plan names it, states what installing it involves, and asks for approval; nothing is installed before that approval. The synthetic test never substitutes for this one. Until this test passes, T8 rejecting drift in a real file counts as unverified. |
| Backend self-check | Passes on the bundled fixture. A fake backend that reports `index / fps` fails it and gives 503. A fake backend that reports real times on the fixture but `index / fps` on another file with a timestamp jump passes the self-check, and that file is still rejected by T4. |
| Runtime timing check (6.6) | Using a fake capture: a timestamp more than 0.5 ms from the verified `t_i` gives `error` and `crashed`, both on an analysed frame and on a skipped frame. A timestamp that breaks T8 (more than the tolerance from `expected_i`) does the same, on both kinds of frame. A frame index past the verified frame count does the same. |
| Pacing | Latest frame wins; pause; silent client; a forward jump with its skipped count; a backward jump rejected; end of video. |
| Pacing: clock handling | With a fake model that blocks inside a frame: 100 clock messages arriving during one frame collapse to the most recent; rapid play/pause toggles; once a pause has been read, nothing is grabbed or analysed after the frame in progress; `waiting` then `playing` idles, then resumes. A property test over random sequences (play, pause, `waiting`, forward and backward jumps, messages arriving during frames) checks that every grabbed or analysed frame has `t_i` no greater than the most recent clock `t` read before it was chosen, and that analysed frames strictly increase. After a backward clock, the engine idles until the clock passes its position. |
| Identity tracking | Continuity; re-association inside both gates; rejection outside each gate; a margin failure and an exact tie both give `uncertain`; simultaneous assignment of two open corners; a candidate eligible for both corners gives both `uncertain`; same outcome regardless of input order; `lost`; swap. |
| Metrics | Uses the verified times; null when a fighter is missing or the gap is over 0.25 s. |
| Events per minute | Same value for the same video time whether or not frames were skipped; pauses and inactive periods excluded; null below 5 s; basis reported. Only scored events at 65 or more are counted: 65.00 counts, 64.99 does not, and Review and Low never count. Unscored events are never counted, not even after the ranking warm-up ends, and `unscored_event_count` reports them. |
| Detector: features | Against values computed by hand: keypoints below 0.35 confidence are not used; extension is divided by the torso length; limb speed is null for a gap over 0.05 s and for a speed above 3000 px/s or below 0; a corner that is not `tracked` gives null features. |
| Detector: low analysed rate | With analysed frames 1/12 s apart (12 per second), `stats` reports detection active, every limb speed is null, and no event is emitted, while a sequence with the same movement analysed at 60 per second emits events. |
| Detector: smoothing and threshold | The smoothed value is the median of the current and up to two earlier samples within 0.05 s, and null with fewer than 2 valid values; adding later samples never changes an earlier smoothed value. The threshold is 400 px/s for the first 59 smoothed samples and the running 90th percentile (linear interpolation) from the 60th, never below 400 px/s. |
| Detector: peaks and minimum gap | A peak needs the threshold and a local maximum within 2/60 s either side, and is recognised only after a sample at `t_p + 2/60 s`; a strictly faster peak less than 0.25 s later replaces the pending one, and an equal one does not; a peak exactly 0.25 s later is separate. |
| Detector: filters | Each filter rejects alone: a missing baseline or peak value; a missing retraction; a first-stage score of 34.99 rejected and 35.00 accepted; an extension gain of 0.0 rejected; an angle gain of −5.0 accepted and −5.01 rejected; a keypoint confidence of 0.85 accepted and 0.849 rejected. A peak whose post window runs past the last frame never becomes a candidate. |
| Detector: ranking warm-up (policy 1, 10.4) | With `N_rank_min` = 4, the first 4 gated candidates of a stream, placed more than 0.35 s apart, are emitted with `score_status` `unscored_warm_up` and a null score and class, and the 5th is scored. The pools of the eight streams are independent. Unscored candidates and discarded duplicates stay in the pool. |
| Detector: causal ranking and frozen scores | The speed component matches the formula in 10.3, step 8, computed by hand, including tied speeds. Adding faster or slower later candidates never changes an emitted score, class or status. |
| Detector: streaming causality | For every frame `f`, a run fed frames up to `f` without any end-of-session step is compared with the full run at the same frame `f`. The comparison covers only events whose decision time (10.3, step 9) is at or before `t_f`. Both runs have emitted exactly the same such events, in the same order, identical field by field, and the full run's later frames never change, withdraw or relabel any of them. |
| Detector: classes | Scores rounding to 80.00, 65.00 and 50.00 give Very Strong, Strong and Review; 79.99, 64.99 and 49.99 give the class below. |
| Detector: duplicates and emission | A stronger rival less than 0.35 s later keeps the later event, and a stronger earlier one keeps the earlier event; equal scores keep the earlier peak; a peak exactly 0.35 s away is not a rival; a scored and an unscored rival are compared by smoothed peak speed, with the unscored one both earlier and later, including a case where the scored candidate has the lower peak speed and is discarded (policy 2, 10.4); the rising three-candidate chain in 10.4 keeps only the third; no `event` message is sent before the decision time in step 9; two emitted events on one stream are never less than 0.35 s apart; the event stream is append-only. |
| Detector: resets | A gap over 0.25 s and a change to inactive detection each discard pending peaks and held candidates without emitting them, count the discarded candidates in `stats`, and keep the pools and threshold samples. |
| Detector: manual swap (policy 3, 10.4) | After a swap, each person's smoothing window, threshold samples, pending peak, held candidates and ranking pool continue under the new corner: a candidate held at the swap is emitted under the new corner, and the next candidate's rank uses the person's earlier pool. Events emitted before the swap keep their original corner, unchanged field by field. |
| Detector: `video_end` finalisation | An instrumented sample store fails the test if finalisation reads any sample after `t_last`, or any value that was not recorded. A pending peak with a complete post window becomes final, and becomes a candidate only if it passes every filter. A pending peak whose post window ends after `t_last` is discarded, and the peak it replaced is not restored. A peak within the last 0.2 s is never emitted. A peak whose post window has no usable extension sample is discarded by filter 1, not filled in. Held and new candidates are decided against each other by the step 9 rules, including a rival within 0.35 s that joins only at finalisation, and scored by the step 8 pool. Events come in peak order, before `ended`. Finalisation runs only for `video_end`. |
| Detector: `stopped`, `disconnected` and `crashed` | One test for each end reason: pending peaks and held candidates are discarded and never emitted, and events already emitted are unchanged. |
| Identity comparison | Agree; a crossed pairing gives a disagreement interval; an exact tie and a clinch are `ambiguous`; a missing fighter is not compared; never two live fighters on one offline fighter; the final frame covers one frame period; an interval reaching the final frame closes at that frame's end; trailing not-compared frames are excluded from an interval; covered, uncovered and span arithmetic; not-compared time never counts as agreement. |
| Vocabulary | The allow-list and the forbidden terms. |

**API tests,** using a fake engine process (as the E1 tests fake the
pipeline):

- 409 while a session is `starting` or `live`, and none once it is
  `ended`;
- 422 and 503 at upload, leaving no session or file behind;
- the WebSocket relays both ways;
- a second client is closed with 4409;
- an ended session receives `ended`, then closes;
- disconnecting during playback sends the engine `playing: false`, and it
  idles; reconnecting within 60 s receives `ready` and the latest
  `stats`, and the engine continues from the new clock; a reconnect with
  an earlier clock gets `clock_rejected` and no rewind;
- `disconnected` after 60 s, including a client that never connected;
- an engine that ignores `stop` is escalated, and `analyse` waits for its
  exit;
- `analyse` and `DELETE` arriving while the fake engine is inside a frame
  (blocked until released): no file is moved or removed until `poll()`
  reports the exit; the move then succeeds on Windows, which it cannot
  while a handle is open; and the API holds no handle to `engine.log`
  after launch;
- `analyse` and `DELETE` sent together: exactly one succeeds, the other
  returns 404, and no files are left half-moved;
- a fake engine killed in the middle of a row leaves an incomplete last
  line, which the hand-off and `identity-check` ignore;
- a crash gives `error`, the files are kept, and `analyse` still works;
- a session is removed 1 hour after ending, and never while `live` (using
  an injectable clock);
- the start-up sweep touches only `live_sessions/`;
- `identity-check` returns 404, 409, `unavailable`, `not_compared`,
  `agree` and `disagree`;
- the existing endpoints are unchanged.

**Real check on the 6 s clip** (a script client):

- the probe accepts the clip, and the backend self-check passes;
- the actual analysed rate on the GPU is measured and reported;
- the resulting event counts are reported: events emitted, scored,
  unscored, counted per minute (65 or more), discarded as duplicates and
  discarded by resets, together with the time detection was active;
- GPU memory returns to its baseline after the engine exits
  (`nvidia-smi`);
- live events are compared with the offline run's: similar, not
  identical, with the differences reported, including the number of
  unscored events, the duplicates discarded, and, for events matched by
  stream and peak time within 2/60 s, the live and offline scores side
  by side;
- the identity comparison result is recorded;
- the full backend test suite passes.

**Phase 6 browser check** (required; planned with Phase 6): the browser's
media time for presented frames of both clips, measured with
`requestVideoFrameCallback`, is compared with `t_i` and with `t_i` plus
the start offset (6.5).

## 17. Known limitations

- **Unverified video is refused for live analysis.** It can still be
  analysed offline with Analyse video.
- **Drift rejection in a real file is not yet verified.** T8 has been
  shown to reject drift only on a synthetic timestamp list (6.7). It
  counts as verified for real files once the real-MP4 drift test in
  section 16 passes.
- **Probe time limit.** Very long uploads can exceed the 120 s probe
  limit, and are then refused for live analysis.
- **Seeding mirrors offline.** Live seeding copies the offline rule
  (tracker IDs 1 and 2). If the tracker gives the referee one of those
  IDs, live and offline label the same wrong person, and the comparison
  reports agreement.
- **Tracker ID swaps.** While both IDs stay present, an ID swap between
  the fighters inside the tracker is not detected automatically. The
  manual swap corrects it.
- **Active detection does not guarantee events.** At 10–20 analysed
  frames per second, detection can be reported active while finding few
  or no qualifying events, because limb speed needs samples at most
  0.05 s apart (10.4).
- **Live scores are ranked against earlier events only.** Early in a
  fight, and in short clips, live scores and counts can differ from the
  offline run, and many early events are unscored (10.4).
- **Only 60 fps video is accepted live.** The offline detector assumes
  60 fps, so live analysis accepts 59.9–60.1 fps (T9). Other frame rates
  can still be analysed offline, where the pipeline is unchanged.
- **Timestamp verification is two readers agreeing.** OpenCV's FFmpeg
  and the 2013 ffprobe must agree on every frame's timestamp. A demuxer
  error shared by both cannot be ruled out with the installed tools
  (6.2).
- **Browser clock mapping is unverified.** For a file with a non-zero
  start offset, such as the 6 s clip (36 ms), frame-accurate alignment is
  not claimed until the Phase 6 browser check passes (6.5).

## 18. Starting values to confirm on real clips

All of these live in one module, with comments. The real check reports
the values used. The constants mirrored from the offline scripts (10.3)
are not starting values: they change only if those scripts change.

| Group | Name | Starting value |
|---|---|---|
| Tracking (9.3) | `G_base` | 0.05 of the diagonal |
| Tracking (9.3) | `G_rate` | 0.5 of the diagonal per second |
| Tracking (9.3) | `G_max` | 0.25 of the diagonal |
| Tracking (9.3) | `R_max` | 1.6 |
| Tracking (9.3) | `M_track` | 0.25 cost units |
| Comparison (12) | `C_gate` | 0.10 of the diagonal |
| Comparison (12) | `C_margin` | 0.05 of the diagonal |
| Timing (6) | Timestamp tolerance (T7, T8, runtime check) | max(1 ms, 2 % of the period) |
| Timing (6) | Cross-check tolerance | 0.5 ms |
| Timing (6) | Probe time limit | 120 s |
| Timing (6) | Live frame-rate range (T9) | 59.9–60.1 fps |
| Detection (8, 10) | Minimum analysed rate | 10 frames per second |
| Detection (10.3) | Threshold warm-up | 60 smoothed samples per stream |
| Detection (10.3) | Ranking warm-up `N_rank_min` | 4 earlier gated candidates per stream |
| Pacing (8) | Clock interval while playing | 100–250 ms |
| Lifecycle (7) | Client timeout | 60 s |
| Lifecycle (7) | Silent client | 2 s |
| Lifecycle (7) | Stop escalation | 10 s, then 5 s |
| Lifecycle (7) | Retention after ending | 1 h |

Message field names may vary within the shapes in section 14, except
`strike_like_events_per_minute`, `events_per_minute_basis_seconds`,
`unscored_event_count` and `score_status` with its values `scored` and
`unscored_warm_up`.

## 19. Safeguard coverage

| Safeguard | Covered in |
|---|---|
| GPU memory release and process cleanup | 7: invariant, stop procedure, orphan protection, shutdown and start-up |
| WebSocket disconnects and engine crashes | 7: disconnects, crashes; 13.1: WebSocket; 14: `error` |
| Pause/resume synchronisation | 8 |
| Frame skipping and timestamp accuracy | 6: verified real timestamps, runtime check, what the checks establish (6.2), browser mapping (6.5); 8: pacing, advance limit and gaps; 10: verified-time speeds, events-per-minute basis |
| Missing or uncertain identity | 9: corner states and re-association rules; 12: not compared |
| Abandoned session clean-up | 7: client timeout, retention, start-up sweep, clean-up scope |
| Provisional labelling | 14, 15 |
| No invented values, contact claims or winner | 3: anti-goals; 10; 15 |
| Causal, frozen live scoring | 10.3: steps 8 and 9; 10.4 |
