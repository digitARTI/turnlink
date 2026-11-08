import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { OpenCodeNativeRecovery } from './opencode-native-recovery.js';

const optionsSchema = z.strictObject({
  runtime: z.string().refine(isAbsolute), entrypoint: z.string().refine(isAbsolute), database: z.string().refine(isAbsolute),
  sessionID: z.string().startsWith('ses_').max(1024), pluginID: z.string().min(1).max(256),
  source: z.strictObject({ directory: z.string().refine(isAbsolute), workspaceID: z.string().optional() }),
  env: z.record(z.string(), z.string()), timeoutMs: z.number().int().min(10).max(300000).optional(), serveCandidate: z.boolean().optional(),
});

// The caller owns the explicit runtime and environment. This launches a separate
// stdio process for quarantined recovery only; it is not a live-session handoff.
export function launchOpenCodeNativeRecovery(input) {
  const options = optionsSchema.parse(input);
  const { runtime, entrypoint, database, sessionID, pluginID, source } = options;
  const environment = { ...options.env, OPENCODE_DB: database };
  delete environment.OPENCODE_PASSWORD; delete environment.OPENCODE_SERVER_PASSWORD;
  const password = options.serveCandidate ? randomBytes(32).toString('base64url') : undefined;
  if (password) environment.OPENCODE_SERVER_PASSWORD = password;
  const config = { fd: 3, pluginID, sessionID, directory: source.directory, ...(source.workspaceID ? { workspaceID: source.workspaceID } : {}) };
  const child = spawn(runtime, ['run', entrypoint, JSON.stringify(config)], {
    env: environment, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {}); child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
  if (!password) child.stdout.resume();
  child.stderr.resume();
  const exit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null, error: 'NATIVE_RECOVERY_UNAVAILABLE' }));
  });
  const recovery = new OpenCodeNativeRecovery({ stream: child.stdio[3], sessionID, pluginID, source, timeoutMs: options.timeoutMs });
  const ready = password ? new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), finished = false;
    const fail = () => {
      if (finished) return;
      finished = true; clearTimeout(timer); child.stdout.destroy(); recovery.close(); child.stdin.end();
      reject(Object.assign(new Error('NATIVE_RECOVERY_UNAVAILABLE'), { code: 'NATIVE_RECOVERY_UNAVAILABLE' }));
    };
    const timer = setTimeout(fail, options.timeoutMs ?? 30000);
    child.stdout.on('error', fail); child.stdout.on('end', fail);
    child.stdout.on('data', data => {
      if (finished) return;
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 16384) return fail();
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      try {
        const result = z.strictObject({ url: z.string().url() }).parse(JSON.parse(buffer.subarray(0, newline).toString('utf8')));
        const url = new URL(result.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid native server endpoint');
        finished = true; clearTimeout(timer); child.stdout.resume(); resolve(Object.freeze({ url: url.origin, password }));
      } catch { fail(); }
    });
    void exit.then(fail);
  }) : undefined;
  if (ready) void ready.catch(() => {});
  void exit.then(() => recovery.close());
  let closing;
  const close = () => closing ??= (async () => {
    recovery.close(); child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { return await exit; } finally { clearTimeout(timer); }
  })();
  return Object.freeze({ recovery, exit, close, pid: child.pid, ...(ready ? { ready } : {}) });
}
