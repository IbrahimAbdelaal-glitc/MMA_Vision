# Validating strike-like event detection

Status (2026-11-17): **real-world detection accuracy is not established.** No
independent, human-labelled ground truth exists yet. This document describes the
validation process, what has been measured, and what the measurements do and do
not show.

Everything detected is a *strike-like movement* estimated from pose keypoints.
Nothing in MMA Vision detects contact, a landed strike or damage.

## Three kinds of evidence (kept separate)

| Kind | What it shows | What it does not show |
|---|---|---|
| 1. Synthetic tests (`tests/test_live_detector.py`, `tests/test_live_speed_reference.py`) | The live detector implements its rules correctly: causality, timing windows, duplicates, frozen scores, swaps, resets | Whether the rules find real strikes |
| 2. Agreement with the offline pipeline (`live.realcheck`, `live.replay --offline-job`) | Whether live events predict the final scorecard's candidates | Accuracy: the offline pipeline uses the same pose rules and is not ground truth |
| 3. Manual ground truth (`evaluation/review.html` + `evaluation.metrics`) | Precision, recall, F1, false positives per minute, timing error, per fighter and per type | **Not yet collected.** See "What to do next" |

## The validation workflow

1. Get events for a video:
   * live: `live_sessions/<id>/live/events.csv`, or after hand-off `jobs/<job>/live/events.csv`;
   * offline: `jobs/<job>/results/classified_strike_candidates.csv`;
   * or a deterministic replay of the live detector (below).
2. Open `evaluation/review.html` in a browser (double-click the file; it needs
   no server and no network). Choose the MP4 and the events CSV.
3. For each event (keys in brackets):
   * play the event window [W] or step frame by frame [← →];
   * set a verdict: Correct [1], Wrong type [2], False positive [3],
     Duplicate [4], Uncertain [5];
   * optionally set the actual movement (Punch-like, Kick-like, Other movement,
     Uncertain), the true peak time [T] for timestamp error, and a note
     (for example "step", "guard", "feint", "clinch", "occluded", "referee").
4. Watch the whole video for strike-like movements that have no event and add
   each one as a missed event [M] with its fighter and type. Then tick
   "I searched the whole video for missed events"; without it recall is not
   computed.
5. Export JSON (or CSV). Labels also autosave in the browser.
6. Compute the metrics over one or several reviews:

   ```bash
   python -m evaluation.metrics reviews/*.json --out report.json
   ```

### Metric definitions (`evaluation/metrics.py`)

* precision = correct / (correct + wrong type + false positive + duplicate)
* recall = correct / (correct + missed + wrong type); a wrong type also misses
  the real type
* F1 from the two; false positives per minute = (false positives + duplicates)
  per minute of reviewed video
* timestamp error = detected peak minus the reviewer's true peak (mean signed,
  mean and median absolute, maximum)
* uncertain and unreviewed events count in neither direction
* by fighter, by type, and type-agnostic (any strike-like movement)

The report says "real-world accuracy is not yet established" below **100
reviewed detections or 10 minutes of labelled video**. That is a reporting
rule, not a statistical guarantee. Labels from more than one reviewer, on
footage from several cameras and fights, are needed before the numbers mean
much.

### Scoring other detectors against the same labels (`evaluation/score.py`)

`evaluation.metrics` scores the one event list that was labelled. To compare
detectors (offline candidates, live events at 1x, a replay with a rule
changed) without labelling each again, `evaluation.score` turns a **complete**
review (missed events searched) into ground truth and matches any event list
against it:

* truth = the events marked correct (at the reviewer's true peak, if set),
  wrong-type events under their actual type, and every missed event;
  uncertain events become *ignore zones*; a review with any unreviewed event
  is refused (an unlabelled event may be a real movement);
* a detection within the tolerance (default 0.25 s, `--tolerance`) of a
  movement of the same fighter and type is correct; of the other type only,
  wrong type; of an already matched movement, a duplicate; near an ignore
  zone, ignored; otherwise a false positive. Unmatched movements are missed.

Reusable dataset layout (under `validation/`, which git ignores, so footage
and labels stay on your computer):

```
validation/datasets/<clip>/
    manifest.json          video path, fps, duration, provenance   (created by "init")
    truth.json             a complete review.html export: the ground truth
    reviews/*.json         optional reviews by other people (agreement)
    detections/<name>.csv  event lists to score, e.g. offline.csv, live_1x.csv, replay_torso.csv
```

```powershell
python -m evaluation.score init --video C:\path\to\clip.mp4 --name ufc-a-r1
python -m evaluation.score dataset validation\datasets --out validation\report.json
python -m evaluation.score file --truth truth.json --detections events.csv
```

The report gives precision, recall, F1, false positives per minute,
duplicates, missed events, timestamp error, and the same by fighter and by
type, per detector, over all clips. The fighter labels must agree with the
reviewed output's Blue/Red (the identity check shows whether live and offline
agree).

