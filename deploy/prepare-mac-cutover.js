import { readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyConfiguration } from './config-transaction.js';
import { configureOpenCode } from './opencode-config.js';
const destination = process.argv[2];
if (process.platform !== 'darwin' || !destination || destination.startsWith('--')) throw new Error('Use on macOS with explicit Turnlink hardening state directory');
const state = resolve(destination);
const option = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
};
const path = option('--config') || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', 'opencode.jsonc');
const text = readFileSync(path, 'utf8');
const plugin = pathToFileURL(option('--plugin') || fileURLToPath(new URL('../adapters/opencode', import.meta.url))).href;
const options = { url: 'ws://127.0.0.1:47323', tokenFile: join(state, 'workstation.token'), credentialDirectory: join(state, 'session-keys') };
const updated = configureOpenCode(text, plugin, options);
if (process.argv.includes('--plan-only')) { console.log(JSON.stringify({ planned: true, path, endpoint: options.url })); process.exit(0); }
// This operator-authorized config now references private credential paths.
chmodSync(path, 0o600);
console.log(JSON.stringify(applyConfiguration(join(state, 'opencode-cutover-journal.json'), [{ path, content: updated }])));
