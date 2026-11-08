# OpenCode endpoint and receiver release: remaining protocol

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


The current completion and source-recovery owners publish their private endpoint
file after the broker releases the receiver. A path collision in that interval
can leave a released receiver with no published endpoint. The isolated test
`native-lost-source-owner-finish-collision-before-detach` reproduces this with a
real broker and native server: the replacement is preserved, and a successor
can recover only after the fixture removes its own collision. The current
preflights and the post-write inode check do not close this interval.

Creating the endpoint file before release is not sufficient. In the real
`native-plugin-completion-owner` test, the native API answers an authenticated
session request while the broker receiver is still held. An early file
containing that URL and password would therefore make the API usable before
release. An exclusive placeholder at the configured path also remains after
SIGKILL; treating its age or PID as proof that it is safe to replace would
weaken the current recovery and could overwrite another owner.

The completion and finish-recovery owners publish a loopback gate instead
of the native server's address and password. The gate uses a separate random
credential, starts inactive, and forwards HTTP, streaming and WebSocket traffic
only after activation and a recent broker receiver observation. It revokes
existing connections if that observation fails, and stops when its owner or
native process exits. Concurrent requests share an observation, and a short
cache and periodic check limit broker traffic. These are point-in-time checks:
they do not establish an atomic broker lease, continuous remote liveness or a
bound on detection under every scheduler or network failure. The file is still
published after broker release, so the collision and crash interval remains.

An opt-in owner-lease path now provides a separate, fenced prepare and activation
sequence. Set `AGENT_CHANNEL_OPENCODE_OWNER_LEASE=1`,
`AGENT_CHANNEL_OPENCODE_VERIFIER_DIRECTORY`,
`AGENT_CHANNEL_OPENCODE_ENDPOINT_DIRECTORY`, and the existing
`AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE` on the broker, alongside the
control, worktree grant and receiver handoff flags. The completion socket path
must be omitted in this mode. Both directories must be absolute, private and
shared with the owner on the broker host. The completion owner config uses
`ownerLease: true`, `verifierDirectory`, and `endpointDirectory` in place of
`verifierSocket` and `endpointFile`; the finish source-recovery owner uses
`completionVerifierDirectory` in place of `completionVerifierSocket`, plus
`endpointDirectory` and `ownerLease: true`. The existing source-recovery
verifier still has its own configured socket and credential. The mode is off
by default, and incomplete or mixed configuration fails closed.

In this mode, a verified completion persists an owner generation in a prepared
state while delivery and task admission remain blocked. The broker holds an
authenticated verifier connection, checks a native receiver health RPC and a
separate private gate challenge, and activates only after the verifier attests
the endpoint file. The broker stores a relative name, file identity and digest,
not the endpoint password. `turnlink-opencode-endpoint-discovery --config <file>`
uses an admin credential to resolve that reference, verify the file and probe
the gate; its private config contains `brokerUrl`, `adminTokenFile`,
`endpointDirectory`, `agentId`, `channel`, and `transitionID`. It prints only
the verified file path and owner generation. The consumer must protect and
read that file itself.

Heartbeats run approximately once per second with a 3.5-second deadline;
native checks and scheduling can delay detection. A lost lease or observed
readiness failure fences that generation, and broker restart starts fenced
until a new owner verifies and activates. These checks are not an atomic lock
across processes, and already admitted work still requires reconciliation.
Generation-specific verifier sockets and endpoint files survive SIGKILL as
stale artifacts and are never deleted based only on PID or age. The test suite
exercises a lost prepare and activation reply, broker restart, delivery with a
durable acknowledgement, native owner SIGKILL, and task report and acceptance;
it does not prove every concurrent replacement, network or crash boundary.

The isolated OpenCode integration test also kills the broker while an owner is
active. It verifies that a competing owner cannot displace that generation,
the old gate stops serving, and immediate broker restart is refused while the
store lock is fresh. A normal run advances the timestamps of the fixture's
`broker.lock` and `broker/control.lock` to simulate expiry; in that run it also
checks that a fenced receiver cannot pull or receive task wakeups. A separate
run with `TURNLINK_FIXTURE_REAL_LOCK_WAIT=1` waits for the actual 60-second stale
interval without changing the lock timestamps. Both runs then exercise a new
lease, queued delivery and persisted acknowledgement. These results do not
prove safe removal of arbitrary stale locks or artifacts outside the fixture.

