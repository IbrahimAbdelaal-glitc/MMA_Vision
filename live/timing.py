"""Design 6.3 acceptance rules T1-T9 and the 6.6 per-frame runtime check.

Pure functions on lists, so every rule is unit-tested without a video file.
The probe (live/probe.py) gathers the lists; the engine uses runtime_check.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

from live.constants import CROSS_CHECK_TOLERANCE_MS, LIVE_FPS_RANGE, tolerance_ms


@dataclass
class Meta:
    backend: str
    fps: float
    frame_count: int
    width: int
    height: int


@dataclass
class Rule:
    passed: Optional[bool]  # None: not applicable (no container to compare with)
    detail: str


@dataclass
class RuleReport:
    results: dict = field(default_factory=dict)
    start_offset_ms: Optional[float] = None

    @property
    def failed(self) -> list:
        return [name for name, rule in self.results.items() if rule.passed is False]

    @property
    def ok(self) -> bool:
        return not self.failed

    def as_dict(self) -> dict:
        return {name: {"passed": r.passed, "detail": r.detail} for name, r in self.results.items()}


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def check_rules(
    meta: Meta,
    decoded_ms: Sequence[float],
    packet_ms: Optional[Sequence[Optional[float]]],
) -> RuleReport:
    """Apply T1-T9. packet_ms is None for a bare timestamp list (T4 not applicable)."""

    report = RuleReport()
    r = report.results
    fps = meta.fps
    fps_ok = _finite(fps) and fps > 0
    period = 1000.0 / fps if fps_ok else float("nan")
    tol = tolerance_ms(fps) if fps_ok else float("nan")
    n = len(decoded_ms)

    r["T1"] = Rule(meta.backend == "FFMPEG", f"backend {meta.backend!r}")

    r["T2"] = Rule(
        fps_ok and meta.frame_count > 0 and meta.width > 0 and meta.height > 0,
        f"fps {fps}, {meta.frame_count} frames, {meta.width}x{meta.height}",
    )

    present = n > 0 and all(_finite(t) and t >= 0 for t in decoded_ms) and all(
        t != 0 for t in decoded_ms[1:]
    )
    r["T3"] = Rule(present, f"{n} decoded timestamps" + ("" if present else ", some missing"))

    if packet_ms is None:
        r["T4"] = Rule(None, "no container packets (timestamp list)")
    else:
        if any(p is None or not _finite(p) for p in packet_ms):
            r["T4"] = Rule(False, "a packet has no timestamp")
        else:
            packets = sorted(packet_ms)
            distinct = all(b > a for a, b in zip(packets, packets[1:]))
            report.start_offset_ms = packets[0] if packets else None
            relative = [p - packets[0] for p in packets]
            counts = n == meta.frame_count == len(relative)
            if not distinct:
                r["T4"] = Rule(False, "two packets share a timestamp")
            elif not counts:
                r["T4"] = Rule(
                    False,
                    f"{n} decoded frames, {meta.frame_count} reported, {len(relative)} packets",
                )
            elif not present:
                r["T4"] = Rule(False, "decoded timestamps are missing")
            else:
                worst = max(abs(d - p) for d, p in zip(decoded_ms, relative))
                r["T4"] = Rule(
                    worst <= CROSS_CHECK_TOLERANCE_MS,
                    f"worst decoded vs packet difference {worst:.4f} ms",
                )

    if present and fps_ok:
        first = decoded_ms[0]
        r["T5"] = Rule(abs(first) <= period / 2, f"first timestamp {first:.3f} ms")
        increasing = all(b > a for a, b in zip(decoded_ms, decoded_ms[1:]))
        r["T6"] = Rule(increasing, "strictly increasing" if increasing else "not increasing")
        gaps = [b - a for a, b in zip(decoded_ms, decoded_ms[1:])]
        worst_gap = max((abs(g - period) for g in gaps), default=0.0)
        r["T7"] = Rule(worst_gap <= tol, f"worst gap error {worst_gap:.3f} ms (tolerance {tol:.3f})")
        devs = [abs(t - i * period) for i, t in enumerate(decoded_ms)]
        worst_i = max(range(n), key=devs.__getitem__)
        r["T8"] = Rule(
            devs[worst_i] <= tol,
            f"worst deviation {devs[worst_i]:.3f} ms at frame {worst_i} (tolerance {tol:.3f})",
        )
    else:
        for name in ("T5", "T6", "T7", "T8"):
            r[name] = Rule(False, "cannot be checked without timestamps and a frame rate")

    low, high = LIVE_FPS_RANGE
    r["T9"] = Rule(
        fps_ok and low <= fps <= high,
        f"reported {fps:.3f} fps; live analysis needs {low}-{high} fps"
        if fps_ok else "no frame rate",
    )

    # Keep a stable T1..T9 order for reports.
    report.results = {f"T{i}": r[f"T{i}"] for i in range(1, 10)}
    return report


def runtime_check(index: int, p_ms: float, verified_ms: Sequence[float], fps: float) -> Optional[str]:
    """Design 6.6: None when frame `index` read at `p_ms` matches the verified basis."""

    if index < 0 or index >= len(verified_ms):
        return f"frame {index} is past the verified frame count {len(verified_ms)}"
    if not _finite(p_ms):
        return f"frame {index} has no timestamp"
    if abs(p_ms - verified_ms[index]) > CROSS_CHECK_TOLERANCE_MS:
        return f"frame {index} at {p_ms:.3f} ms, verified {verified_ms[index]:.3f} ms"
    expected = index * 1000.0 / fps
    if abs(p_ms - expected) > tolerance_ms(fps):
        return f"frame {index} at {p_ms:.3f} ms, expected {expected:.3f} ms"
    return None
