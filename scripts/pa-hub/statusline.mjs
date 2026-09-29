#!/usr/bin/env node
// Claude Code status line — 6 rows (rate_limits from CC stdin):
//   1. Context bar + % + tokens + model + effort
//   2. 5h rate limit bar + % + reset time (from rate_limits.five_hour)
//   3. 7-day rate limit bar + % + reset time (from rate_limits.seven_day)
//   4. Sonnet: cost + share of weekly total spend
//   5. API costs: today / week / month
//   6. 14-day usage calendar heatmap
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const CACHE_MS = 30_000;
const cacheFile = `${process.env.TMPDIR || '/tmp'}/cc-statusline-cache.json`;

// --- fast render: never block on ccusage in the render path -------------
// `--refresh` runs the slow ccusage queries and writes the cache; the normal
// render path reads the cache instantly and, when stale, spawns this refresh
// in the background (stale-while-revalidate). Keeps every render well under
// any statusline-host timeout (e.g. the kickbacks 5s chain cap).
function refreshCache() {
  const data = { ...querySpend(), daily: queryDaily() };
  try { writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}
if (process.argv.includes('--refresh')) { try { refreshCache(); } catch {} process.exit(0); }

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch {}

try {
  const stateDir = process.env.PA_HUB_STATE_DIR || (process.env.HOME ? `${process.env.HOME}/.claude/state` : '');
  if (stateDir) {
    mkdirSync(stateDir, { recursive: true });
    const stateFile = `${stateDir}/rate_limits.json`;
    const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const rateLimit = (value) => plainObject(value)
      ? { used_percentage: finiteNumber(value.used_percentage), resets_at: finiteNumber(value.resets_at) }
      : null;
    const payload = {
      five_hour: rateLimit(input.rate_limits?.five_hour),
      seven_day: rateLimit(input.rate_limits?.seven_day),
      model: {
        id: typeof input.model?.id === 'string' ? input.model.id : '',
        display_name: typeof input.model?.display_name === 'string' ? input.model.display_name : '',
      },
      written_at: new Date().toISOString(),
    };
    const tmpFile = `${stateFile}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(tmpFile, JSON.stringify(payload) + '\n');
      renameSync(tmpFile, stateFile);
    } catch {
      try { unlinkSync(tmpFile); } catch {}
    }
  }
} catch {}

const model   = input.model?.display_name || 'Claude';
const modelId = input.model?.id || '';
const effortLevel = input.effort?.level || input.model?.effort || '';

// context from built-in fields
const ctxPct   = input.context_window?.used_percentage ?? 0;
const ctxLimit = input.context_window?.context_window_size ?? 200_000;
const ctxTokens = input.context_window?.total_input_tokens ?? 0;

// rate limits from built-in fields
const fiveHPct   = input.rate_limits?.five_hour?.used_percentage;
const fiveHReset = input.rate_limits?.five_hour?.resets_at;
const sevenDPct  = input.rate_limits?.seven_day?.used_percentage;
const sevenDReset = input.rate_limits?.seven_day?.resets_at;

// ----- ANSI helpers -----
const RESET = '\x1b[0m', DIM = '\x1b[2m', BOLD = '\x1b[1m';
const RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', CYN = '\x1b[36m';
const usageColor = (p) => p >= 80 ? RED : p >= 50 ? YEL : GRN;
const fmtK = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n/1e3)+'k' : String(n);
const fmtUSD = (n) => '$' + (n ?? 0).toFixed(2);

function fmtResetTime(epochSec) {
  if (!epochSec) return DIM + '—' + RESET;
  const ms = epochSec * 1000 - Date.now();
  if (ms <= 0) return DIM + 'resetting' + RESET;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const s = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return DIM + s + ' left' + RESET;
}

function bar(p, width = 12) {
  const clamped = Math.max(0, Math.min(100, p));
  const filled = Math.round((clamped / 100) * width);
  return usageColor(clamped) + '█'.repeat(filled) + DIM + '░'.repeat(width - filled) + RESET;
}
function pctStr(p) {
  return usageColor(p) + String(Math.round(p)).padStart(3) + '%' + RESET;
}

// ----- ccusage cost data (cached) -----
function querySpend() {
  const run = (args) => {
    try { return JSON.parse(execSync(`ccusage ${args} --json --offline`, { encoding:'utf8', stdio:['ignore','pipe','ignore'] })); }
    catch { return null; }
  };

  const blocksData = run('blocks --active');
  const b = blocksData?.blocks?.[0] || {};
  const blockCost = b.costUSD || 0;

  const weeklyData = run('weekly');
  const weeks = weeklyData?.weekly || [];
  const w = weeks.at(-1) || {};

  const claudeOnly = (wk) => Array.isArray(wk.modelBreakdowns)
    ? wk.modelBreakdowns.filter(e => /claude/i.test(e.modelName||'')).reduce((s,e) => s+(e.cost||0), 0)
    : (wk.totalCost || 0);
  const weekTotalCost = w.totalCost || 0;
  const weekClaudeCost = claudeOnly(w);
  const sonnetCost = Array.isArray(w.modelBreakdowns)
    ? w.modelBreakdowns.filter(e => /sonnet/i.test(e.modelName||'')).reduce((s,e) => s+(e.cost||0), 0)
    : 0;
  const sonnetSharePct = weekTotalCost > 0 ? Math.min((sonnetCost / weekTotalCost) * 100, 100) : 0;
  const monthCost = weeks.slice(-4).reduce((s, wk) => s + claudeOnly(wk), 0);
  const monthTotalCost = weeks.slice(-4).reduce((s, wk) => s + (wk.totalCost || 0), 0);

  return { blockCost, weekTotalCost, weekClaudeCost, sonnetCost, sonnetSharePct, monthCost, monthTotalCost };
}

function localDateStr(dt) {
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), d = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function queryDaily() {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 13); // 14 days including today
  const sinceStr = localDateStr(since);
  try {
    const raw = execSync(`ccusage daily --json --offline --since ${sinceStr}`, { encoding:'utf8', stdio:['ignore','pipe','ignore'] });
    const parsed = JSON.parse(raw);
    const days = parsed?.daily || [];
    // build a map of date -> totalCost
    const costByDate = {};
    for (const d of days) costByDate[d.period] = d.totalCost || 0;
    // build array of 14 days, oldest first
    const result = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - i);
      const key = localDateStr(dt);
      result.push({ date: key, cost: costByDate[key] || 0 });
    }
    return result;
  } catch {
    return null;
  }
}

function spend() {
  let cached = null;
  try { cached = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  const stale = !cached || (Date.now() - cached.at >= CACHE_MS);
  if (stale) {
    // fire-and-forget background refresh; the render NEVER waits on ccusage
    try { spawn(process.execPath, [__filename, '--refresh'],
                { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }
  if (cached) return cached.data;   // stale-while-revalidate: serve last-known instantly
  // first run, no cache yet -> zeros so rendering never blocks or crashes
  return { blockCost: 0, weekTotalCost: 0, weekClaudeCost: 0, sonnetCost: 0,
           sonnetSharePct: 0, monthCost: 0, monthTotalCost: 0, daily: null };
}

// ----- assemble -----
const s = spend();

const effortTag = effortLevel ? `  ${DIM}${effortLevel}${RESET}` : '';
const R1 = `🧠 ${'Context'.padEnd(7)} ${bar(ctxPct)} ${pctStr(ctxPct)}  ${fmtK(ctxTokens)}${DIM}/${fmtK(ctxLimit)}${RESET}  ${BOLD}${model}${RESET}${effortTag}`;

const fiveH = fiveHPct != null ? fiveHPct : 0;
const sevenD = sevenDPct != null ? sevenDPct : 0;
const fiveHLabel = fiveHPct != null ? '' : `  ${DIM}(awaiting data)${RESET}`;
const sevenDLabel = sevenDPct != null ? '' : `  ${DIM}(awaiting data)${RESET}`;

const R2 = `⌛ ${'5h'.padEnd(7)} ${bar(fiveH)} ${pctStr(fiveH)}  ${fmtResetTime(fiveHReset)}  ${DIM}${fmtUSD(s.blockCost)} block${RESET}${fiveHLabel}`;
const R3 = `📅 ${'7-day'.padEnd(7)} ${bar(sevenD)} ${pctStr(sevenD)}  ${fmtResetTime(sevenDReset)}${sevenDLabel}`;
const R4 = `🤖 ${'Sonnet'.padEnd(7)} ${fmtUSD(s.sonnetCost)} ${DIM}of${RESET} ${fmtUSD(s.weekTotalCost)} ${DIM}week${RESET}  (${Math.round(s.sonnetSharePct)}%)`;
// CC >= 2.1.x dropped the stdin `cost` object — today's ccusage figure (already
// fetched for the heatmap) replaces the dead per-session cost.
const todayCost = s.daily?.at(-1)?.cost ?? 0;
const R5 = `💰 ${DIM}today${RESET} ${fmtUSD(todayCost)}  ${DIM}claude/wk${RESET} ${fmtUSD(s.weekClaudeCost)}  ${DIM}claude/mo${RESET} ${fmtUSD(s.monthCost)}  ${DIM}all/mo${RESET} ${fmtUSD(s.monthTotalCost)}`;

// ----- R6: 14-day usage calendar heatmap -----
function buildCalendar(daily) {
  if (!daily || !daily.length) return null;
  const chars = daily.map(d => {
    const c = d.cost;
    if (c <= 0)  return { ch: '·', color: DIM };       // middle dot = no data
    if (c < 0.5) return { ch: '░', color: GRN };       // light shade
    if (c < 2)   return { ch: '▒', color: GRN };       // medium shade
    if (c < 5)   return { ch: '▒', color: YEL };       // medium shade yellow
    if (c < 20)  return { ch: '▓', color: YEL };       // dark shade yellow
    if (c < 50)  return { ch: '▓', color: RED };       // dark shade red
    return              { ch: '█', color: RED };        // full block red
  });
  const calStr = chars.map(x => x.color + x.ch + RESET).join('');
  // date range label: "Jun 7-20" style
  const first = daily[0].date;
  const last  = daily[daily.length - 1].date;
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fd = new Date(first + 'T00:00:00'), ld = new Date(last + 'T00:00:00');
  const fmName = mo[fd.getMonth()], lmName = mo[ld.getMonth()];
  const rangeLabel = fd.getMonth() === ld.getMonth()
    ? `${fmName} ${fd.getDate()}-${ld.getDate()}`
    : `${fmName} ${fd.getDate()}-${lmName} ${ld.getDate()}`;
  return `${calStr} ${DIM}${rangeLabel}${RESET}`;
}
const cal = buildCalendar(s.daily);
const R6 = cal
  ? `📊 ${'14-day'.padEnd(7)} ${cal}`
  : `📊 ${'14-day'.padEnd(7)} ${DIM}(awaiting data)${RESET}`;

// ----- R7: Kickbacks earnings — last-known snapshot -----
// The token-refresh proxy is retired (extension 2.1.99 owns its token via
// Keychain), so nothing on disk updates live anymore. balance.json holds the
// proxy's final capture; render it with its age. Live figure: VS Code status bar.
function kbBalance() {
  try {
    const b = JSON.parse(readFileSync('/Users/slee65/.kickbacks-wrapper/balance.json', 'utf8'));
    const life = parseFloat(b.lifetime_usd ?? 0) || 0;
    const today = parseFloat(b.today_usd ?? 0) || 0;
    return { life, today, ts: typeof b.ts === 'number' ? b.ts : null };
  } catch { return null; }
}
function fmtAge(ms) {
  if (ms == null) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
const kb = kbBalance();
const R7 = kb
  ? `💵 ${'Kickbacks'.padEnd(7)} ${GRN}${fmtUSD(kb.life)}${RESET} ${DIM}lifetime${RESET}  ${fmtUSD(kb.today)} ${DIM}today${RESET}  ${DIM}as of ${fmtAge(kb.ts != null ? Date.now() - kb.ts : null)} ago — live: VS Code bar${RESET}`
  : `💵 ${'Kickbacks'.padEnd(7)} ${DIM}(live in VS Code status bar)${RESET}`;

process.stdout.write([R1, R2, R3, R4, R5, R6, R7].join('\n'));
