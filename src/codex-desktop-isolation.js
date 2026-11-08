import { realpathSync, statSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';

const within = (parent, candidate) => {
  const suffix = relative(parent, candidate);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
};

// A point-in-time path check, not an exclusion lock or proof about all Desktop
// processes. Both stores must already exist and resolve to distinct trees.
export function assertIndependentCodexStores(desktopHome, standaloneHome) {
  const desktop = realpathSync(desktopHome), standalone = realpathSync(standaloneHome);
  const desktopStat = statSync(desktop), standaloneStat = statSync(standalone);
  if (!desktopStat.isDirectory() || !standaloneStat.isDirectory() || within(desktop, standalone) || within(standalone, desktop) ||
      (desktopStat.dev === standaloneStat.dev && desktopStat.ino === standaloneStat.ino)) throw new Error('CODEX_STORES_NOT_INDEPENDENT');
}
