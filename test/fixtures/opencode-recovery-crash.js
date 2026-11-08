import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenCodeAuthorizedRecovery } from '../../src/opencode-authorized-recovery.js';
import { OpenCodeRecoveryJournal } from '../../src/opencode-recovery-journal.js';

const root = process.argv[2];
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const grant = { id: uuid(1), channel: 'dev', taskID: uuid(2), agentId: 'opencode:ses_test', previewID: uuid(3),
  claimGeneration: 1, from: '/project', to: '/project-worktree', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64),
  status: 'prepared', preparedAt: 1000 };
const client = new EventEmitter(); client.hostId = 'local';
client.request = async (_method, params) => ({ checkedAt: 1001, grant: params.grant });
const recovery = {
  inspect: async () => ({ sessionID: 'ses_test', pluginID: 'turnlink', transitionID: grant.id,
    source: { directory: grant.from }, directory: grant.to }),
  claimRecovery: async () => { writeFileSync(join(root, 'dispatched'), 'yes', { mode: 0o600 }); process.exit(73); },
  inspectRecovery: async () => ({}), observeRecoveryRecord: async () => ({}), close: () => {},
};
const journal = new OpenCodeRecoveryJournal('local', grant.agentId, root);
const control = new OpenCodeAuthorizedRecovery({ client, credential: async () => 'fixture', recovery, journal, sessionID: 'ses_test', channel: 'dev' });
await control.claim(grant);
throw new Error('Expected abrupt exit');
