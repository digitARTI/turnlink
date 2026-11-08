import { appendFileSync, readFileSync } from 'node:fs';
import { createBroker } from '../../src/broker.js';
import { createCodexContainedOwner } from '../../src/codex-contained-owner.js';
import { attachCodexBrokerGrantBridge } from '../../src/codex-broker-grant-bridge.js';

// Fixture only. The real broker and guard run in this child; the input file and
// signing identity are disposable same-UID test resources, not trusted setup.
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const stream = new (await import('node:net')).Socket({ fd: 3, readable: true, writable: true });
const owner = createCodexContainedOwner(config.options);
const bridge = attachCodexBrokerGrantBridge({ stream, owner, grant: config.options.grant, effectID: config.options.effectID,
  resourceID: config.options.resourceID, kind: config.options.kind });
const broker = createBroker({ directory: config.directory, port: config.port, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
  controlPlane: true, worktreeGrants: true, receiverHandoff: true, codexEffectArbiter: owner });
broker.server.once('listening', () => appendFileSync(config.log, `BROKER-READY ${process.pid}\n`));
const stop = async () => { bridge.close(); await broker.close().catch(() => {}); process.exit(0); };
stream.once('close', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
