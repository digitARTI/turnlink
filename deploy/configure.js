// Merge only our settings, preserving existing JSONC and TOML text.
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { parse, modify, applyEdits } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { applyConfiguration } from './config-transaction.js';
import { atomicWrite, privateDirectory } from '../src/storage.js';

if (process.platform !== 'win32') throw new Error('This installer is Windows-only; use explicit platform setup for other hosts');

const root = process.argv[2] || 'C:\\ProgramData\\agent-channel';
const profile = process.argv[3] || process.env.USERPROFILE;
if (!profile) throw new Error('An explicit user profile is required');
if (!isAbsolute(root) || !isAbsolute(profile)) throw new Error('Root and profile must be absolute paths');
const appData = join(profile, 'AppData', 'Roaming');
const settingsPath = join(appData, 'Code', 'User', 'settings.json');
const codexConfigPath = join(profile, '.codex', 'config.toml');
const launcherPath = join(root, 'bin', 'agent-channel-codex.exe');
const launcherConfigPath = join(root, 'bin', 'launcher.json');
const privateRoot = join(root, 'private'); privateDirectory(privateRoot);
const statusPath = join(privateRoot, 'config-journal.json');
if (existsSync(statusPath)) throw new Error('Deployment already configured; inspect recorded backups before reconfiguring.');
const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '{}\n';
const errors = [];
const settings = parse(settingsText, errors, { allowTrailingComma: true });
if (errors.length || !settings || typeof settings !== 'object') throw new Error('VS Code settings are not valid JSONC');
if (settings['chatgpt.runCodexInWindowsSubsystemForLinux']) throw new Error('WSL mode enabled; native adapter cannot be installed');
if (settings['chatgpt.cliExecutable']) throw new Error('Existing cliExecutable override present; coordinate before replacing it');
const extensions = join(profile, '.vscode', 'extensions');
const candidates = readdirSync(extensions).filter(name => /^openai\.chatgpt-[0-9.]+-win32-x64$/.test(name))
  .sort(new Intl.Collator('en', { numeric: true }).compare).reverse()
  .map(name => join(extensions, name, 'bin', 'windows-x86_64', 'codex.exe'));
const explicitIndex = process.argv.indexOf('--codex');
const codex = explicitIndex >= 0 ? process.argv[explicitIndex + 1] : candidates.find(existsSync);
if (!codex || !isAbsolute(codex) || !existsSync(codex) || !statSync(codex).isFile()) throw new Error('An absolute official extension binary is required');
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
atomicWrite(launcherConfigPath, JSON.stringify({ node, root, codex, url: 'ws://127.0.0.1:47322', tokenFile: join(root, 'private', 'token') }, null, 2));
if (process.argv.includes('--prepare')) {
  console.log('Launcher configuration prepared; VS Code and Codex settings untouched.');
  process.exit(0);
}
for (const path of [settingsPath, codexConfigPath]) {
  mkdirSync(dirname(path), { recursive: true });
}
applyConfiguration(statusPath, [{ path: settingsPath, content: mergedSettings }, { path: codexConfigPath, content: codexText + addition }]);
console.log(JSON.stringify({ configured: true, launcherPath, userProfile: profile, settingsPath, codexConfigPath, codex }));
