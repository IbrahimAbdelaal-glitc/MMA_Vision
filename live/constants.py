"""Every number the live engine uses, in one place (design section 18).

Two kinds of constant live here:

* Mirrored constants restate a rule of the offline pipeline. Each cites the
  file and line it mirrors and changes only if that script changes. The
  pipeline scripts run code when imported, so they are restated, not imported.
* Starting values are the engine's own choices, to be confirmed on real clips.
"""

# ---------------------------------------------------------------- mirrored

OFFLINE_FPS = 60                    # temporal_strike_detection.py:21, analyze_strikes.py:19
KEYPOINT_CONFIDENCE = 0.35          # analyze_strikes.py:20, movement_analysis.py:38
MAX_VALID_SPEED = 3000.0            # temporal_strike_detection.py:23
MIN_SPEED_THRESHOLD = 400.0         # temporal_strike_detection.py:24
SPEED_PERCENTILE = 0.90             # temporal_strike_detection.py:98
LIMB_SPEED_MAX_GAP_FRAMES = 3       # analyze_strikes.py:198 (0 < frame difference <= 3)
SMOOTH_WINDOW = 3                   # temporal_strike_detection.py:79 rolling(3, min_periods=2)
SMOOTH_MIN_VALUES = 2
PEAK_HALF_WINDOW_FRAMES = 2         # temporal_strike_detection.py:112 (i - 2 .. i + 2)
POST_FRAMES = 12                    # temporal_strike_detection.py:27
MIN_PEAK_GAP_FRAMES = 15            # temporal_strike_detection.py:28
BASELINE_FRAMES = (-6, -2)          # temporal_strike_detection.py:143-144
PEAK_FRAMES = (-1, 2)               # temporal_strike_detection.py:154, 166, 188
POST_WINDOW_FRAMES = (5, 12)        # temporal_strike_detection.py:146-147
CANDIDATE_MIN_SCORE = 35.0          # temporal_strike_detection.py:229
FIRST_STAGE_EXTENSION = 0.04        # temporal_strike_detection.py:203
FIRST_STAGE_ANGLE = 8.0             # temporal_strike_detection.py:207
FIRST_STAGE_RETRACTION = 0.03       # temporal_strike_detection.py:211
GATE_MIN_EXTENSION = 0.0            # refine_strikes.py:30
GATE_MIN_ANGLE_GAIN = -5.0          # refine_strikes.py:31
GATE_MIN_CONFIDENCE = 0.85          # refine_strikes.py:32
DUPLICATE_GAP_SECONDS = 0.35        # refine_strikes.py:33
CLASS_VERY_STRONG = 80.0            # filter_strikes.py:26
CLASS_STRONG = 65.0                 # filter_strikes.py:28 (also the scorecard count, :37)
CLASS_REVIEW = 50.0                 # filter_strikes.py:30

# Seeding: tracker ID 1 is Blue, ID 2 is Red (movement_analysis.py:27-36).
SEED_IDS = {"blue": 1, "red": 2}

# Model settings (movement_analysis.py:162-171).
MODEL_FILE = "yolo11n-pose.pt"
MODEL_CONF = 0.35
MODEL_IMGSZ = 640
MODEL_TRACKER = "bytetrack.yaml"

# COCO keypoint indexes (strike_estimation.py:47-60).
KP = {
    "left_shoulder": 5, "right_shoulder": 6,
    "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10,
    "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14,
    "left_ankle": 15, "right_ankle": 16,
}
BODY_JOINTS = tuple(KP.values())    # the 12 joints the pipeline records

# Derived from the frame-based windows at the offline 60 fps.
FRAME = 1.0 / OFFLINE_FPS
LIMB_SPEED_MAX_GAP = LIMB_SPEED_MAX_GAP_FRAMES * FRAME          # 0.05 s
PEAK_HALF_WINDOW = PEAK_HALF_WINDOW_FRAMES * FRAME              # 2/60 s
MIN_PEAK_GAP = MIN_PEAK_GAP_FRAMES * FRAME                      # 0.25 s
POST_WINDOW_END = POST_WINDOW_FRAMES[1] * FRAME                 # 0.2 s

# ---------------------------------------------------------- starting values

# Identity tracking (9.3)
G_BASE = 0.05
G_RATE = 0.5
G_MAX = 0.25
R_MAX = 1.6
M_TRACK = 0.25

# Identity comparison (12)
C_GATE = 0.10
C_MARGIN = 0.05

# Timing (6)
CROSS_CHECK_TOLERANCE_MS = 0.5
PROBE_TIMEOUT_SECONDS = 120
LIVE_FPS_RANGE = (59.9, 60.1)
SELF_CHECK_JUMP_MS = 100.0
SELF_CHECK_JUMP_FRAME = 30

# Detection (8, 10)
# Analysed frames per second below which detection is reported inactive.
# Derived, not chosen: limb speed is only measured between samples at most
# LIMB_SPEED_MAX_GAP (0.05 s) apart, so below 20 analysed frames per second
# no speed and so no event can form. The approved design said 10; measured
# 2026-11-17, 10-13 /s was reported active yet produced no event (user chose
# to raise it: docs/live-engine.md, "Detection threshold").
MIN_ANALYSED_RATE = 1.0 / LIMB_SPEED_MAX_GAP     # 20 analysed frames per second
RATE_WINDOW_SECONDS = 2.0
RATE_MIN_WINDOW_SECONDS = 0.1       # plan decision 3
THRESHOLD_WARM_UP = 60              # smoothed samples per stream
N_RANK_MIN = 4                      # earlier gated candidates per stream
EVENTS_PER_MINUTE_MIN_BASIS = 5.0   # seconds
MAX_STEP_SECONDS = 0.25             # gap that nulls speed and resets the detector

# Pacing (8)
SILENT_CLIENT_SECONDS = 2.0
BACKWARD_TOLERANCE_SECONDS = 0.1

# Lifecycle (7)
CLIENT_TIMEOUT_SECONDS = 60.0
STOP_WAIT_SECONDS = 10.0
TERMINATE_WAIT_SECONDS = 5.0
RETENTION_SECONDS = 3600.0
BAD_LINES_BEFORE_CRASH = 3


def tolerance_ms(fps: float) -> float:
    """T7/T8/runtime tolerance: max(1 ms, 2 % of the frame period)."""
    return max(1.0, 0.02 * 1000.0 / fps)
