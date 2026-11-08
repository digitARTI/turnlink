# Operator dashboard (experimental)

The React/Mantine console is a **human-only, loopback-only** surface over the
existing broker. It does not activate tasks, managed movement or recovery
executors. Production configuration and harness permissions stay unchanged.

## Run in isolated state

Use the project's supported Node version (Node 24 is used for the fixtures).
Install/build the separate frontend once:

```sh
npm --prefix dashboard ci
npm run dashboard:build
```

Start an experimental control-enabled broker in a private test state directory,
then configure the channels with the operator CLI. In another terminal using the
**same** `AGENT_CHANNEL_STATE_DIR`/broker URL:

```sh
TURNLINK_DASHBOARD_CHANNELS=development npm run dashboard
```

Open `http://127.0.0.1:47322` directly. The startup message identifies the private
`dashboard-login.token` file in the broker state directory. Read it locally and
enter that separate dashboard login. **Never enter the broker host/admin token.**
The login file is generated with private permissions and is not printed in logs
or placed in URLs. Stop the console and rotate this file to revoke its login
credential; stopping/restarting invalidates all browser sessions/previews.

`TURNLINK_DASHBOARD_CHANNELS` is a required comma-separated allowlist (at most 16
existing channels, no spaces). `TURNLINK_DASHBOARD_PORT` optionally changes the
HTTP port. The listener always binds `127.0.0.1`, and Host/Origin checks use that
exact address/port, not arbitrary hostnames, forwarded headers or proxy URLs.
The dashboard does not configure a broker, enroll hosts/adapters, change tokens,
or silently create an unconfigured channel. It requires a built `dist/dashboard/`;
no Vite development proxy or browser-to-broker WebSocket access is used.

## Implemented console

- Channel participants, actual advertised execution flags, recovery mode and
  current master/proposal. Roles remain supplemental, not security privileges.
- Bounded task, incident, action, evidence, audit-event and activity pages.
  Task report/artifact/stop references stay distinct from master acceptance.
- Private message inspection only after a deliberate load; broker inspection
  audit remains authoritative. Peer text is escaped, not executed as HTML or
  interpreted as operator instructions. No external assets/content are loaded.
- Storage pressure, quotas, unresolved-work counts via the API, and telemetry
  coverage/loss visibility. Visible views refresh every 15 seconds; errors are
  shown rather than represented as healthy or silently retried mutations.
- Read-only command-receipt lookup, including after a lost dashboard response.
  A found receipt means a broker command was recorded, not that a native effect
  completed; absence never grants retry/reassignment authority.
- Preview/confirm for channel policy/election enablement, volunteer master
  appointment/revocation, supported pending recovery approval/rejection, existing-
  cwd task creation and explicit missed-schedule run-late/skip decisions.
- Guarded reassignment for an eligible claimed/running/uncertain task. It only
  reopens the task as unclaimed; it neither assigns a different participant nor
  stops native work. The preview shows claimant, attempt, claim generation,
  admission and any stop/dispatch receipt references. Without broker-known
  non-start/unadmitted/matching stop evidence, no reassignment control is offered.
  Pending movement/lifecycle work and all final reducer checks still apply.
- Task creation includes up to 64 dependency UUIDs from the same channel,
  priority 0–100 (higher first), optional scheduled start/deadline, progress
  timeout and explicit missed-schedule policy. Date inputs are **UTC**, at minute
  precision, not browser-local wall-clock time. The preview includes ISO UTC
  timestamps as well as the exact broker command. The missed default remains
  **ask**; choosing run-late or skip is deliberate. Creation never claims a task,
  dispatches it, overrides a dependency/capacity gate or answers native approvals.
  Dependency IDs may be copied from any task page; this is not a full task picker
  or a post-creation dependency/schedule mutation API.
