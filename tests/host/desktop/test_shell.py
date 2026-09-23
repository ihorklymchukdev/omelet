"""The bridge belongs to the local UI, not to whatever page is showing.

pywebview injects window.pywebview.api into every page the window loads,
including the console served from inside the VM, where coding agents run as
root. These pin that such a page can see the bridge and use none of it.
"""
from __future__ import annotations

import json

import pytest

from host.core.install import InstallState
from host.desktop.api import DesktopApi
from host.desktop.shell import NotLocalPage, Shell, guarded, public_methods

# pywebview serves an absolute local path through its own bottle server.
LOCAL = "http://127.0.0.1:53817/index.html"
CONSOLE = "http://localhost:39080/#handoff=abc"


class FakeWindow:
    def __init__(self, url):
        self.url = url
        self.loaded = []
        self.evaluated = []

    def get_current_url(self):
        return self.url

    def load_url(self, url):
        self.loaded.append(url)
        self.url = url

    def evaluate_js(self, script):
        self.evaluated.append(script)


class FakeProvider:
    pass


def _api(tmp_path):
    return DesktopApi(FakeProvider(), InstallState(tmp_path / "s.json"),
                      push=lambda event: None)


def test_the_page_the_window_opened_with_is_local():
    assert Shell(FakeWindow(LOCAL)).is_local() is True


def test_a_first_call_from_the_console_is_refused():
    # Nothing asked is_local() while the local UI showed; the first question
    # arrives from the console. load() must have remembered the local URL on
    # the way out, or the console would be recorded as ours.
    shell = Shell(FakeWindow(LOCAL))
    shell.load(CONSOLE)
    assert shell.is_local() is False


def test_the_fragment_does_not_make_the_local_page_foreign():
    window = FakeWindow(LOCAL)
    shell = Shell(window)
    assert shell.is_local()
    window.url = LOCAL + "#install"
    assert shell.is_local() is True


def test_load_local_returns_to_the_original_page_not_the_console():
    window = FakeWindow(LOCAL)
    shell = Shell(window)
    shell.load(CONSOLE)
    shell.load_local()
    assert window.url == LOCAL
    assert shell.is_local() is True


def test_events_reach_the_local_page_as_one_json_argument():
    window = FakeWindow(LOCAL)
    Shell(window).push({"kind": "vm", "message": 'a "quote"'})
    assert window.evaluated == [
        f"window.omelet.on({json.dumps({'kind': 'vm', 'message': 'a \"quote\"'})})"]


def test_events_never_reach_the_console():
    # A console page can define its own window.omelet.on and read job events.
    window = FakeWindow(LOCAL)
    shell = Shell(window)
    shell.load(CONSOLE)
    shell.push({"kind": "import", "type": "progress"})
    assert window.evaluated == []


def _bridge(tmp_path, shell):
    return {f.__name__: f for f in guarded(_api(tmp_path), shell)}


def test_every_public_method_is_refused_from_the_console(tmp_path):
    shell = Shell(FakeWindow(LOCAL))
    bridge = _bridge(tmp_path, shell)
    shell.load(CONSOLE)
    names = public_methods(DesktopApi)
    assert "reboot_now" in names and "start_import" in names
    for name in names:
        with pytest.raises(NotLocalPage):
            bridge[name]()


def test_the_bridge_exposes_only_the_public_methods(tmp_path):
    # JobRegistry sits on DesktopApi as .jobs; nothing but the guarded
    # public methods may reach pywebview.
    assert sorted(_bridge(tmp_path, Shell(FakeWindow(LOCAL)))) == public_methods(DesktopApi)


def test_the_local_page_reaches_the_real_method(tmp_path):
    assert _bridge(tmp_path, Shell(FakeWindow(LOCAL)))["reset_install"]() == {"ok": True}


def test_load_local_leaves_an_already_local_page_alone():
    # Reloading mid-job redraws Home and strands the job's events.
    window = FakeWindow(LOCAL)
    shell = Shell(window)
    shell.load_local()
    assert window.loaded == []


@pytest.mark.parametrize("before_first_load", [None, "None", "about:blank"])
def test_nothing_is_recorded_before_the_local_page_has_loaded(before_first_load):
    # WebView2 reports None and WKWebView the string "None" until the first
    # load; recording either would make the console's first call "ours".
    window = FakeWindow(before_first_load)
    shell = Shell(window)
    shell.load(CONSOLE)
    assert window.loaded == []
