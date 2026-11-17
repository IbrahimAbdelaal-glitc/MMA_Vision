"""Design 9: identity continuity, gated re-association, ties, swap."""

import itertools

from helpers import ROOT  # noqa: F401
from live.identity import IdentityTracker, Person

DIAG = 1000.0


def person(track_id, x, y, w=100, h=200):
    return Person(track_id, (x - w / 2, y - h / 2, x + w / 2, y + h / 2), [[0, 0, 0.9]] * 17)


def tracker():
    return IdentityTracker(DIAG)


def seeded():
    tr = tracker()
    tr.update(0, 0.0, [person(1, 300, 500), person(2, 700, 500)])
    return tr


def test_seeding_follows_tracker_ids_one_and_two():
    tr = tracker()
    r = tr.update(0, 0.0, [person(2, 700, 500)])
    assert r.states == {"blue": "lost", "red": "tracked"}
    r = tr.update(1, 1 / 60, [person(1, 300, 500), person(2, 700, 500)])
    assert r.states == {"blue": "tracked", "red": "tracked"}
    assert [e["kind"] for e in r.log] == ["seeded"]


def test_continuity_on_the_same_id():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(1, 900, 500), person(2, 100, 500)])
    assert r.persons["blue"].track_id == 1  # IDs, not positions, decide continuity


def test_reassociation_inside_both_gates():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(7, 310, 500), person(2, 700, 500)])
    assert r.states["blue"] == "tracked"
    assert r.persons["blue"].track_id == 7
    entry = [e for e in r.log if e["kind"] == "re-association"][0]
    assert entry["corner"] == "blue" and entry["margin"] is None


def test_rejection_outside_the_distance_gate():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(7, 400, 500), person(2, 700, 500)])
    assert r.states["blue"] == "uncertain"


def test_rejection_outside_the_size_gate():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(7, 300, 500, w=200, h=200), person(2, 700, 500)])
    assert r.states["blue"] == "uncertain"


def test_gate_grows_with_time_since_last_seen():
    tr = seeded()
    tr.update(1, 1 / 60, [person(2, 700, 500)])      # blue lost for a while
    r = tr.update(30, 0.5, [person(7, 400, 500), person(2, 700, 500)])
    assert r.states["blue"] == "tracked"             # 0.1 of the diagonal allowed after 0.5 s


def test_margin_failure_and_exact_tie_are_uncertain():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(7, 305, 500), person(8, 295, 500), person(2, 700, 500)])
    assert r.states["blue"] == "uncertain"
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(7, 300, 505), person(8, 300, 495), person(2, 700, 500)])
    assert r.states["blue"] == "uncertain"


def test_lost_when_no_unassigned_person():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(2, 700, 500)])
    assert r.states["blue"] == "lost"
    assert r.log[-1]["kind"] == "lost"


def test_two_open_corners_are_assigned_together():
    tr = seeded()
    r = tr.update(1, 1 / 60, [person(9, 702, 500), person(8, 302, 500)])
    assert r.persons["blue"].track_id == 8
    assert r.persons["red"].track_id == 9


def test_candidate_eligible_for_both_corners_leaves_both_uncertain():
    tr = tracker()
    tr.update(0, 0.0, [person(1, 480, 500), person(2, 520, 500)])
    r = tr.update(1, 1 / 60, [person(9, 500, 500)])
    assert r.states == {"blue": "uncertain", "red": "uncertain"}


def test_outcome_does_not_depend_on_input_order():
    people = [person(9, 702, 500), person(8, 302, 500), person(5, 900, 100)]
    outcomes = set()
    for order in itertools.permutations(people):
        tr = seeded()
        r = tr.update(1, 1 / 60, list(order))
        outcomes.add(tuple((c, r.states[c], r.persons[c] and r.persons[c].track_id) for c in ("blue", "red")))
    assert len(outcomes) == 1


def test_swap_exchanges_the_corners():
    tr = seeded()
    entry = tr.swap(1, 1 / 60)
    assert entry["kind"] == "swap"
    r = tr.update(2, 2 / 60, [person(1, 300, 500), person(2, 700, 500)])
    assert r.persons["blue"].track_id == 2
    assert r.persons["red"].track_id == 1
