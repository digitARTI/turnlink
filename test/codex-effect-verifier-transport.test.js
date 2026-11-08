import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { CodexContainedMcp } from '../src/codex-contained-mcp.js';
import { makeContainedSourceRetirement } from '../src/control/contained-source-retirement-contracts.js';
import { createCodexEffectSupervisor } from '../src/codex-effect-supervisor.js';
import { createCodexEffectVerifierServer, makeRemoteCodexEffectVerifier } from '../src/codex-effect-verifier-transport.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { WorktreeTransition } from '../src/control/contracts.js';

const digest = value => createHash('sha256').update(value).digest('hex');
test('authenticated verifier starts one exact effect only after broker commit and proves completion', { skip: process.platform !== 'darwin' }, async t => {
  const root = privateTemp('/private/tmp/tlef-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const secret = '1'.repeat(64), ownerProof = '2'.repeat(64), resourceID = randomUUID(), effectID = randomUUID();
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['server'] } });
  let calls = 0; owner.retireExact = async () => { calls++; return { status: 'removed_local' }; };
  const sourceRetirement = makeContainedSourceRetirement([{ names: ['fixture'], resourceID, operationID: randomUUID(), containerID: 'b'.repeat(64), wrapperPID: 42, daemonID: 'local' }]);
  const grant = { id: randomUUID(), channel: 'dev', taskID: randomUUID(), agentId: `codex:${randomUUID()}`, previewID: randomUUID(), claimGeneration: 1,
    from: '/source', to: '/target', configurationDigest: 'c'.repeat(64), authorityDigest: 'd'.repeat(64), status: 'prepared', preparedAt: 1,
    sourceMcpShutdown: true, sourceRetirement, destinationOwners: { mcpTransitionID: randomUUID(), providerTransitionID: randomUUID(), mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID: randomUUID() } };
  const supervisor = createCodexEffectSupervisor({ grant, effectID, kind: 'remove', resourceID, owner, ownerProof, guard() {} });
  const path = join(root, 'v.sock'), server = await createCodexEffectVerifierServer({ path, secret, supervisor }); t.after(() => server.close());
  const verifier = makeRemoteCodexEffectVerifier({ path, secret }), wrong = makeRemoteCodexEffectVerifier({ path, secret: '3'.repeat(64) });
  const fence = { effectID, kind: 'remove', resourceID, grantDigest: digest(JSON.stringify(WorktreeTransition.parse(grant))), ownerProofHash: digest(ownerProof), receiverHash: 'e'.repeat(64) };
  await assert.rejects(wrong({ phase: 'begin', fence, ownerProof, signal: new AbortController().signal }), /CODEX_EFFECT_VERIFIER_UNAVAILABLE/);
  await delay(20);
  const armed = await verifier({ phase: 'begin', fence, ownerProof, signal: new AbortController().signal });
  assert.equal(calls, 0); assert.equal(armed[codexVerifierLease].check(), true);
  await armed[codexVerifierLease].commit(); armed[codexVerifierLease].release();
  await supervisor.wait(); assert.equal(calls, 1); await delay(20);
  const completed = await verifier({ phase: 'finish', fence, ownerProof, signal: new AbortController().signal });
  assert.equal(completed.status, 'completed'); assert.equal(completed[codexVerifierLease].check(), true); completed[codexVerifierLease].release(); await delay(20);
  await assert.rejects(verifier({ phase: 'begin', fence, ownerProof, signal: new AbortController().signal }), /CODEX_EFFECT_VERIFIER_UNAVAILABLE/);
});
