# Explicit receipt reclamation

Schema 15 can move command receipts from the live command budget into an
immutable private export. An operator supplies the completed export UUID and its
verified SHA-256 digest. The broker validates the complete archive and compares
each selected receipt with the live fingerprint and result before committing an
atomic archive index and deleting the matching live receipt rows.

This operation frees live command slots. It retains all control state, tasks,
evidence, events, notices, effect intents, credentials/audit and notification
acknowledgements. Unresolved work stays unresolved. It grants no native resource
release or execution permission. Exporting alone still reclaims nothing.

Each archived command UUID remains in a durable bounded index. Exact retries
read the original fingerprint/result from its verified private archive; changed
payloads still fail idempotency checks. Receipt inspection and subsequent
exports include these original receipts. Repeating reclamation with the same
export returns the original count and cannot sweep later commands. A failed
SQLite commit leaves the live receipts intact, and an operator may retry using
the same UUID and digest.

Referenced archives become required storage, not disposable downloads. Keep the
original `control/exports/UUID.jsonl` private and unchanged alongside the control
database. Startup refuses missing/corrupt archives. Restoring the exact original
private file permits verification and restart; generating a replacement archive
with the same UUID does not. There is no automatic receipt expiration or archive
deletion. Keep the database and all referenced archives together when moving or
backing up the control directory. This is still not a full broker/native-journal
disaster-recovery backup.

The index defaults to 100,000 command UUIDs, reported as `archived_commands`
storage pressure. Existing export count/byte limits and SQLite page limits still
apply. This does not recover an exhausted state, event, notice, audit or archive
budget, nor guarantee recovery from a physically full filesystem. Scheduler
quarantine remains conservative: reclaim capacity, inspect the state, then
restart to reconcile; reclamation does not silently clear a runtime fault.

The synchronous repository API is
`store.reclaimReceipts(archives, { id, digest })`; the archive directory must be
the store's private `exports` directory. It returns
`{ id, digest, reclaimed, replayed }`. Operator transport authorization is
enforced by the control gateway.

## Operator use

First download and verify an export using the existing operator command:

```sh
node src/control-admin.js export /absolute/private/control-export.jsonl
```

The result contains the export `id`, SHA-256 `digest` and `verified: true`.
Inspect the output and retain both the private download and the broker's original
archive. Explicitly reclaim the matching live receipts with:

```sh
node src/control-admin.js storage-reclaim <export-id> <verified-sha256>
node src/control-admin.js storage
```

The operator-only wire method is `control_storage_reclaim` with strict
`{ id, digest }`. A lost reply may be retried with those exact values: the
original reclamation count returns with `replayed: true`, and newer receipts are
not swept into the old operation. An existing archived command can still be
inspected with `receipt <channel> <command-id>`. Participants and model tools
cannot invoke reclamation, and no credential is included in these results.
