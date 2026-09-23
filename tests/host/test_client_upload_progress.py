"""Reporting the two phases an upload actually has.

upload_directory tars the tree to a temp file and then streams it. Both take
real time on a 412-file project, and today neither reports -- the board's bar
would sit at zero through the first and jump at the second.
"""
from __future__ import annotations

import io

from host.client import ApiClient


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeOpener:
    """Stands in for urllib.request.OpenerDirector well enough to exercise
    _CountingReader: a real opener reads the request body in blocksize chunks
    until it gets b"", which is the only thing that drives "sending" progress.
    A fake that swallows request.data in one gulp (or not at all) would pass
    the test file even against a broken implementation.
    """

    def __init__(self, body: bytes = b"{}"):
        self._body = body

    def open(self, request, timeout=None):
        data = request.data
        if data is not None:
            while data.read(8192):
                pass
        return FakeResponse(self._body)


def _client(opener):
    return ApiClient("token", opener=opener)


def test_both_phases_report(tmp_path):
    (tmp_path / "a.txt").write_text("a" * 1024)
    (tmp_path / "b.txt").write_text("b" * 1024)

    seen = []
    client = _client(FakeOpener())
    client.upload_directory("proj", tmp_path,
                            on_progress=lambda phase, done, total: seen.append(phase))

    assert "packing" in seen
    assert "sending" in seen


def test_packing_counts_files_and_sending_counts_bytes(tmp_path):
    (tmp_path / "a.txt").write_text("a" * 4096)

    seen = []
    client = _client(FakeOpener())
    client.upload_directory("proj", tmp_path,
                            on_progress=lambda *args: seen.append(args))

    packing = [s for s in seen if s[0] == "packing"]
    sending = [s for s in seen if s[0] == "sending"]
    assert packing and packing[-1][1] == packing[-1][2] == 1
    # The last sending event must reach the total, or the bar sticks short of
    # full and the screen never looks finished.
    assert sending and sending[-1][1] == sending[-1][2]


def test_upload_still_works_without_a_callback(tmp_path):
    (tmp_path / "a.txt").write_text("a")
    client = _client(FakeOpener(b'{"ok": true}'))
    assert client.upload_directory("proj", tmp_path) == {"ok": True}
