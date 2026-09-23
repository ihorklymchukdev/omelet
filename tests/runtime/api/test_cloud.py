import io
import json
import urllib.error

import pytest

from omelet_api.core.cloud import Cloud, CloudError, CloudUnavailable


class _Response:
    def __init__(self, status: int, body: bytes):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Opener:
    """Stands in for urllib's urlopen: replays (status, body) or raises."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        status, body = reply
        if status >= 400:
            raise urllib.error.HTTPError(request.full_url, status, "error", {},
                                         io.BytesIO(body))
        return _Response(status, body)


def _error(code, message="m"):
    return json.dumps({"error": {"code": code, "message": message}}).encode()


def test_the_service_error_body_becomes_a_cloud_error_with_its_code():
    cloud = Cloud("https://svc/api", opener=Opener((400, _error("slow_down"))))
    with pytest.raises(CloudError) as raised:
        cloud.device_token("dc")
    assert (raised.value.code, raised.value.status) == ("slow_down", 400)


def test_a_refused_connection_is_unavailable():
    cloud = Cloud("https://svc/api", opener=Opener(
        urllib.error.URLError(ConnectionRefusedError())))
    with pytest.raises(CloudUnavailable):
        cloud.me("t")


@pytest.mark.parametrize("status", [502, 503, 504])
def test_a_gateway_page_instead_of_the_service_is_unavailable(status):
    cloud = Cloud("https://svc/api", opener=Opener((status, b"<html>bad gateway</html>")))
    with pytest.raises(CloudUnavailable):
        cloud.me("t")


def test_a_404_without_an_error_body_keeps_its_status():
    cloud = Cloud("https://svc/api", opener=Opener((404, b"Not Found")))
    with pytest.raises(CloudError) as raised:
        cloud.delete_project("t", "abc")
    assert raised.value.status == 404


def test_create_sends_the_token_the_name_and_the_client_ref():
    opener = Opener((201, json.dumps({"id": "u-1"}).encode()))
    out = Cloud("https://svc/api/", opener=opener).create_project("tok", "blog", "dev/blog")

    assert out == {"id": "u-1"}
    request = opener.requests[0]
    assert (request.get_method(), request.full_url) == ("POST", "https://svc/api/v1/projects")
    assert request.get_header("Authorization") == "Bearer tok"
    assert json.loads(request.data) == {"name": "blog", "client_ref": "dev/blog"}


def test_a_2xx_response_with_non_json_body_reports_the_actual_status():
    cloud = Cloud("https://svc/api", opener=Opener((201, b"Created")))
    with pytest.raises(CloudError) as raised:
        cloud.create_project("t", "n", "r")
    assert (raised.value.code, raised.value.status) == ("bad_response", 201)
