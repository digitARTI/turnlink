import { accessSync, constants, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, normalize } from 'node:path';

const unavailable = () => new Error('CODEX_STORE_CANDIDATE_UNAVAILABLE');

// Point-in-time metadata screening only. The supplied desktop UID is a
// configuration assertion, not evidence of any process identity. This does
// not authorize movement, exclude already-open descriptors or same-UID writers,
// or keep paths/permissions stable after the check. sqliteHome is the supplied
// environment path, not the effective native SQLite path: config.toml and
// managed requirements may override CODEX_SQLITE_HOME, and log_dir can also
// place SQLite logs elsewhere. No native configuration has been resolved here.
export function checkCodexStoreCandidate({ codexHome, sqliteHome, desktopUid }) {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function' || typeof process.geteuid !== 'function') throw unavailable();
  const uid = process.getuid();
  if (!Number.isSafeInteger(uid) || uid <= 0 || process.geteuid() !== uid || !Number.isSafeInteger(desktopUid) || desktopUid <= 0 || desktopUid === uid) throw unavailable();
  for (const path of new Set([codexHome, sqliteHome])) {
    if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || /[\0\r\n]/.test(path)) throw unavailable();
    let current = path, leaf = true;
    for (;;) {
      let before, after, output;
      try {
        before = lstatSync(current);
        if (!before.isDirectory() || (leaf ? before.uid !== uid || (before.mode & 0o077) !== 0 :
          ![0, uid].includes(before.uid) || ((before.mode & 0o022) !== 0 && (before.mode & 0o1000) === 0))) throw unavailable();
        accessSync(current, leaf ? constants.R_OK | constants.W_OK | constants.X_OK : constants.X_OK);
        output = spawnSync('/bin/ls', ['-lde', '--', current], { encoding: 'utf8', timeout: 3000, maxBuffer: 8192, env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' } });
        after = lstatSync(current);
      } catch { throw unavailable(); }
      // BSD ls -e displays ACL entries on separate lines. Reject errors,
      // extended ACLs and any ambiguous output, even if mode bits look private.
      const lines = typeof output.stdout === 'string' ? output.stdout.trimEnd().split('\n') : [];
      if (output.status !== 0 || output.error || output.stderr || lines.length !== 1 ||
          !/^d[rwxstST-]{9}[@]?\s/.test(lines[0]) || before.dev !== after.dev || before.ino !== after.ino ||
          before.uid !== after.uid || before.mode !== after.mode) throw unavailable();
      const parent = dirname(current);
      if (parent === current) break;
      current = parent; leaf = false;
    }
  }
}
