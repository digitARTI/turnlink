import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WorktreeTransition } from './control/contracts.js';
import { attachCodexMcpAttemptOwner } from './codex-mcp-attempt-owner.js';

const unavailable = () => new Error('CODEX_VM_CAPABILITY_UNAVAILABLE');

// Transport primitive only: the caller must bind this stream and key to the
// intended VM and protect host key material. It does not authenticate a
// guest process, confer release authority, or create a vsock listener.
export function acceptCodexVmAttemptCapability({ stream, key, grant: input, owner, directory, effectID, resourceID, kind, lifetimeMs, onReady }) {
  const grant = WorktreeTransition.parse(input);
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 30000 ||
      typeof onReady !== 'function' || !stream?.on || !stream?.write || !stream?.destroy) throw unavailable();
  const scope = createHash('sha256').update(JSON.stringify(grant)).digest('hex'), challenge = randomBytes(32).toString('hex');
  const deadline = performance.now() + lifetimeMs;
  let buffer = '', finished = false, closed = false, recorder;
  const stop = () => { if (closed) return; closed = true; clearTimeout(timer); recorder?.close(); stream.destroy(); };
  const timer = setTimeout(stop, lifetimeMs); timer.unref();
  const handshake = chunk => {
    try {
      if (finished || performance.now() >= deadline) throw unavailable();
      buffer += chunk.toString('utf8'); if (buffer.length > 512) throw unavailable();
      const end = buffer.indexOf('\n'); if (end < 0) return;
      if (end !== buffer.length - 1) throw unavailable();
      const request = JSON.parse(buffer.slice(0, end));
      if (!request || Object.keys(request).sort().join(',') !== 'scope,tag,type,version' || request.type !== 'authenticate' ||
          request.version !== 1 || request.scope !== scope || typeof request.tag !== 'string' || !/^[a-f0-9]{64}$/.test(request.tag)) throw unavailable();
      const expected = createHmac('sha256', key).update(`turnlink-vm-attempt-v1\0${scope}\0${challenge}`).digest();
      if (!timingSafeEqual(expected, Buffer.from(request.tag, 'hex'))) throw unavailable();
      finished = true; stream.off('data', handshake);
      recorder = attachCodexMcpAttemptOwner({ stream, directory, owner, grant, effectID, resourceID, kind, checkDeadline: () => performance.now() < deadline });
      if (performance.now() >= deadline) throw unavailable();
      const tag = createHmac('sha256', key).update(`turnlink-vm-attempt-ready-v1\0${scope}\0${challenge}`).digest('hex');
      if (!stream.write(`${JSON.stringify({ version: 1, type: 'ready', scope, tag })}\n`)) throw unavailable();
      onReady(recorder);
    } catch { stop(); }
  };
  stream.on('error', stop); stream.on('close', stop); stream.on('end', stop); stream.on('data', handshake);
  if (!stream.write(`${JSON.stringify({ version: 1, type: 'challenge', scope, challenge })}\n`)) { stop(); throw unavailable(); }
  return Object.freeze({ close: stop });
}
