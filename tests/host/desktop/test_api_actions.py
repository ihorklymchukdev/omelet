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


def test_uninstall_removes_the_vm_directory_but_keeps_downloads(tmp_path):
    """Purge is the app's second level: without it the cached image and the
    managed runtime survive, because they are disk space rather than state
    and re-downloading them costs hundreds of megabytes."""
    root = tmp_path / "omelet"
    install_dir = root / "vm"
    install_dir.mkdir(parents=True)
    (install_dir / "disk.vhdx").write_text("x")
    (root / "cache").mkdir()
    (root / "cache" / "ubuntu.wsl").write_text("x")
    (root / "lima").mkdir()
    (root / "install-state.json").write_text('{"completed": ["preflight"]}')

    destroyed = []

    class Provider:
        def destroy(self):
            destroyed.append(True)

    events = []
    api = DesktopApi(Provider(), InstallState(tmp_path / "s.json"),
                     push=events.append, probe_fn=lambda p: Readiness(),
                     install_dir_factory=lambda: install_dir)
    api.start_uninstall(False)
    api.jobs.join(timeout=5)

    # The job must have finished, not crashed: JobRegistry swallows worker
    # exceptions into a `crashed` event, so asserting only on side effects
    # would pass against a job that died halfway.
    assert events[-1]["type"] == "done", events
    assert destroyed == [True]
    assert not install_dir.exists()
    assert not (root / "install-state.json").exists()
    assert (root / "cache" / "ubuntu.wsl").exists()
    assert (root / "lima").exists()


def test_purge_also_removes_the_downloads(tmp_path):
    root = tmp_path / "omelet"
    install_dir = root / "vm"
    install_dir.mkdir(parents=True)
    (root / "cache").mkdir()
    (root / "cache" / "ubuntu.wsl").write_text("x")
    (root / "lima").mkdir()

    class Provider:
        def destroy(self):
            pass

    events = []
    api = DesktopApi(Provider(), InstallState(tmp_path / "s.json"),
                     push=events.append, probe_fn=lambda p: Readiness(),
                     install_dir_factory=lambda: install_dir)
    api.start_uninstall(True)
    api.jobs.join(timeout=5)

    assert events[-1]["type"] == "done", events
    assert not (root / "cache").exists()
    assert not (root / "lima").exists()


def test_uninstall_touches_nothing_outside_the_injected_directory(tmp_path, monkeypatch):
    """A regression here deletes a real user's VM when the suite runs."""
    def explode():
        raise AssertionError("uninstall resolved the real install directory")

    monkeypatch.setattr("host.providers.default_install_dir", explode)

    root = tmp_path / "omelet"
    (root / "vm").mkdir(parents=True)

    class Provider:
        def destroy(self):
            pass

    events = []
    api = DesktopApi(Provider(), InstallState(tmp_path / "s.json"),
                     push=events.append, probe_fn=lambda p: Readiness(),
                     install_dir_factory=lambda: root / "vm")
    api.start_uninstall(True)
    api.jobs.join(timeout=5)
    assert events[-1]["type"] == "done", events
