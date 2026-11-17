"""Metrics from a reviewer's annotations (evaluation/review.html export)."""
import json

import pytest

from evaluation.metrics import MIN_EVENTS_FOR_CLAIMS, MIN_MINUTES_FOR_CLAIMS, compute, load


def ev(i, t, fighter="blue", type_="punch-like", verdict="correct", actual=None, true_t=None):
    return {"id": i, "t": t, "fighter": fighter, "side": "right", "type": type_, "verdict": verdict,
            "actual": actual, "true_t": true_t, "notes": ""}


def review(events, missed=(), duration=60.0, complete=True):
    return {"schema": "mma-vision-review/1", "video": {"name": "clip.mp4", "size": 1, "duration": duration},
            "source": {"name": "events.csv", "kind": "live"}, "reviewer": "test",
            "missed_events_complete": complete, "events": list(events), "missed": list(missed)}


def test_precision_recall_f1_and_false_positives_per_minute():
    data = review([ev(1, 1.0), ev(2, 2.0), ev(3, 3.0, verdict="false_positive", actual="other"),
                   ev(4, 4.0, verdict="uncertain")],
                  missed=[{"t": 5.0, "fighter": "red", "type": "kick-like", "notes": ""}], duration=120.0)
    m = compute(data)["overall"]
    assert m["correct"] == 2 and m["false_positives"] == 1 and m["uncertain"] == 1 and m["missed"] == 1
    assert m["precision"] == pytest.approx(2 / 3)
    assert m["recall"] == pytest.approx(2 / 3)
    assert m["f1"] == pytest.approx(2 / 3)
    assert m["false_positives_per_minute"] == pytest.approx(1 / 2)


def test_duplicates_lower_precision_and_are_counted_separately():
    m = compute(review([ev(1, 1.0), ev(2, 1.2, verdict="duplicate")]))["overall"]
    assert m["duplicates"] == 1
    assert m["precision"] == pytest.approx(1 / 2)
    assert m["recall"] == pytest.approx(1.0)


def test_wrong_type_is_a_false_detection_for_its_type_and_a_miss_for_the_real_one():
    data = review([ev(1, 1.0, type_="kick-like", verdict="wrong_type", actual="punch-like")])
    r = compute(data)
    assert r["overall"]["precision"] == 0.0 and r["overall"]["recall"] == 0.0
    assert r["overall"]["wrong_type"] == 1
    assert r["by_type"]["kick-like"]["false_positives"] == 0 and r["by_type"]["kick-like"]["wrong_type"] == 1
    assert r["by_type"]["punch-like"]["missed"] == 1
    # Any strike-like movement, type ignored: it was one.
    assert r["type_agnostic"]["precision"] == 1.0


def test_unreviewed_and_uncertain_events_are_not_counted_either_way():
    m = compute(review([ev(1, 1.0), ev(2, 2.0, verdict="unreviewed"), ev(3, 3.0, verdict="uncertain")]))["overall"]
    assert m["precision"] == 1.0
    assert m["unreviewed"] == 1 and m["uncertain"] == 1


def test_recall_is_withheld_when_missed_events_were_not_searched_for():
    m = compute(review([ev(1, 1.0)], complete=False))["overall"]
    assert m["recall"] is None and m["f1"] is None
    assert m["precision"] == 1.0


def test_timestamp_error_from_reviewer_corrected_peaks():
    m = compute(review([ev(1, 1.0, true_t=0.95), ev(2, 2.0, true_t=2.0), ev(3, 3.0)]))["overall"]
    te = m["timestamp_error"]
    assert te["n"] == 2
    assert te["mean_signed_s"] == pytest.approx(0.025)
    assert te["mean_abs_s"] == pytest.approx(0.025)
    assert te["max_abs_s"] == pytest.approx(0.05)


def test_per_fighter_and_per_type_breakdowns():
    data = review([ev(1, 1.0, fighter="blue"), ev(2, 2.0, fighter="red", verdict="false_positive", actual="other"),
                   ev(3, 3.0, fighter="red", type_="kick-like")],
                  missed=[{"t": 4.0, "fighter": "blue", "type": "kick-like", "notes": ""}])
    r = compute(data)
    assert r["by_fighter"]["blue"]["correct"] == 1 and r["by_fighter"]["blue"]["missed"] == 1
    assert r["by_fighter"]["red"]["precision"] == pytest.approx(1 / 2)
    assert r["by_type"]["kick-like"]["correct"] == 1 and r["by_type"]["kick-like"]["missed"] == 1


def test_no_claim_without_enough_labelled_data():
    small = compute(review([ev(1, 1.0)], duration=30.0))
    assert small["sufficient_for_claims"] is False
    assert "not yet established" in small["verdict"]
    many = [ev(i, float(i)) for i in range(MIN_EVENTS_FOR_CLAIMS)]
    big = compute(review(many, duration=MIN_MINUTES_FOR_CLAIMS * 60))
    assert big["sufficient_for_claims"] is True


def test_several_reviews_combine(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps(review([ev(1, 1.0)], duration=60)), encoding="utf-8")
    b.write_text(json.dumps(review([ev(1, 1.0, verdict="false_positive", actual="other")], duration=60)),
                 encoding="utf-8")
    r = compute(load([a, b]))
    assert r["overall"]["correct"] == 1 and r["overall"]["false_positives"] == 1
    assert r["reviewed_minutes"] == pytest.approx(2.0)
    assert r["videos"] == 2


def test_csv_export_reads_the_same_as_json(tmp_path):
    path = tmp_path / "r.csv"
    path.write_text(
        "# video=clip.mp4;size=1;duration=60;source=events.csv;missed_events_complete=true\n"
        "row_kind,id,t,fighter,side,type,verdict,actual,true_t,notes\n"
        "detected,1,1.0,blue,right,punch-like,correct,punch-like,0.98,\n"
        "detected,2,2.0,red,left,kick-like,false_positive,other,,step\n"
        "missed,,3.0,red,,punch-like,,,,\n",
        encoding="utf-8")
    m = compute(load([path]))["overall"]
    assert (m["correct"], m["false_positives"], m["missed"]) == (1, 1, 1)
    assert m["timestamp_error"]["n"] == 1


def test_unknown_verdicts_are_refused():
    with pytest.raises(ValueError):
        compute(review([ev(1, 1.0, verdict="landed")]))
