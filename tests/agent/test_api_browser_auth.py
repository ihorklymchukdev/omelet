from fastapi.testclient import TestClient

from tests.agent.conftest import BROWSER


def _browser(env, **headers):
    # A browser never sends the bearer token; start from a bare client.
    return TestClient(env.app, headers={**BROWSER, **headers})


def test_the_api_mount_refuses_the_agent_port_host(env):
    # Cookies ignore the port: without this check a page could replay the
    # session cookie straight at localhost:39099.
    resp = _browser(env, Host="localhost:39099").get("/api/projects")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_host"


def test_the_api_mount_refuses_a_rebound_hostname(env):
    resp = _browser(env, Host="evil.example:41080").get("/api/health")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_host"


def test_a_write_from_a_project_app_origin_is_refused(env):
    resp = _browser(env, Origin="http://blog.test.local:41080").post(
        "/api/projects", json={"id": "x"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_origin"


def test_a_write_without_an_origin_is_refused(env):
    resp = _browser(env).post("/api/projects", json={"id": "x"})
    assert resp.json()["error"]["code"] == "forbidden_origin"


def test_the_api_mount_does_not_accept_the_bearer_token(env):
    resp = _browser(env, Authorization="Bearer test-token").get("/api/projects")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "not_signed_in"


def test_api_health_answers_without_a_session_for_the_version_check(env):
    resp = _browser(env).get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["api"] == 1


def test_the_bearer_mount_is_unchanged_by_a_browser_host(env):
    # The host dials 127.0.0.1:39099 with whatever Host urllib sends; the
    # allowlist must never apply to the bearer mount.
    resp = env.client.get("/projects", headers={"Host": "anything:1"})
    assert resp.status_code == 200
