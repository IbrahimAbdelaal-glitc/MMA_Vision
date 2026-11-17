"""A stand-in engine process for the API tests (no model, no video).

    python tests/fake_engine.py --mode <mode> --out <live dir>

It speaks the engine's JSON-lines protocol and records every stdin message in
<out>/received.jsonl, so tests can see exactly what the API relayed.

Modes:
  normal       ready; each playing clock gives a frame and stats; stop/EOF end it
  video_end    ends by itself with video_end on the first playing clock
  ignore_stop  never exits on stop or EOF (the API must terminate it)
  block        on stop, stays "inside a frame" until <out>/release exists
  crash        exits with code 1 after the first clock, mid-way through a CSV row
  garbage      writes lines that are not JSON, then waits
"""

import argparse
import json
import sys
import time
from pathlib import Path


def emit(message):
    message["provisional"] = True
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="normal")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    received = (out / "received.jsonl").open("a", encoding="utf-8")
    track = (out / "track.csv").open("w", encoding="utf-8", newline="")
    track.write("frame,t,corner,state,track_id,center_x,center_y,x1,y1,x2,y2,keypoint_confidence\n")
    track.flush()
    print(f"fake engine started in mode {args.mode}", file=sys.stderr, flush=True)

    if args.mode == "garbage":
        for _ in range(3):
            sys.stdout.write("this is not json\n")
            sys.stdout.flush()
        time.sleep(60)
        return 0

    emit({"type": "ready", "device": "fake", "model": "none", "inference": "eager",
          "video": {"fps": 60.0, "frame_count": 360, "width": 1920, "height": 1020}})
    position = None
    analysed = 0
    for line in sys.stdin:
        message = json.loads(line)
        received.write(json.dumps(message) + "\n")
        received.flush()
        kind = message.get("type")
        if kind == "clock":
            if args.mode == "crash":
                track.write("0,0.0,blue,trac")       # killed mid-row
                track.flush()
                print("fake engine: simulated failure", file=sys.stderr, flush=True)
                return 1
            t = float(message["t"])
            if position is not None and t < position - 0.1:
                emit({"type": "clock_rejected", "t": t, "position": position,
                      "reason": "the live engine never rewinds; seeking back is not analysed"})
                continue
            if message.get("playing"):
                position = t
                analysed += 1
                frame = int(round(t * 60))
                for corner, x in (("blue", 800), ("red", 1100)):
                    track.write(f"{frame},{t},{corner},tracked,{1 if corner == 'blue' else 2},{x},500,,,,,0.9\n")
                track.flush()
                emit({"type": "frame", "t": t, "frame_index": frame, "corners": {}, "metrics": {}})
                emit({"type": "stats", "frames_analysed": analysed, "position_t": t})
                if args.mode == "video_end":
                    emit({"type": "ended", "reason": "video_end"})
                    return 0
        elif kind == "swap":
            emit({"type": "identity", "kind": "swap", "frame": 0, "t": position or 0.0,
                  "reason": "manual correction"})
        elif kind == "stop":
            if args.mode == "ignore_stop":
                continue
            if args.mode == "block":
                while not (out / "release").exists():
                    time.sleep(0.02)
            emit({"type": "ended", "reason": message.get("reason", "stopped")})
            return 0
    if args.mode == "ignore_stop":
        time.sleep(120)
    emit({"type": "ended", "reason": "stopped"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
