import { createOpenCodePluginProcessPort } from '../../src/opencode-plugin-process-port.js';
import { createOpenCodePluginCapabilityClient } from '../../src/opencode-plugin-capability-client.js';

const port = createOpenCodePluginProcessPort(process);
const client = createOpenCodePluginCapabilityClient({ port, sessionID: 'ses_child' });
try {
  const value = await client.session.get({ sessionID: 'ses_child' });
  if (value.id !== 'ses_child') throw new Error('unexpected');
  process.stdout.write('ready\n');
  await client.session.wait({ sessionID: 'ses_child' });
  process.exitCode = 1;
} catch {
  process.stdout.write('closed\n');
}
