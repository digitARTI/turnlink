import test from 'node:test';
import assert from 'node:assert/strict';
import { probeVMUID } from '../src/codex-vm-uid-probe.js';

const directory = '/private/var/turnlink-vm-proof/private', expectedUID = 480;
const parent = { uid: 480, mode: 0o40700, isDirectory: () => true, isSymbolicLink: () => false };
test('owner and outsider probes report only actual open results', () => {
  let closes = 0;
  const owner = probeVMUID({ directory, expectedUID, role: 'owner' }, { uid: () => 480, stat: () => parent, open: () => 7, close: () => closes++ });
  assert.equal(owner.matchesExpected, true); assert.equal(closes, 2);
  const denied = () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; };
  const outsider = probeVMUID({ directory, expectedUID, role: 'outsider' }, { uid: () => 501, stat: () => parent, open: denied, close: () => {} });
  assert.equal(outsider.matchesExpected, true); assert.equal(outsider.keyOpen, 'denied');
});
test('missing probes, wrong UID and permissive directory never prove exclusion', () => {
  const missing = () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; };
  assert.equal(probeVMUID({ directory, expectedUID, role: 'outsider' }, { uid: () => 501, stat: () => parent, open: missing, close: () => {} }).matchesExpected, false);
  assert.throws(() => probeVMUID({ directory, expectedUID, role: 'owner' }, { uid: () => 501, stat: () => parent }));
  assert.throws(() => probeVMUID({ directory, expectedUID, role: 'outsider' }, { uid: () => 0, stat: () => parent }));
  assert.throws(() => probeVMUID({ directory, expectedUID, role: 'outsider' }, { uid: () => 501, stat: () => ({ ...parent, mode: 0o40755 }) }));
});
