#!/usr/bin/env python3
"""Synthetic tests for the PA Hub host runner and receipt verifier."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = SCRIPT_DIR / "pa_hub_host.py"
sys.path.insert(0, str(SCRIPT_DIR))
import pa_hub_host  # noqa: E402


class HostReceiptsTest(unittest.TestCase):
    def _run_process(
        self, argv: list[str], cwd: Path, env: dict[str, str], timeout: float = 30.0
    ) -> subprocess.CompletedProcess[bytes]:
        process = subprocess.Popen(
            argv,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env=env,
        )
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, 9)
            stdout, stderr = process.communicate(timeout=5.0)
            self.fail(f"process timed out: {argv!r}; stdout={stdout!r}; stderr={stderr!r}")
        return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)

    def _git(self, root: Path, *args: str) -> None:
        process = subprocess.Popen(
            ["git", *args],
            cwd=str(root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env=os.environ.copy(),
        )
        stdout, stderr = process.communicate(timeout=30.0)
        if process.returncode != 0:
            self.fail(
                f"git failed: {args!r}; rc={process.returncode}; "
                f"stdout={stdout!r}; stderr={stderr!r}"
            )

    def _synthetic_tree(self, root: Path) -> None:
        (root / "scripts").mkdir(parents=True)
        (root / "packages" / "x" / "src").mkdir(parents=True)
        (root / "packages" / "x" / "package.json").write_text(
            '{"name": "x"}\n', encoding="utf-8"
        )
        (root / "packages" / "x" / "src" / "index.ts").write_text(
            "export const x = 1;\n", encoding="utf-8"
        )
        (root / "scripts" / "tracked.txt").write_text(
            "tracked input\n", encoding="utf-8"
        )
        (root / "package.json").write_text(
            '{"private": true, "name": "synthetic"}\n', encoding="utf-8"
        )
        (root / "yarn.lock").write_text("# synthetic\n", encoding="utf-8")
        self._git(root, "init", "-q")
        self._git(root, "config", "user.email", "pa-hub-tests@example.invalid")
        self._git(root, "config", "user.name", "PA Hub Tests")
        self._git(root, "add", ".")
        self._git(root, "commit", "-q", "-m", "synthetic baseline")

    def _write_executable(self, path: Path, source: str) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"#!{sys.executable}\n{source}\n", encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path.resolve()

    def _fake_yarn(self, root: Path, *, fail_third: bool = False, package: bool = False) -> Path:
        count_path = root / "logs" / "pa-hub" / "host" / "fake-yarn-count"
        vsix_path = root / "artifacts" / "pa-hub" / "pa-hub.vsix"
        source = f"""
import pathlib
import sys
if sys.argv[1:] == ["--version"]:
    print("fake-yarn-9.9.9")
    raise SystemExit(0)
count_path = pathlib.Path({str(count_path)!r})
count_path.parent.mkdir(parents=True, exist_ok=True)
count = int(count_path.read_text()) + 1 if count_path.exists() else 1
count_path.write_text(str(count))
if {fail_third!r} and count == 3:
    raise SystemExit(7)
if {package!r} and sys.argv[1:] == ["package"]:
    target = pathlib.Path({str(vsix_path)!r})
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"synthetic-vsix-v1")
"""
        return self._write_executable(root / "scripts" / "fake-yarn.py", source)

    def _fake_node(self, root: Path) -> Path:
        return self._write_executable(
            root / "scripts" / "fake-node.py",
            'import sys\nprint("fake-node-1.0.0" if sys.argv[1:] == ["--version"] else "node ok")',
        )

    def _fake_code(self, root: Path, record_path: Path | None = None) -> Path:
        record = record_path or (root / "logs" / "pa-hub" / "host" / "fake-code.jsonl")
        source = f"""
import json
import os
import pathlib
import sys
record = pathlib.Path({str(record)!r})
record.parent.mkdir(parents=True, exist_ok=True)
with record.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps({{"argv": sys.argv[1:], "vscode_keys": sorted(k for k in os.environ if k.startswith("VSCODE_"))}}) + "\\n")
if "--list-extensions" in sys.argv:
    print("synthetic.extension")
