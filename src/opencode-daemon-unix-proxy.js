import { createServer } from 'node:net';
import { chmodSync, linkSync, lstatSync, unlinkSync, watch } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { privateDirectory } from './storage.js';

// Experimental local endpoint for a supervisor-owned upstream stream. This
// forwards the full daemon API and is NOT a same-UID isolation boundary.
export async function createOpenCodeDaemonUnixProxy({ path, openStream, signal, onDiagnostic }) {
  if (!isAbsolute(path || '') || typeof openStream !== 'function' || signal?.aborted ||
      (onDiagnostic !== undefined && typeof onDiagnostic !== 'function')) throw new Error('DAEMON_PROXY_UNAVAILABLE');
  privateDirectory(dirname(path));
  try { lstatSync(path); throw new Error('DAEMON_PROXY_UNAVAILABLE'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const peers = new Set(); let closed = false, identity, watcher, timer;
  const stopPeers = () => { for (const peer of peers) peer.destroy(); peers.clear(); };
  const server = createServer({ allowHalfOpen: true }, socket => {
    if (closed || peers.size >= 64) { socket.destroy(); return; }
    socket.pause(); peers.add(socket);
    let upstream, timer, route = 'unknown';
    const diagnostic = value => { try { onDiagnostic?.(value); } catch {} };
    if (onDiagnostic) socket.on('data', chunk => {
      const text = Buffer.from(chunk).toString('latin1');
      for (const item of text.matchAll(/(GET|POST|HEAD|DELETE) \/(?:v[0-9.]+\/)?(_ping|info|containers\/create|containers\/[^\s/?]+\/(?:json|attach|start|wait|exec)|exec\/[^\s/?]+\/(?:start|json)|images\/[^\s/?]+\/json)([^\s]*) HTTP\/1\.[01]/g)) {
        route = item[2].replace(/containers\/[^/]+\//, 'containers/<id>/').replace(/exec\/[^/]+\//, 'exec/<id>/').replace(/images\/[^/]+\//, 'images/<id>/');
        const wait = route.endsWith('/wait') ? /[?&]condition=(removed|not-running|next-exit)(?:&|$)/.exec(item[3])?.[1] : undefined;
        diagnostic(`request:${item[1]}:${route}${wait ? `:${wait}` : ''}`);
      }
    });
    if (onDiagnostic) socket.once('close', () => diagnostic(`client-close:${route}`));
    const drop = () => { clearTimeout(timer); peers.delete(socket); socket.destroy(); if (upstream) { peers.delete(upstream); upstream.destroy(); } };
    timer = setTimeout(drop, 10000); timer.unref();
    socket.once('error', drop); socket.once('close', drop);
    Promise.resolve().then(() => openStream()).then(value => {
      clearTimeout(timer);
      if (closed || socket.destroyed || !value?.pipe || !value?.destroy || !value?.on) { value?.destroy?.(); drop(); return; }
      upstream = value; peers.add(upstream); upstream.once('error', drop);
      if (onDiagnostic) {
        let errorResponse = '';
        upstream.on('data', chunk => {
          const text = Buffer.from(chunk).toString('latin1'), status = /^HTTP\/1\.[01] ([0-9]{3})/.exec(text);
          if (status) { diagnostic(`response:${status[1]}:${route}`); if (status[1] === '400' || status[1] === '500') errorResponse = text.slice(0, 4096); }
          else if (errorResponse && errorResponse.length < 4096) errorResponse += text.slice(0, 4096 - errorResponse.length);
          if (errorResponse) {
            const start = errorResponse.indexOf('{'), end = errorResponse.lastIndexOf('}');
            if (start >= 0 && end > start) try {
              const message = JSON.parse(errorResponse.slice(start, end + 1)).message;
              if (typeof message === 'string') {
                const allowed = new Set('oci runtime runc containerd cgroup permission denied operation not permitted no such file or directory executable found invalid argument mount seccomp network failed to create start container user read write rootfs device error system process namespace cannot initialize logging driver task shim binary unknown plugin overlay sandbox unix socket image layer readonly read-only failed precondition capability capabilities unsupported default apparmor sysctl workdir working chdir change error response from daemon linux marked removal removed already running paused exec format architecture stopped started created filesystem dead state is being has was not found missing empty invalid disabled cannot does exist doesnotexist kill killed during init exit unexpected status code signal terminated eof connection closed shutdown deadline timeout required path restarting'.split(' '));
                const words = (message.toLowerCase().match(/[a-z-]+/g) || []).filter(word => allowed.has(word));
                const adjacent = /\bcontainer\s+was\s+removed\b/i.test(message);
                const idBetween = /\bcontainer\s+[a-f0-9]{12,64}\s+was\s+removed\b/i.test(message);
                const emptyBodyProtocol = /^starting container with non-empty request body was deprecated since API v1\.22 and removed in v1\.24$/i.test(message.trim());
                const pivotRootInvalid = /\berror jailing process inside rootfs:\s*pivot_root\b[^\n]*\binvalid argument\b/i.test(message);
                diagnostic(`daemon-error:${route}:${words.join(' ') || 'unclassified'}:adjacent=${adjacent}:id-between=${idBetween}:empty-body-protocol=${emptyBodyProtocol}:pivot-root-invalid=${pivotRootInvalid}`); errorResponse = '';
              }
            } catch { /* Wait for a complete bounded JSON response. */ }
          }
        });
      }
      // A clean upstream EOF may still have buffered bytes to flush to the
      // client. Abrupt close fails closed; a normal EOF drains through pipe.
      if (onDiagnostic) { upstream.once('end', () => diagnostic(`upstream-end:${route}`)); upstream.once('close', () => diagnostic(`upstream-close:${route}`)); }
      upstream.once('close', () => { peers.delete(upstream); if (!upstream.readableEnded) drop(); });
      socket.pipe(upstream); upstream.pipe(socket); socket.resume();
    }, drop);
  });
  // Bind under a private temporary name. Node removes its bind pathname on
  // close; publishing a hard link avoids deleting an unrelated replacement.
  const bindPath = join(dirname(path), `.tl-${randomUUID()}.sock`);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(bindPath, resolve); });
  try {
    chmodSync(bindPath, 0o600); linkSync(bindPath, path); unlinkSync(bindPath);
    const stat = lstatSync(path);
    if (!stat.isSocket()) throw new Error('DAEMON_PROXY_UNAVAILABLE');
    identity = { dev: stat.dev, ino: stat.ino, uid: stat.uid };
  } catch (error) { server.close(); stopPeers(); try { unlinkSync(bindPath); } catch {} throw error; }
  const check = () => {
    try { const stat = lstatSync(path); return !closed && server.listening && stat.isSocket() && stat.dev === identity.dev &&
      stat.ino === identity.ino && stat.uid === identity.uid && (stat.mode & 0o077) === 0; } catch { return false; }
  };
  const close = () => {
    if (closed) return; closed = true; clearInterval(timer); watcher?.close(); signal?.removeEventListener('abort', close); stopPeers(); server.close();
    try { const stat = lstatSync(path); if (stat.isSocket() && stat.dev === identity.dev && stat.ino === identity.ino) unlinkSync(path); } catch {}
  };
  try {
    watcher = watch(dirname(path), () => { if (!check()) close(); });
    watcher.on('error', close); server.on('error', close);
    timer = setInterval(() => { if (!check()) close(); }, 1000); timer.unref();
  } catch { close(); throw new Error('DAEMON_PROXY_UNAVAILABLE'); }
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted || !check()) { close(); throw new Error('DAEMON_PROXY_UNAVAILABLE'); }
  return Object.freeze({ endpoint: `unix://${path}`, check, close });
}
