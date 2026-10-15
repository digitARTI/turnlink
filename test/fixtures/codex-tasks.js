import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.env.TURNLINK_TASK_FIXTURE_STATE;
let turns = [];
try { turns = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const save = () => writeFileSync(file, JSON.stringify(turns), { mode: 0o600 });
const send = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
const selection = { cwd: process.cwd(), model: 'fixture', modelProvider: 'fixture', sandbox: { type: 'readOnly' }, approvalPolicy: 'untrusted' };
const thread = () => ({ id: 'worker', cwd: selection.cwd, turns });
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line), params = message.params || {}, reply = result => send({ id: message.id, result });
  if (message.id === 999 && !message.method) { send({ method: 'fixture/approval-replied', params: {} }); return; }
  if (['thread/start', 'thread/resume'].includes(message.method)) { reply({ ...selection, thread: thread() }); return; }
  if (message.method === 'thread/read') { reply({ thread: thread() }); return; }
  if (message.method === 'config/read') { reply({ config: { model: 'fixture', approval_policy: 'untrusted', sandbox_mode: 'read-only' } }); return; }
  if (message.method === 'fixture/approval') { reply({}); send({ id: 999, method: 'item/commandExecution/requestApproval', params: { threadId: 'worker' } }); return; }
  if (message.method === 'turn/interrupt') {
    const turn = turns.find(t => t.id === params.turnId);
    if (turn) { turn.status = 'interrupted'; save(); send({ method: 'turn/completed', params: { threadId: 'worker', turn } }); }
    reply({}); return;
  }
  if (message.method !== 'turn/start') { if (message.id !== undefined) reply({}); return; }
  send({ method: 'fixture/received', params: { method: message.method, ...params } });
  const text = params.input?.[0]?.text || '';
  const managed = text.split('\n').some(line => line.startsWith('TURNLINK_TASK_BINDING:'));
  const turn = { id: `turn_${turns.length}`, status: 'inProgress', items: [{ type: 'userMessage', content: params.input }, { type: 'agentMessage', text: 'Native fixture result' }] };
  turns.push(turn); save(); send({ method: 'turn/started', params: { threadId: 'worker', turn } });
  if (!(managed && process.env.TURNLINK_TASK_DROP_START_RESPONSE === '1')) reply({ turn });
  if (managed && process.env.TURNLINK_TASK_HOLD_TURN === '1') return;
  turn.status = 'completed'; save(); send({ method: 'turn/completed', params: { threadId: 'worker', turn } });
});
