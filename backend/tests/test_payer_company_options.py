import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.routers.companies import list_payer_company_options


class _ScalarResult:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class PayerCompanyOptionsTest(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_user_receives_all_active_companies(self) -> None:
        companies = [
            SimpleNamespace(id=1, code="KAWIN_BROTHERS", name_th="บริษัท กวิน บราเธอร์ส จำกัด"),
            SimpleNamespace(id=2, code="KAWIN_FULFILL", name_th="บริษัท กวิน ฟูลฟิลล์เม้นท์ จำกัด"),
        ]
        db = SimpleNamespace(execute=AsyncMock(return_value=_ScalarResult(companies)))

        result = await list_payer_company_options(
            db=db,
            _=SimpleNamespace(id=99, is_platform_admin=False),
        )

        self.assertEqual(result, companies)
        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("companies.is_active IS true", sql)
        self.assertNotIn("user_companies", sql)


if __name__ == "__main__":
    unittest.main()
