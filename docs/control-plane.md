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
- `src/control/effects.js` / `src/broker-effects.js`: opt-in broker-local pause/resume and never-offered queued-message cancellation, with transactional SQLite intents, immutable broker JSON receipts and restart reconciliation.
- Worktree preparation subgate: approval-bound manifests, receiver-only transition grants/receipts, unresolved-conversation fencing, scoped preview/transition reads, and a private crash-safe adapter coordinator (`src/worktree-transition.js`). This coordinator is internal and is **not connected to live adapter movement**.

Not implemented yet: comprehensive broker telemetry ingestion, adapter replay/wake-policy/member-removal executors, task dispatch, live native worktree snapshot discovery/exclusion/destination rebind, managed worktree creation/cleanup, dashboard, or OpenCode alert UI. By default an approved action remains a record, not an effect; the separate broker-effects flag enables only the three operations listed below. A task in `dispatching` still represents an intent awaiting a future executor. Transport capabilities report `effectsEnabled`, `effectOperations`, `taskDispatchEnabled: false` and `worktreeExecutionEnabled: false`. Internal stores/reducers/coordinators are not browser/model APIs.

## Experimental activation (isolated state only)

Start a broker with `AGENT_CHANNEL_CONTROL=1 npm start`. Its control database is created in the broker state's `control/` subdirectory. Do not enable this against a production installation yet: storage archive/alerts and full operational acceptance are pending.

Use the local operator credential through the CLI, never through model tools or browser JavaScript:

```sh
npm run control-admin -- command '{"op":"channel.configure","channel":"development"}'
npm run control-admin -- enroll-adapter local /absolute/private/adapter.token
npm run control-admin -- query development channel
```

`local` is the default host ID; substitute the enrolled host ID for a remote host. The credential file must be new and its parent must be a private directory. Enrollment generates a separate credential and stores only its hash at the broker. If enrollment fails after file creation, the protected file remains for operator inspection. Revoke with `npm run control-admin -- revoke-adapter local`. Keep the command UUID printed by the CLI for retries after a lost response; supply the same `id` in the retried JSON.

In the existing OpenCode plugin options, add `control: true` and `adapterTokenFile: "/absolute/private/adapter.token"`, retaining all existing options. This exposes the two participant tools and enables native role delivery/30-second adapter maintenance. Only offer notices may wake an idle conversation; active/ended notices use non-resuming steering. The maintenance loop does not ask participants to poll or send heartbeat replies. Native permission/question/form blockers remain respected.

MCP exposes the participant tools only with `--control-plane`. For Codex, retain existing MCP configuration and append that flag to its Turnlink MCP arguments. On the **proxy process**, set `AGENT_CHANNEL_CONTROL=1` and `AGENT_CHANNEL_ADAPTER_TOKEN_FILE=/absolute/private/adapter.token`. The proxy does not forward the adapter credential-file variable to its Codex child/MCP processes. Do not supply this credential through tool arguments or the model environment.

Codex role offers use `turn/start` when lifecycle is known idle, or `turn/steer` with the exact active turn ID. Active/ended notices only steer a running turn; idle delivery is deferred. Existing approval requests block admission. Resumed threads whose lifecycle cannot be established are held until a native turn response/event establishes it. No instructions, cwd, agent/model, sandbox or approval parameters are overridden by role admission. Uncertain admissions are held for native receipt reconciliation/operator inspection, never blindly replayed after a timeout or restart. These are governance capabilities, not full task-execution or IDE acceptance. No task or worktree effects are dispatched.

### Optional broker-local effects gate

For isolated verification only, start with **both** `AGENT_CHANNEL_CONTROL=1` and `AGENT_CHANNEL_CONTROL_EFFECTS=1`. The latter requires the former and is disabled by default. The scheduler executes only authorized `pause_delivery`, `resume_delivery` and `cancel_queued` actions. Human approval is still required by channel policy (including cancellation in default safe mode); tools cannot invoke the scheduler or reconciliation commands.

