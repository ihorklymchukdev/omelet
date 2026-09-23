"""Entering the projects console inside the window."""
from __future__ import annotations

import threading

from host.core import constants
from host.core.install import InstallState
from host.core.status import Readiness
from host.desktop.api import DesktopApi

READY = Readiness(vm_exists=True, vm_reachable=True,
                  runtime_version="runtime-v0.1.0", api_version=1)
STOPPED = Readiness(vm_exists=True)


class FakeProvider:
    pass


class HandoffClient:
    def __init__(self, code=None, error=None):
        self._code, self._error = code, error

    def handoff_code(self):
        if self._error:
            raise self._error
        return self._code


def _api(tmp_path, *, readiness=READY, client=None, loaded=None):
    return DesktopApi(FakeProvider(), InstallState(tmp_path / "s.json"),
                      push=lambda event: None,
                      probe_fn=lambda provider: readiness,
                      client_factory=lambda provider: client or HandoffClient(code="abc"),
                      navigate=(loaded.append if loaded is not None else None))


def test_entering_loads_the_edge_port_with_the_handoff_code(tmp_path):
    loaded = []
    assert _api(tmp_path, loaded=loaded).enter_console() == {"ok": True}
    assert loaded == [f"http://localhost:{constants.EDGE_PORT}/#handoff=abc"]


def test_a_failed_handoff_loads_nothing(tmp_path):
    # Inside the app the console's signed-out screen says "open this from the
    # desktop app" -- a dead end for someone already in it.
    loaded = []
    client = HandoffClient(error=ConnectionRefusedError("refused"))
    result = _api(tmp_path, client=client, loaded=loaded).enter_console()
    assert result["ok"] is False
    assert "refused" in result["message"]
    assert loaded == []


def test_entering_is_refused_while_a_job_runs(tmp_path):
    loaded = []
    api = _api(tmp_path, loaded=loaded)
    release = threading.Event()
    api.jobs.start("import", lambda emit: release.wait(5) and {"type": "done"})
    try:
        assert api.enter_console()["ok"] is False
    finally:
        release.set()
        api.jobs.join(5)
    assert loaded == []


def test_a_running_machine_enters_the_console_at_launch(tmp_path):
    assert _api(tmp_path).home()["enter_console"] is True


def test_the_launch_flag_is_spent_by_the_first_home_call(tmp_path):
    # The Machine menu item reloads the local UI, which calls home() again;
    # a second True would bounce the user straight back into the console.
    api = _api(tmp_path)
    api.home()
    assert api.home()["enter_console"] is False


def test_a_stopped_machine_does_not_enter_and_still_spends_the_flag(tmp_path):
    api = _api(tmp_path, readiness=STOPPED)
    assert api.home()["enter_console"] is False
    api._probe = lambda provider: READY
    assert api.home()["enter_console"] is False


def test_a_resumed_install_never_enters_the_console(tmp_path):
    api = _api(tmp_path)
    api.resumed = True
    assert api.home()["enter_console"] is False
