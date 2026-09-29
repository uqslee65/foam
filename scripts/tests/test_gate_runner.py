from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "scripts" / "pa_hub_gate.py"


class GateRunnerTest(unittest.TestCase):
    def run_gate(
        self,
        tree: Path,
        selector: str,
        *,
        json_output: bool = False,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        for key in (
            "PA_HUB_VITEST_BIN",
            "PA_HUB_GATE_CHILD_BUDGET_S",
            "PA_HUB_GATE_OUTER_DEADLINE_S",
        ):
            env.pop(key, None)
        if extra_env:
            env.update(extra_env)
        argv = [
            sys.executable,
            str(ADAPTER),
            "-k",
            selector,
            "--root",
            str(tree),
        ]
        if json_output:
            argv.append("--json")
        return subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=env,
            start_new_session=True,
            timeout=15,
            check=False,
        )

    def make_python_test(self, tree: Path, name: str, source: str) -> None:
        tests_dir = tree / "scripts" / "tests"
        tests_dir.mkdir(parents=True, exist_ok=True)
        (tests_dir / name).write_text(source, encoding="utf-8")

    def make_ts_tree(self, tree: Path, selector: str) -> None:
        src = tree / "packages" / "foam-graph" / "src"
        src.mkdir(parents=True, exist_ok=True)
        (src / "x.test.ts").write_text(
            f"test('test_{selector}_renders', () => {{}});\n", encoding="utf-8"
        )

    def make_fake_vitest(
        self, tree: Path, report: dict[str, object], marker: Path | None = None
    ) -> Path:
        fake = tree / "fake_vitest.py"
        report_text = json.dumps(report)
        marker_line = (
            f"Path({str(marker)!r}).write_text('invoked', encoding='utf-8')\n"
            if marker is not None
            else ""
        )
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json\n"
            "import sys\n"
            "from pathlib import Path\n"
            "output = next(arg.split('=', 1)[1] for arg in sys.argv "
            "if arg.startswith('--outputFile='))\n"
            f"{marker_line}"
            f"Path(output).write_text({report_text!r}, encoding='utf-8')\n",
            encoding="utf-8",
        )
        fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
        return fake

    def json_result(self, completed: subprocess.CompletedProcess[str]) -> dict:
        for line in completed.stdout.splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and "selector" in value:
                return value
        self.fail("adapter did not print a JSON result line")

    def test_gate_runner_bad_selector(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            completed = self.run_gate(Path(temp_dir), "Bad-Sel")
        self.assertEqual(completed.returncode, 2)
        self.assertTrue(completed.stderr.startswith("USAGE "))
        self.assertEqual(completed.stdout, "")

    def test_gate_runner_python_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_python_test(
                tree,
                "test_alpha.py",
                "import unittest\n"
                "class AlphaTest(unittest.TestCase):\n"
                "    def test_alpha_ok(self):\n"
                "        self.assertTrue(True)\n",
            )
            completed = self.run_gate(tree, "alpha", json_output=True)
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout.splitlines()[-1], "PASS alpha")
        self.assertEqual(self.json_result(completed)["matched"], 1)

    def test_gate_runner_python_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_python_test(
                tree,
                "test_alpha.py",
                "import unittest\n"
                "class AlphaTest(unittest.TestCase):\n"
                "    def test_alpha_bad(self):\n"
                "        self.fail('expected failure')\n",
            )
            completed = self.run_gate(tree, "alpha")
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "FAIL alpha")

    def test_gate_runner_python_no_tests(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_python_test(
                tree,
                "test_alpha.py",
                "def test_alpha_ok():\n    pass\n",
            )
            completed = self.run_gate(tree, "beta")
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "NO_TESTS beta")

    def test_gate_runner_timeout_kills_child_group(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            pid_file = tree / "sleeping.pid"
            self.make_python_test(
                tree,
                "test_alpha.py",
                "import os\n"
                "import time\n"
                f"open({str(pid_file)!r}, 'w', encoding='utf-8').write(str(os.getpid()))\n"
                "time.sleep(30)\n"
                "def test_alpha_sleep():\n"
                "    pass\n",
            )
            completed = self.run_gate(
                tree,
                "alpha",
                extra_env={
                    "PA_HUB_GATE_CHILD_BUDGET_S": "1",
                    "PA_HUB_GATE_OUTER_DEADLINE_S": "4",
                },
            )
            self.assertEqual(completed.returncode, 124)
            self.assertEqual(completed.stdout.splitlines()[-1], "TIMEOUT alpha")
            deadline = time.monotonic() + 3
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(pid_file.exists())
            pid = int(pid_file.read_text(encoding="utf-8"))
            gone = False
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    gone = True
                    break
                time.sleep(0.05)
            self.assertTrue(gone, f"sleeping child {pid} is still alive")

    def test_gate_runner_vitest_passes_and_translates_pattern(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_ts_tree(tree, "gamma")
            fake = self.make_fake_vitest(
                tree,
                {
                    "testResults": [
                        {
                            "assertionResults": [
                                {"status": "passed"},
                                {"status": "passed"},
                            ]
                        }
                    ]
                },
            )
            completed = self.run_gate(
                tree,
                "gamma",
                json_output=True,
                extra_env={"PA_HUB_VITEST_BIN": str(fake)},
            )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout.splitlines()[-1], "PASS gamma")
        result = self.json_result(completed)
        self.assertEqual(result["matched"], 2)
        vitest_family = next(
            family for family in result["families"] if family["family"] == "vitest"
        )
        argv = vitest_family["argv"]
        self.assertEqual(argv[argv.index("-t") + 1], "test_gamma_")

    def test_gate_runner_vitest_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_ts_tree(tree, "gamma")
            fake = self.make_fake_vitest(
                tree,
                {
                    "testResults": [
                        {
                            "assertionResults": [
                                {"status": "passed"},
                                {"status": "failed"},
                            ]
                        }
                    ]
                },
            )
            completed = self.run_gate(
                tree,
                "gamma",
                extra_env={"PA_HUB_VITEST_BIN": str(fake)},
            )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "FAIL gamma")

    def test_gate_runner_vitest_not_invoked_without_textual_match(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            src = tree / "packages" / "foam-graph" / "src"
            src.mkdir(parents=True)
            (src / "x.test.ts").write_text(
                "test('test_other_selector', () => {});\n", encoding="utf-8"
            )
            marker = tree / "invoked.marker"
            fake = self.make_fake_vitest(
                tree, {"testResults": []}, marker=marker
            )
            completed = self.run_gate(
                tree,
                "delta",
                extra_env={"PA_HUB_VITEST_BIN": str(fake)},
            )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "NO_TESTS delta")
        self.assertFalse(marker.exists())

    def test_gate_runner_sentinel_is_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_python_test(
                tree,
                "test_alpha.py",
                "import unittest\n"
                "class AlphaTest(unittest.TestCase):\n"
                "    def test_alpha_bad(self):\n"
                "        print('secret PA_HUB_PRIVATE_SENTINEL_V1 value')\n"
                "        self.fail('expected failure')\n",
            )
            completed = self.run_gate(tree, "alpha")
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "FAIL alpha")
        self.assertNotIn("PA_HUB_PRIVATE_SENTINEL_V1", completed.stdout)
        self.assertIn("[redacted line]", completed.stdout)

    def test_gate_runner_missing_vitest_is_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = Path(temp_dir)
            self.make_ts_tree(tree, "epsilon")
            missing = tree / "missing-vifest"
            completed = self.run_gate(
                tree,
                "epsilon",
                json_output=True,
                extra_env={"PA_HUB_VITEST_BIN": str(missing)},
            )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout.splitlines()[-1], "FAIL epsilon")
        result = self.json_result(completed)
        family = next(
            family for family in result["families"] if family["family"] == "vitest"
        )
        self.assertTrue(family["error"].startswith("vitest executable missing"))


if __name__ == "__main__":
    unittest.main()
