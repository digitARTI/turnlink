# Staged receiver handoff

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


Codex cannot use the legacy unverified release, whether or not a completion
verifier is configured. Its receiver stays held even after a restart that loads
a legacy unverified release. The current native completion verifier supports
OpenCode only; a Codex verifier and production native handoff remain to be
implemented. The legacy unverified path remains available to staged OpenCode
fixtures only when neither a verifier nor worktree task dispatch is configured.

The OpenCode recovered owner persists the exact native placement and broker
settlement command ID before sending the settlement. A successor can reuse that
ID, then reobserve the native placement before recording the moved result. The
same logic supports a destination prepared by a successor after source loss.
Isolated real-plugin tests killed the controller immediately before and after
broker dispatch for both stage types; all recovered with the receiver held and
completed verified release. These tests aged only dead fixtures' journal locks
to simulate their 60-second expiry. Production orchestration and rate-limit
handling outside the bounded OpenCode candidate RPC path remain open.

While a receiver is held, the broker also suppresses task-available wakeups,
including direct task changes and periodic readiness signals. It resumes
signaling eligible tasks after an authorized release.

The staged broker accepts an exact prepared Codex movement grant with retained
destination owners for receiver offer and commit, after a separate current
handoff authorization. The receiver remains held; this does not authorize a
Codex release. An isolated broker/app-server test transferred the fixture
receiver and correlated restored native historical records under that hold.
Normal launcher wiring, complete native placement and completion remain open.
On a source handoff event the Codex proxy invalidates its local generation,
clears buffered deliveries and notices, and stops processing notifications for
that lost receiver. On a later authenticated recheck it can acknowledge source
detachment only if the original publication fence remains quarantined and local
work was and remains quiet. This acknowledgement does not release the held
destination receiver or establish remote-resource completion.
For the experimental staged publication path, the proxy's source-offer
handler compares the current grant, exact live native owner, shutdown receipts
and publication fence before committing; an ambiguous dispatched offer is not
repeated. Normal startup does not enable the fixture or initiate this driver.
When a destination resume has an uncertain subscribe reply, the client removes
the possible subscription using the transition key; if that removal is also
uncertain, it terminates the socket so a successor can resume safely.
In the debug-only staging path, a lost successful publication reply can be
observed on the same live owner under the original publication barrier and
fresh broker authorization. The observer checks the matching persisted journal,
installed model pair and MCP owner and never replays publication. It leaves
admission and the receiver held and does not prove remote resource cleanup.
The Codex proxy can opt in to a dedicated held receiver by setting
`AGENT_CHANNEL_CODEX_DESTINATION_FILE` to a private JSON file containing
exactly `version: 1`, `mode: "offer"` or `"resume"`, and the full prepared
Codex movement `grant` returned by the broker. The proxy also requires its
stdio app-server, native-control flag, control plane and adapter credential.
In offer mode the proxy offers the exact receiver and, after transfer, requests
the source recheck. In resume mode it loads the previously persisted transition
key. The configuration path is removed from the child process environment.
The proxy's private native-control channel uses the same dedicated broker client
as this receiver; it closes if that client disconnects.
After a quarantined thread-resume refusal in resume mode, the proxy correlates
the matching historical native records with the host journal and held receiver.
This is a read-only observation and does not make the destination executable.
This is opt-in staging: the source movement driver is not wired into normal
startup, and neither mode authorizes native placement or receiver release.

An opt-in source preparation may be configured through a private JSON file
named by `AGENT_CHANNEL_CODEX_SOURCE_FILE`. It must contain exactly `version: 1`,
`agentId`, `channel`, `taskID`, `claimGeneration`, an absolute `destination`,
and `leaseMs` between 1000 and 600000. The selected thread must already be
subscribed and the task claimed; MCP and provider effects still require their
individual broker approvals. A nonempty resource journal refuses a fresh run.
This path retains the native fence and resources while final movement authority
is missing. It does not create the final movement grant or release the receiver.

