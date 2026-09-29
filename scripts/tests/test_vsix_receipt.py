import json
import os
import unittest
import zipfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VSIX_PATH = os.path.join(REPO_ROOT, "packages", "foam-vscode", "pa-hub-0.44.6.vsix")


class TestVsixReceipt(unittest.TestCase):
    """N35 VSIX receipt verification tests."""

    def test_vsix_receipt_vsix_exists(self):
        """The .vsix file exists."""
        self.assertTrue(os.path.isfile(VSIX_PATH), f"VSIX file missing: {VSIX_PATH}")

    def test_vsix_receipt_is_valid_zip(self):
        """Can be opened with zipfile module."""
        self.assertTrue(zipfile.is_zipfile(VSIX_PATH), f"Not a valid zip: {VSIX_PATH}")
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            corrupt = zf.testzip()
            self.assertIsNone(corrupt, f"Zip contains corrupt file: {corrupt}")

    def test_vsix_receipt_has_manifest(self):
        """Contains extension.vsixmanifest."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            self.assertIn("extension.vsixmanifest", zf.namelist())

    def test_vsix_receipt_publisher_lazarus(self):
        """Manifest contains publisher='lazarus' (or Identity Publisher='lazarus')."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            manifest = zf.read("extension.vsixmanifest").decode("utf-8")
            has_publisher = (
                'Publisher="lazarus"' in manifest
                or 'publisher="lazarus"' in manifest
                or "publisher='lazarus'" in manifest
            )
            self.assertTrue(
                has_publisher,
                f"Publisher 'lazarus' not found in manifest:\n{manifest[:300]}",
            )

    def test_vsix_receipt_has_extension_js(self):
        """Zip contains extension/out/extension.js."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            self.assertIn("extension/out/extension.js", zf.namelist())

    def test_vsix_receipt_has_graph_bundle(self):
        """Zip contains extension/out/bundles/ files."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            bundle_files = [
                f for f in zf.namelist() if f.startswith("extension/out/bundles/")
            ]
            self.assertGreater(
                len(bundle_files), 0, "No extension/out/bundles/ files found in VSIX"
            )

    def test_vsix_receipt_no_test_files(self):
        """Zip contains no test*.ts or *.test.ts files."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            test_files = [
                f
                for f in zf.namelist()
                if (
                    f.endswith(".test.ts")
                    or (os.path.basename(f).startswith("test") and f.endswith(".ts"))
                    or f.endswith(".spec.ts")
                )
            ]
            self.assertEqual(
                test_files, [], f"Test files found in VSIX package: {test_files}"
            )

    def test_vsix_receipt_no_personal_data(self):
        """Zip contents do not contain 'profile.md' or 'vault/knowledge/me'."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            personal_files = [
                f
                for f in zf.namelist()
                if "profile.md" in f.lower() or "vault/knowledge/me" in f.lower()
            ]
            self.assertEqual(
                personal_files,
                [],
                f"Personal data found in VSIX package: {personal_files}",
            )

    def test_vsix_receipt_size_reasonable(self):
        """VSIX is between 500KB and 10MB."""
        self.assertTrue(os.path.isfile(VSIX_PATH), f"VSIX file missing: {VSIX_PATH}")
        size = os.path.getsize(VSIX_PATH)
        self.assertGreaterEqual(
            size, 500 * 1024, f"VSIX size {size} bytes is less than 500KB"
        )
        self.assertLessEqual(
            size, 10 * 1024 * 1024, f"VSIX size {size} bytes exceeds 10MB"
        )

    def test_vsix_receipt_has_package_json(self):
        """Zip contains extension/package.json with name 'pa-hub'."""
        with zipfile.ZipFile(VSIX_PATH, "r") as zf:
            self.assertIn("extension/package.json", zf.namelist())
            pkg = json.loads(zf.read("extension/package.json").decode("utf-8"))
            self.assertEqual(
                pkg.get("name"),
                "pa-hub",
                f"Expected package name 'pa-hub', got {pkg.get('name')}",
            )


if __name__ == "__main__":
    unittest.main()
