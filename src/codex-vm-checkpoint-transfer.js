import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { WorktreeTransition } from './control/contracts.js';
import { CheckpointMetadata } from './control/checkpoint-observation.js';

const unavailable = () => new Error('CHECKPOINT_TRANSFER_UNAVAILABLE');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const challengeSchema = z.strictObject({ version: z.literal(1), type: z.literal('challenge'), vmInstance: hex, challenge: hex });
const receiptSchema = z.strictObject({ version: z.literal(1), type: z.literal('receipt'), vmInstance: hex, challenge: hex,
  envelopeSha256: hex, checkpointDigest: hex, status: z.literal('quarantined'), tag: hex });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const frame = bytes => { const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return Buffer.concat([size, bytes]); };

// Fixture transport only. The caller must supply the VM identity and key from
// the supervisor, retain its broker/native lease and verify the guest build.
export async function transferCheckpointToVMFixture({ stream, key, vmInstance, checkpoint, grant: input, config, signal, timeoutMs = 30000 }) {
  const grant = WorktreeTransition.parse(input), instance = hex.parse(vmInstance);
  if (!stream?.write || !stream?.on || !Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(config) ||
      !Buffer.isBuffer(checkpoint?.rollout) || !Buffer.isBuffer(checkpoint?.journal) || signal?.aborted ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw unavailable();
  const { rollout, journal, releaseAllowed, ...raw } = checkpoint, metadata = CheckpointMetadata.parse(raw);
  if (releaseAllowed !== false || !grant.agentId.startsWith('codex:') || grant.status !== 'prepared' || !grant.checkpointConfigSha256 ||
      config.length === 0 || config.length > 256 * 1024 || rollout.length === 0 || journal.length === 0 ||
      metadata.threadId !== grant.agentId.slice(6) || metadata.transitionId !== grant.id ||
      metadata.rolloutBytes !== rollout.length || metadata.journalBytes !== journal.length ||
      hash(rollout) !== metadata.rolloutSha256 || hash(journal) !== metadata.journalSha256 || hash(config) !== grant.checkpointConfigSha256 ||
      metadata.digest !== hash(Buffer.from(`${metadata.threadId}:${grant.id}:${metadata.reservation.generation}:${metadata.reservation.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${metadata.rolloutBytes}`))) throw unavailable();
  const envelope = Buffer.from(JSON.stringify({ ...metadata, rollout: rollout.toString('base64'), journal: journal.toString('base64'),
    config: config.toString('base64'), configSha256: grant.checkpointConfigSha256, grant, releaseAllowed: false }));
  if (!envelope.length || envelope.length > 6 * 1024 * 1024) throw unavailable();
  const envelopeSha256 = hash(envelope); let buffer = Buffer.alloc(0), pending, failed = false;
  const fail = () => { failed = true; if (pending) { const reject = pending.reject; pending = undefined; reject(unavailable()); } stream.destroy(); };
  const consume = () => {
    if (!pending || buffer.length < 4) return;
    const length = buffer.readUInt32BE(0);
    if (!length || length > 2048) return fail();
    if (buffer.length < length + 4) return;
    const bytes = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
    const resolve = pending.resolve; pending = undefined; resolve(bytes);
  };
  const onData = chunk => { if (failed || buffer.length + chunk.length > 4096) return fail(); buffer = Buffer.concat([buffer, chunk]); consume(); };
  const onFailure = () => fail();
  stream.on('data', onData); stream.once('error', onFailure); stream.once('end', onFailure); stream.once('close', onFailure);
  const timer = setTimeout(fail, timeoutMs), abort = () => fail(); signal?.addEventListener('abort', abort, { once: true });
  const read = () => new Promise((resolve, reject) => { if (failed || pending) return reject(unavailable()); pending = { resolve, reject }; consume(); });
  const write = bytes => new Promise((resolve, reject) => { if (failed) return reject(unavailable()); stream.write(frame(bytes), error => error ? reject(unavailable()) : resolve()); });
  try {
    if (signal?.aborted) throw unavailable();
    const challenge = challengeSchema.parse(JSON.parse((await read()).toString('utf8')));
    if (challenge.vmInstance !== instance) throw unavailable();
    const auth = { version: 1, type: 'authenticate', vmInstance: instance, challenge: challenge.challenge, envelopeSha256,
      tag: mac(key, `turnlink-vm-checkpoint-auth-v1\0${instance}\0${challenge.challenge}\0${envelopeSha256}`) };
    await write(Buffer.from(JSON.stringify(auth))); await write(envelope);
    const receipt = receiptSchema.parse(JSON.parse((await read()).toString('utf8')));
    const expected = mac(key, `turnlink-vm-checkpoint-receipt-v1\0${instance}\0${challenge.challenge}\0${envelopeSha256}\0${metadata.digest}\0quarantined`);
    if (receipt.vmInstance !== instance || receipt.challenge !== challenge.challenge || receipt.envelopeSha256 !== envelopeSha256 ||
        receipt.checkpointDigest !== metadata.digest || !equal(receipt.tag, expected) || buffer.length || failed || signal?.aborted) throw unavailable();
    return { ...receipt, releaseAllowed: false };
  } catch { throw unavailable(); }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); stream.off('data', onData); stream.off('error', onFailure);
    stream.off('end', onFailure); stream.off('close', onFailure);
    // Some Duplex wrappers emit an AbortError asynchronously on destroy.
    stream.once('error', () => {}); stream.destroy();
  }
}
