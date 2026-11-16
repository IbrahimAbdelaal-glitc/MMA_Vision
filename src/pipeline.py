import os
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SRC_DIR = ROOT / "src"
DEFAULT_INPUT_DIR = ROOT / "videos" / "input"

VIDEO_PATH = os.environ.get("MMA_VIDEO_PATH")
RESULTS_DIR = Path(
    os.environ.get("MMA_RESULTS_DIR", ROOT / "results")
)
OUTPUT_DIR = Path(
    os.environ.get("MMA_OUTPUT_DIR", ROOT / "videos" / "output")
)

PIPELINE_STAGES = [
    ("Movement Analysis", "movement_analysis.py"),
    ("Movement Data Analysis", "analyze_movement.py"),
    ("Pose Estimation", "strike_estimation.py"),
    ("Joint Feature Analysis", "analyze_strikes.py"),
    ("Temporal Strike Detection", "temporal_strike_detection.py"),
    ("Strike Refinement", "refine_strikes.py"),
    ("Strike Classification", "filter_strikes.py"),
    ("Opponent Direction Analysis", "analyze_opponent_direction.py"),
    ("Experimental Scorecard", "scoring.py"),
]


def validate_input():

    if VIDEO_PATH:
        video = Path(VIDEO_PATH)

    else:
        if not DEFAULT_INPUT_DIR.exists():
            raise FileNotFoundError(
                f"Input directory not found: {DEFAULT_INPUT_DIR}"
            )

        videos = list(DEFAULT_INPUT_DIR.glob("*.mp4"))

        if len(videos) == 0:
            raise FileNotFoundError(
                "No MP4 video found inside videos/input."
            )

        if len(videos) > 1:
            raise RuntimeError(
                "Multiple MP4 videos found. "
                "Specify MMA_VIDEO_PATH."
            )

        video = videos[0]

    if not video.exists():
        raise FileNotFoundError(
            f"Input video not found: {video}"
        )

    return video


def run_stage(name, script, env):

    script_path = SRC_DIR / script

    if not script_path.exists():
        raise FileNotFoundError(
            f"Pipeline script not found: {script_path}"
        )

    print("\n" + "=" * 55)
    print(f"RUNNING: {name}")
    print("=" * 55)

    subprocess.run(
        [sys.executable, str(script_path)],
        cwd=ROOT,
        env=env,
        check=True
    )

    print(f"\nCOMPLETED: {name}")


def main():

    print("\nMMA VISION - ANALYSIS PIPELINE")
    print("=" * 55)

    video = validate_input()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()

    env["MMA_VIDEO_PATH"] = str(video.resolve())
    env["MMA_RESULTS_DIR"] = str(RESULTS_DIR.resolve())
    env["MMA_OUTPUT_DIR"] = str(OUTPUT_DIR.resolve())

    print(f"\nInput video: {video.name}")
    print(f"Project directory: {ROOT}")
    print(f"Results directory: {RESULTS_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")

    try:

        for name, script in PIPELINE_STAGES:
            run_stage(name, script, env)

    except subprocess.CalledProcessError as error:

        print("\nPIPELINE FAILED")
        print(f"Failed script: {error.cmd[-1]}")
        print(f"Exit code: {error.returncode}")

        raise

    print("\n" + "=" * 55)
    print("MMA VISION PIPELINE COMPLETED SUCCESSFULLY")
    print("=" * 55)

    print("\nResults directory:")
    print(RESULTS_DIR)


if __name__ == "__main__":
    main()