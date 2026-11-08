import { appendFileSync, fstatSync } from 'node:fs';
import { Socket } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { createBroker } from '../../../src/broker.js';
import { createCodexContainedOwner } from '../../../src/codex-contained-owner.js';
import { attachCodexBrokerGrantBridge } from '../../../src/codex-broker-grant-bridge.js';
import { WorktreeTransition } from '../../../src/control/contracts.js';
import { validateCredential } from '../../../src/config.js';
import { readPrivate } from '../../../src/storage.js';

// Replaced with immutable literals at bundle time. Fixture overrides exist only
// in a separately compiled test package; the review package has fixed paths.
const fixture = __TURNLINK_PROTECTED_BROKER_FIXTURE__;
const fixedRoot = __TURNLINK_PROTECTED_BROKER_ROOT__;
const fixedUID = __TURNLINK_PROTECTED_BROKER_UID__;
const failure = () => new Error('PROTECTED_BROKER_UNAVAILABLE');
const id = z.string().uuid();
const schema = z.strictObject({ version: z.literal(1), port: z.number().int().min(1).max(65535), grant: WorktreeTransition,
  effectID: id, resourceID: id, kind: z.enum(['stop', 'remove']) });

async function main() {
  const root = fixture ? process.env.TURNLINK_PROTECTED_BROKER_TEST_ROOT : fixedRoot;
  const expectedUID = fixture ? Number(process.env.TURNLINK_PROTECTED_BROKER_TEST_UID) : fixedUID;
  if (!isAbsolute(root || '') || !Number.isSafeInteger(expectedUID) || expectedUID <= 0 ||
      !fixture && (expectedUID < 450 || expectedUID > 499) || process.getuid?.() !== expectedUID || process.geteuid?.() !== expectedUID) throw failure();
  const fd = fstatSync(3); if (!fd.isSocket() && !fd.isFIFO()) throw failure();
  const config = schema.parse(JSON.parse(readPrivate(join(root, 'broker-config.json'), 65536)));
  const secret = validateCredential(readPrivate(join(root, 'broker-token'), 128).trim());
  const adminSecret = validateCredential(readPrivate(join(root, 'broker-admin-token'), 128).trim());
  const owner = createCodexContainedOwner({ directory: join(root, 'owner'), grant: config.grant, effectID: config.effectID,
    resourceID: config.resourceID, kind: config.kind, expectedUID });
  const stream = new Socket({ fd: 3, readable: true, writable: true });
  const bridge = attachCodexBrokerGrantBridge({ stream, owner, grant: config.grant, effectID: config.effectID,
    resourceID: config.resourceID, kind: config.kind });
  const broker = createBroker({ directory: join(root, 'broker'), port: config.port, secret, adminSecret,
    controlPlane: true, worktreeGrants: true, receiverHandoff: true, codexEffectArbiter: owner });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; bridge.close(); await broker.close().catch(() => {}); process.exit(1); };
  stream.once('close', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  broker.server.once('listening', () => {
    if (fixture && process.env.TURNLINK_PROTECTED_BROKER_TEST_LOG) appendFileSync(process.env.TURNLINK_PROTECTED_BROKER_TEST_LOG, `BROKER-READY ${process.pid}\n`);
    if (fixture) process.send?.({ type: 'ready' });
  });
}
main().catch(() => { console.error('Turnlink: protected broker unavailable'); process.exitCode = 1; });