## Current OpenCode destination result — 2026-10-30

The OpenCode receiver handoff is no longer limited to fixture-created placement
or simulated task execution. The default-off full-destination integration runs
the production native placement and completion RPC handlers in real isolated
processes, recovers owner and reply loss from durable records, requires protected
transport-release evidence, revalidates native executable authority, releases
only the exact held receiver, delivers the queued message once and runs the
destination task path. Completion is dispatched only after observing and
matching the exact native placement receipt. Missing release evidence and a
mismatched receipt both fail closed before their respective native mutations.

This closes the OpenCode receiver/destination portion of Gate 2. It does not
enable movement by default or close the cross-runtime gate. The incompatible
Codex Desktop launch path selects separate homes, but complete isolation is
unverified, and Codex's own production
destination resource, commit/recovery and exact receiver path remains
unfinished. The historical sections below describe the incremental staged path
that led to the current OpenCode implementation.

## Previous staged checkpoint

An isolated integration now carries a real native prepared placement through
owner process loss, successor receipt observation, native completion and
broker-verified release of the exact held receiver. A queued message is then
delivered once to the same session. The test also runs the OpenCode task adapter
through evidence, report and an independent reviewer acceptance. Native source
detachment and earlier host-journal entries are fixture-created, and the task's
session execution is simulated. The native prepared observation explicitly
reports `executionEligible: false` and unresolved resource release, so this is
not complete destination authority or production acceptance.

The internal OpenCode placement transaction can now install a receiver-bound
membership and durable receipt while the Session remains quarantined. Its
isolated tests use a native activation owner and cover rollback, abrupt exit,
successor takeover and receipt observation through the private host channel.
The broker-held handoff and complete destination authority are not yet wired to
dispatch this transaction, and the receiver is not released by these tests.

An explicitly configured broker-owned verifier can also observe native
completion before receiver release. Its verified release record survives a
lost reply, and the destination plugin can recover that result using its own
receiver socket. Isolated broker and plugin tests exercise release; the normal
launcher can now configure an authenticated local OpenCode verifier transport;
an explicitly configured completion-owner CLI can register the native owner
after placement. Full migration orchestration remains unfinished. The legacy release method remains
available for OpenCode when no verifier is configured only if worktree task
dispatch is disabled. When worktree task dispatch is enabled, missing native
completion verification refuses a new release and also fences legacy released
records, including after restart. Enabling verification later fences
previously released receivers that lack verified completion evidence; they
cannot be automatically promoted by this path. This evidence does not establish
complete destination authority or resource readiness.

The broker can stage an authenticated transfer of a conversation receiver between two connections. The `receiverHandoff` broker constructor option defaults to false. Normal OpenCode handoff requires an explicitly configured OpenCode completion verifier. For a separate Codex-only review, the normal broker may instead start with `AGENT_CHANNEL_CONTROL=1`, `AGENT_CHANNEL_WORKTREE_GRANTS=1`, `AGENT_CHANNEL_RECEIVER_HANDOFF=1` and `AGENT_CHANNEL_CODEX_HANDOFF_ONLY=1`. That mode rejects OpenCode handoff and worktree authorization, refuses startup if an OpenCode handoff record already exists, and does not allow broker effects, worktree task dispatch, effect verifiers or receiver release. Prepared and completed OpenCode worktree records remain intact; an operator can return to the ordinary configuration to handle them. An imported Codex checkpoint grant still permits inspection only, and cannot transfer the receiver or settle movement. This mode does not enable production movement. An approved worktree grant, by itself, does not prove native placement or authorize task execution.

The candidate uses `ChannelClient.offerReceiverHandoff` with the exact approved grant and an enrolled adapter credential. Before offering, the client creates and fsyncs a fresh private receiver key keyed to the agent and transition. The broker verifies the candidate's session identity, host, adapter enrollment, current source receiver and fresh worktree grant. The offer is bound to both sockets, expires after 30 seconds, and does not survive a broker restart. Only the current receiver can commit that offer, after the broker rechecks the grant, credential and ownership. A previously exposed but unacknowledged delivery prevents the swap.

