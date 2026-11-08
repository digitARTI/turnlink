import { constants, openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory } from './storage.js';
import { ExportDescriptor } from './control/storage-contracts.js';
import { requireControl as check } from './control/policy.js';

// Human/operator client only. A failed new download remains explicitly partial;
// never overwrite an existing file or claim successful integrity verification.
export async function downloadControlExport({ client, id, file, maxBytes = 256 * 1024 * 1024, paceMs = 60 }) {
  check(isAbsolute(file) && Number.isSafeInteger(maxBytes) && maxBytes > 0 && Number.isInteger(paceMs) && paceMs >= 0 && paceMs <= 1000, 'CONTROL_EXPORT_INVALID');
  privateDirectory(dirname(file));
  const descriptor = ExportDescriptor.parse(await client.request('control_export', { id }));
  check(descriptor.id === id && descriptor.bytes <= maxBytes, 'CONTROL_EXPORT_INVALID');
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  let offset = 0;
  const hash = createHash('sha256');
  try {
    while (offset < descriptor.bytes) {
      const page = await client.request('control_export_read', { id, offset, limit: 24576 });
      check(page?.id === id && page.offset === offset && page.totalBytes === descriptor.bytes && page.digest === descriptor.digest &&
        typeof page.data === 'string' && page.data.length <= 32768, 'CONTROL_EXPORT_CHANGED');
      const data = Buffer.from(page.data, 'base64');
      check(data.length > 0 && data.length <= 24576 && data.toString('base64') === page.data &&
        page.next === offset + data.length && page.next <= descriptor.bytes, 'CONTROL_EXPORT_INVALID');
      writeFileSync(fd, data); hash.update(data); offset = page.next;
      if (offset < descriptor.bytes && paceMs) await delay(paceMs); // Stay below the broker's ordinary request budget.
    }
    check(hash.digest('hex') === descriptor.digest, 'CONTROL_EXPORT_CHANGED');
    fsyncSync(fd);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(file), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    return { ...descriptor, file, verified: true };
  } catch (error) { error.partialFile = file; throw error; }
  finally { closeSync(fd); }
}
