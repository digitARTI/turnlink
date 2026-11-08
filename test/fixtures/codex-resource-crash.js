import { readFileSync } from 'node:fs';
import { CodexResourceJournal } from '../../src/codex-resource-journal.js';

const { root, agentId, record, grant, receipt, settlement, cleanup, quiescence, step, mcpTransitionID, existingCleanupTransitionID } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const journal = new CodexResourceJournal('local', agentId, root);
await journal.exclusive(async () => {
  if (existingCleanupTransitionID) {
    const provider = journal.entries().find(value => value.transitionID === existingCleanupTransitionID);
    journal.put({ ...provider, cleanup });
    process.kill(process.pid, 'SIGKILL');
  }
  if (step) {
    const mcp = journal.entries().find(value => value.transitionID === mcpTransitionID);
    journal.put({ ...mcp, step });
    process.kill(process.pid, 'SIGKILL');
  }
  journal.put(record);
  journal.put({ ...record, phase: 'previewed' });
  journal.put({ ...record, phase: 'authorizing' });
  journal.put({ ...record, phase: 'prepared', grant });
  journal.put({ ...record, phase: 'dispatching', grant });
  if (cleanup || quiescence) {
    journal.put({ ...record, phase: 'observed', grant, receipt, settlement });
    journal.put({ ...record, phase: 'settled', grant, receipt, settlement });
    journal.put({ ...record, phase: 'settled', grant, receipt, settlement, ...(cleanup ? { cleanup } : { quiescence }) });
  }
  process.kill(process.pid, 'SIGKILL');
});