The candidate now registers its in-memory recovery key before it signals readiness. Only then does the broker notify the exact source receiver of the validated offer. An OpenCode source with the separate `receiverHandoff: true` plugin option may commit that offer after checking the session, native idle status, local blockers, saved membership writes and fresh grant authorization. New local work is fenced during the commit; a failed or ambiguous commit after fencing requires recovery. Busy or blocked sources leave the offer uncommitted. Every source retains its membership for native detachment and checks absence before acknowledging. This source path is staged and default-off; it does not install a destination membership or establish native movement.

Readiness is a distinct protocol request, so both broker and client must be updated together before staging this path. A source that declines an offer is not automatically retried: the candidate can send `control_receiver_ready` again with the same agent, credential, channel and offer ID while the offer is valid, or create a new offer after expiry, subject to fresh authorization.

Commit durably rotates the session proof and receiver key hash before changing the receiver socket. The old session proof can no longer subscribe or act as that participant. The destination client adopts its prepared key. This fences clients that possess only the previous proof; it does not isolate mutually hostile processes running under the same OS account, which may have access to the same private credential directory. A lost reply does not justify repeating the swap: the destination can call `resumeReceiverHandoff` with the exact transition to recover its already-persisted key. A broker failure before the durable write retains the previous proof; a failure after it retains the destination proof.

The broker also persists a hold associated with the exact transition. While held, it queues inbound messages, rejects outbound participant messages and returns a held result for task pulls. The OpenCode source adapter invalidates its local Session and waits for its serialized membership writes. In the staged native path it retains the membership for the native owner to archive. The enrolled current receiver can then ask the broker to notify the exact old source socket, which independently rechecks absence and acknowledges detachment. If a local tool, task, delivery, control poll or operator form is active, or storage cleanup fails, it does not acknowledge. Release requires that durable source acknowledgement plus the exact matching moved transition, destination and live task claim. The enrolled current receiver can observe the held/released status and source acknowledgement. Release is idempotent and its result survives restart. The legacy settlement alone does not establish native movement, complete destination authority or resource cleanup; the verified OpenCode release additionally checks the native completion and receiver binding. The isolated native path can install destination membership and commit placement, but the full ordinary migration orchestrator remains unfinished. A broker with an explicitly configured trusted native recovery verifier can recover an acknowledgement after the old source socket disappears; the normal broker does not configure that verifier. Native commit ordering also remains unresolved: an ordinary `session.moved` event detaches the source before it can commit a later broker swap. These native checks, ordering and both destination adapter integrations must precede using this facility as part of the Gate 2 transition. Ordinary moves continue to detach the OpenCode receiver.

The new receiver metadata is stored in the private broker state. Older strict-schema brokers cannot read a state containing it; a compatible, explicitly planned upgrade and rollback strategy is still required. Tests use isolated broker and synthetic grant fixtures, not the user's live sessions or production infrastructure.

The broker also has a separately staged `worktreeTaskDispatch` constructor option, defaulting to false. The normal launcher accepts `AGENT_CHANNEL_WORKTREE_TASKS=1` with receiver handoff and task dispatch enabled. It limits worktree task pulls to the released receiver, exact approved transition and destination, and pins an active task to its original execution scope. The OpenCode and Codex task adapters have separately disabled internal `worktreeTasks` switches. When explicitly staged, they persist the transition identity in their task journals and re-observe the released receiver and matching preview before processing the task. A failed check after task preparation leaves the dispatch requiring recovery; it cannot be silently adopted without a journal.

