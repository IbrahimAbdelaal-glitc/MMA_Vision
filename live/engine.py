"""The live engine: one child process per session (design 2, 7, 8, 14).

    python -m live.engine --video input.mp4 --probe probe.json --out live/

Protocol: JSON lines. stdin carries `clock`, `swap` and `stop` messages from
the browser (relayed by the API); stdout carries `ready`, `frame`, `event`,
`identity`, `stats`, `clock_rejected`, `ended` and `error`. Diagnostics go to
stderr, which the API redirects to engine.log.

A reader thread queues stdin lines; the main loop drains the queue only
between frames, so a message that arrives during a frame takes effect after it.
When stdin closes (the API died), the engine stops: no orphan keeps the GPU.
"""

from __future__ import annotations

import csv
import json
import math
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from live import constants as K
from live.detector import Detector
from live.identity import IdentityTracker, Person
from live.metrics import EventRate, RateMeter, frame_metrics
from live.pacing import Pacer
from live.timing import runtime_check

ROOT = Path(__file__).resolve().parent.parent


class TimingMismatch(Exception):
    pass


def _r(value, digits=3):
    if value is None:
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, digits)
    return value


class CsvLog:
    """A CSV file flushed on every row, so a crash keeps everything written so far."""

    def __init__(self, path: Path, columns: list):
        self.file = path.open("w", encoding="utf-8", newline="")
        self.writer = csv.DictWriter(self.file, fieldnames=columns, extrasaction="ignore")
        self.writer.writeheader()
        self.file.flush()

    def write(self, row: dict) -> None:
        self.writer.writerow({k: ("" if v is None else v) for k, v in row.items()})
        self.file.flush()

    def close(self) -> None:
        self.file.close()


TRACK_COLUMNS = ["frame", "t", "corner", "state", "track_id", "center_x", "center_y",
                 "x1", "y1", "x2", "y2", "keypoint_confidence"]
EVENT_COLUMNS = ["corner", "side", "type", "peak_t", "peak_frame", "smoothed_peak_speed",
                 "extension_gain", "angle_gain", "retraction", "keypoint_confidence",
                 "first_stage_score", "pool_size", "score_status", "kinematic_score",
                 "detection_class"]
IDENTITY_COLUMNS = ["kind", "corner", "frame", "t", "track_id", "cost", "margin", "reason"]


