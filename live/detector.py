"""Design 10.3: the causal live strike-like event detector.

It restates the offline rules of analyze_strikes.py, temporal_strike_detection.py,
refine_strikes.py and filter_strikes.py (constants in live/constants.py) on
analysed frames already seen. Every emitted event is final: it is never changed,
withdrawn or relabelled.

Detection runs on eight streams: corner x side x type. Times are verified
video times in seconds. Comparisons that the design calls "exactly" allow
EPS for the 1 ms timestamp tolerance (6.3); EPS is far below a frame period.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right, insort
from dataclasses import dataclass, field
from statistics import median
from typing import Optional

from live import constants as K

EPS = 0.002
SIDES = ("left", "right")
TYPES = ("punch-like", "kick-like")
CORNERS = ("blue", "red")

JOINTS = {
    "punch-like": ("shoulder", "elbow", "wrist"),
    "kick-like": ("hip", "knee", "ankle"),
}

DECISION_DELAY = K.DUPLICATE_GAP_SECONDS + K.MIN_PEAK_GAP + K.PEAK_HALF_WINDOW   # about 0.63 s

# How limb speed is measured (docs/validation.md, "Speed reference"):
#   "image": wrist/ankle speed in image pixels, as the offline pipeline
#            (analyze_strikes.py) measures it. The default, so live events keep
#            mirroring the final scorecard's candidates.
#   "torso": wrist/ankle speed relative to the fighter's own torso centre, so a
#            step, footwork or a camera pan is not counted as limb speed. Not
#            used by the offline pipeline; live events then differ from it.
SPEED_REFERENCES = ("image", "torso")
TORSO_JOINTS = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")


# ---------------------------------------------------------------- features

def _point(keypoints, name: str):
    x, y, c = keypoints[K.KP[name]]
    if c is None or not (c >= K.KEYPOINT_CONFIDENCE):
        return None
    return (float(x), float(y))


def body_centre(keypoints) -> Optional[tuple]:
    """Mean of the confident shoulders and hips (at least two), or None."""
    points = [p for p in (_point(keypoints, j) for j in TORSO_JOINTS) if p is not None]
    if len(points) < 2:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def _distance(a, b) -> Optional[float]:
    if a is None or b is None:
        return None
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle(a, b, c) -> Optional[float]:
    """analyze_strikes.py calculate_angle: degrees at b."""
    if a is None or b is None or c is None:
        return None
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    denominator = math.hypot(*ba) * math.hypot(*bc)
    if denominator == 0:
        return None
    cosine = max(-1.0, min(1.0, (ba[0] * bc[0] + ba[1] * bc[1]) / denominator))
    return math.degrees(math.acos(cosine))


def limb_features(keypoints, side: str, kind: str) -> dict:
    """Extension (normalised by torso) and joint angle for one limb in one frame."""

    j1, j2, j3 = JOINTS[kind]
    p1 = _point(keypoints, f"{side}_{j1}")
    p2 = _point(keypoints, f"{side}_{j2}")
    p3 = _point(keypoints, f"{side}_{j3}")
    shoulder = _point(keypoints, f"{side}_shoulder")
    hip = _point(keypoints, f"{side}_hip")
    torso = _distance(shoulder, hip)
    extension = None
    if torso is not None and torso > 0:
        reach = _distance(p1, p3)   # shoulder-wrist or hip-ankle
        if reach is not None:
            extension = reach / torso
    confidences = tuple(float(keypoints[K.KP[f"{side}_{j}"]][2]) for j in (j1, j2, j3))
    return {"extension": extension, "angle": _angle(p1, p2, p3), "confidences": confidences,
            "end_point": p3}


# ------------------------------------------------------------------ streams

@dataclass
class Sample:
    frame: int
    t: float
    speed: Optional[float]
    smoothed: Optional[float]
    threshold: float
    extension: Optional[float]
    angle: Optional[float]
    confidences: Optional[tuple]       # None when the corner was not tracked
    checked: bool = False


@dataclass
class Candidate:
    peak: Sample
    features: dict
    first_stage: float
    pool_size: int
    status: str                       # held | emitted | duplicate | reset
    score_status: str
    kinematic_score: Optional[float]
    detection_class: Optional[str]
    side: str = ""                    # breaks exact ties between the two legs (cross-leg rivals)

    @property
    def t(self) -> float:
        return self.peak.t

    def key(self, other: "Candidate") -> float:
        if self.kinematic_score is not None and other.kinematic_score is not None:
            return self.kinematic_score
        return self.peak.smoothed

    def beats(self, other: "Candidate") -> bool:
        mine, theirs = self.key(other), other.key(self)
        if mine != theirs:
            return mine > theirs
        if abs(self.t - other.t) > EPS:
            return self.t < other.t
        # Same score at the same instant (only possible across the two legs):
        # a fixed order, so exactly one of the pair survives.
        return self.side < other.side


class SampleStore:
    """Samples of one stream since its last reset, in time order."""

    def __init__(self):
        self.samples: list = []
        self.times: list = []

    def add(self, sample: Sample) -> None:
        self.samples.append(sample)
        self.times.append(sample.t)

    def window(self, t0: float, t1: float) -> list:
        lo = bisect_left(self.times, t0 - EPS)
        hi = bisect_right(self.times, t1 + EPS)
        return self.samples[lo:hi]

    def clear(self) -> None:
        self.samples.clear()
        self.times.clear()


class Stream:
    def __init__(self, side: str, kind: str):
        self.side = side
        self.kind = kind
        self.store = SampleStore()
        self.threshold_values: list = []      # sorted non-null smoothed speeds, kept across resets
        self.pending: Optional[Sample] = None
        self.pool: list = []                  # every gated candidate, kept across resets
        self.held: list = []
        self.cursor = 0                       # next sample to judge as a peak

    # step 2 + 3
    def record(self, frame: int, t: float, speed: Optional[float], feats: Optional[dict]) -> Sample:
        recent = [s for s in self.store.samples[-(K.SMOOTH_WINDOW - 1):] if s.t >= t - K.LIMB_SPEED_MAX_GAP - EPS]
        values = [s.speed for s in recent if s.speed is not None]
        if speed is not None:
            values.append(speed)
        smoothed = median(values) if len(values) >= K.SMOOTH_MIN_VALUES else None
        if smoothed is not None:
            insort(self.threshold_values, smoothed)
        threshold = self._threshold()
        sample = Sample(frame, t, speed, smoothed, threshold,
                        feats["extension"] if feats else None,
                        feats["angle"] if feats else None,
                        feats["confidences"] if feats else None)
        self.store.add(sample)
        return sample

    def _threshold(self) -> float:
        values = self.threshold_values
        if len(values) < K.THRESHOLD_WARM_UP:
            return K.MIN_SPEED_THRESHOLD
        # Linear interpolation, as pandas Series.quantile.
        position = (len(values) - 1) * K.SPEED_PERCENTILE
        low = math.floor(position)
        high = min(low + 1, len(values) - 1)
        q = values[low] + (values[high] - values[low]) * (position - low)
        return max(K.MIN_SPEED_THRESHOLD, q)

    # step 4
    def is_peak(self, p: Sample) -> bool:
        if p.smoothed is None or p.smoothed < p.threshold:
            return False
        nearby = self.store.window(p.t - K.PEAK_HALF_WINDOW, p.t + K.PEAK_HALF_WINDOW)
        return all(s.smoothed is None or p.smoothed >= s.smoothed for s in nearby)

    def recognisable(self, t_now: float) -> list:
        """Samples that can now be judged as peaks: a sample 2/60 s later exists."""
        out = []
        samples = self.store.samples
        while self.cursor < len(samples) and samples[self.cursor].t <= t_now - K.PEAK_HALF_WINDOW + EPS:
            s = samples[self.cursor]
            s.checked = True
            out.append(s)
            self.cursor += 1
        return out

    def reset(self) -> int:
        discarded = len(self.held)
        for c in self.held:
            c.status = "reset"
        self.held = []
        self.pending = None
        self.store.clear()
        self.cursor = 0
        return discarded


# ----------------------------------------------------------------- detector

def classify(score: float) -> str:
    if score >= K.CLASS_VERY_STRONG:
        return "Very Strong"
    if score >= K.CLASS_STRONG:
        return "Strong"
    if score >= K.CLASS_REVIEW:
        return "Review"
    return "Low"


def _clip(value, low, high):
    return max(low, min(high, value))


class Detector:
    def __init__(self, speed_reference: str = "image",
                 cross_leg_kick_duplicates: bool = K.CROSS_LEG_KICK_DUPLICATES):
        """cross_leg_kick_duplicates: kick-like candidates of one fighter on opposite legs
        within DUPLICATE_GAP_SECONDS are one movement (the kicking leg and the pivoting
        standing leg), as in refine_strikes.py. False restores per-limb duplicates only,
        for comparison (python -m live.replay detect --per-limb-duplicates)."""
        if speed_reference not in SPEED_REFERENCES:
            raise ValueError(f"speed_reference must be one of {SPEED_REFERENCES}, not {speed_reference!r}")
        self.speed_reference = speed_reference
        self.cross_leg_kick_duplicates = cross_leg_kick_duplicates
        self.streams = {corner: {(side, kind): Stream(side, kind) for side in SIDES for kind in TYPES}
                        for corner in CORNERS}
        self.previous = {corner: None for corner in CORNERS}   # (t, keypoints) of last tracked frame
        self.last_t: Optional[float] = None
        self.was_active = False
        self.discarded_by_resets = 0
        self.discarded_duplicates = 0
        self.ended = False

    # ------------------------------------------------------------- public
    def add_frame(self, frame: int, t: float, keypoints_by_corner: dict, active: bool) -> list:
        """One analysed frame. keypoints_by_corner[corner] is 17x3 when tracked, else None.

        Returns the events emitted at this frame (decided this frame), in peak order.
        """

        if self.ended:
            raise RuntimeError("the detector has ended")
        if self.last_t is not None and t - self.last_t > K.MAX_STEP_SECONDS + EPS:
            self._reset()
        if not active and self.was_active:
            self._reset()
        self.last_t = t
        self.was_active = active

        speeds = {}
        for corner in CORNERS:
            kps = keypoints_by_corner.get(corner)
            speeds[corner] = self._limb_speeds(corner, t, kps)
            self.previous[corner] = (t, kps) if kps is not None else self.previous[corner]

        if not active:
            return []

        for corner in CORNERS:
            kps = keypoints_by_corner.get(corner)
            for (side, kind), stream in self.streams[corner].items():
                feats = limb_features(kps, side, kind) if kps is not None else None
                stream.record(frame, t, speeds[corner].get((side, kind)), feats)
        return self._advance(t, final=False)

    def finish(self, t_last: float) -> list:
        """video_end finalisation (10.3): uses only samples already recorded."""

        self.ended = True
        return self._advance(t_last, final=True)

    def discard(self) -> int:
        """stopped / disconnected / crashed: drop pending peaks and held candidates; returns how many."""

        self.ended = True
        dropped = 0
        for corner in CORNERS:
            for stream in self.streams[corner].values():
                dropped += len(stream.held) + (stream.pending is not None)
                for c in stream.held:
                    c.status = "discarded"
                stream.held = []
                stream.pending = None
        return dropped

    def swap(self) -> None:
        """Policy 3: the whole detector history moves with the person."""
        self.streams["blue"], self.streams["red"] = self.streams["red"], self.streams["blue"]
        self.previous["blue"], self.previous["red"] = self.previous["red"], self.previous["blue"]

    # ------------------------------------------------------------ helpers
    def _reset(self) -> None:
        for corner in CORNERS:
            for stream in self.streams[corner].values():
                self.discarded_by_resets += stream.reset()

    def _limb_speeds(self, corner: str, t: float, kps) -> dict:
        out = {}
        prev = self.previous[corner]
        if kps is None or prev is None or prev[1] is None:
            return out
        dt = t - prev[0]
        if dt <= 0 or dt > K.LIMB_SPEED_MAX_GAP + EPS:
            return out
        origin_now = origin_before = (0.0, 0.0)
        if self.speed_reference == "torso":
            origin_now, origin_before = body_centre(kps), body_centre(prev[1])
            if origin_now is None or origin_before is None:
                return out          # no torso to measure against: no speed, never image speed
        for side in SIDES:
            for kind, joint in (("punch-like", "wrist"), ("kick-like", "ankle")):
                a = _point(kps, f"{side}_{joint}")
                b = _point(prev[1], f"{side}_{joint}")
                if a is not None and b is not None:
                    a = (a[0] - origin_now[0], a[1] - origin_now[1])
                    b = (b[0] - origin_before[0], b[1] - origin_before[1])
                d = _distance(a, b)
                if d is None:
                    continue
                speed = d / dt
                if 0 <= speed <= K.MAX_VALID_SPEED:
                    out[(side, kind)] = speed
        return out

    def _advance(self, t: float, final: bool) -> list:
        joined = []   # (corner, candidate) formed this frame
        for corner in CORNERS:
            for stream in self.streams[corner].values():
                finals = []
                if not final:
                    for q in stream.recognisable(t):
                        if not stream.is_peak(q):
                            continue
                        s = stream.pending
                        if s is not None and q.t - s.t < K.MIN_PEAK_GAP - EPS:
                            if q.smoothed > s.smoothed:
                                stream.pending = q
                        else:
                            if s is not None:
                                finals.append(s)
                            stream.pending = q
                    s = stream.pending
                    if s is not None and t >= s.t + K.MIN_PEAK_GAP + K.PEAK_HALF_WINDOW - EPS:
                        finals.append(s)
                        stream.pending = None
                else:
                    s = stream.pending
                    stream.pending = None
                    if s is not None and s.t + K.POST_WINDOW_END <= t + EPS:
                        finals.append(s)
                for peak in finals:
                    candidate = self._form(stream, peak, t)
                    if candidate is not None:
                        joined.append(candidate)

        # Rivals within DUPLICATE_GAP_SECONDS are decided DECISION_DELAY after the peak.
        # That bound holds across streams too: a rival on any stream peaking up to
        # 0.35 s later has formed by then (MIN_PEAK_GAP + PEAK_HALF_WINDOW after its peak).
        emitted = []
        for corner in CORNERS:
            for stream in self.streams[corner].values():
                due = [c for c in stream.held if final or t >= c.t + DECISION_DELAY - EPS]
                for c in sorted(due, key=lambda c: c.t):
                    rivals = [r for pool in self._rival_pools(corner, stream) for r in pool
                              if r is not c and r.status in ("held", "emitted")
                              and abs(r.t - c.t) < K.DUPLICATE_GAP_SECONDS - EPS]
                    stream.held.remove(c)
                    if all(c.beats(r) for r in rivals):
                        c.status = "emitted"
                        emitted.append(self._event(corner, stream, c))
                    else:
                        c.status = "duplicate"
                        self.discarded_duplicates += 1
        emitted.sort(key=lambda e: e["peak_t"])
        return emitted

    def _rival_pools(self, corner: str, stream: Stream) -> list:
        """The candidate pools a candidate of `stream` competes with for duplicates."""
        pools = [stream.pool]
        if self.cross_leg_kick_duplicates and stream.kind == "kick-like":
            other = "left" if stream.side == "right" else "right"
            pools.append(self.streams[corner][(other, "kick-like")].pool)
        return pools

    def _form(self, stream: Stream, peak: Sample, t_now: float) -> Optional[Candidate]:
        """Steps 6-8 for a final peak. None if it fails a filter."""

        if peak.t + K.POST_WINDOW_END > t_now + EPS:
            return None   # post window would run past what has been recorded
        store = stream.store
        f = K.FRAME
        baseline = store.window(peak.t - 6 * f, peak.t - 2 * f)
        peak_w = store.window(peak.t - 1 * f, peak.t + 2 * f)
        post = store.window(peak.t + 5 * f, peak.t + K.POST_WINDOW_END)

        def med(samples, attr):
            values = [getattr(s, attr) for s in samples if getattr(s, attr) is not None]
            return median(values) if values else None

        base_ext, peak_ext, post_ext = med(baseline, "extension"), med(peak_w, "extension"), med(post, "extension")
        base_ang, peak_ang = med(baseline, "angle"), med(peak_w, "angle")
        if None in (base_ext, peak_ext, base_ang, peak_ang) or post_ext is None:
            return None   # filter 1
        ext_gain = peak_ext - base_ext
        ang_gain = peak_ang - base_ang
        retraction = peak_ext - post_ext

        joint_means = []
        for j in range(3):
            values = [s.confidences[j] for s in peak_w if s.confidences is not None]
            if values:
                joint_means.append(sum(values) / len(values))
        confidence = sum(joint_means) / len(joint_means) if joint_means else 0.0

        first_stage = (
            min(25.0, 25.0 * peak.smoothed / max(peak.threshold, 1.0))
            + (25.0 if ext_gain >= K.FIRST_STAGE_EXTENSION else 0.0)
            + (20.0 if ang_gain >= K.FIRST_STAGE_ANGLE else 0.0)
            + (20.0 if retraction >= K.FIRST_STAGE_RETRACTION else 0.0)
            + 10.0 * min(1.0, max(0.0, confidence))
        )
        if first_stage < K.CANDIDATE_MIN_SCORE:
            return None   # filter 2
        if not (ext_gain > K.GATE_MIN_EXTENSION and ang_gain >= K.GATE_MIN_ANGLE_GAIN
                and confidence >= K.GATE_MIN_CONFIDENCE):
            return None   # filter 3

        earlier = [c.peak.smoothed for c in stream.pool]
        n = len(earlier) + 1
        if len(earlier) < K.N_RANK_MIN:
            score_status, score, klass = "unscored_warm_up", None, None
        else:
            lower = sum(1 for v in earlier if v < peak.smoothed)
            equal = sum(1 for v in earlier if v == peak.smoothed) + 1
            speed_component = 20.0 * (lower + (equal + 1) / 2.0) / n
            score = round(
                speed_component
                + 30.0 * _clip(ext_gain, 0.0, 0.30) / 0.30
                + 20.0 * _clip(ang_gain, 0.0, 30.0) / 30.0
                + 20.0 * confidence
                + 10.0 * _clip(retraction, 0.0, 0.30) / 0.30,
                2,
            )
            score_status, klass = "scored", classify(score)

        candidate = Candidate(
            peak=peak,
            features={"extension_gain": ext_gain, "angle_gain": ang_gain,
                      "retraction": retraction, "keypoint_confidence": confidence},
            first_stage=first_stage, pool_size=n, status="held",
            score_status=score_status, kinematic_score=score, detection_class=klass,
            side=stream.side,
        )
        stream.pool.append(candidate)
        stream.held.append(candidate)
        return candidate

    def _event(self, corner: str, stream: Stream, c: Candidate) -> dict:
        return {
            "corner": corner,
            "side": stream.side,
            "type": stream.kind,
            "peak_t": c.t,
            "peak_frame": c.peak.frame,
            "smoothed_peak_speed": c.peak.smoothed,
            "extension_gain": c.features["extension_gain"],
            "angle_gain": c.features["angle_gain"],
            "retraction": c.features["retraction"],
            "keypoint_confidence": c.features["keypoint_confidence"],
            "first_stage_score": round(c.first_stage, 2),
            "pool_size": c.pool_size,
            "score_status": c.score_status,
            "kinematic_score": c.kinematic_score,
            "detection_class": c.detection_class,
        }
