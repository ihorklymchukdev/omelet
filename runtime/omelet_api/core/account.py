from __future__ import annotations

import logging
import threading
import time

from .cloud import CloudError, CloudUnavailable

CLIENT_NAME = "Omelet"
REFRESH_MARGIN = 60.0
SLOW_DOWN_STEP = 5.0
DEFAULT_INTERVAL = 5.0
_REFUSED = {"access_denied", "expired_token", "invalid_grant"}
_CLEARED_CODE = {"device_code": None, "user_code": None, "verification_url": None,
                 "code_expires_at": None, "poll_interval": None}

log = logging.getLogger("omelet.account")


class NotSignedIn(Exception):
    pass


def _daemon(fn) -> None:
    threading.Thread(target=fn, name="omelet-sign-in", daemon=True).start()


class Account:
    def __init__(self, state, cloud, *, clock=time.time, sleep=time.sleep,
                 spawn=_daemon):
        self._state = state
        self._cloud = cloud
        self._clock = clock
        self._sleep = sleep
        self._spawn = spawn
        self.on_signed_in = lambda: None
        self._refresh_lock = threading.Lock()
        self._poll_lock = threading.Lock()
        self._polling = False

    @property
    def signed_in(self) -> bool:
        return bool(self._state.get_account()["access_token"])

    @property
    def device_id(self) -> str:
        return self._state.get_account()["device_id"]

    def status(self) -> dict:
        row = self._state.get_account()
        if row["access_token"]:
            return {"state": "signed_in", "email": row["email"],
                    "sync": {"last_ok_at": row["sync_ok_at"],
                             "last_error": row["sync_error"]}}
        if row["device_code"]:
            return {"state": "pending", "user_code": row["user_code"],
                    "url": row["verification_url"],
                    "expires_at": row["code_expires_at"]}
        return {"state": "signed_out", "error": row["last_error"]}

    def start_sign_in(self) -> dict:
        row = self._state.get_account()
        if row["access_token"]:
            return self.status()
        if not (row["device_code"] and row["code_expires_at"] > self._clock()):
            out = self._cloud.device_code(CLIENT_NAME)
            self._state.update_account(
                device_code=out["device_code"], user_code=out["user_code"],
                verification_url=out["verification_uri_complete"],
                code_expires_at=self._clock() + out["expires_in"],
                poll_interval=float(out["interval"]), last_error=None)
        self._ensure_poller()
        return self.status()

    def resume(self) -> None:
        if self._state.get_account()["device_code"]:
            self._ensure_poller()

    def _ensure_poller(self) -> None:
        with self._poll_lock:
            if self._polling:
                return
            self._polling = True
        self._spawn(self._run_poller)

    def _run_poller(self) -> None:
        while True:
            try:
                wait = self.poll_once()
            except Exception:
                log.exception("sign-in poll failed")
                wait = DEFAULT_INTERVAL
            if wait is not None:
                self._sleep(wait)
                continue
            # Checked under the lock start_sign_in's spawn takes: a new code
            # stored after the last poll must not be left with no poller.
            with self._poll_lock:
                if not self._state.get_account()["device_code"]:
                    self._polling = False
                    return

    def poll_once(self) -> float | None:
        row = self._state.get_account()
        if not row["device_code"]:
            return None
        interval = row["poll_interval"] or DEFAULT_INTERVAL
        if self._clock() >= row["code_expires_at"]:
            self._state.update_account(**_CLEARED_CODE, last_error="expired_token")
            return None
        try:
            tokens = self._cloud.device_token(row["device_code"])
        except CloudUnavailable:
            return interval
        except CloudError as e:
            if e.code == "slow_down":
                interval += SLOW_DOWN_STEP
                self._state.update_account(poll_interval=interval)
                return interval
            if e.code in _REFUSED:
                self._state.update_account(**_CLEARED_CODE, last_error=e.code)
                return None
            return interval
        self._state.update_account(
            **_CLEARED_CODE, last_error=None,
            access_token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            access_expires_at=self._clock() + tokens["expires_in"])
        try:
            self.load_identity()
        except (CloudError, CloudUnavailable, NotSignedIn):
            # The sync pass asks again; the sign-in itself has succeeded.
            log.warning("signed in, but could not read the account yet")
        self.on_signed_in()
        return None

    def load_identity(self) -> str:
        row = self._state.get_account()
        if row["org_id"]:
            return row["org_id"]
        me = self.authed(self._cloud.me)
        self._state.update_account(email=me["user"]["email"],
                                   org_id=me["current_org_id"])
        return me["current_org_id"]

    def authed(self, fn):
        row = self._state.get_account()
        token = row["access_token"]
        if not token:
            raise NotSignedIn()
        if row["access_expires_at"] - self._clock() < REFRESH_MARGIN:
            token = self._refresh(token)
        try:
            return fn(token)
        except CloudError as e:
            if e.status != 401 or e.code != "invalid_token":
                raise
        return fn(self._refresh(token))

    def _refresh(self, stale: str) -> str:
        with self._refresh_lock:
            row = self._state.get_account()
            if not row["access_token"]:
                raise NotSignedIn()
            # Another thread refreshed while this one waited; refreshing again
            # would spend a refresh token the service may already have rotated.
            if row["access_token"] != stale:
                return row["access_token"]
            try:
                out = self._cloud.refresh(row["refresh_token"])
            except CloudError as e:
                if e.code == "invalid_grant":
                    self._forget("revoked")
                    raise NotSignedIn() from None
                raise
            self._state.update_account(
                access_token=out["access_token"],
                refresh_token=out["refresh_token"],
                access_expires_at=self._clock() + out["expires_in"])
            return out["access_token"]

    def sign_out(self) -> dict:
        token = self._state.get_account()["access_token"]
        if token:
            try:
                self._cloud.logout(token)
            except (CloudError, CloudUnavailable):
                log.warning("the service did not confirm the sign-out")
        self._forget(None)
        return self.status()

    def _forget(self, error: str | None) -> None:
        self._state.update_account(
            **_CLEARED_CODE, email=None, org_id=None, access_token=None,
            refresh_token=None, access_expires_at=None, last_error=error,
            sync_ok_at=None, sync_error=None)
        self._state.clear_cloud_projects()
