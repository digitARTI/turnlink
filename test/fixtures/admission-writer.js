import { AdmissionLedger } from '../../src/admissions.js';

const [root, agentId, recordID] = process.argv.slice(2);
const ledger = new AdmissionLedger('local', agentId, root);
process.send?.({ ready: true });
process.once('message', () => {
  try { ledger.set({ id: recordID, fingerprint: 'child', state: 'inflight', updatedAt: 2 }); process.send?.({ written: true }); }
  catch (error) { process.send?.({ written: false, message: error.message }); }
  process.disconnect();
});
