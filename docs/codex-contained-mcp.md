# Local contained MCP owner (experimental)

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


`CodexContainedMcp` and the `turnlink-contained-mcp` stdio entry point run an
explicitly configured MCP server inside a pinned Docker image, initially with
Docker network mode `none` and no host mounts. They do not modify Codex configuration or adopt an
already-running server. They are not connected to the broker's MCP cleanup
verifier and cannot release a migration hold.

The caller supplies an absolute Docker executable, a private state directory,
a resource UUID, an exact local image ID (`sha256:...`), and an argument array.
These are trusted operator inputs. Docker can display the command in container
metadata; do not put credentials in it. The helper uses only a local Unix
socket and freezes the selected Docker endpoint for the owner's lifetime. It
refuses a different daemon ID, image, command, label, container identity,
restart policy, namespace or containment settings. It does not mount host
paths, add network or inherit arbitrary host environment variables into the
container. Creation and start intents are persisted before dispatch. A later
owner can observe an exact created container after a lost creation response or
stop the exact container after owner death; it never repeats a start.

`create()` creates but does not start the container. `start()` returns the
attached child process and its exit promise; the caller must wire its stdio to
the MCP client. `observe()` rechecks the daemon and container. `stop()` stops
and observes the container, returning `stopped_local` only for an exited
container. `remove()` removes the same stopped or never-started container.
An uncertain daemon response or invalidated lock refuses proof. A durable
`creating` record without an observable matching container is left unresolved.

`retire()` is a separate local cleanup operation for a stopped container. It
persists a removal intent before asking Docker to remove the exact container,
then checks the same daemon for that full container ID and persists a removed
record. If the removal reply is lost, a successor can record an absent ID; if
the ID is still present it reports uncertainty and does not repeat removal.
This trusts the local daemon and its container-ID semantics. It is not a broker
receipt, does not establish the complete native owner set, and does not prove
anything about remote work. The experimental native staging test retired the
source container while its distinct destination container remained active.
`acquireRetiredObservation({ signal })` holds the cooperative journal lock and
rechecks the removed record and asynchronous daemon absence. An observed record
or daemon mismatch permanently invalidates that observation, even if previous
values later return. It cannot detect changes made and reversed between checks,
and its synchronous `check()` only checks the local record. It does not carry a
broker lease.

A real Docker fixture demonstrated that another daemon client can disconnect
`none`, attach `bridge`, then restore `none`; the running observation rejects
while `bridge` is present but a later fresh observation and the removed
container tombstone cannot reveal the intervening attachment. Therefore this
backend is not a covered remote-work class without exclusive, continuous
control of the daemon and an authoritative inventory of work. This also does
not cover model requests, shell commands or other MCP servers.

`acquireStoppedObservation({ signal })` retains the local journal lock while a
trusted caller inspects one stopped container. `check()` validates the local
lease and exact record; `revalidate()` also queries the daemon and checks the
container again. Abort releases the lock. This is intentionally **not** a
broker verifier lease: another Docker client can change the container after
the asynchronous daemon check, and this single-container observation does not
identify the complete native MCP runtime.

The stdio entry point accepts `--config /absolute/private.json`. Its private
file contains `{ "version": 1, "directory": "/absolute/private-state",
"docker": "/absolute/docker", "spec": { "resourceID": "<uuid>",
"image": "sha256:<local-image-id>", "command": ["/server"] } }`. A Codex
MCP configuration may set its command to the absolute Node executable and its
arguments to the absolute `codex-contained-mcp-stdio.js` path, `--config`, and
that file. If Codex uses a separate home, explicitly supplying its local Docker
Unix socket as `DOCKER_HOST` may be necessary. The resource ID identifies one
start attempt; a restart with the same ID is refused instead of silently
restarting the server. A trusted coordinator must allocate a new ID for a new
approved instance and retain the old state until it has been reconciled.

