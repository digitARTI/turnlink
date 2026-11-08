import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { CodexContainedMcp } from '../src/codex-contained-mcp.js';
import { acquireContainedSourceInventory, captureContainedSourceInventory, captureContainedSourceRetirementProposal } from '../src/codex-contained-mcp-inventory.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';

function fixture(t) {
  const directory = privateTemp('/private/tmp/turnlink-inventory-'); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const resourceID = randomUUID(), owner = new CodexContainedMcp({ directory, docker: '/bin/false',
    spec: { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['server'] } });
  let valid = true;
  owner.acquireRunningObservation = async ({ signal }) => ({ resourceID, operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 42, daemonID: 'fixture-daemon',
    peer: { path: '/tmp/fixture-peer', nonce: 'b'.repeat(64) },
    check() { if (signal.aborted || !valid) throw new Error('revoked'); }, async revalidate() { this.check(); return true; } });
  let snapshot = { entries: [{ name: 'one', owner: 0, transport: 'stdio', processId: 42 },
    { name: 'alias', owner: 0, transport: 'stdio', processId: 42 }], eventStreamPresent: false }, close;
  let peerPID = 42;
  const native = { onClose(listener) { close = listener; return () => { close = undefined; }; }, async verifySourceMcpPeer() { return peerPID; },
    async observeSourceMcpInventory() { return structuredClone(snapshot); } };
  return { owner, native, setSnapshot(value) { snapshot = value; }, setPeerPID(value) { peerPID = value; }, close() { close?.(); }, invalidate() { valid = false; } };
}

test('contained inventory correlates all aliases and invalidates on native close', async t => {
  const f = fixture(t), controller = new AbortController();
  const threadId = randomUUID(), reservation = { generation: randomUUID(), revision: 1 };
  const observation = await acquireContainedSourceInventory({ native: f.native, threadId, reservation,
    owners: [{ names: ['one', 'alias'], owner: f.owner }], signal: controller.signal });
  assert.equal(observation.entries.length, 1); assert.equal(observation.entries[0].wrapperPID, 42);
  assert.equal(observation[codexVerifierLease], undefined); assert.equal(await observation.revalidate(), true);
  assert.deepEqual(await captureContainedSourceInventory(observation, { native: f.native, threadId, reservation }), observation.entries);
  const proposal = await captureContainedSourceRetirementProposal(observation, { native: f.native, threadId, reservation });
  assert.equal(proposal.owners[0].daemonID, 'fixture-daemon'); assert.deepEqual(proposal.owners[0].names, ['alias', 'one']);
  assert.equal(proposal.stop, true); assert.equal(proposal.remove, true); assert.match(proposal.digest, /^[a-f0-9]{64}$/);
  await assert.rejects(captureContainedSourceRetirementProposal({ ...observation }, { native: f.native, threadId, reservation }), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  await assert.rejects(captureContainedSourceInventory({ ...observation }, { native: f.native, threadId, reservation }), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  await assert.rejects(captureContainedSourceInventory(observation, { native: f.native, threadId, reservation: { ...reservation, revision: 2 } }), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  f.close(); assert.throws(() => observation.check(), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  await assert.rejects(captureContainedSourceInventory(observation, { native: f.native, threadId, reservation }), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
});

test('contained inventory rejects unmapped servers, event streams and wrong process IDs', async t => {
  const f = fixture(t), controller = new AbortController();
  const args = { native: f.native, threadId: randomUUID(), reservation: {}, owners: [{ names: ['one', 'alias'], owner: f.owner }], signal: controller.signal };
  for (const snapshot of [
    { entries: [{ name: 'one', owner: 0, transport: 'stdio', processId: 42 }], eventStreamPresent: false },
    { entries: [{ name: 'one', owner: 0, transport: 'stdio', processId: 42 }, { name: 'other', owner: 1, transport: 'http', processId: null }], eventStreamPresent: false },
    { entries: [{ name: 'one', owner: 0, transport: 'stdio', processId: 42 }, { name: 'alias', owner: 0, transport: 'stdio', processId: 42 }], eventStreamPresent: true },
    { entries: [{ name: 'one', owner: 0, transport: 'stdio', processId: 43 }, { name: 'alias', owner: 0, transport: 'stdio', processId: 43 }], eventStreamPresent: false },
  ]) { f.setSnapshot(snapshot); await assert.rejects(acquireContainedSourceInventory(args), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/); }
});

test('contained inventory fails closed after its native or local observation changes', async t => {
  const f = fixture(t), controller = new AbortController();
  const observation = await acquireContainedSourceInventory({ native: f.native, threadId: randomUUID(), reservation: {},
    owners: [{ names: ['one', 'alias'], owner: f.owner }], signal: controller.signal });
  f.setSnapshot({ entries: [], eventStreamPresent: false });
  await assert.rejects(observation.revalidate(), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  assert.throws(() => observation.check(), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  const g = fixture(t);
  const local = await acquireContainedSourceInventory({ native: g.native, threadId: randomUUID(), reservation: {},
    owners: [{ names: ['one', 'alias'], owner: g.owner }], signal: controller.signal });
  g.invalidate(); await assert.rejects(local.revalidate(), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  assert.throws(() => local.check(), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
  const h = fixture(t); h.setPeerPID(43);
  await assert.rejects(acquireContainedSourceInventory({ native: h.native, threadId: randomUUID(), reservation: {},
    owners: [{ names: ['one', 'alias'], owner: h.owner }], signal: controller.signal }), /CONTAINED_MCP_INVENTORY_UNAVAILABLE/);
});
