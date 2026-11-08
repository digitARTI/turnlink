# Isolated OpenCode continuity extension (in progress)

## Current destination checkpoint — 2026-11-05

The staged OpenCode destination implementation remains default-off. An
isolated test now runs the actual OpenCode plugin and native server through
placement, a lost broker-settlement reply, completion and verified receiver
release. The completion RPC now returns its public receipt without exposing the
internal storage authorization token. The test does not yet prove task
execution through that same real plugin path or automatic production startup.

The earlier isolated acceptance path used the production placement and
completion RPC handlers, a protected transport-release record, exact successor
recovery, permission/hook/tool/instruction/model authority revalidation, the
broker-held receiver, queued delivery and destination task dispatch. It recovers
lost replies by observing durable identities rather than replaying effects.
Native completion is dispatched only after observing and matching the exact
placement receipt. Production negative coverage verifies that placement cannot
commit without protected transport-release proof.

The current patch is 1,898,745 bytes, SHA-256
`8bf689d669c92d256c9a4c7a273e3e67fbac0fd1e57d01d6dcaf29d0623a04b7`,
and reconstructs tree `a07a648c2d06426231761a8ae32608a145b45868`
from pinned upstream commit `d7d44a7e03a9a390a3b66d1da8bb59aa03b65f9e`.
Forward application with strict whitespace, exact tree comparison and reverse
application to upstream tree `0420fc066e3f06fdce2796ef1896a461cb9bbfa8`
passed through temporary indexes without touching the checkout index. The latest
change passed 12 native server tests, server typechecking and the real plugin
placement/release case.
Earlier focused verification on tree `4da53ed9039d55308c4a104fe736b5f193274683` passed 22 host authorization cases, 145 broader host cases,
8 full native destination cases, 21 native movement cases, 20 hermetic placement
cases, 19 database ownership cases, 12 native server cases and all 35 workspace
typecheck tasks.

This does not complete the OpenCode or cross-runtime Gate 2 acceptance. The
incompatible installed Codex Desktop launch path now selects separate homes, but
full application isolation is unverified, and
Codex's production destination resource, commit/recovery and receiver path is
still incomplete. That independent Codex boundary cannot be closed by this
patch. The historical sections below retain the incremental evidence that
preceded this checkpoint.

The staged native runtime now has an internal completion transaction that
validates a committed placement and atomically records completion while
removing the quarantine and membership seal. A private read-only observation
checks the current destination Session and receiver binding after restart.
Neither operation proves destination authority or resource readiness, and the
completion transaction is not exposed through the private control channel.
Per-Session legacy archived membership and stage records remain retained;
later transitions use separate immutable records. Isolated native tests cover
three moves; a private-host test covers two moves across process restarts. Production repeat movement
and archive retention still require work. Movement remains disabled.

Native permission requests and forms take owned copies of mutable input before
their effects run. Form creation, pending views, answers and terminal results
are detached from callers; permission and form events are copied for each bus
consumer. Inputs containing shared memory, accessors, unsupported property
descriptors or other data that cannot be copied without loss are refused. This
is a compatibility constraint for native plugins supplying metadata or form
data. It does not authenticate event publishers, fence all form entry points,
or establish complete destination authority.

## Native well-known configuration observations

The staged native loader binds each well-known source to its actual catalog
entry, manifest, selected credential, resolved request and response. Preparation
re-observes the live manifest and configuration without applying or caching the
result; it refuses a changed request before sending, changed credentials or
response, stale catalog, outage or a load that fell back to cached data. A
detected mismatch invalidates the loaded snapshot until a successful reload.
Credential-backed substitutions are checked against the selected native
credential; other unsupported external substitutions remain unavailable. Local
inputs are rechecked after the remote reads. Credentials and keyed comparison
tokens are not included in the native result.

This is a bounded read, not a remote lock or a guarantee that the remote service,
HTTP redirects, files or executable plugin behavior cannot change afterward.
Managed preferences remain unsupported. Native resources, placement, receiver
continuity and full Gate 2 acceptance remain unfinished; movement stays disabled.

Verification passed: standalone Core 7,230 / 43 skipped; focused well-known,
configuration and movement tests 570 across two repetitions; the MCP expiry
fixture 20 repetitions; server 92 / one skipped; host control 380; both native
builds and all 35 canonical workspace tasks. Lint reported 1,314 warnings and
zero errors. An earlier overlapping Core run exposed an MCP fixture race, and
an earlier host run exposed a partial read of the synthetic Codex state file;
the fixtures were corrected and both suites were rerun. The
[manifest](manifest.json) records the exact source tree and patch hash.

## Native local configuration input observations

The native loader records process-keyed observations of the local configuration
file read results and process environment and file substitutions it consumes.
Preparation checks both source and destination graphs under the native
reservation and rechecks them during the owner's later validation. A mismatch is
sticky until the configuration service successfully reloads. The mechanism
rechecks configuration discovery topology and refuses conflicting observations,
oversized inputs, credential-injected substitutions without a verified native rereader,
and managed preferences consumed by `plutil`. It records keyed digests rather
than plaintext values; the digests are not exposed through the native result.

The check compares the loader's read results, which do not distinguish an absent
file from one the loader cannot read. It does not lock external files, detect an
unobserved change that is restored between reads, or establish complete executable
plugin authority. Remote configuration has the separate observation above.
Movement remains disabled.

An explicit private live-owner channel now supports native preparation and a
single tracked local model-WebSocket release. The separate host bridge checks
the exact broker grant before and after each effect and persists a dispatch
record before invoking it. Uncertain dispatches remain held without replay.
This channel is exercised only in isolated native-process tests and is not
activated by the ordinary launcher. It does not prove remote cancellation,
orphan reconciliation, other resource release, native placement, destination
receiver installation or complete destination authority.

An explicit isolated stdio server entrypoint can start the live channel in the
same service graph as the native server. The host supplies a fresh loopback
credential and retains the private descriptor; ordinary server startup does
not select this mode. This starts a new server, not an attachment to the user's
running server. Session-bound Location and form routes acquire Session activity
before loading their Location graph in the movement runtime; quarantined input
is refused without starting that graph or entering the inbox. A subsequent
approved transport release succeeds in the real-server fixture. The interrupt
route remains available, and global forms and generic Location routes remain
outside this Session-bound guard.

The isolated live server fixture now drives an actual Responses WebSocket turn
through the server's model stack, then releases that same local socket under
the approved transition. If native idle reservation refuses before entering
the preparation transaction, the private channel returns a distinct busy
result. The host durably records it and requires fresh broker authorization
before another attempt. A lost busy reply remains uncertain and is not
automatically replayed. This is not a remote-cancellation or orphan receipt.

Movement-enabled graceful shutdown now directly observes each retained socket
and reader before settling a terminal exchange's acquisition record. Sent
exchanges without a terminal observation retain their journal even if the
local socket closes. This reduces false orphan records after a verified clean
shutdown but does not establish remote cancellation or reconcile a crashed
owner.

An exact prior-owner recovery claim can preserve a quiet Turnlink source
membership in an insert-only native archive, remove its source key and seal
its absence in one transaction. The host requires a separate broker
detachment authorization and the exact held receiver handoff before and after
dispatch. The archive retains the complete membership value, but the native
receipt exposes only the seal. This does not acknowledge the old receiver to
the broker, release other resources, install a destination membership or move
the Session. Archive consumption and broker source-detachment recovery remain
unfinished.

The preceding local-input checkpoint passed Core 7,225 / 43 skipped, the focused configuration,
movement and Location tests 580 times across two repetitions, server 92 / one
skipped, host control 380, both native builds and all 35 canonical workspace
tasks. Lint reported 1,314 warnings and zero errors. The earlier mixed-source Core
run failed the reload-order regression and is excluded. The [manifest](manifest.json)
records the verified source tree and exported patch hash.

## Native configuration ownership

The native configuration service returns independent schema-preserving copies
of its loaded entries, so a caller cannot silently mutate retained provider
settings, permission rules or the returned entry list. This closes one mutable
alias; it is not proof that source files, environment substitutions, external
configuration or executable plugin state are fresh or equivalent.

Verification passed: full Core 7,218 passed / 43 skipped; focused configuration
and movement 259 passed; server 92 passed / one skipped; host control 380 passed;
both native builds and all 35 canonical workspace tasks passed. Lint reported
1,314 warnings and zero errors. The [manifest](manifest.json) records the exact
exported tree and patch hash.

## Native directory identity preparation

The native movement owner retains open source and destination directory descriptors while preparing authority and returns a native-only revalidation effect bound to that owner and authority revision. In the opt-in movement runtime, each Location graph also retains a directory identity captured around its construction; preparation rejects a cached graph when that identity differs from its current directory. A detected path replacement, unavailable path, superseding preparation or closed owner invalidates the preparation. Platforms where directories cannot be opened or cannot supply a nonzero inode fail closed; Windows support is not verified. This is directory identity evidence only. It does not prove the contents of child files or executable plugin state, detect a replacement that is restored between observations, close native resources, or perform a placement commit. Graph content provenance remains explicitly unresolved, and movement remains disabled.

The graph-identity checkpoint passed the full Core suite (7,216 passed, 43 skipped), the full server suite (92 passed, one skipped), the host control suite (380 passed), both native builds, and the canonical check (35 workspace tasks; lint reported 1,314 warnings and zero errors). The full Core run began before the additional source-replacement case was added; source and destination replacement cases both passed separately in three repetitions. The [manifest](manifest.json) records the exported patch and its exact verification scope.

The staged native owner can now preserve and detach an exact quiet source
membership while its original lease is still live. After transport release,
the owner archives the full value and inserts the absence seal in the same
SQLite transaction under its native reservation. The host requires the exact
held broker receiver, checks authorization before and after the call, and
records dispatch before it runs. A successor can observe a lost result without
replaying the deletion. The old source adapter can acknowledge after an
authenticated request to recheck the now-absent key. The integration test uses
the real broker and native server with an adapter fixture sharing its SQLite
database. Destination installation, native placement, other resources and a
source acknowledgement after the old socket is lost remain unfinished.

The same original owner can also stage an inert destination membership copied
from that archive, bound to the broker receiver key and protected by SQLite
triggers. The host requires the source acknowledgement, rechecks authorization
and receiver identity around the native call, and records dispatch before it.
The staged membership value includes the exact transition and receiver-key hash
needed by the destination plugin's receiver recovery. Existing older staged
values remain observable, but do not provide this new binding. Recovery observes
lost replies without replay. This does not install the normal
plugin membership key, move the Session, or validate destination authority.

A claimed successor native owner can also stage the protected archived
membership for the held receiver. The transaction checks the matching archive,
seal and absent ordinary membership, preserves the archive's lease identity,
and revalidates the recovery owner. The host requires a recovered source
acknowledgement and maintains a separate durable dispatch journal. Lost replies
are reconciled under a later recovery owner; absent or rolled-back results remain
unresolved and are not replayed. The stage remains inert and does not establish
physical resource cleanup, placement, destination authority or execution.

The native permission service now retains managed policy in immutable owned
data, so changes through a caller's input or a `current()` result cannot bypass
its authority revision. Prepared source and destination observations compare
the ordered native rule inputs and separately report executable hooks and
pending requests. A native registry snapshot is tied to its actual graph scope,
and revalidation rereads saved rules to detect changes made without the
in-process revision. The built-in policy hook still needs executable authority
proof; external changes can still race the reread, so this does not establish
complete destination permission authority or authorize placement.

Permission requests now capture their resources, save patterns, source and
nested metadata before dispatch. Hook events, pending records and readers use
separate copies, preventing metadata aliases from changing a later permission
re-evaluation. Metadata that cannot be cloned without loss, including shared
memory, accessors and hidden properties, fails closed; this is a behavior change
for native plugins that supplied such values. Frozen or non-default property
descriptors are also refused because cloning would change their semantics.
Native permission-approval events are copied separately for each synchronous
listener and live subscriber after Location routing. A listener can no longer
rewrite the approval request or reply delivered to another consumer. This isolates
the event value; it does not authenticate arbitrary publishers or complete native
permission-hook authority.

This is an **internal execution-reservation and movement-quarantine experiment**, not a complete native
movement contract. It is not installed in Turnlink's production adapters and
exposes no HTTP, plugin RPC or production activation switch.

## Source and reproduction

- Upstream: <https://github.com/anomalyco/opencode>
- Base: `d7d44a7e03a9a390a3b66d1da8bb59aa03b65f9e` (`origin/dev`, 2.0.30).
- Patch: `execution-reservation.patch` (apply only to that exact base).
- Local staging checkout: `.native-runtimes/opencode`, branch `native-continuity`.
- Toolchain: Bun 1.4.2; dependencies installed with `--frozen-lockfile`.
- Upstream license: `LICENSE.opencode`.

To reproduce, clone upstream into an isolated directory, check out the exact
base, inspect its `AGENTS.md`, and run `git apply --check` followed by `git apply`
with this patch. Install with `HUSKY=0 bun install --frozen-lockfile` in that
checkout. No installed runtime, global configuration or existing service needs
to be changed. Do not run `dev:live` or connect this build to production sessions.

From `packages/core` in the patched checkout:

```sh
bun run script/test.ts test/session-run-coordinator.test.ts test/session-execution.test.ts test/session-move.test.ts test/session-shell.test.ts test/session-generate.test.ts test/session-generation-reservation.test.ts test/session-owned.test.ts test/session-instruction-entry-reservation.test.ts
bun run script/test.ts test/session-run-coordinator.test.ts test/session-execution.test.ts test/session-shell.test.ts test/session-generate.test.ts test/session-generation-reservation.test.ts test/session-move.test.ts --rerun-each 10
bun run typecheck
bun run build
```

For the full core suite use `LC_ALL=C LANG=C bun run script/test.ts`. Three
upstream Git/worktree error tests depend on English Git diagnostics: the initial
Italian-locale run had 6,631 passes, 43 skips and those three failures; rerunning
those files with this command-local locale passed all 53 tests. This does not
change the machine's locale or fix upstream's locale-dependent error handling.

Run `bun run check` from the upstream repository root for canonical lint and
workspace type checks. Public Protocol/HttpApi contracts are unchanged; no
generated client files are edited.

From `packages/server`, run `bun test --only-failures` and `bun run build`;
repeat the new handler tests with
`bun test --only-failures test/session-instruction-reservation.test.ts --rerun-each 10`.
From `packages/sdk`, run `bun test --only-failures test/embedded.test.ts`.
Use the same command-local `LC_ALL=C LANG=C` locale for these test commands.

Focused verification: 110 coordinator/execution/shell/generation/move tests, ten
repetitions (1,100 passes), plus the server session-diff fixture (one pass), core
type checks/build and canonical workspace checks (35 typecheck tasks passed;
lint reports warnings but no errors). The first reservation-only patch also
passed the full locale-normalized core suite: 6,635 passes, 43 skips, no failures.
The shell/generation patch then passed its full suite: 6,643 passes, 43 skips,
no failures. The current move/selection patch passed the full core suite:
**6,647 passes, 43 skips, no failures** (6,690 tests across 263 files). The embedded
SDK regressions also passed all 14 tests using local controlled model responses.
The instruction API extension subsequently passed the entire native server
suite (84 passes, one skip), its two new request-path tests repeated ten times
(20 passes), the 14 embedded SDK tests, the server build and canonical workspace
checks. The server suite emitted listener warnings; no failures were suppressed.

The subsequent public-admission/skill/revert extension passed 379 focused tests
across seven core files, plus 40 owned-session/generation cases repeated ten times
(400 passes). The full server suite passed again (84 passes, one skip), as did
all 14 embedded SDK tests, the server build and canonical workspace checks (35
successful typecheck tasks; 1,314 lint warnings, zero errors). The exported patch
passed forward application against an isolated index at the pinned base and
reverse application against this checkout.

An earlier sleep-interrupted full run reported
6,651 passes, 43 skips, 12 failures and six between-test errors across 6,706 tests;
multiple tests elapsed hundreds of seconds during macOS sleep. Power-management
logs independently confirm matching long sleep intervals. A later run timed out
without a suite result, and the latest core build was terminated at the command
timeout. Command-scoped `caffeinate -i` allowed the focused repetition and
server/SDK checks to finish but did not prevent subsequent maintenance sleep.
These interrupted runs are not passes; no test timeouts were increased.
After the operator resumed with an awake host, a fresh complete run passed:
**6,663 passes, 43 skips, zero failures** (6,706 tests across 263 files), and
the core build completed successfully. This clears that validation blocker,
not the remaining native safety or platform delivery gates.

## Implemented boundary

`SessionRunCoordinator.withIdle` atomically reserves a process-local idle drain
slot. The internal `SessionExecution.withIdleExecution` service delegates to it.
It refuses busy or closed hosts before invoking the callback. Same-session
wakes coalesce, explicit resumes wait, and other sessions remain independent.
Interruption and host shutdown keep the reservation through callback cleanup.
The default interrupt acknowledges cancellation immediately; `awaitSettlement`
waits through cleanup. A repeated interruption cannot erase fresh cleanup-time input.
The recording-only execution layer refuses reservations rather than falsely
asserting native exclusion.

The native user-shell and session-generation facades register auxiliary activity
with `withActivity`. They wait behind a held reservation; any live registered
activity makes reservation acquisition fail before its callback. Auxiliary work
still runs concurrently with ordinary model drains. A shell's activity lease is
server-owned through completion recording, even if the submitting client
disconnects. Shell and generation placement is reloaded after waiting.
Shutdown cancels registered auxiliary work and waits through its cleanup. The
existing execution `active`/`awaitIdle` observations are not a census of shells or
generation; the reservation acquisition itself checks registered auxiliary work.
The shell lease follows native command completion, not a host-wide census of
detached descendants or other processes. It cannot certify that a worktree is
unused or safe to remove.

Ordinary native move requests now register activity before reading placement or
initializing either Location, and retain it through durable admission and wake.
They wait behind a reservation; cancellation during that wait admits no move.
Native permission, agent and model selection mutations likewise wait outside a
held reservation and reload state on entry. These mutations still execute the
human's exact request, without rewriting or weakening it. A human interrupt
cancels a held reservation and allows a waiting permission restriction to apply.

Instruction-entry writes now live in `InstructionEntry.Mutations`, a global
service that captures the host's shared execution boundary. The Location-scoped
`InstructionEntry.Service` exposes only `list`/`load`; native direct callers and
HTTP handlers both use the guarded mutation service for `put`/`remove`. This
avoids pulling a second execution host into instruction assembly. The runner
fixture explicitly constructs mutations from its existing host context, rather
than compiling another host or adding a no-op write fallback. Projector
`initialize` remains deterministic new-session/replay storage, not a public
guidance-update operation.

The unchanged HTTP routes also cover embedded clients. Tests observe real HTTP
and direct-service calls reaching the boundary before reading unchanged durable
guidance, then verify replacement/removal after release without a model wake.
Direct-call cancellation preserves guidance; mutations on another session remain
independent. Four direct cases passed ten repetitions (40 passes), the runner/
creation/direct-service group passed 277 tests, and the server (84 passes, one
skip), embedded SDK (14 passes), both builds and workspace checks passed again.
The complete core suite then passed with **6,667 passes, 43 skips, zero
failures** (6,710 tests across 264 files).

Standalone skill activation and public revert stage/clear/commit now enter the
same activity boundary before reading session placement or guidance/history and
before snapshot effects. Revert retains the existing busy-drain rejection after
entry. Public prompt, synthetic and compaction admission, pending-input
cancel/steer/queue mutations and native command execution also register activity.
Prompt preparation, including attachment/skill resolution and staged-revert
commit, therefore waits outside a held reservation. Cancellation while waiting
admits nothing. Durable inbox recording is still separate from model execution;
this extension intentionally changes the earlier facade behavior that allowed
new inbox admission during a reservation. The raw inbox/projector helpers are
not turned into reservation owners.

Tests observe the activity entry before asserting unchanged history/inbox,
exercise cancellation, check skill placement reload after a controlled projected
move, and reject reservations during skill lookup/native command execution.
The controlled projection is not a native movement or receiver-continuity proof.
An earlier attempt to attach execution ownership to the Location reader was
removed after runner-context regressions; the global mutation/read split above
replaces that approach without a no-op fallback.

Child creation and forking register source-session activity before inheriting
placement, permissions or history. Public environment updates register activity,
while environment reads remain available during reservations. Human removal
interrupts a held reservation before entering activity, waits through its cleanup
and retains the activity lease through transport teardown, recursive child
removal and durable deletion. This closes the reservation-acquisition gap after
`awaitIdle`; it is not a host-wide process or detached-shell census.

Seven new native lifecycle cases cover waiting/cancelled child/fork/environment
requests and human deletion during reservation cleanup. The twelve-case native
generation/lifecycle file passed ten repetitions (120 passes), and native server,
embedded SDK, both builds and canonical workspace checks passed again. The final
full-core result after this extension passed: **6,674 passes, 43 skips, zero
failures** (6,717 tests across 264 files).

Session metadata updates now also register activity in the owned-session
implementation, so native facade and plugin-host callers cannot change inherited
annotations during a reservation. Waiting cancellation preserves the old value;
another session remains writable and no Location or model wake is acquired.
The owned-session file passed ten repetitions (370 passes), and canonical
workspace checks, native server (84 passes, one skip), embedded SDK (14 passes)
and both builds passed after this addition. Its complete core rerun passed:
**6,676 passes, 43 skips, zero failures** (6,719 tests across 264 files).

Authority sources extend beyond session-local activity:
`packages/core/src/config.ts` owns Location config discovery, filesystem watches
and global-file updates; `config/plugin/source.ts` additionally watches configured
plugin targets outside those config roots. `config/plugin/policy.ts` reacts to
both config entries and `ManagedPolicy.Service.changes()`, reloading catalogs
and evaluating current policy. `permission/saved.ts` mutates project-scoped
saved grants without a session ID. Therefore guarding only HTTP configuration
updates would not close this boundary. No policy reload is suspended by this
extension, and no reservation claims to freeze these sources. Managed-policy
and saved-grant mutations now invalidate reservations as described below;
configuration sources now fence observed reloads as described below; dynamic
plugin/registry activation and other unregistered sources remain uncovered. The native
authority contract must account for their changes without delaying revocations
or treating an unchanged config-file hash as effective permission equivalence.

Environment storage now has a private global store, a read-only
`SessionEnvironment.Service`, and a global `SessionEnvironment.Mutations` owner
for `set`/`clear`. Both the session facade and direct mutation callers use the
same native execution boundary; the facade retains its outer lease so session
existence is revalidated after waiting. Shell readers acquire no execution host.
Reads return independent snapshots and writes copy their input. Direct set/clear
tests prove unchanged state while reserved, cancellation, independent-session
updates and release without model execution. The generation/environment group
passed ten repetitions (170 passes) while a full suite ran; native server (84
passes, one skip), embedded SDK (14 passes), workspace checks and both builds
passed. A fresh full-core run for the final facade/read split passed:
**6,680 passes, 43 skips, zero failures** (6,723 tests across 264 files).
An earlier overlapping run used an intermediate facade/test combination and
timed out in two environment cases; it is not acceptance evidence.

`SessionExecution.withIdleExecution` now composes a process-global
`ReservationAuthority` guard inside the native coordinator reservation. Changed
managed policy and saved permission add/remove invalidate held guards without
waiting for their cleanup. New guards are refused while registered authority
mutations are in flight, including overlapping mutations; failure/interruption
releases that fence. The revision is process-local, not a durable grant. Unchanged
managed policy does not invalidate guards; failed/duplicate saved-grant writes
conservatively invalidate. Normal drains are not wrapped by this authority guard.

Cancellation retains the coordinator reservation until operation cleanup settles.
Even an uninterruptible operation finishing after invalidation cannot return a
stable success. This cannot undo an already-committed native effect: owner
journals, exact receipt reconciliation and quarantine remain mandatory before
movement can be supported. No mutation is automatically replayed here.

Nine authority cases passed ten repetitions (90 passes); the seven-file native
authority/execution/permission/config/MCP/reload group passed 254 tests before
the ninth case was added. Workspace checks passed (35 typecheck tasks, zero lint
errors), and sequential server (84 passes, one skip), embedded SDK (14 passes)
and core/server builds passed. An overlapping validation batch timed out in five
server and five SDK cases (plus two SDK between-test errors), and its core build
was terminated by the 120-second command timeout. No matching maintenance sleep
was observed in `pmset`; the host showed concurrent CPU/memory-heavy work.
The sequential reruns above passed without timeout changes. The full-core
authority-extension run passed: **6,689 passes, 43 skips, zero failures**
(6,732 tests across 265 files).

Native `Config` now uses a scoped pending-changes observer. Watch readiness and
updates mark authority dirty before broadcasting raw change events or queueing
the existing debounced reload. Reloads and global config writes register
authority mutations without waiting for reservation cleanup. A successful load
settles only the batch it observed; changes received during I/O remain fenced
for the next load. A failed load keeps its dirty fence. Config writes queue a
reload even when they fail, so uncertain filesystem effects must be observed
before fresh reservations are admitted. Observer disposal releases only its own
dirty count, and late marks from a disposed observer cannot reacquire it.

Real Config service tests with temporary files and controlled watcher delivery
prove cancellation before reload and refusal during the debounce gap for both
filesystem updates and `Config.update`. Pending-batch supersession and observer
disposal have separate tests. These four cases passed ten repetitions (40
passes); the initial config/reload/authority group passed 72 tests. Two existing native
command/generation fixtures initially failed because they assumed startup config
was settled. They now explicitly advance TestClock and probe with no effect
before testing the separate reservation boundary; all 160 repeated generation/
lifecycle cases passed. No native work is retried by that readiness probe.

Workspace checks, native server (84 passes, one skip), embedded SDK (14 passes)
and core build passed. The first complete run before fixture correction had
6,691 passes, 43 skips and two failures; it is not green acceptance. The complete
rerun with corrected readiness fixtures passed **6,693 tests, 43 skipped, zero
failures** (6,736 tests across 265 files).

Review then found that direct well-known/credential reloads bypass the watch
queue. Reload entry now also marks the observer dirty before loading, retaining
the fence if that direct load fails. A regression injects a well-known discovery
defect, observes the error after the transient mutation fence has released,
proves fresh guards remain refused, and proves a later successful reload admits
them again. The updated focused group passed 73 tests; the five new observer/
config cases passed ten repetitions (50 passes). The full-core follow-up passed
**6,694 tests, 43 skipped, zero failures** (6,737 tests across 265 files).
This fence concerns failed Effects: existing tolerant
parsing, unreadable-file handling and cached remote-config fallback are unchanged
and are not a destination-authority proof. This does not prove
plugin supervisor/catalog activation settlement, watch coverage of every
external authority source, or destination equivalence.

The native plugin registry now marks its scoped authority observer synchronously
when acquiring an existing readiness hold, including transform-failure callbacks
before their worker is queued. Nested holds settle only on the last idempotent
release. Activation teardown is covered by those holds; explicit registry close
and asynchronous failed-plugin cleanup additionally register authority mutations.
Readiness intentionally reopens before failed-plugin finalizers join (some
finalizers await readiness), but the independent authority fence remains held
through cleanup. Four registry regressions prove nested holds, replacement,
explicit close, and delayed cleanup after a late transform failure. The plugin/
failure/authority suites passed ten repetitions (430 passes); the native
generation/move/supervisor/failure group passed 52 tests. Complete native core
validation passed **6,698 tests, 43 skipped, zero failures** (6,741 tests across
265 files). Final canonical workspace checks passed all 35 typecheck tasks with
1,314 lint warnings and zero errors. Core/server builds, the native server suite
(84 passes, one skip) and embedded SDK suite (14 passes) also passed. Server
listener warnings remain visible. The patch passed pinned-base forward-index,
checkout reverse-application and whitespace checks.

This is registry-local coverage, not a complete dynamic authority proof:
configured-source watcher delivery, config-to-consumer handoff, module/catalog
loading and late direct domain-State registrations/reloads still require their
own admission/settlement coverage. Arbitrary plugin effects or detached native
processes are not made safe by a registry readiness hold.

Late native agent, command and tool State mutations now opt into a generic
State mutation lifecycle. State owns no execution host or authority service:
those three Location services supply their scoped observer and mutation guard.
Registration fences before publishing its transform, invalidation marks a
pending batch, and successful notification settles only its observed revision.
Deferred batch notifications remain fenced, failed reconciliation stays dirty,
and overlapping notification guards prevent a newer completion from admitting
reservations while older reconciliation still runs. Disposal uses the same
implementation whether explicit or scope-owned. Shutdown closes the State and
settles its dirty observer; enclosing registry cleanup retains its separate guard.

Nine actual agent/command/tool service regressions cover late registration,
reload and disposal outside plugin activation. Six generic State tests cover
reconciliation, batch deferral, failure recovery and overlapping notifications.
State/plugin/failure suites passed ten repetitions (750 passes). Canonical
workspace checks (35 typecheck tasks), core/server builds, native server (84
passes, one skip) and embedded SDK (14 passes) passed. Full-core validation for
this initial three-domain State integration passed **6,713 tests, 43 skipped,
zero failures** (6,756 tests across 265 files). Other native State domains,
resource reconciliation and source-to-consumer handoffs remain outside this
partial coverage; this does not satisfy destination authority or movement gates.

The same State lifecycle now covers eleven more registries: skill, instruction
discovery, formatter, image limits, tool-output limits, snapshot settings, shell
selection, location-watcher policy, compaction settings, websearch definitions
and worktree strategies. This is registration/reload/disposal coverage, not a
claim that every operation on those services is guarded. The 42 actual-service
cases now exercise all fourteen integrated registries outside plugin activation.

