// Merge only our settings, preserving existing JSONC and TOML text.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse, modify, applyEdits } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';

const root = process.argv[2] || 'C:\\ProgramData\\agent-channel';
const profile = process.argv[3] || 'C:\\Users\\Administrator';
const appData = join(profile, 'AppData', 'Roaming');
const settingsPath = join(appData, 'Code', 'User', 'settings.json');
const codexConfigPath = join(profile, '.codex', 'config.toml');
const launcherPath = join(root, 'bin', 'agent-channel-codex.exe');
const launcherConfigPath = join(root, 'bin', 'launcher.json');
const statusPath = join(root, 'deployment-status.json');
if (existsSync(statusPath)) throw new Error('Deployment already configured; inspect recorded backups before reconfiguring.');
const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '{}\n';
const errors = [];
const settings = parse(settingsText, errors, { allowTrailingComma: true });
if (errors.length || !settings || typeof settings !== 'object') throw new Error('VS Code settings are not valid JSONC');
if (settings['chatgpt.runCodexInWindowsSubsystemForLinux']) throw new Error('WSL mode enabled; native adapter cannot be installed');
if (settings['chatgpt.cliExecutable']) throw new Error('Existing cliExecutable override present; coordinate before replacing it');
const extensions = join(profile, '.vscode', 'extensions');
const candidates = ['26.1002.51308', '26.930.61225'].map(v => join(extensions, `openai.chatgpt-${v}-win32-x64`, 'bin', 'windows-x86_64', 'codex.exe'));
const codex = candidates.find(existsSync);
if (!codex) throw new Error('Expected official extension binary not found');
const node = 'C:\\Program Files\\nodejs\\node.exe';
if (!existsSync(node) || !existsSync(launcherPath)) throw new Error('Node or launcher missing');
const codexText = existsSync(codexConfigPath) ? readFileSync(codexConfigPath, 'utf8') : '';
const parsed = parseToml(codexText);
if (parsed.mcp_servers?.agent_channel) throw new Error('agent_channel MCP config already exists');
const q = value => JSON.stringify(value); // TOML basic strings use JSON-compatible backslash escapes here.
const addition = `\n# agent-channel remote adapter\n[mcp_servers.agent_channel]\ncommand = ${q(launcherPath)}\nargs = ["--channel-mcp"]\n\n[[hooks.SessionStart]]\nmatcher = "startup|resume|compact"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = ${q(`\"${launcherPath}\" --channel-session-hook`)}\n`;
parseToml(codexText + addition);
const mergedSettings = applyEdits(settingsText, modify(settingsText, ['chatgpt.cliExecutable'], launcherPath, {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\r\n' },
}));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(launcherConfigPath, JSON.stringify({ node, root, codex, url: 'ws://127.0.0.1:47322', tokenFile: join(root, 'private', 'token') }, null, 2));
if (process.argv.includes('--prepare')) {
  console.log('Launcher configuration prepared; VS Code and Codex settings untouched.');
  process.exit(0);
}
const backups = [];
for (const [path, old, updated] of [[settingsPath, settingsText, mergedSettings], [codexConfigPath, codexText, codexText + addition]]) {
  mkdirSync(dirname(path), { recursive: true });
  const backup = `${path}.agent-channel-${stamp}.bak`;
  writeFileSync(backup, old, { flag: 'wx' });
  backups.push({ path, backup, existed: existsSync(path) });
}
// Record backups before editing either user file so rollback is possible on failure.
writeFileSync(statusPath, JSON.stringify({ root, profile, launcherPath, backups, installedAt: new Date().toISOString() }, null, 2));
for (const [path, updated] of [[settingsPath, mergedSettings], [codexConfigPath, codexText + addition]]) {
  writeFileSync(`${path}.agent-channel.tmp`, updated);
  renameSync(`${path}.agent-channel.tmp`, path);
}
console.log(JSON.stringify({ configured: true, launcherPath, userProfile: profile, settingsPath, codexConfigPath, codex }));
