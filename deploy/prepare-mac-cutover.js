import { readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, modify, applyEdits } from 'jsonc-parser';
import { applyConfiguration } from './config-transaction.js';
const state = process.argv[2];
if (process.platform !== 'darwin' || !state) throw new Error('Use on macOS with explicit v2 state directory');
const path = join(homedir(), '.config', 'opencode', 'opencode.jsonc');
const text = readFileSync(path, 'utf8'), errors = [];
const config = parse(text, errors, { allowTrailingComma: true });
const plugin = 'file:///Users/sandrovita/Progetti/agent-channel/adapters/opencode.js';
const index = config.plugin?.findIndex(value => value === plugin);
if (errors.length || index === undefined || index < 0) throw new Error('Expected known v0.1 plugin entry; refuse unrelated config');
const entry = [plugin, { url: 'ws://127.0.0.1:47323', tokenFile: join(state, 'workstation.token'), credentialDirectory: join(state, 'session-keys') }];
const updated = applyEdits(text, modify(text, ['plugin', index], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
if (process.argv.includes('--plan-only')) { console.log(JSON.stringify({ planned: true, path, endpoint: entry[1].url })); process.exit(0); }
// This operator-authorized config now references private credential paths.
chmodSync(path, 0o600);
console.log(JSON.stringify(applyConfiguration(join(state, 'opencode-cutover-journal.json'), [{ path, content: updated }])));
