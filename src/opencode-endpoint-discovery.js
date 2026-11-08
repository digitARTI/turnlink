#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ChannelClient } from './client.js';
import { AgentID, Channel } from './protocol.js';
import { privateDirectory, readPrivate } from './storage.js';
import { validateCredential } from './config.js';

const unavailable = () => new Error('OPENCODE_ENDPOINT_DISCOVERY_UNAVAILABLE');
const reference = z.strictObject({ name: z.string().regex(/^turnlink-[0-9a-f-]{36}\.json$/), device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/), digest: z.string().regex(/^[a-f0-9]{64}$/) });
const resultSchema = z.strictObject({ active: z.literal(true), transitionID: z.string().uuid(), ownerGeneration: z.string().uuid(), endpoint: reference });
const endpointSchema = z.strictObject({ version: z.literal(1), url: z.string().url(), password: z.string().min(1).max(1024) });

// The caller holds an admin client and the configured local private root. The
// broker returns metadata only; the password never travels through the broker.
export async function discoverOpenCodeEndpoint({ client, directory, agentId, channel, transitionID, timeoutMs = 3000 }) {
  try {
    if (typeof client?.connect !== 'function' || !isAbsolute(directory) || !AgentID.parse(agentId).startsWith('opencode:') || !Channel.parse(channel) ||
        !z.string().uuid().safeParse(transitionID).success || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) throw unavailable();
    await client.connect(); if (!client.admin) throw unavailable();
    privateDirectory(directory);
    const result = resultSchema.parse(await client.request('control_receiver_owner_endpoint', { agentId, channel, transitionID }));
    if (result.transitionID !== transitionID) throw unavailable();
    const file = join(directory, result.endpoint.name), before = lstatSync(file);
    if (!before.isFile() || String(before.dev) !== result.endpoint.device || String(before.ino) !== result.endpoint.inode || before.nlink !== 1) throw unavailable();
    const contents = readPrivate(file, 4096), after = lstatSync(file);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1 ||
        createHash('sha256').update(contents).digest('hex') !== result.endpoint.digest) throw unavailable();
    const endpoint = endpointSchema.parse(JSON.parse(contents)), url = new URL(endpoint.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw unavailable();
    const response = await fetch(new URL(`/api/session/${agentId.slice('opencode:'.length)}`, url), { redirect: 'error',
      headers: { authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString('base64')}` }, signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    if (!response.ok) throw unavailable();
    const latest = resultSchema.parse(await client.request('control_receiver_owner_endpoint', { agentId, channel, transitionID }));
    const final = lstatSync(file);
    if (JSON.stringify(latest) !== JSON.stringify(result) || final.dev !== before.dev || final.ino !== before.ino ||
        readPrivate(file, 4096) !== contents) throw unavailable();
    return { endpointFile: file, ownerGeneration: result.ownerGeneration };
  } catch { throw unavailable(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config' || !isAbsolute(process.argv[3])) throw unavailable();
    const config = z.strictObject({ brokerUrl: z.string().url(), adminTokenFile: z.string().refine(isAbsolute), endpointDirectory: z.string().refine(isAbsolute),
      agentId: AgentID, channel: Channel, transitionID: z.string().uuid() }).parse(JSON.parse(readPrivate(process.argv[3], 16384)));
    client = new ChannelClient({ url: config.brokerUrl, token: validateCredential(readPrivate(config.adminTokenFile, 128).trim()), admin: true });
    const result = await discoverOpenCodeEndpoint({ client, directory: config.endpointDirectory, agentId: config.agentId, channel: config.channel, transitionID: config.transitionID });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { console.error('Turnlink: OpenCode endpoint discovery unavailable'); process.exitCode = 1; }
  finally { client?.close(); }
}
