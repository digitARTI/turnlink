import { rollbackConfiguration } from './config-transaction.js';
const journal = process.argv[2];
if (!journal) throw new Error('Usage: rollback.js <absolute-private-config-journal.json>');
const result = rollbackConfiguration(journal);
console.log(JSON.stringify(result));
if (!result.restored) process.exitCode = 1;