- Event-backed **Notifications** inbox with preview/confirm for exact-ID “seen”
  acknowledgements. Reads never acknowledge; seen never resolves an incident or
  authorizes recovery. Lost replies use notification receipt lookup, not command
  receipt lookup or automatic resend. This is not OS background delivery.
  See [coverage, schema-8 storage and limits](operator-notifications.md).

Participants still claim, vote, report and accept/review in their own harnesses.
The console cannot act as a participant/master/adapter, submit native evidence,
accept a task on a master's behalf, start an uncertain replay, approve managed
movement or change native agent/model/cwd/permissions. Unsupported or disabled
executors cannot be approved through this surface. A recorded broker command
does **not** independently prove a native effect or task completion.

## Authentication and command boundary

The backend alone holds the admin credential. The browser receives only an opaque
host-only `HttpOnly; SameSite=Strict` session cookie, an in-memory CSRF token and
allowlisted collaboration data. There is one active operator session: a new login
revokes the old one. Sessions have request-based 30-minute idle and 8-hour absolute
expiry. Polling is activity, but never extends the absolute expiry. Credentials,
cookie values and command bodies are not logged or persisted by the dashboard.

API calls require a custom same-origin request header; all POSTs additionally
require the exact Origin, and authenticated POSTs require the session CSRF token.
Host, Fetch Metadata, request/body/preview budgets, strict schemas, no CORS, CSP,
frame denial, no-store responses, no-referrer and a small static asset allowlist
limit the browser surface. Authentication errors never include parser/provider/
filesystem exception bodies. The HTTP cookie intentionally has no `Secure` flag
on this strictly local HTTP listener. **This is not a remotely deployable HTTPS
authentication solution.** Do not expose it on LAN, use an unreviewed reverse
proxy, or treat same-user filesystem/browser compromise as sandboxed.

Every mutation uses an explicit UUID command and a session-bound two-minute
preview. Confirmation shows the current authoritative mode/master generation,
affected recovery proposal (if any) and exact immutable command. The server checks
the session after asynchronous reads and again immediately before the actual RPC
send, including after reconnect. A replacement login/logout cannot leave a queued
old-session command authorized to send later. Logout does not undo commands already
sent/committed or cancel authorized native work.

Policy revision, master/proposal/election identity and volunteer inventory are
also checked **inside the broker's command transaction**, not just by a preceding
dashboard read. A changed precondition rejects without applying/receipting the new
command. Exact previously committed command IDs still return their original durable
receipt; conditions do not erase idempotency history. Caller-supplied conditions
are operator-only checks, never identity, scheduler or adapter authority.
Reassignment and missed-schedule confirmation also carry an operator-only
`expectedTask` fence: the exact canonical task ID/digest is rechecked in that
same transaction. A different claim/attempt after preview is stale even when
channel policy did not change. An exact previously committed command retry
returns its original receipt rather than releasing a later claim. This is a
full-value comparison, not native owner authentication, an ABA-proof generation,
resource census, cleanup approval or physical stop proof. No new schema migration
or native permission change is involved.

New `task.uncertain` observations revoke an earlier usable stop marker and keep
the historical stop record. The old marker cannot permit reassignment or release
the occupied channel slot after that uncertainty; a fresh matching stop receipt
is required. The console still cannot submit such adapter evidence, resolve the
incident by reassignment, infer completion or accept a task for the master.
This also applies after a participant report enters review. The report remains
pending, with a **Review held: stop evidence missing** warning, while acceptance
and occupied channel-slot reuse are blocked. Fresh matching stop evidence removes
the hold but does not accept the result or resolve its incident. Health and passive
alert attention counts include reviews lacking stop confirmation. The warning uses
theme text color for readable contrast in both tested themes.

