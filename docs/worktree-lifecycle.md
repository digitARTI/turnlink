# Managed worktree host primitive

`src/worktree-lifecycle.js` implements a default-off participant-host Git
lifecycle. An operator-supervised CLI is available as described below; it is
not a model/browser tool and does not install itself into production adapters.
Neither this path nor its real-Git tests enable managed conversation movement,
prove destination permission equivalence, or establish receiver continuity.

## Operator-supervised CLI

This path requires a stopped participant receiver and an explicit human
confirmation for **each** create or remove operation. Before confirming, the
operator must stop and check sessions, processes and external/background work
that could use or change the repository or worktree, and keep them stopped
until the command finishes. The Git journal lock excludes other Turnlink
lifecycle hosts; it does not independently exclude native clients or arbitrary
filesystem writers. A confirmation is an operator attestation, not proof of
native exclusion. Removal also requires its own broker approval, a clean tree,
the recorded directory identity, matching claim and unresolved-evidence checks.

Enable the broker's records with `AGENT_CHANNEL_CONTROL=1` and
`AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS=1`; the latter does not enable native
movement or install an executor. Use an existing enrolled participant and its
private session proof and adapter credential. The CLI requires the local
operator admin-token for each confirmed create/remove. It refuses to replace a
connected receiver or join while the same session has an unfinished manual
resume. Broker and client must both support the new guarded subscription;
older brokers reject it rather than silently dropping the guard.

Create an operator-owned 0600 JSON settings file in a private directory. Its
absolute paths identify the actual repository root, a private journal directory,
a separate private managed-worktree root, the enrolled adapter credential file,
and optionally the existing session-proof directory. The parent directories of
the journal and worktree roots must already exist and be canonical:

```json
{"version":1,"agentId":"opencode:example","channel":"dev","repository":"/path/to/repo","directory":"/private/path/worktree-state","worktreeRoot":"/private/path/managed-trees","adapterCredentialFile":"/private/path/adapter.token","credentialDirectory":"/private/path/session-keys"}
```

With the broker URL, host credential and local `AGENT_CHANNEL_STATE_DIR` set for
the operator, use `npm run manual-worktree --` followed by:

1. `preview-create <settings> <taskID> <claimGeneration> [revision]`.
2. Review the returned preview with `control-admin managed-worktree-review`,
   then explicitly approve it with `control-admin managed-worktree-approve`.
   Both take `<channel> <previewID>`; approval also accepts an optional command
   UUID. The approval command prints its exact preview and ID before submission. After a
   lost reply, reuse that command ID to look up or retry the exact approval;
   a new ID cannot reapprove a decided preview.
3. After checking and stopping competing work, run
   `create <settings> <previewID> <digest> --confirm-no-active-use`.
4. To clean up, run `preview-remove <settings> <resourceID>`, review and approve
   that separate preview, then run
   `remove <settings> <previewID> <digest> --confirm-no-active-use` after a
   fresh check. Existing user changes, untracked/ignored files, unsafe Git
   configuration, unresolved task work or incidents cause refusal.

`recover <settings>` reconciles the local journal with the broker and observes
the exact Git state; it does not retry an uncertain Git effect or delete files.
The CLI records the operator-authenticated confirmation in the broker and
binds the exact confirmation ID, preview digest and time into the private host
journal before beginning Git. The broker rechecks that ID when admitting and
revalidating the operation. This is still an operator statement, not native
proof. Older binaries that do not understand the additional journal field must
not be used on that journal. Broker previews and the private journal are both
needed for recovery. Keep the session proof and adapter/admin credentials
private; no credential belongs in the settings JSON or command arguments.

## Trusted host contract

Construction requires an explicit `enabled: true`, absolute canonical private
state/worktree directories, a real Git checkout root, a bound agent identity, and
three trusted callbacks:

- `exclusive(operation)` must exclude competing native work for the entire
  operation, including asynchronous approval checks. A no-op fixture callback is
  not production native exclusion. Local filesystem writers outside this boundary
  remain an operational trust assumption; this is not a filesystem sandbox.
- `claim(taskID)` reads authoritative claimant, claim generation and status.
  Creation requires a current claim. Cleanup refuses running/uncertain/review tasks and
  requires the same claimant/generation, even for completed/cancelled work.
- `authorize(request)` must validate a human-approved exact preview ID/digest,
  operation, identity, task and claim generation. It must apply current policy,
  authority and approval expiry checks. For removal it must also prove no native
  admission/transition remains pending and no unresolved evidence depends on the
  tree, including for cancelled tasks (cancellation is not stop proof).
  Model-supplied booleans are not a port.

The internal `ManagedWorktreeHost` bridge now supplies the broker-backed claim,
approval, fresh revalidation and receipt callbacks. Adapter installation and a
supported native exclusion port remain pending. Broker transport authenticates an enrolled adapter and
its actual receiver/host; it does not provide the native host port. The existing `worktree.preview` contract
concerns conversation movement; it does **not** authorize filesystem creation or
cleanup by itself. Do not substitute its approval for lifecycle approval.

