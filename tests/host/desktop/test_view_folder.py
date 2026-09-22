"""What the import screen says before anything is sent.

"412 files · 38 MB" has to describe what will actually travel, not what is on
disk: upload_directory filters through client._uploadable, and a count that
includes .git or node_modules would promise a transfer that never happens.
"""
from __future__ import annotations

from host.desktop.view import inspect_folder


def test_the_project_name_comes_from_the_folder(tmp_path):
    folder = tmp_path / "recipe-box"
    folder.mkdir()
    (folder / "a.txt").write_text("a")
    assert inspect_folder(folder)["name"] == "recipe-box"


def test_files_and_bytes_count_what_will_be_sent(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    (folder / "a.txt").write_text("x" * 100)
    (folder / "sub").mkdir()
    (folder / "sub" / "b.txt").write_text("y" * 50)

    summary = inspect_folder(folder)
    assert summary["files"] == 2
    assert summary["bytes"] == 150


def test_excluded_trees_are_not_counted(tmp_path):
    folder = tmp_path / "p"
    (folder / ".git").mkdir(parents=True)
    (folder / ".git" / "HEAD").write_text("ref: refs/heads/main")
    (folder / "node_modules" / "left-pad").mkdir(parents=True)
    (folder / "node_modules" / "left-pad" / "i.js").write_text("module.exports=1")
    (folder / "app.py").write_text("print(1)")

    summary = inspect_folder(folder)
    assert summary["files"] == 1
    assert summary["bytes"] == len("print(1)")


def test_an_empty_folder_is_reported_not_refused(tmp_path):
    # Import deliberately does not require a docker-compose.yml: the coding
    # agent writes one later. An empty folder is a real, allowed import.
    folder = tmp_path / "blank"
    folder.mkdir()
    assert inspect_folder(folder) == {"name": "blank", "files": 0, "bytes": 0}
