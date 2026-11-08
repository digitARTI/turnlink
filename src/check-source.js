import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const directory of ['src', 'adapters', 'deploy', 'test']) scan(join(root, directory));
for (const [directory, expected] of [['codex', ['native-continuity.patch', 'instruction-preview.patch']], ['opencode', ['execution-reservation.patch']]]) {
  const base = join(root, 'native', directory);
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
  const records = directory === 'codex' ? [manifest, manifest.instructionPreview] : [manifest];
  for (const [index, record] of records.entries()) {
    if (record?.patch !== expected[index]) throw new Error(`Unexpected ${directory} patch in manifest`);
    const bytes = readFileSync(join(base, record.patch));
    if (record.bytes !== bytes.length || record.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`${directory} patch integrity mismatch: ${record.patch}`);
  }
}
console.log('JavaScript syntax checks passed.');
console.log('Native patch manifest integrity checks passed.');
