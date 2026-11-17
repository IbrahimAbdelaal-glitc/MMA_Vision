"""Scoring any event list against ground truth derived from a complete review."""
import csv
import json

import pytest

from evaluation.score import (IncompleteReview, finish, load_detections, main, score, score_dataset,
                              truth_from_review)


def ev(t, fighter="blue", type_="punch-like", verdict="correct", actual=None, true_t=None):
    return {"id": "1", "t": t, "fighter": fighter, "side": "right", "type": type_, "verdict": verdict,
            "actual": actual, "true_t": true_t, "notes": ""}


def review(events, missed=(), duration=60.0, complete=True):
    return {"schema": "mma-vision-review/1", "video": {"name": "clip.mp4", "size": 1, "duration": duration},
            "source": {"name": "events.csv"}, "reviewer": "test", "missed_events_complete": complete,
            "events": list(events), "missed": list(missed)}


def det(t, fighter="blue", type_="punch-like"):
    return {"t": t, "fighter": fighter, "type": type_}


def test_truth_needs_a_review_that_searched_for_missed_events():
    with pytest.raises(IncompleteReview):
        truth_from_review(review([ev(1.0)], complete=False))


def test_truth_needs_a_verdict_on_every_event():
    # Found in the end-to-end test: a review ticked "complete" with most events
    # still unlabelled scored another detector at recall 1.0.
    with pytest.raises(IncompleteReview, match="1 event"):
        truth_from_review(review([ev(1.0), ev(2.0, verdict="unreviewed")]))


def test_truth_takes_correct_wrong_type_and_missed_and_ignores_uncertain():
    truth = truth_from_review(review([
        ev(1.0, true_t=0.95),
        ev(2.0, type_="kick-like", verdict="wrong_type", actual="punch-like"),
        ev(3.0, verdict="false_positive", actual="other"),
        ev(4.0, verdict="duplicate"),
        ev(5.0, verdict="uncertain"),
    ], missed=[{"t": 6.0, "fighter": "red", "type": "kick-like", "notes": ""}]))

    assert truth["movements"] == [
        {"t": 0.95, "fighter": "blue", "type": "punch-like"},
        {"t": 2.0, "fighter": "blue", "type": "punch-like"},
        {"t": 6.0, "fighter": "red", "type": "kick-like"},
    ]
    assert truth["ignore"] == [{"t": 5.0, "fighter": "blue"}]


def test_the_reviewed_list_scores_as_the_review_says():
    data = review([ev(1.0), ev(2.0), ev(3.0, verdict="false_positive")],
                  missed=[{"t": 5.0, "fighter": "blue", "type": "punch-like", "notes": ""}])
    counts = score([det(1.0), det(2.0), det(3.0)], truth_from_review(data))
    m = finish(counts, 1.0, 1, 0.25)["overall"]

    assert (m["correct"], m["false_positives"], m["missed"]) == (2, 1, 1)
    assert m["precision"] == pytest.approx(2 / 3)
    assert m["recall"] == pytest.approx(2 / 3)


def test_another_detector_is_scored_without_a_new_review():
    truth = truth_from_review(review([ev(1.0), ev(2.0), ev(3.0, verdict="false_positive")]))
    # Finds the movement at 1.0 (0.1 s late), misses 2.0, adds one at 8.0, and none at 3.0.
    m = finish(score([det(1.1), det(8.0)], truth), 1.0, 1, 0.25)["overall"]

    assert (m["correct"], m["false_positives"], m["missed"]) == (1, 1, 1)
    assert m["timestamp_error"]["mean_signed_s"] == pytest.approx(0.1)


def test_a_second_detection_of_one_movement_is_a_duplicate():
    truth = truth_from_review(review([ev(1.0)]))
    m = finish(score([det(1.0), det(1.2)], truth), 1.0, 1, 0.25)["overall"]

    assert (m["correct"], m["duplicates"], m["false_positives"]) == (1, 1, 0)


def test_the_nearest_detection_takes_the_movement():
    truth = truth_from_review(review([ev(1.0)]))
    counts = score([det(0.8), det(1.02)], truth)
    m = finish(counts, 1.0, 1, 0.25)["overall"]

    assert m["timestamp_error"]["mean_abs_s"] == pytest.approx(0.02)
    assert m["duplicates"] == 1


