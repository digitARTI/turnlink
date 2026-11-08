import { createOpenCodeDestinationStorageJournal } from '../../src/opencode-destination-storage-journal.js';

const journal = createOpenCodeDestinationStorageJournal({ directory: process.argv[2], sessionID: 'ses_storage' });
await journal.run('set', { synthetic: true }, async () => { process.kill(process.pid, 'SIGKILL'); });
