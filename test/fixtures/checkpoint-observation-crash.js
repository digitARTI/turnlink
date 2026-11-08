import { readFileSync } from 'node:fs';
import { ControlStore } from '../../src/control/store.js';

const [directory, point] = process.argv.slice(2);
const record = JSON.parse(readFileSync(0, 'utf8'));
const store = new ControlStore(directory, { beforeCommit() { if (point === 'before') process.kill(process.pid, 'SIGKILL'); } });
store.recordCheckpointObservation(record, () => {});
if (point === 'after') process.kill(process.pid, 'SIGKILL');
store.close();