### Replaying the live detector deterministically

```bash
# GPU, once per video: model + identity tracker on every frame, keypoints cached
python -m live.replay extract --video clip.mp4 --out validation/clip.npz
# CPU, seconds: the causal detector at a chosen analysed rate (30 is what 1x reaches)
python -m live.replay detect --cache validation/clip.npz --rate 30 \
    --out validation/clip_r30.csv --offline-job jobs/<job>
```

The replay uses the engine's own `YoloModel`, `IdentityTracker` and `Detector`,
so its events can be reviewed in `review.html`. It is faithful: at 60 /s it
reproduced the 0.1x real check exactly (23 events, 19 matched, 4 live-only,
6 offline-only), and at 30 /s on the 15 s clip it gave the same 39 events as the
real 1x session. Each replayed event also carries motion diagnostics:
`end_speed` (wrist/ankle), `torso_speed`, `relative_speed` and
`torso_ratio` = torso speed / limb-end speed.

## Footage available

Two distinct broadcast clips, 60 fps, 1920x1020: a 6 s and a 15 s clip
(21 s in total, two fighters, a referee in about a third of the frames). A third
local file is the same footage as the 15 s clip (identical keypoints). This is
far too little for accuracy figures, and both clips come from one fight and one
camera setup. No videos were downloaded.

## Results so far

### Agreement with the offline pipeline (evidence kind 2)

| Clip | Analysed rate | Live events | Matched offline (same stream, within 2/60 s) | Live only | Offline only |
|---|---|---|---|---|---|
| 6 s | 60 /s (0.1x) | 23 | 19 of 25 | 4 | 6 |
| 6 s | 30 /s (1x) | 18 | 4 of 25 | 14 | 21 |
| 15 s | 60 /s | 55 | 39 of 55 | 16 | 16 |
| 15 s | 30 /s (1x) | 39 | 10 of 55 | 29 | 45 |

**At normal speed (about 30 analysed frames per second) live events mostly are
not the offline candidates.** Most live events at 30 /s are more than 0.25 s
from any offline candidate of the same limb, so they are different detections,
not shifted ones. Of the offline candidates missed at 30 /s, most were lost
because a different peak won within 0.25 s (22) or the speed was below the
live threshold (25). The offline rules are defined on single-frame speeds at
60 fps; at 30 /s each speed spans two frames and the local maxima change.
Making the smoothing window span the same video time as offline was tried and
did not help (4 → 5 and 10 → 9 matches), so it was not adopted.

The 7 of 18 events in the first second at 30 /s also reflect the threshold
warm-up: until 60 smoothed samples exist per stream (2 s at 30 /s) the bar is
only the 400 px/s floor, while offline uses the 90th percentile of the whole
video.

### A model-assisted look at what the events are (not ground truth)

To find failure modes, all 23 events of the 6 s clip at 60 /s were rendered as
strips of crops (peak −8, −4, 0, +4, +8 frames) and looked at by the AI
assistant that did this work. **This is one non-independent opinion from
low-resolution stills, not ground truth, and no accuracy number is derived from
it.** It is recorded because it shows *kinds* of error worth labelling:

