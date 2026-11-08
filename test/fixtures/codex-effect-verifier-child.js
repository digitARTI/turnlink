import { readFileSync } from 'node:fs';
import { CodexContainedMcp } from '../../src/codex-contained-mcp.js';
import { createCodexEffectSupervisor } from '../../src/codex-effect-supervisor.js';
import { createCodexEffectVerifierServer, makeRemoteCodexEffectVerifier } from '../../src/codex-effect-verifier-transport.js';
import { codexVerifierLease } from '../../src/codex-verifier-lease.js';
import { createCodexRetiredEffectVerifier } from '../../src/codex-retired-effect-verifier.js';

const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const owner = new CodexContainedMcp(value.owner);
const original = owner.retireExact.bind(owner);
let unblock;
const blocked = new Promise(resolve => { unblock = resolve; });
owner.retireExact = async identity => { process.send?.({ type: 'entered' }); await blocked; return original(identity); };
let nativeLease;
if (value.nativeWitness) {
  const verifyNative = makeRemoteCodexEffectVerifier(value.nativeWitness.transport);
  const proof = await verifyNative({ phase: 'begin', fence: value.nativeWitness.fence,
    ownerProof: value.supervisor.ownerProof, signal: new AbortController().signal });
  nativeLease = proof[codexVerifierLease]; await nativeLease.commit();
}
const supervisorOptions = { ...value.supervisor, owner, guard() {
  if (nativeLease && nativeLease.check() !== true) throw new Error('NATIVE_WITNESS_LOST');
} };
const supervisor = value.reconcile ? createCodexRetiredEffectVerifier(supervisorOptions) : createCodexEffectSupervisor(supervisorOptions);
const server = await createCodexEffectVerifierServer({ path: value.socket, secret: value.secret, supervisor });
process.on('message', async message => {
  if (message?.type === 'continue') {
    unblock();
    try { await supervisor.wait(); process.send?.({ type: 'completed' }); }
    catch { process.send?.({ type: 'uncertain' }); }
  } else if (message?.type === 'check-native') process.send?.({ type: 'native-status', alive: !!nativeLease?.check() });
  else if (message?.type === 'close') { nativeLease?.release(); await server.close(); process.exit(0); }
});
process.send?.({ type: 'ready' });
