import { readFileSync } from 'node:fs';
import { ControlStore } from '../../src/control/store.js';

const [directory, point] = process.argv.slice(2);
const { intent, receipt } = JSON.parse(readFileSync(0, 'utf8'));
const store = new ControlStore(directory, { beforeCommit() { if (point.startsWith('before')) process.kill(process.pid, 'SIGKILL'); } });
if (point.endsWith('intent')) store.beginCheckpointDestination(intent, () => {});
else store.finishCheckpointDestination(intent.requestID, receipt, 4, () => {});
process.kill(process.pid, 'SIGKILL');
