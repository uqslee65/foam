#!/usr/bin/env node
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);

function flagValue(name, required = true) {
  const index = argv.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`missing ${name}`);
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${name}`);
  return value;
}

function hasFlag(name) {
  return argv.includes(name);
}

let statuslinePath;
let inputPath;
let homeArg;
let stateDirArg;
let parallel = 1;
try {
  statuslinePath = resolve(flagValue('--statusline'));
  inputPath = resolve(flagValue('--input'));
  homeArg = flagValue('--home', false);
  stateDirArg = flagValue('--state-dir', false);
  if (hasFlag('--parallel')) {
    parallel = Number.parseInt(flagValue('--parallel'), 10);
    if (!Number.isInteger(parallel) || parallel < 1) throw new Error('invalid --parallel');
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

const sandboxRoot = homeArg ? resolve(homeArg) : mkdtempSync(join(tmpdir(), 'statusline-sandbox-'));
const home = join(sandboxRoot, 'home');
const temp = join(sandboxRoot, 'tmp');
const bin = join(sandboxRoot, 'bin');
mkdirSync(home, { recursive: true });
mkdirSync(temp, { recursive: true });
mkdirSync(bin, { recursive: true });

const ccusage = join(bin, 'ccusage');
writeFileSync(ccusage, '#!/bin/sh\nprintf "{}"\n');
chmodSync(ccusage, 0o755);

const childEnv = {
  HOME: home,
  TMPDIR: temp,
  PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${dirname(process.execPath)}`,
};
if (stateDirArg !== undefined) childEnv.PA_HUB_STATE_DIR = resolve(stateDirArg);

const input = readFileSync(inputPath);
const refresh = hasFlag('--refresh');

function runChild() {
  const started = Date.now();
  const child = spawn(process.execPath, refresh ? [statuslinePath, '--refresh'] : [statuslinePath], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timer;

  return new Promise((resolveChild) => {
    const finish = (exitCode, finalStderr = stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveChild({
        exit_code: exitCode,
        stdout,
        stderr: finalStderr,
        duration_ms: Date.now() - started,
      });
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(-1, `${stderr}${error.message}`));
    child.on('close', (code, signal) => finish(code ?? -1, signal ? `${stderr}${signal}` : stderr));
    timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdin.end(input);
  });
}

const children = await Promise.all(Array.from({ length: parallel }, () => runChild()));
const stateDir = stateDirArg === undefined ? join(home, '.claude', 'state') : resolve(stateDirArg);
const stateFile = join(stateDir, 'rate_limits.json');
let stateExists = false;
let stateText = null;
try {
  stateText = readFileSync(stateFile, 'utf8');
  stateExists = true;
} catch {}

let tmpLeftovers = [];
try {
  tmpLeftovers = readdirSync(stateDir).filter((name) => name.endsWith('.tmp')).sort();
} catch {}

const result = { sandbox_root: sandboxRoot, state_file: stateFile, state_exists: stateExists, state_text: stateText, tmp_leftovers: tmpLeftovers, children };
process.stdout.write(JSON.stringify(result) + '\n');
