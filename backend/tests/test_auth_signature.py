import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.auth import SavedSignatureIn, save_my_signature


class Database:
    def __init__(self):
        self.committed = False

    async def commit(self):
        self.committed = True


class SavedSignatureTests(unittest.TestCase):
    def test_user_can_save_a_reusable_signature(self):
        database = Database()
        user = SimpleNamespace(id=53, signature_path=None)
        payload = SavedSignatureIn(signature_data_url="data:image/png;base64,c2lnbmF0dXJl")

        with patch(
            "app.routers.auth.expense_signature_service.save_user_signature",
            return_value="/private/signatures/user-53.png",
        ) as save_signature:
            result = asyncio.run(save_my_signature(payload, database, user))

        save_signature.assert_called_once_with(53, payload.signature_data_url)
        self.assertEqual(user.signature_path, "/private/signatures/user-53.png")
        self.assertTrue(database.committed)
        self.assertEqual(result, {"has_saved_signature": True})

    def test_invalid_signature_returns_a_client_error(self):
        database = Database()
        user = SimpleNamespace(id=53, signature_path=None)
        payload = SavedSignatureIn(signature_data_url="not-an-image")

        with patch(
            "app.routers.auth.expense_signature_service.save_user_signature",
            side_effect=ValueError("ลายเซ็นต้องเป็นรูปภาพ data URL"),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(save_my_signature(payload, database, user))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertFalse(database.committed)


if __name__ == "__main__":
    unittest.main()