def test_wrong_type_and_wrong_fighter():
    truth = truth_from_review(review([ev(1.0, type_="kick-like"), ev(3.0, fighter="red")]))
    m = finish(score([det(1.0, type_="punch-like"), det(3.0, fighter="blue")], truth), 1.0, 1, 0.25)

    assert m["overall"]["wrong_type"] == 1
    assert m["overall"]["false_positives"] == 1        # Blue at 3.0: the movement was Red's
    assert m["by_type"]["kick-like"]["missed"] == 1
    assert m["type_agnostic"]["correct"] == 1          # the kick was found, as the wrong type


def test_detections_at_an_uncertain_moment_count_nowhere():
    truth = truth_from_review(review([ev(1.0, verdict="uncertain")]))
    m = finish(score([det(1.05)], truth), 1.0, 1, 0.25)["overall"]

    assert m["false_positives"] == 0 and m["uncertain"] == 1 and m["precision"] is None


def test_tolerance_decides_what_matches():
    truth = truth_from_review(review([ev(1.0)]))
    assert score([det(1.3)], truth, tolerance=0.25)["overall"]["false_positives"] == 1
    assert score([det(1.3)], truth, tolerance=0.35)["overall"]["correct"] == 1


def write_csv(path, header, rows):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def test_loads_live_offline_and_replay_event_lists(tmp_path):
    write_csv(tmp_path / "live.csv", ["corner", "side", "type", "peak_t"], [["blue", "right", "punch-like", "1.5"]])
    write_csv(tmp_path / "offline.csv", ["fighter", "limb", "event_type", "peak_time"],
              [["red", "left", "kick-like", "2.5"]])
    write_csv(tmp_path / "replay.csv", ["corner", "side", "type", "peak_t", "offline_match"],
              [["blue", "left", "punch-like", "3.0", "matched"], ["red", "left", "kick-like", "4.0", "offline_only"]])

    assert load_detections(tmp_path / "live.csv") == [det(1.5)]
    assert load_detections(tmp_path / "offline.csv") == [det(2.5, "red", "kick-like")]
    assert load_detections(tmp_path / "replay.csv") == [det(3.0)]   # offline-only rows are not replay events


def test_dataset_layout_scores_each_detector_over_all_clips(tmp_path):
    for name, events in (("clip1", [ev(1.0)]), ("clip2", [ev(2.0)])):
        clip = tmp_path / name
        (clip / "detections").mkdir(parents=True)
        (clip / "truth.json").write_text(json.dumps(review(events, duration=30.0)), encoding="utf-8")
        t = events[0]["t"]
        write_csv(clip / "detections" / "offline.csv", ["fighter", "limb", "event_type", "peak_time"],
                  [["blue", "right", "punch-like", str(t)]])
        write_csv(clip / "detections" / "live.csv", ["corner", "side", "type", "peak_t"],
                  [["blue", "right", "punch-like", str(t + 5)]])
    (tmp_path / "unlabelled").mkdir()

    out = score_dataset(tmp_path)

    assert out["detectors"]["offline"]["overall"]["recall"] == pytest.approx(1.0)
    assert out["detectors"]["offline"]["videos"] == 2
    assert out["detectors"]["offline"]["reviewed_minutes"] == pytest.approx(1.0)
    assert out["detectors"]["live"]["overall"]["false_positives"] == 2
    assert out["detectors"]["live"]["overall"]["missed"] == 2
    assert out["skipped"] == ["unlabelled: no truth.json"]
    assert "not yet established" in out["detectors"]["offline"]["verdict"]


def test_cli_refuses_an_incomplete_truth(tmp_path, capsys):
    (tmp_path / "truth.json").write_text(json.dumps(review([ev(1.0)], complete=False)), encoding="utf-8")
    write_csv(tmp_path / "d.csv", ["corner", "side", "type", "peak_t"], [["blue", "right", "punch-like", "1.0"]])

    assert main(["file", "--truth", str(tmp_path / "truth.json"), "--detections", str(tmp_path / "d.csv")]) == 2
    assert "Cannot score" in capsys.readouterr().err


# --------------------------------------------------------------- review list
from evaluation.score import MERGE_SECONDS, REVIEW_LIST, review_list, write_review_list  # noqa: E402

LIVE = ["corner", "side", "type", "peak_t"]
OFFLINE = ["fighter", "limb", "event_type", "peak_time"]


def rows_of(result):
    return [(r["t"], r["fighter"], r["side"], r["type"]) for r in result]