| Pattern | Events | Notes |
|---|---|---|
| Plausible strike-like movement | about 3 clear (#2, #3, #9), about 6 uncertain | Red right hands with large extension and angle gain |
| Footwork reported as kick-like | #1, #6, #10, #14, #18, #20 | a stepping ankle; extension gains 0.01-0.19 |
| Walking with the guard up, hand repositioning, reported as punch-like | #11, #12, #13, #15, #16, #19 | extension gains 0.01-0.2 |
| Landing or retraction of a real kick | #8 | the peak is the leg coming down |
| Arm swing during a kick reported as punch-like | #5 | wrong limb |
| Body or camera movement | #21, and high torso ratios generally | broadcast camera pans and zooms |
| Keypoint error under occlusion | #14 | an ankle placed on the other fighter's back |

In the browser at 1x the dashboard showed Red with 9 strike-like events
(6 kick-like) in 2.5 s of mostly walking forward.

Not observed on this footage, so not tested on real video: tracker ID switches
between the fighters (IDs 1 and 2 were stable throughout), the referee taken as
a fighter, clinches, full overlap, side kicks, uppercuts. The synthetic identity
tests cover swaps and re-association.

### One kick, several events (fixed 2026-11-17: cross-leg kick duplicates)

The 15 s clip contains one clearly visible kick: Red's low kick at about
10.85-11.4 s (chamber, extension at 11.10-11.20 s, leg back down by 11.6 s),
checked frame by frame by the assistant (not ground truth). Before this change
it produced:

| Detector | Kick-like events for that one kick |
|---|---|
| offline | right 11.02 (Low), left 11.23 (Review), left 11.62 (Strong) |
| live replay, 60 /s | right 11.02 |
| live replay, 30 /s (1x) | left 11.10, right 11.33 |

Duplicates were removed only within one limb, so the kicking leg and the
pivoting standing leg each counted as a kick. A fighter cannot kick with both
legs within 0.35 s, so **kick-like candidates of one fighter on opposite legs
within `DUPLICATE_GAP_SECONDS` (0.35 s, the existing duplicate gap) are now one
movement, and the stronger is kept** (`refine_strikes.py`
`CROSS_LEG_KICK_DUPLICATES`, mirrored by the live detector, which already holds
each candidate long enough for a rival on the other leg to form, so it stays
causal and never withdraws an emitted event). Punches are not merged: a 1-2 is
two strikes about 0.2 s apart.

Effect, live detector replayed over the cached keypoints (events before → after):

| Clip | 60 /s | 30 /s (1x) | Kick-like at 1x |
|---|---|---|---|
| 6 s | 23 → 21 | 18 → 14 | |
| 15 s | 55 → 49 | 39 → 31 | 23 → 15 |

The real kick is still reported (once). Every removed event was a kick-like
event within 0.35 s of a kick-like event on the other leg. **Not fixed:** the
landing step after a kick can still be a second kick-like event (offline
11.62 s, "Strong"), and the arm swing during a kick can be a punch-like event.
Synthetic regression tests: `tests/test_live_cross_leg.py`,
`tests/test_offline_refine.py`. Compare with the old rule:
`python -m live.replay detect ... --per-limb-duplicates`.

### Rejected: requiring the foot to lift for a kick

Footwork reported as kick-like is the most frequent pattern seen. A gate
"the kicking foot must rise above the standing foot" was measured before being
adopted, and rejected:

* in all 21 s of footage the foot never rises more than 0.41 torso lengths
  above the other foot; the largest value (Red, 4.78 s) is a step in stance,
  seen from the elevated broadcast camera;
* the real low kick above peaks at 0.27, inside the range of ordinary steps
  (per-foot medians from −0.14 to +0.13, by stance and perspective).

Any lift threshold that removed the footwork would also remove the one real
kick. Low kicks, which are common in MMA, need a different signal, to be
chosen with labelled data.

### Speed reference: an option, not the default

Limb speed is measured in image pixels, as in the offline pipeline, so a step,
footwork or a camera pan counts as limb speed. `Detector(speed_reference="torso")`
measures wrist/ankle speed relative to the fighter's own torso centre instead
(mean of the confident shoulders and hips; no speed when the torso is not
visible). Synthetic tests show it removes steps with a drifting guard and camera
pans while keeping every punch, including punches thrown while stepping.

On the 6 s clip at 60 /s it reduced events from 23 to 17. Against the
assistant's look above it dropped 8 likely false positives, but also one
plausible strike (#9), kept all four footwork kicks (a stepping foot moves
relative to the torso as well), and added 6 events not reviewed. At 30 /s it
did not reduce the count (19 vs 18 and 39 vs 39). Agreement with offline
falls, as expected, because offline uses image speed.

**The default stays `image`.** The evidence does not show torso speed is
better, and changing it would also make live events diverge from the
authoritative offline candidates. Decide with labelled data:
`python -m live.replay detect ... --speed-reference torso` and review both.

## Limitations of pose-only detection

* Pose keypoints cannot tell a feint from a committed strike, a strike that
  lands from one that misses, or a parry from a punch.
* Kick-like detection is driven by ankle speed and leg extension, which a step
  also produces; the gates (extension gain > 0, angle gain ≥ −5°) are loose.
* Broadcast camera pans and zooms move every keypoint. Torso-relative speed
  removes a pan, not a zoom.
* Occlusion and overlap misplace keypoints; the detector keeps confidence ≥ 0.85
  on the limb at the peak but a confidently wrong keypoint passes.
* Scores rank each candidate against the earlier ones on the same limb; the
  first four per limb are unscored warm-up, so short clips are mostly unscored.

## What to do next

1. Label at least 10 minutes of varied footage (several fights, cameras,
   distances) with `review.html`, ideally two reviewers on part of it to measure
   their agreement.
2. Put the complete review of each clip in `validation/datasets/<clip>/truth.json`,
   and the offline candidates, live events at 1x and replays
   (`--speed-reference torso`, `--per-limb-duplicates`) in its `detections/`,
   then run `python -m evaluation.score dataset validation/datasets`.
3. Only then change detector rules, one at a time, each justified by the
   labelled numbers, and say in the docs what changed.