- Pause prevents future broker pushes. It does not cancel a native turn or retract input already offered. It survives restart and is cleared when that membership is removed.
- Resume permits future broker delivery; it does not replay already-offered native input on its own. Persisted pauses remain enforced even if effects are disabled later; reenable this gate to authorize a resume.
- Cancellation requires a message ID, exact channel/recipient match, and broker-persisted proof that the message has **never been offered** to that recipient. Adapter/model assertions and human approval do not override offered/admitted/legacy-unknown state.
- New messages retain private exposure metadata, persisted before any WebSocket push. Failure between recording exposure and sending is conservatively treated as possibly offered. Old messages without exposure metadata are unknown, never cancellation candidates. Push frames omit this metadata for existing-client compatibility.

Before the local effect, SQLite commits `executing` state, audit and an immutable intent together. The executor then rechecks accepted role, lease/generation, policy, approval and membership without an asynchronous gap before the broker's single-writer JSON commit. That snapshot contains both the effect and its receipt. SQLite reconciliation is a subsequent transaction, **not cross-store atomicity**. After restart, a matching broker receipt settles the recorded outcome without repeating the effect, even if authority has since expired. An unapplied intent is revalidated; changed authority/policy causes a failed settlement rather than execution. Existing historical `executing` records without an outbox intent are never inferred to be executable.

Temporary receiver disconnection holds an unapplied intent while membership and authority remain valid; it neither executes nor infers revocation. Reconnection permits revalidation, and lease expiry prevents execution. This also handles the initially socket-free broker restart.

The gate does not retry delivery, modify harness wake policies, remove members, approve native permission requests, execute tasks or move worktrees. These require separate adapter/effect contracts and acceptance gates.

### Worktree preparation subgate (internal verification only)

The `createBroker({ worktreeGrants: true, controlPlane: true })` test/programmatic option enables receiver-authenticated `worktree.begin` and `worktree.settle` records. It has **no CLI environment switch** and does not start an executor. Normal brokers reject these operations, even from enrolled adapters. Model and operator tools cannot issue them. `channel_status` / operator queries can inspect channel-scoped `previews` and `transitions`; ordinary participants see only their own records.

New executable previews require a bounded manifest: harness/project identity, source/destination effective-authority digests, and configuration/instruction source paths plus content hashes. No raw configuration, credentials or instruction contents are sent to the broker. The grant checks the exact approved latest preview, claimant/claim generation, fresh capability/idle evidence, equal authority digests, and conversation capacity. A legacy path/digest-only preview cannot obtain a grant. Every granted preview is one-use, including a definitively failed transition; retry requires a fresh preview and approval.

The internal coordinator requires **trusted native ports**, not caller/model-supplied snapshots. Ports must discover complete applicable configuration/instructions and compare effective permissions, sandbox/approval policy, selected agent/model and tools, including path-dependent rules; equal hashes of an incomplete session record are not sufficient. Ports must supply a verified native exclusion boundary covering competing admissions and native work. They are **not implemented in the production adapters yet**, so passing fake fixture ports is not operational acceptance.

The coordinator journals grant admission before requesting it, records native invocation before calling it, revalidates after grant acquisition, and verifies destination identity/configuration/authority after the effect. A per-conversation filesystem writer lock prevents stale coordinator instances from overwriting unresolved evidence. Lost grant/receipt responses retain exact IDs for reconciliation. Recovery never invokes native movement: a verified destination can settle movement; a journal proving native invocation never began can settle failure; other observations stay uncertain. Unchanged uncertainty does not produce repeated notices/receipts. Prepared/uncertain transitions block task release, reassignment and dispatch. A moved receipt is neither task execution/completion nor a membership-handoff capability.

Real OpenCode/Codex fixture gates still prove only their native same-conversation move/cwd capabilities and instruction/permission retention. The OpenCode gate additionally proves arbitrary moves detach and messages do not automatically follow. Approved broker grant → native effect → destination receiver rebind remains a future end-to-end gate. Until it passes, live worktree movement remains disabled and the existing OpenCode move-detachment policy is unchanged.

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

Control state version 1 / SQLite schema version 4 lives in a **separate new private directory** with `control.db`; it does not replace/migrate `store.json` or `security.json`. The existing broker remains authoritative for enrolled hosts, session proofs, membership and messages. The control repository owns only its new state. Older private control schemas are validated before additive migration; old active assignments without accepted role notices cannot gain transport authority. Broker schema version 3 accepts additive private exposure, pause and effect-receipt records; older binaries may reject snapshots containing these new fields. Do not downgrade by stripping receipts or exposure metadata.

