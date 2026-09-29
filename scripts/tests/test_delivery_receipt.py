import json
import os
import unittest
import zipfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class TestDeliveryReceipt(unittest.TestCase):
    """N37 delivery receipt verification tests."""

    def test_delivery_receipt_package_json_complete(self):
        """package.json has all required fields: name, version, publisher, displayName, description, engines."""
        pkg_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "package.json"
        )
        self.assertTrue(
            os.path.isfile(pkg_path), f"package.json missing: {pkg_path}"
        )
        with open(pkg_path, "r", encoding="utf-8") as f:
            pkg = json.load(f)

        required_fields = [
            "name",
            "version",
            "publisher",
            "displayName",
            "description",
            "engines",
        ]
        for field in required_fields:
            self.assertIn(
                field, pkg, f"Required field '{field}' missing from package.json"
            )
            self.assertTrue(
                pkg[field], f"Field '{field}' in package.json must not be empty"
            )

    def test_delivery_receipt_readme_exists(self):
        """packages/foam-vscode/README.md exists and is >100 bytes."""
        readme_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "README.md"
        )
        self.assertTrue(
            os.path.isfile(readme_path), f"README.md missing: {readme_path}"
        )
        size = os.path.getsize(readme_path)
        self.assertGreater(
            size, 100, f"README.md size ({size} bytes) is not >100 bytes"
        )

    def test_delivery_receipt_changelog_exists(self):
        """packages/foam-vscode/CHANGELOG.md exists."""
        changelog_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "CHANGELOG.md"
        )
        self.assertTrue(
            os.path.isfile(changelog_path),
            f"CHANGELOG.md missing: {changelog_path}",
        )
        self.assertGreater(
            os.path.getsize(changelog_path),
            0,
            f"CHANGELOG.md is empty: {changelog_path}",
        )

    def test_delivery_receipt_license_exists(self):
        """LICENSE file exists at repo root or packages/foam-vscode/."""
        root_license = os.path.join(REPO_ROOT, "LICENSE")
        pkg_license = os.path.join(REPO_ROOT, "packages", "foam-vscode", "LICENSE")
        has_license = os.path.isfile(root_license) or os.path.isfile(pkg_license)
        self.assertTrue(
            has_license,
            f"LICENSE file missing at repo root ({root_license}) or packages/foam-vscode/ ({pkg_license})",
        )

    def test_delivery_receipt_vsix_under_5mb(self):
        """The VSIX file is under 5MB (deployment-safe)."""
        vsix_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "pa-hub-0.44.6.vsix"
        )
        self.assertTrue(
            os.path.isfile(vsix_path), f"VSIX file missing: {vsix_path}"
        )
        size = os.path.getsize(vsix_path)
        max_size = 5 * 1024 * 1024
        self.assertLess(
            size,
            max_size,
            f"VSIX size ({size} bytes) exceeds 5MB limit ({max_size} bytes)",
        )

    def test_delivery_receipt_no_dev_dependencies_in_vsix(self):
        """VSIX zip does not contain node_modules/ entries (dependencies are bundled by esbuild)."""
        vsix_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "pa-hub-0.44.6.vsix"
        )
        self.assertTrue(
            os.path.isfile(vsix_path), f"VSIX file missing: {vsix_path}"
        )
        with zipfile.ZipFile(vsix_path, "r") as zf:
            node_modules_entries = [
                name
                for name in zf.namelist()
                if "node_modules/" in name or name.endswith("node_modules")
            ]
            self.assertEqual(
                node_modules_entries,
                [],
                f"node_modules entries found in VSIX: {node_modules_entries[:10]}",
            )


if __name__ == "__main__":
    unittest.main()