The expanded State/plugin/failure group passed 1,080 repeated tests. The first
complete run had 6,742 passes, 43 skips and four fixture failures: adding service
outputs to the shared plugin test composition shadowed existing local snapshot
and WebSocket transport overrides. The extra outputs now belong only to a
separate registry-test composition; original assertions and timeouts remain
unchanged. The affected snapshot/provider/HTTP-hook/plugin group then passed 950
repeated tests. Final sequential validation passed canonical workspace checks
(35 typecheck tasks), both builds, native server (84 passes, one skip), embedded
SDK (14 passes) and **6,746 core tests, 43 skipped, zero failures** (6,789 tests
across 265 files). Full logs are in the approved temporary directory as
`domain-{workspace,core-build,server-build,server-tests,sdk-tests,full-core}.log`.
The server listener warnings were retained, not suppressed.

At that checkpoint, provider/model/integration/reference/VCS/MCP State domains
remained unintegrated.
Their lazy input invalidation, asynchronous materialization and connection/
catalog updates need settlement coverage, not just an observer on notification
publication. Source-to-consumer handoffs, other non-State runtime mutations,
full destination authority and exact receiver continuity also remain unresolved.

Reference and VCS registries have subsequently joined the State lifecycle (six
additional actual-service registration/reload/disposal cases). Reference refresh
also registers an authority mutation around its complete cache-materialization
effect, including the hourly refresh path. Notification starts the background
fiber immediately, acquiring that guard before the State observer can settle;
callers still do not block on Git materialization. VCS keeps its State guard
through the existing owned reconciliation worker rather than merely through
event publication.

Two additional controlled-resource tests hold reference cache work and VCS
provider reconciliation open, prove a prior reservation is interrupted, refuse
fresh reservations after registry notification, and admit fresh guards only when
the owned work settles. The focused group passed 124 tests; the eight new cases
passed ten repetitions (80 passes). Final sequential validation passed all 35
workspace typecheck tasks, both builds, native server (84 passes, one skip), SDK
(14 passes) and **6,754 core tests, 43 skipped, zero failures** (6,797 tests across
265 files). Logs use the `reference-vcs-*` prefix in the approved temporary
directory. Existing server listener warnings remain visible.

This gives sixteen State registries mutation-lifetime coverage, not a reference
cache-integrity or destination-equivalence proof. Existing handled cache failures
still settle their operation; a fresh guard must observe actual state, never
treat that settlement as successful materialization or permission equivalence.
Direct RepositoryCache callers outside Reference, external cache/process changes,
non-registry VCS effects, provider/model/integration/MCP State domains and the
source/consumer handoff boundary remain uncovered.

Integration and provider registries now also opt into the State lifecycle,
bringing registry registration/reload/disposal coverage to eighteen domains.
The global native Credential service wraps create, activate, update and remove
with authority mutations before database work and through notification. This
conservatively invalidates even attempted no-op or label-only writes; ordinary
credential reads are unchanged. It does not delay revocation or wait for
reservation cleanup. Credentials and authentication headers are not added to
Turnlink telemetry, and installed credential storage is untouched.

Six additional registry tests exercise late integration/provider mutations.
Four real native Credential service tests use isolated synthetic credentials to
prove all write paths cancel a held reservation while allowing its interruption
cleanup to remain blocked. The focused group passed 123 tests; the ten new cases
passed ten repetitions (100 passes). Final sequential checks passed all 35
workspace typecheck tasks, both builds, server (84 passes, one skip), SDK (14
passes) and **6,764 core tests, 43 skipped, zero failures** (6,807 tests across
265 files). Logs use the `accounts-*` prefix in the approved temporary directory.
Server listener warnings remain present.

Provider availability/materialization and model lazy-input settlement are not
proved by registry notification alone. Model and MCP State lifecycles, downstream
credential/config consumer handoffs, runtime status/environment inputs and other
non-State effects remain uncovered. No credential, provider or process-local
revision becomes a movement grant or permission-equivalence proof.

The Model registry now participates too (nineteen State domains). Its lazy
provider-input observer is separate from its State-notification observer: a read
may settle the exact input revision it materialized, but cannot release a pending
registry batch. State's optional lazy-invalidation callback now separates that
owner from effectful registration/reload/disposal marking. Input revisions are
captured synchronously with the candidate; failed validation stays fenced until
a successful read. Unchanged cached reads neither advance authority nor cancel
held guards.

Model materialization also rechecks its State revision after asynchronous
provider validation. A controlled race demonstrated that the previous
provider-only check allowed an older read to overwrite a newer model transform.
Removing the new revision check made the regression fail with `older` instead
of `newer`; restoring it passed. Native Model tests with controlled provider
snapshots cover unchanged reads, held asynchronous validation, deferred batches,
superseded candidates and failed validation/recovery. Three actual-service tests
also cover late Model registration/reload/disposal. The focused group passed 125
tests; the filtered Model/State group passed 130 repeated cases.

Final sequential verification passed all 35 workspace typecheck tasks, both
builds, server (84 passes, one skip), SDK (14 passes), and **6,772 core tests, 43
skipped, zero failures** (6,815 tests across 266 files). Logs use the
`model-authority-*` prefix in the approved temporary directory; server listener
warnings remain visible. MCP remains the unintegrated State domain. Downstream
source/consumer handoffs, complete runtime overrides/resource changes,
destination authority and exact receiver continuity remain unproved; a stable
Model cache is not a movement grant.

MCP now participates in State registration/reload/disposal fencing, completing
that integration for the twenty current State registries. Direct add/connect/
disconnect/remove and session-expiry recovery register authority mutations.
Initial asynchronous connections, credential reconnects and SDK close/expiry/
tool/prompt/resource notifications acquire counted queued holds synchronously
before entering the owning FiberSet. A hold releases only when its own worker
and cleanup settle; newer completions cannot release older queued work.
Observers refuse holds after disposal, release only their own outstanding tokens,
and make late duplicate releases harmless. Existing per-server locks and
exact-client checks still drop obsolete callbacks.

Six native MCP registry/direct-operation cases, a held direct handshake/catalog
load, a held SDK tool-list callback and a held asynchronous startup test cover
the actual MCP service. The network cases use controlled loopback MCP servers,
not a paid model or an external endpoint. Two observer tests cover independent
queued counts, dirty-batch separation, idempotent release and scoped disposal.
The eleven new cases passed ten repetitions (110 passes); the MCP/authority/
State/Model/plugin-failure group passed 137 tests. An initial canonical check
rejected three test handlers inferred as `Promise<void>`; their unchanged runtime
behavior now returns explicit `undefined` to match the existing fixture contract.

Final sequential validation passed all 35 workspace typecheck tasks, both builds,
server (84 passes, one skip), SDK (14 passes), and **6,783 core tests, 43 skipped,
zero failures** (6,826 tests across 266 files). Logs use `mcp-authority-*` in the
approved temporary directory; the final workspace log is
`mcp-authority-final-workspace.log`. Server listener warnings remain present.

Twenty State integrations do not prove complete native exclusion. Downstream
source/consumer handoffs, Location/resource shutdown ordering, direct non-registry
MCP/tool effects and host-wide process/use safety remain separate boundaries.
MCP keeps its existing handled-failure and recovery semantics; settled work is
not successful rediscovery, a movement grant or permission-equivalence evidence.
Destination authority and exact conversation receiver continuity remain unproved.

Native config consumers now use a Location/workspace-filtered `Bus.listen`
handoff instead of waiting for volatile stream delivery to fence authority. The
listener marks a scoped authority observer before publication; dispatch queues
the coalesced reload only after the original event enters the native stream.
Publication never waits for downstream I/O or interrupted reservation cleanup.
The consumer keeps its independent fence through entries/discovery reads and
registry reload, including agent/command debounce. Successful work settles only
its observed revision; failed work remains dirty until a later successful reload
or scope disposal. Listener removal precedes worker shutdown, and cleanup retains
the fence until the worker settles. This is native reload coalescing, never replay
of a session/task effect.

This covers the twelve `ConfigEntryObserver` consumers plus agent, command,
instruction discovery, skill and MCP configuration consumers. Skill startup now
subscribes before its second config read and initial scan. Internal plugin
requirements explicitly share the host-global authority service; no second
execution host is created. Filesystem watcher admission, managed-policy and
credential downstream feeds, plugin source/catalog handoffs, other non-registry
effects and Location/resource shutdown still require separate coverage.

Seven new controlled regressions cover immediate publication fencing, exact
Location/workspace filtering and global events, failed reload recovery, coalesced
supersession, worker-cleanup disposal, the actual config-entry read gap and the
debounce gap. These and the existing startup-race test passed ten repetitions
(80 passes). Fixtures now use the actual native Bus rather than synthetic streams
that bypass listeners, and provide the same shared authority where needed.
Intermediate runs exposed those fixture wiring/location mismatches; the first
full run had 6,785 passes, 43 skips and four missing-service fixture failures, not
green acceptance. No assertions or timeouts were weakened.

Final sequential validation passed all 35 workspace typecheck tasks, core/server
builds, server (84 passes, one skip), SDK (14 passes) and **6,790 core tests, 43
skipped, zero failures** (6,833 tests across 267 files). Logs use `consumer-*` in
the approved temporary directory; final full-core and workspace logs are
`consumer-core-final.log` and `consumer-workspace-final.log`. Existing lint and
server listener warnings remain visible. No production movement gate is satisfied
by this config-publication handoff coverage.

The Integration/Credential → Provider and Provider → Model catalog consumers now
use the same handoff. Two controlled native-service tests block the very first
downstream snapshot read, before lazy input materialization can mark itself dirty.
Removing both handoffs reproduces two fresh-guard admission failures; restoring
them passes. This closes those catalog-notification gaps, not every downstream
credential-dependent provider plugin or native effect.

The first catalog full run passed 6,791 tests with 43 skips but failed the existing
catalog event-ordering test: dispatch from a pre-publication listener could let a
derived catalog event overtake the original credential event. Handoff marking now
stays pre-publication, while dispatch consumes the original volatile event. Weak
identity keys retain its exact revision without retaining abandoned publications;
an undelivered publication remains fenced. The existing ordering assertion and
timeouts are unchanged. The catalog/model/handoff/config-entry group then passed
410 repeated cases. One earlier workspace check also caught incomplete nested
Integration test stubs; the fixture contract was corrected before final checks.

Final sequential validation passed all 35 workspace typecheck tasks, both builds,
server (84 passes, one skip), SDK (14 passes), and **6,792 core tests, 43 skipped,
zero failures** (6,835 tests across 267 files). Final logs use
`catalog-consumer-ordered-{core,workspace}.log`, `catalog-consumer-repeated.log`
and `catalog-consumer-{core-build,server-build,server,sdk}.log` in the approved
temporary directory. Lint/server listener warnings remain unsuppressed. Complete
source discovery, Location/resource teardown and destination continuity are still
not established; production managed movement remains disabled.

`LocationServiceMap.reload` now fences the complete explicit invalidation and
replacement-acquisition wave with the host authority. The HTTP handler captures
that same host service at construction; application composition explicitly
exports it instead of leaving an authority requirement in request context.
Revocation does not wait for interrupted reservation cleanup, and all replacement
results settle before the reload returns its first failure.

A cancellation regression reproduced another gap in the first implementation:
RcMap owns boot fibers, so interrupting a borrower can leave an acquisition
running after the borrower's mutation guard releases. Reload now masks
interruption only while acquiring an already-started replacement context. A
cancelled reload retains its guard until those acquisitions settle, then returns
interrupted rather than successful. A hung acquisition therefore keeps the fence;
this does not promise bounded cancellation or force termination of native work.
Other independent authority mutations remain responsive.

Three core tests use real LayerMap resource scopes with held teardown, held
replacement acquisition/cancellation, and a failed replacement alongside another
pending build (30 repeated passes). One native HTTP test proves the handler shares
the host guard through a held replacement (10 repeated passes). The small resource
graphs in these tests are not full Instance graphs: they prove this explicit
reload/acquisition boundary, not complete Location disposal, detached failed-build
cleanup, held old borrowers or host-wide process safety.

Initial checks exposed test-layer typing and the HTTP authority context dependency;
both were corrected. The cancellation regression failed before acquisition masking
and passed afterward. Final sequential validation passed all 35 workspace
typecheck tasks, both builds, server (85 passes, one skip), SDK (14 passes) and
**6,795 core tests, 43 skipped, zero failures** (6,838 tests across 268 files).
Logs use `location-reload-*` in the approved temporary directory; the final
workspace log is `location-reload-workspace-green.log`. Existing lint and listener
warnings remain visible. Full resource-shutdown ordering, remaining source feeds,
destination authority and exact receiver continuity still prevent installation
acceptance and production movement.

Direct `LocationLifecycle.shutdown` now owns a scoped authority observer and a
mutation guard independently of explicit reload. It marks before setting the
closed flag, retains its fence through permission/form/RPC closure and shutdown
notification, and settles only on successful closure. A failed closure remains
fenced until that lifecycle's owning layer is disposed; a duplicate shutdown only
awaits the original attempt and cannot turn its failure into recovery. Successful
repeated shutdown remains an authority no-op.

Two native lifecycle tests with controlled dependency closure prove held-service
admission refusal, cancellation of an existing reservation, notification ordering,
duplicate-call behavior, failure retention and observer disposal (20 repeated
passes). They test the actual lifecycle service with small dependency fixtures,
not all asynchronous Instance/resource finalizers. In particular, observer
disposal is not evidence that every other service in the graph has torn down.
An initial typecheck rejected an incomplete RPC fixture; its unused generic client
method now explicitly refuses invocation. Assertions/timeouts were unchanged.

Final sequential validation passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,797 core tests, 43 skipped,
zero failures** (6,840 tests across 269 files). Logs use `lifecycle-*` in the
approved temporary directory, with final canonical checks in
`lifecycle-workspace-final.log`. Existing lint/listener warnings remain visible.
The remaining resource-finalizer/source-feed/destination/receiver gates are still
required; neither this lifecycle fence nor its passing tests enable installation
or production movement.

`Instance.layer` now owns an explicit child resource scope. Acquisition is fenced
before building the graph, failure closes that child scope before releasing the
startup guard, and the parent closes the child under its own authority guard.
The authority node is resolved with the same global implementation/replacements
and shared memo map as the Instance graph, rather than constructing a new host.
This extends coverage beyond the shutdown notification to scope-owned finalizers,
including late dependencies and failed-boot cleanup.

Two tests build the real Instance graph with discovery disabled and the models
feed offline. They hold late Environment disposal or Snapshot cleanup during an
injected boot failure, using the real LocationServiceMap rather than a small mock
resource graph. Removing both lifetime guards makes both tests admit a fresh
reservation while cleanup is blocked; restoring them passes. They passed twenty
repeated cases. Early test iterations corrected the Effect scope-finalizer API,
live/TestClock mismatch and an environment import; an initial red probe timed out
waiting for a reservation that had not been invalidated. The final red probe checks
fresh admission first and produces two direct assertion failures, not timeouts.

Final sequential validation passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,799 core tests, 43 skipped,
zero failures** (6,842 tests across 270 files). Logs use `instance-lifetime-*` in
the approved temporary directory; final core/workspace logs end in `-final.log`,
and the final repeated/red probes use `-late-resource-{repeated,red}.log`.
Existing lint/listener warnings remain visible. Scope ownership does not census
detached descendants, externally retained resources or borrowers retaining an old
graph, nor establish destination authority or exact receiver continuity. Those
remaining gates still prevent production movement and installation acceptance.

ManagedPolicy's native change stream now optionally registers a synchronous
marking callback. On a changed state, those callbacks run inside the publisher's
mutation fence before stream publication; unchanged state remains a no-op. The
callback has no downstream I/O, and its subscription scope removes it on disposal.
Ordinary stream consumers keep their existing change feed.

The configuration-policy catalog consumer and plugin supervisor use separate
scoped observers on that source. Their handoff fences survive publication,
delivery and debounce, settling only the revision observed by a successful reload
or activation. Failed catalog reloads keep their pending fence but can recover
on a later changed policy; failed policy-triggered plugin activation also cannot
clear its source fence merely by logging the failure and releasing readiness.
Policy writes and revocation still do not wait for downstream reloads or old
reservation cleanup.

Three tests cover pre-delivery marking/no-op/disposal, held catalog reload versus
old-owner cleanup, and failed-reload recovery (30 repeated passes). The policy/
supervisor/handoff group passed 24 tests, including real Instance supervisor
policy-revocation/restoration coverage. This is not separate adversarial proof of
every supervisor source or asynchronous package/update worker.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,802 core tests, 43 skipped,
zero failures** (6,845 tests across 271 files). Logs use `managed-handoff-*` in
the approved temporary directory. Existing lint/listener warnings remain visible.
Credential/well-known and filesystem/plugin-module source handoffs, retained-old-
graph/detached-resource use safety, full destination authority and exact receiver
continuity remain unproved. No production movement or installed-runtime change
is enabled by these observers.

Credential-switch and well-known-update inputs to native Config now use typed,
ordered authority observations. Each matching publication acquires an independent
pre-delivery hold; the observer validates the event once at native routing and
retains that typed value through its consumer. Work dispatches from the original
bus stream, preserving source-before-derived event ordering. This helper is for
native observation/reconciliation, never session/task-effect replay.

The credential consumer holds its fence even while asynchronously checking which
well-known sources use that integration. Relevant events perform the existing
reload; irrelevant events release only their own queued hold. A failed observation
also retains a dirty fence, and an unrelated/skipped event cannot clear it. Only
a later successful full reconciliation in that observer, or its owner disposal,
can clear that uncertainty. Failed relevance discovery is no longer interpreted
as proof that the credential is irrelevant. The separate Config reload observer
still protects failed loads and their own recovery.

A real Config regression blocks well-known relevance discovery for an unrelated
credential and proves fresh admission stays refused until the check settles,
without forcing a needless reload. Restoring the old credential subscription makes
that regression fail directly; restoring typed fencing passes. Three generic
tests cover exact Location filtering, independent queued holds, failed→irrelevant
events, successful reconciliation and interrupted worker cleanup/disposal. The
typed-event/Config group passed 540 repeated cases. An existing failure-logging
fixture now recognizes the shared consumer log and drains delivery holds before
asserting retained failure authority; its refusal/recovery assertions are unchanged.
Initial type checks corrected the generic consumer environment and schema Type
signature before final validation.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,806 core tests, 43 skipped,
zero failures** (6,849 tests across 272 files). Logs use `credential-config-*` in
the approved temporary directory. Existing lint/listener warnings remain visible.
This covers Config's credential/well-known handoffs, not every credential-driven
provider-plugin/MCP worker or periodic/external source. Remaining filesystem/module
feeds, retained-resource use safety, destination authority and exact receiver
continuity still prevent movement/installation acceptance.

Eight provider plugins now use the typed credential handoff for their awaited
refresh effects: OpenAI, ChatGPT, GitHub Copilot, GitLab, DigitalOcean, Modal,
Snowflake Cortex and OpenCode Console. The native helper preserves the integration
filter and creates the refresh effect anew for each relevant switch. Its hold
covers source delivery, connection discovery, existing semaphore wait and catalog
reload; unrelated switches never invoke the provider refresh. Failures retain the
typed observer's uncertainty instead of being cleared by an unrelated switch.
OpenAI and ChatGPT intentionally share the `openai` integration identity.

Eight actual-provider regressions hold connection discovery before any provider
reload can acquire its own State guard. With the old ordinary subscription,
all eight fail fresh-admission assertions; with typed handoffs restored they pass
eighty repeated cases. The broader provider group passed 293 tests across 29 files.
Connection discovery is controlled and returns no account, so these tests neither
read installed credentials nor call a remote catalog/model API. An initial
workspace check caught a heterogeneous test-effect union; the setup effect now
uses its exact derived service union before dependency provision. No assertions
or timeouts were weakened.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,814 core tests, 43 skipped,
zero failures** (6,857 tests across 273 files). Logs use `provider-credential-*`
in the approved temporary directory, with final canonical checks in
`provider-credential-workspace-final.log`. Existing lint/listener warnings remain
visible. Azure's dispatch/cancellation worker and Vertex's multi-event feed remain
separate boundaries. Initial/periodic provider refreshes, MCP reconnect workers,
filesystem/module inputs, retained-resource use safety and destination/receiver
continuity also remain required. Existing handled remote failures/cached inventory
are not successful rediscovery or destination-equivalence proof; production
movement and installed-runtime replacement remain disabled.

Vertex now uses a single coalescing, pre-publication-fenced observer for both
credential-updated and credential-switched snapshots. Its connection read and
settings comparison stay fenced even when no model/provider reload is necessary.
This remains a snapshot observation, not a replay of individual credential writes.

Azure's credential handoff now covers local rebind and discovery dispatch, while
an independent counted hold transfers to each actual discovery worker. Initial
dispatch acquires the same hold before queueing. Workers retain authority through
discovery and cleanup; unexpected non-interruption failures stay dirty until a
later successful worker reconciliation or owner disposal. FiberHandle still
interrupts the previous discovery on a switch, but a separate FiberSet owns all
workers, including displaced fibers, so plugin disposal joins their cleanup before
releasing the observer or dependent resources. Local rebind is awaited at startup;
discovery remains deferred and does not make Azure/CLI requests before setup
returns. Dispatch bookkeeping transfers ownership atomically, and a failed dispatch
releases only a hold that never transferred to a worker.

Two Vertex blocked-connection regressions fail with the old subscriptions and
pass with the observer. An Azure test holds initial discovery, displaces it with a
newer discovery, completes the newer worker and proves both authority and scope
closure remain pending through the older worker's cleanup. Removing the FiberSet
registration makes that disposal assertion fail. The tests use controlled
connection resolution rather than real account/CLI/cloud requests. The two-file
group passed 330 repeated cases. An intermediate change dispatched discovery too
eagerly and failed the existing no-Azure-calls-before-startup-return assertion;
deferred worker dispatch fixed the behavior without changing the assertion.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,817 core tests, 43 skipped,
zero failures** (6,860 tests across 273 files). Logs use `azure-vertex-*` in the
approved temporary directory. Existing lint/listener warnings remain visible.
All ten current provider credential feeds now participate, with Azure also owning
its startup/displaced discovery workers. This does not cover the other providers'
initial/periodic work, MCP credential workers, arbitrary external/cache/filesystem/
module changes or retained-old-graph/detached-process use. Cached remote failure
handling is unchanged and is not destination-authority or successful rediscovery
evidence. Destination/receiver and production-adapter acceptance remain required;
movement and installed-runtime replacement stay disabled.

The credential providers' remaining startup/periodic paths now use a scoped native
refresh owner. Copilot, GitLab, DigitalOcean and Modal acquire a counted hold before
initial dispatch. Each actual refresh owns its own guard through semaphore wait,
discovery, reload and cleanup; DigitalOcean's five-minute sleep does not retain
authority. Console's one-minute checks and response-triggered checks use the same
guard as credential refreshes. Closed owners refuse direct and queued work, and
failed work remains dirty until a successful reconciliation or owner disposal.
These are native snapshot operations, never task/model replay.

Review found that Console records `snapshot` before completing its projection.
An unchanged later read therefore cannot prove recovery from a partial apply.
Console now records completion separately, and the refresh owner accepts a
non-reconciled observation without clearing uncertainty. A failed apply followed
by the same snapshot neither clears its fence nor automatically repeats apply;
the existing credential-triggered full apply can recover it when it succeeds.

Nine tests cover the four actual startup paths, active DigitalOcean/Console polls,
admission during periodic sleep, pre-dispatch ownership, failure retention,
post-disposal refusal and Console partial-apply recovery. Removing the native
refresh guards gives eight direct failures; ignoring Console's apply-completion
state separately makes the partial-projection regression fail. Restored code
passed 90 repeated cases. The provider group passed 305 tests across 30 files.
All discovery is controlled and returns no remote account. A test's unbranded
Provider ID was corrected to the canonical schema value before final checks;
assertions/timeouts were not weakened.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,826 core tests, 43 skipped,
zero failures** (6,869 tests across 274 files). Logs use `provider-background-*`
in the approved temporary directory; final core/workspace/group/repeated logs
end in `-final.log`. Existing lint/listener warnings remain visible. This covers
the explicit paths listed above, not local-provider polling/config subscriptions,
arbitrary external/cache changes or successful remote inventory rediscovery.
Local-provider feeds, MCP handoff workers, filesystem/module
inputs, retained-resource/old-graph/detached-process use safety, full destination
authority and exact receiver/production-adapter acceptance remain required.
Production movement and installed-runtime replacement remain disabled.

The shared local-provider factory (Ollama/LM Studio) now uses counted startup and
per-poll observation guards, and a native config-publication fence through its
entry read and reconfiguration. An asynchronous post-subscription notification
closes the initial-read/subscription race without making setup await discovery.
Periodic sleep remains unfenced. The refresh owner can suppress the same expected
poll errors as before only after marking uncertainty; skipped observations cannot
clear it.

Local discovery cache entries now distinguish successful materialization from an
in-flight/failed request retaining older models. A new owner may preserve that
inventory for existing availability behavior, but marks its own uncertainty until
a fresh successful observation. Config no-ops cannot clear that uncertainty.
Model-hash equality also requires a completed catalog application; a failed
partial projection is neither recovered nor automatically replayed just because
the next inventory hash matches. Cache timing uses the caller's Clock and rejects
future-dated entries rather than treating another clock domain as a fresh result.

An initial implementation fenced absent, unconfigured default probes permanently
and failed real Instance/generation readiness tests. The corrected boundary
preserves empty optional-probe absence when no models have been published or
cached. Explicit origins/authored provider settings and previously available
inventory remain fail-closed. Explicitness is derived from actual authored
settings, not the folded empty object an unrelated config document can produce;
switching to an explicit request at the same endpoint revalidates that mode.
This is not proof that an absent optional remote server was rediscovered.

Six tests cover startup/polling versus sleep, config entry reads, startup re-read,
shared failed-cache ownership, optional→explicit mode, and matching-hash partial
projection. Restoring unguarded/subscription/cache shortcuts produced six direct
failures; the final, type-correct partial-projection case separately fails when
the completion check is removed. Restored code passed sixty repeated cases.
The provider/Instance/generation group passed 329 tests across 33 files. Earlier
fixtures were corrected to inspect provider snapshot records and use a native
defect (not an impossible typed reload error); assertions/timeouts were preserved.

Final sequential checks passed all 35 workspace typecheck tasks, both builds,
server (85 passes, one skip), SDK (14 passes), and **6,832 core tests, 43 skipped,
zero failures** (6,875 tests across 275 files). Logs use `local-provider-*` in
the approved temporary directory. Existing lint/listener warnings remain visible.
This covers factory-owned discovery and registered config notifications, not all
external/cache mutation sources. MCP handoffs, filesystem/module feeds, retained-
old-graph/detached-process use safety, full destination authority, receiver
continuity and production-adapter acceptance still remain required. No installed
runtime or production movement flags changed.

MCP credential-switch handoffs now acquire a counted hold before source bus
publication and retain it through the exact stream-dispatched reconnect worker
and cleanup. Producers only mark; credential publication does not await reconnect
I/O. Workers remain independently dispatched, serialized only by existing server
and endpoint locks. Disabled, unowned and other-Location observations are ignored.
Registration identity is exposed only after its observer has been acquired.

Each OAuth registration owns a separate reconciliation observer, disposed with
that registration. A replaced entry cannot be reconnected by an old event. The
worker reads its revision under the server lock and marks failure before releasing
that lock, so a queued subsequent reconciliation sees the failure revision.
Another registration's success cannot clear it. A handled connection failure that
fully projects a known unavailable status retains existing behavior; this does
not claim that the server is healthy or its credentials are equivalent.
Cancelled publication before stream delivery stays fenced until owner disposal,
even though its event is retained only weakly. Existing worker-set cleanup and
counted queued holds remain responsible for active-worker exclusion.

Four loopback tests cover pre-delivery and active-worker exclusion, independent
reconnects with one worker still blocked, per-registration failure/recovery, and
cancelled publication/owner disposal. Unowned and wrong-Location notifications do
not poison idle authority. The pre-publication test fails directly when the
listener is bypassed. An initial version marked failure outside the server lock
and timed out in the recovery test; moving marking inside the lock and reading
the revision on lock acquisition corrected it. A two-server fixture assertion was
also narrowed to the intended server after correctly discovering two echo tools.
Restored final code passed **40 repeated cases** without changing timeouts.

Final sequential checks passed **6,836 core tests, 43 skipped, zero failures**
(6,879 tests across 275 files), all 35 workspace check tasks, both builds, server
(85 passes, one skip), and SDK (14 passes). Logs are `mcp-handoff-*` under the
approved temporary directory, with final verification ending in `-final3.log`.
Existing lint and listener warnings remain visible. No public Protocol/HttpApi,
installed runtime, global configuration or production movement flags changed.

This milestone covers registered MCP credential source-to-worker handoffs, not
all MCP callback failure paths, externally retained connections or arbitrary
external inputs. The next source audit includes `models-dev.ts` periodic cache
refresh, filesystem watchers, plugin-module/cache discovery and workspace polling.
Retained-old-graph/detached-resource use safety, complete destination authority,
exact receiver continuity and production-adapter acceptance remain required.