class EngineCore:
    """Everything the engine does, with the capture, model and clock injected."""

    def __init__(self, *, timestamps_ms: list, fps: float, width: int, height: int,
                 capture, model: Callable, emit: Callable, out_dir: Optional[Path],
                 device: str = "cpu", inference: str = "eager",
                 clock: Callable = time.monotonic, stats_interval: float = 1.0):
        self.verified_ms = list(timestamps_ms)
        self.fps = fps
        self.width, self.height = width, height
        self.diagonal = math.hypot(width, height)
        self.capture = capture
        self.model = model
        self.emit = emit
        self.device = device
        self.inference = inference           # "cuda_graph" or "eager" (design 2026-11-17-live-cuda-graph)
        self.clock = clock
        self.stats_interval = stats_interval
        self.inbox: queue.Queue = queue.Queue()

        self.pacer = Pacer([t / 1000.0 for t in self.verified_ms])
        self.identity = IdentityTracker(self.diagonal)
        self.detector = Detector()
        self.rate = RateMeter()
        self.events = EventRate()
        self.grabbed = -1                 # index of the last frame grabbed
        self.previous = None              # (t, persons) of the last analysed frame
        self.previous_active = False
        self.active = False
        self.active_reason = "no frame analysed yet"
        self.analysed_rate = None
        self.last_stats_at = None
        self.event_count = 0
        self.duplicates = 0

        self.logs = None
        if out_dir is not None:
            out_dir.mkdir(parents=True, exist_ok=True)
            self.logs = {
                "track": CsvLog(out_dir / "track.csv", TRACK_COLUMNS),
                "events": CsvLog(out_dir / "events.csv", EVENT_COLUMNS),
                "identity": CsvLog(out_dir / "identity_log.csv", IDENTITY_COLUMNS),
            }

    # ------------------------------------------------------------ messages
    def send(self, message: dict) -> None:
        message["provisional"] = True
        self.emit(message)

    def ready(self) -> None:
        self.send({"type": "ready", "device": self.device, "model": K.MODEL_FILE,
                   "inference": self.inference,
                   "video": {"fps": self.fps, "frame_count": len(self.verified_ms),
                             "width": self.width, "height": self.height}})

    def handle(self, message: dict) -> Optional[str]:
        """Apply one inbox message. Returns an end reason when the session must end."""

        kind = message.get("type")
        if kind == "clock":
            try:
                t = float(message.get("t"))
            except (TypeError, ValueError):
                return None
            if not math.isfinite(t):
                return None
            if self.pacer.apply_clock(t, bool(message.get("playing")), self.clock()) == "rejected":
                self.send({"type": "clock_rejected", "t": t,
                           "position": _r(self.pacer.position),
                           "reason": "the live engine never rewinds; seeking back is not analysed"})
        elif kind == "swap":
            frame = max(self.pacer.last_analysed, 0)
            t = self.pacer.position or 0.0
            entry = self.identity.swap(frame, t)
            self.detector.swap()
            self._identity([entry])
        elif kind == "stop":
            return message.get("reason") or "stopped"
        elif kind == "eof":
            return "stopped"
        return None

    def drain(self) -> Optional[str]:
        while True:
            try:
                message = self.inbox.get_nowait()
            except queue.Empty:
                return None
            reason = self.handle(message)
            if reason:
                return reason

    # ------------------------------------------------------------ one step
    def step(self) -> Optional[str]:
        """Drain messages, then analyse at most one frame. Returns an end reason or None."""

        reason = self.drain()
        if reason:
            return reason
        target = self.pacer.next_target(self.clock())
        if target is None:
            self._maybe_stats()
            return "idle"
        frame_image = None
        while self.grabbed < target:
            if not self.capture.grab():
                raise TimingMismatch(f"frame {self.grabbed + 1} could not be read")
            self.grabbed += 1
            problem = runtime_check(self.grabbed, self.capture.pos_msec(), self.verified_ms, self.fps)
            if problem:
                raise TimingMismatch(problem)
        frame_image = self.capture.retrieve()
        self._analyse(target, frame_image)
        self._maybe_stats()
        if self.pacer.finished:
            return "video_end"
        return None

    def _analyse(self, index: int, image) -> None:
        t = self.verified_ms[index] / 1000.0
        people = self.model(image)
        result = self.identity.update(index, t, people)
        self._identity(result.log)

        self.active, self.analysed_rate, self.active_reason = self.rate.update(t)
        if self.previous is not None and self.active and self.previous_active:
            self.events.add_interval(t - self.previous[0])

        kps = {c: (p.keypoints if p is not None else None) for c, p in result.persons.items()}
        emitted = self.detector.add_frame(index, t, kps, self.active)

        metrics = frame_metrics(t, result.persons, self.previous, self.diagonal, None)
        self.pacer.mark_analysed(index)
        self.previous = (t, result.persons)
        self.previous_active = self.active

        corners = {}
        for corner in ("blue", "red"):
            person = result.persons[corner]
            state = result.states[corner]
            entry = {"state": state}
            if person is not None:
                entry.update({
                    "track_id": person.track_id,
                    "box": [_r(float(v), 1) for v in person.box],
                    "keypoints": [[_r(float(x), 1), _r(float(y), 1), _r(float(c), 3)]
                                  for x, y, c in person.keypoints],
                })
            corners[corner] = entry
            if self.logs:
                center = person.center if person is not None else (None, None)
                box = person.box if person is not None else (None,) * 4
                conf = None
                if person is not None:
                    conf = sum(float(person.keypoints[j][2]) for j in K.BODY_JOINTS) / len(K.BODY_JOINTS)
                self.logs["track"].write({
                    "frame": index, "t": _r(t, 6), "corner": corner, "state": state,
                    "track_id": person.track_id if person is not None else None,
                    "center_x": _r(center[0], 2), "center_y": _r(center[1], 2),
                    "x1": _r(box[0], 2), "y1": _r(box[1], 2), "x2": _r(box[2], 2), "y2": _r(box[3], 2),
                    "keypoint_confidence": _r(conf, 4),
                })

        for event in emitted:
            self._event(event)
        metrics["strike_like_events_per_minute"] = _r(self.events.per_minute, 2)
        self.send({"type": "frame", "t": _r(t, 6), "frame_index": index, "corners": corners,
                   "metrics": {k: _r(v, 3) for k, v in metrics.items()}})

    def _event(self, event: dict) -> None:
        self.events.add_event(event)
        self.event_count += 1
        clean = {k: _r(v, 4) for k, v in event.items()}
        if self.logs:
            self.logs["events"].write(clean)
        message = {k: v for k, v in clean.items() if k != "type"}
        message["strike_type"] = clean["type"]     # "type" names the message itself
        self.send({"type": "event", **message})

    def _identity(self, entries: list) -> None:
        for entry in entries:
            clean = {k: _r(v, 4) for k, v in entry.items()}
            if self.logs:
                self.logs["identity"].write(clean)
            self.send({"type": "identity", **clean})

    def stats(self) -> dict:
        return {
            "type": "stats",
            "frames_analysed": self.pacer.analysed,
            "frames_skipped": self.pacer.skipped,
            "analysed_rate": _r(self.analysed_rate, 2),
            "detection_active": self.active,
            "detection_inactive_reason": None if self.active else self.active_reason,
            "events_emitted": self.event_count,
            "strike_like_events_per_minute": _r(self.events.per_minute, 2),
            "events_per_minute_basis_seconds": _r(self.events.basis, 3),
            "unscored_event_count": self.events.unscored,
            "per_corner": self.events.per_corner,
            "held_candidates_discarded_by_resets": self.detector.discarded_by_resets,
            "duplicates_discarded": self.detector.discarded_duplicates,
            "position_t": _r(self.pacer.position, 6),
        }

    def _maybe_stats(self, force: bool = False) -> None:
        now = self.clock()
        if force or self.last_stats_at is None or now - self.last_stats_at >= self.stats_interval:
            self.last_stats_at = now
            self.send(self.stats())

    # ---------------------------------------------------------------- end
    def finish(self, reason: str) -> None:
        if reason == "video_end":
            t_last = self.verified_ms[self.pacer.last_analysed] / 1000.0
            for event in self.detector.finish(t_last):
                self._event(event)
        else:
            dropped = self.detector.discard()
            print(f"session ended ({reason}): {dropped} unfinished candidates discarded", file=sys.stderr)
        self._maybe_stats(force=True)
        self.send({"type": "ended", "reason": reason})
        self.close()

    def close(self) -> None:
        if self.logs:
            for log in self.logs.values():
                log.close()
            self.logs = None

    def run(self, idle_sleep: float = 0.005) -> int:
        """The process main loop. Returns the exit code."""

        self.ready()
        try:
            while True:
                reason = self.step()
                if reason == "idle":
                    # Nothing to analyse: block briefly on the inbox instead of spinning.
                    try:
                        message = self.inbox.get(timeout=idle_sleep * 20)
                        end = self.handle(message)
                        if end:
                            self.finish(end)
                            return 0
                    except queue.Empty:
                        pass
                    continue
                if reason:
                    self.finish(reason)
                    return 0
        except TimingMismatch as error:
            self.send({"type": "error", "message": f"frame timing differs from the verified timing: {error}"})
            self.close()
            return 3


