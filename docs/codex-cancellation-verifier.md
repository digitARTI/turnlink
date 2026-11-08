# Codex cancellation verifier transport

The optional verifier transport connects a broker to the process that owns a
live `CodexNativeControl`, its admission fence and the locked resource journal.
It verifies cancellation of a previously bound destination; it does not move a
session, release its resources, or authorize a receiver handoff.

On macOS, an integrating host creates `createCodexCancellationVerifierServer` from
`src/codex-cancellation-verifier-transport.js` with an absolute Unix socket
path in a user-owned `0700` directory and a separately provisioned 32-byte
secret encoded as 64 lowercase hexadecimal characters. The broker configures
`destinationCancellationVerifier` with
`makeRemoteCodexCancellationVerifier({ path, secret })`. These values are
trusted deployment configuration and must never come from an adapter command.
Use a secret distinct from broker, administrator, adapter and session keys.

Pass the live server as `verifierService` to
`withCodexEstablishedDestination`, and pass the returned `verifierService` to
`settleCodexDestinationCancellation`. The coordinator registers the exact grant
while its exclusive journal operation is in progress and removes it in a
`finally` block. Verification checks the live native owner, session membership,
fence, journal record, grant and cancellation receipt before and after observing
the same native owner. A challenge and authenticated bounded frames protect
each socket request and response; timeouts, disconnects and invalid proofs fail
closed. After returning a proof, the server keeps that registration exclusively
held until the broker checks the connection and completes or refuses its
synchronous settlement. Removing the registration closes its connections. Within
the running service, a disconnected observation keeps the grant busy until the
observation itself returns, including if its registration is removed.
Existing socket paths are not replaced on startup. On the tested Node
24/macOS runtime the server duplicates the listener through `/dev/fd` and uses
an fd-based listener so shutdown preserves a replacement file at the socket
pathname. Descriptor lookup depends on Node's internal listener handle and
fails closed if unavailable. Other server platforms are not implemented, and
the socket's private parent directory must remain trusted.

This is a macOS-hosted, same-machine integration. The broker CLI and source
proxy also support it when explicitly configured: both receive the same
`AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET` and private
`AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE`. The broker additionally requires
the control plane and `AGENT_CHANNEL_WORKTREE_GRANTS=1`; the proxy requires a
valid source-preparation configuration and native control. The verifier token
must differ from the broker host, administrator and adapter credentials. See
the setup in [the control-plane guide](control-plane.md). This wiring permits
cancellation verification only; it does not enable production destination
movement. A private socket and shared secret authenticate only
to the extent that the local user and secret are trusted; they do not isolate
other processes with the same user privileges. Keeping a connection open across
the local commit reduces the gap after verification, but does not prove that a
remote process is alive at the exact instant of commit: disconnect delivery can
lag process failure. A dead owner, stale socket, process restart or uncertain
remote work still needs its own durable recovery protocol. Do not use this
transport alone to close Gate 2.

The real lost-cancellation integration test starts the broker in a separate
process and exercises wrong-secret, wrong-host, altered-receipt, concurrent-call
and removed-registration cases. Run it with the explicit native integration
environment described in [native continuity](codex-native-continuity.md).
