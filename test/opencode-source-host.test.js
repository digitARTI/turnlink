import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateTemp } from '../src/storage.js';
import { startOpenCodeSourceHost } from '../src/opencode-source-host.js';

test('source host requires explicit valid config and refuses an occupied endpoint before startup', async t => {
  await assert.rejects(startOpenCodeSourceHost({}));
  const root = privateTemp('/private/tmp/tlsh-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const endpointFile = join(root, 'endpoint.json'); writeFileSync(endpointFile, 'existing', { mode: 0o600 });
  await assert.rejects(startOpenCodeSourceHost({ version: 1, runtime: '/missing-runtime', entrypoint: '/missing-entrypoint',
    database: join(root, 'native.sqlite'), sessionID: 'ses_test', source: { directory: root }, environment: {}, endpointFile }),
  /OPENCODE_COMPLETION_OWNER_UNAVAILABLE/);
});
