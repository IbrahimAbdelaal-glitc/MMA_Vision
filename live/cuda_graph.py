"""Replay the live network forward as one CUDA Graph.

Why (design 2026-11-17-live-cuda-graph): yolo11n-pose is about 600 small GPU
kernels. Launched one by one from Python they cost about 160 us each on this
laptop, so the GPU sits mostly idle; recorded once as a CUDA Graph they are
submitted as one launch (measured 125.7 ms -> 2.3 ms, output bit-identical).

`GraphedForward` wraps one forward callable. Once armed, the next eligible
call captures: the input is copied into a static buffer, a few warm-up
forwards run on a side stream (as CUDA Graphs require), and the forward is
recorded. Later calls with the same shape, dtype and device copy into the
buffer and replay. CPU input and test-time augmentation or embedding
requests run the original forward unchanged. A CUDA input of another shape
or dtype retires the graph for good (reason in `error`): an eager forward
at another shape makes the pose head reallocate its cached anchors, which
the graph points at. Tensors in returned lists and tuples are fresh copies,
because each replay overwrites the static outputs; dict values are not
copied (in ultralytics 8.4 the pose head's `preds` dict, used only for
ReID features, which ByteTrack does not read). If capture fails, the reason is kept in `error` and every call runs
the original forward, so the engine still works and can report `eager`.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import torch


def deep_clone(obj: Any) -> Any:
    """Clone every tensor inside nested lists and tuples; leave other values."""
    if isinstance(obj, torch.Tensor):
        return obj.clone()
    if isinstance(obj, (list, tuple)):
        return type(obj)(deep_clone(x) for x in obj)
    return obj


def _recover(stream: torch.cuda.Stream, attempts: int = 3) -> None:
    """Undo what a capture that failed midway leaves behind (measured on this
    laptop): `torch.cuda.graph` raises before it restores the caller's stream,
    and the invalidated capture's error is still pending, so the next kernel
    launch would raise it. Restore the stream, then launch throwaway kernels
    until one runs clean."""
    torch.cuda.set_stream(stream)
    for _ in range(attempts):
        try:
            torch.empty(1, device=stream.device).zero_()
            torch.cuda.synchronize(stream.device)
            return
        except Exception:  # noqa: BLE001  (consuming the pending error is the point)
            continue


class GraphedForward:
    def __init__(self, forward: Callable, warmup_iters: int = 3):
        self.forward = forward
        self.warmup_iters = warmup_iters
        self.graph_ready = False
        self.captured_shape: Optional[tuple] = None
        self.error: Optional[str] = None
        self._armed = False
        self._graph: Optional[torch.cuda.CUDAGraph] = None
        self._static_in: Optional[torch.Tensor] = None
        self._static_out: Any = None

    def arm(self) -> None:
        """The next eligible call captures the graph."""
        self._armed = True

    def __call__(self, im: torch.Tensor, **kwargs):
        if kwargs.get("augment") or kwargs.get("embed") or not im.is_cuda:
            return self.forward(im, **kwargs)
        if self.graph_ready:
            graph, static_in = self._graph, self._static_in
            assert graph is not None and static_in is not None
            if self._matches(im, static_in):
                static_in.copy_(im)
                graph.replay()
                return deep_clone(self._static_out)
            # Retire the graph for good: the eager call below can reallocate
            # tensors the graph holds raw pointers to (the pose head caches its
            # anchors per shape), so a later replay would read freed memory.
            self.error = (f"input changed from {tuple(static_in.shape)} {static_in.dtype} to "
                          f"{tuple(im.shape)} {im.dtype}; CUDA graph retired, standard inference from now on")
            self._discard()
            return self.forward(im, **kwargs)
        if self._armed and self.error is None:
            self._armed = False
            stream = torch.cuda.current_stream(im.device)
            try:
                return self._capture(im, kwargs)
            except Exception as error:  # noqa: BLE001  (any failure means: stay eager, say why)
                self._discard()
                self.error = f"{type(error).__name__}: {error}"
                _recover(stream)
        return self.forward(im, **kwargs)

    @staticmethod
    def _matches(im: torch.Tensor, s: torch.Tensor) -> bool:
        return tuple(im.shape) == tuple(s.shape) and im.dtype == s.dtype and im.device == s.device

    def _capture(self, im: torch.Tensor, kwargs: dict):
        static_in = im.clone()
        side = torch.cuda.Stream(device=im.device)
        side.wait_stream(torch.cuda.current_stream(im.device))
        with torch.cuda.stream(side):
            for _ in range(self.warmup_iters):
                self.forward(static_in, **kwargs)
        torch.cuda.current_stream(im.device).wait_stream(side)
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            static_out = self.forward(static_in, **kwargs)
        self._graph, self._static_in, self._static_out = graph, static_in, static_out
        self.captured_shape = tuple(im.shape)
        self.graph_ready = True
        graph.replay()
        return deep_clone(static_out)

    def _discard(self) -> None:
        self._graph = self._static_in = self._static_out = None
        self.graph_ready = False
        self.captured_shape = None
