// Offline/staged migration only. Source is never edited; legacy keys are never copied.
import { resolve, join } from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readPrivate, privateDirectory, atomicWrite, acquireStore } from './storage.js';
import { digest } from './config.js';
import { HostID, validateState, Security } from './protocol.js';

const [source, destination, ...assignments] = process.argv.slice(2);
if (!source || !destination || !assignments.length) throw new Error('Usage: migrate-v2 <source-store.json> <new-empty-directory> <agentId=hostId> ...');
const directory = resolve(destination);
if (resolve(source).startsWith(`${directory}/`) || resolve(source).startsWith(`${directory}\\`)) throw new Error('Destination must differ from source');
privateDirectory(directory);
if (readdirSync(directory).length) throw new Error('Destination must be empty');
const unlock = acquireStore(directory, () => { throw new Error('Migration writer lock compromised'); });
try {
  const legacy = JSON.parse(readPrivate(source));
  if (legacy.version !== 2 || !legacy.agents || !Array.isArray(legacy.messages)) throw new Error('Expected legacy version-2 state');
  const ownerMap = new Map(assignments.map(item => {
    const split = item.lastIndexOf('=');
    if (split < 0) throw new Error('Ownership assignment must be agentId=hostId');
    return [item.slice(0, split), HostID.parse(item.slice(split + 1))];
  }));
  if (ownerMap.size !== assignments.length) throw new Error('Duplicate ownership assignment');
  for (const id of ownerMap.keys()) if (!Object.hasOwn(legacy.agents, id)) throw new Error('Assignment references an unknown active agent');
  const store = { version: 3, agents: {}, bindings: {}, messages: [] };
  const security = { version: 1, hosts: {} }; const tokens = new Map();
  const now = Date.now();
  for (const [id, a] of Object.entries(legacy.agents)) {
    const hostId = ownerMap.get(id); if (!hostId) throw new Error('Every active legacy identity needs an explicit host assignment');
    if (['operator', 'unassigned'].includes(hostId)) throw new Error('Reserved host identity');
    if (!tokens.has(hostId)) tokens.set(hostId, randomBytes(32).toString('hex'));
    const publicAgent = { ...a, hostId, disconnectedAt: now, reservationExpiresAt: now + 300000 };
    store.agents[id] = publicAgent; store.bindings[id] = { hostId, proofHash: null };
    if (!security.hosts[hostId]) security.hosts[hostId] = { hostId, tokenHash: digest(tokens.get(hostId)), channels: [], broadcast: true, revoked: false };
    if (!security.hosts[hostId].channels.includes(a.channel)) security.hosts[hostId].channels.push(a.channel);
  }
  const quarantined = [];
  for (const old of legacy.messages) {
    const hostId = ownerMap.get(old.from.agentId) || 'historical';
    const message = { ...old, from: { ...old.from, hostId }, to: old.to || (old.recipients.length === 1 ? old.recipients[0] : '*'), cancelled: { ...(old.cancelled || {}) } };
    for (const recipient of message.recipients) if (!message.delivered.includes(recipient) && !message.cancelled[recipient]) {
      message.cancelled[recipient] = 'legacy_migration_review'; quarantined.push({ messageId: message.id, recipient });
    }
    store.messages.push(message);
    for (const id of [message.from.agentId, ...message.recipients]) if (!store.bindings[id]) {
      store.bindings[id] = { hostId: ownerMap.get(id) || 'historical', proofHash: null };
    }
  }
  validateState(store); Security.parse(security);
  for (const [host, credential] of tokens) writeFileSync(join(directory, `${host}.token`), credential, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'admin-token'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  atomicWrite(join(directory, 'security.json'), JSON.stringify(security));
  atomicWrite(join(directory, 'store.json'), JSON.stringify(store));
  atomicWrite(join(directory, 'migration.json'), JSON.stringify({ source: resolve(source), preparedAt: new Date().toISOString(),
    activeIds: Object.keys(store.agents), quarantined }, null, 2));
  console.log(JSON.stringify({ staged: true, directory, hosts: [...tokens.keys()], quarantinedCount: quarantined.length,
    note: 'Fresh credentials created privately. Start within the five-minute reservation or prepare a fresh coordinated snapshot. Source and live broker untouched.' }));
} finally { unlock(); }