The models.dev source now fences lazy catalog population and each active refresh,
with a counted initial-dispatch hold that does not persist through periodic sleep.
Cached `get()` calls do not start a new mutation or settle an earlier incomplete
refresh. Catalog application is marked before cache write/invalidation and remains
pending through source publication. A failed best-effort cache write still allows
the existing catalog/fallback behavior, but no longer claims successful source
reconciliation. Fresh-cache and byte-identical digest skips cannot clear that
pending state or silently replay an incomplete projection; the existing explicit
`refresh(true)` path can perform a complete new reconciliation.

Fetch/parse failures before application retain the known offline catalog and do
not create a new permanent uncertainty marker. This is preservation of a known
view, not fresh remote discovery or destination authority. Cache timestamps and
freshness checks use the caller's Clock; future-dated entries do not count as
fresh in that clock domain. Source notifications are explicitly global: a manual
refresh called with an ambient Location still changes the process-global catalog
and must notify all Locations, not just its caller.

The models.dev plugin now uses the native pre-publication consumer fence through
its snapshot read and full Integration/Provider projection. Its startup re-read
is preserved, and snapshot assignment is deferred into the guarded effect rather
than performed while constructing it. The memory benchmark's manually assembled
plugin graph and matching test graph explicitly expose the authority dependency;
an initial typecheck identified that missing benchmark dependency.

Six tests cover lazy population/cached reads, incomplete publication and skipped
polls, best-effort write failure, pre-application offline failure, polling versus
sleep, and the Location consumer handoff. Active-guard removal produces two
direct failures; removing the incomplete-application marker produces two more;
restoring the unguarded plugin subscription and removing the global source flag
each produce a direct failure. The active-poll assertion was moved before joining
the invalidated guard so its red probe fails directly rather than timing out.
Final restored tests passed **60 repeated cases**. Final core passed **6,842 tests,
43 skipped, zero failures** (6,885 tests across 275 files); all 35 workspace tasks,
both builds, server (85 passes/one skip), and SDK (14 passes) also passed. Logs use
`models-source-*` in the approved temporary directory; final core/workspace logs
end in `-final2.log`, repeated cases in `-repeated-final.log`. No timeouts were
increased or warnings suppressed.

This covers source-owned models.dev reads, refresh/application and registered
consumer notifications, not arbitrary external KV/file/module mutation or complete
instruction/config discovery. Filesystem and plugin-module/cache feeds, workspace
polling, retained-old-graph/detached-resource use safety, full destination authority,
exact receiver continuity and production-adapter acceptance remain required.
Installed runtimes, global configuration and production movement flags remain
unchanged; this milestone is not installation or movement acceptance.

The internal filesystem Watcher now supports an opt-in synchronous observer after
stream/listener registration and before native updates are queued. Hooks belong
to individual consumed streams, not just callback identities or shared backend
watches: closing one stream removes only its own wrapper. No authority dependency
was added to Watcher itself; only explicitly integrated native consumers mark
their own observations. Readiness still runs after registration, and a notification
published from readiness is observed before queueing. Unavailable/disabled watches
retain their existing behavior.

Instruction discovery's ancestor/global and configured-file watches opt in to
that hook. They mark before native publication into the Watcher queue, retain
the pending revision across the existing 100 ms debounce, and settle only after
rescan plus discovery reload. The rescan/reload iteration is guarded separately
from config-event reconciliation, so config reloads cannot settle a pending file
observation. Other consumers and unread external writes are not covered by this
integration. Hook registration is not proof that native acquisition, filesystem
discovery or unwatched paths have no gaps; initial/reconfigured discovery and its
resource scopes still need their existing fencing and the broader source audit.

One new watcher lifecycle case proves shared-backend/shared-callback isolation;
the existing readiness case now proves pre-queue notification as well. Two new
instruction cases cover discovered and explicitly configured files with an
immediate post-notification guard check and a deliberately blocked discovery
reload. All four cases fail directly when native observer invocation is removed,
and restored code passed **40 repeated cases**. These use production subscription
lifecycle with controlled native callbacks and real temporary instruction files,
not a claim of exhaustive OS backend or external filesystem equivalence.

Final sequential validation passed **6,845 core tests, 43 skipped, zero failures**
(6,888 tests across 275 files), all 35 workspace tasks, both builds, server
(85 passes/one skip), and SDK (14 passes). Logs use `instruction-watch-*` under
the approved temporary directory. Existing warnings remain unsuppressed; public
Protocol/HttpApi, installed runtimes, global settings and production movement
flags are unchanged. Skill/config/plugin-module watcher consumers, external cache
mutations, workspace polling, retained-resource use safety, complete destination
authority and exact receiver/production-adapter acceptance remain required.

Skill discovery now opts its shared `watch()` path into pre-queue observation:
directory, file/alias and missing-ancestor registrations all acquire the same
source-owned pending marker on notification. The file-rescan worker captures a
revision before refresh and retains it through watch replacement, catalog reload
and completion. Config-event reconciliation uses its separate existing fence;
it does not settle this file-observation marker. The native mutation guard covers
the active iteration, while the pending marker covers debounce and inter-pass
gaps. Tolerant skill parsing/scanning behavior is unchanged and is not evidence of
permission equivalence or complete external source discovery.

The config service's watched targets also mark at native pre-queue delivery,
using the existing pending-authority observer rather than waiting until stream
consumption. Readiness rescans, watch reconciliation, source loading, serialized
reloads and config publication retain their existing behavior. This is config's
own subscribed source-to-reload fence, not a claim that arbitrary `config.changes`
consumers or plugin modules have already reconciled.

Two skill regressions cover directory-derived and explicitly configured sources,
including a second notification after watches are recreated but while the first
downstream reload is blocked. A test dependency forwards the real mutation guard
then pauses its continuation after release, proving that the first completed
mutation cannot clear the newer pending revision in the inter-pass gap. Removing
the skill native hook causes two direct failures; settling the latest revision
instead of the captured one causes two more.

The config regression initially passed with its native hook removed because
stream consumption could acquire the old fence before the assertion. Its final
fixture holds delivery between the real Watcher and Config consumer, so removing
the hook now fails the intended pre-consumption assertion directly. A temporary
fixture used an unavailable `Layer.map` helper and was corrected to a scoped
`Layer.effect` wrapper; that setup failure is not counted as a red probe. No
timeouts/assertions were relaxed. Restored final cases passed **30 repeats**.

Full core passed **6,848 tests, 43 skipped, zero failures** (6,891 tests across
275 files), with all 35 workspace tasks passing after fixture strengthening.
Both builds, server (85 passes/one skip) and SDK (14 passes) also passed on the
unchanged production code before that test-only refinement. Logs use
`skill-config-watch-*` in the approved temporary directory; final core/workspace,
repeated cases and corrected config red probe end in `-final2.log`.

These are registered-source fences, not native watch acquisition/replacement
completeness, arbitrary external file/cache integrity, or module unload/use safety.
Plugin-source/config-change/module consumers, workspace polling, retained-old-
graph/detached-resource use safety, complete destination authority and exact
receiver/production-adapter acceptance remain required. Installed runtimes, global
settings and production movement flags remain unchanged.

Direct configured-plugin and module-dependency watcher feeds now support scoped
synchronous observers. The supervisor registers a separate source observer before
initial activation, so notifications mark authority before queueing and retain
that fence through source scan, module resolution and activation. Observers are
registered per consumed change stream and removed with that stream, including
independent wrappers when the same callback is shared. The config-plugin-source
interface explicitly limits its synchronous hook to direct configured-target
watches: its upstream `config.changes()` branch remains an asynchronous input
requiring further work, not a source-completeness proof.

The supervisor captures the source revision before activation and settles only
when resolution finishes without failures or pending modules. Reported import
failure can preserve the previous generation for existing availability without
falsely reconciling the new source. Managed-policy observation remains separate;
revocation behavior and the existing old-generation retention policy are not
replaced. This is module-resolution completion, not proof of arbitrary plugin
setup/unload/resource safety or permission equivalence.

Three existing real-Location reload regressions now check native notification
before stream dispatch, actual activation completion, refusal after a failed
helper import retaining the old RPC registration, and recovery on a later valid
save. They include a helper outside the configured plugin root. The fixture now
injects and exposes the same authority service across its test Location graphs;
initial tests identified that the Instance's internal dependency was not exported
to the test caller. A separate configured-source lifecycle test proves immediate
observation and independent stream disposal without loading module watches.

The first configured-hook removal probe passed because module recovery watches
overlapped the configured directory. It is not counted as negative evidence;
the isolated source test fails directly when that hook is removed. Removing the
module hook separately fails the outside-root dependency case, and treating
retained import failures as complete fails all three Location cases after
`awaitActivation` has finished. Restored code passed **40 repeated cases**.

