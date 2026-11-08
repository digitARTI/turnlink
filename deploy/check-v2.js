import { join } from 'node:path';
import { ChannelClient } from '../src/client.js';
const root = process.argv[2] || 'C:\\ProgramData\\turnlink-v0.2';
const client = new ChannelClient({ url: 'ws://127.0.0.1:47324', tokenFile: join(root, 'private', 'gameserver.token') });
try { console.log(JSON.stringify(await client.request('hello', {}))); }
finally { client.close(); }
