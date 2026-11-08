# Durable operator inbox

The control-enabled broker exposes a metadata-only operator inbox, visible in
the dashboard's **Notifications** view. It is independent of masters and model
wakes. A notification is an existing durable control event, not a second
delivery/effect queue. The original transaction either commits the event or
rolls it back; there is no enqueue gap. Existing matching historical events
also appear after migration. No production execution/movement switch is enabled.

Supported event types are `incident.opened`, `action.requested`, `action.failed`,
`action.uncertain`, `task.reported`, `task.uncertain`, `election.inconclusive` and
`worktree.uncertain`. This is limited coverage, not every failure,
storage/health observation, authority change or managed lifecycle event.
An action-request notification is historical, not a claim that approval is still
pending. Inspect the current source record before acting.

Each record contains only its immutable event ID, channel, sequence, type,
timestamp, optional entity ID and acknowledgement timestamp. No collaboration
text, transcripts, native errors, authentication headers or credentials are
included. Reading, pagination, previewing, reloading and disconnecting never
acknowledge a record. Every newer matching event has its own ID and remains
pending even if an older event concerning that entity was acknowledged.

## Acknowledgement is only “seen”

The dashboard requires its normal separate login, allowed channel, CSRF,
preview, explicit confirmation and actual-send session revalidation. Confirmation
records a separate SQLite receipt for that exact event ID. The event and all
control state are unchanged: no incident is resolved, task accepted, approval
answered, capacity reclaimed, lease renewed, message replayed or native resource
released. A later source resolution does not silently acknowledge its notice.
The dashboard also supplies its channel preview precondition, checked inside the
acknowledgement transaction; a changed policy/role rejects an uncommitted ack.
Exact previously committed receipts remain retrievable despite stale preconditions.

The broker methods `control_notifications` (channel/sequence page, pending-only
page or exact ID lookup) and `control_notification_ack` (exact channel/ID) are
operator-only. They do not accept actor context or message text. The browser
uses only scoped dashboard routes; the broker credential remains server-side.
They remain diagnostic under scheduler quarantine and cannot clear it. Store
faults still refuse reads/writes. `control_info` advertises
`operatorNotificationsSupported` when the control plane is enabled.

A lost acknowledgement reply is not automatically resent by the dashboard.
Use **Check receipt** to inspect the exact notification's `acknowledgedAt` field;
absence is not proof that an in-flight request cannot still commit. Controls in
that uncertain view stay disabled. A deliberate broker-level retry of the exact
ID returns the original timestamp, including across restart and at receipt
capacity. It does not mark later events as seen. These are notification receipts,
not control-command or native-execution receipts.

## Read-only operator CLI watch

For a headless terminal consumer, using the same private operator state/URL and
supported Node version as the other admin commands:

```sh
npm run control-admin -- notifications-watch development
# Optional interval, milliseconds (1,000–60,000; default 15,000):
npm run control-admin -- notifications-watch development 1000
```

This is explicit opt-in, not an installed daemon or OS desktop notification
service. It uses the existing private `admin-token` file; no credential is passed
in arguments or output, and it must never be registered as a model tool.

The command writes JSON lines: `event: "notification"` with a typed pending
metadata record, then `event: "watching"` after the first successful bounded read.
The latter is not a healthy-scheduler, caught-up, continuous-coverage or delivery
guarantee. Only the requested channel is emitted. No task text, transcripts,
provider errors or authentication headers are included; keep even metadata logs
private. Do not pipe the output into an approval/replay/cleanup executor.

Each poll reads at most four pages of 30 pending notices. Polls and output writes
are serial; output backpressure is awaited. Already-emitted immutable IDs are
deduplicated in memory, not acknowledged. The default 8,192-ID emission budget
fails visibly rather than silently evicting history. Wrong-channel, malformed,
already-acknowledged or inconsistent pages and changed immutable IDs stop the
monitor. Failure/disconnect/output errors exit without automatic reconnect or
resend. Restart explicitly after inspection. A restart can redeliver pending
stable IDs; there is no exactly-once console/OS/human receipt claim or durable
local cursor. The original broker inbox and explicit seen receipts remain final.

