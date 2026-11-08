// Pure preparation manifest. This module deliberately has no process launcher,
// filesystem writer, extension installer, credential reader or model client.
import { posix, win32 } from 'node:path';

export function planIDEAcceptance(input, inherited = {}) {
  const fields = ['platform', 'root', 'editor', 'extension', 'native', 'proxy'];
  if (!input || Object.keys(input).some(key => !fields.includes(key)) ||
      !['darwin', 'win32'].includes(input.platform)) throw new Error('Unsupported IDE acceptance input');
  const path = input.platform === 'win32' ? win32 : posix;
  const paths = Object.fromEntries(fields.filter(key => key !== 'platform').map(key => {
    const value = input[key];
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value))
      throw new Error(`IDE ${key} must be an absolute literal path`);
    return [key, path.normalize(value)];
  }));
  const normalized = value => input.platform === 'win32' ? value.toLowerCase() : value;
  const contains = (parent, child) => {
    const relative = path.relative(normalized(parent), normalized(child));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (paths.root === path.parse(paths.root).root) throw new Error('IDE root must be a disposable child directory');
  for (const key of ['editor', 'extension', 'native', 'proxy'])
    if (contains(paths.root, paths[key]) || contains(paths[key], paths.root))
      throw new Error('IDE state root must not overlap source artifacts');
  if (input.platform === 'win32' && ![paths.editor, paths.native, paths.proxy].every(value => /\.exe$/i.test(value)))
    throw new Error('Windows IDE requires native editor, Codex and proxy exe artifacts');
  const at = (...parts) => path.join(paths.root, ...parts);
  const environment = {};
  // Construct a replacement environment; never spread process.env. In
  // particular, VSCode IPC, Portable mode, shell injection and provider keys
  // must not enter a future isolated process through inherited variables.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL'])
    if (typeof inherited[key] === 'string') environment[key] = inherited[key];
  Object.assign(environment, {
    HOME: at('home'), USERPROFILE: at('home'), CODEX_HOME: at('codex'), CODEX_SQLITE_HOME: at('sqlite'),
    XDG_CONFIG_HOME: at('home', 'config'), XDG_DATA_HOME: at('home', 'data'),
    XDG_CACHE_HOME: at('home', 'cache'), XDG_STATE_HOME: at('home', 'state'),
    APPDATA: at('home', 'AppData', 'Roaming'), LOCALAPPDATA: at('home', 'AppData', 'Local'),
    TMPDIR: at('temp'), TMP: at('temp'), TEMP: at('temp'),
    AGENT_CHANNEL_CODEX_EXECUTABLE: paths.native,
  });
  return {
    kind: 'vscode-codex-existing-cwd', launchAuthorized: false, networkIsolation: false, movementEnabled: false,
    executable: paths.editor, shell: false,
    argv: ['--new-window', '--user-data-dir', at('editor'), '--extensions-dir', at('extensions'),
      '--sync', 'off', '--skip-add-to-recently-opened', at('project')],
    environment, extensionSource: paths.extension,
    settings: { 'chatgpt.cliExecutable': paths.proxy, 'chatgpt.runCodexInWindowsSubsystemForLinux': false,
      'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
      'update.mode': 'none', 'security.workspace.trust.enabled': true },
    prerequisites: [
      'Create a fresh private root exclusively, reject existing paths/symlinks, validate POSIX modes or Windows ACLs, and create all private state directories before launch.',
      'Copy only the reviewed extension package into private extensions; never copy auth.json, editor profiles, user settings, histories, skills or account state.',
      'Verify editor is not Portable Mode; verify extension identity/version and native runtime plus code-mode companion match; stage a Windows native proxy and companion outside the disposable state root.',
      'Write fixture-only instructions and local-provider configuration, with an explicit loopback Responses endpoint and synthetic fixture key; never fall back to a remote provider.',
      'Start a separately reviewed isolated broker and bounded local model fixture only after launch authorization; supply only its private token-file paths and loopback URL.',
      'Prove native extension permits the fixture provider without account sign-in; stop at authentication, provider or permission refusal rather than use a real account or broaden approvals.',
      'Obtain explicit authorization before launching GUI; record only fixture evidence and close only owned processes before removing the exact disposable root.',
    ],
    evidence: ['baseline', 'role', 'task', 'alert', 'approvals', 'reconnect'],
  };
}
