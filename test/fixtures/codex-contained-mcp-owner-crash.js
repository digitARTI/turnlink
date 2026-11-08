import { readFileSync } from 'node:fs';
import { CodexContainedMcp } from '../../src/codex-contained-mcp.js';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const owner = new CodexContainedMcp(config);
const created = await owner.create();
const started = await owner.start();
let output = '';
started.child.stdout.on('data', chunk => {
  output += chunk.toString();
  if (output.includes('READY\n')) {
    process.stdout.write(`${JSON.stringify({ containerID: created.containerID, attachPid: started.child.pid })}\n`);
    started.child.stdout.removeAllListeners('data');
  }
});
started.child.stderr.resume();
await new Promise(() => {});
