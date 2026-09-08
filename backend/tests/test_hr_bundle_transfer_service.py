import io
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.services.hr_bundle_transfer_service import _extract_archive


def _archive(entries: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, contents in entries.items():
            archive.writestr(name, contents)
    return output.getvalue()


class HrBundleTransferServiceTests(unittest.TestCase):
    def test_extracts_regular_files_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            _extract_archive(_archive({"manifest.json": b"{}", "assets/a.pdf": b"pdf"}), target)
            self.assertEqual((target / "assets/a.pdf").read_bytes(), b"pdf")
            self.assertEqual(stat.S_IMODE((target / "assets/a.pdf").stat().st_mode), 0o600)

    def test_rejects_parent_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "unsafe bundle archive path"):
                _extract_archive(_archive({"../outside.txt": b"no"}), Path(directory))

    def test_rejects_symbolic_links(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            entry = zipfile.ZipInfo("asset-link")
            entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(entry, "target")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                _extract_archive(output.getvalue(), Path(directory))


if __name__ == "__main__":
    unittest.main()
