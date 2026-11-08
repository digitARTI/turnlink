import { connectOpenCodeDestinationOwner } from '../../src/opencode-destination-owner-client.js';

const owner = connectOpenCodeDestinationOwner({ fd: 6, timeoutMs: 10000 });
owner.onClose(() => { process.send?.({ state: 'closed' }); });
process.on('message', async message => {
  if (message !== 'check') return;
  try { process.send?.({ state: 'held', evidence: await owner.check() }); }
  catch { process.send?.({ state: 'rejected' }); }
});
process.send?.({ state: 'ready' });
