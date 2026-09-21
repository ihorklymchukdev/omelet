"""Merge and replace, and the order replace does things in.

Replace is the only destructive action in the app. The board's warning says
"Anything in the existing project that isn't in your folder is gone for good".
That is only true if the delete happens first; the other order merges and then
wipes, which loses the import as well.
"""
from __future__ import annotations

from host.core.install import InstallState
from host.core.status import Readiness
from host.desktop.api import DesktopApi


class RecordingClient:
    def __init__(self):
        self.calls = []

    def delete_project(self, project_id):
        self.calls.append(("delete", project_id))

    def ensure_project(self, project_id, **kwargs):
        self.calls.append(("ensure", project_id))
        return {}

    def upload_directory(self, project_id, local_dir, *, on_progress=None):
        self.calls.append(("upload", project_id))
        if on_progress:
            on_progress("sending", 10, 10)
        return {}

    def get_project(self, project_id):
        return {}


def _api(tmp_path, client, pushed):
    return DesktopApi(object(), InstallState(tmp_path / "s.json"),
                      push=pushed.append, probe_fn=lambda p: Readiness(),
                      client_factory=lambda provider: client)


def test_merge_uploads_without_deleting(tmp_path):
    folder = tmp_path / "recipe-box"
    folder.mkdir()
    client, pushed = RecordingClient(), []
    api = _api(tmp_path, client, pushed)
    api.start_import(str(folder), "merge")
    api.jobs.join(timeout=5)

    assert [c[0] for c in client.calls] == ["ensure", "upload"]


def test_replace_deletes_before_it_uploads(tmp_path):
    folder = tmp_path / "recipe-box"
    folder.mkdir()
    client, pushed = RecordingClient(), []
    api = _api(tmp_path, client, pushed)
    api.start_import(str(folder), "replace")
    api.jobs.join(timeout=5)

    assert [c[0] for c in client.calls] == ["delete", "ensure", "upload"]


def test_an_unknown_mode_is_refused_rather_than_guessed(tmp_path):
    import pytest
    folder = tmp_path / "p"
    folder.mkdir()
    api = _api(tmp_path, RecordingClient(), [])
    # Guessing here could pick "replace" and delete a project.
    with pytest.raises(ValueError):
        api.start_import(str(folder), "obliterate")


def test_import_progress_reaches_the_screen(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    client, pushed = RecordingClient(), []
    api = _api(tmp_path, client, pushed)
    api.start_import(str(folder), "merge")
    api.jobs.join(timeout=5)

    assert any(e["type"] == "progress" for e in pushed)
    assert pushed[-1]["type"] == "done"