The task integration case also completes and accepts the original worktree
task, delivers a later message, and dispatches a second task that does not
require a new worktree. A later task that requires a worktree still needs its
own approved worktree transition.

An experimental, explicitly enabled host path now also exercises a second
approved worktree transition using the same retained native process. The real
plugin test covers promotion, source draining and detachment, placement and
completion, a fresh owner lease and discovery, and execution of the second
task through review. The host keeps the earlier movement record, and an
ambiguous drain remains fenced rather than replayed. A deliberately lost
drain reply was tested with the old endpoint unavailable and a message held;
while the same verifier lease remains live, the owner reconciles the exact
broker record using a one-use challenge, then completes the second task and
delivers the message. Loss of the verifier lease or owner process still needs
separate recovery and remains fenced.
In the isolated SIGKILL case, the test waits for the journal lock to expire,
observes the direct native child exit, and claims the exact second intent in
a new recovery process. The new claim reports unresolved resources and the
native descriptor can observe the exact prior WebSocket transport release and
absence of pending acquisitions in its local census. The broker stays fenced;
these checks do not prove that all descendants or external resources have
terminated and do not yet resume the second task.
This path is disabled by default and does not establish production readiness.

An experimental Linux verifier uses an abstract Unix socket when explicitly
enabled. Its generated address has no filesystem inode and is not a secret;
peer identity comes from the HMAC exchange and the retained connection. A
test covers a false listener, wrong key, disconnect and an unrelated file at
the corresponding pathname. The mode remains disabled by default.

On Docker Desktop, a fixture demonstrated that a Linux container could write
a bind-mounted SQLite WAL database while the macOS host held `BEGIN IMMEDIATE`.
Do not use that shared database for movement authority. With a dedicated
Docker volume and both writers inside the VM, a separate fixture observed
`SQLITE_BUSY`, then rollback and a successful new writer after SIGKILL. A full
migration fixture in the VM reached the second task's review. Separately, a
networkless OpenCode container with that volume and no host bind mounts loaded
the real plugin and joined the host broker through a private relay. The
same fixture stopped and removed that container, then started a new local
generation on the same volume and read the earlier session. Separate local
tests simulate a lost remove or create reply and reconcile the recorded Docker
identity without replay. A separate Alpine fixture kills the supervisor with
SIGKILL, confirms the old container is still running, stops and removes it,
and reads its volume in a successor. External Docker clients with access to the same daemon
can still race local volume custody.
The
contained completion-owner integration checks the supervisor's observed
container, daemon, operation and volume before opening its receiver; this is a
point-in-time check. An opt-in broker verifier can now persist an attestation
from the supervisor's authenticated generation registry, tied to the retained
HMAC verifier socket, container, daemon, operation and volume. A test with the
real broker and a containerized verifier confirms that the binding survives a
broker restart and remains fenced after container SIGKILL. It does not use an
OpenCode task for that portion or prove takeover. That case alone remains
fenced and does not demonstrate recovery.

An experimental host endpoint bridge can use that registry without sharing the
guest endpoint directory with the broker. It reads only the guest endpoint
whose identity and digest are reported by the authenticated retained verifier,
forwards to the gate in the exact observed container, and publishes a separate
host gate with a new credential. Loss of the verifier lease closes its streams
and endpoint. The broker persists that the endpoint is host-owned and refuses a
restart without the matching resolver. Real broker and Docker/verifier tests
passed activation, credential separation, stream revocation, container SIGKILL
and the no-resolver restart. These remain bounded liveness observations; the
bridge does not prove remote work or protect against another Docker client, and
does not itself implement the complete host/VM migration or crash takeover.

