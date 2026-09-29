#!/usr/bin/env python3
"""Run one bounded acceptance-test selector across Python and Vitest tests.

The real packages use ``vitest run`` and Vitest 3.2.7's JSON reporter has the
``testResults[].assertionResults[].status`` shape parsed below.  The adapter
uses only the explicit root, never the caller's cwd, and treats a non-zero
Vitest exit with a readable report as a failure even when that report has no
failed assertion (strict missing-evidence handling).  Relative ``--root`` and
relative ``PA_HUB_VITEST_BIN`` values are anchored to FX, rather than being
resolved from cwd.  A partial tail is sanitized after truncation; a sentinel
that was truncated away cannot be recovered, while every sentinel in the
stored tail is redacted.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any


CHILD_BUDGET_S = float(os.environ.get("PA_HUB_GATE_CHILD_BUDGET_S", "105"))
OUTER_DEADLINE_S = float(
    os.environ.get("PA_HUB_GATE_OUTER_DEADLINE_S", "110")
)
SENTINEL = "PA_HUB_PRIVATE_SENTINEL_V1"
TAIL_BYTES = 2048
SELECTOR_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
RAN_RE = re.compile(r"\bRan\s+(\d+)\s+tests?\b")
SKIPPED_RE = re.compile(r"\bskipped=(\d+)\b")
FAILURES_RE = re.compile(r"\bfailures=(\d+)\b")
ERRORS_RE = re.compile(r"\berrors=(\d+)\b")

_FAMILY_RECORDS: list[dict[str, Any]] = []
_CURRENT_RECORD: dict[str, Any] | None = None
_CURRENT_PROCESS: subprocess.Popen[bytes] | None = None
_SELECTOR: str | None = None
_JSON_ENABLED = False
_INVOCATION_START = 0.0
_CHILD_DEADLINE = 0.0
_TIMED_OUT = False


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self._print_message(f"USAGE {message}\n", sys.stderr)
        raise SystemExit(2)


class _ChildTimeout(Exception):
    pass


def _fx_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _root_from_arg(value: str | None) -> Path:
    if value is None:
        return _fx_root()
    path = Path(value)
    if not path.is_absolute():
        path = _fx_root() / path
    return path.resolve()


def _sanitize_tail(data: bytes) -> str:
    text = data[-TAIL_BYTES:].decode("utf-8", errors="replace")
    lines: list[str] = []
    for line in text.splitlines(keepends=True):
        ending = ""
        if line.endswith("\r\n"):
            ending = "\r\n"
        elif line.endswith(("\n", "\r")):
            ending = line[-1]
        if SENTINEL in line:
            lines.append("[redacted line]" + ending)
        else:
            lines.append(line)
    result = "".join(lines)
    if SENTINEL in result:
        result = result.replace(SENTINEL, "[redacted line]")
    encoded = result.encode("utf-8")
    if len(encoded) > TAIL_BYTES:
        result = encoded[-TAIL_BYTES:].decode("utf-8", errors="replace")
    return result


def _append_tail(buffer: bytearray, chunk: bytes) -> None:
    buffer.extend(chunk)
    if len(buffer) > TAIL_BYTES:
        del buffer[: len(buffer) - TAIL_BYTES]


def _kill_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _reap_after_kill(process: subprocess.Popen[bytes]) -> None:
    try:
        process.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass


def _collect_process(
    process: subprocess.Popen[bytes], deadline: float
) -> tuple[int, bytes, bytes]:
    """Drain both pipes without retaining more than the output tails."""

    output = {"stdout": bytearray(), "stderr": bytearray()}
    selector = selectors.DefaultSelector()
    streams = ((process.stdout, "stdout"), (process.stderr, "stderr"))
    try:
        for stream, name in streams:
            if stream is None:
                continue
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)

        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _ChildTimeout
            events = selector.select(remaining)
            if not events:
                if process.poll() is None:
                    raise _ChildTimeout
                continue
            for key, _ in events:
                stream = key.fileobj
                try:
                    chunk = os.read(stream.fileno(), 65536)
                except BlockingIOError:
                    continue
                if chunk:
                    _append_tail(output[key.data], chunk)
                else:
                    selector.unregister(stream)

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _ChildTimeout
        try:
            returncode = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as exc:
            raise _ChildTimeout from exc
        return returncode, bytes(output["stdout"]), bytes(output["stderr"])
    finally:
        selector.close()


def _new_record(
    family: str, target: str, argv: list[str]
) -> dict[str, Any]:
    return {
        "family": family,
        "target": target,
        "argv": argv,
        "exit_code": None,
        "matched": 0,
        "failed": 0,
        "error": None,
        "duration_s": 0.0,
        "stdout_tail": "",
        "stderr_tail": "",
    }


def _execute(record: dict[str, Any], cwd: Path, kind: str) -> None:
    global _CURRENT_PROCESS, _TIMED_OUT

    started = time.monotonic()
    record["duration_s"] = 0.0
    if time.monotonic() >= _CHILD_DEADLINE:
        record["error"] = "timeout"
        record["duration_s"] = round(time.monotonic() - started, 3)
        _TIMED_OUT = True
        return

    try:
        process = subprocess.Popen(
            record["argv"],
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        record["error"] = f"{kind} failed: {exc}"
        record["duration_s"] = round(time.monotonic() - started, 3)
        return

    _CURRENT_PROCESS = process
    try:
        try:
            returncode, stdout, stderr = _collect_process(
                process, _CHILD_DEADLINE
            )
            record["exit_code"] = returncode
            record["stdout_tail"] = _sanitize_tail(stdout)
            record["stderr_tail"] = _sanitize_tail(stderr)
        except _ChildTimeout:
            _kill_process_group(process)
            _reap_after_kill(process)
            record["exit_code"] = process.returncode
            record["error"] = "timeout"
            _TIMED_OUT = True
    except BaseException:
        _kill_process_group(process)
        _reap_after_kill(process)
        raise
    finally:
        _CURRENT_PROCESS = None
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()
        record["duration_s"] = round(time.monotonic() - started, 3)


def _last_nonempty_line(text: str) -> str:
    for line in reversed(text.splitlines()):
        if line.strip():
            return line.strip()
    return ""


def _parse_python_result(record: dict[str, Any]) -> None:
    combined = record["stderr_tail"]
    ran_matches = list(RAN_RE.finditer(combined))
    matched = int(ran_matches[-1].group(1)) if ran_matches else 0
    last = _last_nonempty_line(combined)
    skipped_match = SKIPPED_RE.search(last)
    skipped = int(skipped_match.group(1)) if skipped_match else 0
    record["matched"] = max(0, matched - skipped)

    failures_match = FAILURES_RE.search(last)
    errors_match = ERRORS_RE.search(last)
    if failures_match or errors_match:
        record["failed"] = (int(failures_match.group(1)) if failures_match else 0) + (
            int(errors_match.group(1)) if errors_match else 0
        )
    elif record["exit_code"] != 0 and record["matched"] > 0:
        record["failed"] = 1
    elif record["exit_code"] not in (0, 5) and record["matched"] == 0:
        record["error"] = f"unittest crashed: {record['exit_code']}"


def _run_python(root: Path, selector: str) -> None:
    tests_dir = root / "scripts" / "tests"
    if not tests_dir.is_dir():
        return
    argv = [
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        "scripts/tests",
        "-p",
        "test_*.py",
        "-k",
        f"test_{selector}_",
    ]
    record = _new_record("python", "scripts/tests", argv)
    global _CURRENT_RECORD
    _CURRENT_RECORD = record
    try:
        _execute(record, root, "unittest")
        if record["error"] != "timeout":
            _parse_python_result(record)
    finally:
        _FAMILY_RECORDS.append(record)
        _CURRENT_RECORD = None


def _contains_selector(test_file: Path, marker: str) -> bool:
    try:
        return marker in test_file.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False


def _matching_typescript_packages(root: Path, selector: str) -> list[Path]:
    marker = f"test_{selector}_"
    matches: list[Path] = []
    for package_name in ("foam-vscode", "foam-graph"):
        package_dir = root / "packages" / package_name
        src_dir = package_dir / "src"
        if not package_dir.is_dir() or not src_dir.is_dir():
            continue
        found = False
        for path in src_dir.rglob("*.test.ts"):
            relative_parts = path.relative_to(src_dir).parts
            if any(
                part in {"node_modules", "out", "dist"}
                for part in relative_parts
            ):
                continue
            if _contains_selector(path, marker):
                found = True
                break
        if found:
            matches.append(package_dir)
    return matches


def _vitest_path(root: Path) -> Path:
    if "PA_HUB_VITEST_BIN" in os.environ:
        value = Path(os.environ["PA_HUB_VITEST_BIN"])
        return value if value.is_absolute() else (root / value).resolve()
    return root / "node_modules" / ".bin" / "vitest"


def _read_vitest_report(path: Path, record: dict[str, Any]) -> None:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        test_results = report["testResults"]
        if not isinstance(report, dict) or not isinstance(test_results, list):
            raise ValueError
        matched = 0
        failed = 0
        for result in test_results:
            assertions = result["assertionResults"]
            if not isinstance(assertions, list):
                raise ValueError
            for assertion in assertions:
                status = assertion["status"]
                if status in {"passed", "failed"}:
                    matched += 1
                if status == "failed":
                    failed += 1
        record["matched"] = matched
        record["failed"] = failed
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        record["error"] = f"vitest report unreadable: {path}"


def _run_vitest(root: Path, selector: str, report_dir: Path) -> None:
    packages = _matching_typescript_packages(root, selector)
    if not packages:
        return
    vitest = _vitest_path(root)
    marker = f"test_{selector}_"
    for index, package_dir in enumerate(packages):
        report_path = report_dir / f"vitest_{index}.json"
        argv = [
            str(vitest),
            "run",
            "--root",
            str(package_dir),
            "-t",
            marker,
            "--reporter=json",
            f"--outputFile={report_path}",
            "--passWithNoTests",
        ]
        record = _new_record("vitest", str(package_dir), argv)
        global _CURRENT_RECORD
        _CURRENT_RECORD = record
        try:
            if not vitest.is_file() or not os.access(vitest, os.X_OK):
                record["error"] = f"vitest executable missing: {vitest}"
            else:
                _execute(record, package_dir, "vitest")
                if record["error"] != "timeout":
                    _read_vitest_report(report_path, record)
                    if record["exit_code"] not in (0, None) and record["error"] is None:
                        record["error"] = f"vitest exited: {record['exit_code']}"
        finally:
            _FAMILY_RECORDS.append(record)
            _CURRENT_RECORD = None


def _aggregate(selector: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    matched = sum(int(record["matched"]) for record in records)
    failed = sum(int(record["failed"]) for record in records)
    if _TIMED_OUT:
        result = "TIMEOUT"
    elif failed or any(record["error"] is not None for record in records):
        result = "FAIL"
    elif matched == 0:
        result = "NO_TESTS"
    else:
        result = "PASS"
    return {
        "selector": selector,
        "result": result,
        "matched": matched,
        "failed": failed,
        "families": records,
        "duration_s": round(time.monotonic() - _INVOCATION_START, 3),
    }


def _print_tail(label: str, value: str) -> None:
    if not value:
        return
    for line in value.splitlines():
        print(f"{label} {line}")


def _emit(result_object: dict[str, Any]) -> None:
    result = result_object["result"]
    for record in result_object["families"]:
        print(
            "family={family} target={target} matched={matched} failed={failed} {duration:.3f}s".format(
                family=record["family"],
                target=record["target"],
                matched=record["matched"],
                failed=record["failed"],
                duration=record["duration_s"],
            )
        )
        if result != "PASS":
            _print_tail("stdout_tail", record["stdout_tail"])
            _print_tail("stderr_tail", record["stderr_tail"])
    if _JSON_ENABLED:
        print(json.dumps(result_object, separators=(",", ":")))
    print(f"{result} {result_object['selector']}")


def _outer_timeout(_signum: int, _frame: Any) -> None:
    global _TIMED_OUT
    _TIMED_OUT = True
    if _CURRENT_PROCESS is not None:
        _kill_process_group(_CURRENT_PROCESS)
    records = list(_FAMILY_RECORDS)
    if _CURRENT_RECORD is not None:
        current = dict(_CURRENT_RECORD)
        current["error"] = "timeout"
        current["duration_s"] = round(time.monotonic() - _INVOCATION_START, 3)
        records.append(current)
    if _SELECTOR is not None:
        _emit(_aggregate(_SELECTOR, records))
    raise SystemExit(124)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = _ArgumentParser(add_help=False)
    parser.add_argument("-k", dest="selector", required=True)
    parser.add_argument("--root")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not SELECTOR_RE.fullmatch(args.selector):
        parser.error(f"invalid selector: {args.selector}")
    return args


def main(argv: list[str] | None = None) -> int:
    global _CHILD_DEADLINE, _INVOCATION_START, _JSON_ENABLED, _SELECTOR

    args = _parse_args(sys.argv[1:] if argv is None else argv)
    _SELECTOR = args.selector
    _JSON_ENABLED = args.json
    _INVOCATION_START = time.monotonic()
    _CHILD_DEADLINE = _INVOCATION_START + CHILD_BUDGET_S

    signal.signal(signal.SIGALRM, _outer_timeout)
    signal.setitimer(signal.ITIMER_REAL, OUTER_DEADLINE_S)
    try:
        root = _root_from_arg(args.root)
        report_dir = Path(tempfile.mkdtemp(prefix="pa_hub_gate_", dir="/tmp"))
        try:
            _run_python(root, args.selector)
            if not _TIMED_OUT:
                _run_vitest(root, args.selector, report_dir)
        finally:
            # The report directory is the adapter's only output location.
            for path in report_dir.iterdir():
                path.unlink()
            report_dir.rmdir()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)

    result_object = _aggregate(args.selector, _FAMILY_RECORDS)
    _emit(result_object)
    return {"PASS": 0, "FAIL": 1, "NO_TESTS": 1, "TIMEOUT": 124}[
        result_object["result"]
    ]


if __name__ == "__main__":
    raise SystemExit(main())
