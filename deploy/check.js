import { ChannelClient } from '../src/client.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] || 'C:\\ProgramData\\agent-channel';
const config = JSON.parse(readFileSync(join(root, 'bin', 'launcher.json'), 'utf8'));
process.env.AGENT_CHANNEL_URL = config.url;
process.env.AGENT_CHANNEL_TOKEN_FILE = config.tokenFile;
const channel = new ChannelClient();
try {
  const members = await channel.request('members', { channel: 'development' });
  console.log(JSON.stringify({ authenticated: true, url: config.url, members: members.map(m => ({ agentId: m.agentId, name: m.name, connected: m.connected })) }));
} finally { channel.close(); }
