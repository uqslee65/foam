import json
import os
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACKAGE_JSON_PATH = os.path.join(REPO_ROOT, "packages", "foam-vscode", "package.json")


class TestWorkbenchReceipt(unittest.TestCase):
    """N32 workbench receipt verification tests."""

    def _get_pkg(self) -> dict:
        self.assertTrue(
            os.path.isfile(PACKAGE_JSON_PATH),
            f"package.json missing: {PACKAGE_JSON_PATH}",
        )
        with open(PACKAGE_JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f)

    def test_workbench_receipt_package_json_valid(self):
        """package.json parses as valid JSON with required fields (name, publisher, engines)."""
        pkg = self._get_pkg()
        self.assertIsInstance(pkg, dict)
        for field in ("name", "publisher", "engines"):
            self.assertIn(field, pkg, f"Required field '{field}' missing from package.json")
            self.assertTrue(pkg[field], f"Field '{field}' is empty in package.json")
        self.assertEqual(pkg.get("publisher"), "lazarus")
        self.assertEqual(pkg.get("name"), "pa-hub")

    def test_workbench_receipt_has_commands(self):
        """contributes.commands array exists and has >5 entries."""
        pkg = self._get_pkg()
        contributes = pkg.get("contributes", {})
        commands = contributes.get("commands")
        self.assertIsInstance(
            commands, list, "contributes.commands must be an array"
        )
        self.assertGreater(
            len(commands), 5, f"Expected >5 commands, got {len(commands)}"
        )

    def test_workbench_receipt_has_views(self):
        """contributes.views exists with at least one view container."""
        pkg = self._get_pkg()
        contributes = pkg.get("contributes", {})
        views = contributes.get("views")
        self.assertIsInstance(views, dict, "contributes.views must be an object")
        self.assertGreater(
            len(views), 0, "contributes.views has no view containers"
        )
        for container_id, container_views in views.items():
            self.assertIsInstance(
                container_views,
                list,
                f"Container '{container_id}' views must be an array",
            )
            self.assertGreater(
                len(container_views),
                0,
                f"Container '{container_id}' has no views",
            )

    def test_workbench_receipt_has_activation_events(self):
        """activationEvents array exists (or '*' activation)."""
        pkg = self._get_pkg()
        events = pkg.get("activationEvents")
        if events is not None:
            self.assertTrue(
                isinstance(events, list) or events == "*",
                f"activationEvents must be a list or '*', got {type(events)}",
            )
            self.assertGreater(len(events), 0, "activationEvents is empty")
        else:
            # Modern VS Code (>=1.74) allows omitting activationEvents when contributes is present
            contributes = pkg.get("contributes", {})
            self.assertTrue(
                bool(contributes.get("commands") or contributes.get("views")),
                "Neither activationEvents nor contributes triggers found",
            )

    def test_workbench_receipt_main_entry_point(self):
        """main field points to ./out/extension.js."""
        pkg = self._get_pkg()
        main = pkg.get("main")
        self.assertIsNotNone(main, "package.json missing 'main' entry point")
        valid_entries = [
            "./out/extension.js",
            "./out/bundles/extension-node.js",
        ]
        self.assertTrue(
            main in valid_entries
            or main.endswith("extension.js")
            or main.endswith("extension-node.js"),
            f"main field '{main}' does not point to expected entry point (expected one of {valid_entries})",
        )

    def test_workbench_receipt_has_configuration(self):
        """contributes.configuration exists with properties."""
        pkg = self._get_pkg()
        contributes = pkg.get("contributes", {})
        config = contributes.get("configuration")
        self.assertIsInstance(
            config,
            (dict, list),
            "contributes.configuration must be a dict or list",
        )
        if isinstance(config, list):
            has_props = any(
                "properties" in item and len(item["properties"]) > 0
                for item in config
            )
            self.assertTrue(has_props, "No configuration properties found in list")
        else:
            props = config.get("properties")
            self.assertIsInstance(
                props, dict, "contributes.configuration.properties must be a dict"
            )
            self.assertGreater(
                len(props), 0, "contributes.configuration.properties is empty"
            )


if __name__ == "__main__":
    unittest.main()
