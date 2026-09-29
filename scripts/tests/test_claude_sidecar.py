import difflib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / 'logs/pa-hub/host/statusline.snapshot.2026-09-24.mjs'
PATCHED = ROOT / 'scripts/pa-hub/statusline.mjs'
HARNESS = ROOT / 'scripts/fixtures/statusline-sandbox.mjs'
NODE = 'node'
SENTINEL = 'SYNTHETIC_SENTINEL_9f3c'


def synthetic_input(include_resets=True):
    five_hour = {'used_percentage': 42}
    seven_day = {'used_percentage': 7}
    if include_resets:
        five_hour['resets_at'] = 4102444800
        seven_day['resets_at'] = 4102444800
    return {
        'model': {'id': 'claude-fable-5-1', 'display_name': 'Fable'},
        'rate_limits': {'five_hour': five_hour, 'seven_day': seven_day},
        'cost': SENTINEL,
        'session_id': SENTINEL,
        'cwd': SENTINEL,
        'transcript_path': SENTINEL,
        'workspace': SENTINEL,
        'context_window': {'used_percentage': 11, 'context_window_size': 200000},
    }


class ClaudeSidecarTests(unittest.TestCase):
    def _run_harness(self, temp_dir, value, statusline=PATCHED, extra=None, raw=False):
        input_path = Path(temp_dir) / 'input.json'
        input_path.write_text(value if raw else json.dumps(value), encoding='utf-8')
        command = [
            NODE,
            str(HARNESS),
            '--statusline',
            str(statusline),
            '--input',
            str(input_path),
            '--json',
        ]
        if extra:
            command.extend(extra)
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired as error:
            self.fail(f'harness timed out: {error}')
        if completed.returncode != 0:
            self.fail(f'harness failed: rc={completed.returncode}\nstdout={completed.stdout}\nstderr={completed.stderr}')
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            self.fail(f'harness did not return JSON: {error}\n{completed.stdout}')
        sandbox_root = result.get('sandbox_root')
        if sandbox_root:
            shutil.rmtree(sandbox_root, ignore_errors=True)
        return result

    def test_claude_sidecar_writes_allowlisted_keys(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, synthetic_input())
        self.assertTrue(result['state_exists'])
        payload = json.loads(result['state_text'])
        self.assertEqual(list(payload), ['five_hour', 'seven_day', 'model', 'written_at'])
        self.assertEqual(payload['five_hour'], {'used_percentage': 42, 'resets_at': 4102444800})
        self.assertEqual(payload['seven_day'], {'used_percentage': 7, 'resets_at': 4102444800})
        self.assertEqual(payload['model'], {'id': 'claude-fable-5-1', 'display_name': 'Fable'})
        written_at = datetime.fromisoformat(payload['written_at'].replace('Z', '+00:00'))
        self.assertLess(abs((datetime.now(timezone.utc) - written_at).total_seconds()), 60)
        self.assertTrue(all(child['exit_code'] == 0 for child in result['children']))

    def test_claude_sidecar_no_leak(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, synthetic_input())
        for forbidden in (SENTINEL, 'cost', 'session_id', 'cwd'):
            self.assertNotIn(forbidden, result['state_text'])

    def test_claude_sidecar_missing_rate_limits(self):
        value = synthetic_input()
        value.pop('rate_limits')
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, value)
        payload = json.loads(result['state_text'])
        self.assertIsNone(payload['five_hour'])
        self.assertIsNone(payload['seven_day'])
        self.assertEqual(len(result['children'][0]['stdout'].splitlines()), 7)
        self.assertEqual(result['children'][0]['exit_code'], 0)

    def test_claude_sidecar_partial_fields(self):
        value = synthetic_input()
        value['rate_limits'] = {'five_hour': {'used_percentage': '12'}, 'seven_day': {'resets_at': 5}}
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, value)
        payload = json.loads(result['state_text'])
        self.assertEqual(payload['five_hour'], {'used_percentage': None, 'resets_at': None})
        self.assertEqual(payload['seven_day'], {'used_percentage': None, 'resets_at': 5})

    def test_claude_sidecar_invalid_stdin(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, 'not json', raw=True)
        payload = json.loads(result['state_text'])
        self.assertIsNone(payload['five_hour'])
        self.assertIsNone(payload['seven_day'])
        self.assertEqual(payload['model'], {'id': '', 'display_name': ''})
        self.assertEqual(result['children'][0]['exit_code'], 0)
        self.assertEqual(len(result['children'][0]['stdout'].splitlines()), 7)

    def test_claude_sidecar_write_failure_preserves_stdout(self):
        value = synthetic_input(include_resets=False)
        with tempfile.TemporaryDirectory() as temp_dir:
            parent_file = Path(temp_dir) / 'regular-file'
            parent_file.write_text('parent', encoding='utf-8')
            failure_state_dir = parent_file / 'state'
            failed = self._run_harness(temp_dir, value, extra=['--state-dir', str(failure_state_dir)])
            successful = self._run_harness(temp_dir, value)
        self.assertEqual(failed['children'][0]['exit_code'], 0)
        self.assertEqual(failed['children'][0]['stdout'], successful['children'][0]['stdout'])
        self.assertFalse(failed['state_exists'])

    def test_claude_sidecar_concurrent_renders(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, synthetic_input(), extra=['--parallel', '8'])
        self.assertEqual(len(result['children']), 8)
        self.assertTrue(all(child['exit_code'] == 0 for child in result['children']))
        self.assertTrue(all(len(child['stdout'].splitlines()) == 7 for child in result['children']))
        self.assertEqual(result['tmp_leftovers'], [])
        self.assertEqual(list(json.loads(result['state_text'])), ['five_hour', 'seven_day', 'model', 'written_at'])

    def test_claude_sidecar_refresh_path_does_not_write(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, synthetic_input(), extra=['--refresh'])
        self.assertFalse(result['state_exists'])
        self.assertEqual(result['children'][0]['exit_code'], 0)

    def test_claude_sidecar_stdout_parity_with_snapshot(self):
        value = synthetic_input(include_resets=False)
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_result = self._run_harness(temp_dir, value, statusline=SNAPSHOT)
            patched_result = self._run_harness(temp_dir, value, statusline=PATCHED)
        self.assertEqual(snapshot_result['children'][0]['stdout'], patched_result['children'][0]['stdout'])

    def test_claude_sidecar_source_is_snapshot_plus_insert(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._run_harness(temp_dir, synthetic_input(include_resets=False))
        snapshot_lines = SNAPSHOT.read_text(encoding='utf-8').splitlines(keepends=True)
        patched_lines = PATCHED.read_text(encoding='utf-8').splitlines(keepends=True)
        opcodes = difflib.SequenceMatcher(a=snapshot_lines, b=patched_lines).get_opcodes()
        insert_blocks = []
        for tag, i1, i2, j1, j2 in opcodes:
            self.assertIn(tag, ('equal', 'insert'))
            if tag == 'insert':
                insert_blocks.append(patched_lines[j1:j2])
        inserted_lines = [line for block in insert_blocks for line in block]
        inserted_text = ''.join(inserted_lines)
        self.assertLessEqual(len(insert_blocks), 2)
        self.assertLessEqual(len(inserted_lines), 70)
        for required in ('rate_limits.json', 'renameSync', 'written_at', 'PA_HUB_STATE_DIR'):
            self.assertIn(required, inserted_text)
        for forbidden in ('keychain', 'security ', 'stats-cache', 'oauth', 'http'):
            self.assertNotIn(forbidden, inserted_text.lower())

    def test_claude_sidecar_harness_env_isolation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run_harness(temp_dir, synthetic_input())
        sandbox_root = Path(result['sandbox_root'])
        expected_home = sandbox_root / 'home'
        self.assertTrue(str(result['state_file']).startswith(str(expected_home) + os.sep))
        self.assertNotIn(os.path.expanduser('~'), result['state_file'])


if __name__ == '__main__':
    unittest.main()
