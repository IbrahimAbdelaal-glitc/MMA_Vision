# Labelling guide: ground truth for MMA Vision

Ground truth is what a person sees in the video. It is the only thing that can
measure MMA Vision's accuracy, so it must be labelled by watching the footage,
never copied from a detector's output. This guide keeps labels consistent
between clips and between reviewers. Change a rule only before labelling
starts, or relabel what was done under the old rule.

## What is being labelled

A **strike-like movement**: a committed attempt by one fighter to hit the
other, whether or not it lands. MMA Vision never claims contact, so contact is
not part of the label.

| Label | Includes |
|---|---|
| Punch-like | jab, cross, hook, uppercut, overhand, backfist (spinning too) |
| Kick-like | any kick with the foot or shin, at any height: round, front, push (teep), side, spinning, oblique |

**Not strikes** (mark False positive, never add as missed): steps, footwork,
stance switches, guard adjustments, a hand pawing or measuring distance
without trying to hit, a feint that clearly does not commit, takedown
attempts and grappling, the referee.

**Uncertain** (the Uncertain verdict, never added as missed):

* knees and elbows, always (decided 2026-11-17): MMA Vision has no type for
  them, so they count neither for nor against a detector. Do not add them as
  missed strikes. If a rule for them is ever added, relabel these moments;
* a strike you cannot see well enough: occluded, cut by an edit, motion blur,
  inside a clinch;
* a feint you cannot tell from a committed strike.

An Uncertain row becomes an *ignore zone*: detections there count neither for
nor against a detector.

## Before you start

* **Which fighter is Blue.** Blue and Red are the labels MMA Vision gives the
  two tracked people, not necessarily the real corners. Watch the clip's
  `<clip>_identity_reference.mp4`: the person in the blue box (BLUE CORNER) is
  Blue. If you swap them, every event scores as wrong.
* Open `evaluation\review.html` (double-click it; it needs no server and no
  network). Choose the clip's video, `<clip>.mp4`, and its `review_list.csv`.
* The review list holds every detector's events for the clip in one list, in
  time order, without saying which detector found which event. Leave it that
  way: knowing the source invites favouring one detector.

## For each row

Play the window [W] or step frame by frame [← →], then give exactly one verdict:

| Verdict | When | Also set |
|---|---|---|
| Correct [1] | A real strike by this fighter, of this type, near this time | True peak [T] at full extension: fist or foot farthest out |
| Wrong type [2] | A real strike by this fighter, of the other type | Actual = Punch-like or Kick-like (never Other or Uncertain: those make an ignore zone, not a strike) |
| False positive [3] | No strike by this fighter here | A note, for example `step`, `guard`, `feint`, `referee` |
| Duplicate [4] | A real strike that another row already covers | Nothing |
| Uncertain [5] | You cannot tell (see above) | A note saying why |

Rules that keep the truth right:

* **One strike, one counted row.** Exactly one row per real strike gets
  Correct or Wrong type, and every other row for the same strike is Duplicate,
  even when it has the other type or the other side. Two counted rows for one
  strike put it in the truth twice and make every detector look worse.
* **Wrong fighter.** If the strike is real but thrown by the other fighter,
  mark False positive and add the strike as missed for the right fighter
  (unless another row already covers it).
* **Combinations.** Each strike of a 1-2 or 1-2-3 is its own strike.
* Every row needs a verdict: a review with any unreviewed row is refused as
  ground truth.

## Missed strikes

After the rows, watch the **whole** clip at 0.25x or 0.5x. For every real
strike that no row counts as Correct or Wrong type, pause at full extension
and add a missed event [M] with its fighter and type. Then tick
*I searched the whole video for missed events*. Without the tick there is no
recall, and the review is not accepted as ground truth.

## Saving

Export JSON:

* the first full review of a clip: `validation\datasets\<clip>\truth.json`;
* any further reviewer: `validation\datasets\<clip>\reviews\<name>.json`,
  for agreement between reviewers.

Labels also autosave in that browser, but only the export counts.

## Scoring

```powershell
python -m evaluation.score dataset validation\datasets --out validation\report.json
```

Below 100 reviewed detections and 10 minutes of video, the report says
accuracy is not yet established. The two local clips together are 21 s.

## Adding a clip

```powershell
python -m evaluation.score init --video C:\path\to\clip.mp4 --name <clip> --copy
# then put event lists in validation\datasets\<clip>\detections\ (see docs\validation.md)
python -m evaluation.score review-list validation\datasets\<clip>
```

Fill in the manifest's `source` and `rights`: where the footage comes from,
and that you may use it. Footage and labels stay in `validation\`, which git
ignores.