# ------------------------------------------------------------- real process

class CvCapture:
    def __init__(self, path: str):
        import cv2

        self.cv2 = cv2
        self.capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
        if not self.capture.isOpened() or self.capture.getBackendName() != "FFMPEG":
            raise RuntimeError("the video could not be opened with OpenCV's FFMPEG backend")

    def grab(self) -> bool:
        return bool(self.capture.grab())

    def retrieve(self):
        ok, frame = self.capture.retrieve()
        if not ok:
            raise TimingMismatch("a grabbed frame could not be decoded")
        return frame

    def pos_msec(self) -> float:
        return float(self.capture.get(self.cv2.CAP_PROP_POS_MSEC))

    def release(self) -> None:
        self.capture.release()


class YoloModel:
    def __init__(self, device: str, use_graph: bool = True, lean: bool = True):
        from ultralytics import YOLO

        self.model = YOLO(str(ROOT / "models" / K.MODEL_FILE))
        self.device = device
        self.use_graph = use_graph
        self.inference = "eager"                 # "cuda_graph" once a graph is captured
        self.inference_error: Optional[str] = None
        self._hook = None                        # the GraphedForward, once installed
        self.lean = lean                         # real frames skip model.track() (design 2026-11-17-live-lean-inference)

    def warm_up(self, width: int, height: int) -> float:
        """Throwaway inferences on a blank frame of the video's size, before
        `ready`: the first does CUDA/cuDNN set-up (about 20 s) and creates the
        predictor; on CUDA the second captures the network forward as a CUDA
        Graph (design 2026-11-17-live-cuda-graph), at exactly the letterboxed
        shape every real frame will have. Then ByteTrack is reset so the first
        real frame still gets tracker IDs 1 and 2, as offline. Warm-up always
        goes through model.track(): that is what builds the predictor, its
        letterbox and its ByteTrack, which the lean path then reuses. Returns seconds."""

        import numpy as np

        from live.cuda_graph import GraphedForward

        started = time.perf_counter()
        blank = np.zeros((height, width, 3), dtype=np.uint8)
        self._full(blank)
        if self.use_graph and str(self.device).startswith("cuda"):
            backend = self.model.predictor.model.backend
            hook = GraphedForward(backend.forward)
            backend.forward = hook
            self._hook = hook
            hook.arm()
            self._full(blank)
            if hook.graph_ready:
                self.inference = "cuda_graph"
            else:
                self.inference_error = hook.error or "the CUDA graph was not captured"
        for tracker in getattr(self.model.predictor, "trackers", None) or []:
            tracker.reset()
        return time.perf_counter() - started

    def __call__(self, frame) -> list:
        if self.lean and getattr(self.model, "predictor", None) is not None:
            from live.inference import lean_track

            people = lean_track(self.model.predictor, frame)
        else:
            people = self._full(frame)
        if self.inference == "cuda_graph" and not self._hook.graph_ready:
            self.inference = "eager"             # never keep reporting a graph that was retired
            self.inference_error = self._hook.error
            print(f"CUDA graph retired: {self._hook.error}", file=sys.stderr, flush=True)
        return people

    def _full(self, frame) -> list:
        """ultralytics' own model.track(): warm-up, and the reference the lean path is tested against."""
        result = self.model.track(frame, persist=True, classes=[0], conf=K.MODEL_CONF,
                                  imgsz=K.MODEL_IMGSZ, device=self.device,
                                  tracker=K.MODEL_TRACKER, verbose=False)[0]
        if result.boxes is None or result.boxes.id is None or result.keypoints is None:
            return []
        ids = result.boxes.id.int().cpu().tolist()
        boxes = result.boxes.xyxy.cpu().tolist()
        keypoints = result.keypoints.data.cpu().tolist()
        return [Person(int(i), tuple(b), k) for i, b, k in zip(ids, boxes, keypoints)]


