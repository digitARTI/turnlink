#!/usr/bin/env node
// Transparent stdio proxy: the official extension still owns the same Codex process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { ChannelClient } from './client.js';
import { identity, render } from './config.js';

const executable = process.env.AGENT_CHANNEL_CODEX_EXECUTABLE;
if (!executable) { console.error('Set AGENT_CHANNEL_CODEX_EXECUTABLE to the real Codex executable (not this proxy).'); process.exit(1); }
const args = process.argv.slice(2);
const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'inherit'] });
if (!args.includes('app-server') || args.some(a => a.startsWith('ws://') || a.startsWith('unix://'))) {
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
} else {
  const client = new ChannelClient();
  const threads = new Map();
  const requests = new Map();
  const own = new Map();
  const approvals = new Map();
  const write = data => child.stdin.write(`${JSON.stringify(data)}\n`);
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = `agent-channel-${randomUUID()}`;
    const timer = setTimeout(() => { own.delete(id); reject(new Error(`Codex timeout: ${method}`)); }, 30000);
    own.set(id, { resolve, reject, timer });
    write({ id, method, params });
  });
  const flush = async threadId => {
    const state = threads.get(threadId);
    if (!state || state.flushing || [...approvals.values()].includes(threadId)) return;
    state.flushing = true;
    try {
      while (state.queue.length && ![...approvals.values()].includes(threadId)) {
        const message = state.queue[0];
        const generation = state.generation;
        const input = [{ type: 'text', text: render(message) }];
        try {
          if (state.turnId) await rpc('turn/steer', { threadId, expectedTurnId: state.turnId, input });
          else {
            const response = await rpc('turn/start', { threadId, input });
            state.turnId = response.turn?.id || state.turnId;
          }
        } catch (error) {
          console.error(`Agent channel: ${error.message}; message retained for retry`);
          break;
        }
        if (state.generation !== generation) break;
        state.queue.shift();
        state.seen.add(message.id);
        await client.request('ack', { agentId: identity('codex', threadId), id: message.id });
      }
    } catch (error) { console.error(`Agent channel: ${error.message}`); }
    finally { state.flushing = false; }
  };
  const bind = threadId => {
    if (!threads.has(threadId)) threads.set(threadId, { queue: [], seen: new Set(), turnId: null, flushing: false, generation: 0 });
    client.subscribe(identity('codex', threadId)).catch(error => console.error(`Agent channel: ${error.message}`));
  };
  client.on('message', message => {
    for (const [threadId, state] of threads) {
      if (!message.recipients.includes(identity('codex', threadId))) continue;
      if (state.seen.has(message.id)) {
        void client.request('ack', { agentId: identity('codex', threadId), id: message.id }).catch(() => {});
        continue;
      }
      if (state.queue.some(m => m.id === message.id)) continue;
      state.queue.push(message);
      void flush(threadId);
    }
  });
  client.on('membership_removed', ({ agentId }) => {
    for (const [threadId, state] of threads) if (identity('codex', threadId) === agentId) { state.queue = []; state.generation++; }
  });
  createInterface({ input: process.stdin }).on('line', line => {
    try {
      const data = JSON.parse(line);
      if (data.id !== undefined && data.method) requests.set(data.id, { method: data.method, params: data.params });
      if (data.id !== undefined && !data.method && approvals.has(data.id)) {
        const threadId = approvals.get(data.id);
        approvals.delete(data.id);
        // Forward approval response before resuming delivery.
        child.stdin.write(`${line}\n`);
        void flush(threadId);
        return;
      }
    } catch { /* forward non-JSON unchanged */ }
    child.stdin.write(`${line}\n`);
  }).on('close', () => { client.close(); child.stdin.end(); });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const data = JSON.parse(line);
      if (own.has(data.id)) {
        const pending = own.get(data.id); own.delete(data.id); clearTimeout(pending.timer);
        data.error ? pending.reject(new Error(data.error.message)) : pending.resolve(data.result);
        return;
      }
      const request = requests.get(data.id);
      if (request && !data.method) {
        requests.delete(data.id);
        if (['thread/start', 'thread/resume'].includes(request.method) && data.result?.thread?.id) bind(data.result.thread.id);
        if (request.method === 'turn/start' && data.result?.turn?.id) {
          const state = threads.get(request.params.threadId);
          if (state) state.turnId = data.result.turn.id;
        }
      }
      if (data.method === 'turn/started') {
        const state = threads.get(data.params.threadId);
        if (state) state.turnId = data.params.turn.id;
      }
      if (data.method === 'turn/completed') {
        const state = threads.get(data.params.threadId);
        if (state) { state.turnId = null; setImmediate(() => void flush(data.params.threadId)); }
      }
      if (data.method === 'thread/closed' || data.method === 'thread/archived') {
        threads.delete(data.params.threadId);
        void client.unsubscribe(identity('codex', data.params.threadId)).catch(() => {});
      }
      if (data.method && data.id !== undefined && data.params?.threadId) approvals.set(data.id, data.params.threadId);
    } catch { /* forward diagnostic lines unchanged */ }
    process.stdout.write(`${line}\n`);
  });
  const retry = setInterval(() => { for (const threadId of threads.keys()) void flush(threadId); }, 2000);
  retry.unref();
  child.on('exit', () => { clearInterval(retry); client.close(); for (const p of own.values()) clearTimeout(p.timer); });
}
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => { process.stdin.destroy(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