The isolated staged task tests simulate the movement settlement and exercise destination scope checks, adapter task execution, artifact and stop evidence, participant report, and master acceptance for OpenCode. Codex cases instead verify that a simulated settlement cannot release the receiver or start a destination task, including after loading a legacy released record. Neither staged option is enabled by the installed launchers, and the native ordering and authority gaps above remain open.

An explicitly constructed live native owner can now prepare a quarantined
Session and release its tracked local model WebSocket under the exact approved
broker grant. The host rechecks enrollment and the grant before and after each
effect and records dispatch before calling native code. An uncertain response
or interrupted authorization stays held and is never replayed automatically.
An isolated test uses a real broker, native process and local WebSocket; it
also covers lost replies and revoked authorization. The receipt covers that
owner's tracked local WebSocket only. It does not prove remote model work has
stopped, release other resources, reconcile prior-process orphans, install the
destination receiver or move the Session. The private live channel is not
enabled by the normal launcher, and no Gate 2 completion is implied.

The isolated real server now also completes a turn over a local Responses
WebSocket and closes that same socket under the approved transition. When the
native execution reservation definitively reports busy before entering the
preparation transaction, the host records that result and can try the same
transition after a fresh broker authorization. A lost busy reply stays
uncertain and is not replayed; revocation prevents a later attempt. These
tests do not prove remote cancellation or release of other resources.

The staged live-recovery bridge binds the live dispatch journal to the
recovery owner and membership-seal journal under the same broker grant.
After an uncertain live preparation or transport release, it can claim the
matching native quarantine, inspect retained state, and seal source
membership only when native inspection proves it already absent. If a claim
or seal reply is lost, a successor observes the durable native record and
takes over rather than repeating the effect. Isolated broker and server tests
include changed grants, revoked enrollment, absent quarantine and lock-release
failure. The live journal stays held: these are recovery and local membership
evidence, not resource reconciliation, destination installation or movement
completion.

When the old source membership is still present, an exact successor recovery
owner can now preserve the complete membership in an insert-only native archive,
remove the source key and seal its absence in one transaction. The host permits
that operation only while the broker has transferred the receiver into the
matching held handoff, with fresh broker authorization and a durable dispatch
record. The broker's separate detachment authorization validates the full
held-handoff identity and requires the current OpenCode receiver. Pending forms, mismatched membership identity, a live prior owner,
missing handoff or revoked enrollment refuse the operation. Lost replies are
reconciled by observing the native archive and seal, without replay.

This is local membership detachment, not a source acknowledgement to the
broker. The broker still reports `sourceDetached: false` and refuses receiver
release. The archived membership must later be consumed by an authorized
destination installation; no such operation is implemented yet. The separate
broker-owned verifier described below can now recover this acknowledgement.
Other prior
process resources and remote work remain unresolved.

The original live native owner can now perform that same atomic archive and
seal after its tracked transport release. A separate destination-side host
bridge checks the held receiver and exact broker grant, persists dispatch before
the native call, and checks authorization again afterward. A lost reply remains
uncertain; a successor can inspect the original owner's archive and seal without
repeating the deletion. If the original adapter and broker connection remain
live, a separately authenticated source recheck can produce the original
socket's acknowledgement. Tests connect a real broker and native server to an
adapter fixture backed by the same SQLite database. They do not prove a real
destination installation, remote work cancellation, other resource release,
or recovery of an acknowledgement after the source socket disappears.

After the original source has acknowledged, the current held receiver can
authorize the live native owner to create an inert destination membership
record. The native transaction validates the matching archive and absence
seal, preserves the archived membership, updates its directory, and binds the
protected record and its membership value to the exact transition and
receiver-key hash.
The host journals dispatch before the call and rechecks broker authorization,
the held receiver and its key afterward. A successor observes a lost result
without repeating the operation; an undispatched or rolled-back result remains
uncertain. Before-dispatch refusals can be retried after the missing condition
is corrected. This record is not the plugin's live membership key: the Session
remains at the source, delivery remains held, and no destination authority,
placement, installation, resource release or execution is asserted.

