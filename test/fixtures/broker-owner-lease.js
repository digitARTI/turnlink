import { createBroker } from '../../src/broker.js';
import { makeRemoteOpenCodeGenerationVerifier } from '../../src/opencode-completion-verifier-transport.js';
import { makeRemoteOpenCodeSourceRecoveryVerifier } from '../../src/opencode-source-recovery-verifier-transport.js';
import { readPrivate } from '../../src/storage.js';
import { startFixtureBrokerControl } from './broker-control.js';
import { randomUUID } from 'node:crypto';

const env = process.env, address = new URL(env.AGENT_CHANNEL_URL);
const options = { controlPlane: true, worktreeGrants: true, receiverHandoff: true,
  taskDispatch: env.AGENT_CHANNEL_TASKS === '1', worktreeTaskDispatch: env.AGENT_CHANNEL_WORKTREE_TASKS === '1' };
const completionVerifier = makeRemoteOpenCodeGenerationVerifier({ directory: env.TURNLINK_FIXTURE_VERIFIER_DIRECTORY,
  secret: readPrivate(env.AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE, 128).trim() });
const sourceRecoveryVerifier = env.AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_SOCKET ? makeRemoteOpenCodeSourceRecoveryVerifier({
  path: env.AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_SOCKET, secret: readPrivate(env.AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_TOKEN_FILE, 128).trim() }) : undefined;
const fixtureOperation = randomUUID(), fixtureVolume = `turnlink-opencode-volume-${randomUUID()}`;
const ownerContainmentVerifier = env.TURNLINK_FIXTURE_CONTAINMENT_STUB === '1' ? async ({ generation, lease }) => {
  if (lease.check() !== true) throw new Error('fixture lease unavailable');
  return { version: 1, generation, containerID: 'f'.repeat(64), daemonID: 'fixture-daemon', operationID: fixtureOperation,
    volume: { name: fixtureVolume, createdAt: 'fixture-date', destination: '/var/lib/turnlink' } };
} : undefined;
const broker = createBroker({ ...options, ownerLeaseRequired: true, ownerEndpointDirectory: env.TURNLINK_FIXTURE_ENDPOINT_DIRECTORY, completionVerifier, port: Number(address.port),
  sourceRecoveryVerifier, ownerContainmentVerifier, secret: env.AGENT_CHANNEL_TOKEN, adminSecret: env.TURNLINK_FIXTURE_ADMIN, directory: env.AGENT_CHANNEL_STATE_DIR });
const fixtureControl = env.TURNLINK_FIXTURE_CONTROL_TOKEN ? await startFixtureBrokerControl({ broker, secret: env.TURNLINK_FIXTURE_CONTROL_TOKEN }) : undefined;
if (fixtureControl) console.error(`fixture control port ${fixtureControl.port}`);
let dropped = false, activationDropped = false, drainDropped = false;
if (env.TURNLINK_FIXTURE_TRACE === '1' || env.TURNLINK_FIXTURE_DROP_PREPARE === '1') broker.server.on('connection', socket => {
  const methods = new Map();
  socket.prependListener('message', data => { try { const frame = JSON.parse(String(data)); methods.set(frame.id, frame.method); } catch {} });
  const send = socket.send;
  socket.send = function (data, ...args) {
    try {
      const frame = JSON.parse(String(data)), method = methods.get(frame.id);
      if (env.TURNLINK_FIXTURE_TRACE === '1' && frame.error) console.error(`fixture broker ${method}: ${frame.error}`);
      if (env.TURNLINK_FIXTURE_DROP_PREPARE === '1' && !dropped && method === 'control_receiver_release_verified' && frame?.result?.status === 'prepared') {
        dropped = true; console.error('fixture dropped prepare reply');
        const callback = args.find(value => typeof value === 'function'); callback?.(); return;
      }
      if (env.TURNLINK_FIXTURE_DROP_ACTIVATION === '1' && !activationDropped && method === 'control_receiver_owner_activate' && frame?.result?.active === true) {
        activationDropped = true; console.error('fixture dropped activation reply');
        const callback = args.find(value => typeof value === 'function'); callback?.(); return;
      }
      if (env.TURNLINK_FIXTURE_DROP_DRAIN === '1' && !drainDropped && method === 'control_receiver_owner_drain' && frame?.result?.draining === true) {
        drainDropped = true; console.error('fixture dropped drain reply');
        const callback = args.find(value => typeof value === 'function'); callback?.(); return;
      }
    } catch {}
    return send.call(this, data, ...args);
  };
});
broker.server.on('listening', () => console.error('listening on fixture'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void fixtureControl?.close(); void broker.close(); });