"""
        return self._write_executable(root / "scripts" / "fake-code.py", source)

    def _env(
        self,
        root: Path,
        now: float,
        *,
        yarn: Path | None = None,
        code: Path | None = None,
        node: Path | None = None,
    ) -> dict[str, str]:
        env = os.environ.copy()
        yarn_path = yarn or self._fake_yarn(root)
        code_path = code or self._fake_code(root)
        node_path = node or self._fake_node(root)
        env["PA_HUB_HOST_YARN_BIN"] = str(yarn_path)
        env["PA_HUB_HOST_CODE_BIN"] = str(code_path)
        env["PA_HUB_HOST_NODE_BIN"] = str(node_path)
        tool_mtime = max(path.stat().st_mtime for path in (yarn_path, code_path, node_path))
        env["PA_HUB_HOST_NOW"] = str(max(now, tool_mtime + 1.0))
        return env

    def _run_cli(
        self, root: Path, args: list[str], env: dict[str, str]
    ) -> subprocess.CompletedProcess[bytes]:
        return self._run_process(
            [sys.executable, str(MODULE_PATH), *args, "--root", str(root)], root, env
        )

    def _receipt(self, root: Path, step: str) -> dict:
        return json.loads(pa_hub_host.receipt_path(step, root).read_text())

    def test_host_receipts_bad_step(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            result = self._run_cli(root, ["--step", "bogus"], self._env(root, now))
            self.assertEqual(result.returncode, 2)
            self.assertTrue(result.stderr.decode().startswith("USAGE"))
            self.assertEqual(result.stdout, b"")
            self.assertFalse((root / "logs" / "pa-hub" / "host" / "bogus.json").exists())

    def test_host_receipts_validate_schema_and_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            yarn = self._fake_yarn(root)
            node = self._fake_node(root)
            code = self._fake_code(root)
            now = time.time()
            result = self._run_cli(root, ["--step", "validate"], self._env(root, now, yarn=yarn, code=code, node=node))
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.decode().splitlines()[-1], "PASS validate")
            receipt = self._receipt(root, "validate")
            expected_keys = {
                "schema", "step", "root", "head", "dirty", "inputs", "inputs_digest",
                "inputs_hashed_at", "commands", "argv", "executables", "tool_versions",
                "exit_codes", "timeouts", "outputs", "artifacts", "isolation", "started_at",
                "finished_at", "wall_seconds", "ok",
            }
            self.assertEqual(set(receipt), expected_keys)
            self.assertEqual(receipt["argv"][0][0], str(yarn))
            self.assertEqual(receipt["tool_versions"]["yarn"], "fake-yarn-9.9.9")
            self.assertEqual(receipt["isolation"], {"extensions_dir": None, "user_data_dir": None, "workspace": None})

    def test_host_receipts_validate_failure_stops_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            yarn = self._fake_yarn(root, fail_third=True)
            env = self._env(root, now, yarn=yarn, code=self._fake_code(root), node=self._fake_node(root))
            result = self._run_cli(root, ["--step", "validate"], env)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout.decode().splitlines()[-1], "FAIL validate")
            receipt = self._receipt(root, "validate")
            self.assertEqual(len(receipt["exit_codes"]), 3)
            self.assertFalse(receipt["ok"])
            verified = pa_hub_host.verify_receipt("validate", root, now=now)
            self.assertTrue(any(reason.startswith("failed: exit_codes") for reason in verified["reasons"]))

    def test_host_receipts_happy_validate_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            result = self._run_cli(root, ["--step", "validate"], self._env(root, now))
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.decode().splitlines()[-1], "PASS validate")
            verified = pa_hub_host.verify_receipt("validate", root, now=now)
            self.assertEqual(verified["ok"], True)
            self.assertEqual(verified["reasons"], [])

    def test_host_receipts_misrouted_step(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "validate"], self._env(root, now))
            source = pa_hub_host.receipt_path("validate", root)
            target = pa_hub_host.receipt_path("e2e", root)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            verified = pa_hub_host.verify_receipt("e2e", root, now=now)
            self.assertTrue(any(reason.startswith("misrouted: step") for reason in verified["reasons"]))

    def test_host_receipts_stale(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "validate"], self._env(root, now))
            verified = pa_hub_host.verify_receipt("validate", root, now=now + 90000)
            self.assertTrue(any(reason.startswith("stale: age") for reason in verified["reasons"]))

    def test_host_receipts_future(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "validate"], self._env(root, now))
            path = pa_hub_host.receipt_path("validate", root)
            receipt = json.loads(path.read_text())
            receipt["finished_at"] = now + 3600
            path.write_text(json.dumps(receipt), encoding="utf-8")
            verified = pa_hub_host.verify_receipt("validate", root, now=now)
            self.assertTrue(any(reason.startswith("future:") for reason in verified["reasons"]))

    def test_host_receipts_altered_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "validate"], self._env(root, now))
            target = root / "scripts" / "tracked.txt"
            target.write_text("altered input\n", encoding="utf-8")
            os.utime(target, (now + 10, now + 10))
            verified = pa_hub_host.verify_receipt("validate", root, now=now)
            self.assertIn("inputs changed: scripts/tracked.txt", verified["reasons"])
            self.assertIn("inputs newer: scripts/tracked.txt", verified["reasons"])

    def test_host_receipts_altered_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            yarn = self._fake_yarn(root, package=True)
            result = self._run_cli(root, ["--step", "package"], self._env(root, now, yarn=yarn))
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.decode().splitlines()[-1], "PASS package")
            vsix = root / pa_hub_host.VSIX_PATH
            receipt = self._receipt(root, "package")
            self.assertEqual(receipt["artifacts"]["artifacts/pa-hub/pa-hub.vsix"], hashlib.sha256(vsix.read_bytes()).hexdigest())
            vsix.write_bytes(b"synthetic-vsix-v2")
            verified = pa_hub_host.verify_receipt("package", root, now=now)
            self.assertIn("artifact changed: artifacts/pa-hub/pa-hub.vsix", verified["reasons"])
            vsix.unlink()
            verified = pa_hub_host.verify_receipt("package", root, now=now)
            self.assertIn("artifact missing: artifacts/pa-hub/pa-hub.vsix", verified["reasons"])

    def test_host_receipts_isolated_install_records_clean_processes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            record = root / "logs" / "pa-hub" / "host" / "fake-code.jsonl"
            code = self._fake_code(root, record)
            now = time.time()
            env = self._env(root, now, code=code)
            env["VSCODE_IPC_HOOK"] = "leak"
            result = self._run_cli(root, ["--step", "isolated-install"], env)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.decode().splitlines()[-1], "PASS isolated-install")
            receipt = self._receipt(root, "isolated-install")
            extension_dir = Path(receipt["isolation"]["extensions_dir"])
            user_data_dir = Path(receipt["isolation"]["user_data_dir"])
            tmp_root = (root / "logs" / "pa-hub" / "host" / "tmp").resolve()
            self.assertTrue(extension_dir.is_relative_to(tmp_root))
            self.assertTrue(user_data_dir.is_relative_to(tmp_root))
            self.assertNotEqual(extension_dir, user_data_dir)
            self.assertEqual(len(receipt["argv"]), 3)
            for argv in receipt["argv"]:
                self.assertIn("--extensions-dir", argv)
                self.assertIn("--user-data-dir", argv)
                self.assertEqual(argv[argv.index("--extensions-dir") + 1], str(extension_dir))
                self.assertEqual(argv[argv.index("--user-data-dir") + 1], str(user_data_dir))
            seen = [json.loads(line) for line in record.read_text().splitlines()]
            self.assertEqual(len(seen), 3)
            self.assertEqual([str(code) + " " + " ".join(item["argv"]) for item in seen], [str(argv[0]) + " " + " ".join(argv[1:]) for argv in receipt["argv"]])
            self.assertTrue(all("VSCODE_IPC_HOOK" not in item["vscode_keys"] for item in seen))

    def test_host_receipts_isolation_violation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "isolated-install"], self._env(root, now))
            path = pa_hub_host.receipt_path("isolated-install", root)
            receipt = json.loads(path.read_text())
            receipt["argv"][0] = [arg for arg in receipt["argv"][0] if arg != "--user-data-dir"]
            path.write_text(json.dumps(receipt), encoding="utf-8")
            verified = pa_hub_host.verify_receipt("isolated-install", root, now=now)
            self.assertTrue(any(reason.startswith("isolation: argv") for reason in verified["reasons"]))

    def test_host_receipts_verifier_is_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._synthetic_tree(root)
            now = time.time()
            self._run_cli(root, ["--step", "validate"], self._env(root, now))

            def snapshot() -> dict[str, str]:
                values: dict[str, str] = {}
                for path in root.rglob("*"):
                    if path.is_file() and not path.is_symlink():
                        values[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
                return values

            before = snapshot()
            verified = pa_hub_host.verify_receipt("validate", root, now=now)
            after = snapshot()
            self.assertEqual(verified["ok"], True)
            self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
