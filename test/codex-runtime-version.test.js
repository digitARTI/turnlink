import test from 'node:test';
import assert from 'node:assert/strict';
import { codexInitializeVersion } from '../src/codex-runtime-version.js';

test('Codex version observation binds the initialize response to its client name', () => {
  const params = { clientInfo: { name: 'synthetic/client', version: '987.654.321' } };
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/0.165.0 (fixture)' }), '0.165.0');
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/0.165.0' }), '0.165.0');
  assert.equal(codexInitializeVersion(params, { userAgent: 'other/0.165.0 (fixture)' }), undefined);
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/0.165.0-alpha.2 (fixture)' }), undefined);
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/0.165.0+build (fixture)' }), undefined);
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/0.165.0extra' }), undefined);
  assert.equal(codexInitializeVersion(params, { userAgent: 'synthetic/client/' + '1'.repeat(33) + '.0.0' }), undefined);
  assert.equal(codexInitializeVersion({ clientInfo: { name: '' } }, { userAgent: '/0.165.0' }), undefined);
  assert.equal(codexInitializeVersion({ clientInfo: { name: 'x'.repeat(257) } }, { userAgent: 'x'.repeat(257) + '/0.165.0' }), undefined);
  assert.equal(codexInitializeVersion(undefined, undefined), undefined);
});