Schema 9 binds newly created task-review notices to a structured task ID. Review
uncertainty, completion or requested changes cancel matching pending hints while
retaining their records; accepted/in-flight native prompts cannot be retracted.
Legacy pending task-review notices without structured identity are conservatively
cancelled on these transitions, not parsed from their prompt text or given new
authority. Other bound tasks' pending review hints remain unaffected. A fresh stop
can publish a new review hint without requiring the participant to resend a report.
No schema migration rewrites old state/notice bytes; older binaries must refuse
schema 9, and exports retain reader compatibility with schemas 4–8.

Concurrent confirmation is held; completed confirmations return the cached result.
An uncertain command response is not resent, controls are disabled in that browser
view, and the exact UUID is shown for operator receipt investigation. Previews/cache
are bounded and process-local, not a substitute for broker receipts. After a lost
response or dashboard restart, inspect the original command ID before manually
submitting another operation. No browser mutation is automatically retried.
For task creation only, explicit broker reducer refusals `UNKNOWN_DEPENDENCY`,
`DUPLICATE_DEPENDENCY` and `DEADLINE_IN_PAST` are shown as definite refusals, with
no new task/command receipt and no resend. Missing, disconnected or lost responses
still remain uncertain. Past deadlines, duplicate dependencies and times outside
the dashboard's Date rendering range are also refused before preview. The broker
checks dependency existence/current channel and deadline again at commit.

Use **Check receipt** in an uncertain-outcome alert, or inspect from the operator
host without submitting the command again:

```sh
npm run control-admin -- receipt development ORIGINAL_COMMAND_UUID
```

The lookup is operator-only and channel-scoped, stays available with readable
control storage even when scheduling is quarantined, and returns bounded event-ID
metadata/digest rather than private command fingerprints or command bodies.
`known: false` is not proof that a delayed command cannot still arrive; a found
receipt likewise does not prove native stop/completion. Neither result automatically
clears uncertainty or re-enables mutations in that browser view.

## Verification and remaining gates

```sh
npm run test:dashboard
npm run dashboard:build
# Install the test browser once if needed:
npm --prefix dashboard exec -- playwright install chromium
npm --prefix dashboard run test:e2e
```

Backend regressions cover authentication, CSRF/Host/Origin/Fetch Metadata, session
replacement/logout races, expiry, scope/schema/body/rate budgets, commit conditions,
disabled effects and uncertain responses. Browser fixtures run the built UI against
a real isolated broker on desktop/light and mobile/dark Chromium, switch themes,
run axe checks on exercised views/dialogs, verify escaped peer content, cancellation,
voluntary task boundaries, stale previews and held uncertain HTTP outcomes. They
also discard an actual committed command's HTTP reply and recover its receipt
without creating a second task or inferring task execution/completion. They
use no real credentials, production state or paid model requests. Screenshots and
failure traces are generated under ignored `dist/dashboard-evidence/`.

This is not full platform acceptance. Safe storage reclamation, comprehensive
broader adapter coverage and Windows/IDE health acceptance, native OS alert acceptance, managed worktree continuity/creation/cleanup,
remaining adapter-backed recovery effects, actual Windows/IDE and live-model
deployment evidence remain separate gates. The durable operator inbox and the
advanced dependency/schedule **creation form** are implemented; this does not
introduce post-creation mutations or a full dependency picker. The already-listed
broader operator workflows and unattended/native notification delivery remain
incomplete. Storage alerts here
are an in-page polling view, not a guaranteed background notification service.

Passive OpenCode CLI hints are now available as a separately opt-in surface; see
`opencode-alerts.md`. They do not turn dashboard polling or local toasts into a
durable background notification/recovery system.

The **Health** view now displays separately opt-in OpenCode/Codex metadata
snapshots, including missing/stale/unknown/disconnected observations, without any
recovery controls. See `adapter-health.md`; observed idle is not stop evidence.

