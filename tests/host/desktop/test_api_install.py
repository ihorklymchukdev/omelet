"""The install job as the bridge runs it."""
from __future__ import annotations

import threading

from host.core.install import InstallError, InstallState, Step
from host.core.status import Readiness
from host.desktop.api import DesktopApi


class FakeProvider:
    pass


def _api(tmp_path, steps, pushed):
    return DesktopApi(FakeProvider(), InstallState(tmp_path / "s.json"),
                      push=pushed.append,
                      probe_fn=lambda provider: Readiness(),
                      steps_factory=lambda: steps)


def _drain(api):
    api.jobs.join(timeout=5)


def test_start_install_hands_back_the_rows_to_draw(tmp_path):
    steps = [Step("preflight", lambda: None), Step("finish", lambda: None)]
    started = _api(tmp_path, steps, []).start_install()
    assert [r["name"] for r in started["rows"]] == ["preflight", "finish"]
    assert "job" in started


def test_a_successful_install_ends_in_done(tmp_path):
    pushed = []
    api = _api(tmp_path, [Step("preflight", lambda: None)], pushed)
    api.start_install()
    _drain(api)
    assert pushed[-1]["type"] == "done"
    assert [e["type"] for e in pushed if e["type"] == "step"]


def test_a_failing_step_ends_in_failed_carrying_its_action(tmp_path):
    def boom():
        raise RuntimeError("connection reset")

    pushed = []
    api = _api(tmp_path, [Step("fetch_image", boom, action="Try again later.")], pushed)
    api.start_install()
    _drain(api)

    assert pushed[-1]["type"] == "failed"
    assert pushed[-1]["action"] == "Try again later."


def test_the_steps_factory_is_called_per_run_not_once(tmp_path):
    # The steps close over provider state -- provider.rootfs is assigned while
    # the list is built -- so a second run against the first run's list would
    # install against stale bindings.
    calls = []

    def factory():
        calls.append(1)
        return [Step("preflight", lambda: None)]

    api = DesktopApi(FakeProvider(), InstallState(tmp_path / "s.json"),
                     push=lambda e: None, probe_fn=lambda p: Readiness(),
                     steps_factory=factory)
    api.start_install()
    _drain(api)
    api.start_install()
    _drain(api)
    assert len(calls) == 2


def test_resume_is_registered_before_the_machine_goes_down(tmp_path):
    """A reboot fired before RunOnce is written never comes back to setup."""
    order = []

    class RebootingProvider:
        def register_resume(self, exe_path):
            order.append("register")

        def reboot(self):
            order.append("reboot")

    api = DesktopApi(RebootingProvider(), InstallState(tmp_path / "s.json"),
                     push=lambda e: None, probe_fn=lambda p: Readiness(),
                     steps_factory=lambda: [])
    api.reboot_now()

    assert order == ["register", "reboot"]
