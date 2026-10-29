#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const state = join(homedir(), '.local', 'state', 'codex-window');
const prompt = 'Reply OK. Do not use tools or inspect files.';
const dryRun = process.argv.includes('--dry-run');
if (process.argv.slice(2).some(arg => arg !== '--dry-run')) {
  console.error('Usage: codex-5h-limit-starter [--dry-run]');
  process.exit(1);
}
const log = message => console.log(`${new Date().toISOString()} ${message}`);

async function usage() {
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let failure;
  const fail = error => {
    failure = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Codex app server exited')));
  lines.on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error('Codex usage request failed'));
    else entry.resolve(msg.result);
  });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Codex usage request timed out'));
    }, 30000);
    pending.set(requestId, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n', error => {
      if (error) { pending.delete(requestId); clearTimeout(timer); reject(error); }
    });
  });
  try {
    await request('initialize', { clientInfo: { name: 'codex_window', version: '0.1.0' } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const { account } = await request('account/read', { refreshToken: false });
    if (account?.type !== 'chatgpt' || account?.planType !== 'plus') throw new Error('A ChatGPT Plus login is required');
    return (await request('account/rateLimits/read', {})).rateLimits;
  } finally { lines.close(); child.kill(); }
}

async function readOptional(path) {
  try { return (await readFile(path, 'utf8')).trim(); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function send(session) {
  const args = ['exec', '--ignore-user-config', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '--cd', state];
  if (session) args.push('resume', '--ignore-user-config', '--skip-git-repo-check', session, prompt);
  else args.push(prompt);
  const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let thread, completed = false;
  let sessionWrite = Promise.resolve();
  lines.on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'thread.started' && event.thread_id) {
      thread = event.thread_id;
      if (!session) sessionWrite = writeFile(join(state, 'session'), `${thread}\n`, { mode: 0o600 });
    }
    if (event.type === 'turn.completed') completed = true;
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Prompt timed out')); }, 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
  await sessionWrite;
  if (code !== 0 || !completed) throw new Error('Prompt did not complete; check Codex login and limits');
  if (!session && !thread) throw new Error('Codex did not return a session ID');
}

async function main() {
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lockPath = join(state, 'node.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Already running, or a stale lock exists at ${lockPath}`);
    throw error;
  }
  await lock.writeFile(`${process.pid}\n`);
  const cleanup = async () => { await lock.close(); await unlink(lockPath).catch(() => {}); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup().finally(() => process.exit(0)); });
  try {
    const attemptPath = join(state, 'last-attempt');
    let lastAttempt = Number(await readOptional(attemptPath)) || 0;
    for (;;) {
      try {
        const limits = await usage();
        const five = limits?.primary, week = limits?.secondary;
        if (five?.windowDurationMins !== 300 || week?.windowDurationMins !== 10080 ||
            !Number.isFinite(five.usedPercent) || !Number.isFinite(week.usedPercent)) throw new Error('Expected five-hour and weekly usage is unavailable');
        const now = Date.now() / 1000;
        let wait;
        if (week.usedPercent >= 100) {
          wait = Number.isFinite(week.resetsAt) ? Math.max(60, week.resetsAt + 30 - now) : 3600;
          log('Weekly allowance exhausted; waiting');
        } else if (five.usedPercent > 0) {
          if (!Number.isFinite(five.resetsAt)) throw new Error('Reset time unavailable');
          wait = Math.max(60, five.resetsAt + 30 - now);
          log(`Five-hour usage ${five.usedPercent}%; checking at ${new Date((now + wait) * 1000).toISOString()}`);
        } else if (now - lastAttempt < 18030) {
          wait = 18030 - (now - lastAttempt);
          log('Already attempted a prompt; waiting five hours');
        } else if (dryRun) {
          log('Allowance is 100%; would send prompt');
          wait = 300;
        } else {
          if (limits.credits?.hasCredits !== false || limits.rateLimitReachedType) throw new Error('Credit or limit status is uncertain; refusing to send');
          lastAttempt = now;
          await writeFile(attemptPath, `${now}\n`, { mode: 0o600 });
          const session = await readOptional(join(state, 'session'));
          log('Sending one prompt to the dedicated session');
          await send(session);
          wait = 18030;
        }
        await sleep(wait * 1000);
      } catch (error) {
        log(`${error.message}; retrying in 15 minutes`);
        await sleep(900000);
      }
    }
  } finally { await cleanup(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
