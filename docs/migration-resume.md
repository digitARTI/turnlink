# V2 migration resumption — 2026-10-23

> **Current scope, 2026-11-08:** Gate 2 is closed for the operator-approved
> manual-resume path. The separate investigation of universal automatic native
> guarantees is closed with limitations; native movement remains disabled.
> The next workstream is managed worktree creation and cleanup, followed by
> operational acceptance, without reopening the native-guarantees task. The
> earlier gate status and order below are historical; see the
> [current checkpoint](control-plane-roadmap.md#gate-2-operator-approved-manual-scope--2026-11-08).

The authoritative scope remains [the full control-plane plan](control-plane-roadmap.md)
and [its contracts](control-plane.md). The initial V2-only adapter migration is
implemented. Completing that migration did not complete the subsequently agreed
coordination platform.

## Recovered checkpoint

- OpenCode conversation: `ses_ec84ae6b0fferrBRC33HwePxVn`, titled
  “Planning migration to OpenCode v2 and functionality improvements”.
- The session stopped on a provider usage limit after running the admission-epoch
  integration suite. Its later status request also failed on that limit.
- The last source changes advance the callback generation on uncertain admission
  outcomes and persist an observation generation before either runner collects
  fresh recovery evidence. The code already uses SQLite/export schema 14; the
  top-level documentation still described schema 13 and is now corrected.
- Historical final log: `admission-epoch-all-final.log`, 423 passed, three skipped.
  This was checked against the saved conversation, not assumed from goal status.
- Existing uncommitted changes, native patch and isolated native checkout are
  retained. Work continues on `migration-resume`, branched from `f372087`, in the
  existing checkout so those changes remain available. No prior work was reset,
  stashed or automatically committed.

## Current gate status

| Gate | Verified implementation | Remaining work |
| --- | --- | --- |
| V2 adapter and existing-cwd tasks | V2-only messaging; opt-in OpenCode and Codex claim/admission/evidence/report/master-acceptance flows | Deployment and live-model/platform acceptance |
| Native worktree continuity | Grant/journal/snapshot primitives; isolated OpenCode reservation patch | Authenticated owner contract, complete destination authority, native exclusion, quarantine recovery, exact receiver rebind and production adapter wiring |
| Managed creation/cleanup | Default-off lifecycle/host bridge; real Git and process-crash fixtures | Production exclusion/use-safety ports and adapter integration |
| Recovery operations | Broker-local pause/resume/never-offered cancellation; uncertainty fences | Evidence-bound retry, wake-policy and member-removal executors |
| Observability/storage | Metadata telemetry/retention, private exports, native health, pressure views | Safe receipt/capacity reclamation, broader coverage and durable background alerts |
| Dashboard/alerts | Authenticated console, durable event inbox, notification-watch and passive OpenCode hints | Broader workflows and actual OS/Windows/IDE delivery |
| Operational acceptance | Isolated deterministic native/service/process/browser fixtures | Windows/IDE, live-model, deployment review and remaining failure/storage cases |

## Work performed on resumption

1. Recovered the original user scope and latest implementation steps from the
   OpenCode database using a read-only connection; compared source, tests and
   historical logs with the roadmap.
2. Established a fresh baseline using Node 24.21.0: ordinary suite 420 passed,
   six skipped; all three native integration flags enabled, 423 passed,
   three skipped; syntax checks passed.
3. Reproduced a deferred-report race in both runners. New broker uncertainty
   arriving during native scope/snapshot reads revoked stop evidence, yet both
   runners still submitted a report wake. Both regression tests failed with an
   unexpected report count of one.
4. Added a fresh broker eligibility check before report submission, requiring
   the same dispatch binding, exact stop-evidence ID and observation generation,
   eligible status and no terminal hold. Refusal preserves the original journal.
   Added healthy deferred-report controls as well as both race reproductions.
5. Updated schema/export documentation and this checkpoint. Final verification
   and review results are recorded below.
6. Fixed the existing browser review-recovery fixture: it omitted the generation
   required after uncertainty. Its desktop/mobile cases now explicitly reject a
   stale stop callback, then submit newly generated fixture evidence against the
   captured current generation. Production generation checks remain intact.

## Fresh verification

All commands used Node 24.21.0 via a command-local `PATH`; no global runtime
configuration was changed.

| Check | Result | Log |
| --- | --- | --- |
| `TURNLINK_CODEX_INTEGRATION=1 TURNLINK_OPENCODE_INTEGRATION=1 TURNLINK_OPENCODE_TUI_INTEGRATION=1 node src/run-tests.js` | 427 passed, three Windows-only skips, zero failures (430 total) | `/tmp/agent-channel-resume-final.log` |
| `node --test test/opencode-tasks.test.js test/codex-tasks.test.js` | 53 passed, zero failures, independently run by the reviewer | Reviewer verification |
| New deferred-report reproductions before the fix | Both failed: unexpected report wake | `/tmp/agent-channel-report-eligibility-red.log` |
| New race regressions and healthy controls after the fix | Four passed, zero failures | `/tmp/agent-channel-report-controls-final.log` |
| `npm run check` | Passed | `/tmp/agent-channel-resume-check-final.log` |
| `npm run dashboard:build` | Passed | `/tmp/agent-channel-resume-dashboard-build.log` |
| `npm --prefix dashboard run test:e2e` | 24 passed, zero failures, desktop-light and mobile-dark, including accessibility assertions | `/tmp/agent-channel-resume-browser-final.log` |
| `git diff --check` | Passed | Command output |

The initial browser run had 22 passes and two `STALE_STOP_GENERATION` failures
from the outdated fixture; that result is retained in
`/tmp/agent-channel-resume-browser.log`. The corrected complete rerun above is the
accepted result. Temporary logs may be removed by the operating system; the
commands and outcomes here are the durable checkpoint.

An independent read-only review found no actionable defects in the new report
eligibility guards and four regressions/controls. It did not review all prior
uncommitted changes or certify production native behavior. There are no deferred
minor findings from this scoped review. The browser fixture correction was made
after that review and verified by the complete browser rerun.

## Decisions and limits

- Ruling: retain the current checkout on a new branch rather than creating a
  clean worktree — the migration depends on substantial uncommitted work and the
  ignored native staging checkout. Cost: existing changes remain mixed in the
  working tree and need deliberate commit review.
- Ruling: finish the interrupted recovery milestone before extending native
  movement — it is the last verified conversation checkpoint and has a concrete
  reproducible defect. Cost: the broader continuity gate remains unfinished.
- The final broker eligibility read and native submission are separate effects.
  This fix does not close atomic broker/native wake exclusion or prove native
  ownership, process absence, resource release or complete destination authority.
- Historical native core results (7,147 passed, 43 skipped) belong to the prior
  isolated OpenCode patch milestone. They have not been rerun or relabelled as
  fresh acceptance in this resumption. The native patch was not modified.

## Next implementation order

1. Continue gate 2 at the authenticated owner-bound native contract and its
   durable intent/quarantine interface, using the existing isolated reservation
   extension. Set an explicit bounded acceptance case before extending coverage.
2. Resolve complete destination authority and exact same-session receiver
   continuity, then wire the production adapters and demonstrate approved grant
   → native effect → receiver rebind → task evidence → report → acceptance.
3. Complete production lifecycle use-safety, recovery executors and safe capacity
   reclamation; finish background alerts and operational platform acceptance.

The full platform remains incomplete. Feature activation requires each gate's
scope-matched acceptance; passing local fixtures does not authorize deployment.

The current native OpenCode source checkpoint is recorded in [its manifest](../native/opencode/manifest.json): full Core 7,178 passed / 43 skipped / zero failures, canonical 35 tasks, Core/Server builds, Server 85 passed / one skipped and the real helper activity regression verified. This supersedes the older failed full-suite result for the current exported patch. Complete native movement remains disabled and unfinished; see [remaining development](remaining-development.md).
