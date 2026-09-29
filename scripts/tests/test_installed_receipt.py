import os
import shutil
import subprocess
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _get_code_insiders_bin() -> str | None:
    if os.path.exists("/usr/local/bin/code-insiders"):
        return "/usr/local/bin/code-insiders"
    if os.path.exists("/usr/bin/code-insiders"):
        return "/usr/bin/code-insiders"
    return shutil.which("code-insiders")


class TestInstalledReceipt(unittest.TestCase):
    """N36 installation receipt verification tests."""

    def test_installed_receipt_vsix_exists(self):
        """packages/foam-vscode/pa-hub-0.44.6.vsix exists."""
        vsix_path = os.path.join(
            REPO_ROOT, "packages", "foam-vscode", "pa-hub-0.44.6.vsix"
        )
        self.assertTrue(
            os.path.isfile(vsix_path),
            f"pa-hub-0.44.6.vsix not found: {vsix_path}",
        )

    def test_installed_receipt_code_insiders_available(self):
        """/usr/local/bin/code-insiders exists and is executable (also checks /usr/bin and PATH)."""
        bin_path = _get_code_insiders_bin()
        self.assertIsNotNone(
            bin_path,
            "code-insiders not found in /usr/local/bin, /usr/bin, or PATH",
        )
        self.assertTrue(
            os.path.exists(bin_path),
            f"code-insiders binary path does not exist: {bin_path}",
        )
        self.assertTrue(
            os.access(bin_path, os.X_OK),
            f"code-insiders is not executable: {bin_path}",
        )

    def test_installed_receipt_extension_listed(self):
        """run 'code-insiders --list-extensions' and check 'lazarus.pa-hub' appears."""
        bin_path = _get_code_insiders_bin()
        self.assertIsNotNone(bin_path, "code-insiders not found")
        proc = subprocess.run(
            [bin_path, "--list-extensions"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"code-insiders --list-extensions failed with code {proc.returncode}:\n{proc.stderr}",
        )
        extensions = [
            line.strip().lower()
            for line in proc.stdout.splitlines()
            if line.strip()
        ]
        self.assertIn(
            "lazarus.pa-hub",
            extensions,
            f"'lazarus.pa-hub' not found in installed extensions: {extensions}",
        )

    def test_installed_receipt_version_matches(self):
        """extension version from 'code-insiders --list-extensions --show-versions' matches 0.44.6."""
        bin_path = _get_code_insiders_bin()
        self.assertIsNotNone(bin_path, "code-insiders not found")
        proc = subprocess.run(
            [bin_path, "--list-extensions", "--show-versions"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"code-insiders --list-extensions --show-versions failed with code {proc.returncode}:\n{proc.stderr}",
        )
        version = None
        for line in proc.stdout.splitlines():
            cleaned = line.strip()
            if cleaned.lower().startswith("lazarus.pa-hub@"):
                version = cleaned.split("@", 1)[1]
                break
        self.assertEqual(
            version,
            "0.44.6",
            f"Expected version '0.44.6' for lazarus.pa-hub, found: {version}",
        )

    def test_installed_receipt_no_conflicting_foam(self):
        """'foambubble.foam-vscode' should NOT appear in the extension list (or if present, note it)."""
        bin_path = _get_code_insiders_bin()
        self.assertIsNotNone(bin_path, "code-insiders not found")
        proc = subprocess.run(
            [bin_path, "--list-extensions"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"code-insiders --list-extensions failed with code {proc.returncode}:\n{proc.stderr}",
        )
        extensions = [
            line.strip().lower()
            for line in proc.stdout.splitlines()
            if line.strip()
        ]
        self.assertNotIn(
            "foambubble.foam-vscode",
            extensions,
            "Conflicting 'foambubble.foam-vscode' extension found in installed extensions list",
        )

    def test_installed_receipt_extension_dir_exists(self):
        """~/.vscode-insiders/extensions/ contains a lazarus.pa-hub-* directory."""
        ext_dir = os.path.expanduser("~/.vscode-insiders/extensions")
        self.assertTrue(
            os.path.isdir(ext_dir),
            f"Extensions directory missing: {ext_dir}",
        )
        matching = [
            d
            for d in os.listdir(ext_dir)
            if d.startswith("lazarus.pa-hub")
            and os.path.isdir(os.path.join(ext_dir, d))
        ]
        self.assertGreater(
            len(matching),
            0,
            f"No lazarus.pa-hub-* directory found in {ext_dir}",
        )


if __name__ == "__main__":
    unittest.main()