## Broker approval and receipt records

The separately default-off internal broker option `managedRecords: true` enables
record transport only, requiring the control plane. A broker may opt in with
`AGENT_CHANNEL_CONTROL=1 AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS=1`; this enables
records, not Git execution. `control_info` distinguishes
`managedWorktreeRecordsEnabled` from `managedWorktreeExecutionEnabled: false`;
conversation movement flags also remain false.

- An actual subscribed receiver with a separately enrolled adapter credential
  publishes `managed.preview` with the exact typed host preview and its enrolled
  host ID. Raw native configuration, credentials and exception bodies are not part
  of the payload. The existing private collaboration-content caveat still applies
  to user-chosen path names. Read-only `managedPreviews` queries are channel-scoped,
  with full paths visible only to the operator, verified master or owning session.
- Only the human operator can `managed.approve`/`managed.reject`, naming the exact
  preview ID and SHA-256 digest. Approval requires a fresh matching task claim;
  it does not grant filesystem access or bypass native harness approvals.
- The local operator CLI can inspect an existing broker preview with
  `control-admin managed-worktree-review <channel> <previewID>`. It verifies the
  channel, ID and preview digest, and for a pending preview displays the exact
  `managed.approve` command for review. It does not submit that command. For a
  removal it explicitly notes that review alone does not establish that the tree
  is unused or authorize deletion. This does not enable the default-off records
  or execution capabilities.
- `managed.begin` creates a durable intent only after approval, expiry, policy,
  claim and competing task/transition checks. `managed.revalidate` checks them
  again before any hypothetical effect. A host must use a **fresh command ID** for
  each revalidation; replaying a durable command receipt is not fresh authority.
- Admitted/uncertain lifecycle work fences task release, reassignment, new task
  dispatch and competing conversation movement. It does not claim to stop work
  already admitted to a native harness. The native port requires independent
  exclusion; the separate operator-supervised path depends on the explicit
  stop-and-check attestation described above.
- `managed.settle` accepts an enrolled receiver's exact-intent receipt. The receipt
  ID is the command ID and is immutable under exact retry. Creation binds the
  observed directory device/inode identity. Removal requires a recorded creation
  with the same host, agent, claim, repository, revision, path and directory
  identity, plus no open incident bound to that task/resource/preview. The host
  must still prove cleanliness, no pending native admissions and evidence safety.
- Uncertainty survives restart and keeps the task fence. A later positive Git
  observation can settle created/removed; a generic error or an absent RPC reply
  cannot turn an uncertain admitted operation into a no-effect failure. Settlement
  does not auto-resolve an incident or report/accept a task.

SQLite schema 6 adds the bounded collection to transactional control state, audit,
receipts, exports and operator storage pressure. Migration leaves existing raw
state/audit/command receipts untouched. Broker model/admin calls cannot directly
run Git. Production native ports and adapter installation remain required for
adapter-owned effects. The separate CLI can execute only an explicitly approved,
operator-attested manual operation and does not establish native exclusion.
Schema 36 adds lossless decimal-string identities when filesystem device or
inode numbers exceed JavaScript's safe integer range; existing smaller numeric
identities remain readable. It also records the explicit manual-use confirmation.
Exports use schema 36. Upgrade broker and tools
together: older brokers refuse the newer control schema and cannot safely read
the new identity representation.

## Coordinated host bridge (internal, not installed)

`src/worktree-host.js` connects the primitive to the authenticated broker. Both
the host's explicit `enabled: true` and the broker's separate managed-record gate
are required. It additionally requires a harness-bound `nativePort`:

- `exclusive(callback)` must actually exclude competing native work for the
  relevant host/repository/conversation, including across every asynchronous RPC.
- `verify(scope)` must prove the exact enrolled session is still safe to operate
  and that removal cannot destroy a tree used by any native participant or needed
  by unresolved evidence. It receives only bound identity/task/repository/path
  metadata. A caller-supplied `true`, a stale idle observation, or a fixture lock
  is not production proof.

No OpenCode or Codex adapter currently installs this bridge, and neither native
port is proven. The bridge does not establish destination trust, move a session,
rebind a receiver, change permissions or complete/report a task.

The host keeps publication IDs, exact begin IDs and frozen settlement outboxes
inside the **same atomic private snapshot** as each filesystem lifecycle record.
Local journal version 2 adds this optional coordination metadata; it still reads
uncoordinated version-1 journals for the standalone primitive. A coordinated host
refuses to adopt an old unbound resource, and the standalone primitive refuses a
coordinated journal. Older binaries reject version 2 instead of stripping grants
or receipts. Credentials, native configuration and raw native error bodies are
not stored in this journal.

Publication is idempotent under its original command ID. Approval remains an
explicit human operation, never a recovery side effect. Before Git, a broker begin
is journaled and acknowledged; native verification then precedes a fresh broker
revalidation as the final awaited boundary. Broker revalidation is never replayed
as current authority. Claim checks, path/filter checks and local effect admission
are preserved. The repository writer and supplied native exclusion remain held
through publication, execution and receipt reconciliation.

