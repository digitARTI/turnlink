import { createInterface } from 'node:readline';
const send = data => process.stdout.write(`${JSON.stringify(data)}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  send({ method: 'fixture/received', params: { id: frame.id } });
  if (frame.method === 'thread/read') setTimeout(() => send({ id: frame.id, result: { phase: 'before' } }), 80);
  if (frame.method === 'config/read') send({ id: frame.id, result: { phase: 'after' } });
  if (frame.method === 'fixture/fault') {
    send({ id: frame.id, result: {} });
    setTimeout(() => { if (frame.params?.kind === 'malformed') process.stdout.write('not-json\n'); else process.stdout.end(); }, 80);
  }
});