For a source and a destination that must coexist, version 2 of the private
configuration keeps the common image and command in `spec` and lists explicit
`instances: [{ "cwd": "/absolute/source", "resourceID": "<uuid>" },
{ "cwd": "/absolute/destination", "resourceID": "<different-uuid>" }]`.
The wrapper selects the entry whose resolved directory equals its process
working directory. Missing directories, duplicate resolved paths, repeated
resource IDs and an unlisted working directory are refused before startup.
Both UUIDs are still single-use and must be provisioned by a trusted caller;
the mapping is not broker approval or proof of a native connection's identity.
An SDK integration test ran both owners concurrently, stopped the source and
continued a tool call on the destination. A separate isolated broker and native
app-server staging test retained both containers, authorized source shutdown,
observed the source container stopped and the destination container still
running, and confirmed that new turns remained quarantined. A source tool had
launched a detached descendant; a separate PID-namespace observer confirmed
that the descendant no longer existed after shutdown. This exercised the
experimental staging path; it did not release the receiver or establish a
production movement proof.

An isolated real Codex app-server called a tool through this stdio entry point.
After both normal shutdown and a forced app-server crash, the exact container
was observed stopped and a separate namespace observer confirmed that the
fixture's detached child no longer existed. This does not establish the full
migration path or support servers that need a project mount or network access.
The stdio wrapper also treats input EOF, closure or error as a stop request,
so a server that remains alive after its input closes is stopped instead of
being left running. This was checked both with an SDK client disconnect and
with a forced app-server crash, using a fixture that ignores EOF. The wrapper
starts a detached watchdog before creating the container and holds a private
pipe to it. If that pipe closes without a clean-stop indication, the watchdog
uses the journal to inspect and stop the exact container, without retrying
creation or start. Both processes share an operation UUID chosen before the
container is created, and the watchdog refuses a journal for another operation.
If the watchdog exits first, the wrapper requests a stop.
Tests killed each process separately and observed the recorded container stop.
Another test killed the wrapper within a real Codex session, observed the
watchdog stop its container and detached descendant, and confirmed the native
app-server stayed alive.
The watchdog retries for a bounded period when a killed writer leaves a lock;
an unresolved record remains for later recovery. Simultaneous process death,
host or Docker failure, hostile pipe or Docker access, and recovery after the
watchdog's retry window are not covered. The watchdog is not a broker verifier
and its observation does not release a migration hold.

These observations trust the selected local Docker daemon and its lifecycle.
They do not certify daemon/host failure, protect against a hostile actor with
Docker control, prove that an external service stopped, or establish that all
Codex MCP resources use this owner. Networked servers, host mounts, existing
processes and configurations needing host credentials are deliberately outside
this owner. A real broker verifier still needs an authenticated mapping from
the complete effective native MCP owner set to independently checked local and
remote cleanup evidence, with durable crash recovery. Gate 2 remains open.

The private native control can now read the materialized source runtime MCP
inventory while holding the exact source reservation and request exclusion. It
reports bounded names, alias groups, transport classes and event-stream
presence. When available for a ready local stdio transport, it also reports the
process-group ID captured by the native launcher, but only while the retained
child handle is immediately available and still carries that ID. A contained
wrapper records its own PID in its journal for correlation. An ID may be stale or reused and
matching IDs alone do not authenticate a live wrapper or establish cleanup.
The host validates the response and refuses changed reservations or
malformed aliases. A real app-server integration test observed a fixture stdio
connection and rejected a different reservation. This snapshot is not an
authenticated mapping to contained owners, a physical or remote release proof,
or permission to move; it may cease to be current after the observation.

`acquireContainedSourceInventory` correlates a reservation-bound source
inventory with explicitly supplied contained owners. It requires every
materialized name and alias to be accounted for, local stdio launch IDs to match
the wrappers' recorded PIDs, no event stream, and each exact container to be
running while its journal lock is held. The wrapper also serves a private Unix
socket with a per-operation challenge. On macOS and Linux the native runtime
holds its child handle, checks the socket peer PID using the kernel and checks
the challenge before reporting the correlation. Revalidation repeats the peer,
native inventory and Docker checks; disconnect, abort or an observed mismatch
revokes the observation. Tests include a different process owning the socket,
a wrong challenge, unknown entries and a real broker/app-server/container
fixture. If the wrapper is killed, its watchdog removes the exact socket after
recovery; an unexpected replacement is left untouched.

