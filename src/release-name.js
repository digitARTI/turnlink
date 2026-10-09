// Administrative CLI only: never exposed as a model tool.
import { ChannelClient } from './client.js';
import { adminToken } from './config.js';
const [channel, name] = process.argv.slice(2);
if (!channel || !name) throw new Error('Usage: node src/release-name.js <channel> <name>');
const client = new ChannelClient();
try {
  console.log(JSON.stringify(await client.request('release', { channel, name, adminToken: adminToken() })));
} finally { client.close(); }
