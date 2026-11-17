# Live Lean Inference Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per real frame, call the configured ultralytics predictor's own pieces directly (preprocess, graphed inference, CPU NMS and scaling, the configured ByteTrack), skipping `model.track()`'s Results and callbacks, to reach 20+ analysed fps at 1x.

**Architecture:** A new `live/inference.py` holds `lean_track(predictor, frame) -> list[Person]`. `YoloModel(device, use_graph=True, lean=True)` keeps its warm-up (which builds predictor, tracker and graph through `model.track()`), then sends real frames through `lean_track`; `lean=False` keeps `model.track()` for comparison.

**Tech Stack:** Python 3.13 (Anaconda), torch 2.13 cu126, ultralytics 8.4, pytest.

**Spec:** `docs/superpowers/specs/2026-11-17-live-lean-inference-design.md` (approved 2026-11-17).

**Status (2026-11-17):** implemented and verified, not committed. Lean path 33.9 ms vs 77.4 ms
per frame, parity within 0.001 on both clips. With the lean path alone, 1x was capped at 10 /s by the
100 ms clock. After the 33 ms clock (fast-clock design), 1x reaches 29.3 /s with detection active
(see `docs/live-engine.md`, "33 ms clock").

## Global Constraints

- Same model and settings: fp32, `imgsz` 640, `conf` 0.35, predictor's NMS IoU, `classes=[0]`, `bytetrack.yaml`, the CUDA graph.
- Use the predictor's configured objects (`predictor.preprocess`, `predictor.inference`, `predictor.args`, `predictor.trackers[0]`, `predictor.model.kpt_shape`); never a second tracker or letterbox.
- Parity tolerance: same people, IDs and order on every real-clip frame; boxes and keypoints within 0.001.
- No change to detection, timing, pacing, identity, metrics, scoring, threshold, protocol, UI, or `src/`. No new dependencies; no system settings.
- Python `C:\Users\ibrah\anaconda3\python.exe`; cv2 before torch. Do not commit without asking the user.

## Review Focus

1. A frame with no detections at all: returns `[]`, tracker still advances its frame count (Task 1 test).
2. Tracks exist but some detections are unmatched: only tracked people returned, keypoints from the matched detection index (Task 1 parity covers it on real frames).
3. The predictor's `preds` is a tuple `(y, dict)`: the detection tensor is `preds[0]` (Task 1 parity).
4. CPU device (no graph): lean path still works (Task 1 test).
5. GPU memory after the session: unchanged, graph pool dies with the process (Task 2 real check).

---

### Task 1: `lean_track` and `YoloModel(lean=...)`

**Files:**
- Create: `live/inference.py`
- Modify: `live/engine.py` (`YoloModel.__init__`, `__call__`)
- Test: `tests/test_live_lean.py`

**Interfaces:**
- Produces: `lean_track(predictor, frame: np.ndarray) -> list[Person]` (Person from `live.identity`); `YoloModel(device: str, use_graph: bool = True, lean: bool = True)`. `__call__` uses `lean_track(self.model.predictor, frame)` when `lean` and the predictor exists; otherwise `model.track(...)` as today. The retired-graph check from 3dd2677 stays in `__call__` for both paths.
- `lean_track` mirrors, in order: `predictor.preprocess([frame])`; `predictor.inference(im)`; detection tensor = `preds[0]` if tuple/list; `.cpu()` once; `ultralytics.utils.nms.non_max_suppression(p, a.conf, a.iou, a.classes, a.agnostic_nms, max_det=a.max_det, nc=len(predictor.model.names), end2end=getattr(predictor.model, "end2end", False))[0]`; `ops.scale_boxes(im.shape[2:], det[:, :4], frame.shape)`; keypoints `det[:, 6:].view(n, *kpt_shape)` then `ops.scale_coords(im.shape[2:], kpts, frame.shape)`; `tracks = predictor.trackers[0].update(Boxes(det[:, :6].numpy(), frame.shape), frame)`; no tracks → `[]`; else per row: `Person(int(row[4]), tuple(row[:4]), kpts[int(row[-1])].tolist())` in row order.

- [ ] **Step 1: Write the failing tests**
  - `test_lean_path_matches_model_track_on_every_frame_of_the_real_clips` (GPU, parametrised 6s/15s, skipped without clip or CUDA): two `YoloModel`s, `lean=False` and `lean=True`, both warmed up at the clip size; for every frame: same length, same `track_id`s in order, `max |box diff| <= 1e-3`, `max |keypoint diff| <= 1e-3` (x, y and confidence); assert some frames have people.
  - `test_lean_path_runs_on_cpu` (64x36 warm-up, blank frame) → `[]`.
  - `test_blank_frame_returns_nothing_and_still_advances_the_tracker` (GPU): `frame_id` of `predictor.trackers[0]` increases by 1 per call, result `[]`.
- [ ] **Step 2: Run** `python -m pytest tests/test_live_lean.py -q` → FAIL (`lean` unknown / module missing).
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run** → PASS; then `python -m pytest tests -q` → all pass.

### Task 2: Real-video verification and docs

**Files:** Modify `docs/live-engine.md`; this plan's status line.

- [ ] **Step 1:** Per-frame timing of `YoloModel(lean=True)` vs `lean=False` on the 6 s clip (median, p90), recorded.
- [ ] **Step 2:** `python -m live.realcheck --video <6 s clip> --rate 1 --rate 0.1 --analyse --out <tmp>` with the API running. Expected: `inference: "cuda_graph"`; at 1x at least 20 analysed fps and detection active, events emitted; 0.1x events matched with offline and identity agree; GPU 0 MiB after exit and at hand-off. Record numbers whatever they are; do not claim the goal if missed.
- [ ] **Step 3:** Browser at 1x: detection Active, events appear, paused overlay exact, Discard OK.
- [ ] **Step 4:** Docs: new "Lean inference path" section (decision, measured table, parity), Known limitations updated; plan status line; full backend and frontend suites again.
- [ ] **Step 5:** Ask the user before committing.
