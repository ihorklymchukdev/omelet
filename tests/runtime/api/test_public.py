import os
import stat

import pytest

from omelet_api.core.account import Account
from omelet_api.core.cloud import CloudError, CloudUnavailable
from omelet_api.core.exec import Completed
from omelet_api.core.public import (MESSAGES, Public, PublicBusy, TunnelClient,
                                    Unavailable)
from omelet_api.core.state import State
from tests.runtime.api.fake_cloud import FakeCloud

HOSTS = [{"service": "web", "hostname": "blog.d.io", "local_url": "http://blog.d.io:39080"}]
ON = {"id": "u1", "project_id": "c-blog",
      "urls": [{"hostname": "blog.d.io", "url": "https://k3x9.example.dev"}],
      "expires_at": "2026-09-24T15:00:00Z",
      "credentials": {"provider": "cloudflare", "token": "tun-1"}}
EXPIRES = 1790262000.0  # 2026-09-24T15:00:00Z


class Clock:
    def __init__(self, now=EXPIRES - 3600):
        self.now = now

    def __call__(self):
        return self.now


class TunnelRunner:
    """Answers the three compose calls TunnelClient makes; records argv."""

    def __init__(self, start_ok=True):
        self.calls = []
        self.start_ok = start_ok
        self.up = False

    def exec(self, argv, *, root=False):
        self.calls.append(argv)
        if "up" in argv:
            self.up = self.start_ok
            return Completed(0 if self.start_ok else 1, "", "" if self.start_ok else "boom")
        if "rm" in argv:
            self.up = False
            return Completed(0, "", "")
        if "ps" in argv:
            return Completed(0, "abc\n" if self.up else "", "")
        return Completed(0, "", "")


def make(tmp_path, cloud, *, hosts=HOSTS, start_ok=True, projects=("blog",),
         signed_in=True, mapped=("blog",)):
    state = State(tmp_path / "state.db")
    for pid in projects:
        state.add_project(pid, f"/p/{pid}", "d.io")
    if signed_in:
        state.update_account(access_token="at", refresh_token="rt",
                             access_expires_at=10**12, org_id="org-1")
    for pid in mapped:
        state.map_cloud_project(pid, f"c-{pid}", "org-1")
    account = Account(state, cloud, spawn=lambda fn: None)
    runner = TunnelRunner(start_ok)
    clock = Clock()
    public = Public(state=state, account=account, cloud=cloud,
                    client=TunnelClient(runner, tmp_path / "stack.yml"),
                    token_path=tmp_path / "tunnel.token", origin="http://traefik:39080",
                    hosts_for=lambda pid: list(hosts), clock=clock,
                    spawn=lambda fn: fn())
    return public, state, runner, clock


def test_turning_on_writes_a_narrow_token_starts_the_client_and_shows_the_urls(tmp_path):
    cloud = FakeCloud(create_public_url=[ON])
    public, _, runner, _ = make(tmp_path, cloud)

    public.enable("blog")

    token = tmp_path / "tunnel.token"
    assert token.read_text() == "tun-1"
    assert stat.S_IMODE(os.stat(token).st_mode) == 0o640
    assert runner.up
    assert cloud.calls == [("create_public_url", "at", "c-blog", ["blog.d.io"],
                            "http://traefik:39080")]
    assert public.status("blog") == {
        "state": "on", "expires_at": EXPIRES,
        "urls": [{"url": "https://k3x9.example.dev", "service": "web",
                  "local_url": "http://blog.d.io:39080"}]}


@pytest.mark.parametrize("kwargs,code", [
    ({"signed_in": False}, "signed_out"),
    ({"mapped": ()}, "not_registered"),
    ({"hosts": []}, "no_web"),
])
def test_turning_on_is_refused_with_a_plain_reason(tmp_path, kwargs, code):
    public, _, _, _ = make(tmp_path, FakeCloud(), **kwargs)

    with pytest.raises(Unavailable) as raised:
        public.enable("blog")

    assert (raised.value.code, raised.value.message) == (code, MESSAGES[code])
    assert public.status("blog") == {"state": "unavailable",
                                     "reason": {"code": code, "message": MESSAGES[code]}}


def test_one_already_on_in_this_vm_is_named(tmp_path):
    cloud = FakeCloud(create_public_url=[ON, CloudError("public_url_active", "x", 409)])
    public, _, _, _ = make(tmp_path, cloud, projects=("blog", "shop"), mapped=("blog", "shop"))
    public.enable("blog")

    public.enable("shop")

    assert public.status("shop") == {"state": "failed", "reason": {
        "code": "public_url_active",
        "message": 'Only one public address can be on at a time. Turn off the one on "blog" first.'}}


def test_one_already_on_elsewhere_says_so(tmp_path):
    cloud = FakeCloud(create_public_url=[CloudError("public_url_active", "x", 409)])
    public, _, _, _ = make(tmp_path, cloud)

    public.enable("blog")

    assert public.status("blog")["reason"]["message"] == MESSAGES["public_url_active"]


def test_an_unknown_service_refusal_shows_the_services_own_message(tmp_path):
    cloud = FakeCloud(create_public_url=[CloudError("weird", "try later", 400)])
    public, _, _, _ = make(tmp_path, cloud)

    public.enable("blog")

    assert public.status("blog")["reason"] == {
        "code": "weird", "message": "The Omelet service refused: try later"}


