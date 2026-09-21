"""The remaining buttons, and the one that deletes things."""
from __future__ import annotations

from host.core.install import InstallState
from host.core.provider import CheckResult, Diagnosis
from host.core.status import Readiness
from host.desktop.api import DesktopApi


class FakeProvider:
    def __init__(self):
        self.started = self.stopped = False
        self.destroyed_with = None

    def preflight(self):
        return Diagnosis([CheckResult("Virtualization enabled", True),
                          CheckResult("WSL2 installed", False,
                                      fix="Run: wsl --install")])

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True


def _api(tmp_path, provider, pushed=None):
    return DesktopApi(provider, InstallState(tmp_path / "s.json"),
                      push=(pushed.append if pushed is not None else lambda e: None),
                      probe_fn=lambda p: Readiness())


def test_doctor_renders_the_diagnosis_for_the_log_pane(tmp_path):
    report = _api(tmp_path, FakeProvider()).doctor()
    assert report["ok"] is False
    assert "wsl --install" in report["text"]


def test_restart_stops_before_it_starts(tmp_path):
    order = []

    class Recording(FakeProvider):
        def stop(self): order.append("stop")
        def start(self): order.append("start")

    provider = Recording()
    api = _api(tmp_path, provider)
    api.restart_vm()
    api.jobs.join(timeout=5)
    assert order == ["stop", "start"]


def test_stopping_the_kitchen_is_a_job_not_a_blocking_call(tmp_path):
    # provider.stop() shells wsl.exe/limactl and takes seconds; running it on
    # the thread that owns the window freezes the app mid-click.
    provider = FakeProvider()
    api = _api(tmp_path, provider)
    assert "job" in api.stop_vm()
    api.jobs.join(timeout=5)
    assert provider.stopped is True


def test_uninstall_does_not_purge_unless_asked(tmp_path):
    seen = {}

    class Uninstallable(FakeProvider):
        def destroy(self):
            seen["destroyed"] = True

    api = _api(tmp_path, Uninstallable())
    api.start_uninstall(False)
    api.jobs.join(timeout=5)
    assert seen.get("destroyed") is True
    assert seen.get("purged") is not True
