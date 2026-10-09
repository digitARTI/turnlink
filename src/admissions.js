import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { stateDir, digest } from './config.js';
import { atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { AgentID, HostID } from './protocol.js';

const Receipt = z.strictObject({ id: z.string().uuid(), fingerprint: z.string(), state: z.enum(['inflight', 'uncertain', 'accepted', 'not_admitted']),
  rpcId: z.string().optional(), method: z.string().optional(), updatedAt: z.number() });
export class AdmissionLedger {
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    HostID.parse(hostId); AgentID.parse(agentId);
    privateDirectory(directory);
    const root = join(directory, digest(hostId)); privateDirectory(root);
    this.path = join(root, `${digest(agentId)}.admissions.json`);
    try { this.records = z.array(Receipt).max(2048).parse(JSON.parse(readPrivate(this.path))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.records = []; }
  }
  get(id) { return this.records.find(r => r.id === id); }
  set(record) {
    Receipt.parse(record);
    const index = this.records.findIndex(r => r.id === record.id);
    const updated = [...this.records];
    if (index >= 0) updated[index] = record; else updated.push(record);
    // Never discard unresolved admission or accepted deduplication evidence.
    if (updated.length > 2048) throw new Error('Admission ledger full; archive only after broker history is reconciled');
    atomicWrite(this.path, JSON.stringify(updated)); this.records = updated;
  }
}
export const fingerprint = message => digest(JSON.stringify({ id: message.id, sender: message.from.agentId, channel: message.channel, text: message.text }));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [hostId, agentId, messageId, decision] = process.argv.slice(2);
  const ledger = new AdmissionLedger(hostId, agentId);
  if (!messageId) console.log(JSON.stringify(ledger.records, null, 2));
  else {
    const previous = ledger.get(messageId);
    if (!previous || !['--accepted', '--not-admitted'].includes(decision)) throw new Error('Inspect harness evidence, then explicitly resolve with --accepted or --not-admitted');
    ledger.set({ ...previous, state: decision.slice(2).replace('-', '_'), updatedAt: Date.now() });
    console.log(JSON.stringify({ resolved: true, messageId, state: ledger.get(messageId).state }));
  }
}
