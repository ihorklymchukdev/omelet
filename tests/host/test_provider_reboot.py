"""Restarting the machine from the reboot screen.

The board's "Restart now" button is new: today reboot_gate_step only raises
and the user restarts by hand. Rebooting is the one thing in this feature
that genuinely differs per platform, so it belongs in a provider.
"""
from __future__ import annotations

from host.core.provider import VmProvider
from host.providers.lima import LimaProvider
from host.providers.wsl2 import Wsl2Provider


class FakeRunner:
    def __init__(self):
        self.calls = []

    def __call__(self, argv, **kwargs):
        self.calls.append(argv)
        class Result:
            returncode = 0
            stdout = b""
            stderr = b""
        return Result()


def test_the_protocol_declares_reboot():
    assert hasattr(VmProvider, "reboot")


def test_windows_reboots_through_shutdown():
    runner = FakeRunner()
    Wsl2Provider(runner=runner).reboot()
    argv = runner.calls[-1]
    assert argv[0] == "shutdown"
    assert "/r" in argv


def test_macos_reboots_through_osascript():
    # Plain `shutdown -r` needs root; the Apple Events route prompts the user
    # the same way choosing Restart from the Apple menu does.
    runner = FakeRunner()
    LimaProvider(runner=runner).reboot()
    argv = runner.calls[-1]
    assert argv[0] == "osascript"
    assert any("restart" in part for part in argv)
