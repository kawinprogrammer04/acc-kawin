import unittest
from unittest.mock import patch

from app.services import crm_kawin


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeAsyncClient:
    calls = []
    payloads = {}
    timeout = None

    def __init__(self, timeout):
        type(self).timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, *, params, headers):
        type(self).calls.append({"url": url, "params": params, "headers": headers})
        return FakeResponse(type(self).payloads.get(params["od_code"], []))


class CrmKawinLookupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.calls = []
        FakeAsyncClient.payloads = {}
        FakeAsyncClient.timeout = None

    async def lookup(self, order_numbers):
        with (
            patch.object(crm_kawin.settings, "CRM_KAWIN_BASE_URL", "https://crm.example.test"),
            patch.object(crm_kawin.settings, "CRM_KAWIN_ORDERS_PATH", "/api/accounting/get_list_order.php"),
            patch.object(crm_kawin.settings, "CRM_KAWIN_API_KEY", "secret-token"),
            patch.object(crm_kawin.settings, "CRM_KAWIN_TIMEOUT_SECONDS", 9),
            patch("app.services.crm_kawin.httpx.AsyncClient", FakeAsyncClient),
        ):
            return await crm_kawin.lookup_crm_orders(order_numbers)

    async def test_single_order_with_multiple_items_maps_php_rows(self):
        FakeAsyncClient.payloads = {
            "SO-001": [
                {"od_code": "SO-001", "pd_code": "SKU-1", "pd_name": "สินค้า A", "odd_count": "2", "odd_price": "100.50"},
                {"od_code": "SO-001", "pd_code": "SKU-2", "pd_name": "สินค้า B", "odd_count": "1", "odd_price": "250"},
            ]
        }

        result = await self.lookup(["SO-001"])

        self.assertEqual(result.source, "crm")
        self.assertIsNone(result.warning)
        self.assertEqual(len(result.document.lines), 2)
        self.assertEqual(result.document.lines[0].order_number, "SO-001")
        self.assertEqual(result.document.lines[0].product_code, "SKU-1")
        self.assertEqual(result.document.lines[0].description, "สินค้า A")
        self.assertEqual(str(result.document.lines[0].quantity), "2")
        self.assertEqual(str(result.document.lines[0].unit_price), "100.50")
        self.assertIsNone(result.document.payment_type)
        self.assertEqual(result.document.payment_method, "other")

    async def test_multiple_orders_calls_php_api_once_per_order_with_token_and_params(self):
        FakeAsyncClient.payloads = {
            "SO-001": [{"od_code": "SO-001", "pd_code": "SKU-1", "pd_name": "สินค้า A", "odd_count": "1", "odd_price": "100"}],
            "SO-002": [{"od_code": "SO-002", "pd_code": "SKU-2", "pd_name": "สินค้า B", "odd_count": "3", "odd_price": "200"}],
        }

        result = await self.lookup(["SO-001", "SO-002"])

        self.assertEqual(len(result.document.lines), 2)
        self.assertEqual(FakeAsyncClient.timeout, 9)
        self.assertEqual(
            [call["params"] for call in FakeAsyncClient.calls],
            [{"od_code": "SO-001"}, {"od_code": "SO-002"}],
        )
        self.assertTrue(all(
            call["url"] == "https://crm.example.test/api/accounting/get_list_order.php"
            for call in FakeAsyncClient.calls
        ))
        self.assertTrue(all(
            call["headers"]["Authorization"] == "Bearer secret-token"
            for call in FakeAsyncClient.calls
        ))

    async def test_some_orders_missing_returns_found_lines_with_warning(self):
        FakeAsyncClient.payloads = {
            "SO-001": [{"od_code": "SO-001", "pd_code": "SKU-1", "pd_name": "สินค้า A", "odd_count": "1", "odd_price": "100"}],
            "SO-MISSING": [],
        }

        result = await self.lookup(["SO-001", "SO-MISSING"])

        self.assertEqual(len(result.document.lines), 1)
        self.assertEqual(result.warning, "ไม่พบรายการสินค้าในออเดอร์: SO-MISSING")

    async def test_all_orders_missing_raises_clear_error(self):
        FakeAsyncClient.payloads = {"SO-MISSING": []}

        with self.assertRaisesRegex(ValueError, "ไม่พบสินค้าในออเดอร์ที่ระบุ: SO-MISSING"):
            await self.lookup(["SO-MISSING"])


if __name__ == "__main__":
    unittest.main()
