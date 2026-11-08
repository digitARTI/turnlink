import { createHash } from 'node:crypto';
import { isCodexContainedOwner } from './codex-contained-owner.js';
import { WorktreeTransition } from './control/contracts.js';

// Connect only to a reviewed bridge process over its inherited private stream.
// The process must run under a dedicated OS identity; same-UID files or tokens
// are not peer authentication. This module grants no effect-dispatch authority.
export function attachCodexBrokerGrantBridge({ stream, owner, grant: input, effectID, resourceID, kind }) {
  const grant = WorktreeTransition.parse(input), digest = createHash('sha256').update(JSON.stringify(grant)).digest('hex');
  if (!isCodexContainedOwner(owner) || !owner.matches(grant) || !stream?.on || !stream?.write || !stream?.destroy ||
      typeof effectID !== 'string' || typeof resourceID !== 'string' || !['stop', 'remove'].includes(kind)) throw new Error('CODEX_BROKER_GRANT_BRIDGE_UNAVAILABLE');
  let closed = false, inputBuffer = ''; const leases = new Map();
  const close = () => { if (closed) return; closed = true; clearInterval(heartbeat); for (const entry of leases.values()) entry.release(); leases.clear(); stream.destroy(); };
  const send = data => { if (closed || stream.destroyed) return close(); try { if (!stream.write(`${JSON.stringify(data)}\n`)) close(); } catch { close(); } };
  const heartbeat = setInterval(() => {
    for (const lease of [...leases.values()]) { try { lease.check(); } catch { /* lease invalidates itself */ } }
    send({ type: 'heartbeat', id: '00000000-0000-0000-0000-000000000000' });
  }, 1000);
  heartbeat.unref?.();
  const handle = data => {
    if (!data || Object.getPrototypeOf(data) !== Object.prototype || typeof data.id !== 'string' || data.id === '00000000-0000-0000-0000-000000000000' || !/^[a-f0-9-]{36}$/.test(data.id)) throw new Error('invalid');
    if (data.type === 'release' && Object.keys(data).sort().join(',') === 'id,type') { leases.get(data.id)?.release(); leases.delete(data.id); return; }
    if (data.type !== 'subscribe' || Object.keys(data).sort().join(',') !== 'digest,effect,id,kind,resource,transition,type' || leases.has(data.id) || leases.size >= 64) throw new Error('invalid');
    if (data.digest !== digest || data.transition !== grant.id || data.effect !== effectID || data.resource !== resourceID || data.kind !== kind) { send({ type: 'refused', id: data.id }); return; }
    let lease;
    try { lease = owner.acquireBrokerObservation({ grant, effectID, resourceID, kind }); }
    catch { send({ type: 'refused', id: data.id }); return; }
    leases.set(data.id, lease);
    lease.onInvalidate(() => { leases.delete(data.id); send({ type: 'invalidated', id: data.id }); });
    try { lease.check(); send({ type: 'active', id: data.id }); } catch { lease.release(); leases.delete(data.id); send({ type: 'refused', id: data.id }); }
  };
  stream.setEncoding?.('utf8');
  stream.on('data', chunk => {
    try {
      inputBuffer += chunk; if (inputBuffer.length > 65536) throw new Error('frame limit');
      for (;;) { const end = inputBuffer.indexOf('\n'); if (end < 0) break;
        const line = inputBuffer.slice(0, end); inputBuffer = inputBuffer.slice(end + 1);
        if (line.length > 4096) throw new Error('frame limit'); handle(JSON.parse(line)); }
    } catch { close(); }
  });
  stream.on('error', close); stream.on('end', close); stream.on('close', close);
  return Object.freeze({ close, get closed() { return closed; } });
}
