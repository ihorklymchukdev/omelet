import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from omelet_api.core.exec import Completed
from omelet_api.core.github import GitHubUnavailable
from omelet_api.core.github_link import GitHubLink
from omelet_api.core.state import State
from omelet_api.routes.app import create_app
from tests.runtime.api.conftest import AUTH, COMPOSE_ONE_WEB, FakeProbe, FakeRunner
from tests.runtime.api.fake_github import CODE, TOKEN, USER, FakeGitHub, err

REPO = {"full_name": "octo/app", "private": True, "description": "An app",
        "updated_at": "2026-09-20T10:00:00Z", "clone_url": "ignored"}


def make(env, github, *, connect=True):
    state = State(env.config.state_db.with_name("gh.db"))
    link = GitHubLink(state, github, client_id="cid",
                      directory=env.config.state_db.with_name("github"),
                      spawn=lambda fn: None)
    if connect:
        link.connect()
        link.poll_once()
    runner = FakeRunner()
    app = create_app(config=env.config, runner=runner, state=state,
                     http_probe=FakeProbe(), github=github, github_link=link)
    return TestClient(app, headers=AUTH), runner, app, link


def connected_github(**scripts):
    return FakeGitHub(device_code=[CODE], device_token=[{"access_token": TOKEN}],
                      user=[USER], **scripts)


def finish(app, client, resp):
    job_id = resp.json()["job_id"]
    app.state.jobs.wait(job_id, timeout=5)
    return client.get(f"/jobs/{job_id}").json()


def test_connect_says_when_github_cannot_be_reached(env):
    client, *_ = make(env, FakeGitHub(device_code=[GitHubUnavailable("x")]), connect=False)
    resp = client.post("/github/connect")
    assert (resp.status_code, resp.json()["error"]["code"]) == (503, "github_unavailable")


def test_repos_are_mapped_and_never_carry_the_token(env):
    client, *_ = make(env, connected_github(repos=[([REPO], True)]))
    resp = client.get("/github/repos?page=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_more"] is True
    assert body["repos"] == [{"full_name": "octo/app", "private": True,
                              "description": "An app",
                              "updated_at": 1789898400.0}]
    assert TOKEN not in resp.text
    assert TOKEN not in client.get("/github").text


def test_a_revoked_token_on_repos_asks_for_a_reconnect(env):
    client, *_ = make(env, connected_github(repos=[err("bad_credentials")]))
    resp = client.get("/github/repos")
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "github_reconnect")
    assert client.get("/github").json() == {"state": "needs_reconnect", "login": "octo"}


@pytest.mark.parametrize("repo", ["../x", "a/b/c", "https://github.com/a/b"])
def test_clone_refuses_anything_but_owner_slash_name(env, repo):
    client, *_ = make(env, connected_github())
    resp = client.post("/github/clone", json={"repo": repo})
    assert (resp.status_code, resp.json()["error"]["code"]) == (422, "invalid_repo")


def test_clone_while_disconnected_is_refused(env):
    client, *_ = make(env, FakeGitHub(), connect=False)
    resp = client.post("/github/clone", json={"repo": "octo/app"})
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "github_not_connected")


def test_clone_passes_the_token_only_through_the_environment_then_starts_the_project(env):
    client, runner, app, _ = make(env, connected_github())

    def put_compose(dest):
        Path(dest).mkdir(parents=True)
        (Path(dest) / "docker-compose.yml").write_text(COMPOSE_ONE_WEB)

    runner.on_clone = put_compose
    resp = client.post("/github/clone", json={"repo": "octo/app"})
    assert resp.status_code == 202 and resp.json()["id"] == "app"
    job = finish(app, client, resp)

    assert job["state"] == "done", job
    clone = next(argv for argv in runner.calls if argv[0] == "sh")
    assert TOKEN not in " ".join(clone)
    assert "https://github.com/octo/app.git" in clone
    env_used = runner.envs[runner.calls.index(clone)]
    assert env_used == {"OMELET_GH_TOKEN": TOKEN, "GIT_TERMINAL_PROMPT": "0"}
    assert client.get("/projects/app").status_code == 200
    assert runner.argv_containing("up")


def test_a_failed_clone_leaves_no_project_and_no_token_in_its_output(env):
    client, runner, app, _ = make(env, connected_github())

    def half_clone(dest):
        Path(dest).mkdir(parents=True)
        (Path(dest) / ".git").mkdir()

    runner.on_clone = half_clone
    runner.clone = Completed(128, "", f"fatal: Authentication failed for "
                                      f"'https://x-access-token:{TOKEN}@github.com/octo/app.git/'")
    job = finish(app, client, client.post("/github/clone", json={"repo": "octo/app"}))

    assert job["state"] == "failed"
    assert TOKEN not in json.dumps(job)
    assert "Authentication failed" in job["detail"]
    assert not (env.config.projects_root / "app").exists()
    assert client.get("/projects/app").status_code == 404
    assert client.get("/github").json()["state"] == "needs_reconnect"


def test_clone_into_a_taken_name_is_refused(env):
    client, *_ = make(env, connected_github())
    (env.config.projects_root / "app").mkdir(parents=True)
    resp = client.post("/github/clone", json={"repo": "octo/app"})
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "project_exists")
