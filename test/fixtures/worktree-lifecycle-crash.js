import { WorktreeLifecycle } from '../../src/worktree-lifecycle.js';
import { writeSync } from 'node:fs';

// Isolated real-process crash fixture. Arguments contain only test-local paths
// and IDs; production approvals/credentials never enter this process.
const [repository, directory, worktreeRoot, taskID, operation, previewID] = process.argv.slice(2);
const lifecycle = new WorktreeLifecycle({ repository, directory, worktreeRoot, agentId: 'opencode:a', enabled: true, now: () => 1000,
  port: { exclusive: async fn => fn(), claim: async id => id === taskID ? { claimant: 'opencode:a', claimGeneration: 1, status: 'claimed' } : undefined,
    authorize: async () => true }, afterEffect: () => { writeSync(2, 'FIXTURE_AFTER_EFFECT\n'); process.kill(process.pid, 'SIGKILL'); } });
if (operation === 'create') await lifecycle.create(previewID);
else if (operation === 'remove') await lifecycle.remove(previewID);
else process.exit(72);
