"""The ports bridge's failure shapes.

These methods are called from JavaScript, where an uncaught exception
rejects the promise and the UI's `result.ok` branch never runs -- the user's
click does nothing, with no message. Every failure must come back as a dict.
"""
from __future__ import annotations

from host.core import constants
from host.core.install import InstallState
from host.core.status import Readiness
from host.desktop.api import DesktopApi


class FakeProvider:
    def __init__(self, *, existing=(), fail=None):
        self.existing = list(existing)
        self.fail = fail
        self.forwarded = []
        self.unforwarded = []

    def forwards(self):
        return list(self.existing)

    def forward(self, guest, host_port):
        if self.fail:
            raise self.fail
        self.forwarded.append((guest, host_port))

    def unforward(self, guest, host_port):
        if self.fail:
            raise self.fail
        self.unforwarded.append((guest, host_port))


def _api(tmp_path, provider):
    return DesktopApi(provider, InstallState(tmp_path / "s.json"),
                      push=lambda event: None,
                      probe_fn=lambda p: Readiness())


def test_a_good_pair_is_forwarded(tmp_path):
    provider = FakeProvider()
    assert _api(tmp_path, provider).add_port(3000, 3000) == {"ok": True}
    assert provider.forwarded == [(3000, 3000)]


def test_a_declined_permission_prompt_comes_back_as_a_dict(tmp_path):
    """Not as a raised exception: that rejects the JS promise and the user's
    click silently does nothing."""
    provider = FakeProvider(fail=RuntimeError("netsh: access is denied"))
    result = _api(tmp_path, provider).add_port(3000, 3000)
    assert result["ok"] is False
    assert result["reason"] == "refused"
    assert "access is denied" in result["message"]


def test_a_refused_removal_comes_back_as_a_dict(tmp_path):
    provider = FakeProvider(fail=RuntimeError("netsh: access is denied"))
    result = _api(tmp_path, provider).remove_port(3000, 3000)
    assert result["ok"] is False and result["reason"] == "refused"


def test_a_non_numeric_port_never_reaches_the_provider(tmp_path):
    provider = FakeProvider()
    result = _api(tmp_path, provider).add_port("80; rm -rf /", 3000)
    assert result["ok"] is False
    assert provider.forwarded == []


def test_the_agent_port_is_refused_before_anything_is_forwarded(tmp_path):
    provider = FakeProvider()
    result = _api(tmp_path, provider).add_port(1234, constants.API_PORT)
    assert result == {"ok": False, "reason": "reserved"}
    assert provider.forwarded == []


def test_list_ports_reports_the_providers_table(tmp_path):
    provider = FakeProvider(existing=[(3000, 3000), (5432, 5432)])
    listed = _api(tmp_path, provider).list_ports()
    assert listed == {"ports": [{"guest": 3000, "host": 3000},
                                {"guest": 5432, "host": 5432}]}
