# Live CUDA Graph Speed-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the live engine's network forward as one replayed CUDA Graph, so live detection is active at 1x on this laptop, with results identical to today's.

**Architecture:** A small `GraphedForward` wrapper replaces ultralytics' `predictor.model.backend.forward` inside `YoloModel`; it captures during the existing warm-up and replays for inputs of the captured shape, falling back to the original forward otherwise. The engine reports the path in `ready.inference`, and the dashboard shows it.

**Tech Stack:** Python 3.13 (Anaconda), torch 2.13 cu126, ultralytics 8.4.214, pytest; React/TS, vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-live-cuda-graph-design.md` (approved 2026-11-17).

**Status (2026-11-17):** Tasks 1-4 implemented and verified, not committed. Graph active and
bit-identical; 1x reaches 9.2-12.9 analysed fps (goal of 10 /s only borderline) and still emits
no events because of the 3-frame limb-speed gap. See `docs/live-engine.md`, "CUDA Graph inference".

## Global Constraints

- Model unchanged: `yolo11n-pose.pt`, fp32, `imgsz` 640, `conf` 0.35, `classes=[0]`, ByteTrack.
- No new dependencies; no system or power-setting changes; no change to detection, timing, pacing, identity, metrics, scoring, protocol semantics, overlay rule, or `src/`.
- Python: `python` (the project's Python 3.13 environment); import cv2 (or ultralytics) before torch.
- The fallback is never silent: `ready.inference` is `"cuda_graph"` or `"eager"`.
- Do not commit without asking the user.

## Review Focus

1. An input whose shape, dtype or device differs from the captured one: runs the original forward (Task 1 test).
2. The predictor keeping the returned tensors while the next replay overwrites the static outputs: results must be copies (Task 1 test).
3. Capture raising (e.g. an op not capturable): engine still starts, `inference: "eager"`, reason in `engine.log` (Task 2 test).
4. CPU device: no capture attempted (Task 2 test).
5. GPU memory after the session: the graph pool dies with the engine process; `live.realcheck` reports 0 MiB after exit (Task 4).

---

### Task 1: `GraphedForward` wrapper

**Files:**
- Create: `live/cuda_graph.py`
- Test: `tests/test_live_cuda_graph.py` (module skipped when `torch.cuda.is_available()` is false)

**Interfaces:**
- Produces: `class GraphedForward` with `__init__(self, forward: Callable, warmup_iters: int = 3)`, `__call__(self, im: torch.Tensor, **kwargs)`, attributes `graph_ready: bool`, `captured_shape: Optional[tuple]`, `error: Optional[str]`, and `arm(self) -> None` (the next eligible call captures). `deep_clone(obj)` clones tensors inside nested lists/tuples.
- Rules: replay only when armed-and-captured, `im.is_cuda`, and shape, dtype and device match the capture, and `kwargs` carry no truthy `augment`/`embed`; otherwise call `forward(im, **kwargs)`. Capture: copy `im` into a static input, run `warmup_iters` forwards on a side stream, capture with `torch.cuda.graph`, then return `deep_clone` of the replayed outputs. A capture exception sets `error`, leaves `graph_ready` false, and returns the eager result.

- [ ] **Step 1: Write the failing tests** (a tiny conv net returning `(tensor, [tensor, tensor])`, mirroring the pose head's nesting)
  - `test_replay_matches_eager_bit_for_bit`: armed wrapper, two different random inputs of one shape → each equals the eager output exactly (`torch.equal`).
  - `test_other_shape_runs_the_original_forward`: after capture on (1,3,64,96), an input of (1,3,96,96) calls the original forward (count calls) and equals eager.
  - `test_results_are_copies`: result of call 1 unchanged after call 2 with different input.
  - `test_capture_failure_falls_back_and_records_the_reason`: a forward that raises `RuntimeError("not capturable")` when `torch.cuda.is_current_stream_capturing()` → result equals eager, `graph_ready` false, `"not capturable" in error`.
  - `test_unarmed_wrapper_never_captures`.
- [ ] **Step 2: Run** `python -m pytest tests/test_live_cuda_graph.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** `live/cuda_graph.py` per the Interfaces block.
- [ ] **Step 4: Run** the same command → PASS.

### Task 2: `YoloModel` uses the wrapper; real-clip parity

