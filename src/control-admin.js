#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { ChannelClient } from './client.js';
import { adminToken } from './config.js';
import { privateDirectory } from './storage.js';
import { diagnosticCode } from './diagnostics.js';
import { Command } from './control/contracts.js';

// Local human/operator interface only. Never register this program as a model tool or expose its credentials to a browser.
const [operation, ...args] = process.argv.slice(2);
let client;
try {
  client = new ChannelClient({ token: adminToken(false) });
  if (operation === 'command') {
    let body = JSON.parse(args[0]);
    if (!body.id) body.id = randomUUID();
    body = Command.parse(body);
    console.error(`Turnlink control command id=${body.id}`); // Preserve the retry key even if the response is lost; never log the body.
    console.log(JSON.stringify(await client.request('control_command', { command: body })));
  } else if (operation === 'query') {
    const [channel, view = 'channel', agentId] = args;
    console.log(JSON.stringify(await client.request('control_query', { channel, view, ...(agentId ? { agentId } : {}) })));
  } else if (operation === 'enroll-adapter') {
    const [hostId, file] = args;
    if (!file || !isAbsolute(file)) throw new Error('An absolute new private credential-file path is required');
    privateDirectory(dirname(file));
    const credential = randomBytes(32).toString('hex');
    writeFileSync(file, credential, { flag: 'wx', mode: 0o600 });
    // If enrollment fails, the protected file remains for operator inspection; never overwrite an existing credential file.
    await client.request('control_enroll_adapter', { hostId, credential });
    console.log(JSON.stringify({ enrolled: true, hostId, credentialFile: file }));
  } else if (operation === 'revoke-adapter') {
    console.log(JSON.stringify(await client.request('control_revoke_adapter', { hostId: args[0] })));
  } else throw new Error('Usage: control-admin command <JSON> | query <channel> <view> [agentId] | enroll-adapter <hostId> <new-private-file> | revoke-adapter <hostId>');
} catch (error) {
  console.error(`Turnlink control operation failed (${diagnosticCode(error)}). Check command syntax, enrollment and broker control status.`);
  process.exitCode = 1;
} finally { client?.close(); }
