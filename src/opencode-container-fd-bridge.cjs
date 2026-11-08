// Private stdio bridge for an isolated test container. The first stdin line is
// the launch configuration; later bytes belong exclusively to descriptor 3.
// The first stdout line is the native loopback endpoint, followed by descriptor
// bytes. Nothing here authorizes a broker operation or proves container death.
const { spawn } = require('node:child_process');
const { isAbsolute } = require('node:path');
const { writeFileSync } = require('node:fs');

let buffer = Buffer.alloc(0), child, launched = false, ready = false;
const fail = () => { child?.kill('SIGKILL'); process.exitCode = 1; process.stdin.destroy(); };
process.stdin.on('error', fail);
process.stdout.on('error', fail);
process.stdin.on('data', data => {
  if (launched) { if (!child.stdio[3].write(data)) process.stdin.pause(); return; }
  buffer = Buffer.concat([buffer, data]);
  if (buffer.length > 16384) return fail();
  const newline = buffer.indexOf(10); if (newline < 0) return;
  try {
    const input = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
    const keys = ['entrypoint', 'database', 'sessionID', 'pluginID', 'directory', 'workspaceID', 'password', 'environment', 'configContent', 'secretFiles'];
    if (!input || Object.keys(input).some(key => !keys.includes(key)) ||
        ![input.entrypoint, input.database, input.directory].every(path => typeof path === 'string' && isAbsolute(path) && !path.includes('\0')) ||
        typeof input.sessionID !== 'string' || !input.sessionID.startsWith('ses_') || typeof input.pluginID !== 'string' || !input.pluginID ||
        (input.workspaceID !== undefined && typeof input.workspaceID !== 'string') || typeof input.password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(input.password) ||
        !input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment) ||
        (input.configContent !== undefined && (typeof input.configContent !== 'string' || Buffer.byteLength(input.configContent) > 8192))) throw new Error('Invalid bridge input');
    const environment = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', XDG_DATA_HOME: '/tmp/data', XDG_CACHE_HOME: '/tmp/cache',
      XDG_CONFIG_HOME: '/tmp/config', OPENCODE_DB: input.database, OPENCODE_SERVER_PASSWORD: input.password,
      OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1', OPENCODE_LOG_LEVEL: 'ERROR' };
    if (input.configContent !== undefined) environment.OPENCODE_CONFIG_CONTENT = input.configContent;
    if (input.secretFiles !== undefined) {
      if (!input.secretFiles || typeof input.secretFiles !== 'object' || Array.isArray(input.secretFiles)) throw new Error('Invalid bridge secrets');
      for (const [name, secret] of Object.entries(input.secretFiles)) {
        if (!['host.token', 'adapter.token', 'movement.token'].includes(name) || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid bridge secret');
        writeFileSync(`/run/turnlink-secrets/${name}`, secret, { mode: 0o600, flag: 'wx' });
      }
    }
    for (const [key, value] of Object.entries(input.environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof value !== 'string' || value.includes('\0') ||
          /^(?:NODE_|BUN_|LD_|DYLD_|OPENCODE_|PATH$|HOME$|XDG_)/.test(key)) throw new Error('Invalid bridge environment');
      environment[key] = value;
    }
    const config = { fd: 3, sessionID: input.sessionID, pluginID: input.pluginID, directory: input.directory,
      ...(input.workspaceID === undefined ? {} : { workspaceID: input.workspaceID }) };
    child = spawn('/usr/local/bin/turnlink-bun', ['run', input.entrypoint, JSON.stringify(config)],
      { env: environment, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    launched = true;
    const pending = buffer.subarray(newline + 1); buffer = Buffer.alloc(0);
    process.stdin.pause();
    child.on('error', fail); child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdio[3].on('error', fail); child.stdio[3].on('drain', () => process.stdin.resume());
    let nativeOutput = Buffer.alloc(0), nativeBytes = 0;
    child.stdout.on('data', data => {
      if (ready) return;
      nativeOutput = Buffer.concat([nativeOutput, data]); nativeBytes += data.length;
      if (nativeOutput.length > 16384 || nativeBytes > 65536) return fail();
      let end;
      while (!ready && (end = nativeOutput.indexOf(10)) >= 0) {
        const line = nativeOutput.subarray(0, end).toString('utf8'); nativeOutput = nativeOutput.subarray(end + 1);
        try {
          const result = JSON.parse(line), url = new URL(result.url);
          if (Object.keys(result).length !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
              url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue;
          ready = true; process.stdout.write(`${JSON.stringify({ url: url.origin })}\n`); child.stdio[3].pipe(process.stdout);
          if (pending.length) child.stdio[3].write(pending);
          process.stdin.resume();
        } catch { /* Ignore native log lines, never forward them to the descriptor. */ }
      }
    });
    child.stdout.on('error', fail); child.stdout.on('end', () => { if (!ready) fail(); });
    child.once('close', (code, signal) => { process.exitCode = code === 0 && !signal ? 0 : 1; process.stdin.destroy(); });
  } catch { fail(); }
});
process.stdin.on('end', () => { child?.stdin.end(); child?.stdio[3].end(); });
