from fastapi.testclient import TestClient

from agent.api.app import create_app
from agent.core.sessions import COOKIE, SESSION_TTL, Sessions
from agent.core.state import State
from tests.agent.conftest import AUTH, BROWSER

ORIGIN = {"Origin": "http://localhost:41080"}


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


def _signed_in(env) -> TestClient:
    code = env.client.post("/sessions/handoff").json()["code"]
    browser = TestClient(env.app, headers={**BROWSER, **ORIGIN})
    assert browser.post("/api/session", json={"code": code}).status_code == 200
    return browser


def test_a_handoff_code_signs_the_browser_in(env):
    browser = _signed_in(env)
    assert browser.get("/api/projects").status_code == 200


def test_a_handoff_code_works_only_once(env):
    code = env.client.post("/sessions/handoff").json()["code"]
    browser = TestClient(env.app, headers={**BROWSER, **ORIGIN})
    browser.post("/api/session", json={"code": code})
    again = TestClient(env.app, headers={**BROWSER, **ORIGIN}).post(
        "/api/session", json={"code": code})
    assert again.status_code == 401
    assert again.json()["error"]["code"] == "handoff_invalid"


def test_handoff_is_not_reachable_from_the_browser_mount(env):
    resp = TestClient(env.app, headers={**BROWSER, **ORIGIN}).post(
        "/api/sessions/handoff")
    assert resp.status_code == 401


def test_the_cookie_is_scoped_to_the_api_path_and_script_proof(env):
    code = env.client.post("/sessions/handoff").json()["code"]
    resp = TestClient(env.app, headers={**BROWSER, **ORIGIN}).post(
        "/api/session", json={"code": code})
    header = resp.headers["set-cookie"].lower()
    assert "httponly" in header and "samesite=strict" in header
    assert "path=/api" in header


def test_the_bearer_mount_ignores_a_valid_session_cookie(env):
    browser = _signed_in(env)
    bare = TestClient(env.app, cookies={COOKIE: browser.cookies[COOKIE]})
    assert bare.get("/projects").status_code == 401


def test_an_expired_code_is_refused(tmp_path):
    clock = Clock()
    sessions = Sessions(State(tmp_path / "s.db"), clock=clock)
    code = sessions.issue_handoff()
    clock.now += 61
    assert sessions.redeem(code) is None


def test_an_expired_session_reads_as_expired_not_missing(tmp_path):
    # The UI shows "we've lost track of you" for both, but only an expired one
    # may say "that happens after a while".
    clock = Clock()
    sessions = Sessions(State(tmp_path / "s.db"), clock=clock)
    sid = sessions.redeem(sessions.issue_handoff())
    clock.now += SESSION_TTL + 1
    assert sessions.check(sid) == "expired"
    assert sessions.check(sid) == "missing"


def test_use_slides_the_expiry_forward(tmp_path):
    clock = Clock()
    sessions = Sessions(State(tmp_path / "s.db"), clock=clock)
    sid = sessions.redeem(sessions.issue_handoff())
    clock.now += SESSION_TTL - 10
    assert sessions.check(sid) == "ok"
    clock.now += SESSION_TTL - 10
    assert sessions.check(sid) == "ok"


def test_a_session_survives_an_agent_restart(env):
    browser = _signed_in(env)
    cookie = browser.cookies[COOKIE]
    env.state.close()
    restarted = create_app(config=env.config, runner=env.runner,
                           http_probe=env.probe)
    again = TestClient(restarted, headers=BROWSER, cookies={COOKIE: cookie})
    assert again.get("/api/session").status_code == 200


def test_the_raw_session_id_is_never_stored(tmp_path):
    state = State(tmp_path / "s.db")
    sessions = Sessions(state)
    sid = sessions.redeem(sessions.issue_handoff())
    assert state.get_session(sid) is None


def test_signing_out_ends_the_session(env):
    browser = _signed_in(env)
    assert browser.delete("/api/session").status_code == 200
    resp = browser.get("/api/projects")
    assert resp.json()["error"]["code"] == "not_signed_in"
