import os
import re
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PA_HUB_DIR = os.path.join(REPO_ROOT, "packages", "foam-vscode", "src", "pa-hub")


class TestPrivacyReceipt(unittest.TestCase):
    """N33 privacy receipt verification tests."""

    def _get_ts_files(self, include_tests: bool = True):
        ts_files = []
        for root, _, files in os.walk(PA_HUB_DIR):
            if not include_tests and "tests" in root.split(os.sep):
                continue
            for f in files:
                if f.endswith(".ts") and (
                    include_tests
                    or not (f.endswith(".test.ts") or f.endswith(".spec.ts"))
                ):
                    ts_files.append(os.path.join(root, f))
        return ts_files

    def test_privacy_receipt_no_real_api_keys(self):
        """grep src/pa-hub/ for patterns like 'sk-', 'AIza', 'ghp_', 'AKIA' — must find zero real keys."""
        patterns = [
            re.compile(r"\bsk-[a-zA-Z0-9]{20,}\b"),
            re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
            re.compile(r"\bghp_[0-9A-Za-z]{36}\b"),
            re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        ]
        found_keys = []
        for file_path in self._get_ts_files(include_tests=True):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for pattern in patterns:
                matches = pattern.findall(content)
                if matches:
                    rel = os.path.relpath(file_path, REPO_ROOT)
                    found_keys.extend([f"{rel}: {m}" for m in matches])
        self.assertEqual(
            found_keys,
            [],
            f"Potential real API keys found in src/pa-hub/: {found_keys}",
        )

    def test_privacy_receipt_no_home_dir_paths(self):
        """src/pa-hub/*.ts files contain no hardcoded /Users/ or /home/ paths."""
        home_path_pattern = re.compile(r"/(?:Users|home)/[a-zA-Z0-9_-]+")
        found_paths = []
        for file_path in self._get_ts_files(include_tests=False):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            matches = home_path_pattern.findall(content)
            if matches:
                rel = os.path.relpath(file_path, REPO_ROOT)
                found_paths.extend([f"{rel}: {m}" for m in matches])
        self.assertEqual(
            found_paths,
            [],
            f"Hardcoded home directory paths found in src/pa-hub/*.ts: {found_paths}",
        )

    def test_privacy_receipt_no_profile_md_reference(self):
        """src/pa-hub/*.ts files don't reference 'profile.md' or 'vault/knowledge/me' (test fixtures excepted)."""
        forbidden = ["vault/knowledge/me", "profile.md"]
        found = []
        for file_path in self._get_ts_files(include_tests=False):
            # privacy.ts defines the exclusion rule constants (MANDATORY_EXCLUSIONS)
            if os.path.basename(file_path) == "privacy.ts":
                continue
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for word in forbidden:
                if word in content:
                    rel = os.path.relpath(file_path, REPO_ROOT)
                    found.append(f"{rel}: {word}")
        self.assertEqual(
            found,
            [],
            f"Sensitive profile references found in non-privacy source files: {found}",
        )

    def test_privacy_receipt_privacy_module_exists(self):
        """src/pa-hub/privacy.ts exists."""
        privacy_ts = os.path.join(PA_HUB_DIR, "privacy.ts")
        self.assertTrue(
            os.path.isfile(privacy_ts),
            f"privacy.ts missing: {privacy_ts}",
        )

    def test_privacy_receipt_exclude_globs_in_privacy(self):
        """privacy.ts contains 'excludeGlobs' pattern."""
        privacy_ts = os.path.join(PA_HUB_DIR, "privacy.ts")
        self.assertTrue(
            os.path.isfile(privacy_ts),
            f"privacy.ts missing: {privacy_ts}",
        )
        with open(privacy_ts, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn(
            "excludeGlobs",
            content,
            "privacy.ts does not contain 'excludeGlobs' pattern",
        )

    def test_privacy_receipt_test_sentinels_only(self):
        """any occurrence of 'SECRET' or 'TOKEN' in test files is prefixed with 'SYNTHETIC-'."""
        tests_dir = os.path.join(PA_HUB_DIR, "tests")
        self.assertTrue(
            os.path.isdir(tests_dir), f"tests dir missing: {tests_dir}"
        )
        violations = []
        for root, _, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith(".ts"):
                    continue
                path = os.path.join(root, f)
                with open(
                    path, "r", encoding="utf-8", errors="ignore"
                ) as file_handle:
                    content = file_handle.read()
                for keyword in ("SECRET", "TOKEN"):
                    for match in re.finditer(
                        r"\b[A-Za-z0-9_-]*" + keyword + r"[A-Za-z0-9_-]*\b",
                        content,
                    ):
                        word = match.group(0)
                        if (
                            "SYNTHETIC" not in word
                            and "PA_HUB_PRIVATE_SENTINEL" not in word
                        ):
                            rel = os.path.relpath(path, REPO_ROOT)
                            violations.append(f"{rel}: {word}")
        self.assertEqual(
            violations,
            [],
            f"Non-synthetic test secrets or tokens found: {violations}",
        )


if __name__ == "__main__":
    unittest.main()
