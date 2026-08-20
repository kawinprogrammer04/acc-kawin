import unittest
from unittest.mock import patch

from app.services import hr_kawin


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError("error", request=None, response=self)

    def json(self):
        return self._payload


class FakeAsyncClient:
    calls = []
    timeout = None
    response = None
    raise_request_error = False

    def __init__(self, timeout):
        type(self).timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, *, headers):
        if type(self).raise_request_error:
            import httpx
            raise httpx.ConnectError("connection refused")
        type(self).calls.append({"url": url, "headers": headers})
        return type(self).response


class HrKawinFetchEmployeeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.calls = []
        FakeAsyncClient.timeout = None
        FakeAsyncClient.response = None
        FakeAsyncClient.raise_request_error = False

    async def fetch(self, hr_token="fake-token"):
        with (
            patch.object(hr_kawin.settings, "HR_KAWIN_BASE_URL", "https://hr.example.test"),
            patch.object(hr_kawin.settings, "HR_KAWIN_ME_PATH", "/api/employees/me"),
            patch.object(hr_kawin.settings, "HR_KAWIN_TIMEOUT_SECONDS", 7),
            patch("app.services.hr_kawin.httpx.AsyncClient", FakeAsyncClient),
        ):
            return await hr_kawin.fetch_employee_me(hr_token)

    async def test_success_parses_employee_payload(self):
        FakeAsyncClient.response = FakeResponse(
            200,
            {"employee": {"employee_id": "0106006", "name": "มงคล ภุมรา", "position": "Programmer", "department": "IT"}},
        )
        employee = await self.fetch("valid-token")

        self.assertEqual(employee.employee_id, "0106006")
        self.assertEqual(employee.name, "มงคล ภุมรา")
        self.assertEqual(employee.position, "Programmer")
        self.assertEqual(employee.department, "IT")
        self.assertEqual(FakeAsyncClient.timeout, 7)
        self.assertEqual(FakeAsyncClient.calls[0]["url"], "https://hr.example.test/api/employees/me")
        self.assertEqual(FakeAsyncClient.calls[0]["headers"]["Authorization"], "Bearer valid-token")

    async def test_401_raises_hr_token_error_with_401(self):
        FakeAsyncClient.response = FakeResponse(401)
        with self.assertRaises(hr_kawin.HrTokenError) as raised:
            await self.fetch("expired-token")
        self.assertEqual(raised.exception.status_code, 401)

    async def test_403_raises_hr_token_error_with_403(self):
        FakeAsyncClient.response = FakeResponse(403)
        with self.assertRaises(hr_kawin.HrTokenError) as raised:
            await self.fetch("wrong-scope-token")
        self.assertEqual(raised.exception.status_code, 403)

    async def test_other_http_error_maps_to_502(self):
        FakeAsyncClient.response = FakeResponse(500)
        with self.assertRaises(hr_kawin.HrTokenError) as raised:
            await self.fetch()
        self.assertEqual(raised.exception.status_code, 502)

    async def test_network_error_maps_to_502(self):
        FakeAsyncClient.raise_request_error = True
        with self.assertRaises(hr_kawin.HrTokenError) as raised:
            await self.fetch()
        self.assertEqual(raised.exception.status_code, 502)

    async def test_missing_base_url_raises_502_without_calling_client(self):
        with patch.object(hr_kawin.settings, "HR_KAWIN_BASE_URL", None):
            with self.assertRaises(hr_kawin.HrTokenError) as raised:
                await hr_kawin.fetch_employee_me("any-token")
        self.assertEqual(raised.exception.status_code, 502)

    async def test_missing_employee_id_in_payload_raises_502(self):
        FakeAsyncClient.response = FakeResponse(200, {"employee": {"name": "no id"}})
        with self.assertRaises(hr_kawin.HrTokenError) as raised:
            await self.fetch()
        self.assertEqual(raised.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