**Files:**
- Modify: `live/engine.py` (`YoloModel`, `main`)
- Test: `tests/test_live_cuda_graph.py` (parity section, also skipped without the real clips; clips found as in `tests/test_live_probe.py` by size 6119753 and 15230609)

**Interfaces:**
- Consumes: `GraphedForward`.
- Produces: `YoloModel(device: str, use_graph: bool = True)`; attributes `inference: str` (`"cuda_graph"` | `"eager"`) and `inference_error: Optional[str]`, set by `warm_up`. `warm_up` installs the wrapper on `self.model.predictor.model.backend.forward` (the predictor exists after a first call), arms it, runs the warm-up inference (which captures), then resets the trackers as today. On CPU or `use_graph=False` no wrapper is installed and `inference` is `"eager"`. `main` prints `inference_error` to stderr (`engine.log`) when set.

- [ ] **Step 1: Write the failing tests**
  - `test_graphed_model_matches_eager_on_every_frame_of_the_real_clips` (parametrised over both clips): decode every frame in order; feed each to `YoloModel("cuda:0", use_graph=False)` and `YoloModel("cuda:0")`, both warmed up at the clip size; assert `graphed.inference == "cuda_graph"` and the `Person` lists are equal (ids, boxes, keypoints exactly).
  - `test_cpu_model_reports_eager` (CPU, no CUDA needed, small 64x36 warm-up): `inference == "eager"`, `inference_error is None`.
  - `test_capture_failure_reports_eager_and_the_reason`: monkeypatch `GraphedForward` capture to raise → `inference == "eager"`, reason in `inference_error`, inference still returns results.
- [ ] **Step 2: Run** `python -m pytest tests/test_live_cuda_graph.py -v` → the new tests FAIL.
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run** → PASS; then the whole backend suite `python -m pytest tests` → all pass.

### Task 3: Report the path (`ready.inference`) in engine, fake engine and dashboard

**Files:**
- Modify: `live/engine.py` (`EngineCore.__init__` gains `inference: str = "eager"`; `ready()` adds `"inference"`; `main` passes `model.inference`), `tests/fake_engine.py` (`"inference": "eager"`), `tests/test_live_vocabulary.py` (allow-list adds `"inference"` to `ready`), `tests/test_live_engine.py`.
- Modify: `frontend/src/types/live.ts` (`ready` gains `inference: 'cuda_graph' | 'eager' | null`), `services/liveMessages.ts`, `hooks/useLiveSession.ts` (state `inference`), `components/live-metrics/MonitoringControls.tsx` (prop `inference`; Engine row appends ` · CUDA graph` or ` · standard inference`), `components/dashboard/LiveMonitoring.tsx`; tests in `services/live.test.ts`, `hooks/useLiveSession.test.ts`.

- [ ] **Step 1: Write the failing tests**: `test_ready_reports_the_inference_path` (EngineCore with `inference="cuda_graph"` → ready has it); vocabulary test passes with the new field; frontend: `normalizeEngineMessage` keeps `inference` and maps unknown values to `null`; the hook stores it from `ready`.
- [ ] **Step 2: Run** backend and frontend tests → the new ones FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest tests`, and in `frontend`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → all pass.

### Task 4: Real-video verification and docs

**Files:** Modify `docs/live-engine.md`, this plan's status line. `live/realcheck.py` reports `ready.inference`.

- [ ] **Step 1:** Add `"inference"` (from the `ready` message) to each `live.realcheck` session report.
- [ ] **Step 2:** Start uvicorn; run `python -m live.realcheck --video <6 s clip> --rate 1 --rate 0.1 --analyse --out <tmp>`. Expected: `inference: "cuda_graph"`; at 1x analysed rate of at least 10 /s and detection active; GPU memory 0 MiB after each exit and at the hand-off. Record the numbers whatever they are; if under 10 /s, profile and report, do not claim the goal.
- [ ] **Step 3:** Browser at 1x (Playwright, Vite on a free port): engine status shows "CUDA graph", events appear, Pause shows the exact overlay, Discard cleans up.
- [ ] **Step 4:** Update `docs/live-engine.md` (Decisions, Measured, Known limitations: the 1x claim replaced by the new measurement) and the status line of this plan; full suites again.
- [ ] **Step 5:** Ask the user before committing.
