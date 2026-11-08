# Turnlink control plane — foundation

## Current status

This includes the foundation and an **opt-in authenticated broker/OpenCode/Codex governance slice**, not a deployed coordination platform. Default messaging behavior remains unchanged. No active configuration or production state is migrated.

Implemented:

- `src/control/contracts.js`: strict, versioned commands, actors, channel/master/election/task/action/incident/evidence models and validated state.
- `src/control/reducer.js`: isolated, side-effect-free state transitions and ready-task ordering.
- `src/control/policy.js`: the three-way recovery policy and versioned supplemental master instructions.
- `src/control/store.js`: private, exclusively owned SQLite storage; state, events and idempotency receipts commit together.
- `test/control.test.js`: governance, authority, task lifecycle, race/staleness, failure and persistence tests.
- Real, opt-in OpenCode/Codex worktree capability gates using isolated configuration and local deterministic model fixtures.
- `src/control/gateway.js`: broker-derived operator/participant/adapter identities, channel-scoped bounded queries, enrolled receiver-bound adapter evidence, audited master message inspection and scheduler clock transitions.
- Transactional role-notice outbox, native OpenCode admission receipts, explicit participant acceptance, adapter lease renewal and membership-departure fencing.
- Optional `channel_control` / `channel_status` tools and a local operator CLI (`src/control-admin.js`). Model tools cannot enroll adapters, change channel policy, approve worktrees or initiate effects.
- Broker/socket, storage-hardening and OpenCode role regression tests. The real OpenCode service gate verifies supplemental role acceptance without replacing its existing agent, permissions or global/project instructions.
- `src/codex-control.js`: same-proxy/thread role delivery, receiver-backed acknowledgements and lease renewal. Admission uncertainty persists across restart; late responses reconcile without appearing in editor RPC output. Real Codex API/model-fixture verification preserves cwd, model, sandbox/approval settings and global/project instructions.
- `src/control/effects.js` / `src/broker-effects.js`: all six opt-in recovery operations, with transactional SQLite intents, immutable broker JSON receipts, authenticated adapter delivery outcomes and restart reconciliation. [Recovery boundaries and native acceptance →](control-recovery.md)
- Worktree preparation subgate: approval-bound manifests, receiver-only transition grants/receipts, unresolved-conversation fencing, scoped preview/transition reads, and a private crash-safe adapter coordinator (`src/worktree-transition.js`). This coordinator is internal and is **not connected to live adapter movement**.
- Fresh broker worktree authorization: internal `control_worktree_authorize` validates the actual enrolled adapter receiver and an exact prepared grant against current claim, approval, occupancy and runtime evidence. The coordinator requires its fresh response before invoking the native port. This is a read-only broker check, not a native owner capability or live movement activation.
- Native snapshot observation: `src/native-snapshot-source.js` binds source conversation identity, selected native model/agent, permissions, sandbox/approval policy, tools, retained instruction entries, configuration and activity revision. `src/worktree-snapshot.js` reads bounded offline source/destination inventories without executing destination code. Both real-service fixtures exercise these readers. Their reports are observational candidates, **not execution authorization**.
- Codex stdio exclusion primitive: `src/codex-admission-fence.js` is integrated into proxy forwarding and tested with live stdio and the real Codex fixture. It holds competing admissions, preserves actual human approvals/cancellation, and quarantines uncertain owner effects. Acquisition remains internal-only; **no production transition executor acquires a fence yet**.
- `adapters/opencode-tasks.js`: separately opt-in execution of voluntarily claimed, explicitly non-worktree tasks in the existing OpenCode session/cwd; private admission journal, native segment references/hashes, stop evidence, participant result report and master review notices. The real OpenCode local-model fixture exercises claim → execution → report → explicit master acceptance.
- `src/codex-tasks.js`: separately opt-in existing-thread/cwd task execution through the Codex stdio proxy, with an exclusively locked private attempt journal and exact native-turn evidence. Native mutation uncertainty is reconciled from the correlated user-input/turn record, never by resending a start. Process-restart/approval/interruption fixtures and the real Codex local-model/native-MCP claim/report/review flow exercise this gate.
- Bounded broker metadata telemetry, private consistent control exports and operator CLI storage-pressure monitoring; none of these observations authorizes native replay or prunes command receipts.
- `src/dashboard-server.js` / `dashboard/`: experimental loopback React/Mantine operator console, separate login/session/CSRF, channel allowlist, typed read views, preview/confirm controls and broker-transaction policy/authority conditions. [Setup, security boundary and browser acceptance →](operator-dashboard.md)
- Passive OpenCode CLI hints (`adapters/opencode-alerts*.js`, `adapters/opencode-tui*.js`): separately opt-in, member/proof-scoped metadata and native Location/session fencing, without model prompts or permission/role changes. Real isolated server and POSIX terminal fixtures exercise the RPC/UI boundary. [Options and limits →](opencode-alerts.md)
- Durable operator inbox: eight fixed durable event classes, metadata-only pages, schema-8 exact-ID “seen” receipts and guarded dashboard confirmation. Seen never means resolution, task acceptance, approval or resource cleanup. [Storage, scope and limits →](operator-notifications.md)
- Read-only operator CLI notification watch: bounded pending-metadata pages with in-memory deduplication, explicit restart on failure/disconnect, no seen acknowledgement or model wake. Works without a master/browser and at full command-receipt capacity; not an installed daemon, OS delivery guarantee or capacity recovery. [Usage and limits →](operator-notifications.md#read-only-operator-cli-watch)

Still required: comprehensive adapter health acceptance, production capacity/lifecycle review, full destination effective-authority resolution, production native exclusion/destination rebind, production managed worktree integration, complete dashboard workflows, installed OS notification delivery and remaining Windows/IDE/live-model deployment acceptance. Verified receipt/history/entity capacity recovery, a durable attention process and reviewable supervisor artifacts are implemented; see [receipt storage](control-receipt-reclamation.md), [history storage](control-history-reclamation.md), [attention service](operator-attention.md) and [current execution evidence](remaining-development.md). By default an approved action remains a record; the separate broker-effects flag enables the six operations described below. Task dispatch is separately default-off; capabilities advertise its actual flags, supported harnesses and `taskWorktreesEnabled: false`. `worktreeExecutionEnabled` remains false. Internal stores/reducers/coordinators/readers are not browser/model APIs. See `control-plane-roadmap.md` for the full remaining plan; completing an existing-cwd task, dashboard or passive-alert slice does not complete the platform.

## Experimental activation (isolated state only)

Start a broker with `AGENT_CHANNEL_CONTROL=1 npm start`. Its control database is created in the broker state's `control/` subdirectory. Do not enable this against a production installation yet: full native continuity, broader telemetry/desktop coverage and operational acceptance are pending.

For isolated migration testing, the normal broker entry point also accepts
`AGENT_CHANNEL_WORKTREE_GRANTS=1` with `AGENT_CHANNEL_CONTROL=1`. It enables
the existing movement and resource grant protocol, subject to enrollment and
approval; it does not enable native movement execution, receiver handoff, or
resource cleanup verification. The flag defaults to `0`; other values are
rejected. The incomplete Gate 2 implementation is not production-ready.

For an isolated macOS cancellation-verifier test, the broker and source proxy
may both set `AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET` to the same absolute
socket path in a private directory and `AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE`
to a private file containing the same 64-character secret. The secret must differ
from the host, administrator and proxy adapter credentials. The source proxy creates and removes the
socket and does not pass either setting to the native child. The broker requires
worktree grants and refuses incomplete configuration. This verifier checks a
specific native destination-grant cancellation; it does not prove MCP cleanup,
activate movement or enable receiver release.

For isolated OpenCode receiver-release testing on macOS, configure the broker
with `AGENT_CHANNEL_RECEIVER_HANDOFF=1`, `AGENT_CHANNEL_CONTROL=1`, and
`AGENT_CHANNEL_WORKTREE_GRANTS=1`. Set
`AGENT_CHANNEL_OPENCODE_COMPLETION_SOCKET` to an absolute socket path in a
private directory and `AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE` to a
private file containing a separate 64-character secret. The secret must differ
from host, administrator, adapter and cancellation-verifier credentials. To
test worktree task dispatch also set `AGENT_CHANNEL_TASKS=1` and
`AGENT_CHANNEL_WORKTREE_TASKS=1`. The CLI refuses incomplete configuration.

For an already committed native completion, the explicit
`turnlink-opencode-completion-owner --config /absolute/private.json` command can
reopen the isolated native server, recover its receiver, register the verifier
and request release. The private JSON contains `version: 1`, `hostId`, the exact
broker `grant`, absolute `runtime`, `entrypoint` and `database` paths,
`source.directory`, `credentialDirectory`, `liveJournalDirectory`, optional
`destinationJournalDirectory`, and absolute `hostTokenFile`, `adapterTokenFile`,
`movementTokenFile`, `verifierTokenFile`, `verifierSocket` and `endpointFile` paths. It may
also include `source.workspaceID`, `timeoutMs`, and a
`nativeEnvironmentAllowlist` of environment variable names required by the
selected provider. The configuration and credential files and database must be
private; the verifier socket and endpoint file must have private parents. The
owner creates the endpoint file exclusively with mode 0600 and writes the local
server URL and password there, not to standard output. It removes its own file
on shutdown, but does not overwrite an existing file or delete a replacement.
The native child
inherits only its base runtime configuration and explicitly allowed variable
names, never the broker or verifier credentials as environment variables.
Its normal OpenCode configuration must load the Turnlink plugin with matching
broker and credential settings.

This command remains alive to own the reopened server until stopped; it is an
explicit recovery entry point, not automatic discovery or a complete migration
orchestrator. Reopening an already verified release does not send a new release
request. Disconnect, membership removal or abort, as well as closure of the
native recovery channel, unregisters the owner and closes its active verifier
sockets. The
socket and secret authenticate the configured local process, not mutually
hostile processes under the same user. Socket closure can be observed after a
remote failure, so this lease is not an atomic cross-process liveness proof.
For isolated OpenCode source-loss recovery, the broker additionally accepts
`AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_SOCKET` and
`AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_TOKEN_FILE`, with a private socket
directory and a separate private token distinct from the host, administrator,
adapter, completion and cancellation tokens. The trusted native recovery
owner must explicitly start and register with the source-recovery verifier;
the broker does not discover or start it. The explicit
`turnlink-opencode-source-recovery-owner --config /absolute/private.json`
starts a quarantined native owner, resumes the held receiver, claims or
reconciles its recovery journal, registers the verifier and stages the destination.
Its private JSON requires `version: 1`, `hostId`, the exact prepared or
uncertain broker `grant`, `mode` (`live` if the original source detached, or
`successor` if the recovery owner must detach), absolute `runtime`, `entrypoint`,
`database`, `source.directory`, `credentialDirectory`, `liveJournalDirectory`,
`recoveryJournalDirectory`, `detachmentJournalDirectory`,
`destinationJournalDirectory`, `hostTokenFile`, `adapterTokenFile`,
`movementTokenFile`, `verifierTokenFile` and `verifierSocket` paths. Optional
`source.workspaceID`, `nativeEnvironmentAllowlist`, and `timeoutMs` have the
same meaning as for the completion owner. The four credentials must differ.
By default the process stays alive after reporting `staged`. To explicitly
continue through placement, broker settlement, native completion and verified
receiver release, add `finish: true` and absolute `completionVerifierTokenFile`,
`completionVerifierSocket`, and `endpointFile` paths. The completion verifier
token must differ from the other four credentials and match the broker's
completion-verifier configuration. The endpoint is an exclusively created
private file removed on normal shutdown. The process reports `released` and
stays alive after the complete path. In finish mode an optional `brokerUrl`
lets the owner read the current grant without taking over the receiver. It
accepts a moved grant only when its identity and receipt match the owner's
durable commit and settlement records. It can then recover a recorded native
completion or an already verified release. Without `brokerUrl`, the operator
must provide the current grant. Starting the recovery owner remains explicit.
For a placement attempt with no receipt, a successor retries only after claiming
a different native storage lease and checking the exact held receiver. Attempt
leases are recorded before dispatch; a record from an older version without a
lease stays uncertain. This depends on the native exclusive lock and atomic
placement/receipt transaction, and does not prove cleanup of remote resources.
Its programmatic API returns the live recovery and receiver handles for an
explicitly trusted caller.
The broker retains its authenticated
socket lease through the source-detachment acknowledgement. Disconnect,
membership removal, abort or native recovery closure revoke that registration.
As with completion, this is not an atomic cross-process liveness proof.
Automatic discovery and recovery from every interruption, Codex completion
and full Gate 2 acceptance remain unfinished.

The broker's global request-bucket rejection is reported as
`BROKER_RATE_LIMITED_BEFORE_DISPATCH`, indicating that the request handler was
not entered. The OpenCode movement candidate retries that specific rejection
with bounded backoff while rechecking its exact owner and receiver. Other
errors, including lost replies, retain their existing recovery requirements.
Older clients that only recognize the former error text will fail the request
instead of automatically retrying it.

For an isolated source-preparation test, sending `SIGUSR2` to the exact source
proxy PID after it reports `destination resources retained; movement authority
pending` requests a controlled local stop. It disposes the retained step, cleans
up the provider, and shuts down the tracked MCP runtime under their existing
authorizations. If a movement grant has already been bound, the stop path first
requires the protected verifier and reconciles the exact cancellation with the
broker; a lost native reply is observed without repeating the cancellation. The
proxy keeps the MCP broker hold and native admission fenced because tracked
shutdown alone does not prove physical or remote cleanup. The signal is refused
before the owners are retained. The source driver still cannot create a genuine
movement grant or release the session.

The source driver requires the destination to be a distinct Git worktree root
sharing the source repository's actual common Git directory. It rechecks that
identity before resource dispatch and destination-step preparation. These
observations include the Git directory identities and worktree link/backlink
files, so rewriting and restoring a link is detected. They do not lock all Git
metadata or establish destination authority.

Use the local operator credential through the CLI, never through model tools or browser JavaScript:

```sh
npm run control-admin -- command '{"op":"channel.configure","channel":"development"}'
npm run control-admin -- enroll-adapter local /absolute/private/adapter.token
npm run control-admin -- query development channel
```

`local` is the default host ID; substitute the enrolled host ID for a remote host. The credential file must be new and its parent must be a private directory. Enrollment generates a separate credential and stores only its hash at the broker. If enrollment fails after file creation, the protected file remains for operator inspection. Revoke with `npm run control-admin -- revoke-adapter local`. Keep the command UUID printed by the CLI for retries after a lost response; supply the same `id` in the retried JSON.

In the existing OpenCode plugin options, add `control: true` and `adapterTokenFile: "/absolute/private/adapter.token"`, retaining all existing options. This exposes the two participant tools and enables native role delivery/30-second adapter maintenance. Offer and task-review notices may wake an idle conversation; active/ended notices use non-resuming steering. The maintenance loop does not ask participants to poll or send heartbeat replies. Native permission/question/form blockers remain respected.

MCP exposes the participant tools only with `--control-plane`. For Codex, retain existing MCP configuration and append that flag to its Turnlink MCP arguments. On the **proxy process**, set `AGENT_CHANNEL_CONTROL=1` and `AGENT_CHANNEL_ADAPTER_TOKEN_FILE=/absolute/private/adapter.token`. The proxy does not forward the adapter credential-file variable to its Codex child/MCP processes. Do not supply this credential through tool arguments or the model environment.

Codex role offers use `turn/start` when lifecycle is known idle, or `turn/steer` with the exact active turn ID. Active/ended notices only steer a running turn; idle delivery is deferred. Existing approval requests block admission. Resumed threads whose lifecycle cannot be established are held until a native turn response/event establishes it. No instructions, cwd, agent/model, sandbox or approval parameters are overridden by role admission. Uncertain admissions are held for native receipt reconciliation/operator inspection, never blindly replayed after a timeout or restart. Governance alone dispatches no task or worktree effects; the separate task gate below is required for task execution. IDE and production acceptance remain pending.

### Optional broker-local effects gate

For isolated verification only, start with **both** `AGENT_CHANNEL_CONTROL=1` and `AGENT_CHANNEL_CONTROL_EFFECTS=1`. The latter requires the former and is disabled by default. The scheduler executes authorized `pause_delivery`, `resume_delivery`, `cancel_queued`, `retry_delivery`, `change_wake_policy` and `remove_member` actions. Human approval is still required by channel policy (including cancellation in default safe mode); tools cannot invoke the scheduler or reconciliation commands.

- Pause prevents future broker pushes. It does not cancel a native turn or retract input already offered. It survives restart and is cleared when that membership is removed.
- Resume permits future broker delivery; it does not replay already-offered native input on its own. Persisted pauses remain enforced even if effects are disabled later; reenable this gate to authorize a resume.
- Cancellation requires a message ID, exact channel/recipient match, and broker-persisted proof that the message has **never been offered** to that recipient. Adapter/model assertions and human approval do not override offered/admitted/legacy-unknown state.
- New messages retain private exposure metadata, persisted before any WebSocket push. Failure between recording exposure and sending is conservatively treated as possibly offered. Old messages without exposure metadata are unknown, never cancellation candidates. Push frames omit this metadata for existing-client compatibility.

Before the local effect, SQLite commits `executing` state, audit and an immutable intent together. The executor then rechecks accepted role, lease/generation, policy, approval and membership without an asynchronous gap before the broker's single-writer JSON commit. That snapshot contains both the effect and its receipt. SQLite reconciliation is a subsequent transaction, **not cross-store atomicity**. After restart, a matching broker receipt settles the recorded outcome without repeating the effect, even if authority has since expired. An unapplied intent is revalidated; changed authority/policy causes a failed settlement rather than execution. Existing historical `executing` records without an outbox intent are never inferred to be executable.

Temporary receiver disconnection holds an unapplied intent while membership and authority remain valid; it neither executes nor infers revocation. Reconnection permits revalidation, and lease expiry prevents execution. This also handles the initially socket-free broker restart.

Retry schedules exact evidence-bound recovery; native admission is recorded separately through the authenticated receiver bridge. Wake policies affect subsequent adapter admission, and membership removal ends roles before deleting membership. See [recovery acceptance](control-recovery.md) for crash/restart and approval boundaries. This gate grants no native permission approval, task execution or worktree movement.

### Optional OpenCode existing-cwd task gate

For isolated verification only, enable broker `AGENT_CHANNEL_CONTROL=1 AGENT_CHANNEL_TASKS=1` and add `tasks: true` to the existing OpenCode plugin options above. Both sides must opt in; separate enrolled adapter credentials and the exact subscribed receiver remain required. Codex task execution is not enabled by this flag.

Create a task with `requiresWorktree: false`; the participant explicitly calls `task.claim`. Dependency, schedule/missed-decision and capacity checks run at broker preparation. A passive broker watch signals due/changed tasks without asking a model to poll. Claimed authorized work may continue without a master, but remains in review until a current master explicitly accepts it. A newly accepted master receives pending stopped/report-backed reviews.

The current master can use `channel_manual_preview` with a claimed task and a destination to create a manual-resume preview from the claimant's registered source directory. The operator must approve that preview. Its digest identifies the requested task and paths; it is not a digest or verification of the runtime's effective configuration. A manual preview cannot be used as an automatic native movement grant.

Gate 2 is closed for the operator-approved manual-resume scope described here. The operator must confirm that the source stopped and check pending external and background work; the agent's comparison does not independently prove the destination's loaded instructions, tools or policies. Original automatic native handoff and exclusion guarantees remain unproven or incomplete; see the [Gate 2 checkpoint](control-plane-roadmap.md#gate-2-operator-approved-manual-scope--2026-11-08).

The approved destination is compared as an exact string, including Windows drive-letter casing and separators. When using a Windows destination, ask an agent on that host for the destination runtime's actual project path and use that exact value in the preview; do not assume that slash, case or path aliases will be rewritten. A different spelling is refused even if the operating system might resolve it to the same place. New manual previews refuse drive-dependent paths such as `\project` and incomplete UNC paths such as `\\server`; use a fully qualified drive path or a UNC path including its share. Previously committed command receipts remain replayable.

For an approved worktree preview, the current master can use `channel_prepare_session` to ask the claimant to prepare a private session record before a manual move, and `channel_verify_session` to ask it to compare that record after resuming. Both tools take `taskID`, `previewID`, and a caller-supplied `messageId` for message retry; they require the latest approved preview for the current claim. These are ordinary messages to the claimant. The agent supplies the record and is asked to send it to the master with `channel_send`; Turnlink checks the current task, preview and registered source and writes an exact private copy under the source credential directory before forwarding it. A successful send reports `privateRecordSaved: true`. Concurrent updates for the same task/preview through one ToolSession are serialized; a failed private write is not forwarded. The source copy is local and is not automatically transferred. The resumed session can retrieve the sent record through channel history. The broker and master can read that message; the record must not include credentials or information the agent cannot share there. The agent must report unknowns rather than guess. These tools do not themselves move the session, guarantee history retention, transfer the receiver, independently verify the agent's observations, or authorize execution.

The source copy remains in the credential directory until the operator removes it; Turnlink does not automatically sanitize or delete it. It is not the broker's authorization record. If sending fails or its outcome is uncertain, do not treat the local file alone as proof of delivery: recover through the broker and wait for the coordinator's confirmation. For an accepted message still visible in the current channel history, a conflicting retry is rejected before replacing the copy, and replaying an older message does not roll it back. Retrying the latest exact record after a lost reply restores the copy if necessary and confirms it again. This check is not an exclusion mechanism for another process.

With the OpenCode control adapter, the agent can call `channel_session_context` to observe the hosting runtime version, its selected agent and model and a fingerprint of the native agent/session permission rules. The fingerprint avoids sharing those rules in clear text; it does not observe operating-system access or remote policy. If the selected agent or version is unavailable, the tool reports unknown rather than inferring it. The broker checks the current master generation when it accepts preparation, correction, confirmation and comparison messages. Upgrade the broker before adapters using this generation-bound send; older strict protocol implementations will reject the added field.

An adapter-health snapshot is fresh only for the receiver connection that submitted it. A disconnect, unsubscribe, receiver replacement or broker restart makes the earlier snapshot stale until the active receiver reports again. Historical snapshot contents can still be shown for diagnostics; they are not native ownership or stop evidence.

With `AGENT_CHANNEL_HEALTH=1`, `AGENT_CHANNEL_CONTROL=1` and an enrolled adapter credential file, the Codex proxy can include a stable three-part version observed in its app-server's correlated `initialize` response. The agent can request `channel_status` with `view="health"` and use its own connected, fresh entry's `report.nativeVersion` in a session record. An absent, malformed, uncorrelated or prerelease version remains unknown. This is a report from the running app-server, not independent binary verification or proof that other writers are excluded; health remains opt-in.

Session preparation uses `turnlink.session_record.v2` and comparison uses `turnlink.session_report.v2`. The record and report include the observed source and destination runtime names and exact versions; the product must match the session's harness, and the broker checks a reported match. It ignores product-name capitalization and an optional `v` before the version, but not differences in the version or prerelease identifier. An unknown runtime cannot arm a manual stop, and a different or unknown destination version cannot authorize dispatch. This is a conservative exact-version rule and an agent observation, not proof that two installations have equivalent settings or that files are compatible. The broker rejects older v1 records because they do not contain a runtime baseline. Upgrade both broker and adapters before starting a new move; an in-flight v1 manual move will be held and needs recovery rather than silently using incomplete evidence. Returning to the original source and using `manual-resume-reset` can restart preparation where its documented conditions hold; recovery after a completed host transfer remains unresolved.

`channel_session_status` reads the latest structured reply to the current master's comparison request and checks that its message references the claimant's latest matching baseline, the approved task and preview, and that request. It returns `awaiting_request`, `awaiting_record`, `awaiting_report`, `invalid_record`, `invalid_report`, `incomplete`, `differences`, `baseline_unavailable`, or `reported_match`. For manual moves, a reported match is also checked against the broker's original baseline: altered contents are `invalid_record`, and an unavailable baseline or unsupported broker is `baseline_unavailable`. All of these are agent-reported observations, not native verification or permission to dispatch; a missing baseline cannot be reported as a match.

The status and operator review include the source and destination runtime strings supplied by the agent. If a report claims a runtime match but the normalized values differ, the status is `invalid_report` with reason `runtime_values_do_not_match`; the task remains held.

Starting preparation durably binds the current master as coordinator on the approved preview. For that preview the broker holds task dispatch unless the latest bound agent report is `reported_match`; missing messages, unknowns and differences hold the task. A later current master can take over the coordinator role, which requires a fresh report to that master. This requirement was added in control schema 35; the current schema is 36. Older binaries cannot safely read newer control state.

After `channel_prepare_session`, the coordinating ToolSession waits for the claimant's matching record. For manual previews it asks the broker to record the active source receiver before telling the claimant the manual stop can proceed. The broker records a subsequent disconnection of that receiver, and the coordinator requests comparison when the claimant registers the approved destination. These are observations of the broker connection: they do not prove the native process stopped or that another writer cannot exist. An interruption of the broker while observation is armed is recorded as uncertain; a source receiver must reconnect at the original location and send a fresh record before the observation can be rearmed. A newer malformed record invalidates the older one, and the coordinator asks the agent to correct it. When the coordinator rejoins with control enabled, it reconstructs pending watches from retained channel messages and current approved previews. It does not recreate a watch if comparison was already requested. Recovery depends on retained history, current master access, and a successful broker connection; failed recovery is visible in the session status and retried on reconnection. The automatic request is idempotent while the broker retains the original message.

If the destination observation receives an explicit `MANUAL_RESUME_UNAVAILABLE` response, the watch retries that read with bounded backoff before sending a comparison request. It does not automatically retry an ambiguous comparison send. A continuing failure remains visible as requiring recovery; a successful retry does not prove that every missed-comparison incident has the same cause.

The operator can inspect the exact task, destination, receiver and report using `control-admin manual-resume-review <channel> <taskID> <previewID>`. The admin-only review includes `sourceRecord`, the exact agent-provided record used as the baseline (or null if unavailable); the agent is instructed to sanitize it, including its work summary and any reported outstanding actions. It is an agent report, not an independent resource inventory. The CLI adds an informational `guidance` field for the next step; this is not an authorization and the broker still checks the live state. To avoid transcribing IDs when there is exactly one reviewable claimed manual move in a channel, use `control-admin manual-resume-select <channel> <absolute-private-file> [member-name]`; this creates a new file without overwriting one and prints the current review. `manual-resume-review-selected <file>` refreshes the review, `manual-resume-authorize-selected <file> <targetHostId> [transferID]` authorizes the target, and `manual-resume-confirm-selected <file> [receiptID]` confirms the stop. `manual-resume-cancel-selected <file>` cancels the recorded host transfer, and `manual-resume-reset-selected <file>` retires the selected preview when the broker permits reset. The selection file contains only the channel and exact task/preview IDs, is not a grant, and is bound to that preview; broker checks still apply at each action. The file must be under a private directory. If multiple reviewable moves exist, selection fails rather than choosing one. Retry with the exact channel member name; if that still leaves multiple moves, use the explicit-ID commands after identifying the intended move.

For a different pre-enrolled host, after personally stopping the original session, run `control-admin manual-resume-authorize-host <channel> <taskID> <previewID> <targetHostId> [transferID]` or the selected-file equivalent. This attests that the source was stopped and permits only that host to register the same session identity at the approved destination using a fresh local proof. The broker refuses the transfer while a source-offered message remains unacknowledged. The command does not copy the native conversation or work; the operator must make the original session and saved work available to the destination. The old host cannot use the session identity while transfer is pending or after it completes. Before the destination joins, `control-admin manual-resume-cancel-host <channel> <taskID> <previewID> <transferID>` cancels the authorization and makes the source observation uncertain. Reconnecting the original source and sending a fresh record is then required. Authorization and cancellation retries with the same transfer ID are idempotent; a completed transfer cannot be cancelled this way.

After a cancellation, a new authorization uses a new transfer ID. The broker retains up to 32 earlier cancelled IDs for the same observation and rejects their reuse, so a delayed cancellation cannot cancel a later transfer. If the limit prevents a new authorization, the review reports `hostTransferAttemptsExhausted` and guides the operator to reconnect the source and reset the preview before creating and approving another. This adds an optional field to the broker's strict stored observation; an older binary cannot read state containing the field, so use a compatible broker when restarting or restoring that state.

After the destination joins, its session proof is the broker's ownership key. If that file is lost or incomplete, a newly generated proof is refused; the tested recovery restores the original destination proof from a trusted backup. The old host cannot reclaim the identity as a substitute. Treat an unavailable proof as a held move until it can be recovered.

For stock Codex 0.165.0, a local synthetic test found that changing destination `AGENTS.md` after `thread/resume` did not update the instructions used by the next turn; restarting the process and resuming the same thread loaded the changed file. If destination instructions change after the session starts, do not treat a file comparison as proof of what the running session loaded. Stop and resume the destination and request a fresh comparison before confirmation. This is an operational mitigation, not an automatic guarantee that configuration cannot change again.

If the original coordinator cannot return, the operator can restart preparation from the original source. Cancel any pending host transfer, reconnect the original session and receiver at the original source path, and run `control-admin manual-resume-reset <channel> <taskID> <previewID>`. The broker retires that observation and preview; the new current coordinator must create a new manual preview, obtain approval and request a fresh record. An old preview cannot be rearmed. Reset is refused while the source is disconnected, after a host transfer completes, or after confirmation. It does not recover an already moved destination session or establish that other writers are stopped.

For a completed host transfer, `manual-resume-takeover-selected <file>` uses the selected task and preview and looks up the channel's current active coordinator; it does not require the operator to copy those IDs. The claimant must first forward the original record to that coordinator as described below. When an exact takeover intent is already pending, the command instead recovers that intent, including after restart when its coordinator is offline; the broker decides whether it was committed and can be reconciled. `manual-resume-takeover-cancel-selected <file>` acts only on an exact pending intent, and the broker rejects cancellation after control commit. Starting a new takeover still requires an active coordinator. The broker still verifies the records and state; the selection file is not authority.

These selected takeover commands require a broker that supports the coordinator-less lookup in `control_manual_resume_takeover_prepare`; upgrade the broker and CLI together. Older brokers reject that request rather than providing this recovery path.

For an unconfirmed move whose host transfer has completed, the new current coordinator can call `channel_request_session_takeover` to ask the resumed agent to forward its original sanitized record unchanged. After that message arrives, the operator can run `control-admin manual-resume-takeover <channel> <taskID> <previewID> <newCoordinator>`. The broker requires an exact copy of the original record, an accepted current coordinator and the connected claimant at the destination; it records the takeover without authorizing the task. The new coordinator must request a fresh comparison and the operator must still confirm the stop. The takeover intent and command receipt survive interruption: rerunning the command uses the same pending ID. If the control command was never committed, `control-admin manual-resume-takeover-cancel <channel> <taskID> <previewID> <takeoverID>` retires that attempt; a committed takeover cannot be cancelled and must be reconciled. This recovery remains dependent on retained original and copied record messages and does not establish native writer isolation.

Once a takeover has committed, reconciliation uses the exact record messages it bound, even if another record arrives before recovery. A later record with different content cannot authorize the task, even if its report says everything matches. The agent may resend the identical baseline and provide a new comparison; the broker retains the original baseline ID and separately records the ID used in the confirmed comparison. Both survive restart.

Once the resumed agent has compared the record, run `control-admin manual-resume-confirm <channel> <taskID> <previewID> [receiptID]` only if the original session was stopped. This records an operator attestation, not native proof; the broker checks the observed disconnection, connected destination and complete report before accepting it. Exact receipt retries are idempotent. A manually resumed task may then run using a distinct manual receipt; it does not manufacture a native movement or receiver-handoff record. Start an isolated manual-only broker with `AGENT_CHANNEL_CONTROL=1`, `AGENT_CHANNEL_WORKTREE_GRANTS=1`, `AGENT_CHANNEL_TASKS=1`, `AGENT_CHANNEL_WORKTREE_TASKS=1`, and `AGENT_CHANNEL_MANUAL_WORKTREE_ONLY=1`; set `AGENT_CHANNEL_CODEX_TASKS=1` when Codex dispatch is required. Opt the Codex proxy in with `AGENT_CHANNEL_CODEX_WORKTREE_TASKS=1`, or enable `tasks` and `worktreeTasks` in the OpenCode adapter options. This mode does not enable native receiver handoff. After a task is completed with stop evidence, the next manual observation preserves its prior receipt in bounded broker history; a full history prevents a new observation rather than silently discarding receipts.

The adapter observes native blockers/idle lifecycle and retains the existing session, cwd, selected agent/model and permissions. It snapshots those native selections and the tool catalogue into a scope digest; drift holds the attempt uncertain, not silently reauthorized. This is an existing-cwd consistency check, **not destination effective-authority resolution or a native exclusion lock**. Concurrent external native activity remains subject to OpenCode's queue semantics; no destination plugins are loaded and arbitrary moves still detach membership.

Before native admission, the adapter persists an attempt-bound deterministic message ID and task binding under an exclusive private journal lock. Recovery uses that same native idempotency key, never a fresh execution prompt. Lost responses retain uncertainty and exact admission evidence; scope changes, missing journals for an already-admitted attempt, corrupt records and full journals fail closed. The journal holds at most 256 attempts and requires future operator archival rather than silently discarding receipts.

Native assistant activity supplies started/progress observations. After native idle, the adapter records a session segment reference, digest and finish reason, plus stop evidence; raw transcript/output is not uploaded to the broker or journal. These references are not correctness certification. A supplemental result notice asks the participant for an actual `task.report`; a separate master notice requests `task.review`. The master can inspect scoped `evidence` alongside tasks. Acceptance must still evaluate criteria and the reported result. This gate does not provide worktree isolation, managed cleanup, comprehensive telemetry or production/IDE/live-model acceptance.

### Optional Codex existing-cwd task gate

On an isolated broker only, set `AGENT_CHANNEL_CONTROL=1`, `AGENT_CHANNEL_TASKS=1` and **separately** `AGENT_CHANNEL_CODEX_TASKS=1`. The last flag requires the first two. On the stdio proxy process, retain the existing enrolled adapter token-file configuration and set `AGENT_CHANNEL_CONTROL=1 AGENT_CHANNEL_CODEX_TASKS=1`. Both broker and proxy must opt in; an ordinary OpenCode task-enabled broker still rejects Codex task pulls. WebSocket/Unix app-server transports are not covered. No user installation or running broker is reconfigured by this code.

Only explicitly non-worktree claimed tasks may start. The proxy uses the existing thread and sends only `threadId` and `input` to `turn/start`; it does not override cwd, model, instructions, sandbox or approvals. Native start/resume selections, native `thread/read`/`config/read` observations, known idle lifecycle and process mutation revisions guard admission. Concurrent native mutations defer admission. Unknown thread mutations or explicit per-turn overrides invalidate cached selection until native re-observation. This is an existing-cwd check, not complete destination-authority resolution or a worktree exclusion grant.

The private journal persists invocation **before** the RPC. Neither the JSON-RPC request ID nor the task marker is claimed as a Codex-native idempotency key. Lost native responses are never resent. Recovery needs the exact native turn/user-input marker, matching thread/task/attempt, unchanged native scope and terminal turn status before stop evidence. Missing/corrupt/full journals fail closed. An unresolved invocation with no matching turn remains uncertain; a disconnect, thread close or archive does not prove a stop. Journals hold at most 256 attempts pending operator archival.

Evidence contains only a native thread/turn reference, admission binding, digest and finish status; raw native results/configuration do not enter broker evidence or the journal. Actual native observations produce bounded progress records. After stop evidence, a separately journaled report notice asks the participant for `task.report`; an uncertain notice is not replayed, and the participant still must submit a report. A master must explicitly accept its evidence. Human interruption is forwarded immediately and records an interrupted stop without automatically waking a report turn. Native approval/elicitation responses pass unchanged; the adapter never supplies a decision.

The isolated real Codex fixture verifies native model → harness-bound MCP voluntary claim → proxy execution → artifact/stop evidence → native model/MCP report → explicit native model/MCP master acceptance. Its test operator explicitly answers only its known local fixture MCP consent request. Process fixtures verify lost-response recovery across actual proxy/native-process restart, private internal RPC responses, approval blocking and human stop behavior. These checks do not establish Windows/IDE/live-model/production acceptance or enable managed worktree movement.

### Worktree preparation subgate (internal verification only)

The `createBroker({ worktreeGrants: true, controlPlane: true })` option enables receiver-authenticated `worktree.begin` and `worktree.settle` records. The broker CLI can opt in with `AGENT_CHANNEL_CONTROL=1` and `AGENT_CHANNEL_WORKTREE_GRANTS=1`; this does not start a movement executor. Default brokers reject these operations, even from enrolled adapters. Model and operator tools cannot issue them. `channel_status` / operator queries can inspect channel-scoped `previews` and `transitions`; ordinary participants see only their own records.

An opt-in [local Codex cancellation verifier transport](codex-cancellation-verifier.md) can connect separately hosted broker and native-owner processes for an exact cancellation settlement. The broker CLI and source proxy support explicit socket and private-token configuration. It depends on a separately protected shared secret and live native owner, and does not enable destination movement or prove a lease across broker commit.

New executable previews require a bounded manifest: harness/project identity, source/destination effective-authority digests, and configuration/instruction source paths plus content hashes. No raw configuration, credentials or instruction contents are sent to the broker. The grant checks the exact approved latest preview, claimant/claim generation, fresh capability/idle evidence, equal authority digests, and conversation capacity. A legacy path/digest-only preview cannot obtain a grant. Every granted preview is one-use, including a definitively failed transition; retry requires a fresh preview and approval.

The internal coordinator requires **trusted native ports**, not caller/model-supplied snapshots. Ports must discover complete applicable configuration/instructions and compare effective permissions, sandbox/approval policy, selected agent/model and tools, including path-dependent rules; equal hashes of an incomplete session record are not sufficient. Ports must supply a verified native exclusion boundary covering competing admissions and native work. They are **not implemented in the production adapters yet**, so passing fake fixture ports is not operational acceptance.

A separate default-off [managed Git lifecycle host primitive](worktree-lifecycle.md)
implements pinned-revision creation, separately approved clean-only removal and
observational crash recovery. Its internal broker/host bridge now durably
reconciles exact publication/begin/receipt outboxes across lost replies and host/
broker restart, with fresh pre-effect broker checks. Real-Git/process tests do not
supply production native exclusion/use-safety ports or adapter installation, nor
enable either worktree capability flag.

The coordinator journals grant admission before requesting it, records native invocation before calling it, revalidates after grant acquisition, and verifies destination identity/configuration/authority after the effect. A per-conversation filesystem writer lock prevents stale coordinator instances from overwriting unresolved evidence. Lost grant/receipt responses retain exact IDs for reconciliation. Recovery never invokes native movement: a verified destination can settle movement; a journal proving native invocation never began can settle failure; other observations stay uncertain. Unchanged uncertainty does not produce repeated notices/receipts. Prepared/uncertain transitions block task release, reassignment and dispatch. A moved receipt is neither task execution/completion nor a membership-handoff capability.

Real OpenCode/Codex fixture gates still prove only their native same-conversation move/cwd capabilities and instruction/permission retention. The OpenCode gate additionally proves arbitrary moves detach and messages do not automatically follow. Approved broker grant → native effect → destination receiver rebind remains a future end-to-end gate. Until it passes, live worktree movement remains disabled and the existing OpenCode move-detachment policy is unchanged.

### Native snapshot observation gate

The source collectors use adapter-bound native API/RPC callbacks and refuse missing identity, model resolution, instruction/configuration evidence or activity observations. An absent OpenCode session model override is resolved through a native model API, never by inventing a default. Object-map keys are normalized for hashes; arrays, ordered permission rules and instruction entries retain their order. Collection rechecks conversation selection and activity revision; the paired reader repeats native collection and rechecks every filesystem guard before returning.

The offline inventory verifies common Git-repository identity and a canonical destination worktree root using read-only Git queries. It parses JSON/JSONC or TOML, inventories missing files and definition directories, captures OpenCode ancestor direct/`.opencode` layers and global/project guidance, and represents Codex `AGENTS.override.md` priority. Source/destination configuration differences and path-dependent rules are surfaced, not automatically approved. Default budgets are 1 MiB per file, 8 MiB total source bytes and 512 records. Symlinks, non-regular/hard-linked files, malformed/non-JSON-compatible configuration, encoding failures and discovery races fail closed. It never imports a destination plugin, starts a destination harness/configured command, resolves a credential or fetches instruction URLs.

Reports contain only source paths/presence flags, hashes and enumerated unresolved requirements. Raw configuration, instructions, provider headers, native tool text and exception bodies are not returned. Remote/glob instructions, substitutions, custom provider code, directory definitions, managed preferences, runtime overrides, Codex project trust/requirements and unknown configuration fields require additional native resolution. This inventory is deliberately conservative, not a complete implementation of either harness's discovery/evaluation semantics.

Every report explicitly has `destinationMode: 'offline'` and `executionEligible: false`, including static profiles whose projected hashes match. Effective destination authority, native admission exclusion and destination rebind remain unverified. There is no production tool or broker activation switch for these readers. The real-service tests use isolated completed turns and actual native configuration/model/permission/tool/instruction observations; their fixture activity callbacks are **not** production admission locks.

### Codex stdio admission fence subgate

The fence controls one stdio proxy process, not every Codex process or a server-wide/native filesystem lock. Normal unfenced forwarding is unchanged. WebSocket/Unix-listener invocations (including `--listen=...`) stay outside this path. Models, editor RPC arguments and broker tools cannot acquire an owner: the capability is a non-serializable in-process object scoped to one existing thread.

Acquisition requires every known proxy thread to have known idle lifecycle, no observed active native turn (including child/other-thread turns), no pending mutation or native server request, no approval blocker and no in-flight adapter flush. Closing/archiving a thread does not substitute for completion evidence. During ownership the proxy holds editor mutations in FIFO order and prevents peer/role admissions. Only a small audited read allowlist bypasses the hold; unknown methods, account/authentication changes and `thread/resume` are conservatively treated as mutations. Owner mutations are restricted to start/steer/interrupt on its exact thread and turn IDs, never approval responses or configuration changes. Start events correlate to the owning RPC's returned turn ID, including notification-before-response ordering. Outstanding native RPCs, expected start notifications and active turns must settle before release, and the final lifecycle must be known idle and unblocked.

Actual editor approval/question responses continue to native Codex unchanged. Human `turn/interrupt` is never delayed: it invalidates ownership for the affected thread and rejects its held starts/steers so cancelled work cannot later start. The fence does not answer prompts, change sandbox/approval policy, modify instructions or switch models/agents. Default holds are bounded to 128 entries / 256 KiB with a 30-second ownership timeout. Queue overflow returns generic correlated errors without echoing request contents. Callback failure or timeout after a native mutation quarantines the fence: queued work does not drain automatically. Unexpected native starts invalidate ownership rather than pretending out-of-band/native child activity was excluded.

The real Codex fixture exercises owner-scoped `turn/start.cwd`, start/completion receipts and a held competing `thread/resume`; the fixture has no broker peer/role admissions during this phase. Live stdio fixtures also verify cancellation, approvals, FIFO release, forged/stale owners and response-loss quarantine. These are primitive-level gates, not an approved broker transition's end-to-end acceptance. Production owner RPC/receipt wiring, durable quarantine recovery, destination authority and receiver continuity are still required. Restart must reconcile transition journals before admitting new managed work; it is not evidence that a native effect never happened. OpenCode still has no proven native exclusion/rebind implementation, so all live worktree execution remains disabled.

## Agreed behavior

One human operator, existing broker host, React + Mantine dashboard, all Turnlink activity visible to the operator, and one optional master per channel. Full operational support targets OpenCode and Codex; Claude task execution is deferred. Observability must work without any master.

### Master

- Volunteer candidates, elections enabled by default, one ballot per eligible connected participant.
- Freeze electorate/candidates at election start; require an absolute majority of the electorate, not just responding voters. Self-votes count. Ballots cannot be recast.
- Election deadline: 60 seconds. No majority means no master and an audited inconclusive result; human resolution follows.
- Operator appointments supersede elections. An old master remains active until the replacement accepts its exact proposal/prompt version. Acceptance transfers authority atomically.
- Proposal timeout: 120 seconds. Master lease: 120 seconds; planned adapter renewal interval: 30 seconds. Lease renewal is adapter-owned, not a model tool. Reopening the database never extends a lease.
- Every proposal gets a new generation. Stale generations cannot request/execute privileged actions. Loss of channel membership ends authority; a temporary receiver disconnect blocks actions while its lease runs down.
- Full channel message visibility is checked against current assignment/lease, generation, membership and accepted role notice. Inspections are audited. Existing participant history visibility remains unchanged outside that capability.
- The master role is supplemental. It must never replace the project/global instructions, participant role label, selected harness agent/model, tools, or existing project permissions. Deactivation notices cannot be relied upon for security: the broker must enforce revocation even if the old agent never sees the notice.

### Three operational modes

Only the human operator changes channel mode. Default: `safe`. Modes control recovery/admin actions, **not normal dispatch of participant-claimed, authorized tasks**.

| Operation | `automatic` | `safe` | `approval` |
| --- | --- | --- | --- |
| Known-unadmitted or native-idempotent retry | Automatic | Automatic | Human approval |
| Pause/resume Turnlink delivery | Automatic | Automatic | Human approval |
| Supported wake-policy change | Automatic | Automatic | Human approval |
| Cancel unadmitted queued work | Automatic | Human approval | Human approval |
| Remove Turnlink membership | Automatic | Human approval | Human approval |
| Ambiguous retry without sufficient evidence | Blocked | Blocked | Blocked |

Human approval does not substitute for evidence or override harness permissions. A model cannot assert `known_unadmitted` and thereby authorize replay: recovery references must resolve to matching, adapter-originated evidence for the target/message. New uncertainty invalidates an older reference. Policy revisions are checked again before execution; changing mode invalidates previously granted action authorization.

The future executor must recheck current authority immediately before its external effect, and use durable action IDs/admission keys. If a side effect may already have happened, record uncertainty rather than retry blindly. Actions already started cannot be undone by revoking a lease.

### Tasks and scheduling

- Operator or active master creates tasks with instructions, acceptance criteria, priority, dependencies and optional schedule/deadline.
- Participants explicitly claim tasks; the master cannot claim on another participant's behalf. Multiple future claims may queue, but only one active execution is allowed in the existing conversation.
- Ready-task ordering is priority descending, then creation time and task ID. Dependencies must be completed before dispatch.
- The scheduler may continue previously claimed, authorized work without a master. Creation by a master and final master review still require current authority.
- Dispatch needs connected membership, fresh adapter idle evidence (10-second maximum age), verified capability evidence and available channel/conversation capacity. Native unrelated work must be respected by the eventual executor too.
- Schedules explicitly choose `ask`, `skip` or `run_late`. Default `ask`; a configurable five-second scheduler grace avoids treating ordinary timing jitter as missed execution. After grace, `ask` needs a human decision. Deadline/progress expiry opens an incident, not permission to duplicate execution.
- Admission is separate from execution start and completion. Reports reference adapter-recorded artifact evidence. Review requires a stopped-execution receipt; a participant's report alone does not free a potentially running conversation.
- Completion means a master's acceptance of evidence, **not independent proof of correctness**.
- Reassignment requires broker-known non-start, an unadmitted receipt, or matching stop evidence. A disconnect is not stop evidence. Attempt counters fence late callbacks after reassignment.
- Dashboard reassignment and missed-schedule confirmations additionally bind a canonical full-task digest, checked with the channel precondition inside the broker transaction. A changed claimant/attempt cannot be released by an older human preview. Exact committed command retries return the original receipt without affecting a later claim. This comparison is not authenticated native ownership, global resource census or an ABA-proof generation. Fresh task uncertainty revokes the usable stop marker while retaining its historical evidence; it cannot authorize reassignment or free an occupied slot using that old marker.
- Fresh uncertainty is accepted during pending review too. The participant's report remains intact in `review`, but its usable stop marker is revoked: master acceptance and channel-slot reuse are held until a fresh matching stop receipt. Pending task-review notices are cancelled, not deleted or treated as prompt retraction. New notices carry a structured task ID; legacy unbound review hints are conservatively cancelled rather than interpreted from prompt text. Fresh stop restores only review eligibility, never automatic acceptance or incident resolution.
- Late uncertainty after completed or dispatched-cancelled work records `terminalHold` without undoing completion/cancellation or deleting its historical report/stop evidence. The hold occupies broker capacity, blocks new same-conversation and dependent dispatch and managed workspace admission, pins monitoring retention and appears in passive attention/unresolved counts. Only a new matching adapter stop receipt clears this broker hold; old command replay cannot do so. Runners preserve journals without replay or retirement while held. This is not authenticated native ownership, observation freshness, physical resource release, complete late-callback reconciliation or cleanup approval. No task hold may be attached to never-dispatched cancellation as a claim on unrelated native work.
- Each newly committed terminal uncertainty advances `terminalHoldGeneration`. A terminal `task.stopped` receipt must include the generation captured for its observation as `holdGeneration`; a callback for an earlier hold cannot settle a later one even with a new evidence ID. Generation zero is legacy/unbound and cannot settle; the maximum safe-integer generation saturates in quarantine. Exact command retries do not advance/reset generations or clear a later hold. This fence applies to terminal broker ordering, not native ownership or genuine observation freshness. An observer must freeze the value before collecting its proof, never retag an older observation with the latest counter.
- Schema 12 adds an independent `stopGeneration` for active/review broker ordering. Every newly committed nonterminal `task.uncertain` advances it and revokes usable stop evidence while retaining reports. `task.stopped` must match it; missing/stale/future generations fail after the first advance, regardless of new command/evidence IDs. Generation zero retains pre-upgrade command compatibility (omitted or explicit zero); it is not a historical freshness claim. Exhaustion saturates in refusal, and prepare/reassign/review/settlement never reset the counter. Exact retries return their original receipt without restoring a revoked stop marker. Terminal holds still require their separate `holdGeneration`; the two counters are not interchangeable.
- Schema 13 extends the same generation match to `task.admission` (every outcome), `task.started` and `task.progress`. Callbacks from before explicit uncertainty cannot recover an exact admission, promote running state or refresh progress/deadline bookkeeping afterward. Missing/stale/future values refuse before any new evidence/event/receipt commits; exact committed retries retain their historical receipt without reapplying the transition. Matching the broker epoch preserves existing lifecycle requirements; it is not an admission/release attestation. Schema 14 additionally advances the counter for `task.admission` outcomes of `uncertain`, revoking earlier callbacks. Native admission/source observation epochs remain unproven.
- OpenCode/Codex runners freeze `stopGeneration` in the original dispatch journal and attach nonzero values to admission/start/progress/stop callbacks. A mismatch retains the journal and stops polling without native execution/report replay or relabeling cached observations. Zero-generation callbacks omit the field to preserve original command fingerprints and pre-upgrade lost-response retries. For their own lost-admission receipt only, both runners may durably capture the next observation generation before fresh native evidence collection, with unchanged dispatch binding and no cached execution proof. OpenCode retries its exact native admission ID; Codex observes its existing exact turn without resending start. Both recheck usable stop evidence after a successful/replayed stop receipt and again after native scope/snapshot reads before a deferred report wake. This does not make the subsequent native wake atomic with broker state or add an automatic stop re-observer. Other late callbacks, native observation/source epochs, authenticated ownership and physical release remain separate unproven boundaries.

### Worktrees in existing conversations

Worktrees are created on the participant host, never indiscriminately on the broker host. Task execution stays in the original conversation rather than spawning a new task conversation.

Before a transition, an adapter must produce a preview with source/destination locations, applicable configuration/instruction discovery and a digest. Human approval binds to that preview and task claim generation. A released/reclaimed task cannot reuse old preview approval. The future executor must revalidate the digest, idle state and actual capability before performing the transition; it may not weaken permissions or overwrite configuration. The current foundational preview record is a binding contract, not a complete configuration-diff implementation.

Cleanup must be explicit and refuse uncommitted changes unless the operator authorizes forced removal. Neither transition nor cleanup is executed by this foundation.

## Capability gate findings

Tested locally with OpenCode **2.0.28** and Codex CLI **0.161.0**:

- OpenCode: native worktree creation followed by `session.move` preserves the session ID, selected agent/model and exposed session permissions. The fixture's global and project instructions remain model-visible. This uses the foreground isolated service, not the managed user service.
- Codex: `thread/resume` with a changed `cwd` does **not** change an already-loaded thread in this version. The supported transition is **`turn/start.cwd`**. It preserves the thread ID/model/exposed sandbox and approval settings; destination instructions and the fixture's global/project instructions are visible to the local model.
- These are local API/model-fixture gates, not proof of official IDE presentation, live paid-model behavior, or all provider/sandbox combinations.
- The existing OpenCode adapter deliberately unsubscribes on `session.moved`. A future authorized task-transition path must retain/rebind the same session's channel/task identity without turning arbitrary location moves into automatic membership handoff.
- The Codex proxy must keep control-plane RPC responses out of the editor RPC namespace, preserve approvals and forward turn/thread notifications normally.

## Storage and trust boundaries

Control state version 1 / SQLite schema version 23 lives in a **separate new private directory** with `control.db`; it does not replace/migrate `store.json` or `security.json`. The existing broker remains authoritative for enrolled hosts, session proofs, membership and messages. The control repository owns only its new state. Older private control schemas are validated before additive migration: schema 5 adds bounded activity observations and retention/loss metadata, schema 6 adds bounded managed-worktree approval/intent/receipt state, schema 7 adds bounded latest adapter-health snapshots, schema 8 adds exact-event-ID operator-notification acknowledgement receipts, schema 9 allows structured task identity on review notices, schema 10 adds a separately retained terminal stop-confirmation hold, schema 11 binds terminal stop receipts to its broker generation, schema 12 fences active/review stop callbacks against new explicit uncertainty commands, schema 13 extends that fence to admission/start/progress callbacks, schema 14 also advances the callback generation on uncertain admission outcomes, schema 15 adds a durable index into verified private command-receipt archives, schema 16 adds verified history indexes and reversible terminal collaboration-text compaction, schema 17 adds bounded cold entity metadata with archive-backed collaboration text, schema 18 adds explicitly scoped provider-context approval and retained ownership holds, schemas 19–22 add exact cleanup, model context, retained-owner reconciliation and catalog effect scopes, and schema 23 adds separately scoped MCP establishment and compatible retained resource holds. Migration does not rewrite existing raw state, notices, audit or command receipts. Absent legacy hold/generation fields grant no resource-absence/release proof; a legacy terminally held task remains unbound and quarantined. Old active assignments without accepted role notices cannot gain transport authority. Broker schema version 3 accepts additive private exposure, pause and effect-receipt records; older binaries may reject snapshots containing these new fields or the new Codex native-turn artifact variant. Older control binaries reject schema 23. MCP-establishment records cannot be relabeled as schema 22, and provider-establishment records cannot be relabeled as schema 17. Do not downgrade by stripping holds, generations, receipts, artifact evidence, telemetry or exposure metadata.

Commands are strict and carry UUID idempotency keys. Actor identities, membership snapshots and the clock are separate **trusted context**, never request/model fields. The broker resolves `operator` from its administrator credential, `participant` from host/session proof plus membership, and `adapter` from separate operator enrollment plus session proof and the actual receiver socket. Only the in-process scheduler can issue clock/departure transitions. A session proof alone cannot grant arbitrary adapter evidence-reporting or operator rights. The internal store is not an authentication mechanism; unrestricted same-user filesystem access can still read adapter credentials.

State/evidence/audit are committed in one SQLite transaction with full synchronization, an exclusive writer lock, private directory/file checks, WAL checkpointing and bounded storage. Unknown schema versions/corrupt state fail closed. Clock regression is rejected. Command receipts cannot silently disappear and permit repeated effects.

Rolling telemetry expires after 30 days, subject to unresolved-message/evidence protection. Authority changes, action/task transitions, unresolved incidents and admission evidence are not automatically deleted. Initial limits: 100,000 events, 10,000 command receipts, 20,000 activity observations, 64 MiB serialized state and a bounded SQLite database. Hitting a control-state limit rejects the transaction without deleting evidence; observation capacity instead records telemetry loss without rejecting already-durable broker operations. Private control exports and operator CLI pressure alerts are implemented; safe capacity reclamation and dashboard/OpenCode alerts remain production gates. Broker message/receiver metadata now complements rolling lease-renewal and task-progress events; native adapter health and broader operational telemetry remain incomplete.

Audit events store enumerated types and IDs, not credentials, headers, prompts, task bodies or arbitrary provider error text. Task instructions/results and role notices are separately persisted collaboration content. Message inspection reads the existing broker message store; it is not an independent 30-day message archive. Explicit sensitive-content handling and comprehensive telemetry remain future work. Same-user unrestricted filesystem access is not sandboxed by the control plane.

Membership departure and host revocation persist role termination before altering legacy broker membership/security. These stores are **not atomic together**: a later JSON failure may conservatively leave membership present with its role already revoked. Control-storage failures prevent membership-removal success; scheduler failure disables control requests until restart, without granting stale role authority. A full notice/audit store can therefore block departure. The operator-visible [verified history recovery path](control-history-reclamation.md) now releases eligible old settled records; unresolved or unexpired records remain protected. Renewal command receipts consume finite live and archived budgets, which remain visible and require operational capacity planning.

### Operator storage status and private control exports

```sh
npm run control-admin -- storage
npm run control-admin -- storage-watch
npm run control-admin -- export /absolute/private-directory/new-export.jsonl
# Retry a lost response using the original UUID printed before the request:
npm run control-admin -- export /absolute/private-directory/another-new-file.jsonl ORIGINAL_UUID
```

These commands use the local operator credential, not a participant/model tool.
Detailed quotas, disk capacity and unresolved-work counts require operator access;
participants receive only aggregate pressure through `control_info`. Watches send
changes to pressure level/affected resources to subscribed operator sockets, with
no master required and no participant wake. A disconnect ends the CLI watch with
a failure status; reconnect explicitly. Quotas warn at 80% and become critical at
95%; low free disk has additional absolute/percentage thresholds. These are
alerts, not permission to replay effects, discard receipts or clear a fault.

Exports are immutable `control/exports/UUID.jsonl` files with private permissions,
a bounded streaming format, content/footer validation and SHA-256 download
verification. Each captures a consistent SQLite read transaction: control state,
events, command receipts, notices, effect intents, broker activity observations,
durable telemetry loss counters and credential enrollment/revocation audit metadata.
New exports declare SQLite schema 18; the reader also accepts earlier schema-4/5/6/7/8/9/10/11/12/13/14/15/16/17 exports. Pre-18 exports cannot contain provider-establishment records.

Separately explicit [command-receipt reclamation](control-receipt-reclamation.md)
can recover exhausted live receipt capacity from a completed private export and
its verified digest. Schema 15 retains a bounded durable UUID-to-archive index;
exact command retries and receipt inspection read original verified bytes even
after restart. Referenced archives become required private control storage.
This does not prune state, unresolved evidence, events, notices, audit or native
journals, and it does not clear a scheduling quarantine automatically.
Authentication registries, credential digests, broker membership/
message JSON, raw native transcripts and adapter journals are **not** exported.
Task instructions, results, paths and role notices **are collaboration content**
and are retained; this is not a public/redacted export or a guarantee against
secrets pasted into collaboration fields. Keep exports private. It is not a full
disaster-recovery backup, an import API, or an archive of broker messages.

Defaults allow 32 files, 512 MiB total and 256 MiB per file. Exporting never deletes
live data or frees command/evidence capacity. Existing IDs return their original
validated snapshot, including after restart; never silently regenerate an ID on
an uncertain retry. Interrupted/failed files count toward limits and remain
incomplete, cannot be downloaded as valid exports, and are never overwritten.
Failed local downloads likewise remain explicitly unverified and are not
overwritten. Do not delete incomplete files until an operator has investigated
them. Safe verified archival/reclamation and recovery from exhausted durable
receipt budgets remain unimplemented; do not manually strip receipts or evidence.

Diagnostics and consistent exports bypass scheduler mutations and remain callable
when control scheduling is quarantined, provided the broker and readable store
remain usable. Completed exports can still be retrieved if the control store is
unavailable. Neither operation clears quarantine or bypasses broker authentication,
request budgets, filesystem safety checks or a broker-wide persistence fault.

### Broker activity telemetry

```sh
npm run control-admin -- activity-status
npm run control-admin -- activity dev
npm run control-admin -- activity dev LAST_SEQUENCE
```

With the control plane enabled, the broker records strictly typed metadata for
membership join/removal, receiver connect/disconnect/unsubscribe, message queue/
offer/acknowledgement/cancellation and successful broker pause/resume effects.
Records contain generated observation/run UUIDs, broker time, channel, agent ID,
optional broker message UUID and enumerated cancellation reason. They do not
copy message bodies, client message keys, names, roles, project paths, proofs,
authentication headers, credential values, native prompts or provider errors.
Identifiers remain private coordination metadata, not anonymized/public data.

`control_activity` and `control_activity_status` are operator-only read endpoints,
with channel filtering, bounded pages and monotonic sequence cursors; they work
without a master and do not wake participants. They remain callable when control
scheduling is quarantined, subject to ordinary broker authentication/availability.
Retention runs at startup and at most once per minute, independently of master
leases or scheduler success. It removes observations strictly older than 30 days,
except message records pinned by pending delivery, exposed/legacy-unknown
unacknowledged delivery (even after cancellation), control evidence, open incidents
or unresolved recovery actions. If the protection inventory is unavailable or
time regresses, it deletes nothing and reports a telemetry-health problem. Control
state, command receipts and native evidence are never pruned by this operation.

Coverage is explicitly **observational**, not a cross-store transaction or a
recovery/admission receipt. A crash between broker persistence and observation can
leave an unknown gap. Every process has a new run ID; the system never synthesizes
missing history, silently replays an operation, or treats an offer/acknowledgement/
disconnect as native task completion. Repeated send/ack requests do not generate
duplicate queue/ack observations, but a later actual re-offer is a new observation.

At the activity limit, new observations are refused, retained rows remain intact,
and a durable `rejected` count increments. Failed writes increase the current
run's `unpersisted` count; successful subsequent observation/retention transactions
flush known losses into the durable rejection counter. A crash before that flush
can lose the count, so zero never proves uninterrupted coverage. Quota pressure,
known losses and retention failures appear in operator storage alerts; known
historical loss is not silently cleared after capacity recovers. Monitoring
failure alone does not turn an already-durable send/ack into failure or authorize
native recovery. These are metadata observations, **not** a separate message-body
archive; opt-in native adapter snapshots and the read-only Health view are now
implemented (`adapter-health.md`). Exact notification acknowledgement and verified
receipt/history reclamation are implemented; broader native/desktop coverage and
deployment acceptance remain open.

## Next implementation gates

1. **Authenticated integration follow-through:** broker/OpenCode/Codex governance, control export, broker activity telemetry, opt-in native health snapshots and the dashboard Health view are implemented. Verified bounded capacity recovery and durable attention submissions are implemented. Finish broader native/Windows/IDE and installed desktop-delivery acceptance. Do not expose a generic endpoint accepting caller-selected actor context.
2. **Effect boundary follow-through:** all six recovery operations now have durable intents/receipts, receiver-bound native outcomes and restart reconciliation. Finish physical deployment and remaining platform acceptance; control state and legacy broker JSON are not one transaction. Do not claim cross-store atomicity.
3. **Adapter continuity:** grant/receipt contracts, coordinator, snapshot observation and the Codex stdio fence primitive are implemented; finish effective destination authority, production owner RPC/journal/quarantine wiring, OpenCode exclusion and exact receiver rebind, plus Codex task-scoped turn cwd admission. Then verify the full approved-grant/native-effect/rebind chain. Arbitrary moves/peer input must not acquire these capabilities.
4. **Dashboard/alerts:** the core React/Mantine loopback console, separate login/session, scoped guarded commands and in-page storage pressure are implemented with real broker/browser regressions. Passive OpenCode CLI hints have separate native server/terminal fixtures. Durable attention, Windows identity setup and supervisor rendering are implemented. Finish broader workflows and actual OS/IDE alert delivery separately. Never send broker host/admin credentials to JavaScript. See `operator-dashboard.md` and `opencode-alerts.md`.
5. **Operational acceptance:** real socket/API failures, busy conversations, lost responses, worktree preview changes, dirty cleanup refusal, IDE evidence and live-model checks. Do not declare OpenCode/Codex operational parity based only on pure reducer tests.

## Verification

```sh
npm run test:control
npm run test:worktrees
npm test
npm run check
```

`test:worktrees` requires both `opencode` and `codex` on PATH, or explicit `TURNLINK_OPENCODE_EXECUTABLE` / `TURNLINK_CODEX_EXECUTABLE`. It creates only isolated temporary projects/configuration and local deterministic model endpoints. No real credentials or paid API requests are used. Other tests run without those binaries; real gates are opt-in under the normal suite.


### Fresh prepared-grant authorization

`control_worktree_authorize` is an internal adapter request with session proof,
separate enrolled adapter credential, channel and the exact expected transition
record. It uses the actual current receiver socket; administrator/model roles,
nonreceiver connections and revoked credentials cannot authorize a transition.
It remains disabled with worktree grants by default.

The broker reads current state on every request, without command idempotency
receipts. For the regular effect check, only an exact `prepared` transition for
that conversation/channel is eligible. Its task must still be claimed by the same claimant/generation, with
the exact approved latest preview and preserved authority binding. Competing
uncertain transitions, managed worktree effects, task/resource holds and occupied
capacity refuse authorization. Capability and latest idle evidence must remain
fresh; newer busy evidence and future timestamps refuse it. The response contains
the exact grant and broker check time; no credential or raw configuration is
returned. Reusing an old command UUID cannot turn this read into cached approval.

The coordinator performs this check after final local verification and before
recording/invoking its native effect. A lost/refused response does not invoke the
port; recovery never uses this endpoint to replay movement. A response is only a
broker eligibility observation. Native captured owner/reservation binding,
complete effective authority, resource census/exclusion, approved construction,
commit/recovery and exact receiver acknowledgment remain separate required
boundaries. No production adapter gains movement from this endpoint.

The `observe-worktree` action is a separate recovery-only check for an exact
`prepared` or `uncertain` movement transition. It requires the enrolled current
receiver, exact current grant, matching claimant/generation and the approved
preview, but does not require fresh idle or movement capability evidence. It
cannot authorize a provider or MCP grant, settle a transition, or authorize a
move. The staged OpenCode recovery host brackets its native claim and inspection
with fresh checks; if authorization fails after a claim, the result is uncertain
and is not replayed. The two checks are snapshots, not an atomic broker/native
lease; intervening revocation and restoration cannot be ruled out by them.
These checks do not prove orphan cleanup, destination authority, or receiver
continuity and are not a transferable native capability.

The staged host persists a recovery-claim intent before native dispatch. A lost
reply or interrupted host leaves the attempt held; a restarted host does not
blindly resend the claim. It can use a fresh broker observation and the current
native storage owner to read a matching durable recovery record. A missing
record remains unresolved, and a found record is only evidence that the prior
claim was recorded: it does not prove physical cleanup or authorize a new move.
The host journal's filesystem lock and the native storage lease have distinct
failure models; neither establishes an atomic broker/native lease.


### Provider-context approval scope

A preview with `purpose: establish-provider` requests only construction of a
native provider context. Its exact native plan reference includes the participant,
reservation, source/destination, selected provider/family, native process generation
and an opaque plan digest. It carries no destination-authority binding and cannot
claim permission preservation or movement readiness. The first supported contract
kind is `provider_factory` for Codex; arbitrary startup commands and other resource
kinds are rejected. The native plan producer and constructor consumer remain to
be wired; this broker contract does not execute anything.

The enrolled current adapter receiver records `nativeProviderFactory` API support
separately from `sameConversationWorktree` capability. Explicit operator approval,
the same task claimant/generation and fresh idle/support evidence are required.
`worktree.begin` must repeat the preview's purpose and omits movement authority
only for this constructor scope. Fresh `control_worktree_authorize` checks the
exact prepared record and its scoped plan. A provider grant cannot be sent through
the existing native movement-record binding API.

`worktree.settle` accepts `established` only for this scope, at the unchanged source
location, with a receipt matching the exact plan/reservation/process generation.
That status means an owned context exists, not that credentials, tools, permissions
or execution are ready. It retains conversation exclusion across task scheduling,
admission, reassignment, managed effects, other transitions, restart and history
reclamation. Once a construction receipt exists, neither a later failure claim nor
replaying an old successful receipt can release ownership or erase uncertainty.
Cleanup and a dependent movement handoff need separate native proof and remain
unimplemented; there is no automatic release/expiry or promotion to movement.

Schema/export 18 prevents older reducers from interpreting these records as moves
or dropping their resource holds. Legacy command shapes remain unchanged; absent
purpose continues to mean movement, with its existing authority requirements.
Both movement and provider-establishment execution capabilities remain false.


The staged Codex private host port now produces the actual native provider plan
and invokes its separately approved native factory with durable pending intent and
retained resource ownership. Its constructed receipt may settle only the provider
scope and retains conversation exclusion. Cleanup, movement, task dispatch and
receiver release do not follow from that receipt. Production host-port wiring and
execution capabilities remain disabled; see the native design and execution ledger
for the component verification and remaining authority requirements.

The experimental source driver checks a configured provider's declared
environment key before starting destination MCP resources, and checks again
before resource dispatch. Missing or blank keys are refused without exposing
their names or values. A retained provider plan is also checked for changed
configuration or environment observations. This only observes local inputs:
it does not authenticate with a remote provider, resolve every credential
helper, or lock the environment against changes between observations.


Schema/export 19 adds an exact unpublished provider-owner cleanup receipt. A
constructed resource remains held until the enrolled native host records the
matching owner-release proof; generic failure cannot clear ownership. Native
cleanup releases only an unused, exclusive factory owner and its retained Config
handles. Previously exposed providers and strong/weak aliases refuse. Source
placement remains unchanged. Original construction and cleanup receipts remain
in the terminal record. A cleanup receipt cannot authorize movement or task
worktree approval. Schema 18 remains readable for older records; older brokers
reject schema 19, and new cleanup records cannot masquerade as schema/export 18.
Cancellation or capability revocation does not prevent exact owned cleanup, and
cleanup never revives a cancelled task. Active/published-resource cleanup,
closed-owner reconciliation and full native migration remain separate requirements.

Schema/export 20 adds the explicit `provider_context` plan variant. It declares
local construction of the selected target model's native manager, its configured
or provider-default catalog source, native cache configuration and API-key
model-discovery setting. The original `provider_factory` plan cannot acquire this
scope by adding fields or substituting a receipt. Both kinds retain exact resource
and conversation holds until matching native unpublished-owner cleanup. Older
schema/export versions cannot carry the new scope. This construction grants no
catalog fetch, credential helper/refresh, cache I/O, MCP/tool startup, movement or
execution readiness; those effects and the full destination remain separate.


Schema/export 21 adds retained partial ownership without calling it established
readiness. Fresh `observe-provider` authorization permits a read-only native
custody/completion query under the same open owner and process. An effect timeout
retains uncertainty rather than replaying the effect or closing a still-live
owner; hard transport loss remains quarantined. Positive ownership can be recorded
while the broker transition remains uncertain, with its original immutable
resource receipt. A separate fresh cleanup authorization is required. Final
cleanup journal failure retains native admission and the actual source witness;
retry finishes the same cleanup ID after physical disposal, without disposing
again. Neither ownership observation nor unpublished cleanup is movement,
receiver, global shutdown or full destination readiness evidence.


Schema/export 23 adds a separate `establish-mcp` broker grant with an opaque
native plan identity and explicit process, network, credential, filesystem and
plugin effect disclosures. It requires independent MCP capability evidence, a
matching approved preview and a fresh receiver-authenticated authorization.
The broker retains an established or uncertain resource hold until an exact
owner cleanup receipt. An established provider and an MCP owner may coexist
only for the same agent, task, claim, source, destination, native process and
reservation; a pending or uncertain effect blocks another establishment. Each
owner needs its own cleanup before task release. Schema 22 snapshots migrate
without rewriting old command receipts; schema 22 cannot represent the new
scope, including in a rehashed export. This broker contract is not a native
startup grant implementation, physical cleanup proof or movement authority.

Schema/export 24 adds the optional `bindingCapture: true` disclosure to an
`establish-mcp` plan. It means native model-binding assembly may request or
refresh MCP tool catalogs and may reconnect a server, in addition to the
existing disclosed process, network, credential, filesystem and plugin effects.
An older schema-23 record does not acquire that effect during migration; a
schema-23 state or rehashed export containing it is refused. Schema-23 software
cannot read a schema-24 database, so rollback requires a compatible restore.
The disclosure alone is not complete tool authority or movement permission.

Schema/export 25 adds `pluginCapture: true` to disclose that the native MCP
projection captures and later rechecks its host plugin cache and authentication
observation. This can read installed plugin roots and update cache recency; if
MCP is disabled it may also load host plugins under the disclosed effect. Existing
schema-24 records do not gain this effect. A schema-24 state or rehashed export
containing it is refused, and older software cannot open schema-25 databases.
This is not proof of plugin-file or skill freshness, or movement authority.

Schema/export 26 adds `skillCapture: true` to the MCP plan. This authorizes a
detached scan of destination skill roots, filesystem reads and possible bundled
system-skill installation under the retained owner. It requires both plugin and
MCP binding capture. Schema-25 records do not gain this effect; downgraded
state and rehashed exports containing it are refused, and older software cannot
open a schema-26 database. The capture is not a live turn or movement grant.
