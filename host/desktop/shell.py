"""The one window, and which page in it is ours.

pywebview injects `window.pywebview.api` into every page the window loads.
Once the projects console (served from inside the VM) is showing, anything
running in the VM can see the bridge. `guarded()` is what JS receives, and it
refuses every call unless the local UI is the page on screen.
"""
from __future__ import annotations

import functools
import json
from typing import Any
from urllib.parse import urldefrag


class NotLocalPage(PermissionError):
    """A bridge call arrived while a page other than the local UI showed."""


class Shell:
    def __init__(self, window: Any = None):
        self.window = window
        self._local: str | None = None

    def _current(self) -> str | None:
        if self.window is None:
            return None
        url = self.window.get_current_url()
        return urldefrag(url)[0] if url else None

    def _remember(self) -> None:
        # Until the first load() the window has only ever shown the local UI,
        # so the first URL seen is ours. load() calls this before leaving.
        if self._local is None:
            self._local = self._current()

    def is_local(self) -> bool:
        self._remember()
        current = self._current()
        return current is not None and current == self._local

    def load(self, url: str) -> None:
        self._remember()
        self.window.load_url(url)

    def load_local(self) -> None:
        self._remember()
        if self._local is not None:
            self.window.load_url(self._local)

    def push(self, event: dict) -> None:
        # json.dumps, never a format string: a message carrying a quote would
        # otherwise close the call and inject whatever followed.
        if self.window is not None and self.is_local():
            self.window.evaluate_js(f"window.omelet.on({json.dumps(event)})")


def public_methods(cls: type) -> list[str]:
    return sorted(name for name, value in vars(cls).items()
                  if callable(value) and not name.startswith("_"))


def guarded(api: object, shell: Shell) -> object:
    bridge = type("DesktopBridge", (), {})()
    for name in public_methods(type(api)):
        setattr(bridge, name, _guard(getattr(api, name), shell))
    return bridge


def _guard(method, shell: Shell):
    @functools.wraps(method)
    def call(*args, **kwargs):
        if not shell.is_local():
            raise NotLocalPage(f"{method.__name__} is only available to Omelet's own screens")
        return method(*args, **kwargs)
    return call
