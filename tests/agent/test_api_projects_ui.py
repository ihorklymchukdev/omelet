import threading

from tests.agent.conftest import (_create, _run_to_completion, _write_compose)

COMPOSE_TWO_WEBS = """
services:
  web:
    image: nginx
    ports: ["8080:80"]
  api:
    image: api
    ports: ["9000:9000"]
"""


def test_the_first_web_is_the_primary_address(env):
    _create(env, "shop")
    _write_compose(env, "shop", COMPOSE_TWO_WEBS)
    web = env.client.get("/projects/shop").json()["web"]
    assert [(w["service"], w["primary"]) for w in web] == [("web", True),
                                                           ("api", False)]


def test_a_running_up_is_visible_on_the_project(env):
    # A reopened page must find the start that is still going.
    _create(env, "blog")
    _write_compose(env, "blog")
    env.runner.up_gate = threading.Event()
    job_id = env.client.post("/projects/blog/up").json()["job_id"]
    try:
        job = env.client.get("/projects/blog").json()["job"]
        assert (job["id"], job["kind"]) == (job_id, "up")
    finally:
        env.runner.up_gate.set()
        env.jobs.wait(job_id, timeout=5)
    assert env.client.get("/projects/blog").json()["job"] is None


def test_up_reports_its_phases_in_order(env):
    _create(env, "blog")
    _write_compose(env, "blog")
    seen = []
    env.runner.up_gate = threading.Event()
    job_id = env.client.post("/projects/blog/up").json()["job_id"]
    seen.append(env.client.get(f"/jobs/{job_id}").json()["phase"])
    env.runner.up_gate.set()
    final = env.jobs.wait(job_id, timeout=5)
    seen.append(final.phase)
    assert seen == ["starting", "checking"]


def test_first_run_holds_until_one_start_succeeds(env):
    _create(env, "blog")
    _write_compose(env, "blog")
    assert env.client.get("/projects/blog").json()["first_run"] is True
    _run_to_completion(env, env.client.post("/projects/blog/up"))
    assert env.client.get("/projects/blog").json()["first_run"] is False


def test_a_start_records_the_compose_project_name(env):
    # Delete finds containers by this name; a compose file with its own
    # `name:` would otherwise be deleted by the wrong label.
    _create(env, "blog")
    _write_compose(env, "blog", "name: fancy\n" + (
        "services:\n  web:\n    image: nginx\n    ports: ['8080:80']\n"))
    _run_to_completion(env, env.client.post("/projects/blog/up"))
    assert env.state.get_project("blog")["compose_name"] == "fancy"


def test_restart_stops_before_it_starts(env):
    _create(env, "blog")
    _write_compose(env, "blog")
    _run_to_completion(env, env.client.post("/projects/blog/restart"))
    compose = [a for a in env.runner.calls
               if "compose" in a and ("down" in a or a[-2:] == ["up", "-d"])]
    assert "down" in compose[0]
    assert compose[-1][-2:] == ["up", "-d"]
