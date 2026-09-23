"""Opening the window, and what happens when the platform cannot.

The WebView2 runtime is evergreen but absent on un-updated Windows 10. A
traceback there is a dead end for a non-technical user; the fallback has to
name the command that still works.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from host.core.install import InstallState
from host.desktop.__main__ import WEBVIEW_MISSING, run, ui_dir


class FakeProvider:
    pass


LOCAL = "http://127.0.0.1:53817/index.html"


class FakeWindow:
    def __init__(self, url=LOCAL):
        self.url = url
        self.loaded = []
        self.evaluated = []
        self.exposed = {}

    def get_current_url(self):
        return self.url

    def load_url(self, url):
        self.loaded.append(url)
        self.url = url

    def evaluate_js(self, script):
        self.evaluated.append(script)

    def expose(self, *functions):
        self.exposed.update({f.__name__: f for f in functions})


def test_ui_dir_points_at_the_bundled_assets():
    assert (ui_dir() / "index.html").is_file()


def test_a_missing_webview_runtime_is_a_sentence_not_a_traceback(tmp_path, capsys):
    def create(**kwargs):
        raise RuntimeError("WebView2 runtime not found")

    code = run(FakeProvider(), InstallState(tmp_path / "s.json"),
               create=create, start=lambda **kwargs: None)

    assert code == 3
    assert WEBVIEW_MISSING in capsys.readouterr().err


def test_the_fallback_names_the_headless_command():
    # Without this the user is told the app is broken and nothing else.
    assert "omelet setup --headless" in WEBVIEW_MISSING


def test_a_working_window_starts_the_loop_and_returns_zero(tmp_path):
    started = []
    code = run(FakeProvider(), InstallState(tmp_path / "s.json"),
               create=lambda **kwargs: FakeWindow(),
               start=lambda **kwargs: started.append(kwargs),
               menu=lambda items: items)

    assert code == 0
    # debug must be off in a shipped build: it exposes devtools and a context
    # menu over the bridge.
    assert started[0]["debug"] is False


def test_the_real_failure_reaches_stderr_under_the_runtime_message(tmp_path, capsys):
    """The same handler catches missing-runtime AND ordinary bugs, so the
    cause has to be recoverable -- otherwise a typo reads as "install
    WebView2" and the user chases a runtime they already have."""
    def create(**kwargs):
        raise TypeError("create_window() got an unexpected keyword argument 'widht'")

    code = run(FakeProvider(), InstallState(tmp_path / "s.json"),
               create=create, start=lambda **kwargs: None)

    err = capsys.readouterr().err
    assert code == 3
    assert WEBVIEW_MISSING in err
    assert "widht" in err


def test_a_resumed_launch_is_recorded_for_the_install_screen(tmp_path):
    """RunOnce relaunches with --resume after a restart; the screen has to
    be able to say why it opened by itself."""
    window = FakeWindow()
    run(FakeProvider(), InstallState(tmp_path / "s.json"),
        create=lambda **kwargs: window, start=lambda **kwargs: None, resumed=True,
        menu=lambda items: items)

    assert window.exposed["home"]()["resumed"] is True


def test_javascript_gets_the_guarded_bridge_not_the_api(tmp_path):
    from host.desktop.shell import NotLocalPage
    captured = {}
    window = FakeWindow()

    def create(**kwargs):
        captured.update(kwargs)
        return window

    run(FakeProvider(), InstallState(tmp_path / "s.json"),
        create=create, start=lambda **kwargs: None, menu=lambda items: items)
    # pywebview resolves a dotted call name from js_api with plain getattr, so
    # any object there lets a page walk "home.__func__.__globals__" past the
    # guard. Named functions are looked up by exact name only.
    assert captured["js_api"] is None
    window.exposed["reset_install"]()
    window.url = "http://localhost:39080/"
    with pytest.raises(NotLocalPage):
        window.exposed["reset_install"]()


def test_the_menu_offers_projects_machine_and_the_browser(tmp_path):
    started = []
    run(FakeProvider(), InstallState(tmp_path / "s.json"),
        create=lambda **kwargs: FakeWindow(),
        start=lambda **kwargs: started.append(kwargs), menu=lambda items: items)
    assert [title for title, _ in started[0]["menu"]] == \
        ["Projects", "Machine", "Open in browser"]


def test_machine_returns_the_window_to_the_local_ui(tmp_path):
    started = []
    window = FakeWindow()
    run(FakeProvider(), InstallState(tmp_path / "s.json"),
        create=lambda **kwargs: window,
        start=lambda **kwargs: started.append(kwargs), menu=lambda items: items)
    machine = dict(started[0]["menu"])["Machine"]
    # The first machine() records the page the window opened with as local.
    window.url = LOCAL
    machine()
    window.url = "http://localhost:39080/"
    machine()
    assert window.url == LOCAL


def _launch(tmp_path, window):
    captured = {}
    # FakeProvider has no exec(), so every handoff fails, as on a stopped VM.
    run(FakeProvider(), InstallState(tmp_path / "s.json"),
        create=lambda **kwargs: window,
        start=lambda **kwargs: captured.update(menu=dict(kwargs["menu"])),
        menu=lambda items: items)
    return captured


def test_projects_says_why_when_the_console_is_out_of_reach(tmp_path):
    window = FakeWindow()
    _launch(tmp_path, window)["menu"]["Projects"]()
    assert window.loaded == []
    assert len(window.evaluated) == 1 and '"kind": "notice"' in window.evaluated[0]


def test_projects_from_a_dead_console_returns_to_the_machine_screen(tmp_path):
    # The console can't show a desktop notice; Home re-probes and its state
    # (stopped, something's wrong) is the explanation.
    window = FakeWindow()
    launched = _launch(tmp_path, window)
    window.exposed["reset_install"]()
    window.url = "http://localhost:39080/"
    launched["menu"]["Projects"]()
    assert window.url == LOCAL
    assert window.evaluated == []
