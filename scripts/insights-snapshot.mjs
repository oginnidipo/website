#!/usr/bin/env node
// Saves a snapshot of the /insights dashboard from the live D1 database and opens it, without the
// dashboard password: it reads through your Wrangler login (`npx wrangler login`) and never writes.
// Usage: npm run insights:snapshot [-- --days 1|7|30|90] [--out file.html] [--no-open]

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, renderDashboard } from '../workers/insights/worker.mjs';

const root = resolve(import.meta.dirname, '..');
const config = join(root, 'workers/insights/wrangler.toml');

// Bound values come from the dashboard queries themselves (timestamps and visitor hashes), but are
// still quoted as SQL literals because `wrangler d1 execute --command` cannot bind parameters.
export function inline(sql, values) {
  const parts = sql.split('?');
  if (parts.length - 1 !== values.length) throw new Error(`Expected ${parts.length - 1} values, got ${values.length}: ${sql}`);
  return parts.map((part, index) => index < values.length ? part + literal(values[index]) : part).join('');
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

// The subset of the D1 binding that loadDashboard uses, backed by `run(sqlStatements)`.
export function snapshotDatabase(run) {
  const statement = (sql, values=[]) => ({
    sql, values,
    bind:(...next) => statement(sql, next),
    all:async () => run([inline(sql, values)])[0]
  });
  return { prepare:sql => statement(sql), batch:async statements => run(statements.map(item => inline(item.sql, item.values))) };
}

function wranglerQuery(statements) {
  const output = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', 'dipops-insights', '--remote', '-c', config, '--json', '--command', statements.join(';\n')],
    { cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'], maxBuffer:64 * 1024 * 1024 });
  const results = JSON.parse(output);
  if (!Array.isArray(results) || results.length !== statements.length) {
    throw new Error(`Unexpected response from wrangler: ${output.slice(0, 300)}`);
  }
  return results.map(result => ({ results:result.results }));
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const days = option('--days') ?? '30';
  if (!['1', '7', '30', '90'].includes(days)) {
    console.error('--days must be 1, 7, 30, or 90');
    process.exit(1);
  }
  const timeZone = readFileSync(config, 'utf8').match(/^TIMEZONE = "(.+)"$/m)?.[1] ?? 'America/Toronto';
  const now = Date.now();
  let data;
  try {
    data = await loadDashboard(snapshotDatabase(wranglerQuery), Number(days));
  } catch (error) {
    console.error(`Could not read the insights database. Are you logged in? Run: npx wrangler login\n${error.stderr || error.message}`);
    process.exit(1);
  }
  const stamp = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const out = resolve(option('--out') ?? join(tmpdir(), 'dipops-insights', `insights-${days}d-${stamp}.html`));
  mkdirSync(dirname(out), { recursive:true });
  writeFileSync(out, renderDashboard(data, { days, timeZone, now, snapshot:true }));
  console.log(`Saved ${data.summary.visits} visits over the last ${days} days to ${out}`);
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(opener, [out], { detached:true, stdio:'ignore' }).unref();
  }
}