The task-editor milestone passed 349 parent tests/three skips with deterministic
native integration enabled, 280 form/HTTP repetitions across UTC, New York and
Auckland, 16 desktop-light/mobile-dark browser cases, syntax checks and dashboard
build. Browser fixtures enter a New York DST-gap wall time explicitly as UTC and
verify its exact persisted epoch, plus guarded confirmation, voluntary/unclaimed
state and accessibility. A local-time parser mutation fails four form cases;
removing definite-refusal classification fails two HTTP cases. The first browser
run exposed a required-label selector mismatch; the selector was corrected without
raising timeouts. No native runtime/configuration or movement switch changed.

The reassignment milestone passed 359 parent tests/three skips with local native
integration enabled, 330 store/HTTP repetitions and 20 real desktop-light/mobile-
dark browser cases, plus syntax/build checks. Tests cover changed claims with
unchanged policy, transaction-time task fences, restart/idempotent retry after a
later claim, fresh uncertainty/old stop retention and occupied capacity, blocked
active work, stale missed decisions, cancellation, lost HTTP replies and
accessibility. Removing the task-digest comparison or stop-marker revocation fails
three/one store cases. Initial HTTP fixtures failed until they supplied the real
receiver subscriptions required for connected claims; the security check was not
weakened. Logs use `dashboard-reassignment-*-final.log`. These fixtures do not
prove native resource cleanup, full destination/receiver continuity or deployment.
An additional transport fixture verifies the dashboard supplies both the channel
and canonical task preconditions at the actual RPC boundary for reassignment and
missed decisions; the real broker/store cases independently prove commit refusal.

The review-phase uncertainty milestone passed 364 parent tests/three skips with
local native integration enabled, 760 focused repetitions and 22 browser cases,
plus syntax/build/whitespace checks. Tests cover both report/stop orderings,
same-attempt/actor refusal, old stop-command replay, retained reports/evidence,
pending-hint cancellation, separate tasks' hint isolation, schema-8-to-9 migration
without byte rewrites, restart, transaction rollback and occupied capacity. A real
broker case checks master refusal and passive attention despite a fresh native
idle snapshot, followed by a new stop receipt and explicit master acceptance.
Two browser cases exercise the held review and report preservation in both themes.
Removing review-phase uncertainty/cancellation fails three/four negative probes.
The initial light-theme warning-title contrast failure was fixed using theme text
color; accessibility checks were not weakened. Logs use `review-uncertainty-*`.
This proves broker record ordering, not native observation freshness, authenticated
ownership, per-handle cleanup or post-terminal callback reconciliation.

## Terminal stop-confirmation holds

A completed task remains the master's historical acceptance; cancellation also
remains recorded. Later matching adapter uncertainty on a dispatched task sets a
separate `terminalHold` without reopening/reassigning/reexecuting it or deleting
its report and historical stop record. The Tasks view shows the hold explicitly.
Historical stop evidence is not then a current release receipt.

The hold occupies broker channel/conversation capacity, blocks new dependent
dispatch and managed workspace admission (including already-approved admission
attempts), protects monitoring retention and counts as unresolved/attention even
beside fresh native idle telemetry. It does not interrupt already-running tasks.
OpenCode and Codex runners preserve the journal rather than retiring/replaying
held work; task pull returns `task: null, held: true` without preparing another
attempt. No dashboard command clears the hold. A new matching adapter stop receipt
clears only that broker hold; it does not rewrite acceptance or resolve incidents.
Old stop-command replay, duplicate evidence, unrelated actors and stale attempts
cannot clear it. Never-dispatched cancelled tasks cannot become a claim on
unrelated native execution through this field.

Schema 10 preserves old state bytes during migration and makes older binaries
refuse the new hold semantics. Missing legacy fields do not prove quiescence.
Exports preserve the hold and retain schema-4–9 reader compatibility. This is
broker bookkeeping, not native owner authentication, observation freshness,
resource/alias census, physical release or production cleanup authority.

