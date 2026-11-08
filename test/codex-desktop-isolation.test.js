import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertIndependentCodexStores } from '../src/codex-desktop-isolation.js';

test('Desktop and standalone stores must resolve to distinct, non-nested directories', t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-store-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const desktop = join(root, 'desktop'), standalone = join(root, 'standalone'), alias = join(root, 'alias');
  mkdirSync(desktop); mkdirSync(standalone); mkdirSync(join(standalone, 'nested'));
  symlinkSync(standalone, alias, 'dir');
  assert.doesNotThrow(() => assertIndependentCodexStores(desktop, standalone));
  assert.throws(() => assertIndependentCodexStores(alias, standalone), /CODEX_STORES_NOT_INDEPENDENT/);
  assert.throws(() => assertIndependentCodexStores(join(standalone, 'nested'), standalone), /CODEX_STORES_NOT_INDEPENDENT/);
  assert.throws(() => assertIndependentCodexStores(standalone, join(standalone, 'nested')), /CODEX_STORES_NOT_INDEPENDENT/);
  assert.throws(() => assertIndependentCodexStores(join(root, 'missing'), standalone));
});
