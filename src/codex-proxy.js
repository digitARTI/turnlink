#!/usr/bin/env node
// Transparent stdio proxy: the official extension still owns the same Codex process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { ChannelClient } from './client.js';
import { identity, render } from './config.js';
import { AdmissionLedger, fingerprint } from './admissions.js';
import { diagnosticCode } from './diagnostics.js';
import { resolveExecutable } from './executable.js';
import { makeCodexControl, roleFingerprint } from './codex-control.js';
import { CodexAdmissionFence } from './codex-admission-fence.js';

let executable;
try { executable = resolveExecutable(process.env.AGENT_CHANNEL_CODEX_EXECUTABLE || ''); }
catch { console.error('Set AGENT_CHANNEL_CODEX_EXECUTABLE to an available real Codex executable (not this proxy).'); process.exit(1); }
const args = process.argv.slice(2);
try {
  const target = statSync(executable), self = statSync(process.argv[1]);
  if (realpathSync(executable) === realpathSync(process.argv[1]) ||
      (target.ino !== 0 && target.ino === self.ino && target.dev === self.dev)) {
    console.error('Turnlink: recursive Codex executable'); process.exit(1);
  }
} catch { /* spawn reports an unavailable executable without exposing the path */ }
const childEnv = { ...process.env };
for (const key of ['AGENT_CHANNEL_TOKEN', 'AGENT_CHANNEL_ADMIN_TOKEN', 'AGENT_CHANNEL_ADAPTER_TOKEN_FILE']) delete childEnv[key];
const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv, windowsHide: true });
child.stdin.on('error', () => child.kill());
if (!args.includes('app-server') || args.some(a => /^(?:--listen=)?(?:ws|unix):\/\//.test(a))) {
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
} else {
  const client = new ChannelClient();
  const threads = new Map();
  const requests = new Map();
  const own = new Map();
  const approvals = new Map();
  const forwardEditor = (line, data, internal = false) => {
    if (!internal && data?.id !== undefined && data.method) requests.set(data.id, { method: data.method, params: data.params });
    if (data?.id !== undefined && !data.method && approvals.has(data.id)) {
      const threadId = approvals.get(data.id); approvals.delete(data.id);
      child.stdin.write(`${line}\n`); void flush(threadId); return;
    }
    child.stdin.write(`${line}\n`);
  };
  const fence = new CodexAdmissionFence({ write: forwardEditor, reply: data => process.stdout.write(`${JSON.stringify(data)}\n`),
    activity: threadID => {
      const state = threads.get(threadID);
      const all = [...threads.values()];
      return { known: !!state && all.every(s => s.lifecycleKnown === true), idle: !!state && all.every(s => !s.turnId),
        blocked: approvals.size > 0, flushing: all.some(s => s.flushing === true) };
    },
    onRelease: () => { for (const threadID of threads.keys()) setImmediate(() => void flush(threadID)); },
    onFatal: () => child.kill() });
  const write = data => fence.internal(data);
  const timeoutMs = Number(process.env.AGENT_CHANNEL_RPC_TIMEOUT_MS || 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw new Error('Invalid RPC timeout');
  const admissionFingerprint = (message, role) => role ? roleFingerprint(message) : fingerprint(message);
  const receipt = (state, message, status, extra = {}, role = false) => state.ledger.set({
    id: message.id, fingerprint: admissionFingerprint(message, role), state: status, updatedAt: Date.now(), ...extra,
  });
  const accepted = async (threadId, state, message, generation, response, role = false) => {
    const receiptID = role ? `msg_turnlink_role_${message.id.replaceAll('-', '')}` : undefined;
    receipt(state, message, 'accepted', role ? { rpcId: receiptID, method: 'role.accepted' } : {}, role);
    if (response?.turn?.id) state.turnId = response.turn.id;
    if (state.generation !== generation) return;
    if (threads.get(threadId) !== state) return;
    if (role) {
      await control.acknowledge(threadId, message, receiptID);
      state.roles = state.roles.filter(m => m.id !== message.id);
    } else {
      state.queue = state.queue.filter(m => m.id !== message.id); state.seen.add(message.id);
      await client.request('ack', { agentId: identity('codex', threadId), id: message.id });
    }
  };
  const rpc = (method, params, context) => new Promise((resolve, reject) => {
    if (fence.held || fence.closed) { reject(new Error('Native admission is fenced or closed')); return; }
    if (own.size >= 128) { reject(new Error('Internal RPC limit reached')); return; }
    const id = `turnlink-internal-${randomUUID()}`;
    const pending = { resolve, reject, context, expired: false };
    receipt(context.state, context.message, 'inflight', { rpcId: id, method }, context.role);
    pending.timer = setTimeout(() => {
      pending.expired = true;
      try { receipt(context.state, context.message, 'uncertain', { rpcId: id, method }, context.role); }
      catch { /* prior inflight receipt remains conservative evidence */ }
      const error = new Error('Codex admission uncertain; inspect receipt before retry'); error.code = 'ADMISSION_UNCERTAIN'; reject(error);
    }, timeoutMs);
    own.set(id, pending);
    write({ id, method, params });
  });
  const flush = async threadId => {
    const state = threads.get(threadId);
    if (!state || state.flushing || fence.held || [...approvals.values()].includes(threadId)) return;
    state.flushing = true;
    try {
      while ((state.queue.length || state.roles.length) && !fence.held && ![...approvals.values()].includes(threadId)) {
        // Lifecycle notices never wake an idle thread. An already-accepted receipt can still be acknowledged while idle.
        const notice = state.roles.find(n => ['offer', 'task_review'].includes(n.kind) || state.turnId || state.ledger.get(n.id)?.state === 'accepted');
        const role = !!notice, message = notice || state.queue[0];
        if (!message) break;
        if (role && !state.lifecycleKnown) break;
        if (role && [...requests.values()].some(r => r.method === 'turn/start' && r.params?.threadId === threadId)) break;
        const generation = state.generation;
        const input = [{ type: 'text', text: role ? message.text : render(message) }];
        try {
          if (role) {
            if (!await control.pending(threadId, message)) { state.roles = state.roles.filter(n => n.id !== message.id); continue; }
            if (threads.get(threadId) !== state || state.generation !== generation || fence.held || [...approvals.values()].includes(threadId)) break;
          }
          const previous = state.ledger.get(message.id);
          if (previous && previous.fingerprint !== admissionFingerprint(message, role)) throw new Error('Admission fingerprint mismatch');
          if (previous?.state === 'accepted') {
            await accepted(threadId, state, message, generation, undefined, role); continue;
          }
          if (role && ((!state.turnId && !['offer', 'task_review'].includes(message.kind)) ||
            [...requests.values()].some(r => r.method === 'turn/start' && r.params?.threadId === threadId))) break;
          if (previous && ['inflight', 'uncertain'].includes(previous.state)) break;
          const context = { threadId, state, message, generation, role };
          let response;
          if (state.turnId) response = await rpc('turn/steer', { threadId, expectedTurnId: state.turnId, input }, context);
          else {
            response = await rpc('turn/start', { threadId, input }, context);
          }
          await accepted(threadId, state, message, generation, response, role);
        } catch (error) {
          console.error(`Turnlink: admission unresolved (${diagnosticCode(error)}), message=${message.id}; inspect private receipt`);
          break;
        }
        if (state.generation !== generation) break;
      }
    } catch (error) { console.error(`Turnlink: delivery blocked (${diagnosticCode(error)})`); }
    finally { state.flushing = false; }
  };
  const control = makeCodexControl({ client, threads, flush,
    enabled: process.env.AGENT_CHANNEL_CONTROL === '1', tokenFile: process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE,
    log: error => console.error(`Turnlink: control maintenance blocked (${diagnosticCode(error)})`) });
  const bind = async (threadId, thread, newlyStarted = false) => {
    if (!threads.has(threadId)) {
      const active = thread?.turns?.find(turn => ['inProgress', 'in_progress'].includes(turn.status));
      const known = newlyStarted || (Array.isArray(thread?.turns) && thread.turns.every(turn => ['completed', 'interrupted', 'failed', 'inProgress', 'in_progress'].includes(turn.status)));
      threads.set(threadId, { queue: [], roles: [], seen: new Set(), turnId: active?.id || null, lifecycleKnown: known, flushing: false, generation: 0 });
    }
    try {
      await client.connect();
      const state = threads.get(threadId);
      if (!state) return;
      state.ledger = new AdmissionLedger(client.hostId, identity('codex', threadId));
      const subscription = await client.subscribe(identity('codex', threadId));
      if (subscription.channel) state.channel = subscription.channel;
      void control.poll(threadId);
    } catch (error) { console.error(`Turnlink: receiver connection blocked (${diagnosticCode(error)})`); }
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
    for (const [threadId, state] of threads) if (identity('codex', threadId) === agentId) { state.queue = []; state.roles = []; state.channel = null; state.generation++; }
  });
  client.on('presence', ({ agent }) => {
    for (const [threadId, state] of threads) if (identity('codex', threadId) === agent.agentId) {
      state.channel = agent.channel; void control.poll(threadId);
    }
  });
  createInterface({ input: process.stdin }).on('line', line => {
    try { fence.editor(line); } catch { child.kill(); }
  }).on('close', () => { fence.close(); control.close(); client.close(); child.stdin.end(); });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const data = JSON.parse(line);
      fence.observe(data);
      if (own.has(data.id)) {
        const pending = own.get(data.id); own.delete(data.id); clearTimeout(pending.timer);
        const { threadId, state, message, generation, role } = pending.context;
        try { if (data.error) {
          // A definitive rejection permits retry. Error bodies are not logged.
          receipt(state, message, 'not_admitted', {}, role);
          pending.reject(new Error('Codex rejected admission'));
          if (pending.expired) void flush(threadId);
        } else if (pending.expired) {
          void accepted(threadId, state, message, generation, data.result, role).then(() => flush(threadId)).catch(error => console.error(`Turnlink: late receipt blocked (${diagnosticCode(error)})`));
        } else pending.resolve(data.result); }
        catch { pending.reject(new Error('Admission receipt could not be persisted; reconciliation required')); }
        return;
      }
      // Never leak a late/internal response into the editor's RPC namespace.
      if (typeof data.id === 'string' && data.id.startsWith('turnlink-internal-')) return;
      const request = requests.get(data.id);
      if (request && !data.method) {
        requests.delete(data.id);
        if (['thread/start', 'thread/resume'].includes(request.method) && data.result?.thread?.id) bind(data.result.thread.id, data.result.thread, request.method === 'thread/start');
        if (request.method === 'turn/start' && data.result?.turn?.id) {
          const state = threads.get(request.params.threadId);
          if (state) { state.turnId = data.result.turn.id; state.lifecycleKnown = true; }
        }
      }
      if (data.method === 'turn/started') {
        const state = threads.get(data.params.threadId);
        if (state) { state.turnId = data.params.turn.id; state.lifecycleKnown = true; setImmediate(() => void flush(data.params.threadId)); }
      }
      if (data.method === 'turn/completed') {
        const state = threads.get(data.params.threadId);
        if (state) { state.turnId = null; state.lifecycleKnown = true; setImmediate(() => void flush(data.params.threadId)); }
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
  const controlTimer = process.env.AGENT_CHANNEL_CONTROL === '1' && process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE ?
    setInterval(() => { for (const threadId of threads.keys()) void control.poll(threadId); }, 30000) : undefined;
  controlTimer?.unref();
  child.on('exit', () => { fence.close(); control.close(); clearInterval(controlTimer); clearInterval(retry); client.close(); for (const p of own.values()) clearTimeout(p.timer); });
}
child.on('error', error => { console.error(`Turnlink: executable launch failed (${diagnosticCode(error)})`); process.exit(1); });
child.on('exit', code => { process.stdin.destroy(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