def test_one_movement_found_by_several_detectors_is_one_row(tmp_path):
    write_csv(tmp_path / "live.csv", LIVE, [["blue", "right", "punch-like", "1.00"]])
    write_csv(tmp_path / "offline.csv", OFFLINE, [["blue", "right", "punch-like", "1.10"]])

    assert rows_of(review_list([tmp_path / "live.csv", tmp_path / "offline.csv"])) == [
        (1.05, "blue", "right", "punch-like")]


def test_rows_are_never_merged_across_side_type_or_fighter(tmp_path):
    # A two-arm pair, a punch thrown with a kick, and the other fighter: all stay separate.
    write_csv(tmp_path / "a.csv", LIVE, [["blue", "right", "punch-like", "2.00"],
                                         ["blue", "left", "punch-like", "2.05"],
                                         ["blue", "right", "kick-like", "2.00"],
                                         ["red", "right", "punch-like", "2.00"]])

    assert len(review_list([tmp_path / "a.csv"])) == 4


def test_a_fast_one_two_on_one_side_stays_two_rows(tmp_path):
    write_csv(tmp_path / "a.csv", LIVE, [["blue", "right", "punch-like", "3.00"],
                                         ["blue", "right", "punch-like", "3.20"]])

    assert len(review_list([tmp_path / "a.csv"])) == 2


def test_merging_is_anchored_so_a_chain_does_not_grow_past_the_window(tmp_path):
    # 0.00, 0.10, 0.20: the third is 0.20 from the first, so a new row starts.
    write_csv(tmp_path / "a.csv", LIVE, [["red", "left", "kick-like", t] for t in ("5.00", "5.10", "5.20")])

    assert rows_of(review_list([tmp_path / "a.csv"])) == [(5.05, "red", "left", "kick-like"),
                                                         (5.2, "red", "left", "kick-like")]


def test_unmatched_offline_rows_of_a_replay_are_left_out(tmp_path):
    write_csv(tmp_path / "replay.csv", LIVE + ["offline_match"],
              [["blue", "right", "punch-like", "1.0", "matched"], ["red", "left", "kick-like", "4.0", "offline_only"]])

    assert rows_of(review_list([tmp_path / "replay.csv"])) == [(1.0, "blue", "right", "punch-like")]


def test_a_review_of_the_list_covers_every_detector(tmp_path):
    # If every row is a real movement, no detector event may count as a false
    # positive: each merged row lies within TOLERANCE of every event it stands for.
    clip = tmp_path / "clip"
    (clip / "detections").mkdir(parents=True)
    live = [["blue", "right", "punch-like", f"{1 + k * 0.7:.3f}"] for k in range(10)]
    offline = [["blue", "right", "punch-like", f"{1 + k * 0.7 + 0.14:.3f}"] for k in range(10)]
    offline.append(["red", "left", "kick-like", "9.5"])
    write_csv(clip / "detections" / "live.csv", LIVE, live)
    write_csv(clip / "detections" / "offline.csv", OFFLINE, offline)

    target, rows, files = write_review_list(clip)
    events = [{**ev(r["t"], r["fighter"], r["type"]), "side": r["side"]} for r in rows]
    (clip / "truth.json").write_text(json.dumps(review(events, duration=60.0)), encoding="utf-8")
    out = score_dataset(tmp_path)

    assert target == clip / REVIEW_LIST and not (clip / "detections" / REVIEW_LIST).exists()
    assert len(rows) == 11 and MERGE_SECONDS < 0.25
    for name in ("live", "offline"):
        overall = out["detectors"][name]["overall"]
        assert overall["false_positives"] == 0 and overall["duplicates"] == 0
    assert out["detectors"]["offline"]["overall"]["recall"] == pytest.approx(1.0)
    assert out["detectors"]["live"]["overall"]["missed"] == 1        # the kick only offline found


def test_cli_writes_the_review_list_and_refuses_an_empty_clip(tmp_path, capsys):
    clip = tmp_path / "clip"
    (clip / "detections").mkdir(parents=True)
    assert main(["review-list", str(clip)]) == 2

    write_csv(clip / "detections" / "live.csv", LIVE, [["blue", "right", "punch-like", "1.0"]])
    assert main(["review-list", str(clip)]) == 0
    assert "1 rows to review from 1 events" in capsys.readouterr().out
    with (clip / REVIEW_LIST).open(encoding="utf-8") as handle:
        assert next(csv.reader(handle)) == ["t", "fighter", "side", "type"]
