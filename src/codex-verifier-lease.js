// A verifier may retain an owner connection until the synchronous broker
// settlement finishes. MCP cleanup requires this lease; cancellation may use
// one. The symbol is local to trusted in-process plumbing and is never serialized.
export const codexVerifierLease = Symbol('codexVerifierLease');

export function releaseCodexVerifierLease(proof) {
  const lease = proof?.[codexVerifierLease];
  if (typeof lease?.release === 'function') lease.release();
}
