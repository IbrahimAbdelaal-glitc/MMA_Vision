"""CUDA Graph inference for the live engine (design 2026-11-17-live-cuda-graph).

The wrapper tests use a tiny network whose output nests like the pose head's
(a tensor plus a list of tensors). They need a CUDA device and are skipped
without one; the CPU path is covered in the YoloModel section.
"""
import cv2  # noqa: F401  (before torch: OpenMP clash, see the live-engine plan)
import pytest
import torch

from live.cuda_graph import GraphedForward, deep_clone

needs_cuda = pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a CUDA device")
SHAPE = (1, 3, 64, 96)


class TinyNet(torch.nn.Module):
    def __init__(self):
        super().__init__()
        torch.manual_seed(0)
        self.a = torch.nn.Conv2d(3, 8, 3, padding=1)
        self.b = torch.nn.Conv2d(8, 4, 3, padding=1)

    def forward(self, x, **kwargs):
        h = torch.nn.functional.silu(self.a(x))
        y = self.b(h)
        return y.mean(dim=(2, 3)), [h, y]


def equal(a, b) -> bool:
    if isinstance(a, torch.Tensor):
        return isinstance(b, torch.Tensor) and torch.equal(a, b)
    return type(a) is type(b) and len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))


@pytest.fixture
def net():
    return TinyNet().cuda().eval()


class Counting:
    def __init__(self, forward):
        self.forward = forward
        self.calls = 0

    def __call__(self, im, **kwargs):
        self.calls += 1
        return self.forward(im, **kwargs)


@needs_cuda
def test_replay_matches_eager_bit_for_bit(net):
    wrapped = GraphedForward(net)
    wrapped.arm()
    with torch.inference_mode():
        for seed in (1, 2, 3):
            torch.manual_seed(seed)
            x = torch.rand(SHAPE, device="cuda")
            assert equal(wrapped(x), net(x))
    assert wrapped.graph_ready
    assert wrapped.captured_shape == SHAPE
    assert wrapped.error is None


@needs_cuda
def test_other_shape_runs_the_original_forward(net):
    counting = Counting(net)
    wrapped = GraphedForward(counting)
    wrapped.arm()
    with torch.inference_mode():
        wrapped(torch.rand(SHAPE, device="cuda"))           # captures
        before = counting.calls
        other = torch.rand(1, 3, 96, 96, device="cuda")
        result = wrapped(other)
        assert counting.calls == before + 1
        assert equal(result, net(other))
        assert not wrapped.graph_ready                          # the graph is retired (review I1)
        wrapped(torch.rand(SHAPE, device="cuda"))               # so the captured shape now runs eager too
        assert counting.calls == before + 2


@needs_cuda
def test_other_dtype_runs_the_original_forward(net):
    counting = Counting(net)
    wrapped = GraphedForward(counting)
    wrapped.arm()
    with torch.inference_mode():
        wrapped(torch.rand(SHAPE, device="cuda"))               # captures
        before = counting.calls
        with pytest.raises(RuntimeError):
            wrapped(torch.rand(SHAPE, device="cuda").half())    # eager: the fp32 net rejects fp16
        assert counting.calls == before + 1
        assert not wrapped.graph_ready


class CachingNet(torch.nn.Module):
    """Caches a per-shape tensor by reassignment, as the pose head caches its
    anchors (ultralytics nn/modules/head.py: `if self.shape != shape`)."""

    def __init__(self):
        super().__init__()
        self.shape = None
        self.anchor = None

    def forward(self, x, **kwargs):
        if self.shape != x.shape:
            self.anchor = torch.full((x.shape[-1],), float(x.shape[-1]), device=x.device)
            self.shape = x.shape
        return x.sum(dim=(1, 2)) + self.anchor


@needs_cuda
def test_a_shape_change_retires_the_graph_so_later_frames_stay_correct():
    """Review I1: after an eager call at another shape the cached anchor is
    reallocated, so replaying the old graph would read freed memory."""
    model = CachingNet()
    wrapped = GraphedForward(model)
    reference = CachingNet()
    with torch.inference_mode():
        a = torch.rand(SHAPE, device="cuda")
        b = torch.rand(1, 3, 64, 80, device="cuda")
        wrapped(a)                                              # as YoloModel.warm_up: one eager call first,
        wrapped.arm()                                           # so the anchor lives on the default stream
        assert equal(wrapped(a), reference(a))                  # captures at A
        assert equal(wrapped(b), reference(b))                  # B: eager; the A anchor is freed
        junk = [torch.full((96,), -1.0, device="cuda") for _ in range(16)]   # later allocations reuse it
        for _ in range(3):
            assert equal(wrapped(a), reference(a))              # back at A: must not replay stale memory
    del junk
    assert not wrapped.graph_ready
    assert "(1, 3, 64, 96)" in wrapped.error and "(1, 3, 64, 80)" in wrapped.error


@needs_cuda
def test_results_are_copies(net):
    wrapped = GraphedForward(net)
    wrapped.arm()
    with torch.inference_mode():
        first_in = torch.rand(SHAPE, device="cuda")
        first = wrapped(first_in)
        kept = deep_clone(first)
        wrapped(torch.rand(SHAPE, device="cuda"))
        wrapped(torch.rand(SHAPE, device="cuda"))
        assert equal(first, kept)
        assert equal(first, net(first_in))


