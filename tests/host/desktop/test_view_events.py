"""Turning run_install's reports and exceptions into screen events.

run_install already reported a `failed` Progress for the row before it
raises, so the terminal event does not need to carry a step name -- but it
does need to distinguish the three endings, because the board offers a
different pair of buttons for each.
"""
from __future__ import annotations

from host.core.install import DeadEnd, InstallError, Progress, RebootRequired
from host.desktop.view import progress_event, terminal_event


def test_a_running_report_names_its_row():
    event = progress_event(Progress("bootstrap", "running"))
    assert event["type"] == "step"
    assert (event["step"], event["status"]) == ("bootstrap", "running")


def test_a_fraction_survives_for_the_download_bar():
    event = progress_event(Progress("fetch_image", "running", fraction=0.58))
    assert event["fraction"] == 0.58


def test_a_step_without_a_fraction_reports_none_not_zero():
    # Zero would draw an empty bar on every ordinary step.
    assert progress_event(Progress("connect", "running"))["fraction"] is None


def test_a_clean_run_is_done():
    assert terminal_event(None) == {"type": "done"}


def test_reboot_required_keeps_its_own_ending():
    # Rendering this as a failure would lose the resume path entirely: the
    # user would be offered a retry instead of a restart.
    assert terminal_event(RebootRequired())["type"] == "reboot"


def test_an_install_error_carries_the_step_s_own_next_move():
    exc = InstallError("fetch_image", "connection reset",
                       "Run setup again and the download continues.")
    event = terminal_event(exc)
    assert event["type"] == "failed"
    assert event["message"] == "connection reset"
    assert event["action"] == "Run setup again and the download continues."


def test_a_dead_end_is_not_a_retry():
    # DeadEnd is "a blocking check no code can fix". Offering "Try this step
    # again" there sends the user round a loop that cannot terminate.
    event = terminal_event(DeadEnd("Virtualization is off in the BIOS"))
    assert event["type"] == "dead_end"
    assert "BIOS" in event["message"]


def test_an_unexpected_exception_still_reaches_the_screen():
    event = terminal_event(ValueError("rootfs is required"))
    assert event["type"] == "failed"
    assert "rootfs is required" in event["message"]