Final sequential validation passed **6,849 core tests, 43 skipped, zero failures**
(6,892 tests across 276 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `plugin-watch-*` under the
approved temporary directory; final check logs end in `-final.log`, and the
isolated configured-hook probe is `-configured-red-final.log`. Existing warnings
remain visible. Public Protocol/HttpApi, installed runtimes, global settings and
production movement flags are unchanged.

Upstream config-change relevance/handoffs, package-update/cache/periodic sources,
watch acquisition/discovery completeness, workspace polling, retained-old-graph
and detached-resource use safety, complete destination authority and exact
receiver/production-adapter acceptance remain required. This milestone neither
enables production movement nor completes the Goal.

`Config.changes()` now accepts an optional synchronous raw-update observer,
registered independently per consumed stream. Both the production native-watch
path and in-memory test path invoke it before publishing the update to the
stream. Existing subscribers without a callback retain their original behavior;
the public Protocol/HttpApi is unchanged.

The config-plugin-source consumer uses that hook to acquire one counted hold per
raw notification before its asynchronous config-entry relevance read. Relevant
updates synchronously mark the supervisor's source observer before releasing the
input hold and emitting the derived source change. Irrelevant updates release
only their own hold; they neither trigger activation nor settle another pending
observation. A failed relevance read marks source uncertainty before releasing
its hold. The existing failed stream is not silently restarted; its uncertainty
remains until owner disposal, rather than being cleared by an unrelated update.

The per-event weak map contains a FIFO of holds, not a single token: native/test
delivery can reuse an update object, including overlapping subscriptions, and
each delivery must release its own count. Callback registration also wraps shared
callbacks independently so disposing one consumed stream cannot detach another.
This completes the plugin source's registered config-change relevance handoff,
not every consumer of Config's raw change feed.

Two new cases test raw-observer scope isolation and blocked relevance, duplicate
object delivery, handoff, irrelevant skips, successful counted release and failed
relevance. The real Config watcher regression now asserts raw observation while
its stream consumer is deliberately blocked. Initial test emission preceded
subscription readiness and was corrected with the fixture's bounded stream drain,
not a production delay or timeout increase. Separate input-hold, transfer,
failure-marker, native-forwarding and duplicate-token probes each fail directly.
Together with the configured-source lifecycle case, restored tests passed
**40 repeated cases**.

Final sequential validation passed **6,851 core tests, 43 skipped, zero failures**
(6,894 tests across 276 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `config-source-handoff-*`
under the approved temporary directory, with final verification in `-final.log`.
Existing warnings remain visible. Installed runtimes, global settings and
production movement flags are unchanged.

The raw config-feed audit still finds agent, command and compatibility consumers
without pre-queue relevance fencing. Package-update/cache/periodic sources,
native acquisition/discovery completeness, workspace polling, retained-old-graph
and detached-resource use safety, complete destination authority and exact
receiver/production-adapter acceptance remain required. No full Goal completion
or movement acceptance is claimed.

The four known raw config-feed consumers now share `Config.observeSource`, which
owns the counted pre-queue input hold, asynchronous relevance/completion boundary,
per-delivery FIFO tokens and sticky failure marker. The plugin-source branch uses
the helper instead of maintaining a second copy. Agent and command sources
transfer relevant observations to their existing fenced/debounced reload notifier;
unrelated paths still skip without clearing other pending work. Compatibility
keeps its existing rescan-on-any-raw-change behavior, guarded through the full
rescan and downstream skill reload.

Compatibility's direct directory watches also mark before queueing and retain a
separate captured revision through debounce, watch replacement and skill reload.
The raw-input helper cannot settle that direct-watch observer. This covers the
current registered agent/command/compatibility/plugin-source branches, not an
exhaustive external-input or configuration-discovery census.

Three new raw-feed tests block relevance reads and downstream reloads and preserve
the existing relevant/irrelevant behavior. The skill-watch inter-pass test now
also covers compatibility: after the real first mutation guard ends, the newer
notification still refuses admission. Removing the direct hook or settling the
latest instead of the captured revision causes separate direct failures.

The initial shared-hold removal probe failed agent/command but was masked for
compatibility by its early reload guard. A test-only delivery gate before raw
consumption now makes all three fail the intended pre-queue assertion. The
fixture's missing Global dependency and a heterogeneous Effect-union type error
were corrected by explicit test service provision and generator branches; neither
setup failure is counted as a guard probe. Restored tests plus the shared helper's
existing lifecycle/relevance/failure cases passed **60 repeats**.

Full core passed **6,855 tests, 43 skipped, zero failures** (6,898 tests across
276 files), and all 35 workspace tasks passed after the delivery-gate refinement.
Both builds, server (85 passes/one skip) and SDK (14 passes) passed on unchanged
production code before that test-only refinement. Logs use `raw-config-consumers-*`
under the approved temporary directory: final core is `-core-final2.log`, workspace
`-workspace-final3.log`, repeats `-repeated-final2.log`, and the final hold probe
`-hold-red-final.log`. No timeouts were increased or existing warnings suppressed.

Package-update/cache/periodic feeds, native acquisition/discovery completeness,
workspace polling, retained-old-graph and detached-resource use safety, complete
destination authority and exact receiver/production-adapter acceptance remain
required. Installed runtimes, public Protocol/HttpApi, global settings and
production movement flags are unchanged. This is not full Goal completion.

The registered package-update service now guards update operations through target
locking, installation, status publication and cleanup. Each target owns a process-
local, owner-scoped uncertainty marker: failed/interrupted installs remain fenced, and
metadata reads or a different target's successful update cannot clear them. Only
an explicit successful update of that target, or owner disposal, clears its
marker. No retry or installer action is introduced automatically. Cached metadata
reads remain non-mutating; status projection is guarded and observers run before
stream publication, with independent callback lifetimes per consumed stream.

The supervisor pre-observes relevant package status events and separately owns
its asynchronous update-check/metadata-apply workers. A counted hold is acquired
before dispatch and retained through that worker's full work and cleanup,
including displaced workers. Failed background work stays uncertain until owner
disposal; skipped/later workers cannot silently clear it. Periodic sleep does not
hold this authority. This covers the registered service and supervisor workers,
not arbitrary npm/cache access or complete plugin/resource use safety.

Four service tests cover publication-before-delivery, independent stream disposal,
cached-read admission, failed installs versus checks/other-target success,
independent workers and cleanup, and interrupted install recovery only through an
explicit request. A real Location test first proves stable admission, advances
the caller's TestClock to the 24-hour scheduled activation, then blocks its
package check after registry activation completes. Removing worker dispatch and
iteration fences fails that final assertion directly. Initial boot-only probes
were masked by unrelated startup work and are not counted as negative evidence.
The fixture disables optional builtins through supported config and supplies a
self-resolving package manifest; the original missing package entrypoint was a
fixture error, not runtime acceptance or a guard probe.

Removing install fences produces three direct failures; removing publication
observers produces another. The final scheduled-worker removal probe also fails
directly. Restored code passed **50 repeated cases**. Final sequential checks
passed **6,860 core tests, 43 skipped, zero failures** (6,903 tests across 277
files), all 35 workspace tasks, both builds, server (85 passes/one skip) and SDK
(14 passes). Logs use `package-update-*` in the approved temporary directory;
the accepted worker probe is `-worker-periodic-red.log`. Existing warnings remain
visible and timeouts were not increased.

No real package install/update was run: installer/check behavior is deterministic
fixture work, with a synthetic package loaded in the real Location graph. Public
Protocol/HttpApi, installed runtimes, global settings and production movement
flags remain unchanged. Other periodic/external-cache sources, workspace polling,
native acquisition/discovery completeness, detached/retained-resource safety,
complete destination authority and exact receiver/production-adapter acceptance
remain required. This milestone does not complete the Goal.

Workspace idle polling now owns a counted initial dispatch and guards each active
iteration, including queued lock/read work and provider suspension/cleanup. The
interval sleep does not hold authority. Eligible connections acquire independent
owner-scoped observation scopes before suspension; successful suspension and
registered connection cleanup settle and retire them. A failed or partial
transition remains fenced, and neither a no-op poll nor another connection's
success can settle it. Healthy retired observers detach their scopes instead of
accumulating one root finalizer per idle cycle.

The workspace driver contract guarantees idempotent creation, but does not promise
idempotent `suspendForIdle`. Failed idle transitions are therefore quarantined
instead of replayed by the next timer tick. New borrows and provision attempts
for the affected ID are refused, including after logical row recreation. Explicit
destruction is guarded and can retire an observation only after it closes the
same registered connection, destroys its provider resource and deletes the row.
If idle cleanup already failed after detaching the connection, later row/provider
destruction does not claim that the old cleanup completed; its observation stays
pending until owner disposal. This quarantine is process-local, not a durable
broker journal or proof about detached resources surviving that owner.

Three new cases cover sleep admission and iteration invalidation, blocked provider
suspension and connection cleanup, partial binding writes, unrelated workspace
success, no blind replay, refused borrows, explicit same-connection destruction,
failed detached cleanup and refused reprovision under a recreated logical row.
They use deterministic memory drivers and in-memory DB state, not real provider
resource creation/destruction. Iteration removal fails directly, failure-marker
removal fails two cases, and replay/borrow/reprovision bypass probes fail
separately. Restored code passed **30 repeated cases**.

Final sequential validation passed **6,863 core tests, 43 skipped, zero failures**
(6,906 tests across 277 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-idle-*` in the
approved temporary directory; final verification ends in `-final.log`. Existing
warnings remain visible, with no timeout increases. Public Protocol/HttpApi,
installed runtimes, global settings and production movement flags are unchanged.

General workspace shared-provision/cancellation/borrow ownership still needs its
own audit beyond this idle-transition quarantine. Other external-cache/periodic
sources, native acquisition/discovery completeness, retained-old-graph and
detached-resource safety, durable destination/owner authority, exact receiver
continuity and production-adapter acceptance remain required. Scope settlement
here is not a durable movement grant, capacity-reclamation proof or full Goal
completion.

Shared workspace provisioning now acquires a counted worker hold before dispatch,
independent of its callers' waiters, and retains it through lookup, create,
binding persistence and race/cleanup settlement. Interrupting a waiter does not
release the service-owned worker or allow a new reservation while it continues.
Closed owners refuse provisioning before driver lookup or worker registration.

Actual create attempts own separate per-ID uncertainty scopes. Failed attempts
stay pending across other IDs' success and cached binding reads. The existing
same-ID retry behavior is preserved under the driver's explicit idempotent-create
contract; only successful create/persistence, completed explicit driver cleanup,
or owner disposal retires the observation. A cached row is not new completion
evidence and does not force another physical create to clear uncertainty.

Review found that null binding plus a missing provider could otherwise delete a
failed-attempt row and retire its uncertainty without invoking cleanup. Missing
providers now fail destruction when this owner has observed such an attempt,
even without a saved binding. The legacy null-binding shortcut for rows without
an observed attempt remains; absence of an in-memory observation is explicitly
not proof of resource absence after restart. Durable provisioning intent and
cross-process cleanup evidence remain unproven.

Four new cases cover cancelled callers while provider lookup is blocked, cached
receipts, missing-provider cleanup and closed-owner refusal. Three existing shared
attempt tests now cover waiter interruption, destroy waiting for create cleanup,
and same-ID retry without another ID's success clearing the failure. Receipt
insertion is a deterministic DB fault fixture, not an end-to-end crash-recovery
claim. The queued-worker removal probe fails directly; removing failed-attempt
marking fails two cases; cached-receipt and missing-provider shortcuts each fail
separately. Restored code passed **70 repeated cases**.

Final sequential checks passed **6,867 core tests, 43 skipped, zero failures**
(6,910 tests across 277 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-provision-*` under
the approved temporary directory; final core/workspace logs end in `-final2.log`
and repeats in `-repeated-final.log`. Existing warnings remain visible; no
timeouts were increased. No real provider resources, installed runtimes, global
settings, public Protocol/HttpApi or production movement flags changed.

Borrow/child-process lifetime ownership, retained-facade use after owner closure,
other periodic/cache sources, acquisition/discovery completeness, durable intent
and cleanup journals, detached-resource census, complete destination authority
and exact receiver/production-adapter acceptance remain required. This milestone
is process-local shared-attempt fencing, not full resource or movement acceptance.

Workspace file and spawn borrows now use explicit retained leases in the same
process-local authority instance. Unlike scoped queue observations, these leases
are not released merely because a producer/borrower scope is disposed; only their
explicit idempotent release changes that count. Each borrow owns a worker and a
separate resource scope. Cancellation interrupts and joins that worker before
resource cleanup; successful spawn acquisition keeps the lease until its caller
scope closes the process resources. The Workspace owner may close while already
accepted work remains fenced, without erasing its independently owned count.

Cleanup is memoized, including failure, across cancellation and caller-scope
disposal. Scope closure must complete before release. A later close of an already
closed resource scope cannot replace the first failed cleanup result with success
and drop the lease. Failed cleanup therefore remains fenced in that authority
instance; no automatic retry, force-clear or recovery permission is introduced.
Closed Workspace owners refuse new connections, cached connection admission and
retained-facade operations, while existing accepted borrows retain their own
lifetime. Existing file/spawn error translation is preserved; no conversation,
model, tool or permission configuration is rewritten by this change.

One authority primitive test covers unrelated scope disposal, independent counts
and idempotent explicit release. Four memory-driver/process-handle cases cover
file I/O surviving owner retirement, rejected stale facades, process-resource
lifetime through blocked cleanup, cancellation during cleanup and failed cleanup
remaining fenced after repeated caller close and Workspace disposal. No real
processes or provider resources are launched. Lease removal fails four cases;
early release fails two; bypassing cleanup memoization and stale-owner admission
checks each fails a separate case. Restored code passed **50 repeated cases**.

Final sequential validation passed **6,872 core tests, 43 skipped, zero failures**
(6,915 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-borrow-*` in the
approved temporary directory, with final verification ending in `-final.log`.
Existing warnings remain visible; no timeouts were increased. Public
Protocol/HttpApi, installed runtimes, global settings and production movement
flags are unchanged.

Retained leases are refusal evidence within one authority instance, not durable
ownership, restart recovery, named reconciliation receipts or a census of detached,
unref'ed or externally retained handles. Other service facades, native physical
I/O/cleanup behavior, durable provisioning/cleanup journals, acquisition/discovery
completeness, other periodic/cache inputs, complete destination authority and exact
receiver/production-adapter acceptance remain required. Declared resource-scope
settlement is not proof that all descendants stopped or that movement is safe.

Config's ten-minute well-known refresh loop now guards the eligible iteration
from `refresh()` through its existing unchanged/error fallback reload, including
I/O waiting and cleanup. The guard starts only after the nonempty-source check;
neither interval sleep nor a no-source tick retains it. Changed refreshes still
hand off to the existing pre-publication well-known-event consumer fence. The
existing fetch-error logging/fallback behavior is preserved, not converted into
a task/model replay or a new recovery grant.

Three real-Config/TestClock cases cover no sources, a successful unchanged refresh
and a caught fetch failure. They block the source call, assert refusal while it is
active, then prove reload completion and admission during sleep. The source
dependency is controlled: the fetch-failure fixture has no partial cache write,
and these cases are not source-store or HTTP transaction acceptance. Removing
the iteration guard fails both eligible cases; moving the guard around the whole
sleeping loop instead fails all three bounded readiness checks. Restored cases
passed **30 repeats** without increasing timeouts.

Final sequential validation passed **6,875 core tests, 43 skipped, zero failures**
(6,918 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `config-periodic-*` under the
approved temporary directory, with final verification in `-final.log`. Existing
warnings remain unsuppressed. Public Protocol/HttpApi, installed runtimes, global
settings and production movement flags are unchanged.

The WellKnown service's own cache/manifest mutations and late resolution against
retired source entries remain separate audit work: fencing this caller's active
iteration is not cache-integrity, source-generation or partial-apply recovery
proof. Other external/periodic inputs, durable refusal/recovery evidence, native
physical cleanup and detached-resource census, full destination authority and
exact receiver/production-adapter acceptance remain required.

WellKnown service operations now share the process-global reservation authority.
Active source loads, membership changes, refreshes and resolution own counted
mutation holds, including lock waits. Cold manifest loads perform I/O outside the
membership lock, but revalidate a captured source generation under that lock
before persisting a manifest or replacing the entry snapshot. Membership changes
and changed refresh publication advance that generation. Config resolution checks
the exact current entry before fetching and again under the lock before caching;
a response for a retired entry cannot resurrect its cache, including after the
same origin is re-added. Rejected results fail rather than automatically retry.

Manifest writes, origin add/remove, changed-refresh publication and resolved-cache
writes retain phase-keyed refusal leases on failure/interruption. Successful
completion of the same phase releases its lease; cached reads, an unchanged
snapshot or another origin's success do not. Successful origin removal clears
that origin's manifest/resolve/add uncertainty only after deleting both cache
keys, updating membership/snapshot and completing publication. It does not clear
unrelated or global failed refresh publication. These phases do not form a
cross-store transaction, durable journal, restart grant or detached-resource
census. No automatic task/model replay or forced uncertainty recovery is added.

Two loopback HTTP cases block actual source responses through removal/re-addition,
then check rejection, current snapshot/manifest preservation and absent retired
config. A controlled KV dependency applies a config write then loses its receipt;
the real WellKnown service stays fenced through cached reads, another origin's
success and refresh/load until successful exact-origin removal. Four red probes
(late resolve check, cold-load checks, pre-write manifest check alone, retained
failure lease) each fail directly. All six WellKnown tests passed **60 repeats**.
Fault coverage is limited to the tested config-write phase: physical storage
failure, every other write/publication interruption boundary, complete consumer
application and restart reconciliation remain unproven.

Final sequential validation passed **6,878 core tests, 43 skipped, zero failures**
(6,921 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `wellknown-*` in the approved
temporary directory; final checks end in `-final.log`. Existing warnings and
timeouts are unchanged. Public Protocol/HttpApi, installed runtimes, global
settings and production movement flags are unchanged. Other periodic/cache and
acquisition inputs, durable recovery, complete destination authority, native
resource census and exact receiver/production-adapter acceptance remain required.

WellKnown now distinguishes completed manifest persistence from completed entry
application. Each attempted manifest save retains an origin-specific application
lease before the write. A successful write records that origin in the current
attempt's saved set; only completion of that attempt's snapshot update (and its
publication where applicable) releases those application leases. Cached entry
loads cannot release them. The unchanged-refresh branch releases only origins
actually saved by that attempt and cannot retire the separate failed-publication
lease. Full origin removal also clears its application lease after deletion and
publication complete. Releasing a phase lease and retiring its map entry is
uninterruptible under the existing mutation lock, so cancellation cannot leave a
released token registered as if it still owned a refusal count.

Two controlled-KV/loopback cases persist the first changed manifest and fail the
second before snapshot replacement. They remove the failing origin, isolating
the first origin's successful-but-unapplied write; cached reads and another
origin's success still refuse admission. One case recovers by successful refresh
application/publication, the other by complete exact-origin removal. Disabling
the application lease fails both cases; allowing cached loads to release every
origin's application lease instead of only their own successful saves also fails
both. All eight WellKnown cases passed **80 repeats**.

Final sequential validation passed **6,880 core tests, 43 skipped, zero failures**
(6,923 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `wellknown-apply-*` in the
approved temporary directory; final checks end in `-final.log`. Existing warnings
and timeouts remain unchanged. No public Protocol/HttpApi, installed runtime,
global configuration or production movement flags changed.

This covers the tested multi-origin manifest-write/application boundary, not every
publication/cancellation/consumer failure, physical disk behavior, durable restart
reconciliation or a complete source-discovery census. Refusal leases remain
process-local and authorize neither task replay nor movement. Other native inputs,
durable workspace journals, detached-resource census, complete destination
authority and exact receiver/production-adapter acceptance remain required.

WellKnown publication acceptance now includes six real-Bus cases: add, remove and
changed refresh, each with a defect or interruption after source snapshot changes
and before volatile dispatch. The native pre-publication authority observer is
registered first. A later listener gates/fails publication, proving that neither
the eager snapshot nor an unchanged refresh supplies its missing producer receipt.
The test explicitly reconciles the independent native consumer and drains its
worker before asserting that producer uncertainty still refuses admission. A
successful explicit publication of the same source phase then permits admission.
This exercises the existing implementation; no runtime behavior changed in this
verification milestone, and no automatic publication retry was introduced.

Disabling producer publication leases fails all six cases after consumer
reconciliation; disabling only the refresh lease fails its two cases. Adding
false settlement to the unchanged-refresh branch fails both refresh cases. These
red probes demonstrate that observer/application holds are not masking the
producer-phase assertion. All 14 WellKnown cases passed **140 repeats**. Source
HTTP traffic stays on loopback; actual Bus listener ordering and authority fences
are used, with no paid model calls or provider resource transitions.

Final sequential validation passed **6,886 core tests, 43 skipped, zero failures**
(6,929 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `wellknown-publication-*` in
the approved temporary directory; final checks end in `-final.log`. Existing
warnings and timeouts are unchanged. Installed runtimes, public Protocol/HttpApi,
global configuration and production movement flags remain untouched.

This is process-local source publication/observation verification, not physical
storage fault coverage, durable publication/restart reconciliation, all consumer
application failure acceptance or a source/borrower census. Durable workspace
journals, other inputs/acquisition, detached-resource evidence, complete
destination authority and exact receiver/production-adapter acceptance remain
required before movement or full Goal completion.

The shared RepositoryCache service now owns its own active reservation mutation
guard, rather than relying only on callers such as Reference. Admission is fenced
through lock waiting, initial discovery, cache work, result metadata and cleanup;
an idle service retains no active guard. Before stale-checkout deletion or
attempt-record/clone/fetch/checkout/reset work, each attempt also acquires an
independent retained lease. Failure/interruption keeps that checkout's refusal
lease after caller cleanup. A throttled `cached` result or another branch/cache
key's success does not settle it.

A successful non-cached operation captures only already-failed leases visible
under its checkout lock. It releases those and its own lease only after its lock
cleanup succeeds. An older worker still finishing cleanup is not eligible for
reconciliation, and a newer attempt cannot enter an older completion's captured
set. Thus a late older cleanup failure and a newer failed reset retain their own
refusal evidence regardless of the other's success. Full-attempt failure handling
records eligibility after worker/lock cleanup, not merely after the eager Git
effect. Lease release/map retirement is uninterruptible. Existing daily attempt
throttling, self-healing Git operations, errors and Result shapes are preserved;
no new retry loop, task/model replay or forced cleanup permission is introduced.

Four local-Git cases cover discovery before any mutation lease, clone cancellation
with blocked worker cleanup, an applied reset with a lost receipt surviving cached
metadata and another branch's success, a delayed completion retaining a newer
failed attempt, and a newer successful refresh failing to retire an older worker
whose cleanup later fails. Same-checkout successful work recovers failed leases
observed under its lock. Lock lifetime boundaries use a controlled adapter around
the real file lock; Git resets/clones use disposable local repositories, not remote
services or user checkouts. Retained-lease removal fails the cancelled-clone,
lost-reset-receipt and delayed-completion/newer-failure cases;
dropping active admission fails the discovery assertion; releasing newly visible
leases after cleanup fails the newer-attempt case; including still-active leases
in reconciliation fails the late-cleanup-failure case. Restored cases passed
**40 repeats**.

Final sequential validation passed **6,890 core tests, 43 skipped, zero failures**
(6,933 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `repository-authority-*` in
the approved temporary directory; full core/server/SDK/build checks end in
`-final.log`, workspace verification in `-workspace-final2.log` and repeats in
`-repeated-final.log`. Existing warnings/timeouts remain unchanged. Installed
runtimes, public Protocol/HttpApi, global settings and production movement flags
are untouched.

These are cache-operation receipt/lifetime guarantees within a live service and
authority graph, not physical lock fault acceptance, cross-process exclusion,
detached-process or retained-reader census, durable cache journals or restart
reconciliation. Recreating a cache service is not a recovery receipt for an old
retained lease. Shared checkout readers may still observe Git content changes;
this work does not establish full reference/instruction destination equivalence.
Other native inputs/acquisition, durable workspace recovery, complete destination
authority and exact receiver/production-adapter acceptance remain required.

Instance graph disposal now acquires an explicit retained cleanup lease. Closing
the resource scope must succeed before that lease releases. The first cleanup
effect and exit are cached, including failure, so an already-closed scope cannot
turn a failed first close into a successful cleanup receipt on a later path.
Active disposal remains guarded independently; failure refusal survives repeated
Location invalidation and unrelated successful mutation work.

Failed acquisition also retains a separate bootstrap lease. Effect's Layer
implementation can close private child scopes before returning a build failure;
the subsequent outer resource-scope close cannot certify those nested cleanup
outcomes. This intentionally supersedes the earlier provisional test assumption
that a failed boot followed by successful outer close restores admission. Every
failed graph acquisition now conservatively refuses future stable reservations
in that authority instance, including failures whose error category looks benign;
no error classification, cached close or later graph success is a cleanup receipt.
Successful boot releases its acquisition lease, and successful disposal releases
its cleanup lease. No automatic retry/force-clear/recovery permission was added.
Normal session/model/tool configuration and installed runtime behavior are not
rewritten; this stricter refusal belongs to the isolated reservation extension.

Four actual graph-lifetime cases cover successful/failed boot crossed with
successful/failed cleanup. Blocked finalizers prove immediate refusal through
cleanup, then successful disposal restores admission while failed acquisition or
cleanup remains fenced after repeated invalidation and unrelated mutation work.
The pre-fix baseline fails both newly added cleanup-failure cases. Removing the
cleanup lease fails the successful-boot/failed-disposal case; removing the
acquisition lease fails both failed-boot cases. All four cases passed **40 repeats**.
The fixture uses controlled finalizers and offline model metadata, not provider
resource transitions or paid inference. It does not prove physical cleanup.

Final sequential validation passed **6,892 core tests, 43 skipped, zero failures**
(6,935 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `instance-cleanup-*` in the
approved temporary directory; final checks end in `-final.log`. Existing warnings
and timeouts are unchanged. Public Protocol/HttpApi, installed runtimes, global
configuration and production movement flags remain untouched.

Bootstrap/cleanup refusal remains process-local, with no durable intent,
authenticated reconciliation receipt or user-facing quarantine recovery contract.
The conservative failed-acquisition refusal is not an automatic cleanup census or
restart guarantee. Retained graph borrowers/facades, detached descendants, other
native inputs/discovery, durable workspace recovery, full destination authority
and exact receiver/production-adapter acceptance remain required. Instance scope
settlement still must not be presented as proof that every resource is gone.

Workspace destruction no longer has the legacy missing-provider/null-binding
deletion shortcut, even when this owner has no local provision observation.
Every existing row requires lookup and successful cleanup by its registered
driver before deletion. A null binding and an empty process-local attempt map
cannot distinguish an unprovisioned row from a resource created before its receipt
was persisted. Missing providers therefore preserve the row and return the
existing ProviderNotFound error. No new API/error type, cleanup bypass or retry
was added. This supersedes earlier notes retaining that legacy shortcut as an
explicitly unproven path; it has now been removed, not accepted as absence proof.

Two cases cover an imported null-binding row with no observed attempt and a
reconstructed Workspace owner after a simulated create effect/lost receipt. The
latter closes the old owner, retains the same DB service/row, starts a fresh owner
with no provision observations, and checks that missing-provider destruction
preserves both row and fixture resource. Restoring the driver permits exactly one
null-binding cleanup before row deletion. The old shortcut fails both cases;
restored cases passed **20 repeats**. This uses a controlled driver and owner
reconstruction, not a real process crash, reopened database or provider resource.

Final sequential validation passed **6,894 core tests, 43 skipped, zero failures**
(6,937 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-legacy-*` in the
approved temporary directory; final checks end in `-final.log`. Existing warnings
and timeouts are unchanged. Public Protocol/HttpApi, installed runtimes, global
configuration and production movement flags remain untouched.

Preserving a row is not a durable attempt/cleanup journal, proof that every
provider resource is known, or a reservation recovery receipt. Process restart,
orphan enumeration, durable refusal/reconciliation and owner authentication
remain required, as do borrower/descendant census, remaining native input
discovery, full destination authority and exact receiver/production-adapter
acceptance. Missing-provider rows remain unresolved until applicable driver
cleanup is available; no resource absence is inferred from local memory.

Retained Workspace metadata and destruction facades now refuse a closed owner.
Create checks ownership before lookup, after the existing-row read and after
provider lookup/time acquisition before insert; cached-ID adoption does not bypass
the check. Destroy refuses before settling any shared attempt, rechecks after
locked row lookup, and revalidates again before driver cleanup after an awaited
provider lookup. The internal create error union includes the existing
WorkspaceDriver.Error for the same closed-owner diagnostic already used by
provision/connect. No public Protocol/HttpApi or new error schema was introduced.
The synchronous owner-state helper is shared with the existing provision/open/
borrow admission checks; no configuration or effective permissions are rewritten.

Three cases cover retained new/cached metadata and destruction facades after
closure, plus separately gated create and destroy provider lookups that resume
after owner disposal. They assert refusal, preserved or absent rows as applicable,
and no driver resource call. The pre-fix baseline fails the facade and delayed-
create cases; removing just post-provider revalidation fails both delayed cases.
Restored tests passed **30 repeats**. Already-accepted I/O keeps its own cleanup
rules: this does not blindly cancel/retry work after its side effects start.

Final sequential validation passed **6,897 core tests, 43 skipped, zero failures**
(6,940 tests across 278 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-owner-*` in the
approved temporary directory; final checks end in `-final.log`. Existing warnings
and timeouts remain unchanged. Installed runtimes, global configuration and
production movement flags remain untouched.

These checks are owner-local admission, not durable intent/refusal journals,
cross-owner exclusion, authenticated reconciliation or detached-resource census.
They do not revoke arbitrary retained service methods or certify effects already
accepted before closure. Actual process/database restart recovery, remaining
native acquisition/discovery and borrower lifetimes, complete destination
authority and exact receiver/production-adapter acceptance remain required.

Workspace create now writes a minimal per-attempt intent into the existing native
KV table before invoking the driver. The versioned key has a random attempt ID;
its value contains only workspace ID and provider, not a binding, credentials,
headers, instructions or conversation content. No schema migration or public API
was needed. Bootstrap holds admission while scanning/validating these records,
then retains refusal for each unresolved intent before publishing the service.
These records are pending-effect evidence, not execution or movement grants.

After an actual idempotent same-ID create completes and its binding is persisted,
core removes that attempt's intent and previously captured intents for the same
ID **and provider**. Cached binding adoption does not do so. Existing successful
driver destruction removes captured matching create intents only after row and
registered local cleanup complete. Another provider's success, an absent row or
a missing provider cannot retire the original evidence. Newer/unobserved records
are not swept by a broad ID-prefix deletion. Intent removal must complete before
its current graph's retained lease releases; no polling retry or model/task replay
was introduced. The existing driver's explicit same-ID create contract remains
the boundary for an invoked retry, not a new privilege from this journal.

Four subprocess cases now close a real process/database restart boundary. A child
persists the intent, writes a disposable fixture resource, and abruptly exits with
code 73 before returning a create binding, bypassing Effect finalizers. A fresh
process reopens the same on-disk SQLite database and refuses admission. Plain
inspection and a synthetic cached binding both preserve refusal; a missing
provider preserves row, intent and fixture resource. Successful matching driver
cleanup on the row-present path removes the resource/row/intent and restores
admission in that fresh process. Separate cases delete the row or change its
provider and perform unrelated successful cleanup: original evidence remains
fenced through another process reopening. The fixture explicitly rejects any
unexpected create replay. No real provider or paid inference is used.

Moving intent persistence after the driver effect fails both initial restart
cases; skipping reconstruction fails both; removing provider matching fails the
changed-provider case. All four cases passed **40 repeats**. Child processes are
owned and killed/joined on interrupted tests before temporary files are removed.
This tests ordinary abrupt process exit with SQLite reopening, not power loss,
physical storage corruption, every write/receipt interruption or provider crash
semantics.

Final sequential validation passed **6,901 core tests, 43 skipped, zero failures**
(6,944 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-journal-*` in the
approved temporary directory; accepted final checks/repeats end in `-final2.log`.
Existing warnings and timeouts are unchanged. Public Protocol/HttpApi, installed
runtimes, global configuration and production movement flags remain untouched.

This is the first durable **create** refusal boundary, not complete workspace
recovery. Destroy/connect/idle-transition intents, row-deletion/intent-removal
crash windows, orphan-resource enumeration/reconciliation and authenticated owner
journals/quarantine remain unproven. In particular an orphaned create record
stays refused; `destroy` of an absent row is not a recovery receipt. Rebuilding
another Workspace over the same live authority cannot settle retained leases of
an older graph; no force-clear is provided. Dynamic cross-process record census,
exclusive ownership/CAS fencing and coherent concurrent-owner cleanup are not
established by startup scanning. Complete destination authority, remaining native
input/borrower/descendant census and exact receiver/production-adapter acceptance
also remain required. Production movement must remain disabled.

Workspace destruction now writes a separate versioned per-attempt destroy intent
before connection or driver cleanup. Bootstrap reconstructs both create and
destroy records under the same admission hold. Intents remain non-secret pending
effect evidence containing ID/provider, not bindings or execution permission.
An unsettled destroy refuses provision (before cached-binding adoption and again
under the lock) and connection opening, so a cached receipt cannot resurrect a
resource with unfinished teardown. Create completion reconciles only create
intents; it cannot retire a destroy record.

Successful driver and registered local cleanup now precedes a **single SQLite
transaction** that deletes the Workspace row and all captured matching create/
destroy intents. Only after that transaction succeeds are their live leases
released. SQL failure leaves the row and evidence available for an explicit
same-ID destroy retry under the driver's existing absence-is-success contract;
no retry loop or replay authority is added. This is atomic native metadata, not
an atomic transaction with the external provider, clustered ownership or an
exactly-once effect guarantee. Missing rows still do not trigger orphan cleanup.

The subprocess suite now has nine cases across create/destroy crash boundaries,
plain/cached observation, missing-provider preservation, absent-row/unrelated-
provider quarantine and terminal transaction rollback. Destroy-crash children
remove the fixture resource then abruptly exit before returning cleanup success;
fresh processes reopen SQLite, observe durable refusal and reject cached re-wake
without calling create. A controlled SQLite trigger aborts intent deletion during
the terminal transaction after row deletion has run; both original create and new
destroy intents plus the row survive rollback and reopening. A later explicit
driver cleanup completes and restores admission. Fixture probes yield the initial
empty idle-poll worker before inspecting refusal, avoiding a transient startup
hold masking journal ownership. Moving destroy persistence after the driver
effect fails two cases; nontransactional row/intent deletion fails rollback;
allowing cached re-wake fails its case. All nine passed **90 repeats**.

Final sequential validation passed **6,906 core tests, 43 skipped, zero failures**
(6,949 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-destroy-*` in the
approved temporary directory; final checks end in `-final.log`. No test timeouts
were increased or warnings suppressed. Public Protocol/HttpApi, installed runtimes,
global configuration and production movement flags are unchanged.

These cases prove the tested ordinary process-exit and SQL-abort metadata
boundaries, not power-loss/physical disk behavior, every commit/receipt failure,
real provider fault acceptance or concurrent-owner authority. Durable connect and
idle-transition intents, authenticated owner/CAS fences and dynamic cross-process
census, orphan reconciliation, old-graph lease recovery in the same authority and
complete native resource/borrower/detached-descendant coverage remain required.
Full destination authority and exact receiver/production-adapter acceptance also
remain unproven; this is not permission to enable movement.

Workspace idle suspension now writes its own versioned per-attempt intent before
`suspendForIdle`. Bootstrap reconstructs it with create/destroy refusal records.
Successful completion retires only that pass's idle intent after binding/activity
persistence and registered connection/observer cleanup. Failed or interrupted idle
work is not replayed: reconstructed idle records join local suspension quarantine
checks in provision/open, including a recheck under the provision lock before a
cached binding can be adopted. Explicit matching driver destruction may retire
captured idle records in the existing terminal metadata transaction; a later poll,
successful create or cached receipt cannot certify the uncertain transition.

Each Connection now retains its original provider name privately. The idle intent
uses that captured driver's provider, not a later row value, so a changed row and
another provider's successful cleanup cannot retire the original effect evidence.
This records a driver label, not an authenticated implementation/credential owner
identity or a destination-equivalence certificate.

The subprocess suite now has 14 cases across create/destroy/idle boundaries. Idle
crash children acquire an actual Workspace connection with a memory environment,
complete scoped file use, then advance the caller TestClock to trigger the real
idle poll. The fixture saves a suspended binding, writes its fixture effect and
abruptly exits before returning transition success. A fresh process reopens
SQLite, verifies the saved suspended binding and durable refusal, refuses cached
re-wake, preserves missing-provider evidence, and recovers only through explicit
matching destruction. Orphan/provider-mismatch cases preserve quarantine through
another reopening. An additional case changes the row provider before suspension
to verify captured Connection authority. No fixed polling sleep, paid inference
or real provider transition is used. Fixture connect/idle/create methods reject
unexpected replay.

Moving intent persistence after suspension fails both idle admission cases;
removing reconstructed idle admission checks fails cached re-wake; using the row
provider rather than the captured Connection provider fails its cleanup case.
All 14 cases passed **140 repeats**. Existing in-process idle tests also continue
to cover successful settlement and sleep admission, blocked cleanup and refusal
of non-idempotent retries. Test subprocesses remain owned/killed/joined on failure.

Final sequential validation passed **6,911 core tests, 43 skipped, zero failures**
(6,954 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-idle-journal-*` in
the approved temporary directory; final checks end in `-final.log`. Existing
warnings and test timeouts are unchanged. Public Protocol/HttpApi, installed
runtimes, global configuration and production movement flags remain untouched.

Durable connect/acquisition refusal is still missing. These tests establish the
tested native idle process-exit/refusal boundary, not real provider or physical
power-loss behavior, every cleanup/commit failure, dynamic cross-process census,
authenticated owner/CAS fencing or orphan/old-graph reconciliation. Complete
native input/borrower/detached-descendant coverage, full destination authority and
exact receiver/production-adapter acceptance also remain required. No movement
or task replay authority is derived from these records.

Workspace connection acquisition now persists its own versioned per-attempt
intent before `driver.connect`. Bootstrap reconstructs connect refusal along with
create/destroy/idle evidence. The intent clears only after the environment is
published and `last_used_at` persistence completes; failed or interrupted
acquisition remains quarantined despite a saved binding. Provision/open recheck
that quarantine, including before cached environment reuse. The idle worker also
skips unsettled acquisition, so a partially published connection cannot trigger
another provider transition merely because its activity timer expires. Explicit
matching destruction may retire captured connect evidence in its terminal
transaction. Create/idle receipts cannot settle it.

This deliberately tightens an earlier file-override test that retried a failed
wake: the first error retains its original Environment.Failed cause, while later
operations return the existing WorkspaceDriver.Error quarantine diagnostic without
calling connect again. Unlike create, the connect driver contract does not
guarantee idempotent replay. Successful completed acquisition still clears its own
intent; that receipt is not evidence that its live handles or detached resources
are absent. Owner closure is revalidated after provider lookup, scope acquisition,
driver return and final metadata persistence, before publishing completion.

The process suite now has 19 cases. Connect-crash children save a connected
binding and fixture effect then abruptly exit before returning the environment;
fresh SQLite processes verify refusal through plain/cached, missing-provider,
orphan and changed-provider observations, then explicit applicable destruction.
A native SQL trigger fails activity metadata **after** the environment has been
cached. Removing that trigger is not reconciliation: native file re-admission
remains refused, no second connect occurs and advancing TestClock dispatches no
idle transition. Fresh-process refusal and explicit driver cleanup are then
verified. A gated provider lookup separately proves closed-owner refusal before
driver calls or a new connect intent. Fixture resources remain memory/file-backed,
not real provider resources or paid inference.

Moving intent persistence after driver return fails both connect restart cases.
Removing only the cached-open gate fails publication re-admission; removing only
the idle-worker gate fails its transition counter; removing post-lookup owner
validation writes an unauthorized late intent and fails that case. All 19 process
cases passed **190 repeats**, and the owner/no-connect-retry cases passed **20
repeats**. Existing warnings remain visible and no test timeouts were increased.

Final sequential validation passed **6,917 core tests, 43 skipped, zero failures**
(6,960 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-connect-journal-*`
in the approved temporary directory; final checks end in `-final.log`. Public
Protocol/HttpApi, installed runtimes, global configuration and production movement
flags remain untouched.

These are the tested acquisition-effect/publication refusal boundaries, not a
durable census of successfully returned live connections/handles or detached
descendants. Physical/provider faults, every cleanup/receipt/commit failure,
authenticated owner/CAS fencing, dynamic cross-process census and orphan/old-graph
reconciliation still require acceptance. Complete native input/borrower coverage,
full destination authority and exact receiver/production-adapter acceptance also
remain unproven. No automatic connect replay, forced cleanup permission or
movement authority is introduced by the journal.

Workspace intent retirement now compares both key and the captured **encoded
value**. Bootstrap validates known intent fields but retains the entire stored
JSON value, including fields this version does not interpret. Shared completion
retirement runs as one conditional-delete transaction; destroy uses the same
comparison inside its row/intent transaction. A missing or mismatched receipt
fails with the existing WorkspaceDriver.Error and retains refusal instead of
deleting a replacement or partially completing a batch. Binding persistence may
already have succeeded; that eager result does not settle the failed receipt.

A detected mismatch also quarantines that graph's workspace ID. Subsequent
provision/open/destroy and idle provider work refuse before new effects or
intents, rather than repeating cleanup against the same stale snapshot. Metadata
observations are not promoted into grants. This process-local mismatch flag has
no force-clear/recovery permission, and does not interrupt already-accepted
provider work or authenticate a new owner.

Two concurrent-process cases extend the subprocess suite to 21. An actor pauses
inside create or destroy after its fixture effect and intent write. Typed Bun IPC
signals readiness; stdin EOF releases it only after a second live process changes
the stored receipt. No polling sleep or timeout extension is used. The first actor
must refuse retirement; create preserves its saved binding and replacement
evidence, while destroy rolls back row deletion and keeps both intents. Another
destroy from that stale graph invokes no provider callback and writes no intent.
A fresh process explicitly cleans up against its newly observed full value,
including the replacement field, and the tested fixture then restores admission.
This is controlled test authority, not authenticated production-owner acceptance.

Removing the shared completion comparison fails its create case; removing the
terminal destroy comparison fails its case; omitting mismatch quarantine fails
both because stale cleanup makes another provider call/new intent. All 21 process
cases passed **210 repeats**. IPC children and output streams remain owned and
joined/killed before temporary data cleanup. There are no real provider resources,
paid model calls or automatically replayed tasks.

Final sequential validation passed **6,919 core tests, 43 skipped, zero failures**
(6,962 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-intent-cas-*` in
the approved temporary directory; final checks end in `-final.log`. Existing
warnings and test timeouts are unchanged. Public Protocol/HttpApi, installed
runtimes, global configuration and production movement flags remain untouched.

This is receipt compare-and-delete, **not** authenticated owner/generation fencing,
an ABA defense, a cross-process live-intent census or prevention of stale provider
effects already in flight. Unknown writers can still bypass this implementation;
no snapshot is a durable owner grant. Authenticated owner/CAS epochs and quarantine
reconciliation, orphan/old-graph recovery, physical/provider failure acceptance,
complete native input/borrower/detached-resource coverage, full destination
authority and exact receiver/production-adapter acceptance remain required.

Native intents now include a non-secret graph ID and, when available, local
PID/host observation metadata. Before same-ID provider work, Workspace refreshes
that ID's durable records under its local mutex without replacing old CAS
witnesses or treating disappearance as cleanup. Known same-host live foreign
processes cause refusal before another driver call or intent. Legacy/missing
owner metadata, foreign-host labels and unverifiable local status also refuse;
unavailable process APIs do not create an ownership grant. The current graph can
still handle its own records through existing native bookkeeping.

This is a **refusal-only observation**, not authenticated identity. PID absence
only avoids this extra refusal: existing caller authorization, quarantine checks
and driver contracts still apply. It proves neither stopped descendants/backend
operations nor resource absence. Host labels and random graph IDs are not
credentials, epochs or capabilities. No PID result authorizes movement or replay.

The process suite now has 24 cases. A cleanup peer starts before a creator's
intent exists, then pauses. The creator enters its real driver callback and
pauses before allocating the fixture resource. After resuming, the peer must
refresh the new record and refuse cleanup with no driver call/new intent. The
creator then finishes with row/binding/resource intact, and a later explicit
fixture cleanup succeeds. Disabling live-process refusal or boundary refresh
independently fails this case and exposes cleanup overtaking creation. Additional
legacy-owner and foreign-host cases preserve quarantine with no driver callback;
bypassing unverifiable-owner refusal fails both. These cases use owned local
processes, signal-0 observations and disposable memory/file resources, not real
provider fault acceptance or authenticated production-owner RPC.

The reconstructed-graph unit case now conservatively refuses cleanup while the
old graph's process remains live, even after its scope closes and its driver is
available. This supersedes the earlier provisional reconstruction/driver-restored
cleanup expectation: scope settlement still is not a resource census. Another
unit case moves a known receipt to a different workspace ID; refresh must
quarantine both the old observation and newly targeted identity before cleanup.
The pre-fix identity path fails that case. All 24 process cases passed **240
repeats**, and the two reconstruction/identity units passed **20 repeats**.

Final sequential validation passed **6,923 core tests, 43 skipped, zero failures**
(6,966 tests across 279 files), all 35 workspace tasks, both builds, server
(85 passes/one skip) and SDK (14 passes). Logs use `workspace-owner-observation-*`
in the approved temporary directory; accepted final checks/repeats end in
`-final2.log`. Existing warnings and test timeouts remain unchanged. Public
Protocol/HttpApi, installed runtimes, global configuration and production movement
flags are untouched.

Boundary refresh does **not** make ReservationAuthority.withStable perform a
global cross-process census, nor close the read-to-provider-action race. Native
intent writers remain append/delete-only; no speculative generation triggers or
timestamp-based ABA/owner claims were added. Authenticated owner/epoch exclusion,
ABA protection where required, complete dynamic census, orphan/old-graph
reconciliation and prevention of stale provider work remain unproven. Physical
provider/cleanup/commit acceptance, complete native input/borrower/descendant
coverage, full destination authority and exact receiver/production-adapter
acceptance are still required before enabling movement or completing the Goal.

Workspace terminal publication now checks the captured workspace ID/provider and
commits its binding/activity update with exact-value intent retirement in one
SQLite transaction. Destruction similarly requires deletion of that captured row
before retiring evidence. A missing/reassigned row quarantines this graph and
preserves its intent; it is not a zero-row success. Driver `saveBinding` also
checks the captured provider and retains refusal on a failed write. This does
not fence an already-running provider effect or detect same-ID/provider ABA.

Four additional process cases delete or reassign a workspace row while real
create/destroy callbacks are paused. All fail completion, preserve durable
evidence across reopen and refuse stale-context cleanup. The existing replaced-
create-receipt test now additionally observes binding publication rollback,
superseding its earlier partial-binding expectation. The idle captured-provider
crash fixture reassigns the row after its checked binding save, before process
exit; it still tests captured-provider reconstruction rather than bypassing a
failed identity check. Connect/idle changed-row callback boundaries do not yet
have the same dedicated process-race matrix.

Sequential validation passed **6,927 core tests, 43 skipped, zero failures**
(6,970 across 279 files), **280 process-case repeats** (28 cases), all 35 workspace
checks, core/server builds, server (85/one skip) and SDK (14). Accepted logs are
`workspace-publication-*-final.log` in the approved temporary directory.
Authenticated owner/generation fencing, cross-process exclusion/census, orphan
reconciliation, physical provider faults and production movement acceptance
remain open. No installed runtime, public Protocol/HttpApi, global configuration
or production movement flag changed.

The connect/idle changed-row completion matrix is now covered by four additional
owned-process cases. Each pauses the real callback after saving its binding,
then a separate live process deletes or reassigns the row. Completion fails,
the exact intent survives reopening, and cached reuse/retry is refused with one
connect and at most one idle callback. The idle fixture waits for explicit
callback entry and queues a real file borrow behind the worker's same-ID lock;
it does not infer settlement from a sleep or cached snapshot. This supersedes
the preceding dedicated-connect/idle-matrix limitation, not the broader provider
fault/ownership limitations.

Before idle dispatch, Workspace now checks that the current row still belongs
to the captured connection provider. A missing or reassigned row quarantines
that graph and retains an admission hold without passing a foreign binding to
the old driver. Two TestClock cases prove zero suspension calls and refusal on
later borrows/polls. The pre-fix reassignment case fails with one incorrect
suspension call. This hold is deliberately process-local unresolved-resource
refusal: no durable resource census or automatic old-graph release is claimed.

Sequential validation passed **6,933 core tests, 43 skipped, zero failures**
(6,976 across 279 files), **320 process-case repeats** (32 cases), **20 unit
repeats**, all 35 workspace checks, both builds, server (85/one skip) and SDK
(14). Accepted logs use `workspace-connect-idle-*-final.log`; the regression log
is `workspace-idle-identity-red.log`. These fixture observations neither close
the read-to-driver race nor authenticate owner/generation, prevent same-ID/
provider ABA, census detached/provider resources, or establish production
movement acceptance. Installed runtimes and production flags remain untouched.

Cached connection acquisition now uses the same captured-provider row check as
idle dispatch. Each new file/spawn borrow reads the current row before returning
an existing environment, rechecks owner closure after that read, and quarantines
missing/reassigned rows without dispatching to the cached driver. The shared
check retains one unresolved-resource hold per newly quarantined workspace;
later reads/polls cannot accumulate holds or release the original refusal.

Two additional TestClock cases mutate an already-connected row without advancing
to idle. They prove cached spawn refusal with zero spawner dispatches, file
refusal/retry, retained admission refusal and no additional create/connect calls.
The initial pre-fix file-borrow probes fail both cases. Together with the idle
checks, all four cases passed **40 repeats**. Sequential validation passed
**6,935 core tests, 43 skipped, zero failures** (6,978 across 279 files), all 35
workspace checks, both builds, server (85/one skip) and SDK (14). The 32 process
cases passed within the full core run; they were not separately repeated again
for this change. Logs use `workspace-cached-identity-*-final.log`; red probes are
`workspace-cached-identity-red.log`.

This only rejects observed row/provider drift at a new acquisition boundary.
It does not compare opaque same-provider binding generations, close subsequent
read-to-dispatch races, revoke existing handles, authenticate owners, establish
cross-process exclusion/census, or certify orphan/provider cleanup. Production
movement remains disabled and the Goal remains incomplete.

Native PTY creation now joins the process-local reservation authority before
asynchronous shell/backend acquisition. Closed owners refuse creation, including
closure while shell/backend acquisition is pending. Failure/cancellation before
native spawn is attempted releases only that pre-spawn hold. Once spawn is
attempted, refusal remains even if spawn throws, a terminal exits, the UI removes
it, or the Location scope closes: the current backend only requests kill and
does not certify absence of descendants. There is deliberately **no automatic
release/reconciliation path** for a spawned PTY. This is conservative admission
refusal, not completed PTY cleanup or a production-ready movement port.

Three controlled shell-selection tests prove early guard invalidation, pending
refusal, pre-spawn failure/cancellation settlement and closed-owner refusal.
A live POSIX terminal test proves refusal during native operation and after
removal; the existing native-exit test now also proves retained refusal after
exit. Removing the admission hold fails four targeted cases. The full PTY
session suite passed **110 repeats** (11 cases). Its first controlled fixtures
were corrected to export the authority and build fresh child graphs rather than
reusing the outer memoized PTY layer; those failed attempts are not acceptance.

Final sequential validation passed **6,939 core tests, 43 skipped, zero failures**
(6,982 across 279 files), all 35 workspace checks, both builds, server (85/one
skip) and SDK (14). Logs use `pty-authority-*-final.log`; the mutation probe is
`pty-authority-hold-red.log`. No public Protocol/HttpApi, installed runtime,
global configuration or movement flag changed.

PTY refusal is not durable evidence across process death, a dynamic resource
census, authenticated owner/generation exclusion, descendant termination or
Windows/IDE acceptance. Restarting does not prove orphan absence or authorize
movement. A compatible authenticated reconciliation/census path remains required
before production reservations can rely on resource cleanup. Retained-resource
coverage outside this path also remains under audit.

Local environment filesystem promises now defer Effect interruption until their
native I/O promise settles. Previously, cancelling a waiter could complete its
worker/mutation cleanup while `node:fs` continued writing. The shared local
filesystem attempt boundary now waits through that I/O, including the ranged
read's existing owned-handle `finally` close, before interruption unwinds the
caller. This adds no timeout, retry or new mutation authority.

A POSIX FIFO regression drives the real local driver with a four-MiB write.
Reading one byte proves the writer entered kernel I/O; with the remainder still
blocked, the test interrupts its owning mutation worker. Before the fix,
interruption finished and a fresh stable guard succeeded while the native write
was pending. Now interruption and guard refusal remain until the reader drains
the write; all remaining bytes and restored admission are checked. The test owns
the mkfifo child, FIFO descriptors and directory and drains on assertion failure.
There are no fs mocks, fixed sleeps or raised timeouts. Windows has no POSIX FIFO,
so this test explicitly does not provide Windows native-I/O acceptance.

The regression passed **10 repeats**; both early-interruption and false-admission
probes fail when the operation is interruptible. Sequential validation passed
**6,940 core tests, 43 skipped, zero failures** (6,983 across 280 files), all 35
workspace checks, both builds, server (85/one skip) and SDK (14). Logs use
`local-io-authority-*-final.log`; red probes are `local-io-authority-red.log` and
`local-io-authority-admission-red.log`.

This verifies cancellation waiting for local promise settlement, not successful
cleanup after a failed close, complete registration of every raw filesystem
caller, provider-effect fencing, resource census, orphan reconciliation or
cross-process ownership. Other native asynchronous I/O/resource paths still need
audit. Production movement remains disabled; no installed runtime, public API or
global configuration was changed.

The FIFO cancellation regression now also drives the real Workspace service's
file-borrow acquisition/retained-worker/cleanup path with the actual local
filesystem driver. Its provider registration is a disposable local fixture, not
a remote provider transition. No extra mutation wrapper surrounds this path:
Workspace itself must retain refusal while a cancelled caller's native write
is pending. Disabling the native-I/O wait reproduces false stable admission in
this integration too (`local-io-workspace-red.log`). Both the direct mutation
and Workspace-borrow cases now check pending cancellation/refusal, byte-for-byte
drain and restored admission; together they passed **20 repeats**.

This verification-only extension changes no runtime behavior beyond the preceding
fix. Final core passed **6,941 tests, 43 skipped, zero failures** (6,984 across
280 files), and all 35 workspace checks passed. Logs use
`local-io-workspace-*-final.log`. Builds/server/SDK were not rerun for this
test-only extension; their preceding `local-io-authority` results remain the
last runtime validation. Failed-close/resource-absence/Windows/provider/census
and authenticated owner/generation/production movement limitations still apply.

Ripgrep-backed filesystem search now acquires a counted retained hold before
dispatching each index-scan worker, including background refreshes that return
cached results immediately. Successful scan completion releases only that
attempt; failure/interruption retains its unresolved refusal. Closed owners
refuse cached searches and new scans. Cached results, a later successful scan
and Location disposal cannot retire an earlier failed attempt. Eligible scans
are fenced; fresh-cache/no-work reads do not acquire a scan hold.

Four controlled dependency fixtures cover success, scan failure, cleanup failure
and owner interruption. They prove active-guard invalidation, refusal through
pending scoped cleanup, nonblocking old-index reads, per-attempt failure retention
after another scan succeeds, and closed-owner refusal without new dispatch.
Omitting the hold fails three initial probes; unconditional release fails all
three failure/interruption probes. All four cases passed **40 repeats**.

Final sequential verification passed **6,945 core tests, 43 skipped, zero failures**
(6,988 across 281 files), all 35 workspace checks, both builds, server (85/one
skip) and SDK (14). Logs use `search-authority-*-final.log`; mutation probes are
`search-authority-red.log` and `search-authority-settlement-red.log`.

These fixtures exercise the real search-worker lifecycle with a controlled
Ripgrep dependency, not native process-tree termination or remote-provider
cleanup. Direct Ripgrep callers outside this indexing path and the separate
fff native indexer's retained resources remain under audit. The holds are not
durable cross-process ownership, authenticated generation fencing, descendant
absence or orphan reconciliation. Public API/installed runtime/global settings
and production movement flags remain unchanged; the Goal remains incomplete.

The fff-backed search layer now retains a native-resource admission hold before
initialization when the backend is available. Acquisition and finalizer
registration share `Effect.acquireRelease`; only a returned handle's successful
`destroy()` releases its hold. Initialization failure (returned error or throw)
retains refusal without pretending that the absence of a handle proves cleanup.
Destroy failure cannot run the release. Both healthy and unavailable-result
search facades refuse use after their owner closes. A genuinely unavailable
backend does not acquire a native hold.

The pinned Bun backend's `src/finder.ts` describes `fff_destroy` as its quiescence
barrier, clears watch handlers before destruction and closes its callback after
that return. Two real-backend tests use a disposable local directory and a
missing-directory initialization failure, not a module mock. They prove active
guard invalidation, lifetime refusal, healthy release only after destruction,
retained failed-initialization refusal through repeated owner close, and stale
facade refusal. Omitting the hold fails both probes. Both cases passed **20
repeats** on this host; unsupported backends explicitly skip these native cases.

Final sequential validation passed **6,947 core tests, 43 skipped, zero failures**
(6,990 across 282 files), all 35 workspace checks, both builds, server (85/one
skip) and SDK (14). Accepted logs use `fff-authority-*-final2.log`; the mutation
probe is `fff-authority-red.log`. The existing direct-layer search fixture now
provides the authority dependency; its assertions are unchanged.

A live fff handle now deliberately refuses reservations for its whole Location
lifetime. Production movement needs an approved resource release/re-establishment
path, not an assumption that an idle conversation owns no native handles. These
nominal Bun-backend observations do not prove destroy-fault recovery, all backend
implementations, native process/power-loss census, durable owner/generation
authentication or orphan reconciliation. Failed native destruction and all
production continuity/receiver/adapter acceptance remain required. Production
movement, installed runtimes, global settings and public APIs remain unchanged.

Direct `Ripgrep.find/glob/grep` invocations now acquire independent retained holds
before binary/process/stream execution, rather than relying only on the separate
index-worker fence. Successful scoped completion releases that invocation's
hold; failed/aborted invocations retain refusal. A subsequent successful query
cannot retire an older attempt, and closed Location owners refuse new queries.
This intentionally includes invalid-pattern errors: the invocation result is
not a separately authenticated cleanup receipt. Ordinary query results/error
types stay unchanged, but reservation availability is conservatively reduced.

Four real local-ripgrep cases cover scoped success, paused `onEntry` callback
defect, AbortSignal cancellation and a typed invalid pattern. They prove guard
invalidation and pending refusal, success-only settlement, failure retention
through another successful glob and owner disposal, and stale-owner refusal.
The initial fixture was corrected to let Environment's empty Workspace startup
poll finish before checking the direct-ripgrep baseline. Omitting the hold fails
all four probes; unconditional release fails all three failure/abort probes.
All four cases passed **40 repeats** without mocks, model use or raised timeouts.

Final sequential verification passed **6,951 core tests, 43 skipped, zero
failures** (6,994 across 283 files), all 35 workspace checks, both builds, server
(85/one skip) and SDK (14). Logs use `ripgrep-authority-*-final.log`; mutation
probes are `ripgrep-authority-hold-red.log` and
`ripgrep-authority-settlement-red.log`.

These observations cover invocation ownership and ordinary local subprocess
cleanup, not native cleanup-fault acceptance, detached-descendant census,
binary-install uncertainty, other environment drivers, Windows/IDE acceptance,
durable cross-process ownership or authenticated generation/orphan reconciliation.
There is no automatic release/replay grant for failed invocations. Production
movement and installed runtimes remain unchanged; the full Goal is incomplete.

Ripgrep binary acquisition now uses one owner-scoped shared worker instead of
caller-owned `Effect.cached` runs. The installed Effect implementation abandons
an unfinished cached run after its last waiter leaves, allowing another run to
start while the old one is interrupted. The new worker acquires its retained
hold before dispatch and owns discovery/download/extraction/cleanup independently
of callers. Cancelling a caller does not cancel or restart that worker. Its exact
success/failure is reused for the owner's lifetime, and closed owners reject
even cached filepath access. Successful cached reads do not invalidate guards.

Failed/interrupted acquisition retains refusal. Archive-removal failure no longer
silently counts as settled installation: the existing successful filepath result
is preserved, but the worker's hold remains uncertain. No installation retry,
global configuration or installed-runtime change was added. Cross-owner and
durable target ownership are still unresolved.

Three controlled source-metadata fixtures cover successful discovery, discovery
failure and owner closure during uninterruptible input work. They prove guard
invalidation, prompt caller cancellation with the shared worker still pending,
one discovery across replacement waiters, retained failure/interruption refusal,
stale-owner refusal and guard-stable cached success. Disabling either the hold or
shared-attempt reuse fails all three probes. All three cases passed **30 repeats**.
These injected metadata observations avoid network/downloads and **do not verify
archive-removal failure, extraction/commit faults or real installation recovery**;
that targeted matrix remains required.

Final sequential core passed **6,954 tests, 43 skipped, zero failures** (6,997
across 284 files), all 35 workspace checks, both builds, server (85/one skip) and
SDK (14). Logs use `ripgrep-binary-authority-*-final.log`; mutation probes end
in `-hold-red.log` and `-sharing-red.log`. Process/power-loss census, compatible
cross-owner exclusion, authenticated generations, orphan reconciliation and
approved native-resource release/re-establishment/receiver acceptance remain
unproven. Production movement remains disabled and the Goal remains incomplete.

The offline binary-install method-boundary matrix is now covered by eight cases:
success, empty download, archive-write failure, corrupt archive, target-copy
failure, failure after a real successful copy (lost receipt), chmod failure and
archive-cleanup failure. A private HTTP dependency serves disposable generated
tar.gz bytes; actual local tar extraction, target copies and filesystem cleanup
run inside a private bin directory. The target contains synthetic text and is
never executed. Injected filesystem faults use typed PlatformErrors rather than
claiming physical disk failure. Fixture setup must complete its HTTP response,
so a failed archive generator cannot masquerade as an expected install fault.

The cases verify source-worker download/extraction counts, exact target bytes,
scoped extraction-directory cleanup and expected retained archives. Failure
remains cached without replay after another writer creates successful target
metadata/bytes. Archive-cleanup failure preserves the existing successful
filepath result but retains refusal even after an unrelated cleanup removes the
archive. Cached reads and owner closure cannot clear that refusal. Restoring the
old ignored-cleanup settlement fails the typed archive-cleanup probe. All eight
cases passed **80 repeats**. This supersedes the preceding missing method-boundary
matrix, not its cross-owner/durable ownership or physical/provider limitations.

Final core passed **6,962 tests, 43 skipped, zero failures** (7,005 across 285
files), and all 35 workspace checks passed. Accepted logs use
`ripgrep-binary-install-*-final4.log`; the typed mutation probe is
`ripgrep-binary-install-cleanup-typed-red.log`. Earlier test-helper error-channel
and branded-exit-code type errors were corrected, not accepted as passing checks.
This is a test-only extension to the preceding runtime change; builds/server/SDK
were not rerun, and their preceding binary-authority results remain the latest
runtime validation.

Windows' zip/bsdtar path is explicitly outside this tar.gz fixture. Authentic
upstream binary integrity/execution, abrupt process/power-loss/commit boundaries,
failed native cleanup, cross-owner installation exclusion, persistent target
quarantine, authenticated owner/generation fencing and resource census/orphan
reconciliation remain unproven. No actual executable, installed runtime, global
setting or production movement flag was changed; the Goal remains incomplete.

Binary installation now persists a per-literal-target intent in native SQLite KV
before download/filesystem installation work. Keys use
`ripgrep-install-intent:v1:` plus SHA-256 of the target path; values contain only
the target and a random attempt ID. These are non-secret receipts, **not owner
credentials or generation grants**. Insert-if-absent claims the key for compatible
writers sharing this database. Failed/uncertain work leaves the record; only
successful installation and archive cleanup can retire its exact full value.
Changed receipts fail retirement without deleting replacement evidence.

Each owner reconstructs refusal before service publication and checks durable
evidence again before uncached acquisition/metadata adoption. Startup observation
and failed acquisition remain quarantined even if a different owner subsequently
retires the row. No automatic orphan clear, target adoption or installer replay
was added. Existing target bytes, an unrelated system rg and archive absence
cannot settle observed uncertainty.

The eight offline installation cases now close and reopen actual file-backed
SQLite connections with new service graphs. All unsuccessful/uncertain intents
remain refused before filepath admission even after target metadata/bytes are
made successful. Two additional live-connection cases cover a peer booted before
the intent and full-receipt replacement while the creator is paused in HTTP.
The prestarted peer refuses successful-looking target bytes without another
download/extraction; a peer's cached refusal survives winner completion. The
replacement case preserves the complete new encoded value and fails stale
retirement after the real copy/cleanup. Disabling startup reconstruction, fresh
checking or value CAS fails two, one and one probes respectively.

All ten cases passed **100 repeats**. Final sequential core passed **6,964 tests,
43 skipped, zero failures** (7,007 across 285 files), all 35 workspace checks,
both builds, server (85/one skip) and SDK (14). Accepted logs use
`ripgrep-install-intent-*-final2.log`; mutation probes end in
`-reconstruction-red.log`, `-refresh-red.log` and `-cas-red.log`. A test peer's
closeable-scope type was corrected before final validation; no assertions,
timeouts or warnings were weakened.

This is durable refusal/compatible-database coordination, not authenticated
owner fencing or global cross-process census. These cases use separate native
database connections and owner graphs **within one process**, not abrupt-process
or power-loss acceptance. Simultaneous absent-read/claim races, distinct databases,
target aliases/symlinks, incompatible writers, key/value ABA and provider effects
already in flight remain unresolved. Exact CAS cannot prevent those effects or
certify resource absence. Physical/destroy faults, Windows/native artifact
acceptance and approved resource release/re-establishment/receiver integration
remain required. Production flags, installed runtime and public APIs are unchanged.

Real subprocess coverage now includes explicit process exits after archive write,
target copy, chmod and archive removal. Effect finalizers are bypassed; two fresh
inspection processes reopen native SQLite and preserve refusal/evidence without
another install request. The copy/chmod cases retain the captured extraction
directory; the archive-removal case retains refusal despite successful-looking
target bytes and no archive. These are controlled process exits, not power-loss
or proof of detached-resource absence.

The new ordered two-process race exposed a concrete stale-plan bug: both owners
observed an absent target, the first completed and retired its intent, then the
delayed owner claimed the empty key and installed again. The pre-fix probe reports
two install requests rather than one (`ripgrep-install-generation-red.log`).

Native KV now retains a per-target completion witness under
`ripgrep-install-receipt:v1:` with the same non-secret target/attempt value shape.
An install plan captures the current full witness before metadata discovery.
Claiming validates that witness and inserts the intent in one transaction;
completion validates the predecessor again and updates the witness in the same
transaction as exact-value intent retirement. Thus a compatible stale planner
cannot mutate after a winner has retired its live intent. The witness is not
an authenticated epoch, native permission grant or resource-absence receipt.

Both simultaneous and winner-finishes-first process orderings now produce one
install request and extraction, with one refused owner and one retained completed
witness. Expected journal refusals remain typed binary errors rather than being
converted to database defects; the error-channel probe fails before that fix.
Two further offline cases prove rollback restores the live intent if completion-
receipt insertion fails, and a changed completion witness is preserved instead
of overwritten. Omitting retirement-witness validation fails the latter probe.

Final sequential validation passed **6,972 core tests, 43 skipped, zero failures**
(7,015 across 286 files), **60 process-case repeats**, **120 installation-case
repeats**, all 35 workspace checks, both builds, server (85/one skip) and SDK
(14). Accepted logs use `ripgrep-install-witness-*-final2.log`; additional red
probes are `ripgrep-install-witness-retirement-red.log` and
`ripgrep-install-witness-error-channel-red.log`. All child processes and IPC are
owned and joined; no polling sleeps, timeout increases or network downloads were
used. The candidate binaries were never executed and no models were called.

This establishes the tested compatible-same-database stale-plan/transaction
boundaries, not authentication, monotonic epochs, key/value ABA defense, target
alias equivalence, cross-database exclusion or fencing of effects already in
flight. Windows zip/bsdtar, authentic artifact integrity/execution, physical disk
or power-loss faults, all cleanup/commit interruption boundaries, dynamic
resource census/orphans and approved resource/receiver/production continuity
remain open. Installed runtimes, global settings, public APIs and production
movement flags remain unchanged; the full Goal is not complete.

Snapshot's lazy repository initializer and background object-pack workers now
acquire retained holds before dispatch. Shared initialization remains owned by
the Location, not a cancelled capture caller. Success releases only that worker's
hold after its Git effect/scoped cleanup returns; failure/interruption retains
refusal through later captures and owner disposal. Packing is single-flight and
an uncertain pack is not automatically retried merely because its interval is
due again. Existing best-effort capture results and warning handling remain.
Disposed owners refuse fresh capture/files/diff/restore entries, including empty
diff requests that otherwise avoid I/O.

Eight controlled lifecycle cases exercise success, failure, cleanup failure and
owner interruption for both workers over real disposable local Git repositories.
They prove caller cancellation does not replace shared initialization, cleanup
keeps refusal, successful captures cannot settle failed maintenance, and time
advancement cannot launch overlapping or uncertain pack retries. Native I/O
deadlines remain live: only the maintenance timestamp is controlled. The first
clock fixture incorrectly spread prototype methods and was corrected to delegate
them explicitly before acceptance. Omitting holds, active-pack refusal and
uncertain-pack refusal fails eight, four and two probes respectively.

All eight cases passed **80 repeats**. Final sequential core passed **6,980 tests,
43 skipped, zero failures** (7,023 across 287 files), all 35 workspace checks,
both builds, server (85/one skip) and SDK (14). Logs use
`snapshot-authority-*-final.log`; mutation probes end in `-hold-red.log`,
`-overlap-red.log` and `-retry-red.log`.

This is process-local background-worker fencing and post-disposal entry refusal,
not durable Snapshot/Git ownership, large-object native packing/disk-fault
acceptance or prevention of all already-in-flight Git effects. The fixtures
control Git dependency failure/cleanup boundaries; they do not prove native
process-tree termination. Direct foreground capture/compare/restore and other
raw Git callers still require acquisition/borrower audit, as do cross-process
census, authenticated owners/generations and orphan reconciliation. No installed
runtime, public API, global configuration or production movement flag changed.

Foreground Snapshot capture/files/diff/restore now acquire independent native
operation holds after shared repository initialization, before invoking their
Git phases. Comparison includes ignored-path filtering under the same hold.
Waiting for shared initialization creates no foreground ownership debt for a
cancelled caller; the initializer keeps its own worker hold. Successful native
completion releases only that operation. Failure/interruption remains refused
through later successful calls and owner disposal. Capture's existing best-effort
`undefined` result/warning behavior is outside this settlement boundary, so it
cannot turn a failed native phase into cleanup evidence.

Twelve controlled foreground cases cover success, typed failure and caller
interruption for all four operations over disposable real Git repositories.
They prove pending-cleanup refusal, preserved error channels/best-effort capture
results, cancellation waiting for the controlled cleanup, and independent
uncertainty after a later successful call. Pre-fix calls fail all twelve pending
refusal probes; unconditional release fails all eight failure/interruption cases.
The initial fixture used an invalid Git operation-error tag and was corrected to
the actual Git enum before final validation, without weakening assertions.

The full twenty-case Snapshot authority suite passed **200 repeats**. Final
sequential core passed **6,992 tests, 43 skipped, zero failures** (7,035 across
287 files), all 35 workspace checks, both builds, server (85/one skip) and SDK
(14). Logs use `snapshot-foreground-*-final.log`; negative probes are
`snapshot-foreground-red.log` and `snapshot-foreground-settlement-red.log`.

These are process-local operation boundaries and controlled dependency cleanup
observations, not native process/disk-fault acceptance, a durable Snapshot journal,
authenticated reconciliation or resource absence. Other raw Git callers,
underlying Git cleanup/packing behavior, cross-process resource census, target/
owner generations and orphan/approved receiver/production continuity still need
proof. Public APIs, installed runtime, global settings and movement flags are
unchanged; production movement remains disabled and the Goal is incomplete.

Raw Git temporary-index cleanup and its owned index/config temporary-file
finalizers now retain independent native holds before cleanup I/O. The existing
typed-error ignore policy stays intact, but ignored cleanup failure no longer
settles reservation authority. A valid tree result (including through the actual
Snapshot layer), later successful capture or unrelated deletion of the artifact
cannot release that failed cleanup's hold. Conversely, successful cleanup releases
its own hold even when the caller was interrupted while waiting for the
uninterruptible finalizer; invocation outcome is not the cleanup receipt.

The old temporary-index sweeper assumed old filename timestamps implied dead
creators. It now observes without deleting unowned indexes, retaining refusal
regardless of creation time or mtime. The observation hold spans both directory
I/O and candidate classification; a failed enumeration cannot be converted into
empty/clean evidence by the existing best-effort fallback or `preparedStores`
cache. The earlier age-deletion test was replaced with preservation of exact
live/legacy evidence and persistent refusal after external deletion/capture.

Five real local-repository cases cover successful/failed cleanup, caller
interruption, failed enumeration and integrated Snapshot success with an ignored
native cleanup failure. The temporary index is deliberately left by a controlled
rename failure, so the tests inspect a real artifact rather than a simulated
success flag. These passed **50 repeats**, and the unowned-index case passed
**10 repeats**. Omitting cleanup holds, observation holds or success-only
settlement fails four, two and two probes respectively. A fixture effect union
was explicitly widened to its observed string result before final type checks;
no runtime types, assertions or timeouts were weakened.

Final sequential core passed **6,997 tests, 43 skipped, zero failures** (7,040
across 288 files), all 35 workspace checks, both builds, server (85/one skip) and
SDK (14). Accepted logs use `git-cleanup-authority-*-final2.log`; negative probes
end in `-hold-red2.log`, `-observation-red2.log` and `-settlement-red2.log`.

This is process-local cleanup/observation fencing, not durable Git-owner recovery,
authentication or complete native resource census. Other ignored Git writes and
cleanup paths remain under audit. In particular, temporary-pack sweeping and
age-based pack-lock recovery still have unproven ownership assumptions and are
not accepted production safety ports. Native/disk/process faults, cross-process
exclusion, orphan reconciliation and approved receiver/production continuity
remain open. Installed runtimes, public APIs, global settings and movement flags
are unchanged; production movement stays disabled and the Goal is incomplete.

The subsequent raw-Git packing audit removes age-based pack-lock takeover and
temporary/unindexed-pack deletion. An old lock remains evidence, even when its
contents identify the currently live PID; failed exclusive creation retains
refusal rather than turning a skipped pack into clean ownership evidence. The
lock attempt holds authority before native write dispatch and installs its
cleanup with `acquireUseRelease`, so interruption cannot abandon the gap between
successful creation and finalizer registration. Successful removal settles only
that lock attempt; failed removal and lost write receipts remain refused. This
does not authenticate the PID or provide a compare-and-unlink primitive.

When packing crosses its existing work threshold, temporary/unindexed-pack
observation holds authority through directory I/O and candidate classification.
Unknown artifacts (regardless of age) or failed enumeration preserve evidence,
skip the pack and retain independent refusal. The existing tolerant void return
is not a cleanup receipt. Loose-object and replaced-pack cleanup also use
success-only independent holds before their existing ignored-error policy.

Ten real local-repository cases cross the unchanged loose-object threshold with
2,050 distinct blobs. They cover successful cleanup, old/recent locks, lost
lock-write receipt, old/recent temporary/unindexed pack evidence, failed pack
enumeration, lock/loose-object cleanup failure and interruption during acquisition
or finalization. They assert refusal before lock-write dispatch, preserved exact
foreign bytes, pack creation/skip, real retained artifacts and readable captured
content after a subsequent successful pack. External artifact removal, retry
success and owner disposal cannot settle prior uncertainty. These passed **100
repeats**. Missing lock/observation/lock-settlement/object-cleanup protections fail
three/two/one/one targeted mutation probes respectively.

Final sequential core passed **7,007 tests, 43 skipped, zero failures** (7,050
across 289 files); all 35 workspace checks, both builds, server (85/one skip) and
SDK (14) passed. Logs use `git-pack-authority-*-final.log`; mutation probes use
`-lock-red.log`, `-observation-red.log`, `-settlement-red.log` and
`-object-cleanup-red.log`. The preceding pack-age limitations are superseded only
for the specific paths described here.

Open gates still include authenticated owner/generation exclusion, dynamic
cross-process census, target aliases/other databases, orphan reconciliation,
compare-and-unlink against lock replacement, in-flight/incompatible writers,
initial loose/local-pack listing fallback below the work threshold, raw native
Git failure/descendant quiescence and durable process-death recovery. The combined
pack cleanup branch has nominal existing integration coverage, not injected
failure acceptance for every extension. These fixtures do not establish physical
disk/power-loss behavior, full backend cleanup or production movement authority.
No installed runtime, global settings, public Protocol/HttpApi or movement flags
changed. The Goal remains incomplete.

The next inventory milestone fences the initial object-root, loose-object
fanout and local-pack directory reads through candidate classification. The
shared success-only I/O helper now names that broader use (`trackedIO`), while
retaining all previous cleanup behavior. Failed listings produce an explicit
incomplete observation instead of an empty collection. Packing returns without
lock acquisition or native packing when any required listing is incomplete;
successful sibling fanouts cannot make a partial census complete. Each failed
read retains its own refusal before the existing tolerant void result, including
when the repository is below the work threshold. A later good listing/pack or
owner disposal cannot settle that failed observation.

Six new failure cases cover the three listing boundaries both above and below
the unchanged threshold, with a healthy below-threshold control. Large cases now
use 2,100 real distinct blobs so a single missing fanout still leaves enough
objects to trigger the partial-census regression. Tests check authority before
directory dispatch, exactly one injected typed fault, no lock attempts or packs
on incomplete input, retained refusal through later success/disposal and actual
captured file readability. The complete 17-case packing suite passed **170
repeats**. Omitting inventory holds fails six cases, unconditional settlement
fails six, and omitting the partial-fanout stop fails the above-threshold case.

Final sequential core passed **7,014 tests, 43 skipped, zero failures** (7,057
across 289 files), all 35 workspace checks, both builds, server (85/one skip) and
SDK (14). Logs use `git-inventory-authority-*-final.log`; targeted negative probes
use `-hold-red.log`, `-settlement-red.log` and `-partial-red.log`. This supersedes
the preceding initial-listing-fallback limitation only. Successful sequential
listings are not a coherent cross-process snapshot or global resource census;
the unowned-pack observer still runs only when packing meets its work threshold.
Owner authentication/exclusion, target aliases and incompatible writers, lock
replacement, old-graph/orphan recovery, raw native process quiescence, durable
Git recovery and complete cleanup-fault/platform/production continuity remain
open. No installed runtime, global settings, public API or movement activation
changed; the Goal remains incomplete.

The following preflight milestone makes the unowned temporary/unindexed-pack
observation independent of the packing work threshold. Once initial inventories
are complete, the observer runs before the work/no-work decision and runs again
after successful lock acquisition. A clean preflight cannot substitute for the
fresh under-lock observation. Below-threshold artifacts and failed preflight
enumeration retain refusal without lock/native pack dispatch; artifacts appearing
between preflight and acquisition are preserved and stop the selected pack.

Four added packing cases cover below-threshold artifact/observation failure and
late artifact/under-lock observation failure, including exact artifact bytes and
no-work/lock-attempt assertions. A new three-case combined-pack suite generates
16 independent real packs with Git, tests normal cleanup and injects typed
deletion faults on actual existing `.idx`/`.pack` files after replacement-pack
publication. Public packing still succeeds, while the failed artifact remains
byte-for-byte unchanged and its independent cleanup refusal survives external
deletion, subsequent success and disposal. Actual Git reads every original blob
and the captured file through the surviving replacement pack. The new fixture's
initial parenthesis syntax error was corrected before successful verification.

The 21 packing plus three combined-cleanup cases passed **240 repeats**. Removing
preflight, fresh under-lock observation or combined cleanup holds fails two
targeted cases each. Final sequential core passed **7,021 tests, 43 skipped, zero
failures** (7,064 across 290 files), all 35 workspace checks, both builds, server
(85/one skip) and SDK (14). Logs use `git-preflight-authority-*-final.log`; negative
probes use `-threshold-red.log`, `-freshness-red.log` and `-combined-red.log`.

This supersedes the preceding below-threshold-observer gap and adds actual
combined `.idx`/`.pack` cleanup-fault coverage, not all cleanup acceptance. Reverse
indexes, bitmaps and mtimes sidecar failures, standalone orphan indexes, every
publication/interruption boundary, native process/descendant quiescence and
physical/power-loss recovery remain unproven. Neither two local observations nor
the cooperative lock provide authenticated owners, monotonic generations,
cross-process exclusion/census, lock-replacement CAS or safe orphan recovery.
Approved release/re-establishment, complete destination authority, exact receiver
rebinding and production movement acceptance remain open. Installed runtime,
global settings, public API and movement activation are unchanged; the full Goal
remains incomplete.

The subsequent orphan/sidecar milestone extends the pack observer from temporary
files and unindexed packs to standalone `.idx`, `.rev`, `.bitmap` and `.mtimes`
artifacts. Any recognized artifact lacking its matching pack/index pair is
preserved and retains refusal before the work threshold and again under lock.
Matching names are only an observation filter, not authenticated ownership,
validated native contents or permission to reconcile/delete an orphan.

Twenty small-repository cases cover old/recent timestamps and absent pack,
index or both partners (where applicable). These use explicitly opaque evidence
bytes to test filename classification/preservation, not authentic native formats.
They assert exact surviving bytes, no lock dispatch and refusal surviving external
artifact removal, successful pack/capture and owner disposal. Limiting the
observer to `.pack` again fails **14** cases, while six existing missing-index
cases remain caught by the original unindexed-pack path.

Combined cleanup coverage now includes all five attempted extensions. Git creates
16 real pack/index/reverse-index groups; injected `.rev` deletion failure retains
an actual Git-generated reverse index. `.bitmap`/`.mtimes` tests instead install
clearly synthetic bytes at the cleanup boundary, after native packing, and fail
that deletion. No synthetic sidecar bytes are passed through native packing.
These prove ignored-error cleanup fencing, not native bitmap/cruft generation or
recovery. Removing combined cleanup holds fails all three new sidecar cases.
All original blobs and captured content remain readable via actual Git. The
fixture initially tried an unsupported `pack-objects` flag; it now uses the
supported `index-pack --rev-index`. Replacement reverse-index generation varies
by Git version, so tests require every surviving nonfailed reverse index to have
its pack/index partners rather than prescribing an optional output count.

The 20 orphan plus six combined-cleanup cases passed **260 repeats**. Final
sequential core passed **7,044 tests, 43 skipped, zero failures** (7,087 across
291 files), all 35 workspace checks, both builds, server (85/one skip) and SDK
(14). Logs use `git-sidecar-authority-*-final.log`; negative probes use
`-observer-red.log` and `-cleanup-red.log`. These results supersede only the
preceding standalone-orphan detection and tested sidecar cleanup-fault gaps.

Still unproven: authentic bitmap/cruft-pack fault recovery, every Git publication
and interruption boundary, complete native handle/descendant quiescence,
physical/power-loss and Windows acceptance, durable Git recovery, authenticated
owner/generation exclusion, lock-replacement CAS, cross-process census/aliases/
incompatible writers and safe orphan reconciliation. Evidence preservation is
not an approved release/re-establishment port. Complete destination authority,
same-conversation receiver binding and production movement acceptance remain
open. Installed runtime/settings/public APIs/movement flags are unchanged; the
full Goal remains incomplete.

The next raw-Git creation milestone owns an invocation hold before initializing
or reconfiguring repository storage. Typed failure/interruption cannot release
that invocation's uncertainty through a later successful create or graph
disposal. Publication rename and temporary-directory cleanup have separate
success-only holds: existing usable `HEAD` metadata may preserve the tolerant
adopt-destination result, but cannot replace a failed/lost rename receipt.
Similarly, an ignored cleanup error cannot be settled by the successful create
result. Known rename collisions may conservatively retain refusal; there is no
authenticated reconciliation path that promotes destination metadata into proof.

Six real local-repository cases cover normal initialization, failed initial and
existing-store configuration, a real successful rename with an injected lost
receipt, ignored cleanup failure and caller interruption during configuration.
They assert refusal while configuration is paused, public success/failure and
actual destination `HEAD` state, cleanup invocation and retained refusal after
later success/disposal. The cleanup fault is injected after successful rename,
where the temporary path may already be absent: this tests refusal on a failed
receipt, not proof that a particular native artifact remains. Removing the outer
acquisition hold fails six cases; omitting cleanup or publication holds fails
one case each.

The six creation and 20 existing Snapshot authority cases passed **260 repeats**.
Final sequential core passed **7,050 tests, 43 skipped, zero failures** (7,093
across 292 files), all 35 workspace checks, both builds, server (85/one skip) and
SDK (14). Logs use `git-create-authority-*-final.log`; negative probes use
`-acquisition-red.log`, `-cleanup-red.log` and `-publication-red.log`.

This is independent process-local acquisition/publication/cleanup observation,
not durable Git recovery, ownership authentication or a native cleanup census.
Optional best-effort seed-index copying and safe-existence observations remain
under audit; the outer successful result does not establish complete backend
cleanup. Concurrent incompatible writers, target aliases/replacement, all native
interruption boundaries, process/descendant absence, platform/power-loss faults,
owner/generation exclusion, orphan reconciliation and production movement ports
remain open. No public API, installed-runtime, global-settings or movement-flag
changes occurred. The full Goal is incomplete.

The subsequent seed/HEAD milestone distinguishes confirmed optional absence from
failed observations and uncertain copies. Creation now uses typed `exists` for
initial/fallback destination `HEAD` checks, mapping failures to `OperationError`
rather than treating them as false. Optional seed-index observation is likewise
typed: confirmed absence skips copying without a retained failed-copy hold;
observation failure stops creation. Once a copy is attempted, its own success-only
hold precedes the existing ignored-error policy. Copy failure, real source
disappearance after observation and a completed copy with an injected lost
receipt retain refusal even when creation still returns a usable repository.

Nine real local-repository cases cover absent/present seed, failed source
observation, copy failure/lost receipt/disappearance, initial/existing/fallback
HEAD observation errors. Assertions include exact dispatch counts, typed error
identity/message, actual destination HEAD/index state, byte-identical copied
index and refusal through later success/disposal. The absent-seed fixture
explicitly removes the optional index because this Git version creates one even
for the empty-root fixture. A test-only optional-byte type error was fixed with
an explicit fixture invariant, not by skipping the content assertion. The first
error-to-false mutation still passed the fallback case because an unrelated
publication error also failed creation; requiring the exact observation error
now makes all four observation mutations fail. Omitting copy holds fails three
cases; removing the absence skip fails one.

Seed, creation and Snapshot authority suites passed **350 repeats**. Final core
passed **7,059 tests, 43 skipped, zero failures** (7,102 across 293 files), all
35 workspace checks, both builds, server (85/one skip) and SDK (14). Core/check/
repeat logs use `git-seed-authority-*-final3.log`; builds/server/SDK use
`-final2.log` for the identical production source before the final test-only
error-identity strengthening. Accepted observation mutation is
`-observation-red3.log`; other negative probes are `-copy-red.log` and
`-absence-red.log`.

These specific seed-copy and HEAD fallback paths supersede preceding gaps only.
Existence is not authenticated identity, a coherent snapshot, cleanup proof or
destination authority. Sources/targets may still change after observation;
uncertain attempts are retained, not automatically reconciled. Other raw Git
fallbacks/publication/interruption paths, native handle/descendant quiescence,
durable Git recovery, physical/platform faults, authenticated owner/generation
exclusion, cross-process census/aliases/orphan reconciliation and approved native
release/re-establishment/receiver/production ports remain open. Installed runtime,
global settings, public APIs and movement flags are unchanged; Goal incomplete.

The next snapshot-config milestone fences tolerant read and write/publication
maintenance independently of successful capture. Reading `opencode.gitconfig`
now handles confirmed `NotFound` as the existing optional skip before success-only
observation settlement; permission/other read failures retain refusal before the
tolerant undefined fallback. The temporary write plus publication rename owns a
separate hold before dispatch, settled only after success. Existing ignored-error
and capture-result behavior remains intact; successful temporary cleanup cannot
settle failed/interrupted maintenance.

Eight real-repository cases cover success, absent config, denied read, a real
temporary write with injected failure, refused rename, actual rename with lost
receipt, and caller interruption while write/rename is paused. They assert native
dispatch ordering/counts, successful tree results where errors are tolerated,
actual config bytes, temporary cleanup and refusal surviving matching producer
bytes, prepared-store caching, later successful capture and owner disposal.
Removing read/write holds fails one/three probes, removing known-absence handling
fails its healthy case, and unconditional settlement fails four fault cases.

Config and Snapshot authority suites passed **280 repeats**. Final sequential
core passed **7,067 tests, 43 skipped, zero failures** (7,110 across 294 files),
all 35 workspace checks, both builds, server (85/one skip) and SDK (14). Logs use
`git-config-authority-*-final.log`; negative probes use `-read-red.log`,
`-write-red.log`, `-absence-red.log` and `-settlement-red.log`.

This closes only the tested config-observation/write/publication false-settlement
paths. Process-local refusal does not authenticate producers, prove complete
native cleanup or provide durable recovery. Temporary-index preparation/link/
copy/timestamp/publication and rebuild fallbacks remain under audit, alongside
other Git/native publication/interruption boundaries, native descendants,
physical/platform recovery, owner/generation exclusion, dynamic cross-process
census/aliases/orphan reconciliation and approved release/re-establishment,
destination authority and receiver/production continuity. Installed runtime,
global settings, public API and movement activation are unchanged; Goal incomplete.

The next temporary-index milestone removes the failed-link-to-copy fallback:
preparation now copies first into its own temporary name instead of risking a
copy into a name whose failed hard-link receipt may conceal a source alias. This
adds index-copy I/O but preserves the public capture result shape. An invocation
hold starts before index existence/preparation, and cleanup is registered before
filesystem preparation can fail. Typed index-existence errors are not false
absence. Copy/stat and ignored timestamp work retain independent failure holds.

Index publication is one fenced rename, not an automatic retry after uncertain
receipt (including the previous Windows sharing-violation retry path). A failed
publication can still return its already-written tree but retains refusal.
Invocation settlement requires completed work and successful temporary cleanup;
interruption during successful finalization does not itself negate an observed
cleanup receipt. Failed/interrupted work, ignored timestamp failure and uncertain
publication remain separate from that finalizer's success.

Ten new real-repository cases cover normal/absent index, failed observation,
copy failure/lost receipt, timestamp failure, publication failure/lost receipt
and copy/publication interruption. They inspect actual distinct source/copy
inodes and unchanged original index bytes before publication, zero hard-link
dispatch, exactly one publication attempt, cleanup after preparation failure and
refusal through later success/disposal. Missing invocation/publication/timestamp
holds fail one/two/one probes; restoring even one publication retry fails two.

The earlier cleanup-only fixture had deliberately failed rename to leave an
artifact; its healthy assertions would now incorrectly demand release of a
failed publication. It now performs a real successful rename followed by a
controlled copy-back of the temporary artifact, separating cleanup from
publication uncertainty without weakening refusal assertions. Index, cleanup
and Snapshot suites passed **350 repeats**. An initial misplaced local state
declaration during editing was corrected before successful verification.

The first full core run had **one Workspace subprocess-report JSON parse
failure** (`stale-destroy`/`delete-row`), not a passing verification. Ten targeted
repeats passed, and the subsequent unchanged-source full run passed **7,077
tests, 43 skipped, zero failures** (7,120 across 295 files). The transient report
parse failure remains unexplained; no Workspace test, timeout or diagnostic was
suppressed. All 35 workspace checks, both builds, server (85/one skip) and SDK
(14) passed. Core/build/server/SDK logs use `git-index-authority-*-final2.log`;
checks/repeats use `-final.log`. Failed full run is `-core-final.log`, diagnostic
repeats `-workspace-diagnostic.log`; negative probes use `-acquisition-red.log`,
`-publication-red.log`, `-timestamp-red.log` and `-replay-red.log`.

This supersedes tested temporary preparation/publication gaps only. Index
fingerprint/existence fallback and rebuild paths remain under audit; complete
native process/descendant quiescence, durable/physical/platform recovery,
authenticated ownership/generation exclusion, cross-process census/aliases/
orphan reconciliation and destination/receiver/production integration remain
open. Copy-first and single-attempt publication are not Windows acceptance or
coherent cross-process ownership. Installed runtime, global settings, public API
and movement activation are unchanged; Goal incomplete.

The subsequent fingerprint/rebuild milestone distinguishes a confirmed missing
fingerprint from failed metadata observation. Scan/publication fingerprint reads
now retain independent refusal on permission/other errors before their existing
undefined fallback; confirmed NotFound remains a healthy absence. Unreadable-index
existence probes likewise surface typed observation failure instead of false.

Rebuild registers temporary cleanup before seed observation/copy. Confirmed
optional seed absence preserves the existing empty-index rebuild, while failed
observation/copy now stops instead of falling through to deletion of the current
index. Rebuild invocation and tolerated publication/deletion attempts have
success-only holds. An ordinary successful rebuild can still return a readable
tree, but cannot settle the earlier failed capture's independent hold.

Twelve real-repository cases cover absent/failed scan/publication fingerprints,
actual corrupt-index repair, confirmed absent seed, source/probe observation
failure, copy failure/lost receipt, publication failure/lost receipt and rebuild
interruption. They assert typed error identity/message, no current-index deletion
on uncertain seed work, unchanged corrupt/source bytes, exact rebuild dispatch,
temporary cleanup after failed acquisition and actual readable tree content on
successful paths. Fingerprint-hold, failed-copy-fallthrough and missing-cleanup
mutations fail two/three/three cases respectively. Rebuild publication cases
prove outcomes and overall refusal; the preceding failed capture also holds
authority, so those cases alone do not isolate every retained lease's identity.

Rebuild, temporary-index and Snapshot suites passed **420 repeats**. Final
sequential core passed **7,089 tests, 43 skipped, zero failures** (7,132 across
296 files), all 35 workspace checks, both builds, server (85/one skip) and SDK
(14). Logs use `git-rebuild-authority-*-final.log`; negative probes use
`-fingerprint-red.log`, `-fallthrough-red.log` and `-cleanup-red.log`. The prior
Workspace report-parsing failure did not recur in this full run; it remains
unexplained, not silently declared repaired.

These results supersede tested fingerprint/rebuild false-settlement and
failed-copy fallthrough gaps only. Native-Git status/exit observations and seed
absence do not authenticate owners, exclude other writers or authorize global
cleanup/capacity reclamation. Coherent identity/CAS across current-index changes,
complete native process/descendant cleanup, durable/physical/platform recovery,
owner/generation exclusion, dynamic resource census/aliases/orphan reconciliation
and approved release/re-establishment/destination/receiver/production ports remain
open. Installed runtime, global settings, public APIs and movement flags are
unchanged; Goal incomplete.

The next native-process milestone introduces an optional invocation-scoped
`ProcessObservation` sink in Util (no Core dependency or authority grant). The
cross-spawn backend reports unresolved ownership **before** abandoning inherited
stdout/stderr at its existing one-second post-exit deadline. The event carries
no command, arguments, paths, credentials or transcript content. Missing events
are not a clean-process-tree assertion.

Git supplies that sink for its `AppProcess.run` calls and acquires an invocation
hold before backend dispatch. Backend failure/interruption retains that hold
even when a query's existing fallback returns undefined. A successful backend
return settles only its invocation hold: an unresolved-output observation owns
a separate retained hold which later query success or Git-owner disposal cannot
clear. No process kill, capacity reclamation, retry or permission is granted.

Four controlled Git cases verify pre-dispatch refusal, exact observer wiring,
normal results, backend failure, interruption and retention across later success/
disposal. One real local backend case spawns a parent that exits zero while a
detached descendant retains inherited pipes and a live fixture TCP connection.
It verifies uncertainty is emitted before successful return while that connection
is still live; fixture socket EOF ends the descendant without a PID-based cleanup
grant. This exercises actual backend deadline behavior plus controlled Git
wiring, not a production Git hook/plugin descendant census. Omitting invocation
holds/wiring/deadline emission fails three/one/one probes.

An initial extension also reported best-effort process-group cleanup errors.
The full core run rejected it with **62 failures**: that existing backend policy
attempts group cleanup after ordinary nonzero exits and can fail on an already
exited group. That extension was removed from this milestone, not accepted as
blanket permanent refusal and not hidden by changing healthy assertions. The
existing ignored-cleanup policy remains unchanged and explicitly unproven. The
accepted bridge covers output-abandonment observations and Git invocation errors
only; successful return still does not prove all backend cleanup or descendants.

The five cases passed **50 repeats**. Final sequential verification passed
**7,094 core tests, 43 skipped, zero failures** (7,137 across 297 files), Util
(95), all 35 workspace checks, Util/Core/Server builds, server (85/one skip) and
SDK (14). Accepted logs use `git-process-observation-*-final2.log`; the rejected
cleanup-reporting experiment remains in `-core-final.log`. Negative probes use
`-hold-red.log`, `-wiring-red.log` and `-deadline-red.log`.

Open gates include ignored process cleanup/kill errors, quiet or detached
descendants that do not retain pipes, all raw spawn/stream/non-Git callers,
closed-owner acquisition, complete native resource census, authenticated
owner/generation exclusion, durable/physical/platform recovery, orphan/alias
reconciliation, approved native release/re-establishment and destination/receiver/
production integration. The prior Workspace report-parsing flake also remains
unexplained. Installed runtime, global settings, public Protocol/HttpApi and
movement activation are unchanged; Goal incomplete.

The subsequent local-owner milestone binds every public Git entry to its captured
runtime Scope. Fresh calls and lazily constructed effects refuse a closed owner
before filesystem/backend access, including pure/empty-result paths. Mutex-owned
work rechecks after acquisition; native process dispatch checks again before
retaining/launching an invocation. Cleanup of already-owned temporary files is
not routed through the fresh-entry guard and remains permitted during teardown.

One real-repository matrix covers all **23 public entry points**, both newly
called and constructed before closure (46 refused attempts). Monitored filesystem
and process boundaries remain untouched; regression safety refuses those test
boundaries rather than actually fetching, resetting or deleting if an entry guard
is missing. A second deterministic case pauses an actual index copy, queues
another capture, closes the owner and resumes: active work cleans its temporary
file, no new backend call starts, and queued work cannot acquire a second copy.
Removing entry, mutex-recheck or dispatch guards fails one targeted case each.

The first full core run rejected four fixtures that extracted `Git.Service` via
`Effect.provide`, immediately disposed the native layer, then reused its methods
in an instrumented replacement. RepositoryCache and Snapshot fixtures now build
their native contexts into the calling test Scope with `Layer.build`; the two
similarly extracted Flock helpers were corrected too. Production guards and all
existing assertions/timeouts remain intact. This is a fixture lifetime fix, not
permission for services to outlive their owner. Initial failed full log is
`git-owner-authority-core-final.log`.

Owner/process/Snapshot authority suites passed **270 repeats**, and five corrected
fixture paths passed **50 repeats**. Final sequential core passed **7,096 tests,
43 skipped, zero failures** (7,139 across 298 files), all 35 workspace checks,
Core/Server builds, server (85/one skip) and SDK (14). Final logs use
`git-owner-authority-*-final2.log`; authority repeat log uses `-repeated-final.log`.
Negative probes are `-entry-red.log`, `-queue-red.log` and `-dispatch-red.log`.

This is process-local lifetime exclusion, not authenticated cross-process owners
or monotonic generations. Already-in-flight filesystem/provider effects still
need resource-specific reconciliation; the entry/queue checks do not prove
global quiescence or release an old graph's retained uncertainty. Ignored process
cleanup/kill errors, quiet descendants, other native callers, dynamic census,
durable/platform recovery, aliases/orphans and approved release/re-establishment,
destination authority and receiver/production integration remain open. The prior
Workspace report-parsing flake remains unexplained. Installed runtime, global
settings, public Protocol/HttpApi and movement activation are unchanged; Goal
incomplete.

The next verification milestone replaces Workspace journal fixture evidence on
stdout with typed, invocation-bound IPC. Human-readable stdout remains captured
for diagnostics; neither whole-output JSON parsing nor last-line extraction
selects evidence. Pause/report envelopes bind Workspace ID and fixture mode,
require valid schema/phase and at most one report, and quarantine malformed,
mismatched or duplicate messages instead of falling back to healthy values.
The child installs its acknowledgement listener before sending the report and
waits for the matching acknowledgement before exit, avoiding evidence/exit
ordering assumptions. This acknowledgement confirms fixture receipt only, not
production task acceptance, cleanup, capacity or native ownership.

All existing journal assertions about rows, intents, bindings, resources, provider
effects, restart and refusal remain intact, as do exit/stderr checks. Abrupt-exit
cases may have no report and cannot produce healthy defaults. A real-process
regression deliberately emits multiline logs and valid-looking healthy JSON
before and after the actual unresolved report; only IPC evidence is accepted.
Twelve schema/collector cases cover missing/malformed reports, wrong identity or
mode, excess fields, duplicate evidence, pause ordering and unexpected messages.
Returning to stdout parsing fails the noisy-process case; dropping binding or
duplicate guards fails two/one cases.

The complete journal/collector suite passed **45 tests**, and noisy-output,
previously affected stale-destroy and collector paths passed **140 repeats**.
Final sequential core passed **7,109 tests, 43 skipped, zero failures** (7,152
across 299 files), all 35 workspace checks, Core/Server builds, server (85/one
skip) and SDK (14). Logs use `workspace-report-ipc-*-final.log`; negative probes
use `-stdout-red.log`, `-binding-red.log` and `-duplicate-red.log`. No timeout,
assertion or logging policy was weakened. This closes a reproduced transport
ambiguity; the exact historical transient parse failure was not captured well
enough to establish that it had this cause, and is not retroactively reclassified.

Production native source, ownership/recovery semantics, installed runtime,
settings, public Protocol/HttpApi and movement flags did not change in this
milestone. Fixture IPC correlation is not authenticated cross-process execution
ownership or a census/reconciliation port. Ignored native cleanup errors, quiet
descendants, in-flight/old-graph reconciliation, authenticated owner/generation
exclusion, dynamic resource census, durable/platform recovery and approved native
release/destination/receiver/production acceptance remain open; Goal incomplete.

The next local continuation milestone checks the captured Git-owner lifetime at
the delegated filesystem entry points Git uses, not just at public entry,
mutex acquisition and process dispatch. A provider operation which finishes
after owner closure cannot authorize the next Core-delegated read/copy/timestamp/
write/rename/remove phase. Owned temporary-directory/index/config and acquired
pack-lock finalizers intentionally use the backing filesystem so teardown does
not prevent their own cleanup. Their existing success-only/uncertain settlement
rules remain intact; this bypass is not exposed as a general cleanup grant.

Seven deterministic real-repository cases pause after actual index stat/copy/
publication fingerprint, config read/write and store directory/config creation.
The owner closes before that result returns to Core; resuming dispatches no
subsequent ordinary filesystem/backend call, leaves original index/config bytes
unchanged, removes the owned temporary artifact and retains failed worker
uncertainty. Removing filesystem phase guards fails six cases; the seventh
continues to be blocked by the existing native-process guard. Routing index
cleanup through the closed-owner admission guard instead fails the cleanup case.

Continuation, public-owner and cleanup suites passed **140 repeats**. Final
sequential core passed **7,116 tests, 43 skipped, zero failures** (7,159 across
300 files), all 35 workspace checks, Core/Server builds, server (85/one skip)
and SDK (14). Logs use `git-owner-continuation-*-final.log`; negative probes are
`-phase-red.log` and `-cleanup-red.log`.

This closes only tested Core-to-filesystem handoffs. It does not cancel or census
already-entered provider work, including internal multi-step FSUtil helpers, or
establish that native I/O settled after interruption. Cleanup target identity/CAS,
incompatible writers/aliases, durable intent recovery, old-graph resources,
ignored process cleanup/quiet descendants, authenticated owner/generation
exclusion, dynamic cross-process census, platform/power-loss acceptance and
approved release/destination/receiver/production ports remain open. Historical
Workspace report parsing ambiguity is guarded by the preceding fixture IPC
milestone, not retrospectively diagnosed. Installed runtime, global settings,
public Protocol/HttpApi and movement activation are unchanged; Goal incomplete.

The next filesystem-settlement milestone keeps each admitted Git mutation
delegation (directory creation, write, copy, timestamp, rename, removal)
uninterruptible until its provider effect settles, with its own success-only
native I/O hold acquired before dispatch. The owner check still precedes
admission. This defers caller interruption instead of abandoning a callback and
starting temporary cleanup while that mutation may still be running. Reads
retain their existing policies; owned finalizers retain their backing-filesystem
access and cannot settle separate failed worker/publication observations.

A real POSIX FIFO regression routes a config temporary write through native
FSUtil with fixture-only valid comment padding exceeding pipe capacity. Reading
one byte proves kernel I/O started. After interruption is requested, cancellation
and temporary cleanup remain pending and the FIFO exists; draining verifies
every payload byte, then cancellation completes, cleanup runs exactly once,
publication never starts, original config bytes remain unchanged and the
interrupted maintenance worker remains refused. The test drains/closes its
descriptor even on assertion failure. Its first cleanup counter measured effect
construction instead of execution; moving that counter into the effect corrected
the fixture without changing the expected cleanup count.

Three direct restore-deletion cases isolate the new mutation hold without an
outer Snapshot worker: normal success settles, typed failure and an actual
deletion with injected lost receipt retain refusal across subsequent successful
restore/disposal. Removing the mutation wait fails the actual FIFO case; removing
its I/O hold fails both deletion-failure cases. Windows has no POSIX FIFO and
remains an explicit separate native-callback/cleanup acceptance gate.

Existing config/create/rebuild/index interruption fixtures now fork cancellation,
assert it remains pending, release the controlled provider receipt, then await
interruption. An admitted rename can commit before cancellation is delivered;
that fixture now asserts the exact committed config bytes while still requiring
retained worker refusal. No timeout or assertion was suppressed. The five suites
passed **400 repeats**. Final sequential core passed **7,120 tests, 43 skipped,
zero failures** (7,163 across 301 files), all 35 workspace checks, Core/Server
builds, server (85/one skip) and SDK (14). Logs use
`git-fs-settlement-*-final.log`; negative probes are `-wait-red.log` and
`-hold-red.log`.

Provider settlement is not physical durability, authenticated cleanup, target
identity/CAS or process-tree absence. An unresponsive admitted provider can keep
cancellation pending; no timeout, unrelated success or Scope closure forces its
lease clear. Read/helper lifetimes, ignored native process cleanup, quiet
descendants, old-graph/alias/orphan recovery, authenticated owner/generation
exclusion, dynamic cross-process census, platform/power-loss recovery and approved
release/destination/receiver/production ports remain open. Installed runtime,
global settings, public Protocol/HttpApi and movement activation are unchanged;
Goal incomplete.

The next read/helper-settlement milestone defers interruption through admitted
Git filesystem reads and upward discovery helpers. Required file/directory,
existence and discovery delegations acquire success-only I/O holds; optional
fingerprint/config reads keep their existing caller-owned error/NotFound
classification while waiting for provider settlement. This prevents cancellation
from abandoning an admitted read callback without turning normal optional
absence into a new failed-resource lease.

A real POSIX FIFO case supplies a Node `readFile` promise through the FSUtil
port, writes a pipe-buffer-exceeding payload but withholds EOF, then requests
cancellation and closes the Git owner. The native promise and cancellation remain
pending; no write starts. After EOF, the full read payload is observed before
interruption returns, with prior uncertainty retained. The fixture explicitly
awaits its native promise even in the negative cancellation probe, so descriptor
and temp teardown cannot abandon that read. This tests the Core/provider
boundary with actual Node/kernel I/O, not every default backend or platform.

Two actual 16-pack cases isolate required-index read failure and an actual read
with injected lost receipt: no pack command is dispatched, every original pack
artifact remains byte-identical, the acquired lock is cleaned, and refusal
survives subsequent successful packing/disposal. Removing the read wait fails the
FIFO case, removing the required-read hold fails two pack cases, and blanket
failed-I/O leasing of optional stat/string absence fails two healthy controls.

Read, pack-read, config and rebuild suites passed **230 repeats**. Final
sequential core passed **7,123 tests, 43 skipped, zero failures** (7,166 across
303 files), all 35 workspace checks, Core/Server builds, server (85/one skip)
and SDK (14). Logs use `git-read-settlement-*-final.log`; negative probes use
`-wait-red.log`, `-hold-red.log` and `-absence-red.log`. Windows FIFO/descriptor
acceptance remains separate, not waived by these fixtures.

An admitted helper can still perform internal provider work before returning;
waiting is not per-handle census, physical durability, cleanup authentication,
coherent source/target identity or global quiescence. Unresponsive providers can
retain pending cancellation. Other source/helper error policies, old-graph
reconciliation, ignored process cleanup/quiet descendants, authenticated owner/
generation exclusion, dynamic cross-process census/aliases/orphans, durable/
platform recovery and approved release/destination/receiver/production ports
remain open. Installed runtime, global settings, public Protocol/HttpApi and
movement activation are unchanged; Goal incomplete.

The next internal-helper milestone adds an optional refusal-only filesystem
boundary check in Util, with no Core dependency. `FSUtil.up` checks it before
every target lookup, including file/directory predicates and subsequent targets
within one directory. Git binds its captured owner lifetime to that helper
invocation. A lookup result which finishes after owner closure cannot authorize
the helper's next target or ancestor lookup. Successful checks confer no path
permission, owner identity, cleanup receipt or resource-absence grant; callers
without the optional observer retain their existing behavior.

Nine cases exercise actual FSUtil code over monitored native FileSystem calls:
exists/file/directory predicates stop after a paused first result when the check
is revoked; unobserved controls still find their target; an initially refusing
check permits zero lookups for all three kinds. Two real Git nested-directory
cases prove live-owner discovery remains functional while owner closure stops
internal ascent before a second filesystem call or any Git command. The helper
refusal is not converted into a healthy missing-repository fallback, and prior
uncertainty remains held. Removing the internal check fails five cases (four
controls still pass); removing Git's binding fails its owner-closure case.

Helper, continuation and native-read suites passed **170 repeats**. Final
sequential core passed **7,132 tests, 43 skipped, zero failures** (7,175 across
304 files), Util (95), all 35 workspace checks, Util/Core/Server builds, server
(85/one skip) and SDK (14). Logs use `git-helper-boundary-*-final.log`; negative
probes use `-check-red.log` and `-wiring-red.log`.

This covers only observed upward-helper boundaries, not all FSUtil helpers or
arbitrary providers. An already-entered native lookup is still allowed to settle;
the check is not atomic OS exclusion, authenticated owner/generation fencing,
coherent path identity, native descriptor census or quiescence. Unresponsive
provider callbacks, other helper/source policies, ignored process cleanup/quiet
descendants, old-graph/alias/orphan recovery, dynamic cross-process census,
durable/platform/power-loss acceptance and approved release/destination/receiver/
production ports remain open. Installed runtime, global settings, public
Protocol/HttpApi and movement activation are unchanged; Goal incomplete.

The next directory-helper milestone checks the optional refusal-only boundary
before `FSUtil.ensureDir` starts mkdir and again before its existing recursive
`AlreadyExists` directory-stat fallback. Git now binds the captured owner Scope
to both of its multi-step Util helpers through one internal wrapper. An admitted
mkdir callback which returns after owner closure cannot authorize that fallback
lookup; the next process-dispatch guard is not used as a substitute for stopping
the earlier metadata delegation. Live and unobserved helper behavior is preserved.

Six cases cover unobserved/live workaround success, revocation before fallback,
initial refusal before any provider call and real Git create with live/closed
owners. They perform actual directory creation and inject the `AlreadyExists`
callback before the fallback boundary. The closed Git case performs no fallback
stat or init command, cleans its owned temporary directory and retains refusal;
the live case completes a usable store and settles its own work. Removing the
fallback check, Git binding or initial check fails two/one/one probes. This is
controlled callback coverage, not acceptance of the actual Windows-native bug.

Directory, upward-helper and continuation suites passed **220 repeats**. Final
sequential core passed **7,138 tests, 43 skipped, zero failures** (7,181 across
305 files), Util (95), all 35 workspace checks, Util/Core/Server builds, server
(85/one skip) and SDK (14). Logs use `git-directory-boundary-*-final.log`;
negative probes use `-fallback-red.log`, `-wiring-red.log` and `-initial-red.log`.

The checks are cooperative local lifetime boundaries, not atomic OS exclusion,
directory identity/CAS, ownership authentication, cleanup approval or a complete
provider census. Other provider/internal-helper behavior, unresponsive callbacks,
ignored process cleanup/quiet descendants, old-graph/alias/orphan reconciliation,
authenticated owner/generation exclusion, dynamic cross-process census,
durable/platform/power-loss acceptance and release/destination/receiver/production
ports remain open. Durable notification/acknowledgement workflows and the other
non-native roadmap gates are not satisfied by these helper tests. Installed
runtime, global settings, public Protocol/HttpApi and movement activation remain
unchanged; Goal incomplete.

The process-stop observation milestone distinguishes active/explicit stop
failure from already-completed command cleanup. Standard-command acquisition
captures the invocation's optional ProcessObservation sink. Explicit handle stop
failure and active scoped-stop failure/defect notify it before returning the
failed receipt, including when a caller subsequently ignores a typed failure.
The existing post-exit best-effort group-signalling policy is unchanged: neither
its success nor its ignored failure establishes cleanup authority. Successful
stops do not notify or retract any prior uncertainty. No command arguments, error
details or credentials are added to the observation.

Eight native-process cases cover four completed-exit/force-cleanup controls,
explicit failure after an observed exit, captured-sink identity despite a
different caller sink, successful active stop, unobserved failure and an active
finalizer native invalid-signal defect. The latter is POSIX-only because Windows
taskkill does not use the signal argument. Its child is explicitly stopped with
a valid signal afterward; the uncertainty is retained. This exercises an actual
native defect, not every typed OS kill error or a full process-tree census.
Removing notification fails two cases; overbroad reporting for completed forced
cleanup fails one control. Process suites passed **350 repeats**.

Final sequential core passed **7,146 tests, 43 skipped, zero failures** (7,189
across 306 files), Util (95), 35 workspace checks, Util/Core/Server builds, server
(85/one skip) and SDK (14). Logs use `process-stop-observation-*-final.log`;
negative probes use `-hold-red.log` and `-completed-red.log`. Initial typechecking
found two branded ExitCode assertion mismatches in the new test; those were
corrected, and the accepted check is `-check-fixed-final.log`.

Remaining process gates include launch-before-acquisition cancellation,
best-effort post-exit cleanup, quiet/detached descendants, per-descriptor release,
typed OS cleanup-error coverage and Windows acceptance. Stop settlement and this
observation are neither authenticated cleanup nor process-tree absence. Full
owner/generation exclusion, dynamic census/aliases/orphan reconciliation,
durable/platform recovery, approved resource re-establishment, destination and
exact receiver/production ports, and the non-native roadmap gates remain open.
Installed runtime, global settings, public Protocol/HttpApi and movement remain
unchanged; Goal incomplete.

The subsequent typed-stop milestone maps a synchronous `proc.kill(signal)` throw
through the same `PlatformError` failure channel as a false kill result. The
single-process fallback no longer lets native invalid-signal errors escape as
Effect defects. Explicit stop still returns a failed receipt, and the captured
invocation sink is notified first, even when a different observer is supplied by
the later caller. Group-stop fallback/escalation policy is unchanged.

An active finalizer now treats that throw as the existing typed, best-effort stop
failure: it retains uncertainty but does not turn scope closure into a defect.
Successful scope closure is therefore explicitly **not** proof of successful
native stop, descriptor release or process-tree absence. A subsequent valid stop
does not retract the earlier uncertainty. The already-completed command cleanup
controls remain healthy; no broad post-exit failure reporting was reintroduced.

One new real POSIX invalid-signal case verifies exactly one typed failure with
ChildProcess/kill metadata and its original Error cause, captured-sink isolation
and retained uncertainty through valid cleanup. The prior active-finalizer case
now verifies typed best-effort settlement with the retained sink rather than
expecting an escaped defect. Both fixtures retain their child handles and perform
valid-signal cleanup. Reverting the error mapping fails both cases. Windows uses
taskkill instead, so these invalid-signal faults do not prove its behavior.

Final sequential verification passed **7,147 core tests, 43 skipped, zero failures**
(7,190 across 306 files), **410 process/Git-observer repetitions**, Util (95), all
35 workspace checks, Util/Core/Server builds, server (85/one skip) and SDK (14).
The server's existing listener warnings remain visible. The generated patch
changed only its two intended source/test sections and passed pinned-base forward
application in an isolated index, reverse application and whitespace checks.
Accepted logs use `native-kill-typed-*-final.log`; the negative probe is
`native-kill-typed-red.log`. No timeouts, healthy assertions or warnings were
weakened/suppressed.

Launch-before-acquisition cancellation remains unproven: acquisition currently
runs uninterruptibly, so inspection alone does not establish callback-cleanup
reachability, observation completeness or resource settlement at that boundary.
No speculative cancellation adapter was added. Permission-denied/OS-specific kill
faults, best-effort post-exit cleanup, quiet/detached descendants, per-descriptor
census/release, authenticated owners/generations, old-graph/orphan/alias recovery,
durability/platform acceptance and approved release/re-establishment/destination/
exact receiver/production integration remain open. No installed runtime, global
configuration, public Protocol/HttpApi or movement activation changed. Goal incomplete.

A reservation creates no durable execution claim, changes no session placement
and admits no model prompt. Tests retain real durable inbox admission while the
drain is reserved. These tests use upstream service layers and a controlled
runner. Additional native facade tests use a real child shell and controlled
local LLM response, without paid model calls. A controlled projected move checks
shell placement reload; it is **not** an approved native movement or receiver
continuity proof.

## Native movement intent and destination preparation

The next stage introduces `SessionMovement` as a native global service and
`MovementFence` as durable refusal state. Its internal activation factory captures
the authorized plugin identity, source Location, activation Scope, native server
incarnation and a monotonic SQLite-backed activation generation. Only the exact
live activation can replay its preparation; replacement activations, closed
Scopes, different destinations and generation exhaustion refuse. Callers supply
the transition ID and destination, never an owner identity or authority digest.
The factory is not exposed through PluginHost, public Protocol, HTTP or plugin
RPC. Its authorization argument remains a native host responsibility, pending an
explicit compatible-runtime and extension-authorization contract.

Preparation takes the real idle/stable reservation, revalidates actual Session
ownership before and after asynchronous storage, and commits an insert-only
quarantine intent. It neither changes placement nor releases quarantine. Actual
SessionInbox admission checks the fence inside its SQLite transaction; execution
resumes, auxiliary activity, drains and advisory wakeups also check it. The
coordinator checks again before starting lifecycle work, including wakeups queued
before quarantine. Restart skips quarantined claims and background recovery,
retaining attempt counts, pending input and child claims. Activation shutdown and
native service reconstruction cannot erase the durable refusal.

Persistent SQLite triggers protect the current native session, inbox, legacy
pending, message, event and event-sequence tables. They refuse writes for held
Sessions even when the writer never loads this extension. A real independent Bun
SQLite process is refused after the original native database closes, and the
replacement native graph still observes the same intent and pending admission.
These triggers protect these schema mutations; they do not establish that an old
process has stopped native I/O, that another version cannot migrate/drop their
tables, or that every schema is compatible. The current migration loader ignores
unknown completed migration IDs, so adding a migration marker alone would not
provide a downgrade gate. A compatible-runtime ownership/storage gate remains
mandatory before any capability exposure.

`SessionContext.previewPlacement` shares the runner's actual agent, tool and
instruction selection implementation while projecting a candidate into the
current native Location. Ordinary `select` retains its stored-placement guard.
`prepareDestination` requires the exact persisted owner intent, retains the
actual destination graph in the activation Scope, awaits native plugin activation,
and resolves its instructions and model. A real two-directory fixture proves
source/destination AGENTS discovery and unchanged durable Session identity.
Preparation reports explicit unresolved resource release, permission/request
hooks, executable registry provenance, runtime ownership and receiver authority;
it never marks the candidate execution-eligible.

Focused final verification passed **162 tests across six files**. This includes
healthy admission/reservation paths, actual SQLite close/reopen, a separate
unaware writer, activation replacement, exact replay, generation exhaustion,
close-during-native-store-read refusal and destination selection. The generation,
async lifetime, interrupt-resume and unaware-writer regressions were observed
failing before their fixes. No installed runtime or global setting was changed.
Owner-authorized placement commit, exact destination receiver acknowledgement and
the production broker/task/report/master acceptance fixture remain unimplemented;
this bounded stage does not complete gate 2.

After freezing this stage's native source, the full core suite passed **7,156
tests, 43 skipped, zero failures** (7,199 tests across 308 files, 266 seconds),
canonical workspace checks passed all 35 tasks, the server passed 85 tests with
one skip, embedded SDK tests passed all 14, and the Core build passed. Logs are
`/tmp/native-movement-{core,check,focused,server,sdk,build}-final.log`. The exported
patch matches the frozen checkout diff and passed pinned-base isolated-index
forward application, worktree reverse application and whitespace checks.

Earlier validation commands incorrectly replaced the host PATH: macOS Bash 3.2
then failed six conditional-substitution cases, missing ripgrep caused refused
download attempts/timeouts, and the server's Darwin descriptor test could not
find `lsof`. Those runs are not passing evidence. Preserving the installed tools
and prepending only the required Bun/Node locations restored the healthy shell
and server paths; no production behavior or assertion was weakened. A preceding
full run also passed but began before source freeze and is retained separately
as `/tmp/native-movement-core-before-freeze.log`.

The subsequent native ownership step adds nonserializable capabilities registered
in a private WeakMap and bound to the exact Database object, durable intent,
activation Scope and generation. Only that capability can enter
`SessionExecution.withMovementReservation` while quarantine remains held.
`Activation.withReservation` checks the native owner and exact transition before
and after its callback; it is not an I/O permission or movement grant.
`prepareDestination` now performs its final native selection under this owned
reservation, after graph boot and plugin activation have settled. Copying real
owner fields into JSON cannot forge the capability; wrong transitions and stale
or replacement activations execute no callback and leave quarantine intact.

After freezing this ownership step, focused verification passed **163 tests**,
full Core passed **7,157 tests, 43 skipped, zero failures** (7,200 tests across
308 files, 278.19 seconds), canonical checks passed all 35 tasks, the server passed
85 tests with one skip and the Core build passed. Logs use
`/tmp/native-movement-owned-{core,check,focused,server,build}-final.log`.
Controller transfer out of the source activation, session-owned resource receipts,
complete effective authority, native placement commit and receiver continuity
still remain required. Shared Location graphs must remain usable by unrelated
Sessions; closing one shared graph is not an acceptable substitute for proving
the moving Session's own resource release.

The next resource step connects `Activation.releaseModelTransport` to the actual
process-global Session transport under the authenticated movement reservation.
It holds cached and future bindings for exactly that Session while unrelated
Sessions keep their connections. Every attempted acquisition is retained until
its native socket reaches `CLOSED` and its reader settles. Failed acquisitions,
custom connector close callbacks and the five-second release timeout cannot
produce successful absence evidence. Native closure observation is registered
privately by the AI socket adapter; sending `close()` alone is insufficient.
Already verified closures are reclaimed, including ordinary closes and rotations,
so healthy traffic does not accumulate the new resource ledger. Late native
connections remain owned and must close before release succeeds.

This result covers only the `session-model-websocket` resource family. It does
not release quarantine, authorize destination execution, grant movement, close
shared Location graphs, or adopt another runtime incarnation. Failed acquisition
settlement still requires additional native handshake ownership work. Other
session-owned resources, durable process ownership, complete effective authority,
placement commit and exact receiver acknowledgment remain unresolved.

This resource step passed 130 focused Core tests across six files, 42 AI executor
tests and Core/AI typechecks. Logs are
`/tmp/native-movement-transport-focused-final3.log`,
`/tmp/native-movement-transport-ai-focused.log`, and
`/tmp/native-movement-transport-{core,ai}-typecheck.log`.
The canonical 35-task check passed before the final ledger reclamation refinement;
the final focused run and Core typecheck include that refinement. The full Core
result above belongs to the preceding ownership step and is not evidence for
this later source snapshot.

The following native storage step adds a dedicated rollback-journal SQLite
sidecar with a kernel-held exclusive transaction. Connection scopes in the same
process share that lease. Pausing a process cannot expire it; process death
releases it. An explicit internal `Database` option selects the movement-capable
Node SQLite adapter under Bun 1.4.2, whose Bun SQLite adapter lacks native SQL
function registration. The ordinary Bun adapter remains available; workerd
refuses this filesystem-dependent movement capability.

`SessionMovement.prepare` now requires that compatible connection and persists
separate Session protection alongside quarantine. SQL triggers require an
adapter-registered connection function for protected writes; that protection
continues when no quarantine marker exists. Native execution/admission also
checks connection authority after quarantine clears. Startup validates the
storage protocol before migrations and binds its connection to the actual stored
placement. A newer protocol, an incompatible adapter, changed main-file identity,
or symlink/hard-link aliases refuse authority. Compatible native storage acquires
the kernel lease at startup and keeps it for the process lifetime, including
before any protected Session exists. One native runtime token owns that database;
Location graphs share its global Database. Competing runtime graphs refuse, and
closing the runtime Scope revokes SQL bindings and marks its owner closed without
settlement. A new in-process graph cannot adopt its empty resource registries.

The real-process fixture prepares actual native quarantine, pauses its owner,
observes a refused second compatible startup, kills the owner and then verifies
that compatible restart acquires the kernel lease while quarantine remains.
Additional fixtures exercise private sidecar permissions, shared connection
ownership, persistent protection without quarantine and newer-protocol refusal.
These tests do not establish absence of external I/O already begun by an unaware
older runtime, authorize a placement commit, or supply complete authority and
receiver receipts. Native protection now includes a generated nonce and safe
generation; exact preparation replay preserves that epoch. An uncertain low-level
kernel release poisons its lease and refuses reattachment.

After freezing this storage step, Core passed **7,170 tests, 43 skipped, zero
failures** (7,213 tests across 309 files, 259.30 seconds), the focused suites
passed 145 tests, canonical checks passed all 35 tasks, the server passed 85
tests with one skip and the Core build passed. Logs use
`/tmp/native-movement-kernel-{core,check,focused,server,build}-final.log`.
The full patch, including earlier work, passes forward application against the
pinned checkout and reverse application against this source snapshot.

The following bounded runtime/epoch refinements passed 147 focused tests and
Core typecheck in `/tmp/native-movement-runtime-{focused,typecheck}-final.log`.
The full Core/build/server/check results immediately above precede those
refinements. Actual authorized commit must advance the protection epoch and
prove full resource/authority and receiver continuity; none is exposed yet.

## Native authority observations

The native plugin loader now captures the actual activation generation, source,
original executable definition and lifetime for hook registrations and tool
registry transforms. Serialized origins and caller-supplied plugin names cannot
substitute for those private native objects. Disposal removes contributions and
registered hook changes invalidate an existing stable reservation. Native loader
wrappers bind their original implementation, so separately constructed Location
graphs do not accidentally identify the same builtin as different code.

The effective permission observation uses the same configured rule selection as
the evaluator and includes saved grants, actual evaluate-hook origins and pending
requests. Native model resolution records the package actually imported, mapped
provider settings, active connection and resolved credential source. A private
per-process HMAC seals data configuration and endpoints without exposing secrets;
it is evidence of native observations, not a caller-provided authority hash.
External packages, non-data configuration, dynamic endpoint builders and unknown
credential sources remain explicitly unverified. This records model resolution;
it does not certify subsequent context/request/HTTP/WebSocket hook effects.

`prepareAuthority` retains both actual Location graphs, completes their plugin
activation before reserving execution, then reads source and destination native
selection, instructions, hooks, policy and model provenance under one owned
stable reservation. Its revision is captured and revalidated inside that guard,
including asynchronous owner revalidation. `prepareDestination` uses this same
path. The actual Session remains at the source, and both observations remain
execution-ineligible. Tool manifests retain every replayed transform, including
unknown contributions. In particular, the native MCP tool service currently
registers outside plugin activation, so its contribution is explicitly
unattributed rather than represented as a fabricated plugin principal.

The authority milestone passed 286 focused tests before the tool manifest and
42 tool/placement tests afterward. Canonical workspace checks passed all 35
tasks, the server passed 85 tests with one skip, and the Core build passed.
Logs use `/tmp/native-movement-authority-{check,server,build}-final.log`.

The first frozen full Core run recorded **7,175 passed, 43 skipped, two failed**
in `/tmp/native-movement-authority-core-final.log` (7,220 tests, 309 files,
338.35 seconds). The plugin reload fixture waited in real time for a debounce
whose TestClock sleep was registered after its single adjustment. Diagnostics
confirmed zero in-flight resolves after two seconds of real polling, then one
resolve immediately after advancing the frozen timer. That readiness check now
uses the existing clock-driving helper without repeating the reload or changing
its serialization assertion. Both affected suites subsequently passed all 26
tests in `/tmp/native-movement-authority-failures-final.log`.

The other failure exposed an unchanged Bun/macOS `fs.watch` delivery limitation:
a fresh-process repeated fixture produced 20 writes but only 19 raw native
callbacks, with no watcher-stream or bus event for the missing callback. Its
five-second deadline and assertions remain unchanged. Native watch acquisition
and watcher events alone do not establish current file authority. Actual owned
commit must freshly validate source/destination artifact observations and retain
uncertainty or drift. The final frozen full rerun recorded **7,176 passed, 43 skipped, one failure
and one unhandled error** (7,220 tests, 309 files, 342.81 seconds) in
`/tmp/native-movement-authority-core-rerun-final.log`. The plugin readiness and
unchanged watcher test passed on that rerun; a different existing Git packing
fixture (`raw Git packing recent lock preserves independent refusal and unowned
evidence`) exceeded its 30-second deadline and its interrupted pack process
reported the unhandled error. This is not a green full-suite result. The second
canonical check still passed all 35 tasks in
`/tmp/native-movement-authority-check-rerun-final.log`. The watcher backend
limitation remains explicit regardless of passing runs. No public movement
capability, grant, placement commit or receiver acknowledgment is exposed by
these observations.

## Native helper request activity checkpoint

The common `SessionGenerate.generate` helper now holds the existing process-global auxiliary activity boundary through instance/plugin/context/model preparation, hooks and the actual model request. The public facade supplies its captured native execution service. Idle reservation acquisition refuses while this work is active, and a durable movement hold refuses another helper request before HTTP dispatch. The ordinary runner can remain idle throughout; its active label is not used as a model-resource census.

An actual loopback provider regression verifies Session/instruction correlation, refusal during a held real response, successful preparation after helper completion, unchanged Session placement and zero additional requests after quarantine. It passed ten repeats, alongside 41 generation/coordinator/helper cases. The final unchanged-source full Core run passed **7,178 tests, 43 skipped, zero failures** (**7,221 tests across 310 files**, 219.34 seconds). Canonical lint and all **35** workspace typecheck tasks passed; Core and Server builds passed; Server tests passed **85 with one skip**. The test toolchain uses pinned Bun 1.4.2 and command-local Node 24.21.0. The shell's older Node 22.5.1 cannot load the TypeScript lint plugin.

The full patch is **1,256,183 bytes**, SHA-256 `339d37badac88eaee8e48ec002d8be32052876a4a919a0eef11c778791079b57`; pinned temporary-index reconstruction, strict whitespace, all new files and reverse-worktree checks passed. [The manifest](manifest.json) records this current scope-matched checkpoint. Logs use `/tmp/turnlink-opencode-model-work-`. Independent read-only review found no issues in this helper fix.

This clears the previously failing complete-suite verification for the current source, while preserving the independently measured raw watcher limitation above. It does not certify physical transport closure after cancellation, all arbitrary low-level model calls, complete destination authority, placement publication or receiver/release. Production movement stays disabled.

## Still required before native movement

1. Cover remaining native state changes (including
   dynamic plugin/registry activation and other unregistered global
   authority changes) and other native admission paths.
   The current boundary covers drains, native shell/session-generation facades,
   ordinary moves, permission/agent/model selections, skill/revert facades,
   public prompt/command/compaction/synthetic and pending-input mutations, and
   instruction API/direct mutation-service updates, child/fork inheritance,
   public/direct environment mutations, metadata updates and deletion relative to reservations. It does not cover
   arbitrary unregistered calls to lower-level runtime helpers.
2. Resolve and revalidate complete destination authority: selected agent/model,
   permissions, instructions, tools, plugins, dynamic configuration and trust.
   Configuration hashes or an idle observation do not establish equivalence.
3. Complete the native host's authenticated ownership contract and compatible-runtime
   storage gate, owner-authorized placement commit, quarantined crash recovery and
   exact same-session destination receiver verification. Internal intent and
   refusal state above are not a release or movement grant.
4. Integrate the production adapters and demonstrate approved broker grant →
   native effect → receiver continuity → task evidence → participant report →
   master acceptance, including failure/restart cases.

This experiment does not claim compatibility with the installed OpenCode runtime,
replace it, enable movement, or complete roadmap gate 2.


## MCP tool catalog handoff authority — 2026-10-29

The native MCP tool registry now uses the shared pre-publication authority
observer for `McpEvent.ToolsChanged`. Publication marks the handoff before
volatile dispatch; the authority stays fenced through coalesced debounce,
catalog read and registry reload. Failure remains fenced until a later
successful refresh, and an older completion cannot settle a newer event.
An unlocated service conservatively observes all locations. The initial
registration is installed after the observer, preventing a startup handoff
from being silently missed. This identifies a stale-catalog boundary; it does
not attribute all native tool producers, prove complete effective destination
authority, release resources, or authorize movement.

The new debounce-gap regression failed against the prior implementation and
passed with this change; a failed-refresh recovery regression also passed. The
MCP, authority-event and placement suite passed 88 tests; full Core passed
7,179 with 43 skips, Core typecheck and build passed, and all 35 workspace
check tasks passed. Server passed 85 with one skip and its build passed; the
embedded SDK passed 14. Server listener warnings remain. Initial testing found
missing checkout dependencies, a mock bus without a listener, and host global
plugin contamination; frozen installation, a complete mock and command-local
isolated XDG config resolved those fixture conditions. Logs use
`/tmp/opencode-mcp-tool-authority-`.

The patch is 1,263,211 bytes, SHA-256
`9fd8a1a67da13d961d4229a5543130e8105a0b688235f5fe008869449fe07d4b`,
reconstructing tree `94b3d99b3ca5239642abc1e0e1cced3af8cdc6ac`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; the
tested source was unchanged through validation. Full native owner and resource
reconciliation, destination authority and commit, exact receiver rebind and
both-runtime acceptance remain open. Movement remains disabled.


## Native MCP tool transform provenance — 2026-10-29

The tool registry now records a native MCP producer only for the exact
transform registered by `McpTool`, using private weak maps tied to its owning
Scope. Source and destination observations share the actual in-process
producer definition and have distinct activation identities. Copied metadata
and unrelated transforms cannot acquire that origin; closing the owner Scope
makes the origin stale. Unattributed contributors still remain unresolved.
This proves the transform producer and lifetime only: it does not attest MCP
server catalog contents, permission hooks, remote resources, durable ownership
or destination execution eligibility. The broader executable-registry and
resource authority limitations remain explicit.

A provenance regression failed against the preceding patch and passed with
this change. Focused MCP and placement files passed 249 cases across three
repetitions; full Core passed 7,180 with 43 skipped, all 35 workspace check
tasks passed, and Core and server builds passed. Server passed 85 with one
skip; embedded SDK passed 14. The server listener warning remains. The first
typecheck exposed a producer-registry type cycle, corrected before the passing
workspace run; the first focused placement run still expected the former
unattributed state. During the red comparison a relative restore trap failed
after changing directories; both source files were immediately restored and
byte-compared before the passing runs. Logs use `/tmp/opencode-mcp-producer-`.

The patch is 1,268,058 bytes, SHA-256
`07c05f7ce275e2dcfead1edce969e7d2fa3139c18bc34e1d818bac25125b6056`,
reconstructing tree `bfa25886e3e94fedb6d8873ce9c0e2c839e9f80a`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged during the final verification. Full native resource and
owner reconciliation, destination authority and commit, exact receiver rebind
and both-runtime acceptance remain open. Movement remains disabled.


## Pending permission authority mutation — 2026-10-29

Native permission request creation, reply, cancellation cleanup and service
close now participate in the shared authority mutation fence. A pending
permission change invalidates a held stable reservation without waiting for
its interrupted cleanup, so human review remains responsive. The fence is held
through native event publication and reply side effects, not across the wait
for a human decision. This protects pending-request freshness; it does not
prove complete effective permission policy, destination authority or resource
ownership.

The prior implementation failed a revision regression: request creation left
the native authority revision unchanged. With the change, permission and
movement tests passed 375 cases across three repetitions. Full Core passed
7,183 with 43 skipped, Core typecheck and all 35 workspace checks passed,
Core and server builds passed, server passed 85 with one skip, and embedded
SDK passed 14. Server listener warnings remain. An initial cancellation test
timed out because creation had not settled before the test acquired a guard;
the fixture now waits for stable authority. The overlapping broad run during
the prior-source comparison was discarded. Logs use
`/tmp/opencode-permission-pending-`.

The patch is 1,276,505 bytes, SHA-256
`a6994ecaf80be5d1a342f2d744a2f99efcb839bfebd7f906a8a86be57f158a04`,
reconstructing tree `65348b99e0e76c2af10e53cf79f1bb3529a281b4`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; the source
remained unchanged through final verification. Complete authority, resource and
owner reconciliation, destination commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain open. Movement remains disabled.


## Pending permission grant aliases — 2026-10-29

Pending native permission requests now copy their resource and saved-grant
arrays at creation and at event, list, session and ID read boundaries. Scalar
fields, source and the top-level metadata container are copied as well. Thus
a caller or observer cannot alter the stored request's grant fields after it
is published, or change the grant subsequently persisted by an `always` reply.
Nested metadata values remain opaque and may still be aliased; this change does
not prove complete permission policy or effective destination authority.

The regression failed on the preceding patch because mutating the caller's
resource array changed the pending request. With the change it checks caller,
event, list, per-session, ID and authority snapshot aliases and the actual
persisted grant. The permission suite passed 1,090 cases over ten repetitions
while the full suite ran. Permission and movement files passed 378 cases over
three repetitions; an initial run failed an unrelated command-reservation
fixture's 100-advance authority readiness probe while typecheck ran, and the
isolated retry passed. Full Core passed 7,184 with 43 skipped; Core typecheck,
all 35 workspace checks, Core and server builds, 85 server tests with one skip,
and 14 embedded SDK tests passed. Server listener warnings remain. Logs use
`/tmp/opencode-permission-alias-`.

The patch is 1,280,931 bytes, SHA-256
`fada9253391bc50ca2438e3b827e23abfb2ee37a40d787354a70ad6281b90175`,
reconstructing tree `f75d4ddb2348752feb8bc04f1d7b5b7d4e609905`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged through verification. Full authority, resource and owner
reconciliation, native commit, exact receiver rebind and both-runtime
end-to-end acceptance remain open. Movement remains disabled.


## Quarantine successor claim — 2026-10-29

The native intent now records the actual storage-lease incarnation. A later
native process with a different lease can durably claim the exact quarantined
Session, transition, plugin and source location for future reconciliation.
The owner and lease are revalidated in the transaction; a same-lease claimant,
a mismatched attempt or plugin, and a legacy intent without a lease are refused.
A retry by the same successor is idempotent, and a later process can record its
own successor. The original intent, Session placement and execution quarantine
remain unchanged: the claim is not a resource-release, placement-commit or
receiver-continuity receipt and does not permit an owner reservation.

Persistent SQLite triggers protect intent and recovery journal writes against
connections without the native ownership function. This is not protection
against hostile local programs that can supply their own function or alter the
database outside the protocol. The separate-process fixture exits abruptly
after preparing the original intent, then checks foreign-plugin and transition
refusal, an unregistered SQLite writer, two successor processes, unchanged
placement and the continued reservation refusal. This does not prove power-loss
durability or termination/reconciliation of orphaned work.

Movement and storage tests passed 60 cases over three repetitions; full Core
passed 7,186 with 43 skipped, all 35 workspace checks passed, Core and server
builds passed, server passed 85 with one skip, and the embedded SDK passed 14.
Server listener warnings remain. Logs use `/tmp/opencode-quarantine-recovery-`.
The patch is 1,294,281 bytes, SHA-256
`a40e53486c48da2961a752025f9d7d5cb598180393e720f4ced5715626cf7d08`,
reconstructing tree `6c65a44c189dc5d2935dcd2e2b5f836f69a19922`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged through verification. Physical source resource reconciliation,
complete authority, owner RPC, commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain open. Movement remains disabled.


## Quarantined successor inspection — 2026-10-29

A native successor holding the exact durable recovery claim can now inspect
the retained Session selection and inbox, pending and message counts under the
actual native idle-execution reservation. The implementation checks the
activation generation, original intent, recovery record and storage lease
before and after the read. It exposes no general execution callback; unclaimed
and superseded activations are refused. The original quarantine remains. The
inspection explicitly reports prior-process resources, destination authority
and receiver as unresolved. Counts are not message-equivalence or resource
release evidence, and this internal API is not authenticated adapter RPC.

The separate-process fixture now admits input before abrupt exit and verifies
that a recovered inspection observes the retained queue, refuses unclaimed and
superseded owners, and leaves normal movement reservation refused. Movement
and storage passed 60 cases over three repetitions; full Core passed 7,186
with 43 skipped, all 35 workspace checks, Core and server builds, 85 server
tests with one skip, and 14 embedded SDK tests passed. Server listener warnings
remain. Logs use `/tmp/opencode-recovery-inspection-`.

The patch is 1,299,788 bytes, SHA-256
`273c8eb49c51961ec75060bad831473923896ed837c9ce5fd3a558db367bf7d2`,
reconstructing tree `8992701fedcf112bfc642437ce1d44b19879f889`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged through verification. Full destination authority, physical
resource/orphan reconciliation, owner RPC, native commit, exact receiver rebind
and both-runtime end-to-end acceptance remain open. Movement remains disabled.


## Inherited recovery control descriptor — 2026-10-29

The staged native server can opt into a programmatically supplied inherited
socket bound to one host-specified plugin, Session and location, with compatible
native movement storage required. The protocol exposes only intent inspection,
quarantine successor claim and successor inspection. It closes for unknown
methods, foreign Session IDs, extra fields, replayed IDs or oversized frames;
it has bounded frames and a bounded request queue. Startup interruption closes
the descriptor and activation scope. No movement, release, destination commit
or general callback is exposed. The normal server remains default off.

This is a host-provided transport capability, not completed authenticated owner
RPC: no production launcher or adapter is wired, the broker grant is not checked
by this channel, and code in the same server process can access its descriptors.
It therefore cannot establish an approved movement or protect against hostile
in-process code. Real separate-process tests exercise the staged server and
original quarantine, preserved queued input, refused pre-claim inspection,
claim and inspection, unsupported commit, foreign/extra/replayed/oversized
requests, invalid descriptors and interrupted activation.

The focused suite passed 21 cases over three repetitions; full server passed 92
with one skip, all 35 workspace checks, server build and 14 embedded SDK tests
passed. Server listener warnings remain. Core source is unchanged from its prior
7,186-pass, 43-skip run and was not rerun. An initial Bun `Socket({fd})` probe
did not receive data; file-descriptor streams were used and passed real-process
tests. An initial server suite failed one download fixture with ENOSPC; two
older reproducible compiler-cache files were removed, preserving source and
archives, and the final full server suite passed. An intermediate lifecycle
edit had a syntax error which was corrected before final verification. Logs use
`/tmp/opencode-native-recovery-channel-`.

The patch is 1,319,724 bytes, SHA-256
`3e6ad41ba998c34798310b05588e7b1e43a0b83d920e0b0723a7bbd16751a078`,
reconstructing tree `3609f42c7e1bc9ef71f4520d1f0961fbce3d0259`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged through final verification. Full destination authority,
physical resource/orphan reconciliation, authenticated owner/broker RPC, native
commit, exact receiver rebind and both-runtime acceptance remain open. Movement
remains disabled.


## Isolated CLI recovery launcher — 2026-10-29

The staged CLI can now start the inherited recovery descriptor through a
programmatic stdio-only entry, bound to loopback and compatible native movement
storage. The ordinary CLI and managed service have no new descriptor flag.
The Turnlink host launcher starts this staged source entry with an explicitly
selected runtime, database, Session and location, keeps the descriptor private
from public RPC, and shuts its own child down through stdin. A competing process
is refused by the native storage lease while the first owner remains usable.

This is a separate recovery process, not a handoff of a running conversation.
It performs only quarantine inspection and successor claims: it does not verify
a broker grant, reconcile prior-process resources, commit placement, rebind a
receiver or enable execution. Runtime/entrypoint and environment selection are
the host's responsibility; in-process code can access server descriptors. No
installed service was restarted or modified, and no CLI binary was built.

The isolated full CLI suite passed 330 with 9 skips across 50 files; three
repeated focused CLI cases and all 35 workspace checks passed. Turnlink's
control suite passed 322 and syntax checks passed. The real-process launcher
test exercised a crashed quarantine, host client, retained input, competing
lease refusal and clean child shutdown. The first full CLI run had five
failures because an explicit global config override leaked into fixtures that
require separate config directories; the isolated HOME/XDG retry without that
override passed. Core and server source are unchanged from the preceding
verification and their full suites were not rerun. Logs use
`/tmp/opencode-recovery-launcher-` and `/tmp/turnlink-opencode-recovery-launcher-`.

The patch is 1,323,855 bytes, SHA-256
`85418fa873e5e0a3b9d537775e04b762aef8ab34be9f4cc24b1dd0e3a0102da6`,
reconstructing tree `ca9f0a74796b1244af2e8257a5e9d75c005c253a`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; source
remained unchanged through verification. Complete destination authority,
resource/orphan reconciliation, authenticated broker/owner wiring, native
commit, exact receiver rebind and both-runtime acceptance remain open. Movement
remains disabled.


## Durable host recovery claim and native observation — 2026-10-29

The staged host now writes an exact recovery-claim intent to a private durable
journal before native dispatch. A successful broker-checked claim is recorded;
a lost reply or failed post-check remains uncertain, and a restarted host will
not resend an already recorded attempt. The native recovery channel can now
read the prior durable recovery record under the exact quarantine, current
storage lease and native execution exclusion. The host brackets that observation
with fresh receiver-bound broker checks and records a matching result; if no
native record exists, the outcome stays unresolved and no claim is retried.
Neither a record nor its absence proves physical resource release, destination
authority or receiver continuity. There is no automatic next movement or release.

Separate-process tests cover a host exit at a simulated native-dispatch boundary,
journal write failure and competing host, plus a real broker/staged-native
restart that observes the prior native claim without reissuing it. The simulated
dispatch crash is not proof of power-loss durability or actual orphan cleanup.
The host journal uses a filesystem lock distinct from the native kernel lease;
neither supplies an atomic broker/native lease or protects against hostile
in-process code. An initial crash fixture lacked the new observation method; it
was corrected before final verification.

Full Core passed 7,186 with 43 skips; 60 repeated movement/storage cases, 21
repeated channel cases, all 35 workspace checks, Core and server builds, 92
server tests with one skip, 14 embedded SDK tests and 335 host control tests
passed. JavaScript syntax checks passed; server listener warnings remain. Logs
use `/tmp/opencode-recovery-record-` and `/tmp/turnlink-opencode-recovery-journal-`.

The patch is 1,327,161 bytes, SHA-256
`6f5a942f25e173f4d7a636b36755a35eb1a53fcbea16256fd4daa9b434325f91`,
reconstructing tree `0d4c862695250bd31724b5dc621d26390375fe61`. Private-index
forward, source-tree equality, reverse and whitespace checks passed; native
source remained unchanged through verification. Full destination authority,
physical resource/orphan reconciliation, production adapter wiring, native
commit, exact receiver rebind and both-runtime acceptance remain open. Movement
remains disabled.


## Durable WebSocket acquisition uncertainty — 2026-10-29

In the staged compatible native runtime, a model WebSocket acquisition is
recorded under the native storage lease before the connector is invoked. The
record contains no endpoint or credentials. If the write fails, the connector
and HTTP fallback are refused. An acquisition is cleared only by its owning
lease after native closure and reader settlement are observed. A successor
that sees a prior acquisition refuses an empty release receipt. SQLite guards
refuse ordinary unaware writes to these records, and the patched legacy
startup refuses the protected database.

Five focused cases include a real loopback WebSocket followed by abrupt
process exit, successor refusal and an unaware SQLite writer, as well as
observed closure in a separate process. Core passed 7,191 with 43 skips and
zero failures across 311 files; Core typecheck and Core/server builds passed;
server passed 92 with one skip. Full Core ran while other checks were active.
Logs use `/tmp/opencode-model-websocket-journal-`.

This is a fail-closed local record, not orphan cleanup. It does not prove
remote model cancellation, power-loss durability, or absence of sockets from
older/untracked owners. It does not reconcile subprocesses, detached children,
other resource families, native placement, or receivers. SQLite triggers do
not defend against hostile code that controls the connection or database.
Compatible mode creates a protected storage protocol on first acquisition;
production migration and compatibility remain unaccepted. Movement remains
disabled and Gate 2 remains open.

The patch is 1,350,012 bytes, SHA-256
`1bffa682a7e34a097eb27c0a0830c805b84661c107a3c6cea4b08bcf2092e14b`,
reconstructing tree `b99b3c1465d18f5e04e36630b9a3871bb771d5c7`.
Private-index forward, source equality, reverse and whitespace checks passed.


## Recovery-owner WebSocket acquisition census — 2026-10-29

An exact native recovery owner now reads the durable model WebSocket journal
inside the same native exclusion and database transaction as session recovery
inspection. The private host client requires separate non-negative counts for
the current and other leases; receiver-bound broker checks bracket inspection.
A real isolated broker and staged native process test opens a loopback model
socket, abruptly exits the native owner, then claims and inspects recovery
under a fresh native lease. It reports one prior-lease acquisition, retains
quarantine, and rejects inspection after adapter revocation. The host rejects
missing or malformed counts.

The first live test failed because the fixture graph did not expose the model
transport service; adding the actual service to that isolated graph fixed it.
Full Core passed 7,191 with 43 skips across 311 files; the host control suite
passed 336, server passed 92 with one skip, Core and server typechecks and
builds passed, and 16 focused Core tests passed. Full Core ran concurrently
with other checks. Logs use `/tmp/opencode-recovery-socket-census-` and
`/tmp/turnlink-recovery-socket-census-`.

Counts include only tracked acquisitions. Zero does not prove old untracked
sockets, remote requests, subprocesses or other resources have stopped. This
is observation, not reconciliation, lease transfer, release, placement, or
receiver rebind. An observed earlier recovery claim cannot yet be taken over
by a successor through the host journal. Production integration and full
both-runtime Gate 2 acceptance remain incomplete; movement stays disabled.

The patch is 1,351,820 bytes, SHA-256
`5f7727ee6c17bebe6f7b95118f5cc479d523716277bd444843edefba5de51b67`,
reconstructing tree `1600df53c7ab469260add1e7a3d31d06619e19a1`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Recovery successor takeover — 2026-10-29

A staged native recovery successor can now compare and replace the exact prior
recovery claim under native execution exclusion, its own kernel-backed storage
lease and the original quarantined Session. The old unrestricted recovery
claim no longer overwrites a different owner. The inherited private channel
requires the observed predecessor and target lease; the host journals the
attempt before dispatch and brackets it with current receiver-bound broker
checks. A lost acknowledgement stays uncertain. On a later lease, observing
the exact committed successor permits reconciliation without repeating that
operation; observing the unchanged predecessor under a different lease permits
a fresh takeover for the new lease. An unchanged predecessor on the attempt's
lease remains uncertain.

An isolated real broker and staged native processes exercised repeated owner
restarts, a real retained loopback socket, a committed takeover with simulated
lost reply, and a simulated failure before dispatch. Both cases reconciled
under a new lease before a further takeover. Wrong lease, changed predecessor,
changed broker grant, forged successor and revocation after dispatch were
refused or retained as uncertain. The initial native movement regression failed
because it expected an unrestricted replacement; the fixture was changed to
assert the refusal and perform the explicit takeover, and the retry passed.
Core passed 7,191 with 43 skips across 311 files; server passed 92 with one
skip; host control passed 341, plus 15 focused host and 9 native-client cases.
Core/server builds and typechecks passed. Core ran concurrently with other
checks. Logs use `/tmp/opencode-takeover-` and `/tmp/turnlink-takeover-`.

This transfers only quarantine recovery ownership: it does not terminate or
reconcile resources, establish destination authority, commit placement, rebind
the receiver, or atomically couple broker authorization to the native effect.
Host-process failure boundaries were simulated rather than power-loss tested.
Production integration and complete both-runtime Gate 2 acceptance remain
open; movement remains disabled.

The patch is 1,357,088 bytes, SHA-256
`6e6b4cbe0ff07110dd6d02a549bb008d6862255d285cded17d7a65edeffaa9f1`,
reconstructing tree `e11f46e59fc46ccef20aa7261c88fd08c8496aa2`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Hook and tool registry alias isolation — 2026-10-29

The staged native hook registry now owns a copy of each model hook's provider
filter. Mutating the caller's original options cannot silently change hook
dispatch while authority is reserved. The tool registry now returns separate
entry metadata from editor reads and public lists, copies the mutable update
argument before storing it, and revokes each editor after its synchronous
transform. Retained editors and metadata aliases cannot silently remove a tool
or replace its executor after publication.

Both regressions failed before the fixes and pass afterward, including actual
hook dispatch and tool execution while native authority is reserved. Focused
isolated Core tests passed 130; full Core passed 7,193 with 43 skips across
311 files; server passed 92 with one skip and host control passed 342. Core
and server builds and typechecks passed. An initial focused placement run
loaded a user-local plugin because HOME was not isolated; the isolated rerun
passed. An earlier full run started before the tool fix and failed the new
regression against the already loaded old implementation; the fresh final run
above used the unchanged final source. Logs use `/tmp/opencode-tool-hook-` and
`/tmp/turnlink-tool-hook-`.

This does not isolate arbitrary mutable schema objects, callback closures or
other registry domains. In particular the agent registry can still expose
mutable authority-bearing data. Complete destination authority, resource and
orphan reconciliation, placement commit, receiver rebind and both-runtime
acceptance remain open; movement stays disabled.

The patch is 1,362,600 bytes, SHA-256
`2e2e4b13ed453c8112f64538d516523d002774141a4fa10ef6c904210313a2f4`,
reconstructing tree `ccbcd62fffbebd63fec7c3f6460c2efb65e1ef71`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Agent registry ordinary-data isolation — 2026-10-29

The staged Agent registry now detaches ordinary plain-object and array data
after each synchronous transform and on public reads. Retained editors expire
when their transform returns. The synchronous AgentEditor contract remains
mutable: direct edits through its reads are applied before detachment. A real
regression showed retained editor and returned aliases could alter selected
permissions and request headers without an authority revision; it is now
refused or isolated. A separate test covers synchronous editor edits, nested
data, sparse arrays and preservation of an opaque provider callback/value.

Core passed 7,195 with 43 skips across 311 files; isolated focused Core passed
134; server passed 92 with one skip; host control passed 342; Core/server
builds and typechecks passed. After the full run began, the Agent source was
reindented only: a whitespace-insensitive comparison verified the sole source
difference, and all 12 agent tests and Core typecheck passed after formatting.
The first attempted fix also failed a focused test because Effect's imported
Array lacked `from`; it was corrected before the reported verification. Logs
use `/tmp/opencode-agent-authority-` and `/tmp/turnlink-agent-authority-`.

This deliberately preserves non-plain opaque objects, callable values and
accessors rather than asserting they are immutable. Their state and plugin
callback closures remain unproven; other registry domains and mutable tool
schemas also remain open. This does not reconcile resources, establish full
destination authority, commit placement or rebind a receiver. Production
integration and both-runtime Gate 2 acceptance remain open; movement stays
disabled.

The patch is 1,372,422 bytes, SHA-256
`bfe8e9dd7bdc95959f17a8b4f1c3763027b894bb7c9712b7bdb10a4e203a8123`,
reconstructing tree `b20fac09bc8165206e717cd31ec03c0960fd34de`. Private-index
forward, final source equality, reverse and whitespace checks passed.


## Authority-aware shared editor lifetime — 2026-10-29

The staged native State implementation now scopes editor interfaces used by
authority-aware registries to each synchronous transform. Retained nested
editor methods and retrieved method descriptors are refused after that
transform. Agent and Tool retain their domain-specific lifetime guards and
data detachment. Command registration also copies its definition so changing
the caller's object cannot replace the published executor. A regression using
the actual command service and a held reservation failed before the fix and
passed afterward; a shared State test covers nested methods and descriptors.

Full Core passed 7,197 with 43 skips across 311 files; 196 focused Core cases,
server 92 with one skip and host control 342 passed. Core and server builds
and typechecks passed. Full Core ran concurrently with other checks. Logs use
`/tmp/opencode-state-editor-` and `/tmp/turnlink-state-editor-`.

This scopes the editor interfaces; it does not detach every mutable value
returned by editor methods. MCP server configurations, other registry data,
opaque values, callback state and hostile in-process behavior remain unproven.
It is not physical resource reconciliation, complete destination authority,
placement commit or receiver rebind. Full both-runtime Gate 2 acceptance
remains open and movement stays disabled.

The patch is 1,380,162 bytes, SHA-256
`50afd8a9cc3606e388ce20aa3fab613d3eada36dd87a9d23a74da9c4b40e924c`,
reconstructing tree `47a76955734831851c0ab38508dc93b679328b6c`. Private-index
forward, source equality, reverse and whitespace checks passed.


## MCP configuration and catalog alias isolation — 2026-10-29

Staged native MCP now detaches mutable configuration drafts after each
synchronous registry transform and copies caller-supplied runtime overrides.
Published server status, tool and prompt catalog reads return detached data,
and incoming tool/prompt catalog items are copied before publication.
Synchronous editor changes remain visible to subsequent transforms.

Three regressions failed before the change and passed afterward: retained
editor data and an override could alter the command actually spawned by a
local MCP fixture, and returned catalog/status objects could mutate the live
server state without an authority revision. Tests use isolated local
processes and a loopback MCP server. A fourth test confirms synchronous draft
compatibility; its first version incorrectly assumed a config persisted during
fixture shutdown and was corrected. Focused Core passed 164; full Core passed
7,201 with 43 skips across 311 files; server passed 92 with one skip; host
control passed 342; Core/server builds and typechecks passed. Full Core ran
concurrently with other checks. Logs use `/tmp/opencode-mcp-authority-` and
`/tmp/turnlink-mcp-authority-`.

This does not prove remote MCP work stopped, reconcile child processes, or
isolate every tool registry schema or callback. Full destination authority,
physical resource/orphan reconciliation, native commit, receiver rebind,
production integration and both-runtime Gate 2 acceptance remain open.
Movement stays disabled.

The patch is 1,389,281 bytes, SHA-256
`709b3a65d473a7a3e9eb570487d0cdc97a123d42e480c766a256ff9634c569a7`,
reconstructing tree `07542b3a0968f3e2b5ed52377117564b87bf6db1`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Tool JSON schema and Code Mode catalog isolation — 2026-10-29

The staged native Tool registry now copies plain JSON input/output schemas
on registration, editor/update reads and public list reads. Advertised tool
definitions receive detached JSON projections, including standard-schema
projections. Code Mode catalog snapshots no longer expose the shared cache.
Effect and standard-schema implementation objects retain their existing native
identity; their internal state is not asserted immutable.

Regressions demonstrated that retained schema aliases changed the advertised
schema without an authority revision and that a returned Code Mode snapshot
mutated the shared catalog; both passed after the change. Tests also exercised
actual JSON input validation, synchronous schema edits, Effect and Zod tools,
and a standard-schema projection. The first typecheck found two test-only
type casts; these were corrected before final verification. Focused Core passed
133 across three files; full Core passed 7,205 with 43 skips across 311 files;
server passed 92 with one skip; host control passed 342. Core/server builds and
typechecks passed. Full Core ran concurrently with other checks. Logs use
`/tmp/opencode-tool-schema-` and `/tmp/turnlink-tool-schema-`.

This does not establish immutable opaque schema implementations, plugin
closures, other registry data, physical resource/orphan reconciliation, full
destination authority, native commit or receiver rebind. Production
integration and both-runtime Gate 2 acceptance remain open; movement remains
disabled.

The patch is 1,396,103 bytes, SHA-256
`16065f5d9e18150fc2a6662377b9ad7110fea3894e9bcb9e5e8b3a69651aa915`,
reconstructing tree `e6038a07fcad1b4345594140cade5b08353cd262`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Prior WebSocket acquisition restart hold — 2026-10-29

The staged compatible owner refuses a new tracked model WebSocket acquisition
when the same Session has an unresolved prior-lease acquisition. Restart and
Session generation hold the affected Session and its ancestors through both
persisted subagent jobs and native Session parent links, including the interval
before a child job is recorded. Lease changes during observation fail closed.
A real loopback socket and crash/restart fixture reproduced parent claim release
before the fix and now preserves suspended claims and pending work, while an
unrelated Session and a cleanly closed prior acquisition remain usable.

Focused journal/restart checks passed 11; clean full Core passed 7,211 with
43 skips across 311 files; server passed 92 with one skip; host control passed
342. Core and server builds and typechecks passed. Earlier Core runs overlapped
source edits and are not counted. An initial server typecheck command failed to
start because its shell lost the Bun path; the explicit-path retry passed.
Server emitted listener-limit warnings. Logs use `/tmp/opencode-prior-ancestry-`
and `/tmp/turnlink-prior-ancestry-`.

This prevents a tracked replay; it does not prove remote cancellation,
physical resource or orphan reconciliation, coverage of untracked model work,
complete destination authority, native commit or exact receiver rebind.
Production integration and both-runtime Gate 2 acceptance remain open;
movement stays disabled.

The patch is 1,418,392 bytes, SHA-256
`03b6d98fba893e3cf0472f3f56971638082a3aba66b45f73b8cd584b35cbf5b8`,
reconstructing tree `6983bbcd81bc38a375f208fa1ef7b9e0453f682e`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Recovery inspection of dependent Sessions — 2026-10-29

Recovery inspection reports a separate count of distinct dependent Sessions
with tracked prior-lease WebSocket acquisitions. It follows native parent links
and persisted subagent job relationships transitively and excludes the
inspected Session itself and unrelated Sessions. The exact owner's native
reservation and fresh broker authorization still bracket inspection. The count
is observational: it is neither the number of sockets nor proof that no
untracked or remote work exists, and it does not authorize clearing a record.

A fresh-process fixture created a parent record, a dependent child record and
an unrelated record. Before the change inspection omitted the dependent count;
afterward native and broker-authorized host inspection both reported one. A
separate graph regression covers interleaved parent and job edges. Focused Core
passed 23, native/host recovery passed 27, clean full Core passed 7,212 with
43 skips across 311 files, server passed 92 with one skip and host control
passed 345. Core/server builds and typechecks passed. Initial focused
typecheck/tests failed because two hand-built test graphs lacked Job.Service;
the graphs were corrected before final verification. The server emitted
listener-limit warnings. Logs use `/tmp/opencode-dependent-census-` and
`/tmp/turnlink-dependent-census-`.

The host also requires a matching settled transition and destination scope
before preparing a worktree task. This does not prove native execution or
receiver rebind, and the normal task pull still excludes worktree tasks.
Physical and remote reconciliation, full destination authority, native commit,
receiver rebind and both-runtime end-to-end acceptance remain open. Movement
stays disabled.

The patch is 1,421,809 bytes, SHA-256
`74b4a508b5e64de8d92e92a9a4db356d01c16bcd1b8b98b459864e01971b4ee6`,
reconstructing tree `0a5e1037f729c259d9a9199f459f83e653af6031`. Private-index
forward, source equality, reverse and whitespace checks passed.


## Fenced source membership absence — 2026-10-29

Native preparation now atomically installs a writer fence for the actual
plugin membership namespace and marks the intent as fenced. Storage protocol 2
prevents older compatible runtimes from opening the upgraded database; its
marker cannot be downgraded or removed through ordinary SQLite writes. The
previous patch's actual bootstrap was run against an isolated protocol-2
database and refused it. Old quarantine intents lacking the marker are not
treated as fenced. This upgrade is staged only and needs a planned compatible
deployment and rollback; the prior runtime cannot open the upgraded store.

Under an exact prior-process recovery claim and native reservation, the new
private operation refuses a present membership or legacy unfenced intent. It
atomically seals an already absent source membership, after which ordinary
compatible writes cannot recreate it or remove the seal. The seal is scoped to
one Session, plugin namespace, transition, source, destination and owning
lease. It is not a model-work, remote-cancellation, physical-resource, placement
or receiver receipt. A future native destination installation must consume and
retire the seal under its own exact authority; this change does not implement
that operation. Untrusted same-account processes that can alter SQLite schema
or forge native connection callbacks remain outside this proof.

The inherited private channel exposes seal and read-only observation. The
host uses a fresh receiver/broker check, writes a separate durable dispatch
intent, and rechecks authorization. A lost response is reconciled by observing
the exact native seal; an uncertain dispatch with no seal stays unresolved and
is not retried. Real isolated broker/native process tests cover success, lost
reply, pre-dispatch interruption, present membership and broker revocation.
A distinct unbound SQLite connection was able to change membership before the
fence and is now refused; the owning native connection remains usable before
sealing. Tests also cover protocol downgrade, seal recreation, seal deletion,
old-intent refusal and distinct UTF-16 plugin namespaces.

Focused Core passed 35, focused server 7 and focused host 30. Clean full Core
passed 7,216 with 43 skips across 311 files; server passed 92 with one skip;
host control passed 375 and the full host suite passed 650 with 31 skips.
Core/server builds and typechecks passed. Early fixture attempts exposed an
incorrect SQLite function arity, missing raw timestamp columns, and a test
that used protocol 2 as its future-version sentinel; those were corrected. The
first direct legacy check imported the current namespace by mistake; the retry
called the prior patch's actual exported bootstrap and passed. Server emitted
listener-limit warnings. Logs use `/tmp/opencode-membership-` and
`/tmp/turnlink-membership-seal-`.

The patch is 1,444,987 bytes, SHA-256
`d42cad8126f9a8d1e703e6789774994aa8242c3071d624e689888c5be41cb201`,
reconstructing tree `06962f5f2b00ba8ebb1d2166e3894db60d316ff8`. Private-index
forward, source equality, reverse and whitespace checks passed. Destination
authority, resource and orphan reconciliation, native placement, receiver
installation, production adapter wiring and both-runtime acceptance remain open.
Movement remains disabled.
