import os
import re
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class TestCspReceipt(unittest.TestCase):
    """N34 CSP receipt verification tests."""

    def _get_panel_dir(self) -> str:
        candidate_dirs = [
            os.path.join(
                REPO_ROOT,
                "packages",
                "foam-vscode",
                "src",
                "vscode",
                "features",
                "panels",
            ),
            os.path.join(
                REPO_ROOT,
                "packages",
                "foam-vscode",
                "src",
                "vscode",
                "features",
                "graph-webview",
            ),
        ]
        for d in candidate_dirs:
            if os.path.isdir(d):
                return d
        return candidate_dirs[0]

    def test_csp_receipt_graph_panel_exists(self):
        """src/vscode/features/panels/ directory exists with .ts files."""
        panel_dir = self._get_panel_dir()
        self.assertTrue(
            os.path.isdir(panel_dir), f"Panel directory missing: {panel_dir}"
        )
        ts_files = [f for f in os.listdir(panel_dir) if f.endswith(".ts")]
        self.assertGreater(len(ts_files), 0, f"No .ts files found in {panel_dir}")

    def test_csp_receipt_webview_has_csp_nonce(self):
        """at least one panel .ts file references 'nonce' for CSP."""
        panel_dir = self._get_panel_dir()
        self.assertTrue(
            os.path.isdir(panel_dir), f"Panel directory missing: {panel_dir}"
        )
        found_nonce = False
        for f in os.listdir(panel_dir):
            if f.endswith(".ts"):
                path = os.path.join(panel_dir, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    if "nonce" in fh.read():
                        found_nonce = True
                        break
        self.assertTrue(
            found_nonce,
            f"No reference to 'nonce' found in panel files at {panel_dir}",
        )

    def test_csp_receipt_no_unsafe_inline_in_source(self):
        """no .ts file in src/ contains the literal string ''unsafe-inline'' in a CSP context (content-security-policy meta tag)."""
        src_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "src")
        meta_csp_pattern = re.compile(
            r"<meta[^>]*content-security-policy[^>]*'unsafe-inline'",
            re.IGNORECASE,
        )
        script_src_unsafe_inline_pattern = re.compile(
            r"script-src[^;\"']*'unsafe-inline'",
            re.IGNORECASE,
        )
        violations = []
        for root, _, files in os.walk(src_dir):
            for f in files:
                if (
                    not f.endswith(".ts")
                    or f.endswith(".test.ts")
                    or f.endswith(".spec.ts")
                ):
                    continue
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
                if meta_csp_pattern.search(
                    content
                ) or script_src_unsafe_inline_pattern.search(content):
                    rel = os.path.relpath(path, REPO_ROOT)
                    violations.append(rel)
        self.assertEqual(
            violations,
            [],
            f"'unsafe-inline' found in CSP context in: {violations}",
        )

    def test_csp_receipt_no_unsafe_eval_in_source(self):
        """no .ts file in src/ contains ''unsafe-eval'' in a CSP context."""
        src_dir = os.path.join(REPO_ROOT, "packages", "foam-vscode", "src")
        violations = []
        for root, _, files in os.walk(src_dir):
            for f in files:
                if not f.endswith(".ts"):
                    continue
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
                if "'unsafe-eval'" in content or '"unsafe-eval"' in content:
                    rel = os.path.relpath(path, REPO_ROOT)
                    violations.append(rel)
        self.assertEqual(
            violations,
            [],
            f"'unsafe-eval' found in CSP context in: {violations}",
        )

    def test_csp_receipt_webview_uses_https_or_vscode(self):
        """panel files reference 'https:' or 'vscode-resource:' or '${webview.cspSource}' for resource loading."""
        panel_dir = self._get_panel_dir()
        self.assertTrue(
            os.path.isdir(panel_dir), f"Panel directory missing: {panel_dir}"
        )
        tokens = ["https:", "vscode-resource:", "${webview.cspSource}", "cspSource"]
        found = False
        for f in os.listdir(panel_dir):
            if f.endswith(".ts"):
                path = os.path.join(panel_dir, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
                if any(token in content for token in tokens):
                    found = True
                    break
        self.assertTrue(
            found,
            f"No resource loading scheme ('https:', 'vscode-resource:', '${{webview.cspSource}}', 'cspSource') found in {panel_dir}",
        )

    def test_csp_receipt_graph_view_bundle_exists(self):
        """packages/foam-graph/dist/ or out/ contains built graph-view assets."""
        candidate_dirs = [
            os.path.join(REPO_ROOT, "packages", "foam-graph", "dist"),
            os.path.join(REPO_ROOT, "packages", "foam-graph", "out"),
        ]
        found_dir = None
        for d in candidate_dirs:
            if os.path.isdir(d):
                found_dir = d
                break
        self.assertIsNotNone(
            found_dir,
            f"Neither packages/foam-graph/dist nor out directory exists: {candidate_dirs}",
        )
        js_files = [f for f in os.listdir(found_dir) if f.endswith(".js")]
        self.assertGreater(
            len(js_files),
            0,
            f"No built .js assets found in {found_dir}",
        )


if __name__ == "__main__":
    unittest.main()
