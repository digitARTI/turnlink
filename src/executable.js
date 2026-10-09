import { realpathSync, statSync, accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
export function resolveExecutable(command) {
  const candidates = isAbsolute(command) || /[\\/]/.test(command) ? [resolve(command)] :
    (process.env.PATH || '').split(delimiter).flatMap(directory => {
      const suffixes = process.platform === 'win32' && !/\.[a-z]+$/i.test(command) ? ['', '.exe'] : [''];
      return suffixes.map(suffix => join(directory, `${command}${suffix}`));
    });
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch { /* try another PATH entry */ }
  }
  throw new Error('Configured executable is unavailable');
}
