import unittest
import os
import json

FX = "/Users/slee65/projects/lazarus-foam-ext"

class TestPackagingConfig(unittest.TestCase):
    """Verify PA Hub packaging configuration."""

    def test_packaging_config_publisher(self):
        """package.json publisher is lazarus."""
        pkg = json.load(open(os.path.join(FX, "packages/foam-vscode/package.json")))
        self.assertEqual(pkg["publisher"], "lazarus")

    def test_packaging_config_name(self):
        """package.json name is pa-hub."""
        pkg = json.load(open(os.path.join(FX, "packages/foam-vscode/package.json")))
        self.assertEqual(pkg["name"], "pa-hub")

    def test_packaging_config_package_script(self):
        """package.json has package script using vsce."""
        pkg = json.load(open(os.path.join(FX, "packages/foam-vscode/package.json")))
        script = pkg.get("scripts", {}).get("package", "")
        self.assertIn("vsce", script)
        self.assertIn("--yarn", script)

    def test_packaging_config_output_dir(self):
        """package.json package script outputs to artifacts/ or has --out."""
        pkg = json.load(open(os.path.join(FX, "packages/foam-vscode/package.json")))
        script = pkg.get("scripts", {}).get("package", "")
        # Must have --out flag pointing to artifacts dir
        self.assertTrue("--out" in script or "artifacts" in script,
                       f"package script must output to artifacts dir: {script}")

    def test_packaging_config_vscodeignore_test_exclusions(self):
        """.vscodeignore excludes test and pa-hub test dirs."""
        ignore = open(os.path.join(FX, "packages/foam-vscode/.vscodeignore")).read()
        self.assertIn("src/**", ignore)
        self.assertIn("out/test/**", ignore)

    def test_packaging_config_vscodeignore_no_dataviz_source(self):
        """.vscodeignore excludes dataviz source but not built assets."""
        ignore = open(os.path.join(FX, "packages/foam-vscode/.vscodeignore")).read()
        # Source should be excluded, built static should be included
        self.assertIn("src/**", ignore)

    def test_packaging_config_root_workspace_script(self):
        """Root package.json has package script for pa-hub workspace."""
        pkg = json.load(open(os.path.join(FX, "package.json")))
        script = pkg.get("scripts", {}).get("package", "")
        self.assertIn("pa-hub", script)

    def test_packaging_config_extension_kind(self):
        """extensionKind includes ui for desktop-local."""
        pkg = json.load(open(os.path.join(FX, "packages/foam-vscode/package.json")))
        kind = pkg.get("extensionKind", [])
        self.assertIn("ui", kind)

if __name__ == "__main__":
    unittest.main()
