"""Build the provider, open the window, hand the loop to pywebview.

`webview.start()` owns the main thread for the life of the app, so this
module does nothing after calling it. Everything that happens later happens
on a worker thread from jobs.py.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

WINDOW_TITLE = "Omelet"
# The board's frames are 880x620. The OS draws the title bar, so that is the
# content size; min_size keeps the nine-row install panel from clipping.
WINDOW_SIZE = (880, 620)
MIN_SIZE = (800, 560)

WEBVIEW_MISSING = (
    "Omelet could not open its window because this computer is missing the "
    "Microsoft Edge WebView2 runtime.\n"
    "Install it from https://developer.microsoft.com/microsoft-edge/webview2/ "
    "and open Omelet again.\n"
    "In the meantime you can still set up Omelet by running: "
    "omelet setup --headless"
)


def ui_dir() -> Path:
    """Where the HTML lives, in a checkout and inside the frozen binary.

    `sys._MEIPASS` is PyInstaller's unpack directory. Reading it is an
    attribute check, not a platform check, so tests/test_no_platform_leak.py
    stays satisfied.
    """
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle) / "host" / "desktop" / "ui"
    return Path(__file__).resolve().parent / "ui"


def _default_create(**kwargs):
    import webview
    return webview.create_window(**kwargs)


def _default_start(**kwargs):
    import webview
    webview.start(**kwargs)


def run(provider, state, *, create=_default_create, start=_default_start,
        resumed: bool = False) -> int:
    from .api import DesktopApi

    holder: dict = {}

    def push(event: dict) -> None:
        # Events cross into JS as one JSON argument. json.dumps, never a
        # format string: a message carrying a quote would otherwise close the
        # call and inject whatever followed.
        import json
        window = holder.get("window")
        if window is not None:
            window.evaluate_js(f"window.omelet.on({json.dumps(event)})")

    api = DesktopApi(provider, state, push=push)
    # Surfaced by a later task: the install screen reads this to show
    # host.core.install.RESUME_NOTICE when RunOnce reopened the window.
    api.resumed = resumed

    try:
        window = create(title=WINDOW_TITLE, url=str(ui_dir() / "index.html"),
                        js_api=api, width=WINDOW_SIZE[0], height=WINDOW_SIZE[1],
                        min_size=MIN_SIZE)
    except Exception:
        print(WEBVIEW_MISSING, file=sys.stderr)
        return 3

    holder["window"] = window
    start(debug=False)
    return 0


def main(argv: list[str] | None = None) -> int:
    from host.core.install import InstallState
    from host.providers import default_install_dir, get_provider

    parser = argparse.ArgumentParser(prog="omelet-desktop")
    # Written by provider.register_resume() into Windows RunOnce. The flag
    # must keep working or a restarted machine never finishes setup.
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)

    root = default_install_dir().parent
    state = InstallState(root / "install-state.json")
    provider = get_provider()
    return run(provider, state, resumed=args.resume)


if __name__ == "__main__":
    raise SystemExit(main())
