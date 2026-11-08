import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { OpenCodeNativeMovement } from './opencode-native-movement.js';
import { serveOpenCodeNativeOwnerTransport } from './opencode-native-owner-transport.js';
import { serveOpenCodeDestinationOwnerTransport } from './opencode-destination-owner-transport.js';

const unavailable = () => Object.assign(new Error('NATIVE_LIVE_HOST_UNAVAILABLE'), { code: 'NATIVE_LIVE_HOST_UNAVAILABLE' });
const optionsSchema = z.strictObject({
  runtime: z.string().refine(isAbsolute), entrypoint: z.string().refine(isAbsolute), database: z.string().refine(isAbsolute),
  sessionID: z.string().startsWith('ses_').max(1024), pluginID: z.string().min(1).max(256),
  source: z.strictObject({ directory: z.string().refine(isAbsolute), workspaceID: z.string().optional() }),
  env: z.record(z.string(), z.string()), timeoutMs: z.number().int().min(10).max(300000).optional(),
  delegateOwnerControl: z.boolean().optional(),
});

// A new isolated server owns this native graph from startup. The returned
// capability is not attached to an already-running or installed server.
export function launchOpenCodeNativeLive(input, { destinationSupervisor, hostedShim = false } = {}) {
  const options = optionsSchema.parse(input);
  if (destinationSupervisor && !options.delegateOwnerControl) throw unavailable();
  if (hostedShim && (options.delegateOwnerControl || destinationSupervisor || options.pluginID !== 'turnlink' || options.source.workspaceID)) throw unavailable();
  const { runtime, entrypoint, database, sessionID, pluginID, source } = options;
  const password = randomBytes(32).toString('base64url');
  const env = { ...options.env, OPENCODE_DB: database, OPENCODE_SERVER_PASSWORD: password };
  delete env.OPENCODE_PASSWORD;
  const config = { fd: 3, pluginID, sessionID, directory: source.directory, ...(source.workspaceID ? { workspaceID: source.workspaceID } : {}),
    ...(hostedShim ? { hostedFd: 5 } : {}) };
  const child = spawn(runtime, ['run', entrypoint, JSON.stringify(config)], { env,
    stdio: destinationSupervisor ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] :
      options.delegateOwnerControl || hostedShim ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
  child.stdout.on('error', () => {}); child.stdout.resume();
  child.stdin.on('error', () => {}); child.stderr.on('error', () => {});
  if (env.TURNLINK_SEAL_DIAGNOSTIC === '1') {
    let diagnostic = '';
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096);
      for (const match of diagnostic.matchAll(/SEAL_STAGE:(daemon-before|inspect-before|exec-hash|live-after-exec|parse-hash|compare-hash|ack-hash|inspect-after|daemon-after)\n/g))
        process.stderr.write(`${match[0]}`);
      for (const match of diagnostic.matchAll(/PREVIEW_STAGE:(pair|binding|broker|recheck)\n/g)) process.stderr.write(match[0]);
      diagnostic = diagnostic.slice(diagnostic.lastIndexOf('\n') + 1);
    });
  } else child.stderr.resume();
  const movement = new OpenCodeNativeMovement({ stream: child.stdio[3], sessionID, pluginID, source, timeoutMs: options.timeoutMs });
  const ownerTransport = options.delegateOwnerControl ? serveOpenCodeNativeOwnerTransport({ stream: child.stdio[5], native: movement, sessionID }) : undefined;
  const destinationTransport = destinationSupervisor ? serveOpenCodeDestinationOwnerTransport({ stream: child.stdio[6], supervisor: destinationSupervisor }) : undefined;
  const exit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null, error: 'NATIVE_LIVE_HOST_UNAVAILABLE' }));
  });
  let finished = false;
  const ready = new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const readiness = child.stdio[4];
    const fail = () => { if (!finished) { finished = true; clearTimeout(timer); readiness.destroy(); movement.close(); child.stdin.end(); reject(unavailable()); } };
    const timer = setTimeout(fail, options.timeoutMs ?? 30000);
    readiness.on('error', fail);
    readiness.on('end', fail);
    readiness.on('data', data => {
      if (finished) return;
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 16384) return fail();
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      try {
        const result = z.strictObject({ url: z.string().url() }).parse(JSON.parse(buffer.subarray(0, newline).toString('utf8')));
        const url = new URL(result.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw unavailable();
        finished = true; clearTimeout(timer); readiness.resume();
        resolve(Object.freeze({ url: url.origin, password }));
      } catch { fail(); }
    });
    void exit.then(fail);
  });
  // Closing a host before it becomes ready is valid even if no caller awaited it.
  void ready.catch(() => {});
  void exit.then(() => { destinationTransport?.close(); movement.close(); });
  let closing;
  const close = () => closing ??= (async () => {
    destinationTransport?.close(); ownerTransport?.close(); movement.close(); child.stdin.end();
    // Give the native owner's bounded five-second socket settlement time to finish.
    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
    try { return await exit; } finally { clearTimeout(timer); }
  })();
  return Object.freeze({ movement: options.delegateOwnerControl ? undefined : movement, ready, exit, close, pid: child.pid,
    ...(hostedShim ? { hostedStream: child.stdio[5] } : {}) });
}