Commands are strict and carry UUID idempotency keys. Actor identities, membership snapshots and the clock are separate **trusted context**, never request/model fields. The broker resolves `operator` from its administrator credential, `participant` from host/session proof plus membership, and `adapter` from separate operator enrollment plus session proof and the actual receiver socket. Only the in-process scheduler can issue clock/departure transitions. A session proof alone cannot grant arbitrary adapter evidence-reporting or operator rights. The internal store is not an authentication mechanism; unrestricted same-user filesystem access can still read adapter credentials.

State/evidence/audit are committed in one SQLite transaction with full synchronization, an exclusive writer lock, private directory/file checks, WAL checkpointing and bounded storage. Unknown schema versions/corrupt state fail closed. Clock regression is rejected. Command receipts cannot silently disappear and permit repeated effects.

Rolling telemetry expires after 30 days. Authority changes, action/task transitions, unresolved incidents and admission evidence are not automatically deleted. Initial limits: 100,000 events, 10,000 command receipts, 64 MiB serialized state and a bounded SQLite database. Hitting a limit rejects the transaction without deleting evidence. An archive/export and operator-visible storage incident are required before production activation. Only periodic lease renewals and progress telemetry are rolling events in this initial core; adapter health/message telemetry remains to be wired.

Audit events store enumerated types and IDs, not credentials, headers, prompts, task bodies or arbitrary provider error text. Task instructions/results and role notices are separately persisted collaboration content. Message inspection reads the existing broker message store; it is not an independent 30-day message archive. Explicit sensitive-content handling and comprehensive telemetry remain future work. Same-user unrestricted filesystem access is not sandboxed by the control plane.

Membership departure and host revocation persist role termination before altering legacy broker membership/security. These stores are **not atomic together**: a later JSON failure may conservatively leave membership present with its role already revoked. Control-storage failures prevent membership-removal success; scheduler failure disables control requests until restart, without granting stale role authority. A full notice/audit store can therefore block departure and needs an operator-visible archival/recovery path before deployment. Renewal command receipts also consume the finite command budget; this slice is not an unattended long-running service.

## Next implementation gates

1. **Authenticated integration follow-through:** broker/OpenCode/Codex governance slices are implemented and tested; add comprehensive telemetry, storage alerts and archive/export. Do not expose a generic endpoint accepting caller-selected actor context.
2. **Effect boundary follow-through:** broker-local pause/resume and never-offered cancellation now have durable intents/receipts and reconciliation. Add adapter-side replay/wake-policy/member-removal contracts separately; control state and legacy broker JSON are not one transaction. Do not claim cross-store atomicity.
3. **Adapter continuity:** grant/receipt contracts and the internal coordinator are implemented; finish native configuration/permission discovery, verified exclusion and exact destination receiver rebind for OpenCode, plus Codex task-scoped turn cwd admission. Then verify the full approved-grant/native-effect/rebind chain. Arbitrary moves/peer input must not acquire these capabilities.
4. **React/Mantine dashboard:** loopback-first server, human login/session, CSRF/origin protections, scoped browser API, channel/message/incident/task views, approvals, and storage alerts. Never send broker host/admin credentials to JavaScript. Add OpenCode CLI alerts separately.
5. **Operational acceptance:** real socket/API failures, busy conversations, lost responses, worktree preview changes, dirty cleanup refusal, IDE evidence and live-model checks. Do not declare OpenCode/Codex operational parity based only on pure reducer tests.

## Verification

```sh
npm run test:control
npm run test:worktrees
npm test
npm run check
```

`test:worktrees` requires both `opencode` and `codex` on PATH, or explicit `TURNLINK_OPENCODE_EXECUTABLE` / `TURNLINK_CODEX_EXECUTABLE`. It creates only isolated temporary projects/configuration and local deterministic model endpoints. No real credentials or paid API requests are used. Other tests run without those binaries; real gates are opt-in under the normal suite.
