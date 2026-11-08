import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, render } from '../src/config.js';
import { createOpenCodePluginOwnerPrompt } from '../src/opencode-plugin-owner-prompt.js';

function fixture(t, prompt) {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-owner-prompt-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionID = 'ses_owner', message = { id: randomUUID(), channel: 'dev', from: { agentId: 'codex:peer' }, text: 'synthetic', recipients: [`opencode:${sessionID}`] };
  let current = true; const broker = { observeMessage: id => current && id === message.id ? structuredClone(message) : undefined };
  const context = { session: { get: async () => ({ id: sessionID, location: { directory: '/synthetic' } }), context: async () => [], prompt },
    permission: { list: async () => [] }, storage: { get: async () => ({ sessionID, directory: '/synthetic', channel: 'dev', forms: [] }) } };
  const options = { broker, context, sessionID, directory: '/synthetic', hostId: 'local', journalDirectory: root };
  const input = { sessionID, id: `msg_turnlink_${digest(`${sessionID}:${message.id}`)}`, text: render(message), delivery: 'steer', resume: true,
    metadata: { source: 'turnlink', messageID: message.id, sender: message.from.agentId, channel: message.channel } };
  return { input, context, options, revoke: () => { current = false; } };
}

test('owner prompt rejects forged text and suppresses replay after a confirmed receipt', async t => {
  let calls = 0; const f = fixture(t, async input => { calls++; return { id: input.id, sessionID: input.sessionID }; });
  const admit = createOpenCodePluginOwnerPrompt(f.options);
  await assert.rejects(admit({ ...f.input, text: 'forged' }), /PLUGIN_PROMPT_UNAVAILABLE/); assert.equal(calls, 0);
  assert.equal((await admit(f.input)).id, f.input.id); assert.equal((await admit(f.input)).id, f.input.id); assert.equal(calls, 1);
  f.revoke(); await assert.rejects(admit(f.input), /PLUGIN_PROMPT_UNAVAILABLE/);
});

test('lost native prompt reply remains uncertain across coordinator restart', async t => {
  let calls = 0; const f = fixture(t, async () => { calls++; throw new Error('response lost after admission'); });
  await assert.rejects(createOpenCodePluginOwnerPrompt(f.options)(f.input));
  await assert.rejects(createOpenCodePluginOwnerPrompt(f.options)(f.input), /PLUGIN_PROMPT_UNAVAILABLE/); assert.equal(calls, 1);
});

test('owner prompt rejects changed source session and pending permissions', async t => {
  let calls = 0; const f = fixture(t, async () => { calls++; });
  f.context.session.get = async () => ({ id: 'ses_other', location: { directory: '/synthetic' } });
  await assert.rejects(createOpenCodePluginOwnerPrompt(f.options)(f.input), /PLUGIN_PROMPT_UNAVAILABLE/);
  f.context.session.get = async () => ({ id: f.input.sessionID, location: { directory: '/synthetic' } });
  f.context.permission.list = async () => [{ id: 'p' }];
  await assert.rejects(createOpenCodePluginOwnerPrompt(f.options)(f.input), /PLUGIN_PROMPT_UNAVAILABLE/); assert.equal(calls, 0);
});
