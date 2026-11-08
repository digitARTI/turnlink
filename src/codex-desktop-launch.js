import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { assertIndependentCodexStores } from './codex-desktop-isolation.js';

// Builds an application-level launch, not a movement capability or a census
// of Desktop instances launched by other paths.
export function isolatedDesktopLaunch({ home, env, application = '/Applications/Codex.app', args = [] }) {
  if (!isAbsolute(home) || !isAbsolute(application) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string'))
    throw new Error('INVALID_DESKTOP_LAUNCH');
  const root = join(home, 'Library', 'Application Support', 'Turnlink');
  const codexHome = join(root, 'CodexDesktopHome'), profile = join(root, 'CodexDesktopProfile');
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  for (const standalone of new Set([join(home, '.codex'), env.CODEX_HOME, env.CODEX_SQLITE_HOME].filter(Boolean)))
    assertIndependentCodexStores(codexHome, standalone);
  assertIndependentCodexStores(profile, codexHome);
  for (const standalone of new Set([join(home, '.codex'), env.CODEX_HOME, env.CODEX_SQLITE_HOME].filter(Boolean)))
    assertIndependentCodexStores(profile, standalone);
  const openArgs = ['-n', '-W', '--env', `CODEX_HOME=${codexHome}`, '--env', `CODEX_SQLITE_HOME=${codexHome}`,
    '--env', `CODEX_ELECTRON_USER_DATA_PATH=${profile}`, '-a', application];
  // Chromium initializes its profile lock before Electron main-process JS can
  // apply CODEX_ELECTRON_USER_DATA_PATH. Bind that early path as well.
  if (args.some(arg => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))) throw new Error('INVALID_DESKTOP_LAUNCH');
  openArgs.push('--args', `--user-data-dir=${profile}`, ...args);
  return { executable: '/usr/bin/open', args: openArgs, codexHome, profile };
}
