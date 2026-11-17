"""Build tests/fixtures/drift_60.mp4: a real MP4 whose drift only T8 can catch.

    python tests/fixtures/make_drift_fixture.py

Needs PyAV (`pip install av`), a fixture-building tool only: the API and the
tests do not import it. The 2013 ffmpeg could not build this file (design
6.7): its encoder rounded every timestamp to a whole 1/60 s, and when the
drift did survive, the container's fps changed because the last frame had
no duration. PyAV sets each packet's timestamp and duration directly.

The file has 61 frames at a nominal 60 fps, in a 1/60000 s time base, so
one frame period is exactly 1000 ticks:

- gaps 1-30 are 1054 ticks (period + 0.9 ms), gaps 31-60 are 946 ticks
  (period - 0.9 ms). Every gap is within T7's 1 ms tolerance;
- frame 30 is therefore 27 ms late, which T8 must reject;
- the last frame lands exactly on time (60000 ticks) and every packet,
  the last included, lasts 1000 ticks, so the stream is exactly 61 frames
  in 61/60 s: 60 fps, and T9 passes.

The encoder is MPEG-4 Part 2 with no B-frames, so packet order is
presentation order and decode timestamps equal presentation timestamps.
"""

from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

TICKS_PER_SECOND = 60000
PERIOD = 1000            # ticks: 1/60 s
DRIFT = 54               # ticks: 0.9 ms
FRAMES = 61
WIDTH, HEIGHT = 128, 72

OUT = Path(__file__).resolve().parent / "drift_60.mp4"


def presentation_ticks(drift: int = DRIFT) -> list:
    ticks = [0]
    for gap in range(1, FRAMES):
        ticks.append(ticks[-1] + PERIOD + (drift if gap <= 30 else -drift))
    return ticks


def picture(i: int) -> np.ndarray:
    image = np.full((HEIGHT, WIDTH, 3), 40, dtype=np.uint8)
    x = (i * 2) % (WIDTH - 8)
    image[:, x:x + 8] = (230, 230, 230)          # a moving bar, so frames differ
    return image


def build(path: Path = OUT, drift: int = DRIFT) -> list:
    """Write the file; drift=0 gives the same file with constant spacing (the control)."""
    ticks = presentation_ticks(drift)
    time_base = Fraction(1, TICKS_PER_SECOND)
    with av.open(str(path), mode="w", format="mp4") as container:
        stream = container.add_stream("mpeg4", rate=60)
        stream.width, stream.height = WIDTH, HEIGHT
        stream.pix_fmt = "yuv420p"
        stream.time_base = time_base
        stream.codec_context.time_base = time_base
        stream.codec_context.max_b_frames = 0
        stream.codec_context.gop_size = 12

        written = []

        def mux(packets):
            for packet in packets:
                packet.duration = PERIOD
                packet.time_base = time_base
                written.append(packet.pts)
                container.mux(packet)

        for i, pts in enumerate(ticks):
            frame = av.VideoFrame.from_ndarray(picture(i), format="rgb24").reformat(format="yuv420p")
            frame.pts = pts
            frame.time_base = time_base
            mux(stream.encode(frame))
        mux(stream.encode(None))
    if written != ticks:
        raise SystemExit(f"the encoder changed the timestamps: {written[:5]}...")
    return ticks


if __name__ == "__main__":
    build()
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    sys.exit(0)
