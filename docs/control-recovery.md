# Recovery executor acceptance

The opt-in broker executor handles `retry_delivery`, `change_wake_policy`,
`remove_member`, pause/resume and never-offered cancellation. Default channels
remain `safe`; `approval` requires explicit operator approval. The executor
rechecks the current master lease/generation, membership, admitted role notice,
policy revision and recovery evidence before committing its local effect.

Each approved action first commits a SQLite intent. The local effect and its
immutable receipt commit in one broker snapshot. Restart reconciles a matching
receipt without executing again, including after authority expires. An intent
without a receipt requires fresh authorization. The original three operations
retain their deployed v3 fingerprint algorithm, so upgrading does not invalidate
previously persisted pause/resume/cancellation receipts. New operations bind the
native admission key, recovery evidence and wake policy into their fingerprints.

`retry_delivery` success means the broker durably scheduled recovery. It is not
native admission, execution completion or an answer to a native approval. The
receiver uses `control_delivery_pull` with its session proof, separate adapter
credential and actual receiver socket. This returns current wake policy and an
exact action/message/evidence/native-key grant. The broker repeats authorization
when issuing that grant and refuses delivered or cancelled messages. Peer
messages cannot carry an authoritative recovery grant.

OpenCode retries uncertain admission only with matching native-idempotent
control evidence and a current approved action when recovery effects are enabled.
It uses the original deterministic native prompt ID, checks existing native
permissions/questions/forms, and preserves the selected agent/model/permissions.
The control-off baseline retains its native idempotent lost-response retry.
Codex refuses ambiguous native receipts and records uncertainty instead of
resending `turn/start` or `turn/steer`. Known native acceptance commits locally
before the broker finish RPC, retaining the exact recovery action ID. A finish
failure therefore retries the outcome after restart without another native call,
and broker acknowledgement waits for that outcome receipt.

The receiver records native admission/uncertainty with `control_delivery_finish`.
Its broker journal entry retains the exact action ID, native admission key and
adapter evidence ID. The evidence command ID is deterministic for the
{action,outcome} pair. If SQLite commits the outcome before the broker snapshot,
a later authenticated pull or finish retry reconstructs the result from that exact
evidence instead of granting another replay. A conflicting outcome for that same
action is refused even if the broker result was not persisted. Other adapter observations also use
immutable deterministic command IDs and a bounded local deduplication cache.
After an evidence-write failure or restart, a validated uncertain OpenCode ledger
can re-publish the same exact-ID capability without making a native call. Losing
a finish response cannot prevent that capability observation from being attempted.

`paused` withholds broker pushes and prevents already-queued adapter admission.
OpenCode passes `queue` or `steer` to the existing native prompt API. Codex
`queue` waits until its active native turn ends; `steer` uses the existing turn
when available. These policies never answer pending native approvals or override
harness permissions. Membership removal ends control roles before committing
broker membership deletion, cancellation of pending deliveries and the removal
receipt; receiver notifications follow persistence.

## Verification

The fixture tests cover intent rollback, crashes before/after local effects,
lease/policy/evidence invalidation, authenticated recovery access, cancellation
at the final grant boundary, action-correlated outcome reconstruction, legacy
receipt upgrades and native approval preservation.

`test/codex-control.test.js` runs an actual proxy/child-process protocol fixture
for paused/queue/steer and ambiguous admission refusal.
`test/opencode-recovery.test.js` exercises the broker and OpenCode runtime with
native response loss, explicit approval and a retained native permission blocker.

The opt-in isolated acceptance command is:

```sh
TURNLINK_OPENCODE_INTEGRATION=1 node --test test/opencode-service.test.js
```

It passed on OpenCode 2.1.3 with isolated HOME/XDG directories and a local model
fixture. The service receives actual queue/steer prompt requests; paused delivery
stays withheld. A temporary test plugin invokes the real native prompt API and
then loses one response. Recovery requires exact adapter evidence plus explicit
approval, waits for a real pending native permission to be answered by the test
operator, and receives the same native prompt ID on retry. The test verifies the
same session, agent and permissions. It does not modify the installed runtime,
global configuration or managed production services.

This acceptance does not prove physical Windows/macOS/Linux installation or
production service rollout. Codex ambiguity remains intentionally blocked;
there is no general permission to replay arbitrary native side effects.
