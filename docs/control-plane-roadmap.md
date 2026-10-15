# Full control-plane implementation plan

This resumes the full agreed plan in `control-plane.md`, not the narrower
OpenCode task-flow milestone. No production activation is implied by a passing
primitive or fixture. The operator's existing session, instructions, selected
agent/model, native permissions and approvals remain authoritative.

## Completed foundation

- Authenticated channel governance, voluntary master election/appointment,
  generation-fenced authority, supplemental role notices and lease maintenance.
- Durable task/dependency/schedule/capacity state, voluntary claims, adapter
  evidence, participant reports and explicit master acceptance.
- Broker-local pause/resume/never-offered cancellation with intent/receipt recovery.
- Opt-in OpenCode existing-session/cwd task execution, including real-service
  end-to-end claim → native execution → evidence → report → accepted result.
- Worktree approval/grant/journal primitives, offline destination observations
  and Codex stdio admission-fence primitives (not enabled movement).
- Operator-only storage status/watch and immutable private control exports with
  consistent SQLite snapshots, bounded downloads and integrity/restart checks.
  Export does not reclaim live capacity or replace broker/journal backups.
- Broker metadata activity observations, operator-only cursor reads, bounded
  30-day retention with unresolved-message/evidence protection and visible
  telemetry loss. Observations are not native admission/stop/replay evidence.
- Core loopback React/Mantine console: separate operator login/session, CSRF/Host/
  Origin protection, scoped real broker views and preview/confirm with transactional
  policy/authority preconditions. Desktop/mobile Chromium fixtures include axe,
  theme, untrusted-content, stale-preview and uncertainty checks. Read-only receipt
  lookup reconciles lost HTTP replies without resending commands. Not deployed.

## Delivery gates (in order)

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
3. **Managed creation/cleanup.** Participant-host worktrees, location preview and
   explicit approval, claim/revision revalidation, crash-safe creation receipts,
   explicit cleanup and dirty-worktree refusal without human force authorization.
4. **Remaining recovery operations.** Adapter-backed evidence-bound retry,
   wake-policy and member-removal executors with durable intents/receipts and
   policy/lease checks immediately before effects. Never bypass harness approvals.
5. **Observability and storage operations.** Turnlink activity/message telemetry
   (not full harness transcripts), master-independent monitoring, 30-day rolling
   retention, protection for unresolved evidence, archive/export and explicit
    storage-pressure alerts/recovery. No credentials or authentication headers.
    Control-state export, operator CLI pressure alerts and broker metadata activity
    retention are implemented/tested independently of the blocked movement gate.
    Safe verified archival/capacity reclamation, comprehensive adapter health,
    background/OpenCode alerts and recovery from full durable receipt budgets remain
    pending. No export prunes evidence; observational gaps never authorize replay.
6. **Operator dashboard and alerts — core console implemented.** React/Mantine, loopback-first authenticated
   backend, one human operator, session/CSRF/origin protections and scoped APIs.
   Channel/message/task/incident views, elections/modes/approvals, storage alerts
    and OpenCode CLI alerts. Broker/admin credentials never reach browser code.
    Core real views, bounded reads, guarded commands and in-page storage pressure
    are fixture/browser-verified. Advanced operator workflows, guaranteed background
    notifications/acknowledgement and OpenCode-native alerts remain pending. See
    `operator-dashboard.md`; do not equate Chromium fixtures with deployment proof.
7. **Operational acceptance.** Fault/restart races, actual Windows and IDE
   evidence, live-model acceptance, capacity/storage tests and explicit deployment
   review. Default safe-automatic recovery; production switches stay off until
   their individual gates pass. Claude task execution remains deferred.

## Completion boundary

The full platform is complete only when all gates above have implementation and
scope-matched acceptance evidence. Report tested primitives separately from
enabled operations. External/manual acceptance dependencies stay visible; do
not call an unfinished gate complete or silently narrow this plan to one adapter.

## Verification for the current milestone

```sh
TURNLINK_CODEX_INTEGRATION=1 TURNLINK_OPENCODE_INTEGRATION=1 node src/run-tests.js
npm run check
npm --prefix dashboard ci
npm run dashboard:build
npm --prefix dashboard run test:e2e
```

The suite includes both native local-model gates, actual proxy/native-process
restart and lost-response reconciliation, native MCP claim/report/review,
permission/elicitation preservation, human interruption, drift refusal and
default-off/worktree exclusion. Use the project's supported Node version.
