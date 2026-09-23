import pytest

from omelet_api.core.account import Account, NotSignedIn
from omelet_api.core.cloud import CloudError, CloudUnavailable
from omelet_api.core.state import State
from tests.runtime.api.fake_cloud import CODE, ME, TOKENS, FakeCloud


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def err(code, status=400):
    return CloudError(code, code, status)


def make(tmp_path, cloud):
    clock = Clock()
    spawned = []
    account = Account(State(tmp_path / "state.db"), cloud, clock=clock,
                      sleep=lambda s: None, spawn=spawned.append)
    return account, clock, spawned


def signed_in(tmp_path, cloud, expires_in=900):
    account, clock, _ = make(tmp_path, cloud)
    account._state.update_account(access_token="at-1", refresh_token="rt-1",
                                  access_expires_at=clock.now + expires_in,
                                  email="ada@example.com", org_id="org-1")
    return account, clock


def test_starting_sign_in_shows_the_code_and_link_and_starts_one_poller(tmp_path):
    account, clock, spawned = make(tmp_path, FakeCloud(device_code=[CODE]))

    status = account.start_sign_in()

    assert status == {"state": "pending", "user_code": "ABCD-EFGH",
                      "url": "https://svc/device?user_code=ABCD-EFGH",
                      "expires_at": clock.now + 600}
    assert len(spawned) == 1


def test_starting_again_while_the_code_is_valid_reuses_it(tmp_path):
    cloud = FakeCloud(device_code=[CODE])
    account, clock, spawned = make(tmp_path, cloud)
    account.start_sign_in()
    clock.now += 100

    assert account.start_sign_in()["user_code"] == "ABCD-EFGH"
    assert cloud.names() == ["device_code"]
    assert len(spawned) == 1, "a poller is already running"


def test_a_pending_code_is_polled_again_after_the_interval(tmp_path):
    account, _, _ = make(tmp_path, FakeCloud(
        device_code=[CODE], device_token=[err("authorization_pending")]))
    account.start_sign_in()

    assert account.poll_once() == 5


def test_slow_down_lengthens_the_interval_for_good(tmp_path):
    account, _, _ = make(tmp_path, FakeCloud(
        device_code=[CODE],
        device_token=[err("slow_down"), err("authorization_pending")]))
    account.start_sign_in()

    assert account.poll_once() == 10
    assert account.poll_once() == 10


def test_an_unreachable_service_keeps_polling(tmp_path):
    account, _, _ = make(tmp_path, FakeCloud(
        device_code=[CODE], device_token=[CloudUnavailable("down")]))
    account.start_sign_in()

    assert account.poll_once() == 5


@pytest.mark.parametrize("code", ["access_denied", "expired_token", "invalid_grant"])
def test_a_refused_code_returns_to_signed_out_with_the_reason(tmp_path, code):
    account, _, _ = make(tmp_path, FakeCloud(device_code=[CODE], device_token=[err(code)]))
    account.start_sign_in()

    assert account.poll_once() is None
    assert account.status() == {"state": "signed_out", "error": code}


def test_a_code_past_its_expiry_ends_without_asking_the_service(tmp_path):
    cloud = FakeCloud(device_code=[CODE])
    account, clock, _ = make(tmp_path, cloud)
    account.start_sign_in()
    clock.now += 601

    assert account.poll_once() is None
    assert account.status() == {"state": "signed_out", "error": "expired_token"}
    assert "device_token" not in cloud.names()


def test_approval_stores_the_tokens_reads_who_it_is_and_wakes_sync(tmp_path):
    account, _, _ = make(tmp_path, FakeCloud(
        device_code=[CODE], device_token=[TOKENS], me=[ME]))
    woken = []
    account.on_signed_in = lambda: woken.append(True)
    account.start_sign_in()

    assert account.poll_once() is None
    status = account.status()
    assert (status["state"], status["email"]) == ("signed_in", "ada@example.com")
    assert account.load_identity() == "org-1"
    assert woken == [True]


def test_resume_starts_a_poller_only_for_a_pending_code(tmp_path):
    account, _, spawned = make(tmp_path, FakeCloud(device_code=[CODE]))
    account.resume()
    assert spawned == []

    account.start_sign_in()
    account._polling = False  # as after an API restart
    account.resume()
    assert len(spawned) == 2


def test_a_token_about_to_expire_is_refreshed_before_the_call(tmp_path):
    cloud = FakeCloud(refresh=[{**TOKENS, "access_token": "at-2", "refresh_token": "rt-2"}])
    account, _ = signed_in(tmp_path, cloud, expires_in=30)

    assert account.authed(lambda token: token) == "at-2"
    assert account._state.get_account()["refresh_token"] == "rt-2"


def test_an_invalid_token_is_refreshed_and_retried_once(tmp_path):
    cloud = FakeCloud(refresh=[{**TOKENS, "access_token": "at-2"}])
    account, _ = signed_in(tmp_path, cloud)
    seen = []

    def call(token):
        seen.append(token)
        raise err("invalid_token", 401)

    with pytest.raises(CloudError):
        account.authed(call)
    assert seen == ["at-1", "at-2"], "one retry, then the error surfaces"


def test_a_revoked_refresh_signs_out_with_revoked(tmp_path):
    account, _ = signed_in(tmp_path, FakeCloud(refresh=[err("invalid_grant")]), expires_in=0)
    account._state.map_cloud_project("blog", "c-1", "org-1")

    with pytest.raises(NotSignedIn):
        account.authed(lambda token: token)
    assert account.status() == {"state": "signed_out", "error": "revoked"}
    assert account._state.cloud_mapping() == {}


def test_an_unreachable_service_during_refresh_keeps_the_account(tmp_path):
    account, _ = signed_in(tmp_path, FakeCloud(refresh=[CloudUnavailable("down")]), expires_in=0)

    with pytest.raises(CloudUnavailable):
        account.authed(lambda token: token)
    assert account.signed_in


def test_sign_out_forgets_everything_but_the_device_even_if_logout_fails(tmp_path):
    account, _ = signed_in(tmp_path, FakeCloud(logout=[CloudUnavailable("down")]))
    device = account.device_id
    account._state.map_cloud_project("blog", "c-1", "org-1")

    assert account.sign_out() == {"state": "signed_out", "error": None}
    assert account._state.cloud_mapping() == {}
    assert account.device_id == device
