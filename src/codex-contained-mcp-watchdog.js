import { setTimeout as delay } from 'node:timers/promises';
import { CodexContainedMcp } from './codex-contained-mcp.js';
import { cleanupContainedMcpPeer } from './codex-contained-mcp-peer.js';

// The pipe is held only by the wrapper. EOF without DONE means it disappeared
// before reporting a clean stop. The journal remains the authority for the
// exact Docker object; this process never retries create or start.
let input = '', owner, peer, clean = false, finished = false;
process.stdout.on('error', () => {});
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 65536) { process.stdin.destroy(); return; }
  for (;;) {
    const end = input.indexOf('\n'); if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (!owner) {
      try { const config = JSON.parse(line); owner = new CodexContainedMcp(config); peer = config.peer; process.stdout.write('READY\n'); }
      catch { process.exitCode = 1; process.stdin.destroy(); return; }
    } else if (line === 'DONE') clean = true;
    else { process.exitCode = 1; process.stdin.destroy(); return; }
  }
});
async function recover() {
  if (finished) return; finished = true;
  if (!owner || clean) return;
  // A killed writer can leave a cooperative lock until its stale interval.
  // Bounded attempts leave unresolved records intact for later recovery.
  const deadline = Date.now() + 75000;
  try {
    do {
      try {
        const observed = await owner.observe();
        if (observed.phase === 'stopped' || observed.phase === 'removed') return;
        if (observed.phase === 'created') { await owner.remove(); return; }
        if (['starting', 'started', 'stopping'].includes(observed.phase)) { await owner.stop(); return; }
      } catch (error) { if (error.code === 'ENOENT') return; }
      await delay(500);
    } while (Date.now() < deadline);
    process.exitCode = 1;
  } finally { if (peer) cleanupContainedMcpPeer(peer); }
}
process.stdin.on('end', recover);
process.stdin.on('close', recover);
process.stdin.on('error', recover);