The terminal-hold milestone passed 372 parent tests/three skips with local native
integration flags, 800 focused repetitions, 24 desktop-light/mobile-dark browser
cases, syntax checks, dashboard build and whitespace checks. Six store cases
exercise completed/cancelled ordering, old stop replay/duplicate evidence,
capacity, dependent dispatch, approved managed admission, never-dispatched refusal
and schema-9-to-10 migration without state rewrites. Both adapter fixtures retain
their exact journal bytes across reconstruction and make no duplicate native
execution/report wake; pull remains held. An authenticated broker case keeps fresh
idle telemetry at attention after acceptance, and the browser preserves completed
status beside the explicit hold. Missing capacity, journal-retention or managed
guards fail two/two/one negative probes. Logs use `terminal-hold-*-final.log`, with
the full accepted run `-all-current-final.log`. This does not establish genuine
native stop-observation freshness or the missing release/re-establishment ports.

### Terminal hold-generation fence

Schema 11 adds `terminalHoldGeneration`, advanced by each new terminal uncertainty
command. The terminal stop callback must carry its observed `holdGeneration`.
Missing, zero, stale or future generations refuse settlement without a new receipt;
another uncertainty invalidates an older callback even when the task ID/attempt
and historical completion have not changed. The Tasks warning displays the broker
generation. Replaying an earlier accepted stop receipt does not clear a new hold,
and retrying the same uncertainty command does not advance its generation twice.