def _stdin_reader(inbox: queue.Queue) -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            print(f"ignored a line that is not JSON: {line[:80]!r}", file=sys.stderr)
            continue
        if isinstance(message, dict):
            inbox.put(message)
    inbox.put({"type": "eof"})


def main(argv: Optional[list] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--probe", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args(argv)

    def emit(message: dict) -> None:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    try:
        probe = json.loads(Path(args.probe).read_text(encoding="utf-8"))
        capture = CvCapture(args.video)          # cv2 before torch (OpenMP, see plan)
        import torch

        device = args.device
        if device == "auto":
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        print(f"loading {K.MODEL_FILE} on {device}", file=sys.stderr)
        model = YoloModel(device)
        seconds = model.warm_up(int(probe["width"]), int(probe["height"]))
        print(f"model warm-up took {seconds:.1f} s; inference: {model.inference}", file=sys.stderr)
        if model.inference_error:
            print(f"CUDA graph not used, standard inference instead: {model.inference_error}",
                  file=sys.stderr)
    except Exception as error:  # noqa: BLE001
        emit({"type": "error", "message": f"the engine could not start: {error}", "provisional": True})
        return 2

    core = EngineCore(timestamps_ms=probe["timestamps_ms"], fps=probe["fps"],
                      width=probe["width"], height=probe["height"], capture=capture,
                      model=model, emit=emit, out_dir=Path(args.out), device=device,
                      inference=model.inference)
    threading.Thread(target=_stdin_reader, args=(core.inbox,), daemon=True).start()
    try:
        return core.run()
    finally:
        capture.release()


if __name__ == "__main__":
    sys.exit(main())
