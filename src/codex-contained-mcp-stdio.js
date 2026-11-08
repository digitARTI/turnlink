#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { z } from 'zod';
import { readPrivate } from './storage.js';
import { CodexContainedMcp } from './codex-contained-mcp.js';
import { createContainedMcpPeer } from './codex-contained-mcp-peer.js';

const v1 = z.strictObject({ version: z.literal(1), directory: z.string().refine(isAbsolute), docker: z.string().refine(isAbsolute),
  spec: z.strictObject({ resourceID: z.string().uuid(), image: z.string(), command: z.array(z.string()) }) });
const v2 = z.strictObject({ version: z.literal(2), directory: z.string().refine(isAbsolute), docker: z.string().refine(isAbsolute),
  spec: z.strictObject({ image: z.string(), command: z.array(z.string()) }),
  instances: z.array(z.strictObject({ cwd: z.string().refine(isAbsolute), resourceID: z.string().uuid() })).min(1).max(64) });
const configSchema = z.discriminatedUnion('version', [v1, v2]);
const unavailable = () => new Error('CONTAINED_MCP_STDIO_UNAVAILABLE');

function selectOwnerConfig(value) {
  const config = configSchema.parse(value);
  if (config.version === 1) return config;
  const current = realpathSync(process.cwd()), paths = new Set(), resources = new Set(); let selected;
  for (const instance of config.instances) {
    const cwd = realpathSync(instance.cwd);
    if (!statSync(cwd).isDirectory() || paths.has(cwd) || resources.has(instance.resourceID)) throw unavailable();
    paths.add(cwd); resources.add(instance.resourceID);
    if (cwd === current) selected = instance.resourceID;
  }
  if (!selected) throw unavailable();
  return { version: 1, directory: config.directory, docker: config.docker, spec: { ...config.spec, resourceID: selected } };
}

// One explicit resource identity means one start attempt. Diagnostic messages
// go to stderr; stdout remains exclusively the MCP byte stream.
export async function runContainedMcpStdio(config, { input = process.stdin, output = process.stdout, diagnostic = process.stderr, signal } = {}) {
  config = selectOwnerConfig(config);
  if (signal?.aborted) throw unavailable();
  let created = false, started, stopRequested = false, stopResolve, watchdog, clean = false, peer, owner;
  const stopped = new Promise(resolve => { stopResolve = resolve; });
  const stop = () => { if (!stopRequested) { stopRequested = true; stopResolve(); } };
  const broken = () => stop();
  signal?.addEventListener('abort', stop, { once: true }); output.on('error', broken);
  input.once('end', stop); input.once('close', stop); input.once('error', stop);
  try {
    if (signal?.aborted) throw unavailable();
    if (input.readableEnded || input.destroyed) stop();
    if (stopRequested) return;
    peer = await createContainedMcpPeer(stop);
    const ownerConfig = { ...config, operationID: randomUUID(), wrapperPID: process.pid,
      peer: { path: peer.path, nonce: peer.nonce, device: peer.device, inode: peer.inode } };
    owner = new CodexContainedMcp(ownerConfig);
    if (stopRequested || signal?.aborted) return;
    watchdog = spawn(process.execPath, [fileURLToPath(new URL('./codex-contained-mcp-watchdog.js', import.meta.url))],
      { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    watchdog.stdin.on('error', stop); watchdog.stdout.on('error', stop); watchdog.once('error', stop); watchdog.once('exit', stop);
    const ready = new Promise((resolve, reject) => {
      let data = ''; const timer = setTimeout(() => reject(unavailable()), 5000);
      watchdog.stdout.on('data', chunk => { data += chunk.toString(); if (data === 'READY\n') { clearTimeout(timer); resolve(); }
        else if (data.length >= 6) { clearTimeout(timer); reject(unavailable()); } });
      watchdog.once('error', () => { clearTimeout(timer); reject(unavailable()); });
      watchdog.once('exit', () => { clearTimeout(timer); reject(unavailable()); });
    });
    watchdog.stdin.write(`${JSON.stringify(ownerConfig)}\n`);
    await ready;
    if (stopRequested || signal?.aborted) return;
    await owner.create(); created = true;
    if (stopRequested || signal?.aborted) { await owner.remove(); clean = true; return; }
    started = await owner.start();
    input.pipe(started.child.stdin); started.child.stdout.pipe(output, { end: false }); started.child.stderr.pipe(diagnostic, { end: false });
    if (stopRequested || signal?.aborted) stop();
    await Promise.race([started.exited, stopped]);
    input.unpipe(started.child.stdin); started.child.stdin.end();
    let receipt;
    for (let attempt = 0; attempt < 10 && !receipt; attempt++) {
      try { receipt = await owner.stop(); }
      catch (error) { if (attempt === 9) throw error; await delay(100); }
    }
    if (receipt?.status !== 'stopped_local') throw unavailable();
    const timer = setTimeout(() => started.child.kill('SIGKILL'), 3000);
    let result;
    try { result = await started.exited; } finally { clearTimeout(timer); }
    clean = true;
    if (!stopRequested && (result.error || result.signal !== null || result.code !== 0)) throw unavailable();
  } catch (error) {
    if (created && !started) { try { await owner.remove(); clean = true; } catch { /* Keep the durable state for operator recovery. */ } }
    throw error;
  } finally {
    if (watchdog) { if (clean) watchdog.stdin.write('DONE\n'); watchdog.stdin.end(); }
    peer?.close();
    signal?.removeEventListener('abort', stop); output.off('error', broken);
    input.off('end', stop); input.off('close', stop); input.off('error', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config' || !isAbsolute(process.argv[3])) throw unavailable();
    await runContainedMcpStdio(JSON.parse(readPrivate(process.argv[3], 65536)), { signal: controller.signal });
  } catch { console.error('Turnlink: contained MCP stdio unavailable'); process.exitCode = 1; }
}