The experimental host/VM fixture now also completed two movements and a second
task through review with a real broker on the host, authenticated verifier and
registry, networkless container, and SQLite solely on a VM volume. It uses
separate private muxes for broker, redacted fixture observation, and verifier
announcement. During integration a late FIN for a retired multiplexed socket
was found to close the whole mux; terminal frames for recently retired IDs are
now ignored, while data or terminal frames for unknown IDs still fail closed.
That successful run did not kill the host supervisor. A separate test killed a
host tunnel supervisor after the broker recorded a drain, stopped and removed
the attested old container, and created a successor on the same VM volume. The
successor acquired a new native recovery lease for the recorded transition.
An opt-in host verifier brackets an authenticated, retained native verifier
connection with Docker observations and authorizes a broker rotation into a
held receiver. A real host/VM run then reconciled the claim, verified source
detachment, observed native idle again, completed placement and release, and
ran the second task to review. The old receiver key and a repeated rotation
were rejected, and a message remained held before release. The host test uses
fixture orchestration, fake credentials and a local mock model; it is not the
normal application startup or an independent assurance against other Docker
clients. The container and its Docker daemon remain accessible to same-UID
Docker clients. A fixture also drops a native claim reply after the effect,
observes the durable `uncertain` record and takes over the observed claim
without repeating the initial dispatch, then finishes the second task. A
separate run drops the broker rotation response and resumes with the persisted
receiver key before completing the task. An explicit contained-host CLI now
wires the broker, retained HMAC verifier, successor preparation and guest
source-recovery owner. Its isolated end-to-end test uses the reusable runtime
image and reaches review after takeover with one task prompt; the initial
transition driver and model are fixtures. Ordinary broker startup does not
enable this path. Other intermediate crash states remain a separate
verification boundary.

As an alternative to the legacy fixed `endpointFile`, either owner accepts
`endpointDirectory`. It creates a private file named with a fresh UUID and
returns its path as `endpointFile` in its ready JSON. A successor chooses a new
path and never removes another generation's file; stale files after a crash
remain the operator's responsibility. The owner output is a discovery channel,
not a durable broker record: a lost ready reply still needs separate recovery,
and a file's presence is not proof that its owner or gate is live. Without
`ownerLease: true`, this option does not change release or delivery ordering.

## Required interface

The following requirements remain the acceptance boundary for this protocol:

1. A broker-owned, persisted release attempt must bind the exact transition,
   receiver, native completion receipt, unique attempt ID and owner generation.
   Its intermediate state must suppress message delivery, task wakeups, task
   pulls and admissions. Repeating the same attempt after a lost reply must
   observe the same record; a different attempt must not overwrite it.
2. The destination owner must hold a revocable capability tied to its actual
   native process and receiver. The broker must verify that capability itself,
   not accept a model- or adapter-supplied assertion that a path is ready. A
   socket disconnect, native owner exit or generation change must invalidate
   the capability; asynchronous disconnect detection must not be described as
   an instantaneous cross-process lock.
3. The externally advertised endpoint needs a separate activation gate. It
   must not expose a usable native URL or password before the broker's release
   is active, including through other HTTP routes, streaming and WebSocket
   upgrades. The native server's private capability and its network boundary
   must not allow a caller to bypass the gate with the advertised credential.
4. Endpoint identity and discovery must survive process death without
   overwriting an unrelated replacement. A generation-specific endpoint plus
   authenticated discovery avoids taking over an arbitrary existing path, but
   requires consumers and the broker to use the new discovery interface; it is
   not provided by the present fixed-file configuration. Stale files are not
   proof of a dead owner, and must not be deleted by age or PID alone.
5. The broker must not resume delivery or task execution after restart merely
   because a previous generation was released. It needs a fresh authorized
   owner and endpoint activation, with explicit reconciliation of any work
   already admitted before the failure. Acknowledged messages remain
   acknowledged; an unacknowledged delivery retains at-least-once semantics.

Before use, this interface needs tests for path replacement and removal at each
boundary, owner and broker death before and after each durable write, lost
replies, concurrent successors, stale generations, endpoint access while held,
and delivery and task admission during revocation. It must preserve recovery of
the existing successful release and crash cases. No current component supplies
all these properties, and Gate 2 remains open.
