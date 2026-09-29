import os
import subprocess
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class TestBuildReceipt(unittest.TestCase):
    """N31 build receipt verification tests."""

    def test_build_receipt_out_dir_exists(self):
        """packages/foam-vscode/out/ directory exists."""
        out_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "out")
        self.assertTrue(os.path.isdir(out_dir), f"out dir missing: {out_dir}")

    def test_build_receipt_extension_js_exists(self):
        """packages/foam-vscode/out/extension.js exists and >1KB."""
        ext_js = os.path.join(REPO_ROOT, "packages", "foam-vscode", "out", "extension.js")
        self.assertTrue(os.path.isfile(ext_js), f"extension.js missing: {ext_js}")
        size = os.path.getsize(ext_js)
        self.assertGreater(size, 1024, f"extension.js size ({size} bytes) <= 1KB")

    def test_build_receipt_pa_hub_bundle_exists(self):
        """packages/foam-vscode/out/pa-hub/ directory exists with .js files."""
        pa_hub_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "out", "pa-hub")
        self.assertTrue(os.path.isdir(pa_hub_dir), f"pa-hub dir missing: {pa_hub_dir}")
        js_files = [f for f in os.listdir(pa_hub_dir) if f.endswith(".js")]
        self.assertGreater(len(js_files), 0, f"No .js files found in {pa_hub_dir}")

    def test_build_receipt_tsc_clean(self):
        """Run npx tsc --noEmit in packages/foam-vscode, exit code 0."""
        vscode_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode")
        proc = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd=vscode_dir,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"tsc --noEmit failed with exit code {proc.returncode}:\n{proc.stdout}\n{proc.stderr}",
        )

    def test_build_receipt_no_source_in_out(self):
        """out/ contains no .ts source files (only .js, .js.map, and .d.ts)."""
        out_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "out")
        self.assertTrue(os.path.isdir(out_dir), f"out dir missing: {out_dir}")
        ts_source_files = [
            os.path.join(root, f)
            for root, _, files in os.walk(out_dir)
            for f in files
            if (f.endswith(".ts") or f.endswith(".tsx")) and not f.endswith(".d.ts")
        ]
        self.assertEqual(
            ts_source_files,
            [],
            f"Source .ts files found in out directory: {ts_source_files}",
        )

    def test_build_receipt_graph_bundle_exists(self):
        """packages/foam-vscode/out/bundles/ exists with files."""
        bundles_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "out", "bundles")
        self.assertTrue(os.path.isdir(bundles_dir), f"bundles dir missing: {bundles_dir}")
        files = [
            f
            for f in os.listdir(bundles_dir)
            if os.path.isfile(os.path.join(bundles_dir, f))
        ]
        self.assertGreater(len(files), 0, f"No bundle files found in {bundles_dir}")


if __name__ == "__main__":
    unittest.main()