Recovery distinguishes these cases:

- **Publication reply lost:** resend only the exact broker publication command,
  never create a new preview ID. A definitive expiry/claim refusal closes the
  never-admitted preview as failed without blocking future explicit previews.
  Authentication/transport/storage errors remain held, not inferred refusals.
- **Begin reply lost / journal proves no Git admission:** freeze local no-effect
  failure, recover only the exact broker transaction, and settle its intent as
  failed. This may replay a broker-only outbox command, never Git. A new explicit
  preview/approval is needed to try the filesystem operation again. Reserved
  directories are retained; there is no force cleanup.
- **Git admission recorded:** never call add/remove again. Observe the exact
  registered directory/revision and cleanliness as applicable; partial/unknown
  results stay uncertain, with both local and broker task fences retained.
- **Receipt reply lost:** retry the frozen original command ID/body even after
  broker/host restart. Later work in that conversation waits for acknowledgement.
  A received creation/removal receipt is not task/native stop evidence.
- **Uncertain -> verified positive observation:** acknowledge the original frozen
  uncertain receipt first, then issue a separate durable positive receipt. An
  absent directory after uncertain creation is not a guessed no-effect failure.
  Incidents remain open until explicit evidence-backed resolution.

No journal recovery repeats Git, prompts a model, weakens harness approvals,
changes a role or blindly wakes a conversation. Exact command replay is used only
for broker transactions with durable command receipts, not native mutations.

## Implemented behavior

- Creation previews resolve a revision to a commit ID and reserve a generated
  destination under the private managed root. Previews expire after five minutes;
  branch changes cannot change the approved commit. Creation is detached, without
  changing the original checkout, deleting branches or updating native sessions.
- A private bounded journal (256 records) and per-repository writer lock preserve
  reservations, effect admission and observations. The host checks the exact
  approval/claim again after reservation and before Git invocation. Journal
  capacity never silently evicts history. Crashed-writer locks use the existing
  conservative stale-lock behavior; there is no force-unlock API.
- Hooks and fsmonitor are disabled for these Git commands. Inherited `GIT_*`
  overrides and global/system configuration are excluded. Configured checkout
  filters are refused, including changes during approval and destination
  worktree-specific cleanup filters. All Git transport protocols and lazy fetch
  are disabled, partial-clone configuration is refused, and replacement refs
  cannot substitute another tree for the pinned commit. No filter/hook output
  or raw Git error body is exposed. This is a deliberately limited Git port,
  not a reproduction of the user's complete native Git environment.
- Cleanup requires a separate fresh preview and explicit approval. The tree must
  still belong to this journal/agent/claim, have the original directory identity,
  be registered in the same repository at the original detached commit, and be
  unlocked and clean. Tracked edits, new commits, untracked/ignored content,
  submodules and skip-worktree/assume-unchanged index flags cause refusal. Git
  removal is never called with `--force`; no recursive fallback or branch deletion
  exists. The empty private reservation parent is retained.
- Recovery is read-only with respect to Git/worktree contents. A matching clean
  tree after uncertain creation can settle as created; an absent path **and**
  absent Git registration after uncertain removal can settle as removed. Partial,
  replaced, dirty or otherwise unverified trees remain quarantined. Recovery never
  calls add/remove/prune or tries an uncertain effect again. A reservation without
  recorded Git admission stays uncertain and is preserved for inspection.

Symlink destinations/parents, foreign agent receipts and resource identity changes
are refused rather than silently adopted. No claim/report, task acceptance,
movement evidence or native stop evidence is synthesized from a Git observation.

## Verification and remaining gates

`npm run test:managed-records` covers broker/reducer authentication, exact approval,
policy/claim/expiry fencing, uncertain-intent restart, transactional rollback,
resource identity, schema-5 migration and a real-Git host/reducer digest roundtrip.
The roundtrip uses fixture native exclusion, not production continuity proof.

`npm run test:worktree-host` exercises the coordinated bridge with a real broker
and real Git: explicit approvals, fixed outboxes on lost replies, actual broker
restart, final policy-change rejection, native verification refusal, uncertain
results, stale publication refusal, competing writers and a SIGKILL after the
Git effect. The POSIX crash test observes the child exit before removing only its
exact test-owned stale lock; no production force-unlock API is supplied. Native
exclusion/unused-tree verification in these tests remains a deterministic fixture.

`npm run test:worktree-lifecycle` runs real isolated Git tests, including SIGKILL
after add/remove followed by journal recovery, claim/approval races, concurrent
writers, changed revisions, dirty/ignored/trust-bit preservation, foreign/replaced
resources, symlink refusal and hook/filter handling. All test mutation/cleanup is
restricted to newly created private fixture directories.

Still required: production adapter installation and proven native admission/host
exclusion, exact session continuity,
destination effective-authority proof, full task execution/report/acceptance after
movement, Windows/IDE evidence and operational deployment approval. No production
capability flag changes are made by this milestone.