The peer check identifies a process at that moment, under the trusted local
user, runtime, filesystem and kernel boundary. It does not exclude changes
between checks, hostile same-user access, untracked or old connections, Docker
administrators or remote work. The correlation is not a broker lease and does
not release a migration hold.

The experimental publication fixture can capture a live correlation before
dispatching publication. It writes the names and exact local resource,
operation, container and wrapper IDs with the publication intent; a version-4
host journal retains them across restart and refuses later substitutions or
downgrade. The peer challenge is not copied into that host journal. The
correlation releases its journal locks before publication so
source shutdown can proceed. The stored values are historical: they do not keep
the peer or container alive and do not authorize retirement, replay, broker
settlement or receiver release after a crash.

For the still-live experimental owner, `retireExact` refuses a resource,
operation, container or wrapper ID that differs from the captured record.
`acquireCapturedRetiredSource` then correlates the persisted publication and
native source-shutdown receipt with the retired containers under their journal
locks, rechecking the broker-authorized native observation and publication
barrier. Changes to the journal, loss of the owner or a revoked guard invalidate
the observation. It does not initiate retirement, recover a dead native owner,
or provide a broker lease; remote work and untracked resources remain outside
its evidence.

For a resumed destination proxy, the optional private file named by
`AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE` configures an additional read-only
successor observation. Its JSON is `{ "version": 1, "directory":
"/absolute/private-state", "docker": "/absolute/docker", "owners":
[{ "resourceID": "<uuid>", "image": "sha256:<local-image-id>",
"command": ["/server"] }] }`. Each entry must refer to an exact source
owner captured before publication. The proxy checks those local tombstones and
Docker absence around the restored native shutdown and held broker receiver;
it does not construct the owner configuration from historical identities. The
file is read only for a configured destination in resume mode and its path is
not passed to the native child. Missing inventory skips this optional check;
an unsuccessful check reports unverified and leaves the receiver held.

The observation is revoked on native or receiver loss, changed local records,
or failed revalidation. Docker and broker observations take time and are not
atomic; the result neither releases the hold nor proves untracked resources or
remote work have stopped. It does not remove a still-present container or retry
an uncertain effect.

Container stop records intent before dispatch. If its reply is lost, a
successor observes the exact container and records completion only after it
is exited; it does not issue another stop while the recorded attempt remains
uncertain. A controlled Docker-command fixture verifies the dispatch count and
subsequent observation. Two real Docker cases also passed: one lost the reply
after an actual stop, and one failed before dispatch. In both cases the
successor issued no second stop. If the original request never took effect,
recovery remains unresolved and requires a separate authorized reconciliation path.
This behavior alone does not prove cleanup or authorize receiver release.

One narrower failure is distinguishable: if spawning the Docker executable
itself fails with `ENOENT`, no Docker process was created. While retaining the
journal lock, the owner restores the prior phase and a successor may retry.
A controlled executable-removal test exercised that path; timeouts, Docker
exit errors and a crash before recording the result still remain uncertain.
The same pre-dispatch distinction applies to removal of a created or stopped
container. A controlled test restored the created phase and retried once;
three real Docker removal regressions continued to reject uncertain replay.

Removal of a never-started container now uses the same durable intent and
exact-ID absence check as retirement of a stopped container. An uncertain
removal is not dispatched again; observation can record the tombstone after
the exact ID is absent. A watchdog subprocess and controlled Docker-command
fixture exercised the lost-reply path, including a still-present container and
one removal dispatch. A separate real Docker test created a never-started
container, discarded its successful removal reply, and observed the exact ID
absent without a second removal. The complete contained-owner Docker suite also
passed on this change, as did the experimental broker/app-server contained
source shutdown and destination retention case. A permanently present
container remains unresolved; these runs do not prove receiver release.
