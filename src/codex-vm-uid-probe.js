#!/usr/bin/env node
import { closeSync, constants, lstatSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Operates only on specially provisioned disposable probe files. It opens but
// never reads, writes, truncates or creates either file. A denied open is not
// evidence about inherited FDs, other paths, ACL changes or privileged writers.
export function probeVMUID({ directory, expectedUID, role }, { uid = () => process.geteuid(), stat = lstatSync, open = openSync, close = closeSync } = {}) {
  if (directory !== '/private/var/turnlink-vm-proof/private' || !Number.isSafeInteger(expectedUID) || expectedUID < 450 || expectedUID > 499 ||
      !['owner', 'outsider'].includes(role) || typeof uid !== 'function') throw new Error('VM_UID_PROBE_UNAVAILABLE');
  const effective = uid();
  if (!Number.isSafeInteger(effective) || (role === 'owner' ? effective !== expectedUID : effective === expectedUID || effective === 0)) throw new Error('VM_UID_PROBE_UNAVAILABLE');
  let parent;
  try { parent = stat(directory); } catch { throw new Error('VM_UID_PROBE_UNAVAILABLE'); }
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== expectedUID || (parent.mode & 0o777) !== 0o700) throw new Error('VM_UID_PROBE_UNAVAILABLE');
  const attempt = (name, flags) => {
    try { const fd = open(join(directory, name), flags | (constants.O_NOFOLLOW || 0)); close(fd); return 'allowed'; }
    catch (error) { return ['EACCES', 'EPERM'].includes(error.code) ? 'denied' : 'unknown'; }
  };
  const key = attempt('probe.key', constants.O_RDONLY), disk = attempt('probe.disk', constants.O_WRONLY);
  const expected = role === 'owner' ? 'allowed' : 'denied';
  return { role, effectiveUID: effective, expectedUID, keyOpen: key, diskWriteOpen: disk, matchesExpected: key === expected && disk === expected,
    note: 'Opening disposable probes only; inherited descriptors, other paths, ACL races and privileged writers are not tested.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--uid' || !/^[0-9]+$/.test(args[1]) || args[2] !== '--role') throw new Error();
    const result = probeVMUID({ directory: '/private/var/turnlink-vm-proof/private', expectedUID: Number(args[1]), role: args[3] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.matchesExpected) process.exitCode = 1;
  } catch { console.error('Turnlink: two-UID probe unavailable'); process.exitCode = 1; }
}
