import unittest
import os
import json

FX = "/Users/slee65/projects/lazarus-foam-ext"

class TestE2eIsolation(unittest.TestCase):
    """Verify e2e isolation infrastructure without launching VS Code."""

    def test_e2e_isolation_pa_hub_dir_exists(self):
        """src/test/pa-hub/ directory exists with scenario files."""
        pa_hub_dir = os.path.join(FX, "packages/foam-vscode/src/test/pa-hub")
        self.assertTrue(os.path.isdir(pa_hub_dir))
        ts_files = [f for f in os.listdir(pa_hub_dir) if f.endswith(".ts")]
        self.assertGreaterEqual(len(ts_files), 2)

    def test_e2e_isolation_run_tests_pa_hub_mode(self):
        """run-tests.ts contains PA Hub isolation mode."""
        run_tests = os.path.join(FX, "packages/foam-vscode/src/test/run-tests.ts")
        content = open(run_tests).read()
        self.assertIn("pa-hub", content.lower())
        self.assertIn("--disable-extensions", content)

    def test_e2e_isolation_scenarios_defined(self):
        """pa-hub-scenarios.ts defines workbench, privacy, and CSP channels."""
        scenarios = os.path.join(FX, "packages/foam-vscode/src/test/pa-hub/pa-hub-scenarios.ts")
        content = open(scenarios).read()
        self.assertIn("workbench", content)
        self.assertIn("privacy", content)
        self.assertIn("csp", content)

    def test_e2e_isolation_config_has_profiles(self):
        """isolation-config.ts defines synthetic and coexistence profiles."""
        config = os.path.join(FX, "packages/foam-vscode/src/test/pa-hub/isolation-config.ts")
        content = open(config).read()
        self.assertIn("synthetic", content.lower())
        self.assertIn("coexistence", content.lower())

    def test_e2e_isolation_electron_dep(self):
        """package.json has @vscode/test-electron devDependency."""
        pkg_path = os.path.join(FX, "packages/foam-vscode/package.json")
        pkg = json.load(open(pkg_path))
        dev_deps = pkg.get("devDependencies", {})
        self.assertIn("@vscode/test-electron", dev_deps)

    def test_e2e_isolation_user_data_isolated(self):
        """run-tests.ts uses isolated user-data-dir for PA Hub tests."""
        run_tests = os.path.join(FX, "packages/foam-vscode/src/test/run-tests.ts")
        content = open(run_tests).read()
        self.assertIn("user-data-dir", content)

if __name__ == "__main__":
    unittest.main()