Legacy schema-10 holds without a generation remain held at zero after byte-
preserving migration; neither a guessed counter nor migration grants release.
Exhaustion saturates at the maximum safe integer and cannot settle by callback.
The terminal-generation milestone used schema 11; schema 13 subsequently added
the active/review and lifecycle-callback ordering fences below. That milestone
accepted schema-4–12 exports. Current storage compatibility is documented in
[the control-plane overview](control-plane.md#storage-and-trust-boundaries).

An approved observer must freeze the generation **before** collecting native proof.
It must not query the latest counter afterward to retag an obsolete observation.
A matching counter is necessary for terminal broker settlement, not sufficient
for native ownership, actual observation freshness or physical resource release.
This terminal milestone did not implement active/review observation epochs or the missing
authenticated native observation/release ports. Runners remain refusal-only while
terminally held; no automatic observer, callback retry or permission bypass is added.

### Active/review stop-ordering fence

Schema 12 retains `stopGeneration` independently of terminal hold generations.
Every new nonterminal `task.uncertain` advances it and removes usable stop evidence;
participant reports stay intact. After an advance, a callback must carry the exact
generation frozen before proof collection. Missing/stale/future values fail even
with new command/evidence IDs. An already-committed stop retry returns its old
receipt but cannot restore eligibility. Saturation refuses settlement; no lifecycle
transition resets this counter. The existing review-attention/capacity guards remain.

Original dispatch journals bind both runners to their earlier generation. A mismatch
retains the journal without native execution/report replay, including after restart.
A successful/replayed stop receipt is rechecked against current usable stop evidence
before progressing toward a report wake. There is no automatic re-observation or
atomic broker-to-native wake authorization. Legacy generation zero preserves earlier
callback compatibility, not retrospective freshness. Admission-uncertainty callbacks,
authenticated native/source epochs, ownership, physical cleanup and production ports
remain unproven; matching broker metadata is not release authority.

Verification: 404 parent tests passed/three skipped (407 total) with local native
integration, 940 focused repetitions and syntax/whitespace checks. Nine new cases
cover successive uncertainty in active/review, restart/replay, byte-preserving
schema-11 migration, exhaustion/rollback and both runners at artifact/stop response
boundaries. Both adapters also preserve pre-upgrade zero-generation command
fingerprints after a lost stop receipt and legacy journal reconstruction. Removing
generation matching or advancement fails three cases each.
No dashboard UI, installed runtime, native extension or movement switch changed.

### Admission/start/progress callback fence

Schema 13 applies the same `stopGeneration` contract to every admission outcome,
start and progress callback. An old exact native admission key cannot bypass the
explicit-uncertainty epoch check. Stale callbacks cannot promote uncertain work to
dispatching/running, change admission evidence or refresh progress bookkeeping.
Existing lifecycle/identity requirements still apply after a generation match;
matching metadata is not physical release or proof freshness. Replayed committed
callbacks return their original receipt without restoring an older state.

Both runners attach the frozen journal generation when nonzero. Zero omits the
field to keep pre-upgrade command fingerprints intact. Schema-12 migration preserves
raw state and command receipts; the version bump prevents older reducers from
silently bypassing the fence. Export readers retain schema-4–12 compatibility.

Verification: 411 parent tests passed/three skipped (414 total), 1,010 focused
cases across ten runs, syntax/whitespace checks. Seven new cases cover three
callback classes, successive uncertainty, restart, historical receipt replay,
rollback, exhaustion, byte-preserving migration, authenticated wire refusal and
both runners' successful nonzero-generation dispatch after reassignment. Removing
each callback check separately fails three probes. Accepted logs use
`callback-generation-*-final.log`; negative probes use `callback-generation-*-red.log`.

### Admission uncertainty and deferred report notices

Schema 14 also advances `stopGeneration` for an uncertain admission outcome.
Earlier admission/start/progress/stop observations cannot settle that new epoch;
retries of committed commands still return their original immutable receipts.
Migration from schema 13 preserves raw state and receipt bytes; export readers
accept schemas 4–14. Older reducers must refuse schema 14.

Both runners durably capture a fresh observation generation only for their own
lost-admission receipt and unchanged dispatch binding, before native evidence
collection and without reusing cached execution proof. OpenCode's exact native
admission ID supports retry; Codex must find its exact existing native turn and
never retries the start mutation.

Deferred report notices additionally recheck the current broker task after
native scope/snapshot reads, including exact stop evidence and generation. New
uncertainty during those reads preserves the journal and prevents a report wake;
a healthy deferred notice still reaches participant review. This is a broker
eligibility check, not atomic native wake exclusion, ownership or release proof.

No UI, installed runtime, global settings, native extension, effective permission,
native Protocol/HttpApi or movement activation changed. Admission-outcome uncertainty
does not advance this explicit-uncertainty counter; native observation/source epochs,
other callbacks, atomic native wake exclusion and ownership/release ports remain open.

Verification: 377 parent tests passed/three skips with local native integration,
800 focused repetitions, 24 browser cases, syntax/build/whitespace checks. Five
new store cases cover intervening uncertainty, receipt replay, missing/future/
foreign generations, legacy migration, saturation and rollback; the real broker
and both browser layouts reject an old generation while the next remains held.
Removing generation matching/advancement fails three/four probes. Logs use
`terminal-generation-*-final.log`; no native runtime/configuration or movement
activation changed.

For a separate read-only terminal feed without a browser or master, see
`control-admin notifications-watch <channel> [intervalMs]` in
[operator notifications](operator-notifications.md). It reads the same durable
pending inbox; it cannot acknowledge, approve, resolve, execute or reclaim capacity.
Console delivery is not native OS notification acceptance.


Recovery approval previews include the exact requested wake policy and native
admission/evidence identifiers, requester, generation and policy revision.
Retry success schedules receiver recovery; it is not proof of native admission.
Changing the proposal while the confirmation is open invalidates the preview.
Previewing or closing it does not approve the action. This boundary has HTTP
and desktop/mobile browser coverage with the real broker.


### Explicit receipt-capacity recovery

Receipt reclamation, introduced with schema 15, supports a separate operator CLI flow
to reclaim live command receipts from a verified private archive. The dashboard
Storage view reports the bounded `archived_commands` index as well as live
receipt pressure. Referenced archives preserve exact retries and become required
private storage; reclaiming receipts does not remove unresolved evidence or
clear a scheduling fault. See [operator commands and limits](control-receipt-reclamation.md).
