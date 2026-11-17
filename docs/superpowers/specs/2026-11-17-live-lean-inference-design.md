# Live engine: lean per-frame inference path (short design)

Date: 2026-11-17. Status: approved by the user 2026-11-17.
Follows: `2026-11-17-live-cuda-graph-design.md` (committed 3dd2677) and the
20 analysed-fps threshold (committed c5c1375). Next after this: webcam
input (separate design).

## Intent

Reach at least 20 analysed frames per second at 1x on this laptop (RTX
4050 Laptop GPU, i7-13620H), so live event detection really runs at normal
speed, and later on a webcam, which is always 1x. Today a graphed frame
costs 40-72 ms inside `model.track()` and 1x reaches 9-13 analysed fps,
reported inactive.

## Measured (2026-11-17, real 6 s clip, network already a CUDA graph)

cProfile over 120 frames (39.6 ms per frame in that run):

| Part of `model.track()` | Per frame |
|---|---|
| Postprocess: NMS 7.8 ms, Results construction 3.3 ms | 11.3 ms |
| Tracker callback: ByteTrack update 3.9 ms, Results slicing/copies | 7.8 ms |
| Inference: copy in, graph replay, output copies | 7.0 ms |
| Preprocess: letterbox (cv2 resize 2.6 ms), upload, normalise | 4.9 ms |

10.5 ms per frame is spent waiting for the GPU (`cuda_synchronize`): the
GPU drops to its lowest power state between bursts, so dozens of tiny NMS
and scaling kernels run slowly. The same code measured 72 ms in an earlier
run.

NMS + box/keypoint scaling over 350 real frames: on the GPU median 11.6 ms
(p90 30.4); on the CPU, after one 1.1 MB copy, median **2.6 ms (p90 9.1)**.
Same detection count on every frame; coordinates differ by at most
0.00012 px (CPU vs GPU float rounding).

## Decisions (the user's)

- Tiny float differences are acceptable: live results need not be
  bit-identical to today's engine (2026-11-17).
- Approach 1 below (2026-11-17).

## Goals

- At 1x on this laptop: at least 20 analysed frames per second and
  detection reported active, measured with `live.realcheck` and in the
  browser.
- Same detections and tracker IDs as today's `model.track()` path on every
  frame of both real clips; boxes and keypoints within 0.001 px.

## Non-goals

- Changing the model, weights, fp32, `imgsz` 640, `conf` 0.35, NMS IoU,
  `classes=[0]`, the ByteTrack config, or the CUDA graph.
- Changing detection, timing, pacing, identity, metrics, scoring, the
  20 fps threshold, the protocol, the overlay rule, or the offline pipeline.
- Prefetching or threading frames (conflicts with the approved pacing).
- New dependencies; system or power-setting changes.

## Anti-goals

- A different tracker ID, an extra or missing detection, or a coordinate
  difference above 0.001 px on any real-clip frame, compared with today's
  path.
- A second, differently configured tracker or letterbox: the lean path must
  use the objects ultralytics already configured.
- Claiming 20 fps without measuring it.

## Approaches considered (the user chose 1)

1. **Lean path inside `YoloModel` (chosen).** After warm-up, call the
   configured predictor's own pieces directly: `predictor.preprocess`
   (same LetterBox and normalisation), `predictor.inference` (the CUDA
   graph), one copy of the raw predictions to the CPU, ultralytics'
   `non_max_suppression` with the predictor's own args, `scale_boxes` and
   `scale_coords`, then `predictor.trackers[0].update(...)` with a NumPy
   `Boxes`. Skips Results objects, callbacks and per-detection slicing.
2. Keep `model.track()`, move only NMS to the CPU through a predictor
   hook: smaller, but keeps about 8 ms of Results and callback overhead;
   20 fps borderline.
3. Prefetch the next frame on a background thread: conflicts with the
   approved rule that the engine analyses the newest frame for the clock.

## Design

- **Where.** `YoloModel` in `live/engine.py` (or a small new module it
  calls). `warm_up` is unchanged: it runs `model.track()` so ultralytics
  builds the predictor, the tracker and the CUDA graph, then resets the
  tracker. Real frames then go through the lean path.
- **Per frame.** `im = predictor.preprocess([frame])`;
  `preds = predictor.inference(im)`; take the detection tensor
  (`preds[0]` when a tuple or list) and copy it to the CPU once;
  `non_max_suppression` with the same arguments `DetectionPredictor.postprocess`
  passes (conf, iou, classes, agnostic_nms, max_det, nc = number of
  classes); scale boxes with `scale_boxes(im.shape[2:], ..., frame.shape)`
  and keypoints with `scale_coords` after reshaping to `kpt_shape`, as
  `PosePredictor.construct_result` does.
- **Tracking, as `on_predict_postprocess_end` does.** Feed
  `Boxes(det[:, :6], frame.shape)` (NumPy) and the frame to
  `predictor.trackers[0].update`. No tracks: return `[]` (today's path
  also yields no tracker IDs then). Otherwise each track row gives the
  tracker's box (`[:4]`), ID (`[4]`) and detection index (`[-1]`); the
  keypoints are the detection's at that index. Return `Person`s in track
  order, as today.
- **Old path kept for comparison.** `YoloModel(..., lean=True)`;
  `lean=False` keeps calling `model.track()`. Only tests and measurements
  use `lean=False`.
- **Copied ultralytics behaviour is pinned by tests**, not by trust: the
  parity test below fails if an ultralytics update changes what the lean
  path has to mirror.

## Tests

- **Parity on real video (GPU, both clips, every frame in order):**
  `YoloModel(lean=False)` vs `YoloModel(lean=True)`, each with its own
  tracker: same number of people, same IDs in the same order, boxes and
  keypoints (including keypoint confidences) within 0.001.
- **CPU path:** the lean path also runs on CPU (no graph).
- **Edge frames:** a blank frame returns `[]`; a frame where detections
  exist but no track is confirmed returns `[]`.
- **Real check:** `live.realcheck` at 1x and 0.1x (analysed rate,
  detection active, events, matched with offline, identity, GPU memory),
  and the browser at 1x. Numbers are recorded whatever they are.

## Left to the builder

- Whether the lean path lives in `engine.py` or a new `live/inference.py`.
- How to build the reduced-frame test for "detections but no confirmed
  track" (for example the first frame after a tracker reset).
