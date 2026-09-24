from fastapi.testclient import TestClient

from omelet_api.core.account import Account
from omelet_api.core.public import Public, TunnelClient
from omelet_api.core.state import State
from omelet_api.routes.app import create_app
from tests.runtime.api.conftest import AUTH, COMPOSE_ONE_WEB, FakeRunner
from tests.runtime.api.fake_cloud import FakeCloud
from tests.runtime.api.test_public import ON, Clock, TunnelRunner


def build(env, cloud, *, tunnel_runner=None):
    state = State(env.config.state_db.with_name("public.db"))
    state.update_account(access_token="at", refresh_token="rt",
                         access_expires_at=10**12, org_id="org-1")
    account = Account(state, cloud, spawn=lambda fn: None)
    tunnel_runner = tunnel_runner or TunnelRunner()
    # A fixed clock, not the real one: ON's expires_at is a hardcoded
    # timestamp, and the real wall clock outruns it before this test always
    # runs (flaky-by-time-of-day otherwise).
    public = Public(state=state, account=account, cloud=cloud,
                    client=TunnelClient(tunnel_runner, env.config.stack_file),
                    token_path=env.config.projects_root.parent / "tunnel.token",
                    origin="http://traefik:41080",
                    hosts_for=lambda pid: [{"service": "web", "hostname": f"{pid}.test.local",
                                            "local_url": f"http://{pid}.test.local:41080"}],
                    clock=Clock(), spawn=lambda fn: fn())
    app = create_app(config=env.config, runner=FakeRunner(), state=state,
                     account=account, cloud=cloud, public=public)
    client = TestClient(app, headers=AUTH)
    client.post("/projects", json={"id": "blog"})
    state.map_cloud_project("blog", "c-blog", "org-1")
    (env.config.projects_root / "blog" / "docker-compose.yml").write_text(COMPOSE_ONE_WEB)
    return client, state, tunnel_runner


def test_turning_on_answers_202_and_the_project_shows_the_public_url(env):
    client, _, _ = build(env, FakeCloud(create_public_url=[ON]))

    assert client.post("/projects/blog/public").status_code == 202
    assert client.get("/projects/blog").json()["public"]["state"] == "on"


def test_turning_on_an_unregistered_project_is_a_409_with_the_reason(env):
    client, state, _ = build(env, FakeCloud())
    state.unmap_cloud_project("blog")

    resp = client.post("/projects/blog/public")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "not_registered"


def test_deleting_a_project_releases_its_public_url(env):
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[None])
    client, state, tunnel = build(env, cloud)
    client.post("/projects/blog/public")

    client.delete("/projects/blog")

    assert "release_public_url" in cloud.names()
    assert state.get_public("blog") is None and not tunnel.up


def test_signing_out_releases_the_public_url(env):
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[None], logout=[None])
    client, state, tunnel = build(env, cloud)
    client.post("/projects/blog/public")

    client.post("/account/sign-out")

    assert cloud.names()[-2:] == ["release_public_url", "logout"]
    assert state.list_public() == [] and not tunnel.up