@needs_cuda
def test_capture_failure_falls_back_and_records_the_reason(net):
    def fragile(im, **kwargs):
        if torch.cuda.is_current_stream_capturing():
            raise RuntimeError("not capturable")
        return net(im, **kwargs)

    wrapped = GraphedForward(fragile)
    wrapped.arm()
    with torch.inference_mode():
        x = torch.rand(SHAPE, device="cuda")
        assert equal(wrapped(x), net(x))
        assert not wrapped.graph_ready
        assert "not capturable" in wrapped.error
        y = torch.rand(SHAPE, device="cuda")                    # the device still works afterwards
        assert equal(wrapped(y), net(y))


@needs_cuda
def test_failure_midway_through_capture_leaves_the_device_usable(net):
    def syncs(im, **kwargs):
        out = net(im, **kwargs)
        out[0].sum().item()                                     # a host sync: illegal while capturing
        return out

    wrapped = GraphedForward(syncs)
    wrapped.arm()
    with torch.inference_mode():
        x = torch.rand(SHAPE, device="cuda")
        assert equal(wrapped(x), net(x))
        assert not wrapped.graph_ready and wrapped.error
        y = torch.rand(SHAPE, device="cuda")
        assert equal(wrapped(y), net(y))


@needs_cuda
def test_unarmed_wrapper_never_captures(net):
    counting = Counting(net)
    wrapped = GraphedForward(counting)
    with torch.inference_mode():
        for _ in range(3):
            wrapped(torch.rand(SHAPE, device="cuda"))
    assert counting.calls == 3
    assert not wrapped.graph_ready
    assert wrapped.captured_shape is None


@needs_cuda
def test_augment_or_embed_requests_run_the_original_forward(net):
    counting = Counting(net)
    wrapped = GraphedForward(counting)
    wrapped.arm()
    with torch.inference_mode():
        x = torch.rand(SHAPE, device="cuda")
        wrapped(x)                                              # captures
        before = counting.calls
        wrapped(x, augment=False, embed=None)                   # falsy: replay
        assert counting.calls == before
        wrapped(x, embed=[1])                                   # truthy: eager
        assert counting.calls == before + 1


def test_deep_clone_copies_nested_tensors():
    t = torch.arange(4.0)
    out = deep_clone((t, [t, t * 2], "label"))
    assert isinstance(out, tuple) and isinstance(out[1], list) and out[2] == "label"
    t.add_(100)
    assert torch.equal(out[0], torch.arange(4.0))
    assert torch.equal(out[1][1], torch.arange(4.0) * 2)


# ---------------------------------------------------------------- YoloModel
from pathlib import Path  # noqa: E402

from live import cuda_graph  # noqa: E402
from live.engine import YoloModel  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REAL: dict = {}
for _path in sorted((ROOT / "jobs").glob("*/input/input.mp4")):
    REAL.setdefault(_path.stat().st_size, _path)
CLIPS = {"6s": REAL.get(6119753), "15s": REAL.get(15230609)}


def frames_of(path):
    capture = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG)
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                return
            yield frame
    finally:
        capture.release()


@needs_cuda
@pytest.mark.parametrize("name", ["6s", "15s"])
def test_graphed_model_matches_eager_on_every_frame_of_the_real_clips(name):
    clip = CLIPS[name]
    if clip is None:
        pytest.skip(f"the real {name} clip is not in jobs/")
    first = next(frames_of(clip))
    height, width = first.shape[:2]
    eager, graphed = YoloModel("cuda:0", use_graph=False), YoloModel("cuda:0")
    eager.warm_up(width, height)
    graphed.warm_up(width, height)
    assert eager.inference == "eager"
    assert graphed.inference == "cuda_graph", graphed.inference_error
    frames = people = 0
    for index, frame in enumerate(frames_of(clip)):
        expected, got = eager(frame), graphed(frame)
        assert got == expected, f"frame {index} differs"
        frames += 1
        people += len(got)
    hook = graphed.model.predictor.model.backend.forward
    assert isinstance(hook, cuda_graph.GraphedForward) and hook.graph_ready   # still replaying at the end
    assert frames > 300 and people > frames                                    # the clips really had fighters


@needs_cuda
def test_model_reports_eager_and_logs_when_the_frame_size_changes(capsys):
    """Review M2: a retired graph must not keep reporting cuda_graph."""
    import numpy as np
    model = YoloModel("cuda:0")
    model.warm_up(320, 180)
    assert model.inference == "cuda_graph"
    model(np.zeros((180, 320, 3), dtype=np.uint8))
    assert model.inference == "cuda_graph"
    model(np.zeros((360, 320, 3), dtype=np.uint8))            # letterboxes to another shape
    assert model.inference == "eager"
    assert "input changed from (1, 3, 384, 640)" in model.inference_error
    assert "CUDA graph retired" in capsys.readouterr().err
    model(np.zeros((180, 320, 3), dtype=np.uint8))
    assert model.inference == "eager"


def test_cpu_model_reports_eager():
    model = YoloModel("cpu")
    model.warm_up(64, 36)
    assert model.inference == "eager"
    assert model.inference_error is None


@needs_cuda
def test_capture_failure_reports_eager_and_the_reason(monkeypatch):
    def broken(self, im, kwargs):
        raise RuntimeError("capture refused for the test")

    monkeypatch.setattr(cuda_graph.GraphedForward, "_capture", broken)
    model = YoloModel("cuda:0")
    model.warm_up(320, 180)
    assert model.inference == "eager"
    assert "capture refused for the test" in model.inference_error
    import numpy as np
    assert model(np.zeros((180, 320, 3), dtype=np.uint8)) == []    # inference still runs
