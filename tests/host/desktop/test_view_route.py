"""Which screen a probe result opens.

`probe()` returns early at every stage, so each Readiness shape below is
exactly one `return` in host/core/status.py. The rows are mutually exclusive;
getting one wrong shows the user a screen whose words are false.
"""
from __future__ import annotations

from host.core.status import Readiness
from host.desktop.view import route_for


def test_provider_that_could_not_be_asked_is_not_not_installed():
    # `provider.exists()` threw -- no limactl on PATH. vm_exists is False, the
    # same shape as "no VM yet", but telling this user to press "Set up the
    # kitchen" sends them at a setup that cannot run.
    assert route_for(Readiness(problem="limactl not found")) == ("home", "wrong")


def test_no_vm_is_not_installed():
    assert route_for(Readiness()) == ("home", "not_installed")


def test_vm_present_but_exec_threw_is_wrong_not_stopped():
    assert route_for(Readiness(vm_exists=True, problem="wsl.exe: access denied")) \
        == ("home", "wrong")


def test_vm_present_and_quiet_is_stopped():
    assert route_for(Readiness(vm_exists=True)) == ("home", "stopped")


def test_reachable_without_engine_is_wrong():
    assert route_for(Readiness(vm_exists=True, vm_reachable=True)) == ("home", "wrong")


def test_agent_refused_is_the_only_unreachable():
    # The one state where the board's copy is literally true: the VM answers
    # `true`, the engine marker is there, and only /health is silent.
    readiness = Readiness(vm_exists=True, vm_reachable=True,
                          engine_version="engine-v0.1.0",
                          problem="connection refused")
    assert route_for(readiness) == ("unreachable", "")


def test_unsupported_api_is_wrong_not_unreachable():
    readiness = Readiness(vm_exists=True, vm_reachable=True,
                          engine_version="engine-v9.0.0", agent_api=99)
    assert route_for(readiness) == ("home", "wrong")


def test_ready_is_running():
    readiness = Readiness(vm_exists=True, vm_reachable=True,
                          engine_version="engine-v0.1.0", agent_api=1)
    assert route_for(readiness) == ("home", "running")
