import tempfile
import unittest
from pathlib import Path

from app.commands.purge_expense_requests import _read_keep_numbers


class PurgeExpenseRequestHelpersTest(unittest.TestCase):
    def _file(self, content: str) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
        handle.write(content)
        handle.close()
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_keep_list_accepts_comments_and_unique_request_numbers(self) -> None:
        path = self._file(
            "# approved\nEXP-202608-013975\n\nEXP-202607-000008\n"
        )
        self.assertEqual(
            _read_keep_numbers(path),
            ["EXP-202608-013975", "EXP-202607-000008"],
        )

    def test_keep_list_rejects_duplicates(self) -> None:
        path = self._file("EXP-202608-013975\nEXP-202608-013975\n")
        with self.assertRaisesRegex(ValueError, "เลขซ้ำ"):
            _read_keep_numbers(path)

    def test_keep_list_rejects_invalid_numbers(self) -> None:
        path = self._file("ACC-EXP-202608-000001\n")
        with self.assertRaisesRegex(ValueError, "รูปแบบเลขรายการไม่ถูกต้อง"):
            _read_keep_numbers(path)


if __name__ == "__main__":
    unittest.main()
