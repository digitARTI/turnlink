import { createInterface } from 'node:readline';
const send = data => process.stdout.write(`${JSON.stringify(data)}\n`);
let heldAdmission;
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({ id: request.id, result: { userAgent: 'fixture' } });
  else if (request.method === 'thread/start') send({ id: request.id, result: { thread: { id: request.params.fixtureId || 'thread-b' } } });
  else if (request.method === 'turn/start') {
    const text = request.params.input?.[0]?.text || '';
    if (text.includes('delay-admission')) heldAdmission = { id: request.id, result: { turn: { id: 'turn-active' } } };
    else if (!text.includes('never-respond')) send({ id: request.id, result: { turn: { id: 'turn-active' } } });
    send({ method: 'turn/started', params: { threadId: request.params.threadId, turn: { id: 'turn-active' } } });
    send({ method: 'fixture/received', params: { method: request.method, ...request.params } });
  } else if (request.method === 'turn/steer') {
    send({ id: request.id, result: { turnId: 'turn-active' } });
    send({ method: 'fixture/received', params: { method: request.method, ...request.params } });
  } else if (request.method === 'fixture/release-admission') {
    if (heldAdmission) { send(heldAdmission); heldAdmission = null; }
    send({ id: request.id, result: {} });
  } else if (request.method === 'fixture/finish') {
    send({ id: request.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { id: 'turn-active', status: 'completed' } } });
  } else if (request.method === 'fixture/approval') {
    send({ id: request.id, result: {} });
    send({ id: 999, method: 'item/commandExecution/requestApproval', params: { threadId: request.params.threadId } });
  }
});