Ctrl+C/SIGTERM shuts down the POSIX CLI; already-admitted writes are awaited, not
declared cancelled/absent. Windows does not provide the same catchable SIGTERM
semantics, and actual Windows console acceptance remains open. A failed output
receipt stops that monitor instance; it never marks a notice seen. Read-only
watching works at full command-receipt capacity, but does not recover capacity or
prove that every producer observation was persisted. Silence proves no health,
coverage, resource absence, native stop or permission to replay.

This read-only watcher provides no native OS delivery, unattended installation,
automatic restart policy or durable native submission receipts. OS/IDE deployment
acceptance remains separate. The CLI watches only eight inbox event classes, not
every health/storage condition or native process.

## Storage and verification boundary

Schema **8** adds `notification_acks`, keyed by the original event ID with a
foreign key to retained events. Migration preserves raw control state and
receipts. Old binaries must refuse schema 8; do not downgrade its version marker.
The default acknowledgement limit is 8,192; pressure is reported as
`notification_acks`. Full acknowledgement capacity refuses new acknowledgements,
not reads or exact prior receipt lookup, and consumes no command receipts.
Overall database/disk exhaustion can still prevent writes. No receipt or
unresolved event is automatically removed to recover capacity.

Matching events are durable and excluded from the existing 30-day rolling
telemetry prune. Seen receipts are retained, too. Private exports use schema
version 17 (including verified command-receipt/history and cold entity indexes) and include
`notification_ack` records; exports are not reclamation,
restore approval or public/redacted backups.

Local store, real broker/HTTP and real browser tests cover event/ack rollback,
orderly restart, reconnect/lost replies, quotas, clock refusal, metadata privacy,
channel/admin boundaries, source-state preservation, guarded confirmation and
accessibility on desktop-light/mobile-dark layouts. They do not prove abrupt
process/power-loss durability on every platform or production deployment.

This is an inbox, **not OS background delivery**: the dashboard refreshes while
visible and does not request notification permissions or run a service worker.
Unattended/native OS delivery, broader event/health/storage coverage,
Windows/IDE acceptance and alert operational/recovery workflows remain open.

Initial inbox verification: 340 parent tests passed/three skipped with local native
integration flags enabled, 280 focused repetitions, 14 real browser cases,
syntax checks and dashboard build. The isolated OpenCode service reported
2.0.31; its health version is checked against its own `/api/info`, not a fixed
2.0.28 string. No installed runtime replacement or production activation occurred.

The CLI-watch milestone passed 395 parent tests/three skips (398 total) with local
native integration enabled, 270 focused inbox/watch repetitions and syntax/
whitespace checks. Eighteen new cases cover real CLI delivery/restart, read-only
behavior at full command capacity, admin refusal, disconnect, actual output-pipe
failure and metadata privacy, plus controlled pagination, concurrent polls,
scope/cursor/immutability checks, bounded memory and cancellation through admitted
output settlement. Dropping deduplication, stop-on-output-failure or channel checks
fails two/one/one negative probes. Logs use `notification-watch-*-final.log` and
`notification-watch-*-red.log`. No installed runtime/configuration, model/harness
permission, database schema or movement switch changed. This verifies the terminal
metadata path, not native OS delivery or Windows/IDE deployment acceptance.


Schema-16 explicit verified history reclamation can release eligible old
acknowledged alert events and acknowledgement rows from live quotas. Both must
be at least 30 days old and outside protected unresolved references. Archive-backed
lookup preserves exact notification IDs, acknowledgement timestamps, historical
pagination and exact acknowledgement retries after restart. Pending notices and
unresolved evidence stay live. Export alone still reclaims nothing. See the
[current execution ledger](remaining-development.md#storage-follow-through).

The separate [operator-attention process](operator-attention.md) adds durable
native submission classification and reconnect/outage handling. Neither a native
utility receipt nor its private journal is a broker seen receipt or proof of human
delivery; OS installation and actual desktop/IDE acceptance remain separate.
