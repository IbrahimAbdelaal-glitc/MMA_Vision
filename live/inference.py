"""Lean per-frame inference for the live engine.

Why (design 2026-11-17-live-lean-inference): with the network a CUDA graph,
most of a frame's 40-72 ms went to ultralytics' per-frame glue around it:
Results objects, callbacks, per-detection slicing, and dozens of tiny NMS
and scaling kernels on a GPU that drops to its lowest power state between
bursts. NMS plus scaling took 11.6 ms on the GPU and 2.6 ms on the CPU.

`lean_track` runs the same steps as `model.track()` for one BGR frame, using
the predictor ultralytics already configured during warm-up (its letterbox,
the CUDA-graph forward, its NMS arguments and its ByteTrack instance), but
copies the raw predictions to the CPU once and does NMS, scaling and
tracking there. The steps mirror ultralytics 8.4:
`DetectionPredictor.postprocess`, `PosePredictor.construct_result`,
`trackers.track.on_predict_postprocess_end` and the box clipping in
`Results.update`. The real-clip parity test pins
that mirror: same people and tracker IDs on every frame, coordinates within
0.001 (CPU vs GPU float rounding, accepted by the user 2026-11-17).
"""
from __future__ import annotations

import numpy as np
import torch
from ultralytics.engine.results import Boxes
from ultralytics.utils import nms, ops

from live.identity import Person


def lean_track(predictor, frame: np.ndarray) -> list:
    args = predictor.args
    with torch.inference_mode():
        im = predictor.preprocess([frame])
        preds = predictor.inference(im)
        raw = preds[0] if isinstance(preds, (list, tuple)) else preds
        raw = raw.cpu()
        det = nms.non_max_suppression(
            raw, args.conf, args.iou, args.classes, args.agnostic_nms,
            max_det=args.max_det, nc=len(predictor.model.names),
            end2end=getattr(predictor.model, "end2end", False),
        )[0]
        det[:, :4] = ops.scale_boxes(im.shape[2:], det[:, :4], frame.shape)
        keypoints = det[:, 6:].view(det.shape[0], *predictor.model.kpt_shape)
        keypoints = ops.scale_coords(im.shape[2:], keypoints, frame.shape)
    tracks = predictor.trackers[0].update(Boxes(det[:, :6].numpy(), frame.shape), frame)
    if len(tracks) == 0:
        return []                     # as model.track(): no tracker IDs, so no people
    keypoints = keypoints.numpy()
    # The tracker's (Kalman) boxes can cross the frame edge; model.track()
    # clips them when it writes them back (Results.update -> ops.clip_boxes).
    boxes = ops.clip_boxes(tracks[:, :4].copy(), frame.shape)
    return [Person(int(row[4]), tuple(float(v) for v in box), keypoints[int(row[-1])].tolist())
            for row, box in zip(tracks, boxes)]
