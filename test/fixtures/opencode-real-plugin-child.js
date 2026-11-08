import { setupOpenCode } from '../../adapters/opencode-runtime.js';
import { createOpenCodePluginProcessPort } from '../../src/opencode-plugin-process-port.js';
import { createOpenCodePluginStreamPort } from '../../src/opencode-plugin-stream-port.js';
import { createOpenCodePluginCapabilityClient } from '../../src/opencode-plugin-capability-client.js';
import { OpenCodePluginParticipantChannel } from '../../src/opencode-plugin-participant-channel.js';

const sessionID = process.argv[3] || 'ses_bridge', directory = process.argv[4] || '/synthetic';
const port = process.env.TURNLINK_STREAM_IPC === '1' ?
  createOpenCodePluginStreamPort({ input: process.stdin, output: process.stdout }) : createOpenCodePluginProcessPort(process);
const capability = createOpenCodePluginCapabilityClient({ port, sessionID });
const channel = new OpenCodePluginParticipantChannel(capability, sessionID);
const ctx = { ...capability, app: { version: '2.0.30' }, location: { directory }, options: { control: true } };
let cleanup;
capability.onClose(() => { void Promise.resolve(cleanup?.()).finally(() => { process.exitCode = 0; }); });
try { cleanup = await setupOpenCode(ctx, { channel, allowParticipantControl: true, createAdmissionLedger: capability.createAdmissionLedger });
  (process.env.TURNLINK_STREAM_IPC === '1' ? process.stderr : process.stdout).write('ready\n'); }
catch (error) { process.stderr.write(`PLUGIN_BOOTSTRAP_FAILED: ${error.message}\n`); process.exitCode = 1; capability.close(); }