def test_a_client_that_will_not_start_is_released_on_the_service(tmp_path):
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[None])
    public, _, runner, _ = make(tmp_path, cloud, start_ok=False)

    public.enable("blog")

    assert cloud.names() == ["create_public_url", "release_public_url"]
    assert not (tmp_path / "tunnel.token").exists()
    assert public.status("blog")["reason"]["code"] == "client_failed"


def test_turning_off_while_the_service_is_down_is_off_here_and_retried(tmp_path):
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[CloudUnavailable("down")])
    public, state, runner, _ = make(tmp_path, cloud)
    public.enable("blog")

    assert public.disable("blog") == {"state": "off", "note": None}
    assert not runner.up and not (tmp_path / "tunnel.token").exists()
    assert state.get_public("blog")["state"] == "releasing"


def test_turning_one_off_keeps_the_client_another_project_needs(tmp_path):
    other = {**ON, "urls": [{"hostname": "blog.d.io", "url": "https://z.example.dev"}]}
    cloud = FakeCloud(create_public_url=[ON, other], release_public_url=[None])
    public, _, runner, _ = make(tmp_path, cloud, projects=("blog", "shop"),
                                mapped=("blog", "shop"))
    public.enable("blog")
    public.enable("shop")

    public.disable("blog")

    assert runner.up and (tmp_path / "tunnel.token").exists()


def test_an_enable_whose_row_was_cleared_meanwhile_undoes_itself(tmp_path):
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[None])
    public, state, runner, _ = make(tmp_path, cloud)
    held = []
    public._spawn = held.append
    public.enable("blog")
    state.clear_public()  # a sign-out landed while the service call was in flight

    held[0]()

    assert state.get_public("blog") is None
    assert not runner.up and not (tmp_path / "tunnel.token").exists()
    assert cloud.names() == ["create_public_url", "release_public_url"]


def test_turning_off_while_turning_on_is_busy(tmp_path):
    public, _, _, _ = make(tmp_path, FakeCloud())
    public._spawn = lambda fn: None
    public.enable("blog")

    with pytest.raises(PublicBusy):
        public.disable("blog")
    with pytest.raises(PublicBusy):
        public.enable("blog")


def test_an_expired_url_reads_as_off_before_anything_cleans_up(tmp_path):
    public, _, _, clock = make(tmp_path, FakeCloud(create_public_url=[ON]))
    public.enable("blog")
    clock.now = EXPIRES

    assert public.status("blog") == {"state": "off", "note": {
        "code": "expired", "message": MESSAGES["expired"]}}


def test_a_row_cleared_after_the_client_starts_does_not_resurrect_it(tmp_path):
    """A sign-out (state.clear_public()) landing between the client starting
    and the final "on" write must not have that write bring the row back."""
    cloud = FakeCloud(create_public_url=[ON], release_public_url=[None])
    state = State(tmp_path / "state.db")
    state.add_project("blog", "/p/blog", "d.io")
    state.update_account(access_token="at", refresh_token="rt",
                         access_expires_at=10**12, org_id="org-1")
    state.map_cloud_project("blog", "c-blog", "org-1")
    account = Account(state, cloud, spawn=lambda fn: None)

    class RacingRunner(TunnelRunner):
        def __init__(self, state):
            super().__init__()
            self._state = state

        def exec(self, argv, *, root=False):
            result = super().exec(argv, root=root)
            if "up" in argv:
                self._state.clear_public()
            return result

    runner = RacingRunner(state)
    public = Public(state=state, account=account, cloud=cloud,
                    client=TunnelClient(runner, tmp_path / "stack.yml"),
                    token_path=tmp_path / "tunnel.token", origin="http://traefik:39080",
                    hosts_for=lambda pid: list(HOSTS), clock=Clock(),
                    spawn=lambda fn: fn())

    public.enable("blog")

    assert state.get_public("blog") is None
    assert not runner.up
    assert not (tmp_path / "tunnel.token").exists()
    assert cloud.names() == ["create_public_url", "release_public_url"]


def test_a_malformed_reply_is_cleaned_up_like_a_failed_start(tmp_path):
    bad = {k: v for k, v in ON.items() if k != "expires_at"}
    cloud = FakeCloud(create_public_url=[bad], release_public_url=[None])
    public, _, runner, _ = make(tmp_path, cloud)

    public.enable("blog")

    assert cloud.names() == ["create_public_url", "release_public_url"]
    assert not runner.up
    assert not (tmp_path / "tunnel.token").exists()
    assert public.status("blog")["reason"]["code"] == "client_failed"


def test_enable_meeting_a_stuck_releasing_row_retries_release_not_create(tmp_path):
    cloud = FakeCloud(release_public_url=[CloudUnavailable("down")])
    public, state, runner, _ = make(tmp_path, cloud)
    state.put_public("blog", cloud_id="c-blog", state="releasing")

    public.enable("blog")

    assert cloud.names() == ["release_public_url"]
    row = state.get_public("blog")
    assert row["state"] == "releasing" and row["reason_code"] == "cloud_unavailable"
    assert public.status("blog") == {"state": "failed", "reason": {
        "code": "cloud_unavailable", "message": MESSAGES["cloud_unavailable"]}}
