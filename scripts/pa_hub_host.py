#!/usr/bin/env python3
"""Run and verify PA Hub host receipts.

Receipt schema: ``pa-hub-host-receipt/1``.  The H04/H05 command templates encoded
here are: isolated install, list extensions, list extensions again, each with
the same ``--extensions-dir`` and ``--user-data-dir``; the demo template is
``code-insiders --new-window <synthetic-workspace>`` with those same flags.
The second isolated command's log is the list-extensions artifact.  This is
the strict reading of the supplied H04 summary because the packet did not
include a more specific third argv template; repeating the listing gives a
second observable check without launching a live profile.

Stricter decisions made here: malformed or incomplete receipts collect schema
reasons and are never accepted; missing or unsafe executable paths produce a
failed receipt without launching; all relative paths are interpreted under
the explicit root; input, output, and artifact paths that escape the root are
treated as missing; digest and mtime checks are independent; isolation checks
run even when a receipt is otherwise failed; and a missing expected artifact
keeps a runner receipt ``ok`` false.  Version probes use the same cleaned,
session-isolated process environment as host commands.  The verifier only
reads files and git metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any


SCHEMA = "pa-hub-host-receipt/1"
STEPS = ("validate", "e2e", "package", "isolated-install", "demo")
RECEIPT_FILES = {
    "validate": "validate.json",
    "e2e": "e2e.json",
    "package": "package.json",
    "isolated-install": "installed.json",
    "demo": "delivery.json",
}
VSIX_PATH = Path("artifacts/pa-hub/pa-hub.vsix")
E2E_NODE_SCRIPT = Path("packages/foam-vscode/out/test/run-e2e.js")
HOST_LOG_REL = Path("logs/pa-hub/host")
HOST_TMP_REL = HOST_LOG_REL / "tmp"
COMMAND_TIMEOUT_S = 1800.0
VERSION_TIMEOUT_S = 30.0
BIN_ENV = {
    "yarn": "PA_HUB_HOST_YARN_BIN",
    "code": "PA_HUB_HOST_CODE_BIN",
    "node": "PA_HUB_HOST_NODE_BIN",
}


STEP_COMMANDS = {
    "validate": [
        ["<yarn>", "install"],
        ["<yarn>", "install", "--frozen-lockfile"],
        ["<yarn>", "build"],
        ["<yarn>", "workspace", "pa-hub", "compile"],
        [
            "<yarn>",
            "workspace",
            "@foam/graph-view",
            "exec",
            "tsc",
            "-p",
            "tsconfig.build.json",
            "--noEmit",
        ],
        ["<yarn>", "lint"],
        ["<yarn>", "test:unit"],
    ],
    "package": [["<yarn>", "package"]],
    "e2e": [["<node>", str(E2E_NODE_SCRIPT)]],
    "isolated-install": [
        [
            "<code>",
            "--install-extension",
            str(VSIX_PATH),
            "--extensions-dir",
            "<fresh-temp-extensions>",
            "--user-data-dir",
            "<fresh-temp-user-data>",
            "--force",
        ],
        [
            "<code>",
            "--list-extensions",
            "--show-versions",
            "--extensions-dir",
            "<fresh-temp-extensions>",
            "--user-data-dir",
            "<fresh-temp-user-data>",
        ],
        [
            "<code>",
            "--list-extensions",
            "--show-versions",
            "--extensions-dir",
            "<fresh-temp-extensions>",
            "--user-data-dir",
            "<fresh-temp-user-data>",
        ],
    ],
    "demo": [
        [
            "<code>",
            "--new-window",
            "<synthetic-workspace>",
            "--extensions-dir",
            "<fresh-temp-extensions>",
            "--user-data-dir",
            "<fresh-temp-user-data>",
        ]
    ],
}


def _fx_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _root_from_arg(value: str | None) -> Path:
    if value is None:
        return _fx_root()
    path = Path(value)
    if not path.is_absolute():
        path = _fx_root() / path
    return path.resolve()


def receipt_path(step: str, root: Path | str) -> Path:
    """Return the receipt path for a valid step."""

    if step not in RECEIPT_FILES:
        raise ValueError(f"unknown step: {step}")
    return Path(root).resolve() / HOST_LOG_REL / RECEIPT_FILES[step]


def _now() -> float:
    override = os.environ.get("PA_HUB_HOST_NOW")
    if override is not None:
        try:
            return float(override)
        except ValueError:
            pass
    return time.time()


def _max_age() -> float:
    value = os.environ.get("PA_HUB_HOST_MAX_AGE_S", "86400")
    try:
        return float(value)
    except ValueError:
        return 86400.0


def _clean_env() -> dict[str, str]:
    """Build the only environment a launched process may receive."""

    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "LANG": "C.UTF-8",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    }
    for variable in BIN_ENV.values():
        if variable in os.environ:
            env[variable] = os.environ[variable]
    return env


def _popen_git(root: Path, args: list[str]) -> tuple[int, bytes, bytes]:
    try:
        process = subprocess.Popen(
            ["git", *args],
            cwd=str(root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env=_clean_env(),
        )
    except OSError:
        return 127, b"", b""
    try:
        stdout, stderr = process.communicate(timeout=30.0)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        stdout, stderr = process.communicate(timeout=5.0)
        return -9, stdout, stderr
    return process.returncode, stdout, stderr


def _git_text(root: Path, args: list[str]) -> str:
    returncode, stdout, _ = _popen_git(root, args)
    if returncode != 0:
        return ""
    return stdout.decode("utf-8", errors="replace")


def _git_head(root: Path) -> str:
    return _git_text(root, ["rev-parse", "HEAD"]).strip()


def _git_dirty(root: Path) -> bool:
    return bool(_git_text(root, ["status", "--porcelain"]))


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str | None:
    try:
        if path.is_symlink():
            return _sha256_bytes(os.readlink(path).encode("utf-8"))
        if not path.is_file():
            return None
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _is_excluded(relpath: str) -> bool:
    parts = PurePosixPath(relpath).parts
    return any(
        part in {"node_modules", "out", "dist", "logs", "artifacts", ".git"}
        for part in parts
    )


def _is_untracked_input(relpath: str) -> bool:
    if relpath in {"package.json", "yarn.lock"}:
        return True
    parts = PurePosixPath(relpath).parts
    if len(parts) >= 3 and parts[0] == "packages" and parts[2] == "src":
        return True
    if len(parts) == 3 and parts[0] == "packages" and parts[2] == "package.json":
        return True
    return bool(parts and parts[0] == "scripts")


def _git_paths(root: Path, args: list[str]) -> list[str]:
    text = _git_text(root, args)
    return [item for item in text.split("\0") if item]


def _input_digest(inputs: dict[str, str]) -> str:
    material = "".join(
        f"{relpath}\0{inputs[relpath]}\n" for relpath in sorted(inputs)
    ).encode("utf-8")
    return _sha256_bytes(material)


def _input_closure(root: Path) -> tuple[dict[str, str], str, float]:
    relpaths = {
        relpath
        for relpath in _git_paths(root, ["ls-files", "-z"])
        if not _is_excluded(relpath)
    }
    relpaths.update(
        relpath
        for relpath in _git_paths(
            root, ["ls-files", "-z", "--others", "--exclude-standard"]
        )
        if not _is_excluded(relpath) and _is_untracked_input(relpath)
    )
    inputs: dict[str, str] = {}
    for relpath in sorted(relpaths):
        digest = _sha256_file(root / relpath)
        if digest is not None:
            inputs[relpath] = digest
    hashed_at = _now()
    return inputs, _input_digest(inputs), hashed_at


def _which(value: str, root: Path) -> Path | None:
    if not value:
        return None
    if not os.path.isabs(value) and ("/" in value or value.startswith(".")):
        candidate = (root / value).resolve()
        return candidate if candidate.is_file() and os.access(candidate, os.X_OK) else None
    found = shutil.which(value)
    if found is None:
        return None
    candidate = Path(found)
    if not candidate.is_absolute():
        candidate = (root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate if candidate.is_file() and os.access(candidate, os.X_OK) else None


def _live_profile_roots() -> list[Path]:
    home = os.environ.get("HOME", "")
    if not home:
        return []
    return [
        Path(home).resolve() / "Library/Application Support/Code - Insiders",
        Path(home).resolve() / ".vscode-insiders",
    ]


def _under(path: Path, parent: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(parent.resolve(strict=False))
    except ValueError:
        return False
    return True


def _is_live_profile_path(value: str) -> bool:
    if not os.path.isabs(value):
        return False
    candidate = Path(value).resolve(strict=False)
    return any(_under(candidate, profile) for profile in _live_profile_roots())


def _resolve_executables(root: Path) -> dict[str, Path | None]:
    defaults = {"yarn": "yarn", "code": "code-insiders", "node": "node"}
    resolved: dict[str, Path | None] = {}
    for kind, variable in BIN_ENV.items():
        value = os.environ.get(variable, defaults[kind])
        candidate = _which(value, root)
        if kind == "code" and candidate is not None and any(
            _under(candidate, profile) for profile in _live_profile_roots()
        ):
            candidate = None
        resolved[kind] = candidate
    return resolved


def _probe_version(root: Path, executable: Path | None) -> str | None:
    if executable is None:
        return None
    try:
        process = subprocess.Popen(
            [str(executable), "--version"],
            cwd=str(root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=_clean_env(),
        )
    except OSError:
        return None
    try:
        output, _ = process.communicate(timeout=VERSION_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            process.communicate(timeout=5.0)
        except subprocess.TimeoutExpired:
            pass
        return None
    if process.returncode != 0:
        return None
    for line in output.decode("utf-8", errors="replace").splitlines():
        if line.strip():
            return line.strip()
    return None


def _instantiate_commands(
    step: str,
    executables: dict[str, Path | None],
    isolation: dict[str, str | None],
) -> list[list[str]]:
    substitutions = {
        "<yarn>": str(executables["yarn"] or "<missing-yarn>"),
        "<code>": str(executables["code"] or "<missing-code-insiders>"),
        "<node>": str(executables["node"] or "<missing-node>"),
        "<fresh-temp-extensions>": isolation["extensions_dir"] or "<missing-extensions-dir>",
        "<fresh-temp-user-data>": isolation["user_data_dir"] or "<missing-user-data-dir>",
        "<synthetic-workspace>": isolation["workspace"] or "<missing-workspace>",
    }
    return [
        [substitutions.get(token, token) for token in template]
        for template in STEP_COMMANDS[step]
    ]


def _run_command(
    root: Path,
    argv: list[str],
    log_path: Path,
) -> tuple[int, bool]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if argv[0].startswith("<missing-"):
        log_path.write_text(f"unavailable executable: {argv[0]}\n", encoding="utf-8")
        return 127, False
    with log_path.open("wb") as log:
        try:
            process = subprocess.Popen(
                argv,
                cwd=str(root),
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=_clean_env(),
            )
        except OSError as exc:
            log.write(f"launch failed: {exc}\n".encode("utf-8", errors="replace"))
            return 127, False
        try:
            returncode = process.wait(timeout=COMMAND_TIMEOUT_S)
            return returncode, False
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                process.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                pass
            return -9, True


def _relative_root_path(root: Path, path: Path) -> str:
    return path.resolve(strict=False).relative_to(root.resolve(strict=False)).as_posix()


def _write_workspace(tmp_root: Path) -> Path:
    workspace_dir = Path(
        tempfile.mkdtemp(prefix="workspace_", dir=str(tmp_root))
    )
    workspace = workspace_dir / "synthetic.code-workspace"
    workspace.write_text('{"folders": []}\n', encoding="utf-8")
    return workspace


def _find_demo_screenshot(tmp_root: Path) -> Path | None:
    for path in sorted(tmp_root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            return path
    return None


def _artifact_map(
    step: str,
    root: Path,
    isolation: dict[str, str | None],
    log_paths: list[Path],
) -> dict[str, str]:
    candidates: list[Path] = []
    if step == "package":
        candidates.append(root / VSIX_PATH)
    elif step == "isolated-install" and len(log_paths) >= 2:
        candidates.append(log_paths[1])
    elif step == "demo":
        if isolation["workspace"]:
            candidates.append(Path(isolation["workspace"]))
        screenshot = _find_demo_screenshot(root / HOST_TMP_REL)
        if screenshot is not None:
            candidates.append(screenshot)
    result: dict[str, str] = {}
    for path in candidates:
        digest = _sha256_file(path)
        if digest is not None:
            result[_relative_root_path(root, path)] = digest
    return result


def _run_step(step: str, root: Path) -> dict[str, Any]:
    wall_started = time.monotonic()
    started_at = _now()
    host_dir = root / HOST_LOG_REL
    head = _git_head(root)
    dirty = _git_dirty(root)
    inputs, inputs_digest, inputs_hashed_at = _input_closure(root)
    host_dir.mkdir(parents=True, exist_ok=True)
    executables = _resolve_executables(root)
    isolation: dict[str, str | None] = {
        "extensions_dir": None,
        "user_data_dir": None,
        "workspace": None,
    }
    tmp_root = root / HOST_TMP_REL
    if step in {"isolated-install", "demo"}:
        tmp_root.mkdir(parents=True, exist_ok=True)
        isolation["extensions_dir"] = tempfile.mkdtemp(
            prefix="extensions_", dir=str(tmp_root)
        )
        isolation["user_data_dir"] = tempfile.mkdtemp(
            prefix="user_data_", dir=str(tmp_root)
        )
        if step == "demo":
            isolation["workspace"] = str(_write_workspace(tmp_root))

    version_values = {
        "python": sys.version.split()[0],
        "node": _probe_version(root, executables["node"]),
        "yarn": _probe_version(root, executables["yarn"]),
    }
    argv_lists = _instantiate_commands(step, executables, isolation)
    commands = [shlex.join(argv) for argv in argv_lists]
    exit_codes: list[int] = []
    timeouts: list[bool] = []
    log_paths: list[Path] = []
    for index, argv in enumerate(argv_lists, start=1):
        log_path = host_dir / f"{step}-{index}.log"
        returncode, timed_out = _run_command(root, argv, log_path)
        log_paths.append(log_path)
        exit_codes.append(returncode)
        timeouts.append(timed_out)
        if returncode != 0:
            break

    outputs: dict[str, str] = {}
    for path in log_paths:
        digest = _sha256_file(path)
        if digest is not None:
            outputs[_relative_root_path(root, path)] = digest
    artifacts = _artifact_map(step, root, isolation, log_paths)
    expected_present = True
    if step == "package":
        expected_present = (root / VSIX_PATH).is_file()
    elif step == "isolated-install":
        expected_present = len(log_paths) >= 2 and log_paths[1].is_file()
    elif step == "demo":
        expected_present = bool(isolation["workspace"]) and Path(
            isolation["workspace"]
        ).is_file()
    ok = bool(exit_codes) and all(code == 0 for code in exit_codes) and not any(
        timeouts
    ) and len(exit_codes) == len(argv_lists) and expected_present
    finished_at = _now()
    receipt: dict[str, Any] = {
        "schema": SCHEMA,
        "step": step,
        "root": str(root),
        "head": head,
        "dirty": dirty,
        "inputs": inputs,
        "inputs_digest": inputs_digest,
        "inputs_hashed_at": inputs_hashed_at,
        "commands": commands,
        "argv": argv_lists,
        "executables": {
            kind: str(path) if path is not None else None
            for kind, path in executables.items()
        },
        "tool_versions": version_values,
        "exit_codes": exit_codes,
        "timeouts": timeouts,
        "outputs": outputs,
        "artifacts": artifacts,
        "isolation": isolation,
        "started_at": started_at,
        "finished_at": finished_at,
        "wall_seconds": round(max(0.0, time.monotonic() - wall_started), 3),
        "ok": ok,
    }
    path = receipt_path(step, root)
    temporary = host_dir / f".{path.name}.{os.getpid()}.tmp"
    temporary.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)
    return receipt


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _schema_reasons(receipt: dict[str, Any]) -> list[str]:
    reasons: list[str] = []

    def need(name: str, valid: bool) -> None:
        if name not in receipt:
            reasons.append(f"schema: missing {name}")
        elif not valid:
            reasons.append(f"schema: invalid {name}")

    need("schema", isinstance(receipt.get("schema"), str) and receipt.get("schema") == SCHEMA)
    need("step", isinstance(receipt.get("step"), str))
    need("root", isinstance(receipt.get("root"), str))
    need("head", isinstance(receipt.get("head"), str))
    need("dirty", isinstance(receipt.get("dirty"), bool))
    inputs = receipt.get("inputs")
    need(
        "inputs",
        isinstance(inputs, dict)
        and all(isinstance(key, str) and isinstance(value, str) for key, value in inputs.items()),
    )
    need("inputs_digest", isinstance(receipt.get("inputs_digest"), str))
    need("inputs_hashed_at", _is_number(receipt.get("inputs_hashed_at")))
    commands = receipt.get("commands")
    need("commands", isinstance(commands, list) and all(isinstance(item, str) for item in commands))
    argv = receipt.get("argv")
    need(
        "argv",
        isinstance(argv, list)
        and all(
            isinstance(item, list) and all(isinstance(arg, str) for arg in item)
            for item in argv
        ),
    )
    executables = receipt.get("executables")
    need(
        "executables",
        isinstance(executables, dict)
        and all(
            key in executables and (executables[key] is None or isinstance(executables[key], str))
            for key in ("yarn", "code", "node")
        ),
    )
    versions = receipt.get("tool_versions")
    need(
        "tool_versions",
        isinstance(versions, dict)
        and isinstance(versions.get("python"), str)
        and all(
            key in versions and (versions[key] is None or isinstance(versions[key], str))
            for key in ("node", "yarn")
        ),
    )
    exit_codes = receipt.get("exit_codes")
    need(
        "exit_codes",
        isinstance(exit_codes, list)
        and all(isinstance(item, int) and not isinstance(item, bool) for item in exit_codes),
    )
    timeouts = receipt.get("timeouts")
    need("timeouts", isinstance(timeouts, list) and all(isinstance(item, bool) for item in timeouts))
    for name in ("outputs", "artifacts"):
        value = receipt.get(name)
        need(
            name,
            isinstance(value, dict)
            and all(isinstance(key, str) and isinstance(item, str) for key, item in value.items()),
        )
    isolation = receipt.get("isolation")
    need(
        "isolation",
        isinstance(isolation, dict)
        and all(
            key in isolation
            and (isolation[key] is None or isinstance(isolation[key], str))
            for key in ("extensions_dir", "user_data_dir", "workspace")
        ),
    )
    for name in ("started_at", "finished_at", "wall_seconds"):
        need(name, _is_number(receipt.get(name)))
    need("ok", isinstance(receipt.get("ok"), bool))
    if isinstance(commands, list) and isinstance(argv, list) and len(commands) != len(argv):
        reasons.append("schema: commands and argv length mismatch")
    if isinstance(exit_codes, list) and isinstance(timeouts, list) and len(exit_codes) != len(timeouts):
        reasons.append("schema: exit_codes and timeouts length mismatch")
    return reasons


def _safe_path(root: Path, relpath: str) -> Path | None:
    path = PurePosixPath(relpath)
    if path.is_absolute() or ".." in path.parts:
        return None
    return root.joinpath(*path.parts)


def _append_capped(reasons: list[str], tag: str, paths: list[str]) -> None:
    for relpath in paths[:20]:
        reasons.append(f"{tag}: {relpath}")
    if len(paths) > 20:
        reasons.append(f"{tag}: ... +{len(paths) - 20} more")


def _verify_isolation(
    step: str, root: Path, receipt: dict[str, Any], reasons: list[str]
) -> None:
    if step not in {"isolated-install", "demo"}:
        return
    isolation = receipt.get("isolation")
    if not isinstance(isolation, dict):
        return
    tmp_root = (root / HOST_TMP_REL).resolve(strict=False)
    extension_value = isolation.get("extensions_dir")
    user_value = isolation.get("user_data_dir")
    extension_path = Path(extension_value) if isinstance(extension_value, str) else None
    user_path = Path(user_value) if isinstance(user_value, str) else None
    if extension_path is None or not extension_path.is_absolute() or not _under(extension_path, tmp_root):
        reasons.append("isolation: invalid extensions_dir")
    if user_path is None or not user_path.is_absolute() or not _under(user_path, tmp_root):
        reasons.append("isolation: invalid user_data_dir")
    if extension_path is not None and user_path is not None:
        if extension_path.resolve(strict=False) == user_path.resolve(strict=False):
            reasons.append("isolation: extensions_dir and user_data_dir are not distinct")

    executables = receipt.get("executables")
    code = executables.get("code") if isinstance(executables, dict) else None
    argv_values = receipt.get("argv")
    if not isinstance(argv_values, list):
        return
    for index, argv in enumerate(argv_values):
        if not isinstance(argv, list) or not argv or not isinstance(code, str) or argv[0] != code:
            continue
        if any(_is_live_profile_path(arg) for arg in argv):
            reasons.append(f"isolation: live profile path in argv {index}")
        for flag, expected in (
            ("--extensions-dir", extension_value),
            ("--user-data-dir", user_value),
        ):
            if flag not in argv:
                reasons.append(f"isolation: argv {index} lacks {flag}")
                continue
            flag_index = argv.index(flag)
            actual = argv[flag_index + 1] if flag_index + 1 < len(argv) else None
            if not isinstance(expected, str) or actual != expected:
                reasons.append(f"isolation: argv {index} has wrong {flag}")


def verify_receipt(
    step: str, root: Path | str, *, now: float | None = None
) -> dict[str, Any]:
    """Verify one receipt and return exactly ``ok``, ``reasons``, ``receipt``, and ``path``."""

    if step not in RECEIPT_FILES:
        raise ValueError(f"unknown step: {step}")
    resolved_root = Path(root).resolve()
    path = receipt_path(step, resolved_root)
    result_path = str(path)
    if not path.is_file():
        return {
            "ok": False,
            "reasons": [f"receipt missing: {path}"],
            "receipt": None,
            "path": result_path,
        }
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - verifier reports unreadable evidence.
        return {
            "ok": False,
            "reasons": [f"receipt unreadable: {exc}"],
            "receipt": None,
            "path": result_path,
        }
    if not isinstance(parsed, dict):
        return {
            "ok": False,
            "reasons": ["receipt unreadable: expected JSON object"],
            "receipt": None,
            "path": result_path,
        }
    receipt = parsed
    reasons = _schema_reasons(receipt)
    if isinstance(receipt.get("step"), str) and receipt["step"] != step:
        reasons.append(f"misrouted: step {receipt['step']} in receipt for {step}")
    if isinstance(receipt.get("root"), str) and receipt["root"] != str(resolved_root):
        reasons.append(f"misrouted: root {receipt['root']}")

    effective_now = _now() if now is None else float(now)
    finished = receipt.get("finished_at")
    started = receipt.get("started_at")
    inputs_hashed_at = receipt.get("inputs_hashed_at")
    if _is_number(finished):
        age = effective_now - float(finished)
        if age > _max_age():
            reasons.append(f"stale: age {age:g}s > {_max_age():g}")
        if float(finished) > effective_now + 60:
            reasons.append(f"future: finished_at {finished:g} > now {effective_now:g}")
    if _is_number(started) and _is_number(finished) and float(started) > float(finished):
        reasons.append("ordering: started_at > finished_at")
    if _is_number(inputs_hashed_at) and _is_number(started) and float(inputs_hashed_at) > float(started):
        reasons.append("ordering: inputs_hashed_at > started_at")

    exit_codes = receipt.get("exit_codes")
    timeouts = receipt.get("timeouts")
    if isinstance(exit_codes, list) and isinstance(timeouts, list):
        if any(code != 0 for code in exit_codes) or any(timeouts):
            reasons.append(f"failed: exit_codes {exit_codes}")
    if receipt.get("ok") is False:
        reasons.append("failed: ok false")

    inputs = receipt.get("inputs")
    if isinstance(inputs, dict):
        changed: list[str] = []
        newer: list[str] = []
        for relpath, expected in sorted(inputs.items()):
            if not isinstance(relpath, str) or not isinstance(expected, str):
                continue
            current_path = _safe_path(resolved_root, relpath)
            current_digest = _sha256_file(current_path) if current_path is not None else None
            if current_digest != expected:
                changed.append(relpath)
            if current_path is not None and _is_number(started):
                try:
                    if current_path.stat().st_mtime > float(started):
                        newer.append(relpath)
                except OSError:
                    pass
        _append_capped(reasons, "inputs changed", changed)
        _append_capped(reasons, "inputs newer", newer)
        if _input_digest(inputs) != receipt.get("inputs_digest"):
            reasons.append("inputs digest mismatch")

    for field_name, changed_tag, missing_tag in (
        ("artifacts", "artifact changed", "artifact missing"),
        ("outputs", "output changed", "output missing"),
    ):
        values = receipt.get(field_name)
        if not isinstance(values, dict):
            continue
        for relpath, expected in sorted(values.items()):
            if not isinstance(relpath, str) or not isinstance(expected, str):
                continue
            current_path = _safe_path(resolved_root, relpath)
            current_digest = _sha256_file(current_path) if current_path is not None else None
            if current_digest is None:
                reasons.append(f"{missing_tag}: {relpath}")
            elif current_digest != expected:
                reasons.append(f"{changed_tag}: {relpath}")

    receipt_head = receipt.get("head")
    if isinstance(receipt_head, str):
        current_head = _git_head(resolved_root)
        if current_head != receipt_head:
            reasons.append(f"head changed: {receipt_head} -> {current_head}")
    if receipt.get("dirty") is True and step in {"package", "isolated-install", "demo"}:
        reasons.append("dirty run")
    _verify_isolation(step, resolved_root, receipt, reasons)
    return {
        "ok": not reasons,
        "reasons": reasons,
        "receipt": receipt,
        "path": result_path,
    }


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self._print_message(f"USAGE {message}\n", sys.stderr)
        raise SystemExit(2)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = _ArgumentParser(add_help=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--step")
    group.add_argument("--verify")
    parser.add_argument("--root")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    selected = args.step or args.verify
    if selected not in RECEIPT_FILES:
        parser.error(f"unknown step: {selected}")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    root = _root_from_arg(args.root)
    if args.verify is not None:
        result = verify_receipt(args.verify, root)
        for reason in result["reasons"]:
            print(reason, file=sys.stderr)
        print(f"{'PASS' if result['ok'] else 'FAIL'} verify {args.verify}")
        return 0 if result["ok"] else 1
    receipt = _run_step(args.step, root)
    if args.json:
        print(json.dumps(receipt, separators=(",", ":"), sort_keys=True))
    print(f"{'PASS' if receipt['ok'] else 'FAIL'} {args.step}")
    return 0 if receipt["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