The OpenCode destination plugin can recover a membership carrying that binding
using the transition-specific private receiver key. It checks the key hash,
actual Session location, released broker hold and moved transition before it
admits queued messages or tools, and preserves the binding in later membership
writes. A held handoff or changed key is refused; a delayed move event for the
verified destination does not remove the recovered membership. If a subscribe
reply is lost, the plugin uses the verified key to unsubscribe the possibly
installed socket, or terminates the socket if that cleanup is uncertain. The focused
integration passes the actual native staged value to the plugin after simulating
placement and broker settlement. Native installation and placement, candidate
ownership in the plugin, and authorization to release remain unimplemented.
Older staged records without the new binding remain observable for recovery but
cannot establish this plugin recovery path without a matching binding at install.

The opted-in destination plugin can also own the held receiver before native
placement. Its Location-scoped movement RPC requires a separate private
file-backed capability, the enrolled adapter credential and an exact approved
grant; it exposes only candidate offer, recovery, broker authorization and
source recheck, not placement, settlement or receiver release. The host bridge
uses that plugin-owned socket for source detachment and destination staging.
An incarnation and disconnect generation invalidate stale host handles, and
fresh capability and broker checks bracket forwarded requests. Lost offer and
resume replies are reconciled using the already persisted receiver key rather
than by repeating the transfer.

An isolated native-server test loads the destination plugin in the native
Location, transfers the receiver from a SQLite-backed source adapter fixture,
and uses the plugin socket for native detachment and staging. It reloads the
Location, then shuts down the original native server and starts a recovery
server that resumes the plugin receiver and observes the same staged record
under a new native recovery claim. The source-run native CLI reports its version
as `local`, so the test wraps the plugin context to supply the checked-out
version. The source adapter remains a fixture, and the shutdown is graceful.
This establishes neither native placement nor resource cleanup or execution.

A programmatically configured broker-owned verifier can now recover source
acknowledgement when the original source socket is gone. The request carries no
native evidence: the verifier inspects a claimed successor native owner and
matching protected archive and seal, and the broker checks the held receiver,
grant and enrollment both before and after that inspection. The broker stores
the original owner, current recovery and seal lease identities and the seal
nonce with the acknowledgement, including when a later successor takes over
from the owner that archived the membership. The path
is off unless the broker host explicitly supplies the trusted verifier; it is
not wired into the normal launcher. Existing strict-schema brokers cannot read
state with this new recovery evidence, so upgrade and rollback require planning.

Once that acknowledgement exists, the successor native owner can stage the
archived membership for the exact held receiver. A separate durable dispatch
journal prevents replay after an uncertain result. A later owner observes a
staged value after a lost reply; an undispatched or rolled-back stage remains
unresolved and is not repeated automatically. Isolated tests cover the original
owner detaching before exit, successor detachment after exit, broker restart,
changed receiver keys, lost replies and transaction rollback. The source adapter
is a fixture, and the source Session remains at its original location.

On graceful shutdown, the original movement-enabled native owner now waits for
tracked socket closure and reader termination before settling a terminal
exchange's acquisition record. If the exchange lacks a terminal observation,
its record remains held even when the local socket closes. Real server restart
tests check both cases. This does not reconcile an abruptly lost owner or prove
that remote model work has stopped.

An explicit isolated stdio launcher can now install that live channel in the
native server's own service graph and return a separately generated loopback
server credential to its caller. This starts a new server; it does not attach
to or replace an already running server. An end-to-end test checks broker
authorization, native preparation and release through that graph, and checks
that an ordinary prompt cannot enter the quarantined inbox. Session-bound
Location and form routes now reserve Session activity before graph initialization.
Quarantined prompt, shell, instruction and form requests are rejected without
starting that graph, and the following transport release succeeds. Ordinary
unquarantined prompt and form requests work. The human interrupt route remains
available to cancel a reservation. Global forms and other resource families are
not covered by this check.
