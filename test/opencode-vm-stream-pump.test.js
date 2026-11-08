import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('VM fixture stream pump preserves reverse output after half-close and unblocks on revocation',
  { skip: process.platform !== 'darwin' }, t => {
    const directory = mkdtempSync(join(tmpdir(), 'turnlink-pump-')), binary = join(directory, 'pump');
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    execFileSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pthread',
      resolve('test/fixtures/codex-vm-xpc/stream-pump-test.c'), '-o', binary], { timeout: 30000 });
    assert.doesNotThrow(() => execFileSync(binary, [], { timeout: 5000 }));
  });
