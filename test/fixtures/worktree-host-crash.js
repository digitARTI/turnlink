import { join } from 'node:path';
import { readPrivate } from '../../src/storage.js';
import { ChannelClient } from '../../src/client.js';
import { ManagedWorktreeHost } from '../../src/worktree-host.js';

const { root, url, hostId, previewID } = JSON.parse(readPrivate(process.argv[2]));
const client = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') });
await client.connect(); await client.subscribe('opencode:a');
const host = new ManagedWorktreeHost({ client, hostId, channel: 'dev', credential: async () => '3'.repeat(64),
  nativePort: { exclusive: async fn => fn(), verify: async () => true }, agentId: 'opencode:a', enabled: true, now: () => 1000,
  repository: join(root, 'repo'), directory: join(root, 'state'), worktreeRoot: join(root, 'trees'),
  afterEffect: () => process.kill(process.pid, 'SIGKILL') });
await host.create(previewID);
process.exit(72);
