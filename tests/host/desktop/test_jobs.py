"""The worker-thread registry behind every slow button.

Two things here can lose data rather than merely misbehave: a progress
coalescer that drops the *last* event (leaving a bar stuck at 96% forever),
and a second job starting while the first is mid-write of install-state.json.
"""
from __future__ import annotations

import pytest

from host.desktop.jobs import JobBusy, JobRegistry


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_progress_events_are_coalesced_but_terminal_events_are_not():
    clock, pushed = FakeClock(), []
    jobs = JobRegistry(pushed.append, clock=clock, min_interval=1.0)

    def work(emit):
        for percent in (10, 20, 30):
            emit({"type": "progress", "percent": percent})
        return {"type": "done"}

    jobs.start("install", work)
    jobs.join(timeout=5)

    kinds = [e["type"] for e in pushed]
    # Three progress events inside one interval collapse to the first;
    # the terminal event is never held back.
    assert kinds == ["progress", "done"]
    assert pushed[0]["percent"] == 10


def test_a_later_progress_event_passes_once_the_interval_elapses():
    clock, pushed = FakeClock(), []
    jobs = JobRegistry(pushed.append, clock=clock, min_interval=1.0)

    def work(emit):
        emit({"type": "progress", "percent": 10})
        clock.now += 2.0
        emit({"type": "progress", "percent": 90})
        return {"type": "done"}

    jobs.start("import", work)
    jobs.join(timeout=5)

    assert [e.get("percent") for e in pushed if e["type"] == "progress"] == [10, 90]


def test_every_event_carries_its_job_id_and_kind():
    pushed = []
    jobs = JobRegistry(pushed.append)
    job_id = jobs.start("doctor", lambda emit: {"type": "done"})
    jobs.join(timeout=5)

    assert all(e["job"] == job_id and e["kind"] == "doctor" for e in pushed)


def test_a_second_job_is_refused_while_one_runs():
    import threading
    release = threading.Event()
    jobs = JobRegistry(lambda event: None)
    jobs.start("install", lambda emit: release.wait(5) and {"type": "done"})
    try:
        with pytest.raises(JobBusy):
            jobs.start("import", lambda emit: {"type": "done"})
    finally:
        release.set()
        jobs.join(timeout=5)


def test_a_crashing_job_reports_instead_of_dying_silently():
    pushed = []
    jobs = JobRegistry(pushed.append)

    def work(emit):
        raise RuntimeError("netsh exploded")

    jobs.start("ports", work)
    jobs.join(timeout=5)

    assert pushed[-1]["type"] == "crashed"
    assert "netsh exploded" in pushed[-1]["message"]


def test_the_registry_frees_up_after_a_crash():
    jobs = JobRegistry(lambda event: None)
    jobs.start("ports", lambda emit: (_ for _ in ()).throw(RuntimeError("boom")))
    jobs.join(timeout=5)
    # A crashed job that never released the slot would wedge the app: every
    # button afterwards would raise JobBusy until relaunch.
    jobs.start("doctor", lambda emit: {"type": "done"})
    jobs.join(timeout=5)
