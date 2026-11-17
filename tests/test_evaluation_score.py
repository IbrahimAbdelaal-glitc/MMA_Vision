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
