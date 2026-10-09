import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { ChannelClient } from './client.js';
import { adminToken } from './config.js';
import { privateDirectory } from './storage.js';

const [command, hostId, ...args] = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const client = new ChannelClient({ token: adminToken() });
try {
  if (command === 'enroll') {
    const output = option('--out'), channel = option('--channel');
    if (!output || !channel) throw new Error('Usage: host-admin enroll <hostId> --channel <channel> --out <new-private-file> [--broadcast]');
    privateDirectory(dirname(output));
    const credential = randomBytes(32).toString('hex');
    writeFileSync(output, credential, { flag: 'wx', mode: 0o600 });
    try {
      const result = await client.request('enroll', { hostId, credential, channels: [channel], broadcast: args.includes('--broadcast') });
      console.log(JSON.stringify({ ...result, credentialFile: output }));
    } catch (error) { unlinkSync(output); throw error; }
  } else if (command === 'revoke') console.log(JSON.stringify(await client.request('revoke', { hostId })));
  else if (command === 'revoke-session') console.log(JSON.stringify(await client.request('revoke_session', { agentId: hostId })));
  else throw new Error('Use enroll or revoke; credentials are never printed');
} finally { client.close(); }
