# Live engine speed-up: CUDA Graph inference (short design)

Date: 2026-11-17. Status: approved by the user 2026-11-17.
Follows: `2026-11-17-live-engine-design.md` (Phase 5, approved) and
`docs/live-engine.md`. Next after this: webcam input (separate design).

## Intent

Make live event detection work at normal 1x playback on this laptop
(RTX 4050 Laptop GPU, i7-13620H). Today the engine analyses 4.5 frames
per second at 1x, below the 10 frames-per-second threshold (design 8),
so detection stays inactive. A webcam (the next project) always runs at
1x, so this must be fixed first.

## Why it is slow (measured 2026-11-17, real 6 s clip)

| Step per analysed frame | Median |
|---|---|
| `grab()` (demux and decode) | 0.1 ms |
| `retrieve()` (to BGR) | 4.3 ms |
| `model.track(...)` as the engine calls it | 89.7 ms (p90 193 ms) |
| `model.predict(...)` (no tracker) | 82.3 ms |
| Raw network forward only | 45-126 ms (p90 up to 203 ms) |
| Raw forward replayed as one CUDA Graph | **2.3 ms** (p90 3.0 ms), output bit-identical (max difference 0.0) |

The network is about 600 small GPU kernels, each launched from Python.
On this laptop each launch costs about 160 us inside the network
(PyTorch profiler), and GPU utilisation during a back-to-back loop was
2-27 % while the GPU dropped to its lowest power state (P8, 210 MHz).
The GPU is starved by launch overhead, not short of compute. A CUDA Graph
records the launches once and submits them as one.

## Goals

- At 1x playback on this laptop, detection active (analysed rate of at
  least 10 frames per second), measured with `live.realcheck`.
- Live results identical to today's engine on the same frames: same
  boxes, keypoints, tracker IDs and confidences (bit-identical network
  output is the target; any difference is reported, not hidden).

## Non-goals

- Changing the model, its weights, precision (stays fp32), input size
  (`imgsz` 640) or confidence threshold.
- Changing detection, timing rules, pacing, identity, metrics, scoring,
  the WebSocket protocol semantics, or the offline pipeline.
- The overlay display rule (the user confirmed the safe behaviour).
- New dependencies, TensorRT, ONNX, or system / power-setting changes.

## Anti-goals

- Any live value that differs from what the un-graphed engine would have
  produced, without the user being told.
- A silent fallback: the engine must report which inference path ran.
- GPU memory held after a session ends.

## Approaches considered (the user chose 1)

1. **CUDA Graph around the network forward only (chosen).** No new
   dependency; ultralytics' own preprocessing, NMS, keypoint scaling and
   ByteTrack stay unchanged; network output bit-identical. Needs one
   fixed input shape per session, which a video (and a webcam) has.
2. TensorRT export: similar speed, but a new 1 GB+ dependency, a
   per-machine export step, and fp16 changes the keypoints slightly.
3. Windows/NVIDIA power settings: user-side only, not portable, and the
   measurement shows launch overhead is the main cost.

## Design

- **Hook.** In `live/engine.py`, `YoloModel` replaces the one call that
  runs the network inside ultralytics' AutoBackend
  (`predictor.model.backend.forward`) with a wrapper. Everything around
  it, inside `model.track(...)`, is untouched.
- **Capture at warm-up.** The existing warm-up inference (before `ready`)
  runs on a frame of the video's size, so it produces the exact
  letterboxed tensor shape every real frame will have. The wrapper
  captures the graph then: warm-up iterations on a side stream, then
  `torch.cuda.graph` capture, as in the measured spike. The ByteTrack
  reset after warm-up stays.
- **Replay.** For an input with the captured shape, dtype and device:
  copy it into the static input, replay, and return a deep copy of the
  outputs (the next replay overwrites the static outputs). Any other
  input runs the original forward (eager).
- **Fallbacks, reported.** On CPU, or if capture raises, the engine uses
  the eager forward, as today. The `ready` message gains
  `inference: "cuda_graph" | "eager"` (with the capture error, if any, in
  the engine log), and the dashboard's engine status shows it.
- **Lifetime.** The graph and its memory pool belong to the engine
  process, which exits at the end of every session, so GPU release
  before the offline hand-off is unchanged.

## Tests

- **Parity on real video (GPU, real clips):** run the eager and the
  graphed `YoloModel` over every frame of the 6 s and 15 s clips in
  order; IDs, boxes, keypoints and confidences must be identical. Skipped
  only when CUDA or the clips are absent.
- **Wrapper unit tests (GPU):** captured shape replays; a different shape
  falls back to eager; outputs returned are copies (a second replay does
  not change the first result); capture failure gives `eager` with the
  reason.
- **Engine and API:** `ready` carries `inference`; vocabulary allow-list
  updated; dashboard shows it; existing suites stay green.
- **Real check:** `live.realcheck` at 1x and 0.1x, GPU memory before /
  during / after, and the browser workflow at 1x.

## Left to the builder

- Exact helper names and where the deep copy lives.
- How the parity test pairs frames (in order, one model per path, each
  with its own tracker state).
