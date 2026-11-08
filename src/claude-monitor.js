#!/usr/bin/env node
import { createClaudeMonitorSpool } from './claude-monitor-spool.js';
import { claudeMonitorEvents } from './claude-monitor-events.js';
import { stateDir } from './config.js';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const automatic = args[0] === '--session-env';
const expectedLength = automatic ? [1, 3] : [2, 4];
const offset = automatic ? 1 : 2;
if (!expectedLength.includes(args.length) || (!automatic && args[0] !== '--session') ||
    (args.length > offset && (args[offset] !== '--state-dir' || !isAbsolute(args[offset + 1])))) {
  console.error('Usage: claude-monitor.js (--session <id> | --session-env) [--state-dir <absolute-path>]'); process.exit(2);
}
const sessionId = automatic ? process.env.CLAUDE_CODE_SESSION_ID : args[1];
if (automatic && process.env.AGENT_CHANNEL_SESSION_ID && process.env.AGENT_CHANNEL_SESSION_ID !== sessionId) throw new Error('Claude session bindings disagree');
const spool = createClaudeMonitorSpool(args[offset + 1] || stateDir, sessionId);
const instance = randomUUID();
spool.heartbeat(instance);
const heartbeat = setInterval(() => {
  try { spool.heartbeat(instance); } catch { console.error('Turnlink monitor: heartbeat unavailable.'); stop(1); }
}, 5000);
const emitted = new Set();
// Claude Code groups lines that arrive close together into one notification,
// which can truncate the whole group even when individual lines are short.
const outputQueue = [];
let outputTimer;
function outputNext() {
  outputTimer = undefined;
  const event = outputQueue.shift();
  if (!event) return;
  if (emitted.has(event.id)) console.log(JSON.stringify(event));
  if (outputQueue.length) outputTimer = setTimeout(outputNext, 350);
}
function poll() {
  try {
    if (spool.consumeStop(instance)) { stop(); return; }
    const messages = spool.read();
    const current = new Set(messages.map(value => value.id));
    for (const id of emitted) if (!current.has(id)) emitted.delete(id);
    for (const message of messages) if (!emitted.has(message.id)) {
      emitted.add(message.id);
      outputQueue.push(...claudeMonitorEvents(message));
    }
    if (!outputTimer && outputQueue.length) outputNext();
  } catch { console.error('Turnlink monitor: private inbox unavailable.'); stop(1); }
}
const timer = setInterval(poll, 1000);
function stop(code = 0) {
  clearInterval(timer); clearInterval(heartbeat); clearTimeout(outputTimer);
  outputQueue.length = 0;
  try { spool.stopHeartbeat(instance); } catch { /* stale heartbeat expires */ }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
poll();
