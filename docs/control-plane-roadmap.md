# Full control-plane implementation plan

This resumes the full agreed plan in `control-plane.md`, not the narrower
OpenCode task-flow milestone. No production activation is implied by a passing
primitive or fixture. The operator's existing session, instructions, selected
agent/model, native permissions and approvals remain authoritative.

## Gate 2: operator-approved manual scope — 2026-11-08

**Closed for the operator-approved manual-resume scope.** The operator accepts
stopping and resuming the original session, attests that the source stopped and
checks external and background work. Stock runtimes remain unchanged. The
manual path has been exercised for OpenCode and Codex on macOS and physical
Reborn; recovery cases have additional broker and synthetic-session coverage.
The latest Codex physical run used a synthetic model and injected seven
temporary observation failures. Earlier live-model physical runs used
synthetic settings and, depending on the run, fixture-supplied or explicitly
described claim/report operations. They do not prove independent collection
of effective destination authority. The current standard suite passed 1,399
tests, with 427 skipped; skipped tests are not counted as evidence.

This scope decision does **not** establish the original automatic native
handoff, independent writer exclusion, external-effect completion, or complete
destination authority. Those capabilities remain unproven or incomplete and
are not enabled by this closure. The manual mode remains opt-in; its operator
attestation is not a native movement receipt. See the
[implementation plan](gate-2-implementation-plan.md) and
[compatibility matrix](gate-2-compatibility-matrix.md) for the evidence and
remaining limitations. This is not a production deployment or acceptance of
other control-plane gates.

The separate investigation into universal automatic native guarantees is also
**closed by the operator's scope decision**, not by implementing or proving
those guarantees. The final assessment found no demonstrated method covering
arbitrary competing writers, effective loaded destination authority and
uncontrolled external effects with the stock runtimes. A controlled environment
may support a narrower solution, but has not been established as a complete
replacement. Automatic native movement remains disabled. Further support, if
desired later, is separate work and must define its runtime, platform, isolation
and external-service boundaries; this decision does not assert that other
solutions are impossible.

## Previous Gate 2 checkpoint — 2026-11-07

The operator accepts stopping a session safely and resuming it at the
destination, has declined modified or rebuilt runtimes for this path, and has
explicitly accepted operator attestation of the source stop in place of an
independent automatic check for competing source writers. This is an acceptance
of that manual safety boundary, not evidence of automatic writer exclusion.
The operator also accepts checking and resolving pending external actions and
background work manually using the agent's report, without an independent
automatic guarantee that those effects have stopped.
The broker therefore has a distinct, explicitly approved manual-resume path:
the agent prepares a sanitized record, the operator attests the stop and
authorizes the destination host, and the resumed agent compares the record
before the task can run. These statements do not independently prove process
termination, exclude other writers, or reconcile external effects.

