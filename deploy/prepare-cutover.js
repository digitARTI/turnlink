// Update only a known v0.1 adapter configuration. --plan-only is read-only.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as jsonc, modify, applyEdits } from 'jsonc-parser';
import { parse as toml } from 'smol-toml';
import { applyConfiguration } from './config-transaction.js';
import { atomicWrite } from '../src/storage.js';

const [root, profile] = process.argv.slice(2);
if (process.platform !== 'win32' || !root || !profile) throw new Error('Use on Windows with explicit staged root and actual profile');
const settingsPath = join(profile, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
const configPath = join(profile, '.codex', 'config.toml');
const oldLauncher = 'C:\\ProgramData\\agent-channel\\bin\\agent-channel-codex.exe';
const launcher = join(root, 'bin', 'agent-channel-codex.exe');
const settingsText = readFileSync(settingsPath, 'utf8'), configText = readFileSync(configPath, 'utf8');
const errors = [], settings = jsonc(settingsText, errors, { allowTrailingComma: true });
const config = toml(configText);
if (errors.length || settings['chatgpt.cliExecutable'] !== oldLauncher || config.mcp_servers?.agent_channel?.command !== oldLauncher) {
  throw new Error('Expected known v0.1 override/MCP entries; refuse to overwrite unrelated configuration');
}
const section = /(^\[mcp_servers\.agent_channel\][\s\S]*?)(?=^\[|$(?![\s\S]))/m;
const match = configText.match(section);
if (!match || (match[0].match(/^command\s*=/gm) || []).length !== 1 || (match[0].match(/^args\s*=/gm) || []).length !== 1) throw new Error('MCP section is ambiguous');
const updatedSection = match[0].replace(/^command\s*=.*$/m, `command = ${JSON.stringify(launcher)}`)
  .replace(/^args\s*=.*$/m, 'args = ["--channel-mcp", "--codex-stdio"]');
let updatedConfig = configText.replace(section, updatedSection);
const oldHook = JSON.stringify(`"${oldLauncher}" --channel-session-hook`);
updatedConfig = updatedConfig.split(oldHook).join(JSON.stringify(`"${launcher}" --channel-session-hook --codex-stdio`));
toml(updatedConfig);
const updatedSettings = applyEdits(settingsText, modify(settingsText, ['chatgpt.cliExecutable'], launcher,
  { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\r\n' } }));
if (process.argv.includes('--plan-only')) {
  console.log(JSON.stringify({ planned: true, settingsPath, configPath, launcher, endpoint: 'ws://127.0.0.1:47324', binding: 'Codex outer stdio metadata' }));
  process.exit(0);
}
if (!existsSync(launcher) || !existsSync(join(root, 'private', 'gameserver.token'))) throw new Error('Staged executable/host credential missing');
const previousLauncherConfig = JSON.parse(readFileSync('C:\\ProgramData\\agent-channel\\bin\\launcher.json', 'utf8'));
atomicWrite(join(root, 'bin', 'launcher.json'), JSON.stringify({ ...previousLauncherConfig, root,
  url: 'ws://127.0.0.1:47324', tokenFile: join(root, 'private', 'gameserver.token') }, null, 2));
console.log(JSON.stringify(applyConfiguration(join(root, 'private', 'v2-cutover-journal.json'), [
  { path: settingsPath, content: updatedSettings }, { path: configPath, content: updatedConfig },
])));
