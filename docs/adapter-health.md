# Passive adapter health snapshots

Health monitoring is **observational**, separate from native execution, recovery
evidence and task acceptance. Neither an `idle` observation nor a live receiver
proves native stop, permission equivalence or safe replay. Nothing here selects a
model/agent, changes instructions/permissions, answers a blocker, moves a session
or enables task/worktree execution.

## Opt-in producers

Enable the broker's existing control plane and explicitly enroll the participant
host's separate adapter credential, as described in `control-plane.md`. Ordinary
host/session credentials cannot write health reports. The reporter must also be
the exact currently subscribed receiver for that session.

For OpenCode V2, add `health: true` to the **existing server plugin options**,
preserving the existing broker URL/token/credential directory and other options:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "file:///absolute/path/turnlink/adapters/opencode",
    "options": {
      "url": "ws://127.0.0.1:47321",
      "tokenFile": "/private/workstation.token",
      "credentialDirectory": "/private/turnlink-session-keys",
      "control": true,
      "health": true,
      "adapterTokenFile": "/private/adapter.token"
    }
  }]
}
```

This is not a CLI setting; the passive CLI alert feature has its own opt-in.
Health reports never appear in model inboxes. The OpenCode observer checks the
exact native Location/session, observes permissions/questions using a private
copy of blocker state, and uses a bounded native wait to observe idle. A timeout
means **unknown**, never idle or stop proof. It cannot clear the delivery runner's
live blocker/form sets. Generation/membership checks discard late observations.

For the Codex stdio proxy, explicitly set `AGENT_CHANNEL_HEALTH=1` together with
`AGENT_CHANNEL_CONTROL=1` and its enrolled `AGENT_CHANNEL_ADAPTER_TOKEN_FILE`.
Task execution flags are unnecessary for monitoring. Health derives only from
the proxy's observed native lifecycle, approval set and Turnlink queue/receipts.
Unknown resumed lifecycle stays unknown. No extra native mutation/read RPC or
model call is issued to manufacture a healthy state; the native version is left
unreported when unavailable. This does not cover unproxied native processes.

Both producers default off, throttle to one new sample per 15 seconds per bound
session, coalesce concurrent samples and discard stale scope after asynchronous
reads/credential/connection waits. Cleanup aborts monitoring. A lost/failed report
is not resent as a fresh observation: the next interval samples again. No global
configuration or running production service is modified by this implementation.

## Operator and participant views

- The dashboard's **Health** view uses the same local authentication, CSRF/Host/
  Origin protections and channel allowlist as all other views; it is read-only.
- `npm run control-admin -- query <channel> health` is an operator read.
- `channel_status` with `view: "health"` lets an ordinary participant inspect its
  own row. Only the operator or verified, connected, lease-current master sees
  other participants' rows in that channel. No master is needed for publication
  or operator monitoring. Queries remain available during scheduler quarantine.

The view separates live receiver connectivity from native health observations:

- **Unreported:** connected member, no observation. Opt-out/unsupported adapters
  are not falsely reported healthy.
- **Disconnected:** no current receiver; an old native snapshot is not current.
- **Stale:** the last report is at least 45 seconds old, from a prior broker run,
  or in the future relative to the broker clock.
- **Unknown:** a fresh sample cannot establish native activity.
- **Attention:** a fresh sample observes blockers or uncertain Turnlink messaging,
  or the broker has an uncertain claimed task or a pending review without usable
  stop evidence or a terminal stop-confirmation hold. Even a fresh `idle` snapshot
  cannot settle that task hold.
- **Observed:** recent typed metadata, **not** a general healthy/stop/completion
  guarantee. Busy/idle remain observations, never admission authority.

Counts cover the Turnlink queue, observed blockers and uncertain message/role
admission receipts, not the full harness inbox/transcript. Task uncertainty is
derived separately from authoritative task state. Missing receipt-journal data is
unreported, not an invented zero. Feature flags describe adapter configuration,
not new execution grants; managed worktrees are explicitly false.
The `uncertainTasks` counter includes pending reviews requiring stop confirmation,
and completed/cancelled tasks with `terminalHold`, not only tasks whose status enum
is `uncertain`. Participant reports remain intact
when fresh uncertainty invalidates review eligibility. Counts remain observational
and never authorize release, acceptance or cleanup.

## Privacy, retention and storage

Reports accept only a fixed typed metadata schema: adapter/native version,
native status enum, bounded counts and feature booleans. Broker-owned identity,
channel, receipt time and run ID cannot be supplied in the report. No prompts,
instructions, paths, provider responses, auth headers, credential values or
native message content are exported through this surface. Credentials are used
only for authenticated transport; the existing warning about secrets manually
pasted into collaboration content still applies to those other surfaces.

SQLite schema 7 adds an indexed, bounded **latest snapshot** table (4096 agents),
not a full native history or command-receipt stream. Subsequent reports replace
that agent's observational snapshot, never evidence, audit, control state or
command receipts. Old binaries must reject schema 7. Migration does not rewrite
existing raw state/audit/command receipts. Health snapshots participate in private
consistent exports. Current exports use overall control schema 17 (including
verified command-receipt archive indexes); readers retain support for schema-4–14 exports.

Old inactive snapshots can be pruned after 30 days, with strict cutoff, clock
regression checks and explicit unresolved-agent/evidence protection. Health shares
the monotonic observational clock with activity metadata. Missing protection sets
and corrupt indexed candidates refuse deletion. Latest health is never accepted
as durable native stop/admission evidence, including after export or restart.

Capacity or write failure does not evict another snapshot, consume command receipt
capacity, reject an already-durable message, replay a delivery or clear scheduler
quarantine. Failed health writes contribute to visible observational-loss counts;
old observations age to stale. Operator storage pressure includes health-row
capacity. Native lifecycle reads and monitoring failures never change harness
approvals or task/worktree activation switches.

## Verification and remaining gates

```sh
npm run test:health
TURNLINK_OPENCODE_INTEGRATION=1 TURNLINK_CODEX_INTEGRATION=1 node src/run-tests.js
npm --prefix dashboard run build
npm --prefix dashboard run test:e2e
```

Tests cover strict privacy bounds, exact enrolled receiver/session/channel scope,
unknown/stale/prior-run/disconnected states, no control-state/audit writes, row
capacity, protected retention/corruption, exports, additive schema-6 migration,
publisher race/throttling behavior and isolation of native delivery blockers.
The real isolated OpenCode service and Codex model fixtures additionally prove
that enabled native adapters publish health while preserving task/permission
flows; OpenCode checks no model wake. Browser tests cover the actual read-only
Health view in desktop/light and mobile/dark with accessibility checks.

This does not complete broader operational acceptance: actual Windows/IDE
deployment evidence, durable background alert acknowledgement/delivery, safe
storage reclamation and native worktree/execution recovery gates remain pending.