An isolated OpenCode 2.2.5 session completed this path from the Mac to the
physical Windows host, including a live-model record and comparison, a task
and coordinator acceptance. An offline official Codex 0.165.0 process also
completed the manual path through the real proxy and MCP server on one host,
using synthetic model behavior and record values. A Windows Codex attempt did
not prove cross-host continuity: its temporary profile isolation was invalid,
and the operator chose to leave the resulting Administrator `.codex` directory
intact. A later test using the permitted Reborn profile resumed a synthetic
legacy-history Codex thread from the Mac's Linux container on physical Windows;
a paginated-history thread also resumed there after its synthetic rollout was
placed under the normal sessions tree. Later physical tests exercised the
manual broker transfer, the actual Windows proxy and Codex, task dispatch and
coordinator acceptance for both formats. The records and model responses were
synthetic test inputs, not evidence of autonomous settings collection. The
detailed evidence and cleanup record are in
[the execution ledger](remaining-development.md#gate-2-closure-checklist).

On 2026-11-08 the complete manual OpenCode flow passed again from macOS to
physical Reborn using stock OpenCode 2.2.6 on both hosts, the real Turnlink
adapter and broker, a live model and synthetic work. The agent prepared the
record, the source stopped, the approved destination rejoined with the same
session, the agent compared its record, and the task reached coordinator
acceptance after operator attestation. The test checked the reported runtime
and native-rule fingerprint on both sides. These are scoped observations, not
independent proof of OS/remote policy or competing-writer exclusion. The nine
exact OpenCode tool schemas and synthetic conversation were explicitly approved
for DeepSeek; unapproved tools were filtered. The isolated remote files were
removed, and a follow-up inventory found no test-prefixed files on Reborn.

In a separate isolated same-host test, stock Codex 0.165.0 using DeepSeek
joined Turnlink, composed a synthetic session record, stopped, resumed the same
thread in a different directory, and sent a comparison accepted as
`reported_match`. The runtime, provider, model, permissions and work values
were supplied by the test operator. This verifies live-agent record and report
composition, not independent discovery or physical cross-host continuity.
Another isolated test used the already-installed stock Codex with DeepSeek and
the additionally approved `channel_history` and `channel_status` schemas. The
agent joined, sent and retrieved a synthetic message, read health status and
reported its runtime as unknown when that status did not establish a version.
It ran on one host with a synthetic broker and did not exercise task transfer.
An independent native-proxy test then used the installed stock Codex on macOS
inside a network-denied sandbox and confirmed that its receiver published
the observed native version `0.165.0` as fresh health. A subsequent physical
test stopped a live DeepSeek-backed stock Codex session on macOS, copied its
synthetic history to Reborn, resumed the same session ID using stock Windows
Codex and obtained a `reported_match` comparison sent by the resumed agent
after it read the record from Turnlink history. The runtime, model, provider,
permissions and work were synthetic facts supplied by the test operator. The
temporary remote files were removed. This live-model test used the broker and
MCP server directly; it did not run the manual coordinator or proxy task path.
The focused broker and proxy checks for manual-resume attestation, destination
receiver and cross-host reconnection were rerun successfully (3 passed). These
are controlled tests and do not combine those components with the physical
live-agent run above.

On 2026-11-08 a subsequent physical Codex test combined those paths: stock
Codex 0.165.0 and the actual proxy/broker resumed the same synthetic thread from
macOS on Reborn, a live model prepared and compared the record, Turnlink saved
the exact source copy, and the resumed proxy executed a task accepted by the
coordinator. The test fixture claimed the task and submitted its report using
the synthetic participant proof; it did not demonstrate autonomous model
claim/report. Model/provider/permission/work values were supplied by the test
operator, not independently verified effective destination authority. Only
the four explicitly approved Codex tool schemas and synthetic conversation
were sent to DeepSeek; no shell schema was exposed. Local and remote test files
were removed, with the Reborn test-prefix inventory returning zero.

At this checkpoint Gate 2 remained open. The original native destination-authority and receiver
handoff criteria have not been shown complete. Automatic exclusion of competing
native source writers is not proven and is no longer required for the
operator-accepted manual-stop boundary. The Codex physical-host test used a synthetic
model and fixture-supplied records; the live-agent physical-host comparison used
operator-supplied settings. The later combined physical test did include the
coordinator and proxy, but it used scripted claim/report and operator-supplied
synthetic settings. Autonomous settings collection has not been established.
The manual-resume evidence above must not be
reported as proof of those remaining criteria. Historical notes below describe
earlier experiments and do not assert that their experimental runtimes remain
installed or authorized.

The experimental Codex native-control path explicitly refuses Windows in
`src/codex-proxy.js`; the permitted stock-runtime manual-resume path does not
enable that control path. A successful Windows manual-resume test would not
by itself prove the original native-control or writer-isolation requirements.

## Historical Gate 2 checkpoint — 2026-10-30

A retained Codex provider owner can now be cleaned up through an internal
write-ahead host path: native cleanup intent and receipt are persisted, lost
native replies are observed without replay, and only the broker settlement is
retried. Staged native cases pass with a real fixture MCP owner and a lost
cleanup reply. This does not establish physical MCP release or free the fence;
the remaining Codex acceptance boundaries below still apply.

An isolated OpenCode destination path remains default-off. It uses the
production native placement and
completion RPC handlers, exact successor recovery, protected transport-release
evidence, native permission/hook/tool/instruction/model revalidation, the exact
held receiver, queued delivery and destination task dispatch. Lost native and
broker replies are recovered from durable identities rather than replaying the
move. Completion dispatch is preceded by native observation of the exact
placement receipt, and a production negative case proves that missing protected
transport-release evidence leaves placement uncommitted. The exported patch
reconstructs tree `4da53ed9039d55308c4a104fe736b5f193274683` and passes
forward, reverse and strict-whitespace validation.

The earlier integration cases injected a completion verifier into a
programmatically created broker. The standard CLI now accepts an explicitly
configured local OpenCode verifier socket. A later isolated case exercised an
explicit completion-owner CLI, the actual destination plugin, a local fixture
model, destination task execution and reviewer acceptance. This completion
entry point still requires an existing moved grant and explicit configuration;
automatic migration orchestration and the full cross-runtime Gate 2 acceptance
remain incomplete.

The incompatible installed Codex Desktop native launch path now selects separate
Codex and SQLite homes. Its reviewed launch-path wrapper
unconditionally selects
`$HOME/Library/Application Support/Turnlink/CodexDesktopHome`, even when it
inherits standalone home overrides; the original 0.135 binary is preserved
under a non-default name for rollback. The isolation verifier confirms the
wrapper and original hashes and runs a real synthetic session with a shared-home
trap; rollout and SQLite writes remain in the isolated runtime home. Bundle
inspection also found that the Desktop parent resolves `CODEX_HOME` and can
create its own SQLite database independently of that wrapper. Full Desktop
application and managed-configuration isolation therefore remain unproven. Standalone
0.165.0 was then reverified for destination instruction loading, same-version
writer exclusion and owner-process-exit release.

Gate 2 nevertheless remains open. The earlier statement that Desktop isolation
was the only remaining item was incorrect: the authoritative Codex native
manifest still records `completeDestinationAuthority: false`. Its remaining
implementation includes provider credential readiness, approved destination
resource establishment, grant-bound provider construction, complete resource
and orphan reconciliation, production commit/recovery, and exact receiver
handoff. The wrapper isolates the tested runtime session but does not establish
that all incompatible competing ingress is removed. Gate 2 may close only
after that Codex path passes full destination acceptance, or after an explicit
scope decision removes Codex movement from Gate 2. No such scope change is
assumed here.

Verification for the current OpenCode destination checkpoint passed 22 host
authorization unit cases, 145 broader broker/receiver/live-movement cases, 8
full native recovery cases, 21 native movement cases, 20 hermetic placement
cases, 19 database ownership cases, 12 native server control cases and all 35
workspace typecheck tasks. The additional Codex isolation verifier and both
standalone 0.165.0 native continuity probes also pass.

## Previous Gate 2 checkpoint — 2026-10-29

An isolated real-process integration now carries a prepared native placement
through owner loss, successor observation, completion and broker-verified
receiver release. It confirms a held message reaches the same session once,
then exercises task evidence, reporting and independent reviewer acceptance.
The preceding journal and detachment evidence and the task execution are
fixtures; native preparation still reports unresolved resources and no execution
eligibility. Production dispatch, both-runtime acceptance and Gate 2 remain open.

Prepared native model observations now retain a private fingerprint of selected
model data and the identities of their route components and methods. Preparation
and placement recheck current native observations, including after projection.
A changed observed model reference, limit, route component or method refuses placement; the exposed
reference in the observation is detached. Protocol 5 rejects older native
runtimes that lack this check. This detects changes visible at revalidation,
not change-and-restore between checks, mutable closure internals or external
provider state. Verification passed 7,316 Core tests (43 skipped), 97
server tests (one skipped), 72 broker/native cases, both builds and Core
typechecking. Gate 2 remains open.

The native shell service now fences movement reservations from acquisition
through process-scope settlement, including direct shell launches outside the
session activity wrapper. Inherited output that remains open and failed spawn
attempts retain an unresolved process-local hold. The fence is global, so an
unrelated live shell can defer movement. It does not prove absence of detached
descendants, persist across owner crashes, or provide reconciliation of an
uncertain hold. Verification passed 7,311 Core tests (43 skipped), 97
server tests (one skipped), 72 broker/native cases, both builds and Core
typechecking. Gate 2 remains open.

Saved permission changes now append an immutable SQLite revision, including
writes from other SQLite connections. Native destination preparation captures
the revision and rechecks it during placement, so add/remove changes cannot
restore a stale observation. Tests cover a separate writer, transaction rollback,
history tampering, and a change during projection. Protocol 4 makes the history
mandatory for compatible native runtimes; upgrades from protocols 1–3 are atomic.
The history grows with saved-rule writes and does not prove freshness of other
authority sources. Verification passed 7,308 Core tests (43 skipped), 97
server tests (one skipped), 72 broker/native cases, both builds and Core
typechecking. Gate 2 remains open.

SQLite now requires native connection authority to create the durable binding,
and protects it against `INSERT OR REPLACE` and renaming another key onto it.
Current guards are installed when opening older supported storage protocols as well as protocol 3;
the normal owner can still rebind placement during its transaction. A separate
compatible writer reproduced forged insertion and replacement and verifies both
replacement forms; isolated movement and upgrade tests passed. Full verification passed 7,304 Core tests (43
skipped), 97 server tests (one skipped), 72 broker/native cases, both builds
and Core typechecking. It does not establish destination authority or resource
reconciliation.

Persistent SQLite guards now reject raw Session, inbox, pending, message and
event writes affecting quarantined descendants, child attachment, and instruction
entries and state for the moving family. They are installed atomically and verified against a separate writer
after an owner crash. Native storage protocol 3 upgrades versions 1 and 2
atomically, refuses incompatible runtimes, and blocks protocol replacement and
renaming as well as ordinary updates and deletion. Versioned family triggers also
check existing row ownership for SQLite replacement operations, including root
records, and install alongside earlier guards on upgrade. These guards do not exclude
arbitrary schema tampering or reconcile orphaned resources; production movement
and Gate 2 remain open. Verification passed 7,303 Core tests (43 skipped),
97 server tests (one skipped), 72 isolated broker/native cases, both builds,
Core typechecking and the workspace syntax check. See the manifest for the
patch fingerprint.

Native preparation now reserves the known Session family and refuses to create
quarantine while a durable shell or subagent background job for that family is
unacknowledged. A strict journal scan rejects malformed or oversized evidence;
unrelated jobs do not hold the move. Placement and completion also refuse known
remaining background work and recheck the reserved family inside the transaction,
including after quarantine deletion, so a newly attached child or a late job
rolls back placement or completion. Registered child admissions and wakeups follow an
ancestor's quarantine, and restart retains suspended descendant claims. These
checks do not reconcile old orphaned processes or block arbitrary schema tampering;
in particular, a pre-existing quarantined job may still need native recovery.
Production movement and Gate 2 remain open. Verification passed 7,299 Core
tests (43 skipped), 97 server tests (one skipped), all 35 workspace checks,
both builds and 72 broker/native fixtures. See the native manifest for
the patch fingerprint.

An internal staged placement path now binds the actual native prepared
observation to its database, Session, transition, destination and project. It
revalidates the retained directory, configuration, instruction and permission
observations inside the move transaction before projection and after receipt
insertion. Isolated native tests cover copied observations, mismatched inputs,
stale instructions, a change during projection and a successful move. The
quarantine remains after placement. This observation is not a complete authority
grant: executable hooks, external state, resources, held receiver authorization,
production dispatch and both-runtime acceptance remain open. Verification passed
7,290 Core tests (43 skipped), 97 server tests (one skipped), all 35 workspace
checks, both builds and 42 broker/native fixtures. See the manifest for
the patch fingerprint.

Native placement and completion now carry the active reservation's revision to
the movement SQLite connection, which checks it synchronously immediately
before `COMMIT`. A changed or failing fence causes rollback, including when an
uninterruptible transaction already projected the move or recorded completion.
Nested fences cannot replace an invalid parent. Tests reproduced the earlier
move-after-revocation and completion-after-revocation failures, then verified
rollback and retry. This fences registered in-process authority changes only;
prepared destination authority, external state, other resources, production
dispatch and both-runtime acceptance remain unfinished. Verification passed
7,286 Core tests (43 skipped), 97 server tests (one skipped), all 35 workspace
checks, both builds and 42 broker/native fixtures. The source
fingerprint is in the OpenCode manifest.

The native config-instruction contributor now rescans its local discovery rules
during destination preparation and revalidation, without updating loaded state
or depending on watcher delivery. This detects newly matching upward
`AGENTS.md` files and configured globs as well as changes to known files. The
observer is tied to the contributor's scope and uses strict file and glob
operations to refuse missing observers and surfaced permission or scan failures.
This does not cover other contributors, remote sources, filesystem
exclusion or ABA changes, and does not authorize production movement. Native
verification passed 7,283 Core tests (43 skipped), 97 server tests (one skipped),
all 35 workspace checks, both builds and 42 broker/native fixtures.
See the manifest for the source fingerprint.

Native destination preparation and its revalidation now directly reread the
local instruction files already captured by each Location's discovery owner.
Changed, deleted or unreadable captured files refuse the prepared observation,
even before a watcher reload. This is an observation, not filesystem exclusion:
newly discovered paths, remote instructions and ABA changes remain unresolved,
as do complete destination authority and Gate 2 acceptance. The latest native
verification includes 7,281 Core tests (43 skipped), 97 server tests (one
skipped), all 35 workspace checks, both builds and 42 broker/native integration
fixtures. The source fingerprint is in the OpenCode manifest.

Native placement and completion now refuse durable model WebSocket acquisitions
for the moving Session or its persisted/pending descendants, including records
owned by the current lease. The checks run inside the respective database
transactions and preserve quarantine on refusal. Placement and completion now
also reserve known persisted and pending descendant Sessions, recheck the
descendant census, and refuse registered descendant activity. New registered
activity waits until the reservation is released. The process-local reservation
does not exclude unregistered or external work, move child Sessions, or prove
complete resource readiness. Production movement remains disabled and Gate 2
remains open. Verification for this revision: 33 focused tests, 7,279 Core
tests (43 skipped), 97 server tests (one skipped), all 35 workspace checks,
both native builds and 42 broker/native integration fixtures passed.

An explicitly configured broker-owned verifier can now require the native
completion receipt before releasing an OpenCode receiver. The broker rechecks
the held receiver, grant and enrollment after observation, and records the
verified receipt identity with release. The destination plugin's private RPC
uses a verifier-required release method and can recover a confirmed release
after a lost reply or restart. The regular broker launcher does not configure
this verifier; the legacy release method remains available when it is absent.
Native completion alone does not prove destination authority or resource
readiness, so this is not production activation or Gate 2 acceptance.

An internal native completion transaction now validates the exact placement,
then atomically records completion and removes its quarantine and membership
seal under the native execution reservation. Its durable record survives native
owner restart, and an isolated successor can complete a prior placement.
The private native channel and a receiver-bound broker bridge can observe the
completion without reclaiming the removed quarantine. An integration test uses
a real broker and native process with fixture-created prior movement evidence.
The operation is not exposed to production: destination authority, resource
readiness and broker-held receiver checks are not yet connected to it.
Subsequent transitions now use immutable transition-scoped archives and stages
while retaining the original legacy records. Isolated native and private-host
tests cover two placements across restarts; production repeat movement and the
retention lifecycle still need integration.

The broker-authorized successor bridge can now observe a committed native
placement from the durable original or successor destination stage. It checks
the exact held receiver, source acknowledgement, grant, stage and native
receipt around observation, without replaying the move. A real broker and
native process test covers a committed placement after process exit; it
constructs the earlier transport and detachment journal evidence as a fixture.
The read-only recovery authorization also covers a moved broker transition
and successor takeover while the exact receiver remains held. This does not
establish authority to dispatch placement or release the receiver.

The OpenCode destination plugin now retains its own held receiver candidate
while the installed membership is recovered. It fences tools and buffers
deliveries from the moment that candidate is established, verifies the native
Session, moved transition and released broker hold before admitting work, and
does not unsubscribe its candidate during recovery. A broker-backed adapter
test simulates placement and settlement, waits through the recovery timer and
checks that a queued message is admitted only after release. This does not
authorize placement or release, and the remaining Gate 2 requirements below
still apply.

An internal OpenCode transaction engine now moves a quarantined Session,
installs the receiver-bound staged membership and records the placement receipt
in one durable event transaction. Narrow SQLite guards keep quarantine active
and refuse unrelated writes; failure during projection or receipt insertion
rolls back the move. Isolated tests also terminate the committing native process
without an acknowledgement, recover the receipt under a successor lease, and
exercise another successor takeover and the private host observation channel.
The tests use an activation-issued native owner, but do not prove destination
authority or broker authorization; no production or private RPC can invoke
this transaction yet. Complete authority, resource reconciliation,
broker-bound dispatch and receiver release, both-runtime execution and task
acceptance still prevent Gate 2 closure.

New OpenCode fork and import reservations are now recorded on their durable
anchor event in the same transaction as projection. Strict log reads validate
that evidence, handle pagination and live delivery across the reserved range,
and reject malformed or overlapping ranges. Native fork/import tests and a
database reopen test exercise the real Session services. Existing reservations
made before this evidence existed remain unproven and fail closed; this does
not perform placement or close Gate 2.

The isolated OpenCode native movement server now persists events and checks
continuity before reporting a log synchronization watermark. A real server
test restarts it and verifies new events survive, while a Session created by
the prior non-persisting runtime produces a stream failure instead of a false
sync marker. Strict reads also fail on unknown event types and on inherited
sequence reservations that lack durable range evidence. This does not enable
placement or close Gate 2.

OpenCode now has an internal placement receipt whose insertion requires the
exact persisted move event's transaction and current native lease. Receipt
observation checks the quarantine, protected destination, source archive,
seal, receiver-bound stage, installed membership, move event, sequence and
location-switch message. SQLite replacement guards also protect the archive,
stage and seal, and existing version-2 stores install those guards on startup.
The receipt fixture assembles its evidence around a real native event projector;
it does not perform a quarantined move. Placement, receipt-aware
recovery, complete authority, resource reconciliation and receiver release
remain open.

The OpenCode durable event bus now provides internal transaction callbacks
before projection and after persistence, with rollback and post-commit
notification tests. Native placement protection can rebind its guarded SQLite
connection inside a transaction and restore that binding from the committed
Session after rollback. These are transaction primitives only: they are not
wired into a placement operation and do not establish movement readiness.
The placement receipt and crash recovery, destination installation, authority,
resource reconciliation and end-to-end acceptance remain required.

An explicitly configured broker-owned native verifier can recover a source
detachment acknowledgement after the original receiver socket disappears. A
successor native owner can then stage the archived destination membership under
the held receiver, with a durable no-replay journal. Real broker and native
server fixtures cover source and broker restart and uncertain stage results;
the source adapter is a fixture. This verifier is not in the normal launcher,
and actual placement, installation, full authority, resource reconciliation and
both-runtime acceptance remain open.

The destination plugin can now own the broker handoff candidate through an
explicitly configured private Location RPC. The host uses that same socket for
authorized native source detachment and staging, and a recovery server can
resume it after the original server exits. An isolated native-server test loads
the actual destination plugin with a source-adapter fixture; placement,
installation, full authority, source-acknowledgement recovery, resource cleanup
and both-runtime acceptance remain open. See `receiver-handoff.md`.

The staged destination membership now carries its transition and receiver-key
hash. The OpenCode destination plugin can recover that exact key after a released
handoff, verify the moved broker transition and actual Session location, and
preserve the binding across membership writes. A native-stage-to-plugin fixture
simulates placement and settlement; actual native installation, placement,
receiver candidate ownership and full Gate 2 acceptance remain open.

Native permission preparation now compares actual ordered rule observations,
reports hooks and pending requests separately, and rereads saved rules during
revalidation. Managed-policy inputs and returned state are owned and immutable,
closing an alias that bypassed the native authority revision. Pending permission
metadata is copied before dispatch and isolated from hook and reader mutations;
metadata that cannot be copied without loss, including shared memory, is refused.
Approval request and reply events are copied per listener and subscriber to
protect displayed details. Native forms likewise own creation and answer data,
return detached views, and isolate creation, reply and cancellation events per
consumer. Unsupported form data is refused rather than copied with loss. The built-in
permission hook and atomic exclusion of external changes still require proof;
this is not complete destination authority or movement authorization.

The held destination receiver can now authorize an inert native membership
stage copied from the exact archived source value and bound to its receiver-key
hash. The source Session and normal plugin membership remain unchanged and held;
lost staging replies are observed through native recovery. This prepares data
for a future placement transaction, not destination authority or installation.

The original live native owner can now archive and seal the source membership
under its own quarantine after transport release, with fresh receiver-bound
broker authorization and a durable host dispatch. When the original adapter
connection survives, an authenticated recheck lets that adapter acknowledge
the detached key. A real native server, broker and SQLite-backed adapter fixture
exercise this path and lost-result recovery. Destination installation, actual
placement, complete authority, resource reconciliation and recovery after loss
of the source acknowledgement remain open; Gate 2 is not closed.

A successor can now preserve a quiet Turnlink source membership in a protected
native archive and atomically remove and seal the source key, after the broker
receiver is transferred into the matching held handoff. Lost results are
observed without replay. This does not acknowledge detachment to the broker,
install the destination membership, reconcile other resources or move the
Session; Gate 2 remains open. See `receiver-handoff.md`.

The staged OpenCode live dispatch journal is now connected to the existing
broker-authorized recovery claim and absent-membership seal. Real server
restart tests cover lost preparation, release, claim and seal replies,
including successor takeover. The quarantine remains held and no destination
placement, resource reconciliation or receiver installation is implied.

An isolated actual OpenCode server now completes a fixture model turn over a
local WebSocket and releases that tracked socket under the broker-approved
transition. A native busy refusal before preparation is recorded distinctly,
allowing a fresh authorized attempt after the turn settles; lost replies stay
uncertain. This does not establish remote cancellation, prior-process recovery,
other resource release, destination placement or receiver installation.

An explicitly started, isolated OpenCode stdio server can now install the
private live movement channel in its own service graph. A real broker grant
reaches the actual server owner and releases an empty tracked transport inventory; the
normal launcher remains unchanged. Session-bound Location and form routes now
check quarantine before starting their Location graph, so rejected input does
not invalidate the following transport release. Global forms, other resource
families, real destination placement and receiver installation remain unfinished.
This does not attach to an already-running server or prove remote resource
cleanup. Gate 2 remains open. See `receiver-handoff.md`.

Staged OpenCode now re-observes well-known configuration from the live source
without applying or caching that observation. It checks the source catalog,
manifest, resolved request, response and selected credential against the loaded
snapshot. Missing, changed or unavailable remote inputs invalidate that
snapshot; cached fallback alone cannot certify it. The observation is not a
remote lock or proof of executable plugin behavior. Native resource
reconciliation, placement, receiver continuity and both-runtime acceptance
remain open; movement remains disabled.

OpenCode's staged native preparation now rechecks local configuration files,
configuration discovery and process-environment and file substitutions against
the values consumed by the native loader. An observed mismatch invalidates the
snapshot until a successful reload. Credential-injected substitutions without
a verified native credential and managed preferences without an equivalent
rereader fail closed. This does not prove executable plugin state or atomic exclusion of
external filesystem changes; placement, resources and receiver continuity remain
unfinished. See `native/opencode/README.md` for the limits.

OpenCode's native configuration service now returns detached, schema-preserving
entries instead of sharing its loaded configuration objects with callers. A
caller can no longer mutate nested provider settings, permissions or the entries
array without going through the service's authority-change path. This closes an
alias in configuration authority; it does not establish fresh file inputs,
plugin behavior, resource release, placement or receiver continuity.

The staged OpenCode native owner retains source and destination directory
descriptors during authority preparation and revalidates their identities under
the same native reservation and authority revision. The opt-in runtime also
binds each cached Location graph to a directory identity observed around its
construction; a graph from a replaced directory is refused. This does not
establish graph content provenance, child-file freshness, resource release or a
placement commit; movement remains disabled. The supported filesystem and
observation limits are recorded in `native/opencode/README.md`.

Staged OpenCode can now fence its source plugin membership key and, under an
exact recovered native owner plus fresh broker authorization, durably seal its
absence. A separate host intent prevents blind replay after a lost reply. The
version-2 storage marker excludes the previous compatible bootstrap; old
unfenced quarantines cannot use this proof. Destination installation, other
resource reconciliation, full authority, native placement, receiver continuity
and both-runtime acceptance remain open. Movement stays disabled. See
`native/opencode/README.md`.

The staged OpenCode source adapter now retains its membership for native archival
and independently verifies its absence before acknowledging receiver detachment;
the broker requires that durable acknowledgement before releasing a transferred
receiver. Active local work or cleanup failure retains the hold. Destination
installation, native commit ordering, closed-source recovery and full Gate 2
acceptance remain open. Movement remains disabled.
See `receiver-handoff.md`.

A staged broker receiver handoff now rotates a destination-specific durable
proof between two authenticated connections under the exact worktree grant.
A durable hold blocks peer delivery and task pulls until matching transition
settlement and receiver release; restart and lost replies are recoverable.
The handoff is off by default and has no production launcher or native adapter
wiring. Native placement, full authority, physical resource reconciliation and
both-runtime end-to-end acceptance remain open. See `receiver-handoff.md`.

Recovery inspection now includes the number of dependent Sessions with prior
tracked WebSocket acquisitions, under the existing native owner and broker
checks. Worktree task preparation also requires a matching settled transition
and destination scope; ordinary task pull still excludes worktree tasks unless
the separate staged broker and adapter switches are explicitly enabled. These are not
physical cleanup, native commit or receiver-rebind proof. Full destination
authority and both-runtime end-to-end acceptance remain open; movement remains
disabled. See `native/opencode/README.md`.

Staged OpenCode now refuses prior-lease tracked WebSocket replay and holds
suspended parent Sessions through persisted jobs and Session ancestry, including
children whose background jobs were not yet persisted. Real crash/restart
checks and full Core, server and host control suites passed. Physical and
remote work reconciliation, untracked model work, full destination authority,
native commit, exact receiver rebind and both-runtime acceptance remain open;
movement stays disabled. See `native/opencode/README.md`.

Staged OpenCode now detaches tool JSON input/output schemas and Code Mode
catalog snapshots, while preserving Effect and standard-schema implementation
identity. Those implementations and plugin callback state remain unproven.
Physical resource reconciliation, complete destination authority, native
commit, receiver rebind and both-runtime acceptance remain open; movement
stays disabled.

Staged OpenCode now detaches MCP editor configurations, caller-owned runtime
overrides and returned catalog/status objects. Isolated tests verify the actual
spawned command and live loopback catalog. Opaque schema implementation state, other
authority, physical resource reconciliation, commit, receiver rebind and
both-runtime acceptance remain open; movement stays disabled.

Authority-aware native State editors now expire after their synchronous
transform, and command definitions no longer retain caller-owned aliases.
Mutable values returned by other editors still require domain-specific handling. Resource reconciliation, full destination
authority, native commit, receiver rebind and both-runtime acceptance remain
open; movement stays disabled.

The staged OpenCode agent registry now detaches ordinary data after synchronous
transforms and on reads, preventing retained editors and plain data aliases
from silently changing selected permissions and request fields. Opaque
provider objects, accessors and callback state remain unproven. Full resource
reconciliation, destination authority, commit, receiver rebind and both-runtime
acceptance remain open; movement remains disabled.

The staged OpenCode hook and tool registries now isolate the provider-filter
options and tool metadata/editor aliases that could mutate executable authority
without a reservation change. Focused regressions and full Core, server and
host control suites passed. Other registry domains, mutable schemas and
callback state remain unproven, as do resource reconciliation, native commit,
receiver rebind and both-runtime acceptance. Movement remains disabled.

The staged OpenCode recovery path now supports successor takeover of an exact
prior claim, with a native lease-bound compare-and-swap and a durable host
attempt record. Real broker/native restart tests cover simulated lost replies
and pre-dispatch failure. This transfers recovery ownership only; resource
reconciliation, destination authority, native placement, receiver rebind and
both-runtime acceptance remain open. Movement remains disabled.

Recovery inspection now exposes current- and prior-lease tracked model
WebSocket acquisition counts through the exact native owner and broker-checked
host. A real socket and owner-crash test confirms the prior record survives to
inspection. The counts do not prove physical or remote cleanup. Complete destination authority, commit, receiver rebind and
full both-runtime acceptance remain open; movement remains disabled. See
`native/opencode/README.md` for the matching patch and verification.

The staged OpenCode compatible runtime now records each model WebSocket
acquisition before opening it and retains unresolved records across process
exit. A successor cannot clear another lease's record or issue an empty local
release receipt while it remains. This does not establish remote cancellation,
all resource cleanup, destination authority or receiver continuity. Core passed
7,191 / 43 skipped, server 92 / one skipped, and focused process-restart
checks passed; see the native manifest and README for scope. Movement remains
disabled.

OpenCode now has a staged isolated stdio launcher, inherited descriptor and
host recovery journal. A successor can observe a prior native recovery claim
under exclusion and fresh broker checks without replaying it. Production adapter
wiring, physical resource recovery and movement authorization remain open.
It does not release quarantine or authorize execution. It fences pending
permission request mutations and isolates grant fields from caller and observer
aliases. It also
identifies the native MCP tool transform and its owning Scope, and fences MCP
catalog changes through registry reload.
Full Core, workspace, server and SDK checks passed; details are in
`native/opencode/README.md`. Codex checks tracked local MCP stdout and stderr
closure, but descendants can close both pipes. Complete resource and orphan
reconciliation, durable recovery, destination authority and commit, exact
receiver rebind and both-runtime end-to-end acceptance remain open. Movement
remains disabled.

## Completed foundation

- Authenticated channel governance, voluntary master election/appointment,
  generation-fenced authority, supplemental role notices and lease maintenance.
- Durable task/dependency/schedule/capacity state, voluntary claims, adapter
  evidence, participant reports and explicit master acceptance.
- All six recovery operations with broker intent/receipt recovery, authenticated
  receiver outcomes and native queue/steer/paused acceptance (`control-recovery.md`).
- Opt-in OpenCode existing-session/cwd task execution, including real-service
  end-to-end claim → native execution → evidence → report → accepted result.
- Worktree approval/grant/journal primitives, offline destination observations
  and Codex stdio admission-fence primitives (not enabled movement).
- Operator-only storage status/watch and immutable private control exports with
  consistent SQLite snapshots, bounded downloads and integrity/restart checks.
  Export alone does not reclaim capacity or replace broker/journal backups.
  Explicit verified receipt/history reclamation now recovers eligible live quotas;
  broader entity/evidence capacity work remains in progress.
- Broker metadata activity observations, operator-only cursor reads, bounded
  30-day retention with unresolved-message/evidence protection and visible
  telemetry loss. Observations are not native admission/stop/replay evidence.
- Core loopback React/Mantine console: separate operator login/session, CSRF/Host/
  Origin protection, scoped real broker views and preview/confirm with transactional
  policy/authority preconditions. Desktop/mobile Chromium fixtures include axe,
  theme, untrusted-content, stale-preview and uncertainty checks. Read-only receipt
  lookup reconciles lost HTTP replies without resending commands. Not deployed.
- Separately opt-in passive OpenCode CLI alerts: member/proof-scoped broker
  metadata, native Location/session-fenced read RPC, bounded local deduplication,
  status dialog and optional content-free OS attention. Real isolated server and
  POSIX terminal fixtures prove an alert without a model wake. No global config
  changes or production activation; OS/Windows/IDE acceptance remains separate.
- Opt-in native OpenCode/Codex health snapshots and a read-only operator Health
  view: actual enrolled receiver authentication, metadata-only payloads,
  unknown/stale/prior-run handling, bounded protected retention and exports.
  Health is observational, never admission/stop/replay evidence (`adapter-health.md`).

## Delivery gates (in order)

Latest native integration checkpoint (2026-10-29): executor-backed MCP stdio
termination now uses one retained, serialized handle across the outer and inner
transports. Caller cancellation does not cancel the worker, and an unknown
failed attempt cannot be replayed or reported as success by another handle alias.
The in-memory state is not yet a durable Session cleanup receipt and does not
prove local process-group exit, descendants, raw executor aliases or transport
closure. Verification: MCP client 266/one ignored, MCP manager 272, both native
builds and twelve staged process cases. The first manager run timed out its
existing five-second cold CLI probe; the unchanged retry passed after warmup.
Complete destination authority, resource reconciliation, compatible writers,
owner recovery/commit, exact receiver rebind and both-adapter grant → native
effect → task evidence → acceptance remain Gate 2 requirements. Gate 7 retains
Windows/IDE operational rollout and deployment review. Full authority,
production control and movement remain disabled. See
[the execution ledger](remaining-development.md).

Earlier combined parent verification: **509 passed, eight platform-specific skips,
zero failures (517 total)** with all five native integration flags; syntax checks
passed. The reviewed fixture race/deadline fixes and actual existing-environment
installation are recorded in [the execution ledger](remaining-development.md).
The development endpoint is `ws://127.0.0.1:47325`; no additional editor instance
was opened. Native source continuity and observed client acceptance remain open.
The current broker checkpoint separates provider-context establishment approval
from movement authority. Constructor success retains conversation/resource holds;
it cannot authorize movement or task dispatch, and scoped receipts cannot be
laundered into failure/replayed readiness. Schema/export 21 protects partial retained ownership and the model-context
resource/cleanup holds from older reducers. Codex native plan production and approved factory construction are
implemented; complete runtime cleanup, handoff and authority remain open. Both production execution
capabilities remain off.
The earlier native channel checkpoint adds a private inherited Unix host channel for
actual owner/reservation acquisition and exact broker-record binding, with durable
journal/directory witnesses and disconnect/restart quarantine. A real staged
process component passes with synthetic readiness inputs; it does not establish
movement authority. Core 2,919, affected default-stack four, private-control three,
JavaScript changed-scope 53 and both production compilation checks pass. Explicit
approved resource establishment, complete authority/census, native commit and
receiver handoff remain open; the production proxy stays unwired.
The internal coordinator now requires a fresh `control_worktree_authorize`
response after local verification and before native invocation. The broker checks
the actual enrolled receiver and current exact grant/claim/approval/occupancy and
runtime evidence; command receipt replay cannot substitute for that check. This
is broker eligibility only: production native owner binding, approved destination
resource establishment and exact receiver/commit continuity remain unfinished.
This checkpoint passes the complete JavaScript suite (521 passed, 14 opt-in/platform
skips, zero failures) with serial test files, plus syntax checks; it adds no new
installed-native or platform acceptance.
Historical milestone results below retain their original scope. The latest Codex
increment adds explicit provider factory construction using original base auth,
with source/destination observations and known gateway error refusal. Its changed
scope passes 131 provider tests, four default-stack cases and app-server compilation.
It is not yet connected to broker approval or session installation. The preceding
full selected-root checkpoint assembles Config, selected provider definition/original factory auth,
retained current model/auth and bound instructions against one native owner/candidate.
Provider resource declarations remain data, with no credential or process startup.
Verification: 2,915 Core / 429 executor / 219 login / 127 model-provider /
4,026 selected library cases; separate configuration 398 and HTTP-client 125
(4,549 across scopes), nineteen default-stack cases, app-server and six registry
passes. Executor acceptance uses the same frozen binary with a serial harness;
two original parallel deadline failures remain recorded. Complete destination
resource establishment, authenticated approved effects, exclusion, authority
publication, native commit and receiver/release remain unfinished; see the ledger.

Resumption checkpoint (2026-10-23): see [migration resume](migration-resume.md)
for the recovered OpenCode conversation, current verification and next work.
The interrupted admission-uncertainty milestone is implemented in schema/export
14: uncertain admission outcomes advance `stopGeneration` and invalidate older
admission/start/progress/stop callbacks. Exact command retries retain their
original receipts. A runner may capture the next observation generation only
for its own lost-admission receipt, with unchanged dispatch binding and no cached
native execution evidence, before collecting fresh native evidence. OpenCode
reuses its native admission ID; Codex observes its exact existing turn without
resending `turn/start`. Schema-13 migration preserves raw state and receipts.

Report-notice resumption now rechecks broker eligibility after asynchronous
native scope/snapshot reads. Both runners require their exact stop evidence,
unchanged task binding and generation, no terminal hold and an eligible uncertain
task before waking a report turn. New uncertainty during those reads retains the
journal and refuses the report wake. Healthy deferred notices still proceed.
These checks do not atomically exclude uncertainty between the final broker read
and native submission; authenticated ownership/exclusion remains an open gate.
Fresh verification: 427 parent tests passed/three Windows skips (430 total),
24 desktop/mobile browser cases passed, syntax/dashboard build/whitespace checks
passed, and independent scoped code review found no actionable defects. Both
new race reproductions failed before the fix; their healthy/refusal controls
pass afterward. The browser fixture now explicitly refuses stale stop evidence
and supplies the current generation for fresh fixture evidence. Full platform
completion and production native movement remain open.

Latest isolated native typed-stop milestone: synchronous single-process fallback
`proc.kill` throws now enter the `PlatformError` failure channel, preserving their
cause instead of escaping as Effect defects. Explicit stops still fail after
notifying their captured invocation sink; active finalizers retain uncertainty
while following the existing ignored-typed-failure policy. Scope closure success
is not a native cleanup receipt. Completed-exit best-effort cleanup remains unchanged.
One new actual POSIX invalid-signal case verifies typed cause/metadata, captured
sink isolation and retained refusal through valid cleanup; the prior finalizer
case verifies settlement without a defect while retaining uncertainty. Restoring
the old mapping fails both. Verification: 7,147 native core passed/43 skipped,
410 process/Git-observer repetitions, Util 95, all 35 checks, Util/Core/Server
builds, server 85/one skip and SDK 14. Pinned patch forward-index/reverse/whitespace
checks passed; logs use `native-kill-typed-*-final.log` and `native-kill-typed-red.log`.
Pre-acquisition cancellation reachability/settlement, OS-specific kill failures,
post-exit cleanup, quiet descendants, per-handle census and physical release are
not proven. No speculative cancellation path, installed runtime/global settings,
native public Protocol/HttpApi or movement activation changed. Authenticated
ownership, dynamic compatible owner/alias/orphan census, approved release/rebinding,
destination authority, production ports and non-native acceptance remain open.
Goal incomplete; prior parent verification remains 411 passed/three skipped.

Previous lifecycle-callback ordering milestone (schema/export 13): `task.admission`
(all outcomes), `task.started` and `task.progress` must match the generation frozen
before explicit nonterminal `task.uncertain`. A stale exact native admission key
cannot promote uncertain work to dispatching/running, rewrite admission evidence
or refresh progress/deadline bookkeeping. Matching the epoch retains existing
lifecycle checks and is not proof freshness/ownership/release. Historical command
retries return their original receipts without reapplying old transitions. Both
runners attach nonzero journal generations; zero-generation callbacks preserve
pre-upgrade fingerprints by omitting the field. Schema-12 migration preserves raw
state and receipts; old reducers must refuse schema 13. Verification: 411 parent
passed/three skipped (414 total), 1,010 focused repetitions, syntax/whitespace
checks; removing each admission/start/progress check fails three cases. Seven new
cases cover successive uncertainty, migration/replay/rollback/exhaustion, actual
authenticated wire refusal and nonzero-generation dispatch through both runners.
Logs: `callback-generation-*-final.log` and `callback-generation-*-red.log`.
Admission-outcome uncertainty does not itself advance this counter. Native source
epochs, other late callbacks, atomic broker-to-native wake exclusion, authenticated
owner/alias census, physical release/re-establishment, destination/exact receiver/
production ports, recovery/storage/OS/platform acceptance remain open. No installed
runtime/global configuration/native extension/native Protocol/HttpApi/permissions
or movement activation changed. Goal incomplete.

Previous broker stop-ordering milestone (schema/export 12): explicit nonterminal
`task.uncertain` commands advance `stopGeneration`, revoke usable stop evidence
and retain participant reports. Stop callbacks after an advance must match that
generation; new IDs do not launder stale observations. Exact uncertainty retries
do not advance twice; accepted old stop retries cannot restore revoked evidence.
The counter survives restart/reassignment/settlement and saturates in refusal.
Legacy zero retains old callback compatibility, not retrospective freshness.
Terminal holds keep their independent generation contract. Both runners preserve
their dispatch-journal generation and refuse mismatches without native/report
replay or journal retirement; current stop eligibility is rechecked after a
successful/replayed stop response. Tests inject uncertainty across artifact/stop
responses and reconstruct journals. This is not an automatic native observer,
native source epoch, authenticated owner, physical-release proof or atomic native
report-wake authorization. Admission uncertainty and other callback paths remain
outside this fence. Legacy zero-generation stop retries preserve pre-upgrade
command fingerprints after journal reconstruction and lost replies. Verification:
404 parent passed/three skipped (407 total), 940 focused repetitions,
syntax/whitespace checks; removing generation matching
or advancement fails three cases each. Logs: `stop-generation-*-final.log` and
`stop-generation-*-red.log`. No installed runtime/global configuration/native
extension/public native Protocol/HttpApi/permissions or movement activation changed.
Full destination authority, dynamic owner/alias census, approved release and exact
receiver/production integration, recovery/storage/OS/platform acceptance remain
open. Goal incomplete; this milestone does not close those gates.

1. **Codex existing-cwd task flow — implemented and fixture-verified.** Separately opt-in existing-thread,
   existing-cwd native task admission, private attempt journal, exact native
   turn evidence, participant report and master acceptance. Preserve editor
   responses/notifications and actual human cancellation/approval handling.
   Codex has no proven native admission-idempotency key: uncertain mutation
   recovery must inspect an exactly correlated turn, never blindly resend.
   Require real-process failure/restart tests and the isolated real Codex gate.
   Implemented in `src/codex-tasks.js` and the stdio proxy, with process-restart
   regressions and real native-model/MCP claim/report/review acceptance. This
   does not claim worktree, Windows/IDE or production parity.
2. **Native worktree continuity — next, not enabled.** Complete effective destination authority and
   native exclusion, wire owner RPC/journal/quarantine recovery, verify the exact
   conversation's receiver continuity, then demonstrate approved grant → native
   effect → rebind → task evidence → acceptance. OpenCode arbitrary moves keep
    detaching. No hash-only permission equivalence or uncertain movement replay.
    Operator-authorized isolated OpenCode source work has begun: the private
    execution-reservation extension and reproducible upstream patch are described
    in `../native/opencode/README.md`. It guards drains, native shell/generation,
     ordinary moves, permission/agent/model selection changes, instruction API
     updates, skill/revert facades and public prompt/command/compaction/synthetic
     admission plus pending-input mutations. Instruction writes now use a shared
     global mutation service for both direct native and HTTP callers; the
     Location-scoped instruction reader no longer exposes unguarded writes.
     Child/fork inheritance and public environment updates are guarded, and
     human deletion cancels reservations and waits through cleanup before its
     guarded durable effect. Session metadata updates now share the same activity
     boundary, including calls from the plugin host. Environment reads now use a
     read-only service over private storage; direct set/clear callers use guarded
     global mutations, with independent snapshots and cancellation regressions.
     Managed-policy and saved-permission writes now invalidate held native
     reservations without delaying revocations, refusing new guards until
     registered mutations settle. Config writes/reloads now register mutations,
     and scoped dirty observers fence observed filesystem changes across the
     debounce gap and retain newer pending batches. Plugin registry readiness
     holds now synchronously fence activation and failure processing; explicit
     close and asynchronous failed-plugin teardown also register mutations.
     Late agent/command/tool State registration, reload and disposal now use
     scoped pending-change observers and reconciliation guards, including batch
     deferral, failed loads and overlapping notifications. This lifecycle also
     covers skill/instruction discovery, formatter, image/output limits, snapshot
     and compaction settings, shell selection, watcher policy, websearch definitions
     and worktree strategies. Reference/VCS registries now also participate;
     reference refresh holds a separate mutation guard across background cache
     work, and VCS retains its guard through owned reconciliation. Integration/
     provider registry mutations now join this boundary, and global native
     credential writes invalidate reservations through database work/notification
     without delaying revocation or reservation cleanup. Model State and lazy
     provider inputs now have separate observers; cached reads do not cancel
     guards or settle deferred notifications. Materialization rechecks State
     revision after asynchronous provider validation to reject stale candidates.
     MCP State/direct lifecycle operations now fence authority as well; counted
     scoped holds cover queued startup, credential reconnect and SDK callback
     workers before dispatch, through their settlement and cleanup.
     Source/consumer
     handoffs, remaining State domains, resource reconciliation, unregistered sources
     and full destination authority remain unresolved;
     no movement/continuity gate is satisfied. Focused regressions, native server/
     SDK suites and workspace checks pass. After sleep-interrupted attempts, an
     awake-host full core runs passed (latest completed authority
     run: 6,689 passes, 43 skips, zero failures), and the core build completed.
     Lifecycle additions also pass repeated focused tests, native server/SDK,
     both builds and workspace checks. Authority invalidation additionally has
     repeated focused and full-core acceptance. See the native README for exact
     outcomes, including the non-green overlapping validation attempts;
     config fencing passed 6,693 core tests (43 skipped, zero failures) after
     correcting two startup-readiness fixtures. Follow-up direct-reload failure
     fencing passed 73 focused tests, 50 repeated cases and its complete rerun
     (6,694 passed, 43 skipped, zero failures). Registry extension passes 430
     repeated plugin/failure/authority tests and 52 generation/move/supervisor/
     failure cases, plus the complete core suite (6,698 passed, 43 skipped,
     zero failures), native server/SDK suites, both builds and canonical workspace
     checks (35 typecheck tasks; zero lint errors).
     Additional agent/command/tool State coverage passes 750 repeated State/plugin/
     failure tests, native server/SDK, both builds and workspace checks; its full
     core rerun passed 6,713 tests (43 skipped, zero failures). The eleven further
     registries pass 1,080 repeated cases and final sequential workspace/build/
     server/SDK checks plus 6,746 core tests (43 skipped, zero failures). Four
     intermediate shared-fixture override failures were fixed with a separate
     registry-test composition; existing assertions/timeouts were preserved.
     Reference/VCS additions passed 124 focused tests, 80 repeated cases and
     final sequential workspace/build/server/SDK checks plus 6,754 core tests
     (43 skipped, zero failures). Sixteen registries are covered; this is not
     cache-integrity proof, complete runtime authority or destination equivalence.
     Subsequent integration/provider and credential-write coverage passes 123
     focused tests, 100 repeated cases and sequential workspace/build/server/SDK
     checks plus 6,764 core tests (43 skipped, zero failures). Eighteen registry
     lifecycles are now covered; Model/MCP and downstream lazy-input/resource
     settlement and source-consumer handoffs remain unresolved.
     Subsequent Model coverage passed 125 focused tests, 130 repeated cases,
     a red/green stale-candidate regression and sequential workspace/build/server/
     SDK checks plus 6,772 core tests (43 skipped, zero failures; 266 files).
     Nineteen registry lifecycles are covered. MCP and downstream source/consumer
     and runtime-resource boundaries still prevent continuity acceptance.
     Subsequent MCP/queue coverage passed 137 focused tests, 110 repeated cases
     and sequential workspace/build/server/SDK checks plus 6,783 core tests
     (43 skipped, zero failures). All twenty current State registries have this
     integration, but source/consumer handoffs, resource shutdown, non-registry
      native effects and host-wide use safety remain unresolved. No movement gate
      is satisfied by a registry count.
      Native config-publication handoffs now fence all seventeen configuration
      consumers before volatile delivery, through discovery/read/reload settlement,
      including agent/command debounce and failed reloads. Location/workspace
      filtering, coalescing and listener/worker disposal have controlled tests.
      Seven new regressions plus the existing startup test passed 80 repeated
      cases. Final sequential workspace checks (35 typecheck tasks), both builds,
      server/SDK suites and full core passed (6,790 passed, 43 skipped, zero
      failures; 267 files). Intermediate fixture wiring/location failures were
      corrected without weakening assertions/timeouts. Filesystem watcher,
      credential/managed-policy and plugin-source downstream handoffs, resource
      shutdown, non-registry native effects and full destination authority remain
      unresolved. This closes only the native config-publication portion of the
      source/consumer gap; movement remains disabled.
      Integration/Credential → Provider and Provider → Model catalog notification
      handoffs are subsequently fenced too, with two red/green blocked-source-read
      regressions. Dispatch now follows source-event publication while fencing
      still precedes it, preserving the existing ordered catalog-event assertion.
      The four-file group passed 410 repeated cases; final sequential workspace
      checks, both builds, server/SDK and full core passed (6,792 passed, 43 skipped,
      zero failures). An intermediate catalog-ordering regression was fixed, not
      suppressed. Other credential-dependent plugin feeds, managed-policy/plugin
      source feeds, native resource teardown and destination continuity remain
      unproved; these catalog handoffs do not enable movement.
      Explicit Location reload now fences invalidation and replacement acquisition
      through the shared host authority, including its HTTP handler. A reproduced
      cancellation gap is fixed by retaining ownership through map-owned acquisition
      settlement instead of releasing the fence when only its borrower stops.
      Three real LayerMap scope tests and a native HTTP test passed 40 repeated
      cases. Sequential workspace checks (35 tasks), both builds, server (85 passed,
      one skipped), SDK (14 passed) and full core passed (6,795 passed, 43 skipped,
      zero failures). These controlled resource graphs do not prove full Instance
      teardown, delayed failed-build cleanup, held old borrowers or detached-process
      safety. A hung replacement keeps its fence; bounded cancellation is not
      claimed. Full resource shutdown/destination continuity remain required.
      Direct Location lifecycle shutdown now fences permission/form/RPC closure
      and shutdown notification independently of reload; failed closure stays
      pending until its owner is disposed, and duplicate shutdown cannot recover
      it. Two actual-service regressions passed 20 repeated cases. Sequential
      workspace checks (35 tasks), both builds, server/SDK and full core passed
      (6,797 passed, 43 skipped, zero failures; 269 files). These lifecycle tests
      use controlled closure dependencies and do not prove every asynchronous
      Instance finalizer or detached resource has settled. Source-feed, complete
      teardown, destination-authority and exact receiver gates remain required.
      Instance graphs now own a child resource scope fenced during acquisition,
      failed-build cleanup and scope disposal, using the same host-global authority
      and shared memo map. Two real Instance/LocationServiceMap regressions hold
      late Environment disposal and failed-boot Snapshot cleanup. Both fail fresh
      admission assertions with the lifetime guards removed and pass when restored;
      twenty repeated cases passed. Sequential workspace checks (35 tasks), both
      builds, server/SDK and full core passed (6,799 passed, 43 skipped, zero failures;
      270 files). This covers scope-owned graph resources, not detached descendants,
      externally retained resources, old-graph borrowers or host-wide use safety.
      Remaining source feeds, destination authority and receiver continuity remain
      required; production movement stays disabled.
      Managed-policy writes now synchronously mark native catalog/supervisor
      subscribers before stream delivery, retaining separate pending fences through
      reload/activation and debounce. Failed policy-driven work cannot clear its
      source fence merely by logging an error; revocation does not await downstream
      I/O or old reservation cleanup. Three source/catalog regressions passed 30
      repeated cases; the handoff/policy/supervisor group passed 24 tests. Sequential
      workspace checks (35 tasks), both builds, server/SDK and full core passed
      (6,802 passed, 43 skipped, zero failures; 271 files). This is not proof of
      every supervisor source or asynchronous update worker. Credential/well-known,
      filesystem/module feeds, retained-resource use safety and destination/receiver
      continuity remain required; movement stays disabled.
      Config's credential-switch and well-known-update inputs now use typed,
      ordered pre-delivery holds, including asynchronous relevance discovery.
      Queued observations retain independent ownership; irrelevant events release
      only their own hold and cannot clear failed reconciliation. A real Config
      blocked-discovery regression fails with the old handler and passes with the
      new fence. Three further observer cases cover queue/failure/disposal behavior;
      the two-file group passed 540 repeated tests. Sequential workspace checks
      (35 tasks), both builds, server/SDK and full core passed (6,806 passed, 43
      skipped, zero failures; 272 files). Other credential-driven provider/MCP
      workers, periodic/external/filesystem/module inputs, retained-resource use
      safety and destination/receiver continuity remain required. Movement remains
      disabled; typed notification observation is not permission-equivalence proof.
      Eight awaited provider refresh paths (OpenAI, ChatGPT, Copilot, GitLab,
      DigitalOcean, Modal, Snowflake Cortex and OpenCode Console) now use typed
      credential-switch handoffs through connection discovery/semaphore/catalog
      settlement. Eight actual-provider blocked-discovery tests all fail with the
      old subscription and pass with the new fencing (80 repeated cases); the
      provider group passed 293 tests. Sequential workspace checks (35 tasks),
      both builds, server/SDK and full core passed (6,814 passed, 43 skipped, zero
      failures; 273 files). Synthetic connection discovery avoids real credentials
      and remote APIs. Azure/Vertex, initial/periodic refreshes, MCP workers,
      filesystem/module feeds, retained-resource safety and destination/receiver
      continuity remain unproved. Cached/handled remote failures are not permission
      equivalence; this does not enable production movement or runtime replacement.
      Vertex's two credential snapshot feeds now share a pre-publication fence.
      Azure now fences rebind/dispatch and transfers counted holds to discovery
      workers; a FiberSet retains displaced workers through their cleanup instead
      of treating the latest FiberHandle as complete ownership. Two Vertex
      blocked-read regressions and one Azure startup/displacement/disposal test
      have direct red/green probes. The two-file group passed 330 repeated cases.
      An intermediate eager-dispatch startup regression was corrected without
      weakening the original no-cloud-calls-before-setup-return assertion.
      Sequential workspace checks (35 tasks), both builds, server/SDK and full core
      passed (6,817 passed, 43 skipped, zero failures). All ten current provider
      credential feeds participate; other initial/periodic work, MCP workers,
      external/filesystem/module/cache inputs, retained-resource safety and
      destination/receiver/production-adapter acceptance remain required. No
      movement or installed-runtime replacement is enabled.
      Credential-provider startup/periodic paths now use a scoped refresh
      owner: Copilot/GitLab/DigitalOcean/Modal acquire pre-dispatch startup holds;
      active polls and Console response-triggered checks stay guarded without
      holding authority during periodic sleep. Closed owners refuse work. Console
      additionally tracks completed application separately from its eagerly saved
      snapshot: an unchanged read cannot clear a failed partial apply or silently
      replay it. Nine regressions passed 90 repeated cases with direct red probes;
      the provider group passed 305 tests. Sequential workspace checks (35 tasks),
      both builds, server/SDK and full core passed (6,826 passed, 43 skipped, zero
      failures; 274 files). These paths are covered, not local-provider polling/
      config subscriptions, arbitrary cache/external changes or successful remote
      rediscovery. Local-provider feeds, MCP workers, filesystem/
      module inputs, retained-resource safety and destination/receiver/production-
      adapter acceptance remain required; movement stays disabled.
      The local-provider factory now fences startup/polls and config notification
      reads, re-reading after subscription to close startup races. Shared cache
      metadata distinguishes successful discovery from failed/in-flight requests
      retaining older models; new owners retain uncertainty despite cached
      availability. Matching hashes require completed projection. Empty optional
      default-probe absence is preserved, while explicit requests/previous inventory
      remain fail-closed; initial readiness regressions were corrected without
      relaxing assertions. Six cases passed 60 repeats, with guard/shortcut and
      partial-projection red probes; the provider/Instance/generation group passed
      329 tests. Sequential workspace checks (35 tasks), both builds, server/SDK
      and full core passed (6,832 passed, 43 skipped, zero failures; 275 files).
      Factory-owned work is covered, not arbitrary external/cache mutations. MCP,
      filesystem/module feeds, retained-resource safety and destination/receiver/
      production-adapter acceptance remain required; movement stays disabled.
      MCP credential switches now fence before source publication through the
      exact stream-dispatched worker and cleanup, retaining independent workers
      and existing server/endpoint locks. Per-registration reconciliation prevents
      another server's success from clearing a failed projection; failure marking
      and revision capture occur under the server lock. Cancelled publications
      remain fenced until owner disposal. Four loopback regressions passed 40
      repeats; bypassing the listener fails the pre-publication assertion. An
      observed recovery-order failure was corrected without increasing timeouts.
      Final sequential validation passed core (6,836 passed, 43 skipped, zero
      failures), all 35 workspace tasks, both builds, server (85/one skip), SDK
      (14). The pinned patch and reproduction notes include this milestone.
      This is not all-MCP callback/retained-connection safety. Filesystem/module/
      cache sources (including models-dev refresh), retained-resource use safety,
      destination authority, exact receiver continuity and production-adapter
      acceptance remain required. Installed runtime/production flags are unchanged.
      The models.dev source now fences lazy population and active refreshes,
      retaining the initial queued hold only through the first iteration, not
      polling sleep. Incomplete cache/application/publication remains pending;
      cached reads and fresh/identical skips cannot claim recovery. Pre-application
      network failures preserve the known offline view without permanently
      poisoning it. Cache timestamps use the caller's Clock. Source refresh events
      are explicitly global even with an ambient Location; the plugin now fences
      before event delivery through snapshot read and Integration/Provider apply.
      Six tests passed 60 repeats. Active/source-marker/consumer/global-flag red
      probes fail directly; the manual benchmark graph's missing dependency was
      corrected after typecheck. Full core passed 6,842/43 skipped/zero failures,
      all 35 workspace tasks, both builds, server (85/one skip) and SDK (14) passed.
      Filesystem/module/cache external mutation, workspace polling, retained-
      resource safety and destination/receiver/production-adapter acceptance still
      remain required. No installed-runtime or production movement changes.
      Watcher now has an opt-in synchronous pre-queue hook scoped per consumed
      stream, including independent wrappers for a shared callback/backend.
      Instruction ancestor/global and configured-file feeds mark there and retain
      pending authority through debounce, rescan and discovery reload, separately
      from config-event reconciliation. Registration hooks do not prove acquisition
      or discovery completeness, nor do they cover unintegrated watcher consumers.
      Shared-subscription/readiness and both instruction cases passed 40 repeats;
      removing observer invocation produces four direct failures. Final validation
      passed core (6,845/43 skipped/zero failures), all 35 workspace tasks, both
      builds, server (85/one skip), SDK (14). Skill/config/module watchers, external
      cache inputs, workspace polling, retained-resource use safety, destination
      authority and exact receiver/production-adapter acceptance remain required.
      Installed runtimes/global configuration/production movement are unchanged.
      Skill watches now mark at pre-queue notification and retain the captured
      revision through watch replacement and downstream catalog reload, separately
      from config-event reconciliation. Config's own watched targets also acquire
      their existing source fence before stream delivery. Directory-derived and
      explicit skill cases test newer events across a blocked reload and the gap
      after its real mutation guard ends. Hook/revision probes fail directly.
      An initially permissive config probe was strengthened with a pre-consumer
      delivery hold; removing the native hook now fails the intended assertion.
      Three final cases passed 30 repeats; full core passed 6,848/43 skipped/zero
      failures, and all 35 workspace tasks passed. Both builds, server (85/one
      skip) and SDK (14) passed on unchanged production code before test-only
      fixture refinement. Module/config-change consumers, external cache inputs,
      acquisition/discovery completeness, workspace polling, retained-resource
      safety and destination/receiver/production-adapter acceptance remain
      required. Installed runtimes/global settings/production flags are unchanged.
      Direct configured-plugin and module-dependency watcher feeds now mark the
      supervisor's separate source observer synchronously before queueing. The
      captured revision spans scan/resolution/activation; reported module-import
      failures retaining the old generation cannot claim source reconciliation.
      Scoped callbacks are independent per consumed stream. Three real-Location
      reload cases plus an isolated source-lifecycle case passed 40 repeats.
      The isolated test was needed because overlapping module watches hid removal
      of the configured hook in the initial graph probe. Final configured/module/
      retained-failure probes fail directly after appropriate activation waits.
      Full validation passed core (6,849/43 skipped/zero failures; 276 files),
      all 35 workspace tasks, both builds, server (85/one skip), SDK (14).
      Upstream config.changes handoffs, package-update/cache/periodic sources,
      acquisition/discovery completeness, workspace polling, retained-resource
      use safety and destination/receiver/production-adapter acceptance remain
      required. Installed runtimes/global settings/production flags are unchanged.
      Config's raw change feed now supports scoped synchronous observation on
      both native and test producers. The plugin-source branch acquires a counted
      hold before asynchronous relevance discovery, transfers relevant events to
      the supervisor fence before release/dispatch, and releases irrelevant events
      without clearing other observations. Failed relevance remains uncertain;
      reused update objects retain independent FIFO-counted holds. Raw callback
      disposal, blocked native delivery and relevance/failure/duplicate cases passed
      40 repeats; five guard/transfer/failure/native/token probes fail directly.
      Full core passed 6,851/43 skipped/zero failures; all 35 workspace tasks,
      both builds, server (85/one skip) and SDK (14) passed. Agent/command/
      compatibility raw-feed consumers, package-update/cache/periodic inputs,
      acquisition/discovery completeness, workspace polling, retained-resource
      safety and destination/receiver/production-adapter acceptance still remain
      required. Installed runtimes/global settings/production flags are unchanged.
      Agent, command, compatibility and plugin-source raw config consumers now
      share Config.observeSource's counted pre-queue/relevance/failure semantics.
      Agent/command preserve irrelevant-path filtering and transfer to their fenced
      notifier; compatibility preserves full raw-change rescans and separately
      fences direct watches through captured-revision reload completion. Three raw
      tests and compatibility's inter-pass case pass; a stronger pre-consumer
      delivery gate makes all three fail when the shared hold is removed. Direct
      compatibility hook/revision probes fail separately. Shared regression cases
      passed 60 repeats. Final core passed 6,855/43 skipped/zero failures and all
      35 workspace tasks passed; builds/server/SDK also passed on unchanged runtime
      code before test-only fixture refinement. Package-update/cache/periodic
      inputs, acquisition/discovery completeness, workspace polling, retained-
      resource safety and destination/receiver/production-adapter acceptance remain
      required. Installed runtimes/global settings/production flags are unchanged.
      Registered package updates now guard lock/install/publication/cleanup and
      retain per-target uncertainty after failed or interrupted installs. Metadata
      checks/other-target success cannot recover them or cause automatic retries.
      Scoped status observers run before stream publication; the supervisor marks
      relevant statuses and counts asynchronous check/apply workers through their
      own cleanup without holding periodic sleep. Four service cases plus a real
      stable-before-scheduled-activation case passed 50 repeats. Install/publication
      and final periodic-worker removal probes fail directly; boot-only probes were
      masked by startup work and are not accepted as negative evidence. Full core
      passed 6,860/43 skipped/zero failures across 277 files; all 35 workspace tasks,
      both builds, server (85/one skip) and SDK (14) passed. No real installer,
      installed-runtime/global setting or production flag changes occurred. Other
      periodic/cache inputs, workspace polling, acquisition/discovery completeness,
      retained-resource safety and destination/receiver/production-adapter
      acceptance remain required.
      Workspace idle polling now counts initial dispatch and guards active
      iterations, not interval sleep. Per-connection observations span suspension
      and cleanup; partial failures stay fenced, unrelated/no-op polls cannot clear
      them, and failed transitions are not blindly replayed (suspend has no
      idempotence contract). Borrows/provision are refused for quarantined IDs.
      Guarded explicit destruction retires only a same-connection observation whose
      cleanup it actually completed; row deletion cannot clear an orphaned failed
      cleanup. Quarantine remains process-local, not durable broker evidence.
      Three deterministic driver/DB cases passed 30 repeats, with separate
      iteration/failure/replay/borrow/reprovision red probes. Full core passed
      6,863/43 skipped/zero failures; all 35 workspace tasks, both builds, server
      (85/one skip) and SDK (14) passed. General provision/cancellation/borrow
      ownership, other periodic/cache inputs, acquisition/discovery completeness,
      retained-resource safety and destination/receiver/production-adapter
      acceptance remain required. No installed-runtime/global settings/production
      flag changes or real provider resource transitions occurred.
      Shared workspace provision attempts now own counted dispatch-to-cleanup
      holds independently of their waiters. Per-ID failed-attempt observations
      survive cached receipts and another ID's success; explicit same-ID create
      recovery retains the driver's idempotence contract. Closed owners refuse
      new provision work. Destruction cannot use a missing-provider/null-binding
      shortcut to retire an observed uncertain create without real driver cleanup.
      The unobserved-row legacy shortcut is not restart absence evidence. Four new
      and three strengthened shared-attempt cases passed 70 repeats, with direct
      queue/failure/cache/provider removal probes. Full core passed 6,867/43 skipped/
      zero failures; all 35 workspace tasks, both builds, server (85/one skip) and
      SDK (14) passed. Borrow/child-process ownership, retained-facade admission,
      durable provisioning/cleanup evidence, other periodic/cache inputs and full
      destination/receiver/production-adapter acceptance remain required. Installed
      runtimes/global settings/production flags are unchanged; no real provider
      resource transition was run.
      Workspace file/spawn borrows now own retained leases independent of the
      Workspace owner's scope, with a worker and resource scope per borrow.
      Cancellation joins worker cleanup; spawn acquisition retains authority through
      caller/process-resource cleanup. Memoized cleanup failure cannot become
      success on a later close, and closed owners refuse stale facade/new work.
      The primitive and four deterministic borrow cases passed 50 repeats;
      lease/early-release/memoization/stale-admission probes fail directly. Full
      core passed 6,872/43 skipped/zero failures across 278 files; all 35 workspace
      tasks, both builds, server (85/one skip) and SDK (14) passed. These are
      instance-local refusal leases, not durable receipts or detached/unref'ed
      handle census. Other retained services, physical cleanup, durable recovery,
      acquisition/discovery, periodic/cache inputs and destination/receiver/
      production-adapter acceptance remain required. No installed-runtime/global
      settings/production flag changes or real process/provider transitions.
      Config's periodic well-known caller now fences only eligible active
      refresh/fallback-reload iterations, not ten-minute sleep or empty-source
      ticks. Three real-Config/controlled-source clock cases passed 30 repeats;
      guard removal fails both eligible cases and guarding sleep fails all three
      bounded readiness probes. Final core passed 6,875/43 skipped/zero failures;
      all 35 workspace tasks, both builds, server (85/one skip) and SDK (14) passed.
      This is active caller ownership, not WellKnown cache/manifest integrity or
      retired-entry/partial-apply recovery: those remain explicit audit items,
      together with durable recovery, native cleanup/census and destination/
      receiver/production-adapter acceptance. Installed runtimes/global settings/
      production movement remain unchanged.
      WellKnown now owns active mutation counts, cold-load generation validation
      and exact-entry resolution revalidation before cache persistence. Late HTTP
      responses cannot restore a removed/re-added origin. Phase-keyed failed-write/
      publication leases survive cached reads and unrelated success; successful
      full origin removal may clear only its own manifest/resolve/add uncertainty.
      Two loopback response races and one applied-write/lost-receipt KV case pass;
      four guard/lease regression probes fail directly. Six WellKnown tests passed
      60 repeats; final core passed 6,878/43 skipped/zero failures, all 35 workspace
      tasks, both builds, server (85/one skip) and SDK (14) passed. This remains
      process-local refusal evidence, not durable recovery or transaction proof;
      fault injection covers the resolved-config write, not every manifest,
      membership, publication or consumer-application failure. Other external
      inputs/acquisition, physical cleanup/census, destination authority and exact
      receiver/production-adapter acceptance remain required. Installed runtime,
      global settings and production movement remain unchanged.
      WellKnown manifest persistence now retains per-origin application refusal
      separately from individual write completion. Only origins saved by the
      completing attempt may settle after snapshot application/publication;
      cached entry reads and unrelated success cannot do so. Exact full removal
      may retire its origin's application lease. Two multi-origin fault cases
      isolate a first persisted-but-unapplied manifest after removing the second,
      failing origin, then verify refresh or removal recovery. Lease removal and
      cached-load false-settlement probes each fail both cases. Eight WellKnown
      cases passed 80 repeats; final core passed 6,880/43 skipped/zero failures,
      all 35 workspace tasks, both builds, server (85/one skip) and SDK (14) passed.
      These are process-local phase guarantees, not all failure-boundary/consumer
      acceptance, physical storage or durable restart proof. Native input census,
      durable workspace recovery, detached-resource evidence and destination/
      receiver/production-adapter acceptance remain required; production movement,
      installed runtime and global configuration are unchanged.
      WellKnown add/remove/changed-refresh publication now has six real-Bus
      defect/interruption acceptance cases. After eager snapshot mutation, failed
      volatile dispatch remains fenced through unchanged refresh, cached entries
      and independent native consumer reconciliation. Explicit successful same-
      phase publication recovers. Removing producer leases fails all six cases;
      refresh-only lease removal and false unchanged-refresh settlement each fail
      its two cases, so consumer holds do not mask producer refusal. All 14
      WellKnown tests passed 140 repeats. Final core passed 6,886/43 skipped/zero
      failures; all 35 workspace tasks, both builds, server (85/one skip) and SDK
      (14) passed. This milestone adds verification, not runtime behavior or retry.
      Physical storage, durable restart/publication, all consumer failure paths,
      native input/borrower census, destination authority and receiver/production-
      adapter acceptance remain unproven. No installed-runtime/global-settings/
      production-movement changes.
      RepositoryCache now fences its own active ensure/discovery/lock/cleanup
      lifetime and retains per-checkout, per-attempt uncertainty before destructive
      cache work. Cached metadata and unrelated branch success cannot settle it.
      Successful non-cached work reconciles only already-failed leases captured
      under its lock, then releases those and its own lease after successful lock
      cleanup; older active workers and newer attempts remain independently owned.
      Four local-Git/controlled-lock cases passed 40 repeats. Retain/discovery/
      newer-attempt/active-retirement regression probes fail directly. Final core
      passed 6,890/43 skipped/zero failures; all 35 workspace tasks, both builds,
      server (85/one skip) and SDK (14) passed. Daily throttling and existing Git
      repair behavior are unchanged; no task replay/new retry or forced cleanup
      was introduced. This is live-graph operation evidence, not physical lock,
      cross-process exclusion, retained-reader/detached-resource census, durable
      restart recovery or destination instruction equivalence. Durable workspace
      journals, other native inputs/acquisition, complete destination authority
      and exact receiver/production-adapter acceptance remain required. No public
      API/installed-runtime/global-settings/production-movement changes.
      Instance resource cleanup now owns a retained lease released only by
      successful first cleanup, whose exit/result (including failure) is cached.
      Failed bootstrap also retains acquisition refusal: Effect may close private
      child scopes before reporting failure, so a later outer close cannot prove
      nested cleanup success. This supersedes the earlier provisional clean-outer-
      close recovery assumption, conservatively fencing every failed acquisition
      without error-category exemptions or automatic retry/force-clear. Four real
      graph boot/cleanup combinations passed 40 repeats; the old baseline fails
      both cleanup-failure cases, cleanup-lease removal fails normal-boot/failed-
      disposal, and acquisition-lease removal fails both failed-boot cases. Final
      core passed 6,892/43 skipped/zero failures; all 35 workspace tasks, both
      builds, server (85/one skip) and SDK (14) passed. This remains process-local
      refusal, not physical cleanup, durable/restart reconciliation or a recovery
      contract. Retained borrowers/descendants, remaining input/discovery census,
      durable workspace intent, destination authority and receiver/production-
      adapter acceptance remain required. No installed-runtime/public API/global-
      settings/production-movement changes.
      The legacy missing-provider/null-binding Workspace deletion shortcut is
      removed for all existing rows, not only locally observed failed creates.
      Successful registered-driver cleanup is required before deletion; missing
      provider errors preserve imported and reconstructed-owner rows. Two cases
      cover no local observation and create-effect/lost-receipt owner rebuilding,
      then restore the driver and verify null-binding cleanup before deletion.
      The old shortcut fails both cases; restored cases passed 20 repeats. Final
      core passed 6,894/43 skipped/zero failures; all 35 workspace tasks, both
      builds, server (85/one skip) and SDK (14) passed. This removes a false cleanup
      path but does not prove real process crash/reopened-DB recovery, durable
      intent/refusal journals, resource enumeration or authenticated reconciliation.
      Remaining native inputs/borrowers, complete destination authority and exact
      receiver/production-adapter acceptance stay required. No public API,
      installed-runtime/global-settings/production-movement changes.
      Retained Workspace create/destroy facades now refuse closed owners,
      including cached-ID creation, post-provider create insertion and post-
      provider destruction admission. Destroy also checks after locked row lookup
      before cleanup. The internal create error union uses the existing closed-
      owner WorkspaceDriver.Error; no public API/error schema was added. Three
      facade/gated-provider cases passed 30 repeats; the old baseline fails both
      initial cases and dropping post-provider checks fails both delayed cases.
      Final core passed 6,897/43 skipped/zero failures; all 35 workspace tasks,
      both builds, server (85/one skip) and SDK (14) passed. This is owner-local
      refusal, not durable intent/reconciliation, cross-owner fencing, arbitrary
      retained-method revocation or evidence that already-accepted effects are
      absent. Actual restart recovery, remaining input/borrower census, complete
      destination authority and receiver/production-adapter acceptance remain
      required. No installed-runtime/global-settings/production-movement changes.
      Workspace create now persists versioned per-attempt native KV intent before
      invoking the driver, and reconstructs refusal under a bootstrap hold before
      service publication. Values contain only ID/provider, not bindings/secrets.
      Actual same-ID/provider create completion plus binding persistence, or
      successful matching row-present driver cleanup, may retire captured intents;
      cached bindings, missing rows/providers and unrelated-provider success cannot.
      Four subprocess cases abruptly exit after fixture resource creation, reopen
      SQLite in fresh processes, verify refusal through cached/missing-provider
      observations, and verify matching cleanup or durable orphan refusal. The
      fixture rejects unexpected create replay. Write-after-effect/bootstrap-skip/
      provider-mismatch probes fail directly; four cases passed 40 repeats. Final
      core passed 6,901/43 skipped/zero failures across 279 files; all 35 workspace
      tasks, both builds, server (85/one skip) and SDK (14) passed. This proves the
      tested ordinary process-exit/create boundary, not power loss, physical faults,
      destroy/connect/idle intent completeness, orphan reconciliation, same-live-
      authority old-graph lease recovery, dynamic cross-process census/ownership/CAS
      fencing or authenticated quarantine recovery. Those and remaining native
      input/borrower census, full destination authority and exact receiver/
      production-adapter acceptance remain required. No public API, installed-
      runtime/global-settings/production-movement changes.
      Workspace now persists destroy intent before connection/driver cleanup,
      reconstructs it after restart and refuses cached provision/open while
      teardown is unsettled. Create receipts cannot settle destroy intents.
      Registered cleanup precedes one native SQLite transaction deleting row and
      captured matching intents, with live lease release only after commit. Nine
      subprocess cases cover create/destroy effect exits, plain/cached observation,
      missing providers, absent-row/provider-mismatch quarantine and a SQL trigger
      aborting terminal intent deletion after the row DELETE runs; rollback keeps
      row plus both intents across reopening, and explicit matching cleanup recovers.
      Startup idle-poll handoff avoids masking journal refusal. Write-after-cleanup,
      nontransactional retirement and cached re-wake probes fail directly; nine
      cases passed 90 repeats. Final core passed 6,906/43 skipped/zero failures;
      all 35 workspace tasks, both builds, server (85/one skip) and SDK (14) passed.
      This is native metadata atomicity and tested process/SQL-abort refusal, not
      external exactly-once/power-loss or concurrent-owner acceptance. Durable
      connect/idle intents, owner authentication/CAS/dynamic census, orphan/old-
      graph reconciliation, remaining native resource coverage and full destination/
      receiver/production-adapter acceptance stay required. No public API,
      installed-runtime/global-settings/production-movement changes.
      Idle suspension now persists its own intent before non-idempotent driver
      work, and restart reconstruction refuses provision/open/cached adoption
      until applicable cleanup. Successful idle completion clears only its own
      pass after persistence and registered cleanup; explicit matching destruction
      may retire captured idle records, not polls or create receipts. Connections
      privately retain their driver provider so changed rows cannot mislabel idle
      authority. Four additional idle restart cases plus a pre-suspension provider-
      change case extend the subprocess suite to 14: the real idle poll is driven
      by caller TestClock, saves a suspended binding/effect then abruptly exits.
      Fresh SQLite processes verify quarantine, missing/cached/provider/orphan
      refusal and explicit cleanup. Write-after-suspend, cached-admission and row-
      provider substitution probes fail directly. All 14 cases passed 140 repeats;
      final core passed 6,911/43 skipped/zero failures, all 35 workspace tasks,
      both builds, server (85/one skip) and SDK (14) passed. Durable connect is
      still missing. Physical/provider faults, full cleanup/commit coverage,
      authenticated owner/CAS/dynamic census, orphan/old-graph reconciliation,
      remaining native resource coverage and full destination/receiver/production-
      adapter acceptance stay required. No public API/installed-runtime/global-
      settings/production-movement changes or new replay permission.
      Connect acquisition now writes durable intent before the driver and clears
      it only after environment/activity publication completes. Failed acquisition
      remains quarantined through cached bindings/environments and idle polling;
      explicit matching destruction may retire captured evidence. Later file
      operations no longer blindly repeat a non-idempotent failed wake; first-
      error translation is preserved. Owner closure is revalidated through the
      acquisition/publication boundary. Five additional process cases extend the
      suite to 19, covering abrupt connect effects and a SQL failure after eager
      environment caching, with no repeated connect or idle dispatch; gated lookup
      also proves no late driver/intent mutation after owner closure. Write-after-
      return, cached-open, idle-poll and owner-check probes fail independently.
      All 19 process cases passed 190 repeats; owner/no-connect-retry cases passed
      20 repeats. Final core passed 6,917/43 skipped/zero failures; all 35 workspace
      tasks, both builds, server (85/one skip) and SDK (14) passed. Completed connect
      receipts do not census live handles/descendants. Physical/provider faults,
      complete commit/cleanup coverage, authenticated owner/CAS/dynamic census,
      orphan/old-graph reconciliation and complete native resource/destination/
      receiver/production-adapter acceptance stay required. No public API,
      installed-runtime/global-settings/production-movement changes or new replay
      permission.
      Intent retirement now conditionally deletes key plus captured encoded value,
      preserving unknown receipt fields rather than schema-normalizing them away.
      Shared completion batches and terminal row/intent retirement roll back on
      mismatch; the old graph then quarantines further provider work instead of
      retrying stale cleanup. Two concurrent-process cases pause actual fixture
      create/destroy callbacks over IPC/stdin while another process replaces the
      receipt. Old completion refuses, destroy preserves row/both intents, and a
      second old-graph destroy makes no provider call or new intent; explicit fresh
      fixture cleanup verifies the new full value. Removing either comparison
      fails its case; removing mismatch quarantine fails both. All 21 process cases
      passed 210 repeats; final core passed 6,919/43 skipped/zero failures, all 35
      workspace tasks, both builds, server (85/one skip) and SDK (14) passed. This
      is receipt compare-and-delete, not authenticated owner/generation or ABA
      fencing, dynamic cross-process census, prevention of already-in-flight stale
      effects or production owner acceptance. Those plus orphan/old-graph recovery,
      complete native resource/destination/receiver/production-adapter acceptance
      remain required. No public API/installed-runtime/global-settings/production-
      movement changes or new replay/recovery permission.
      Intents now carry non-secret graph and optional local PID/host observation
      metadata. Same-ID resource boundaries refresh durable records under their
      local mutex, retain old CAS witnesses and refuse known-live foreign processes
      or unverifiable owner labels before driver calls/new intents. A peer booted
      before a creator's intent now observes/refuses it while the creator callback
      is paused; live/refresher bypasses each fail that case. Legacy-owner and
      foreign-host cases make no callback; skipping that refusal fails both. A
      reconstructed graph no longer treats scope closure/driver availability as
      cleanup authority while the old process lives. Receipt identity transfer
      additionally quarantines the newly targeted ID; its old path fails the unit.
      All 24 process cases passed 240 repeats; reconstruction/identity units passed
      20 repeats. Final core passed 6,923/43 skipped/zero failures; all 35 workspace
      tasks, both builds, server (85/one skip) and SDK (14) passed. These are
      refusal-only observations: PID absence/host labels do not grant cleanup,
      movement or resource-absence proof. Global withStable census, read-to-action
      exclusion, authenticated owner/epochs/ABA, orphan/old-graph reconciliation,
      real provider failures and complete native/destination/receiver/production-
      adapter acceptance remain required. No public API/installed-runtime/global-
      settings/production-movement changes or new replay authority.
      Terminal binding/activity publication now checks captured ID/provider and
      commits with exact-value intent retirement; destruction checks the captured
      row deletion in its retirement transaction. Checked driver binding saves
      refuse missing/reassigned rows. Four paused create/destroy process cases
      preserve evidence across deletion/reassignment and reopening; changed
      receipts also roll back binding publication. All 28 process cases passed
      280 repeats; core passed 6,927/43 skipped/zero failures, all 35 checks,
      both builds, server (85/one skip) and SDK (14) passed. Dedicated connect/idle
      changed-row process races, same-ID/provider ABA, authenticated generation
      exclusion and production/provider acceptance remain unproven. This is not
      stale-effect prevention or an ownership/resource-absence grant.
      The dedicated connect/idle changed-row process matrix now pauses each real
      callback after its binding save while a live peer deletes/reassigns its row.
      All four preserve intent across reopen and refuse cached reuse without a
      second callback. Idle dispatch also refuses missing/reassigned rows before
      exposing their binding to the captured provider; two TestClock cases prove
      zero calls, retained refusal and no later borrow/poll recovery. The old
      reassignment path fails with one incorrect suspension call. All 32 process
      cases passed 320 repeats, both units passed 20 repeats; core 6,933/43 skipped/
      zero failures, 35 checks, both builds, server 85/one skip and SDK 14 passed.
      Pre-dispatch retained refusal is process-local, not durable resource census
      or authenticated exclusion. Read-to-driver races, ABA, provider faults,
      owner/generation fencing and production movement acceptance remain open.
      Cached file/spawn acquisition now shares idle's captured-provider row check
      and rechecks owner closure after the read. Missing/reassigned rows refuse
      new dispatch immediately rather than waiting for idle, retaining one
      process-local unresolved-resource hold. Two new tests prove zero cached
      spawner dispatches, file/retry refusal and no create/connect replay without
      advancing to idle; both initial file probes fail pre-fix. Four borrow/idle
      cases passed 40 repeats. Final core passed 6,935/43 skipped/zero failures
      (including all 32 process cases once), all 35 checks, both builds, server
      85/one skip and SDK 14 passed. Opaque same-provider binding generations,
      read-to-dispatch races, existing-handle revocation, authenticated ownership,
      dynamic census and orphan/provider/production acceptance remain open.
      Native PTY creation now fences reservations before asynchronous shell/backend
      acquisition and rechecks closed owners. Only failure/cancellation before
      attempting native spawn releases its hold; spawn attempts retain refusal
      through native exit, removal and scope closure because kill/exit do not
      prove descendant cleanup. No automatic spawned-PTY reconciliation/release
      path is claimed. Controlled acquisition/cancellation/owner tests and native
      live/removal/exit cases pass; omitting the hold fails four targeted cases.
      PTY suite passed 110 repeats; final core 6,939/43 skipped/zero failures,
      all 35 checks, both builds, server 85/one skip and SDK 14 passed. This is
      process-local conservative refusal, not durable census, orphan absence,
      authenticated owner/generation fencing or Windows/IDE/provider acceptance.
      Restart is not cleanup evidence; production movement remains disabled.
      Local environment filesystem promise attempts now wait for native I/O
      settlement before Effect cancellation can unwind owning mutation/borrower
      cleanup. A real POSIX FIFO write reproduces early worker completion and
      false stable-guard admission while kernel I/O remains blocked. Cancellation
      now waits through draining the actual bytes; the test drains on failure,
      owns child/descriptors/temp state and uses no fs mocks or sleeps. Both
      early-interruption and admission probes fail without the wait. Ten repeats
      and final core 6,940/43 skipped/zero failures (280 files), all 35 checks,
      both builds, server 85/one skip and SDK 14 passed. This is not failed-close
      recovery, all-filesystem-caller registration, Windows FIFO acceptance,
      native resource census, authenticated owner fencing or production movement
      acceptance; other asynchronous native I/O remains under audit.
      The FIFO cancellation proof now also drives actual Workspace file-borrow
      acquisition/retained-worker cleanup over the real local filesystem driver,
      without an added mutation wrapper. Disabling the I/O wait reproduces false
      stable admission there as well. Both owner paths pass 20 repeats, with
      cancellation/refusal held until exact byte drain; full core 6,941/43 skipped/
      zero failures and all 35 checks passed. This is a test-only extension, not
      remote-provider or Windows acceptance; builds/server/SDK were not rerun.
      Authenticated fencing, census, orphan cleanup and production movement remain
      unresolved.
      Ripgrep-backed filesystem indexing now owns a retained per-attempt hold
      before scan dispatch, through worker/scoped cleanup. Cached old-index
      reads remain nonblocking but cannot clear active/failed worker ownership.
      Only successful completion releases that scan's hold; failure/interruption
      survives later successful scans and owner closure. Closed owners refuse
      new cached searches/scans. Four controlled lifecycle cases passed 40 repeats;
      omitting holds fails three initial probes, unconditional release fails three
      failure/interruption probes. Final core 6,945/43 skipped/zero failures
      (281 files), all 35 checks, both builds, server 85/one skip and SDK 14 passed.
      Native process-tree termination, direct Ripgrep callers, separate fff native
      resources, durable census/authenticated generations and production movement
      acceptance remain unproven. No installed-runtime or production changes.
      The fff native indexer now owns a lifetime hold before available-backend
      acquisition, with atomic acquisition/finalizer registration and release
      only after successful handle destruction. Failed initialization retains
      refusal; closed facades refuse searches. Two real Bun-backend directory/
      missing-directory tests prove guard invalidation, healthy destruction
      release, failed-initialization refusal after repeated close and stale-owner
      refusal; omitting the hold fails both. Twenty repeats, final core 6,947/43
      skipped/zero failures (282 files), all 35 checks, both builds, server 85/one
      skip and SDK 14 passed. Active fff Locations now refuse reservations until
      their native handle is released; production movement still needs a proven
      approved release/re-establishment path. Destroy faults, other backends,
      process/power-loss census, authenticated durable generations and orphan/
      receiver/adapter acceptance remain unproven. No production activation.
      Direct Ripgrep find/glob/grep calls now own independent holds before binary/
      process/stream execution. Successful scoped completion releases only that
      call; failure/abort (including invalid-pattern errors) retains conservative
      refusal through subsequent success and owner disposal. Closed owners refuse
      new queries. Four real native local-ripgrep cases passed 40 repeats; no-hold
      and unconditional-release mutations fail four and three probes respectively.
      Final core 6,951/43 skipped/zero failures (283 files), all 35 checks, both
      builds, server 85/one skip and SDK 14 passed. This does not establish cleanup-
      fault recovery, binary-install settlement, detached-descendant census,
      other-driver/Windows/IDE acceptance, authenticated durable generations or
      orphan reconciliation. Production movement stays disabled.
      Binary acquisition now uses one owner-scoped worker with a pre-dispatch
      hold, not caller-abandoned Effect.cached runs. Cancelled callers cannot
      restart discovery/install work; replacement waiters share the same result.
      Failure/interruption retains refusal, closed owners reject cached access,
      successful cache reads leave guards stable, and ignored archive-removal
      failure now preserves installation uncertainty while keeping its existing
      filepath result. Three controlled metadata cases pass 30 repeats; omitting
      holds or sharing fails three probes each. Final core 6,954/43 skipped/zero
      failures (284 files), all 35 checks, both builds, server 85/one skip and
      SDK 14 passed. These fixtures do not prove archive-removal/extraction/commit
      fault recovery or real installs. Durable target/cross-owner exclusion,
      authenticated generations, process census/orphans and approved resource
      release/re-establishment/receiver acceptance remain unresolved.
      Eight offline binary-install cases now cover success, empty download,
      archive-write/corrupt-extraction/copy/lost-copy-receipt/chmod/archive-cleanup
      failure with generated tar.gz bytes, real local extraction/copies and typed
      filesystem faults. They verify exact target bytes, extraction-directory
      cleanup, artifact retention, no download/extraction replay after cached
      reads or later target metadata, and persistent refusal after external
      archive cleanup/owner close. Ignoring cleanup uncertainty fails its typed
      probe. Eighty repeats, full core 6,962/43 skipped/zero failures (285 files)
      and all 35 checks passed. Test-only extension: builds/server/SDK not rerun.
      This closes only that method-boundary fixture matrix, not authentic binary
      acceptance, Windows zip/bsdtar, physical/process/commit faults, cross-owner
      target ownership, authenticated generations or durable census/orphans.
      Production movement remains disabled.
      Per-target binary-install intents now use native SQLite KV before download/
      installation effects, with non-secret target/attempt values, insert-if-absent
      claims and full-value CAS retirement only after successful install/cleanup.
      Startup reconstructs refusal before publication; fresh acquisition rejects
      observed pending evidence before metadata adoption. Ten file-backed native
      SQLite close/reopen/live-peer cases passed 100 repeats. A prestarted peer
      refuses successful-looking bytes without another download; receipt replacement
      survives stale retirement. Disabling reconstruction/fresh checking/value CAS
      fails two/one/one probes. Final core 6,964/43 skipped/zero failures, 35 checks,
      both builds, server 85/one skip and SDK 14 passed. This is compatible-same-DB
      durable refusal in separate connections/graphs within one process, not
      authenticated owners, abrupt-process/power-loss or global census acceptance.
      Simultaneous claim races, different DBs/target aliases/incompatible writers,
      ABA, in-flight effects and approved resource/receiver integration remain open.
      Four explicit installer process-exit boundaries now preserve native SQLite
      refusal/evidence through fresh inspection without replay. A real ordered
      two-process absent-target race exposed duplicate installation after winner
      retirement (pre-fix: two requests). A retained completion witness now fences
      compatible stale plans: predecessor validation and intent claim share a
      transaction; completion revalidates and atomically updates its witness with
      exact intent retirement. Simultaneous and ordered races now install once.
      Typed refusal channels are preserved; completion-write rollback and changed-
      witness preservation have targeted cases. Final core 6,972/43 skipped/zero
      failures (286 files), 60 process repeats, 120 install repeats, 35 checks,
      both builds, server 85/one skip and SDK 14 passed. This is compatible-same-DB
      coordination, not authenticated epochs, ABA defense, target aliases/cross-DB
      exclusion, in-flight effect fencing, power-loss/Windows/artifact acceptance
      or global resource census/orphans. Approved resource/receiver/production
      continuity gates remain open; production movement remains disabled.
      Snapshot lazy initialization and background packing now own pre-dispatch
      retained holds through Git effect/scoped cleanup. Cancelled callers do not
      replace shared initialization; failed/interrupted workers remain refused
      through later captures and disposal. Packing is single-flight and uncertain
      packs do not auto-retry at the next due interval. Closed owners refuse fresh
      capture/files/diff/restore entries. Eight controlled local-Git lifecycle
      cases pass 80 repeats; missing holds/active/uncertain checks fail eight/four/
      two probes. Final core 6,980/43 skipped/zero failures (287 files), all 35
      checks, both builds, server 85/one skip and SDK 14 passed. This does not
      establish durable Snapshot ownership, large-object/disk-fault/native process
      cleanup, direct foreground/raw Git borrowing, authenticated global census
      or orphan reconciliation. Production movement remains disabled.
      Foreground Snapshot capture/files/diff/restore now own independent holds
      around their native Git phases after shared initialization. Failed/cancelled
      calls stay refused through later success/disposal; best-effort capture's
      undefined result cannot count as cleanup. Twelve success/failure/interruption
      cases prove pending cleanup and preserved API channels. Pre-fix/unconditional-
      release probes fail twelve/eight cases. All twenty Snapshot authority cases
      pass 200 repeats; final core 6,992/43 skipped/zero failures, all 35 checks,
      both builds, server 85/one skip and SDK 14 passed. Process-local fencing is
      not durable Snapshot recovery, native/disk-fault acceptance, raw Git coverage,
      authenticated reconciliation, cross-process census or resource absence.
      Approved receiver/production continuity remains unproven; movement disabled.
      Git temporary-index/config-file cleanup now owns independent holds before
      I/O, preserving ignored-error API behavior without falsely settling cleanup.
      Real raw-Git and Snapshot cases prove valid tree results, later captures and
      external artifact deletion cannot clear failed cleanup. Successful cleanup
      can settle independently of caller interruption. Temporary-index age deletion
      is replaced with evidence preservation/refusal; enumeration failure cannot
      become clean evidence through fallback/cached preparation. Five cases pass
      50 repeats and unowned-index preservation passes 10; missing cleanup/
      observation/success-only settlement checks fail four/two/two probes. Final
      core 6,997/43 skipped/zero failures (288 files), 35 checks, both builds,
      server 85/one skip and SDK 14 passed. Raw pack-file sweeping and age-based
      pack-lock recovery remain unproven, along with other ignored writes, durable
      Git ownership/authentication, census/orphans and receiver/production safety.
      No production movement or installed-runtime changes.
      Subsequent raw-Git packing milestone: removed timestamp-based lock takeover
      and temporary/unindexed pack deletion. Lock attempts hold before native
      writes and register cleanup via acquire/use/release; failed creation,
      lost receipts and cleanup failure retain refusal. Work-threshold pack
      observation preserves unknown artifacts and failed enumeration rather than
      treating skipped packing as ownership evidence. Loose/replaced-object
      cleanup has independent success-only holds. Ten actual-repository cases
      (2,050 distinct blobs each) passed 100 repeats; missing lock/observation/
      settlement/object-cleanup protections fail three/two/one/one probes. Final
      core 7,007/43 skipped/zero failures (289 files), all 35 checks, both builds,
      server 85/one skip and SDK 14 passed. This supersedes only the preceding
      timestamp-deletion gaps; authenticated exclusion, dynamic census, orphan
      recovery, lock-replacement CAS, below-threshold listing fallbacks, combined
      pack extension faults, native quiescence and production receiver continuity
      remain open. Installed runtime/settings/flags remain unchanged.
      Subsequent inventory milestone: initial object-root, loose fanout and
      local-pack reads hold through candidate classification; typed failures
      become incomplete observations, not empty census evidence. Any incomplete
      listing stops packing before lock acquisition/native dispatch, including
      partially successful fanouts. Six added boundary/threshold fault cases and
      a healthy small-repository control extend the suite to 17 cases/170 repeats.
      Large fixtures use 2,100 real blobs so losing one fanout still exceeds the
      packing threshold. Missing holds/unconditional settlement fail six probes
      each; removing the partial-fanout stop fails its large-repository probe.
      Final core 7,014/43 skipped/zero failures, 35 checks, both builds, server
      85/one skip and SDK 14 passed. Initial listing fallbacks are no longer a
      clean-evidence path; this does not create a coherent snapshot or dynamic
      global census, and below-threshold unowned-pack observation, authenticated
      ownership/exclusion, orphan recovery, lock replacement/native quiescence,
      durable Git recovery and production movement acceptance remain open.
      Subsequent pack preflight milestone: unowned temporary/unindexed-pack
      observation now precedes the work threshold, with a separate fresh check
      under the cooperative lock. Four added cases cover small repositories,
      failed preflight and evidence appearing between observations. Three new
      real 16-pack cases cover healthy consolidation and actual `.idx`/`.pack`
      deletion faults; failed artifact bytes remain intact, all original blobs
      remain readable, and later deletion/success/disposal cannot clear refusal.
      Twenty-four cases passed 240 repeats; removing preflight, freshness or
      combined cleanup holds fails two probes each. Final core 7,021/43 skipped/
      zero failures (290 files), 35 checks, both builds, server 85/one skip and
      SDK 14 passed. Below-threshold observation and the two tested combined
      cleanup fault paths supersede earlier limitations only. Sidecar faults,
      standalone orphan indexes, all native publication/interruption boundaries,
      authenticated ownership/generations, exclusion/census/orphan reconciliation,
      native quiescence, destination/receiver and production acceptance stay open.
      No installed runtime, global settings or movement activation changes.
      Subsequent orphan/sidecar milestone: observer preserves standalone indexes
      and reverse-index/bitmap/mtime evidence lacking pack/index partners, before
      threshold and under lock. Twenty opaque-byte classification cases cover
      old/recent evidence and missing pack/index/both; exact bytes survive, no
      lock dispatch occurs, and external deletion/later success/disposal cannot
      settle refusal. Returning to pack-only observation fails 14 cases. Combined
      cleanup adds real Git-generated `.rev` faults and explicitly synthetic
      bitmap/mtime cleanup-boundary faults; missing holds fail three new cases.
      Authentic bitmap/cruft generation/recovery is not claimed. Twenty-six cases
      passed 260 repeats; final core 7,044/43 skipped/zero failures (291 files),
      35 checks, both builds, server 85/one skip and SDK 14 passed. Detection and
      tested cleanup fencing supersede earlier limitations only; authenticated
      ownership/exclusion, dynamic census/aliases/orphan reconciliation, complete
      native publication/interruption/quiescence, durable/physical/platform faults,
      destination/receiver and production acceptance remain open. Production
      movement and installed runtimes/settings remain unchanged.
      Subsequent raw-Git creation milestone: invocation holds span initial and
      existing-store configuration, with independent publication-rename and
      temporary-directory cleanup holds. A usable destination/ignored cleanup
      error can preserve API success but cannot settle uncertain publication or
      cleanup; later create success/disposal cannot release failed invocation
      holds. Six real-repository cases cover success, two configuration failures,
      lost successful-rename receipt, cleanup failure and caller interruption;
      acquisition/cleanup/publication mutation probes fail six/one/one cases.
      Creation plus Snapshot authority suites passed 260 repeats. Final core
      7,050/43 skipped/zero failures (292 files), 35 checks, both builds, server
      85/one skip and SDK 14 passed. Optional seed-index copy/safe-existence
      observations, complete native cleanup/interruption, durable Git recovery,
      authenticated ownership/exclusion/census/orphans and destination/receiver/
      production acceptance remain open. No installed runtime/settings/API or
      movement activation changes.
      Subsequent seed/HEAD milestone: typed initial/fallback HEAD and seed-index
      existence checks surface observation errors instead of false absence.
      Confirmed absent optional seeds skip copy; attempted seed copies retain
      independent success-only holds through existing ignored-error behavior.
      Nine real-repository cases cover absence/success, source observation faults,
      copy failure/lost receipt/actual disappearance and three HEAD observation
      faults. Exact typed-error message assertions prevent unrelated publication
      failure from satisfying a failed-observation test. Error-to-false/copy-hold/
      absent-skip mutations fail four/three/one cases. Seed+creation+Snapshot
      authority suites pass 350 repeats. Final core 7,059/43 skipped/zero failures
      (293 files), 35 checks, both builds, server 85/one skip and SDK 14 passed;
      build/server/SDK runs cover identical production source before test-only
      assertion strengthening. Existence remains observation, not identity,
      coherent census, backend cleanup or destination authority. Other raw Git
      fallback/publication/interruption, durable/native/platform recovery,
      authenticated exclusion/census/orphans and receiver/production ports remain
      open. Installed runtime/settings/API/movement flags remain unchanged.
      Subsequent snapshot-config milestone: tolerant reads distinguish confirmed
      NotFound from failed observation, and temporary writes/publication rename
      own independent success-only holds before dispatch. Capture may retain its
      successful-tree API result, but cleanup, matching bytes, prepared-store
      caching, later success and disposal cannot settle failed/interrupted config
      work. Eight real-repository cases cover success/absence/read/write/rename/
      lost receipt and write/rename interruption. Read/write/absence/settlement
      mutation probes fail one/three/one/four cases. Config+Snapshot suites pass
      280 repeats. Final core 7,067/43 skipped/zero failures (294 files), 35 checks,
      both builds, server 85/one skip and SDK 14 passed. Temporary-index prepare/
      link/copy/timestamp/publication/rebuild paths, complete native/durable/
      physical/platform recovery, authenticated owner/exclusion/census/orphans
      and destination/receiver/production acceptance remain open. No installed
      runtime, settings, API or movement activation changes.
      Subsequent temporary-index milestone: copy-first preparation replaces
      failed-link fallback, invocation holds precede I/O, cleanup registration
      precedes preparation and typed existence errors stop rather than imply
      absence. Copy/stat/timestamp and single-attempt publication holds preserve
      uncertainty independently; blind rename retries are removed. Ten real
      cases verify distinct inodes/source bytes, zero link dispatch, one rename,
      preparation-failure cleanup, typed faults/lost receipts and interruption.
      Acquisition/publication/timestamp/replay mutation probes fail one/two/one/
      two cases. Cleanup-only fixture now uses successful publication and controlled
      copy-back, rather than incorrectly settling a failed rename. Index+cleanup+
      Snapshot suites pass 350 repeats. First core run failed a Workspace report
      JSON parse (retained log, unexplained); ten targeted repeats and unchanged-
      source full rerun passed. Final core 7,077/43 skipped/zero failures (295
      files), 35 checks, both builds, server 85/one skip and SDK 14 passed. No
      Workspace assertions/timeouts were changed. Fingerprint/rebuild fallbacks,
      complete native/durable/platform recovery, authenticated ownership/census/
      orphan and destination/receiver/production ports remain open. Installed
      runtime, settings, public API and movement activation remain unchanged.
      Subsequent fingerprint/rebuild milestone: failed fingerprint metadata reads
      retain refusal; confirmed NotFound stays healthy. Typed unreadable-index
      existence errors surface instead of false. Rebuild cleanup is registered
      before seed work, and failed observation/copy stops rather than authorizing
      current-index deletion. Existing confirmed-absence and successful rebuild
      behavior remains, without settling the earlier failed capture's hold.
      Twelve real cases cover corrupt-index repair, fingerprints, source/probe
      faults, copy/publication lost receipts and interruption; exact errors,
      preserved bytes, no uncertain deletion, acquisition cleanup and readable
      trees are asserted. Fingerprint/fallthrough/cleanup mutations fail two/
      three/three cases. Rebuild+index+Snapshot suites pass 420 repeats. Final
      core 7,089/43 skipped/zero failures (296 files), 35 checks, both builds,
      server 85/one skip and SDK 14 passed. Prior Workspace report-parse issue
      did not recur, but remains unexplained. Native status/absence is not owner
      or cleanup authority; coherent identity/CAS, complete process/native/
      durable/platform recovery, authenticated exclusion/census/orphans and
      destination/receiver/production gates stay open. Installed runtime/settings/
      public API/movement flags remain unchanged.
      Subsequent native-process milestone: optional Util observation sink reports
      uncertainty before the existing inherited-pipe capture deadline abandons
      output; no Core dependency or command/credential payload. Git run invocations
      hold before backend dispatch; backend failure/interruption and separate
      output-abandonment holds survive query fallback/later success/disposal.
      Four controlled Git cases plus a real zero-exit parent/live detached
      descendant/inherited-pipe case pass 50 repeats; missing invocation/wiring/
      deadline guards fail three/one/one probes. Broader best-effort cleanup-error
      reporting was rejected after 62 core failures on ordinary nonzero-exit group
      cleanup; existing ignored-cleanup policy is unchanged and remains unproven,
      not hidden by weakened tests. Final core 7,094/43 skipped/zero failures (297
      files), Util 95, all 35 checks, Util/Core/Server builds, server 85/one skip
      and SDK 14 passed. Backend return/events are not descendant-absence or
      global cleanup proof. Quiet descendants, other spawn/stream callers,
      closed-owner entry, authenticated exclusion/census/orphans, durable/platform
      recovery and destination/receiver/production ports remain open. Prior
      Workspace parsing flake is unexplained. Installed runtime/settings/public
      Protocol/HttpApi/movement flags remain unchanged.
      Subsequent local-owner milestone: all 23 Git public entry points refuse
      closed Scope ownership for fresh and preconstructed effects, before FS or
      backend access. Mutex acquisitions and native run dispatch recheck lifetime;
      active temporary cleanup remains allowed. Matrix covers 46 closed-entry
      attempts and a deterministic paused-copy/queued-capture teardown race.
      Removing entry/queue/dispatch guards fails one case each. First full run
      exposed four fixtures reusing immediately disposed native Git layers;
      RepositoryCache/Snapshot fixtures (and similarly extracted Flock helpers)
      now retain contexts with Layer.build in the calling test Scope, without
      weakening production guards/assertions/timeouts. Authority suites pass 270
      repeats and corrected fixture paths 50. Final core 7,096/43 skipped/zero
      failures (298 files), 35 checks, Core/Server builds, server 85/one skip and
      SDK 14 passed. Scope lifetime is not authenticated cross-process exclusion,
      census or in-flight quiescence; retained old-graph uncertainty, process
      cleanup/descendants, durable/platform/orphan recovery and approved native
      release/destination/receiver/production ports remain open. Prior Workspace
      parsing flake is unexplained. Installed runtime/settings/public Protocol/
      HttpApi/movement flags remain unchanged.
      Subsequent verification milestone: Workspace journal fixtures now use typed
      ID/mode-bound IPC reports with phase/duplicate/schema checks and explicit
      receipt acknowledgement before exit, rather than parsing human stdout.
      Logs, exit/stderr and all journal/resource/refusal assertions are preserved;
      abrupt exits cannot produce healthy default evidence. A real noisy process
      emits healthy-looking JSON around an unresolved report; only IPC is used.
      Twelve collector/schema cases reject malformed, missing, mismatched,
      duplicate or out-of-order messages. Stdout/binding/duplicate mutations fail
      one/two/one cases. Full journal/collector suite passes 45 tests; noisy/stale-
      destroy/collector paths pass 140 repeats. Final core 7,109/43 skipped/zero
      failures (299 files), 35 checks, Core/Server builds, server 85/one skip and
      SDK 14 passed. This fixes a demonstrated transport ambiguity, not a proven
      historical root cause; original transient parsing cause remains uncaptured.
      Production native behavior/authority/settings/API/movement are unchanged.
      Authenticated ownership/census/orphan and native cleanup/durable/platform/
      release/destination/receiver/production acceptance gates remain open.
      Subsequent local continuation milestone: captured owner lifetime now guards
      the delegated filesystem entry points used by Git. Finishing an awaited
      provider result after closure cannot authorize the next ordinary Core FS
      phase. Owned temporary/init/config/index and acquired-lock finalizers still
      reach backing cleanup, with existing uncertainty rules preserved. Seven
      actual-I/O handoff cases cover index stat/copy/fingerprint, config read/
      write and store directory/config creation; no post-closure delegation,
      original bytes, temporary cleanup and retained uncertainty are asserted.
      Removing phase guards fails six cases (the process guard catches the other);
      treating cleanup as fresh admission fails its case. Owner/continuation/
      cleanup suites pass 140 repeats. Final core 7,116/43 skipped/zero failures
      (300 files), 35 checks, Core/Server builds, server 85/one skip and SDK 14
      passed. Already-entered provider/internal FSUtil work is not cancelled or
      proven quiescent. Target identity/CAS, old graphs, authenticated ownership/
      census/aliases/orphans, process cleanup/quiet descendants, durable/platform
      recovery and approved release/destination/receiver/production gates remain
      open. Installed runtime/settings/public Protocol/HttpApi/movement unchanged.
      Subsequent filesystem-settlement milestone: admitted Git mutation delegates
      own success-only I/O holds and defer interruption through provider settlement;
      cancellation cannot start temporary cleanup while their callback is pending.
      Owner checks still precede admission. A real POSIX FIFO verifies kernel
      write progress, pending cancellation/no cleanup until all bytes drain,
      exactly one cleanup/no publication, preserved config and retained worker
      refusal. Three direct restore-deletion cases isolate normal success and
      retained typed/lost-receipt failure. Missing wait/hold mutations fail one/
      two cases. Controlled interruption fixtures now release provider receipts
      before joining cancellation; admitted rename completion is asserted exactly,
      without treating it as caller/worker success. Five suites pass 400 repeats.
      Final core 7,120/43 skipped/zero failures (301 files), 35 checks, Core/Server
      builds, server 85/one skip and SDK 14 passed. Windows FIFO/native callback
      acceptance remains separate. Provider settlement is not durability, target
      identity/CAS, authenticated cleanup or descendant absence; unresponsive
      providers retain pending cancellation. Native cleanup/read/helper lifetimes,
      authenticated exclusion/census/aliases/orphans, durable/platform recovery
      and release/destination/receiver/production gates remain open. Installed
      runtime/settings/public Protocol/HttpApi/movement remain unchanged.
      Subsequent read/helper-settlement milestone: admitted Git reads/discovery
      defer interruption until provider settlement. Required file/directory/
      existence/helper operations hold independently; optional fingerprint/config
      absence retains caller-owned classification. A real Node/FIFO provider
      verifies pending read/cancellation through owner closure and withheld EOF,
      full payload receipt before interruption, no subsequent write and retained
      uncertainty; even negative probes await native read completion. Two real
      16-pack read/lost-receipt cases preserve all artifact bytes, clean the lock,
      dispatch no packing and retain refusal through later success/disposal.
      Missing wait/read hold and blanket optional-absence leasing fail one/two/
      two probes. Four suites pass 230 repeats. Final core 7,123/43 skipped/zero
      failures (303 files), 35 checks, Core/Server builds, server 85/one skip and
      SDK 14 passed. Provider completion is not per-handle census, identity,
      authenticated cleanup or quiescence; unresponsive callbacks can retain
      cancellation. Internal helper work, native cleanup/quiet descendants,
      old-graph/authenticated exclusion/census/alias/orphan and durable/platform/
      release/destination/receiver/production gates stay open. Installed runtime/
      settings/public Protocol/HttpApi/movement remain unchanged.
      Subsequent internal-helper milestone: optional Util refusal-only boundary
      checks run before each FSUtil.up target/predicate/ancestor lookup; Git binds
      its captured owner lifetime so a completed old lookup cannot authorize
      further ascent. No path permission, cleanup or owner grant is supplied;
      unobserved callers retain behavior. Nine real-code/native-call cases cover
      all predicate kinds, subsequent same-directory targets, first-call refusal,
      live-owner Git discovery and closed-owner ascent with no subsequent FS/Git
      dispatch. Missing checks/binding fail five/one cases. Helper/continuation/
      native-read suites pass 170 repeats. Final core 7,132/43 skipped/zero failures
      (304 files), Util 95, 35 checks, Util/Core/Server builds, server 85/one skip
      and SDK 14 passed. This is not every helper/provider, atomic exclusion,
      authenticated ownership, coherent identity, descriptor census or quiescence.
      Native cleanup/quiet descendants, old graphs, dynamic exclusion/census/
      aliases/orphans, durable/platform recovery and approved release/destination/
      receiver/production gates remain open. Installed runtime/settings/public
      Protocol/HttpApi/movement activation remain unchanged.
      Subsequent directory-helper milestone: optional refusal checks precede
      ensureDir mkdir and its recursive AlreadyExists fallback stat. A common
      Git wrapper binds captured owner Scope to both multi-step Util helpers;
      closed-owner fallback metadata stops before the process guard is needed.
      Six actual-directory/controlled-callback cases preserve unobserved/live
      workaround success, refuse initial/late calls, clean owned temporary
      directories and retain failed-worker refusal. Missing fallback/binding/
      initial checks fail two/one/one probes. Windows-native bug acceptance is
      not inferred. Directory/upward-helper/continuation suites pass 220 repeats.
      Final core 7,138/43 skipped/zero failures (305 files), Util 95, 35 checks,
      Util/Core/Server builds, server 85/one skip and SDK 14 passed. Local checks
      are not atomic exclusion, coherent identity, authenticated ownership,
      cleanup approval or provider census. Native cleanup/quiet descendants,
      old graphs, authenticated generations/census/aliases/orphans, durable/
      platform recovery and release/destination/receiver/production ports remain
      open; non-native alert/recovery/dashboard gates remain separate pending
      work. Installed runtime/settings/public Protocol/HttpApi/movement unchanged.
      Process-stop observation milestone: capture the optional invocation sink
      at command acquisition and notify it before explicit/active scoped stop
      failure or defect returns. Completed-command best-effort group cleanup is
      deliberately unchanged; its failures and successful stops confer no cleanup
      authority. Eight native-process cases cover completed exit/force controls,
      captured sink versus caller substitution, explicit failed stop, successful
      active stop, unobserved failure and POSIX native invalid-signal finalizer
      defect followed by valid-signal cleanup without retracting uncertainty.
      Missing notification/overbroad completed reporting fail two/one probes.
      Process suites pass 350 repeats; final core 7,146/43 skipped/zero failures
      (306 files), Util 95, 35 checks, Util/Core/Server builds, server 85/one skip
      and SDK 14 passed. Typed OS cleanup-error coverage, pre-acquisition spawn
      cancellation, best-effort cleanup, quiet descendants and Windows remain
      unproven. Neither stop settlement nor observation proves descriptor release,
      authenticated cleanup, identity or process-tree absence. All broader
      ownership/census/recovery/destination/receiver/production gates remain open;
      installed runtime/settings/public Protocol/HttpApi/movement unchanged.
      Existing tolerant config parsing/fallback is not an authority proof.
     This does not satisfy the remaining continuity contracts.
3. **Managed creation/cleanup.** Participant-host worktrees, location preview and
    explicit approval, claim/revision revalidation, crash-safe creation receipts,
    explicit cleanup and dirty-worktree refusal without human force authorization.
    Internal default-off host lifecycle is now implemented with real Git and
    abrupt-process recovery tests (`worktree-lifecycle.md`). Broker-scoped exact
    approval/intent/receipt records and schema-6 migration are now implemented,
    with authentication/rollback/restart and real-Git digest roundtrip tests.
    The internal broker/host bridge now has durable publication/begin/receipt
    outboxes and real broker/Git lost-reply/restart/SIGKILL tests. Production
    adapter installation and proven native host exclusion/use-safety remain pending; this
    does not enable movement or complete this gate.
4. **Recovery executors implemented; platform rollout remains.** All six
   operations have durable intent/receipt recovery and final policy/lease checks.
   The authenticated receiver bridge binds native retry outcomes to exact
   action/evidence/admission IDs. OpenCode queue/steer/paused and approved native
   idempotent lost-response recovery passed isolated OpenCode 2.1.3 acceptance;
   Codex proxy restart tests preserve native acceptance before retrying outcome
   receipts and refuse ambiguous native admission. Harness approvals remain
   authoritative. See [acceptance and limits](control-recovery.md). Physical
   deployment and remaining platform/IDE gates are separate unfinished work.
5. **Observability and storage operations.** Turnlink activity/message telemetry
   (not full harness transcripts), master-independent monitoring, 30-day rolling
   retention, protection for unresolved evidence, archive/export and explicit
    storage-pressure alerts/recovery. No credentials or authentication headers.
    Control-state export, operator CLI pressure alerts, passive OpenCode CLI hints
    and broker metadata retention are implemented/tested independently of the
    blocked movement gate. Schema-15 verified command-receipt reclamation now
    releases live receipt capacity while preserving exact UUID/fingerprint/result
    lookup through required private archives. Fourteen repository/service tests
    include cumulative exports, repeats, corruption/link refusal and restart.
    Schema-17 verified history/entity/audit recovery now releases eligible live
    budgets while retaining current cold lifecycle metadata and exact lookups.
    Full hot/cold task, evidence, managed and audit cases, late holds/dependencies,
    corruption/restart and actual receiver dispatch boundaries pass. Recovery
    executor authorization was fixed to consume trusted expanded snapshots.
    Remaining monitoring/Windows/IDE health and deployment acceptance stay open.
    The durable attention process has restart/outage and Windows lifecycle proof;
    installed OS delivery remains pending. Export alone reclaims nothing;
     observational gaps never authorize replay.
     Native health snapshots and the dashboard read surface are implemented;
     this does not establish monitoring coverage for unproxied/unsupported adapters.
6. **Operator dashboard and alerts — core console implemented.** React/Mantine, loopback-first authenticated
   backend, one human operator, session/CSRF/origin protections and scoped APIs.
   Channel/message/task/incident views, elections/modes/approvals, storage alerts
    and OpenCode CLI alerts. Broker/admin credentials never reach browser code.
    Core real views, bounded reads, guarded commands and in-page storage pressure
    are fixture/browser-verified. Passive OpenCode CLI hints additionally have
    isolated native server/POSIX-terminal proof (`opencode-alerts.md`). Advanced
     operator workflows, full background notification delivery and actual native OS,
    Windows/IDE alert acceptance remain pending. Do not equate fixtures with full
     deployment proof. See `operator-dashboard.md`.
     The event-backed operator inbox and exact-ID “seen” acknowledgement are now
     implemented (`operator-notifications.md`): retained durable events are the
     inbox source, separate schema-8 receipts preserve control state, migration
     exposes existing supported events, and reads/preview/disconnect never ack.
     Operator/channel-scoped RPC and dashboard preview/confirmation keep credentials
     server-side and revalidate the browser session at actual send. Lost replies
     are investigated by exact notification ID without dashboard resend; exact
     broker retries preserve the original timestamp. Quota/clock/rollback/corrupt
     records fail closed, receipts export privately, and seen is never resolution,
     acceptance, approval, replay or cleanup authority. Coverage is eight fixed
     durable event classes, not all alerts. OS background delivery, broader
     native/health/storage coverage and operational/deployment acceptance remain
     pending; this inbox milestone does not complete gates 5–7 or the Goal.
     Verification: nine inbox/store/broker cases plus 19 dashboard HTTP cases
     passed 280 focused repetitions. The full parent suite, with Codex/OpenCode/
     native-TUI deterministic integration flags enabled, passed 340 tests with
     three skips and zero failures (343 total). Syntax checks and dashboard build
     passed; 14 real browser cases passed in desktop-light and mobile-dark,
     including accessibility, explicit/cancelled acknowledgement, reload/new-event
     persistence and lost-HTTP-reply receipt investigation without resend. Removing
     acknowledgement persistence fails seven of the eight then-present inbox cases.
     Logs use `operator-notifications-*` in the approved temporary log directory;
     the accepted full run is `-all-final-current.log`, repeats
     `-repeated-current-final.log` and browsers `-browser-current-final.log`.
     The initial full run found external native-version drift: the isolated
     service reports 2.0.31, while a health assertion hard-coded 2.0.28. The test
     now requires V2 and compares health to that fixture service's own `/api/info`
     version; the accepted run records 2.0.31. No installed service/binary/config
     was replaced, and this does not prove all versions or the pinned 2.0.30
     movement extension on 2.0.31. Native extension code/patch and all movement
     activation switches remain unchanged.
     Advanced task-creation editor milestone: dependency UUIDs (up to 64), priority,
     optional UTC scheduled start/deadline, progress timeout, missed ask/skip/run-late
     policy and maximum lateness are editable before the existing guarded preview.
     UTC minute input rejects invalid/normalized dates instead of silently using
     local DST semantics; preview includes ISO UTC times and exact command values.
     Broker dependency/deadline validation remains final. Three explicit task-create
     reducer refusals are displayed as definite rollbacks, while lost/unknown
     replies retain uncertainty and never resend. Creation stays existing-cwd-only,
     open/unclaimed, with no dispatch, acceptance, late-run decision or approval
     bypass. This is not post-creation editing or a complete dependency picker.
     Five form cases and four added real/stub HTTP cases verify exact metadata,
     bounds, UTC DST gaps/overlaps, duplicate/invalid dependencies, expiry and
     commit refusal. Form/HTTP suites pass 280 repeated cases across UTC/New York/
     Auckland. Parent suite passes 349/three skips/zero failures (352 total) with
     all local native integration flags enabled; syntax checks/build and 16 real
     browser cases pass, including desktop-light/mobile-dark, New York timezone,
     exact persisted UTC epoch, cancellation/unclaimed boundaries and accessibility.
     Local-time parsing/refusal-classification mutations fail four/two cases.
     The initial browser failure was a required-label selector mismatch, fixed
     without increasing timeouts. Accepted logs use `dashboard-task-editor-*-final.log`.
     Installed runtime/settings/native extension/Protocol/HttpApi and production
     movement activation remain unchanged; broader workflows and gates remain open.
     Guarded reassignment milestone: the dashboard exposes only existing eligible
     claimed/running/uncertain task reassignment, with source claimant/attempt/
     admission/stop references in the preview. It reopens unclaimed, never assigns
     another participant, stops native work or accepts results. Operator-only
     canonical full-task preconditions now accompany reassignment and missed-
     schedule decisions and are checked inside the broker command transaction,
     alongside channel policy. A changed claim can no longer pass an older human
     preview solely because channel policy stayed unchanged. Exact committed
     command retries still return their original receipts after restart/new claims.
     Fresh task uncertainty revokes an old usable stop marker but retains its
     evidence; reassignment and channel-slot reuse stay blocked until fresh
     matching stop evidence. Five store cases plus four real and one transport HTTP cases cover
     transaction fences, key-order canonicalization, actor/scope refusal, restart,
     later claims, active-work refusal, uncertainty/evidence/capacity retention and
     missed decisions and actual-send task/channel fence wiring. Store/HTTP suites
     pass 330 repeats. Parent integration suite passes 359/three skips/zero failures
     (362 total), syntax/build and 20 real
     browser cases pass, including desktop-light/mobile-dark, cancellation/stale
     claim confirmation, lost-reply receipt lookup without a second release and
     accessibility. Missing digest comparison/stop revocation fail three/one probes.
     Initial HTTP fixtures lacked the receiver subscriptions required for connected
     claims; fixing those fixtures preserved authentication checks. Accepted logs
     use `dashboard-reassignment-*-final.log` (full: `-all-current-final.log`).
     Full-value comparison is neither authenticated native ownership nor an
     ABA-proof generation, global resource census, approved release, cleanup or
     physical stop proof. No native runtime/settings/extension/public native
     Protocol/HttpApi/movement switch changed; broader remaining gates stay open.
     Review-phase uncertainty milestone: matching adapter uncertainty can now
     revoke stop authority while a participant report is pending review. The
     report/artifact/stop history stays intact in review; acceptance and occupied
     channel-slot reuse stay held until a new matching stop receipt. Passive
     alert/health attention includes reviews without stop confirmation, even
     alongside a fresh idle snapshot. Schema 9 adds structured task identity on
     new review notices, preserves old state/notice bytes during migration and
     cancels matching pending readiness hints on uncertainty/completion/changes.
     Legacy unbound review hints are conservatively cancelled on those transitions,
     not interpreted from free-form text. Cancellation preserves records and cannot
     retract accepted/in-flight native prompts. New stop can reoffer the retained
     report for explicit master review; it does not accept it or resolve incidents.
     Tests cover both stop/report orders, old command replay/duplicate evidence,
     retained capacity, restart, rollback/retry, migration and unrelated bound
     task notices. Real broker tests verify authenticated actor/attempt checks,
     master refusal and passive attention, then separate explicit acceptance.
     Parent integration suite passes 364/three skips/zero failures (367 total),
     focused suites pass 760 repetitions, syntax/build and 22 desktop-light/mobile-
     dark browser cases pass with accessibility/report preservation. Missing review
     support/notice cancellation fail three/four probes. A light-theme contrast
     failure was corrected with theme text color, without weakening axe checks.
     Accepted logs use `review-uncertainty-*-final.log` (full: `-all-latest-final.log`,
     repeats: `-repeated-current-final.log`, browser: `-browser-current-final.log`).
     This does not prove native observation freshness, owner/generation exclusion,
     coherent per-resource census/release, callback reconciliation after terminal
     completion, destination/receiver/production integration or deployment. Native
     runtime/settings/extension/public native Protocol/HttpApi and movement
     activation stay unchanged; the full Goal remains incomplete.
     Terminal stop-confirmation milestone: late matching uncertainty on completed
     or dispatched-cancelled work now sets a separately persisted `terminalHold`,
     preserving terminal status, participant result, historical stop and acceptance.
     The hold occupies broker capacity, blocks new conversation/dependent dispatch
     and managed workspace admission (including previously approved admission),
     pins retention and remains visible as unresolved/passive attention even with
     fresh idle telemetry. It does not stop other running work or reopen/reexecute
     the accepted/cancelled task. Never-dispatched cancellations cannot be used to
     claim unrelated native work. Old stop-command replay/duplicate evidence cannot
     clear it; a new matching adapter receipt clears only the broker hold, not the
     incident or physical cleanup requirements. OpenCode/Codex preserve journals
     without retirement/replay while held; task pull returns null/held without
     another preparation. Schema 10 and exports retain the hold; migration preserves
     old state bytes and does not infer quiescence from an absent legacy flag.
     Six store cases and both real-broker/adapter-port fixtures cover terminal
     ordering, retained decisions/evidence, capacities/dependencies, approved managed
     admission, reconstruction, old receipt replay and held pull without native
     execution/report duplication. Parent integration passes 372/three skips/zero
     failures (375 total), 800 focused repetitions, syntax/build and 24 browser
     cases pass, including accessible terminal warning and preserved completion.
     Missing capacity/runner-retention/managed guards fail two/two/one probes.
     Accepted logs use `terminal-hold-*-final.log` (full: `-all-current-final.log`).
     This is broker bookkeeping, not authenticated native ownership, generation
     exclusion, genuine stop-observation freshness, global descriptor/resource/alias
     census, orphan reconciliation or approved physical release/re-establishment.
     Other late callback types, full destination/receiver/production integration,
     unattended OS alerts and platform/deployment acceptance remain open. Installed
     runtime/settings/native extension/public native Protocol/HttpApi and production
     movement activation remain unchanged; Goal incomplete.
     Terminal hold-generation milestone: schema 11 adds a broker generation for
     each new terminal uncertainty. A terminal stop receipt must carry its captured
     generation; old observations cannot settle a later hold merely by presenting
     a new evidence ID. Old receipt replay does not clear new holds, duplicate
     uncertainty commands do not increment twice, and settlement never resets the
     counter. Legacy held generation zero and exhausted maximum remain quarantined;
     migration preserves raw bytes and grants no release. The observer contract
     requires capture before collecting native proof, never retagging old data
     with a later counter. This is a terminal broker ordering fence, not authentic
     native ownership, genuine observation freshness, active/review observation
     epochs, global writer exclusion or physical release authority.
     Five new store cases cover stale/future/missing/foreign callbacks, restart,
     successive hold/release cycles, replay, schema-10 migration, saturation and
     rollback. Real broker and browser fixtures reject an obsolete generation and
     preserve the newer hold. Parent integration passes 377/three skips/zero failures
     (380 total), 800 focused repetitions, syntax/build and 24 browser cases pass.
     Missing matching/advancement fails three/four negative probes. Accepted logs
     use `terminal-generation-*-final.log`. No automatic observer/receipt retry or
     permission change was added. Installed runtime/settings/native extension/public
     native Protocol/HttpApi and movement activation remain unchanged; native
     observation/release/owner/census/orphan/destination/receiver/production and
     broader platform/operational gates remain open. Goal incomplete.
     Read-only operator notification-watch milestone: an explicit CLI command now
     reads the durable pending inbox without a master/browser or model prompt,
     emits typed channel-scoped metadata and deduplicates immutable IDs in bounded
     memory. Four 30-record pages per poll, serial reads/output and a fixed-ID
     memory budget bound resource use; no history is silently evicted. Malformed,
     wrong-channel, acknowledged or inconsistent pages, changed IDs, output failure
     and disconnect stop visibly without automatic reconnect/retry. Restart may
     redeliver stable pending IDs; no seen, native admission, recovery, cleanup or
     exactly-once transport/human receipt is inferred. No daemon/OS service or
     permissions were installed/activated. Tests exercise real CLI processes and
     broker delivery, new-event dedup, explicit restart, non-admin refusal, privacy,
     full receipt-budget reads, disconnect, actual broken output pipe and pending
     inbox preservation; controlled cases cover cancellation, concurrent polls,
     bounded pages/memory and failed output with no same-instance retry. This
     terminal path does not satisfy unattended OS/Windows/IDE delivery, complete
     event/health/storage coverage or native observation/release/ownership gates.
     Verification: 395 parent tests/three skips/zero failures (398 total) with local
     native integration flags, 270 focused inbox/watch repetitions, syntax and
     whitespace checks passed. Eighteen new watch cases include real CLI/broker
     restart/dedup, full command-budget reads, admin refusal, disconnect and actual
     broken output pipe, plus controlled callback/cancellation and memory/shape/
     scope ordering. Removing dedup/failure-stop/channel checks fails two/one/one
     probes. Accepted logs use `notification-watch-*-final.log`. Installed runtime,
     global configuration, database schema, native extension/public native Protocol/
     HttpApi, permissions and movement activation remain unchanged. Goal incomplete.
7. **Operational acceptance.** Fault/restart races, actual Windows and IDE
   evidence, live-model acceptance, capacity/storage tests and explicit deployment
   review. Default safe-automatic recovery; production switches stay off until
   their individual gates pass. Claude task execution remains deferred.

## Current resumed execution evidence

Latest accepted parent verification after storage, Windows-path and Linux supervisor fixes:
**488 passed, 11 explicitly skipped, zero failures (499 total)** with native
Codex/OpenCode/TUI flags. All **26** desktop/mobile browser cases, syntax/build
and whitespace checks passed; browser/build evidence precedes the later supervisor
and fixture-only changes. The skips include seven Windows, one opt-in Linux
parser, two opt-in Codex continuity probes and one experimental IDE automation
case. Separate Linux acceptance passed 22/22 including its native parser. A digest-verified Windows source snapshot
plus verified path-fix overlays passed **49/49** history/effect/service/ACL/
attention/setup/supervisor cases, including the actual late-cold-hold dispatch
boundary and long-file credential ACLs. Earlier Windows launcher/V2 delivery
acceptance also passed. The isolated target directory was removed after logs
were retrieved and no fixture processes remained.

The native kernel/storage prerequisite now has a separate frozen **7,170 core
passes, 43 skips, zero failures (309 files)**, 145 focused cases, 85 server passes
(one skip), canonical 35 checks and Core build. Compatible native movement
storage uses a real kernel lifetime lock and connection-specific SQL authority;
unknown writers remain refused. This does not prove external native I/O absence
or implement placement commit/receiver rebind. Gate 2 remains open.


The [execution ledger](remaining-development.md) records the current scope and
remaining work. The combined parent run passed 460 tests with three Windows-only
skips and zero failures (463 total), with Codex/OpenCode/native-TUI deterministic
integration enabled. Those three platform cases also passed on the actual
Windows host using isolated source, private temporary state and a fresh native
launcher: argument/stdout/exit handling, authenticated V2 idle delivery and ACLs.
Dashboard build, syntax checks and all 24 browser cases passed before the latest
approval-preview follow-through; subsequent evidence is recorded in the ledger.

The frozen internal native ownership/quarantine/destination-preparation stage
passed 7,156 core tests (43 skipped, 308 files), 162 focused cases, 85 server cases
(one skipped), 14 SDK cases and 35 canonical checks, plus core build and pinned
patch validation. This is a bounded prerequisite. Full destination authority,
resource ownership, placement commit, receiver acknowledgement and production
adapter movement remain required; gate 2 stays open.

The operator-attention process now has a private durable submission journal,
bounded reads, reconnect, outage deduplication and read-only live status. Twelve
cases passed. Native utility submission is distinct from OS delivery or human
receipt. Windows registration, supervised installation and actual OS/IDE alert
acceptance remain unfinished. No installed runtime, production service or global
configuration has been replaced by these development checks.

## Completion boundary

The full platform is complete only when all gates above have implementation and
scope-matched acceptance evidence. Report tested primitives separately from
enabled operations. External/manual acceptance dependencies stay visible; do
not call an unfinished gate complete or silently narrow this plan to one adapter.

## Verification for the current milestone

```sh
TURNLINK_CODEX_INTEGRATION=1 TURNLINK_OPENCODE_INTEGRATION=1 TURNLINK_OPENCODE_TUI_INTEGRATION=1 node src/run-tests.js
npm run check
npm --prefix dashboard ci
npm run dashboard:build
npm --prefix dashboard run test:e2e
```

The suite includes both native local-model gates, actual proxy/native-process
restart and lost-response reconciliation, native MCP claim/report/review,
permission/elicitation preservation, human interruption, drift refusal and
default-off/worktree exclusion. Use the project's supported Node version.


## Provider-only native preparation — 2026-10-28

The native provider factory scope now has separate reservation-bound preparation
and revalidation, retaining the actual native destination Config and selected
provider inputs. Full destination preparation reuses it and retains its additional
model/instruction checks. Both the future and owned result remain boxed. No
constructor or credential callback runs in this narrower preparation phase.
Instruction changes alone remain outside its readiness contract; constructor
configuration changes, native runtime/provider changes, foreign/closed owners and
stale reservations remain refused.

Verification: 2,920/2,920 Core library tests passed; seven affected destination
assembly cases passed without a stack override. The new provider-scope case passed
on the default stack and covers instruction-only changes, configuration drift,
foreign/closed owners, stale reservations and unchanged published settings.
The 635,786-byte native increment reconstructs exactly and reverse-checks; SHA-256
`482588ed8bdfdb6cdadb7838126c3381871a0b672fb6ea03e84e5a9aaa2c1585`.
Logs: `/tmp/turnlink-provider-scope-tests.log`,
`/tmp/turnlink-provider-scope-default-stack.log`, and
`/tmp/turnlink-provider-scope-core-full.log`. Two changed native source hashes are
retained in `/tmp/turnlink-provider-scope-source-freeze.json`.

The previous app-server executable was not rebuilt; previous entrypoint and process
component results do not cover this new source increment. No installed runtime,
live broker or editor was changed. Factory registries inspected during this step
retain weak references, but live provider aliases can share resources; this is not
a cleanup proof. The native opaque plan producer, approved factory invocation,
retained ownership/census and cleanup/handoff remain unwired. Complete authority,
commit/receiver continuity, both adapters and platform acceptance remain open.
Gate 2 remains open and movement remains disabled.


## Approved native provider construction checkpoint — 2026-10-28

Codex now produces an owned native provider plan and consumes a separately approved
factory grant through its private channel. Durable intent precedes construction;
actual resource ownership and receipts retain the conversation hold. Real-process
verification covers operator approval, native factory construction, unchanged source
placement and disconnect/restart quarantine. Native startup activation and executable
paths are bound at their actual producers; unknown source edits still refuse.

Current scoped verification: 2,926 Core tests, eight affected default-stack cases,
four private-channel cases, both production entrypoint checks, 545 JavaScript passes
with 16 skips, and two isolated staged-process passes. See the execution ledger for
artifacts, failed-run history and boundaries. Gate 2 stays open for complete
resource/permission authority and census, cleanup/handoff, native commit and receiver
continuity, OpenCode parity, full task/master acceptance and platform evidence.
Production control and movement remain disabled.


## Unpublished provider-owner cleanup — 2026-10-28

Codex can now release an unused constructed provider owner through its private
native channel. Cleanup durably records intent, refuses exposed/shared owners,
drops actual provider/Config handles and persists a receipt before releasing
native admission. The broker retains exclusion until the exact receipt arrives;
failed or uncertain cleanup remains held. This is abort cleanup, not placement
or active-context disposal. Cancelled setup can be cleaned without reviving it.
The real process fixture proves the same source conversation accepts another turn
following cleanup. Verification: 2,928 Core, 134 model-provider, 553 parent passes
with 17 skips, five private-channel cases, both entrypoint checks and three native
process cases. Complete destination authority/census, active-resource cleanup and
closed-owner recovery, placement commit/receiver handoff, OpenCode parity and
full task/master/platform acceptance still prevent Gate 2 closure.


Native immutable policy-rule provenance (2026-10-28) now distinguishes fixed
native requirement/MCP/deny-read rules from unknown callbacks without invoking
them. Config and Core verification passed 403 and 2,930 tests respectively;
production checks, five private-channel tests and three staged process cases
passed. This resolves a scoped provenance prerequisite, not complete mutable
permission freshness or destination authority. Gate 2 remains open with the
full resource, placement, receiver, OpenCode, production and platform requirements
in the execution ledger. Production movement remains disabled.


## Native MCP request fencing — 2026-10-28

Native runtime/client factories share a request owner across publications and
retained call handles. Reservation exclusion fences native requests and call
preparation before their effects. Event requests retain their permit through the
actual response; cancellation/outer errors retain uncertainty. Refresh publication
honors session admission and preserves invalidation on refusal. Restored unknown
owners suspend MCP startup and remain quarantined. This does not prove autonomous
servers, background credentials/raw SDK aliases, complete resource cleanup or
fresh destination authority. No ordinary MCP configuration was disabled.

Verification: 2,931 Core, 272 MCP and 263 RMCP library passes; one parent-ignored
child entry was actually run by its owner test. Seven new default-stack cases and
the unchanged current-auth integration case passed; that integration also passed
on default stack. Both source-built entrypoints and three warm private-channel
process cases passed. Initial CLI-probe/app-server-startup timeouts remain recorded
and cold acceptance stays open. Aggregate integration builds exhausted disk;
only the exact changed integration test ran through a temporary source symlink.
Parent JS/OpenCode scope was not rerun or relabeled. See the execution ledger for
logs, artifact archival/restoration and the complete remaining requirements.
