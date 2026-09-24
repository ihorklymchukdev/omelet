import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "runtime" / "install" / "lib" / "github-apply.sh"
TOKEN = "gho_secret123"

FAKE_RUNUSER = """#!/usr/bin/env bash
# runuser -u NAME -- CMD...: log who and which HOME, then run CMD as us.
name=$2; shift 3
echo "$name $*" >> "$LOG/runuser"
exec "$@"
"""
FAKE_GH = """#!/usr/bin/env bash
if [[ -e "$HOME/gh-fails" ]]; then echo "boom $(cat "$TOKEN_FILE")" >&2; exit 1; fi
stdin=""
if [[ " $* " == *" --with-token "* ]]; then stdin=$(cat); fi
echo "$HOME gh $* stdin=$stdin" >> "$LOG/gh"
"""
FAKE_GETENT = """#!/usr/bin/env bash
echo "ada:x:1001:1001::$ADA_HOME:/bin/bash"
"""


def setup(tmp_path, desired=None, applied=None):
    bin_dir, log, gh_dir = tmp_path / "bin", tmp_path / "log", tmp_path / "github"
    for d in (bin_dir, log, gh_dir, tmp_path / "root", tmp_path / "ada"):
        d.mkdir()
    for name, text in {"runuser": FAKE_RUNUSER, "gh": FAKE_GH,
                       "getent": FAKE_GETENT}.items():
        (bin_dir / name).write_text(text)
        (bin_dir / name).chmod(0o755)
    shells = tmp_path / "shells"
    shells.write_text("/bin/bash\n")
    (gh_dir / "token").write_text(TOKEN)
    if desired is not None:
        (gh_dir / "desired.json").write_text(json.dumps(desired))
    if applied is not None:
        (gh_dir / "applied.json").write_text(json.dumps(applied))
    path = f"{bin_dir}:/usr/bin:/bin"
    env = {**os.environ, "PATH": path, "OMELET_APPLY_PATH": path,
           "OMELET_ROOT_HOME": str(tmp_path / "root"),
           "OMELET_SHELLS_FILE": str(shells), "LOG": str(log),
           "ADA_HOME": str(tmp_path / "ada"),
           "TOKEN_FILE": str(gh_dir / "token")}
    return env, gh_dir, log


def run(env, gh_dir):
    result = subprocess.run(["bash", str(SCRIPT), str(gh_dir)], env=env,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads((gh_dir / "applied.json").read_text())


def git_get(home, key):
    return subprocess.run(["git", "config", "--global", "--get", key],
                          env={**os.environ, "HOME": str(home)},
                          capture_output=True, text=True).stdout.strip()


CONNECTED = {"generation": 4, "state": "connected", "login": "octo",
             "name": "Octo Cat", "email": "42+octo@users.noreply.github.com"}


def test_the_script_is_valid_bash():
    assert subprocess.run(["bash", "-n", str(SCRIPT)]).returncode == 0


def test_connected_signs_in_every_account_as_itself_with_the_token_on_stdin(tmp_path):
    env, gh_dir, log = setup(tmp_path, desired=CONNECTED)
    applied = run(env, gh_dir)

    assert applied["generation"] == 4 and applied["ok"] is True
    assert [a["name"] for a in applied["accounts"]] == ["root", "ada"]
    runuser = (log / "runuser").read_text()
    assert f"HOME={tmp_path / 'root'}" in runuser and "root env" in runuser
    assert f"HOME={tmp_path / 'ada'}" in runuser and "ada env" in runuser
    gh = (log / "gh").read_text()
    assert f"--with-token stdin={TOKEN}" in gh.replace("--insecure-storage ", "")
    assert TOKEN not in runuser, "the token must never be an argument"
    assert "auth setup-git --hostname github.com" in gh
    for home in (tmp_path / "root", tmp_path / "ada"):
        assert git_get(home, "user.name") == "Octo Cat"
        assert git_get(home, "user.email") == "42+octo@users.noreply.github.com"


def test_one_failing_account_does_not_stop_the_others_and_its_error_has_no_token(tmp_path):
    env, gh_dir, _ = setup(tmp_path, desired=CONNECTED)
    (tmp_path / "root" / "gh-fails").touch()
    applied = run(env, gh_dir)

    assert applied["ok"] is False
    assert applied["accounts"] == [{"name": "root", "ok": False}, {"name": "ada", "ok": True}]
    assert "root" in applied["error"] and TOKEN not in applied["error"]
    assert git_get(tmp_path / "ada", "user.name") == "Octo Cat"


def test_disconnected_logs_out_and_keeps_an_identity_the_user_set_themselves(tmp_path):
    env, gh_dir, log = setup(
        tmp_path, desired={"generation": 5, "state": "disconnected"},
        applied={"generation": 4, "ok": True, "name": "Octo Cat",
                 "email": "42+octo@users.noreply.github.com", "accounts": []})
    for home, name in ((tmp_path / "root", "Octo Cat"), (tmp_path / "ada", "Ada L")):
        subprocess.run(["git", "config", "--global", "user.name", name],
                       env={**os.environ, "HOME": str(home)}, check=True)
    applied = run(env, gh_dir)

    assert (applied["generation"], applied["ok"]) == (5, True)
    assert (log / "gh").read_text().count("auth logout --hostname github.com") == 2
    assert git_get(tmp_path / "root", "user.name") == ""
    assert git_get(tmp_path / "ada", "user.name") == "Ada L"


def test_no_desired_state_yet_touches_nothing_and_reports_generation_zero(tmp_path):
    env, gh_dir, log = setup(tmp_path)
    applied = run(env, gh_dir)

    assert (applied["generation"], applied["ok"], applied["accounts"]) == (0, True, [])
    assert not (log / "gh").exists(), "a gh the user signed into by hand stays signed in"
