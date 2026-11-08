# Verified historical capacity recovery

SQLite schema 18 retains explicit operator-controlled recovery of event, settled
notice, acknowledgement, hot entity-count and hot serialized-state capacity.
Keep the control database and every referenced private export together. A
completed export alone still reclaims nothing.

Create and verify an export, retain its UUID and SHA-256, then run:

```sh
node src/control-admin.js storage-reclaim-history EXPORT_UUID VERIFIED_SHA256 BEFORE_UNIX_MS
```

The cutoff must be at least 30 days before the broker's current time. The operator
must authenticate; participant/model tools cannot call this operation. The
repository API is `store.reclaimHistory(archives, { id, digest, before }, now)`.
It checks the exact archive contents against current live records before an
atomic SQLite transaction moves any data. Reusing the same archive UUID returns
the original counts; changing its cutoff or digest refuses. It never sweeps
records created after the approved snapshot. Failed commits preserve live state
and permit retry with the original request.

Unresolved tasks, terminal stop-confirmation holds, open incidents, executing or
uncertain actions/transitions, pending notices and active role assignments pin
their referenced graph. Dependencies pin prerequisite tasks; evidence, artifact,
preview and transition references are traversed in both directions. Channel audit
events remain live while that channel has unresolved work. Managed resources stay
pinned until a validated create record and matching removed receipt are both
present and older than the cutoff. Failed, rejected or created status alone does
not prove resource absence. Reclamation does not remove native resources, accept
task results, resolve incidents or release execution capacity.

Eligible old events move to an archive index. Pending notification sources always
stay live. An acknowledged source moves only when both event and acknowledgement
are old enough and outside the unresolved graph. The original acknowledgement
timestamp remains available for exact retries and clock checks. Event and inbox
pagination merge hot and indexed history by immutable sequence. Acknowledged
alerts remain historical; seen status still does not resolve an incident.

Accepted and cancelled notices can move outside the protected graph. Pending
notices stay live. Exact notice-acceptance retries preserve their original native
receipt and still reject conflicting receipts; offer-acceptance evidence remains
available through cold lookup. Role authority still comes from the current broker
assignment, not from an archived notice.

Old credential enrollment/revocation audit metadata can also move into bounded
cold storage. Its original sequence, host ID, action and timestamp remain in
verified archives and later exports. The active credential registry,
authentication digests and enrollment secrets remain in their existing private
tables; reclamation never exports, deletes, recreates or grants those
credentials. This permits a subsequent real revoke or enrollment when the old
historical audit budget was full.

Terminal task collaboration text can move into the verified archive. Its live or
cold metadata retains task identity, dependencies, claimant, attempt, dispatch
binding, artifact references, stop evidence and all hold/generation fields. Reads
hydrate the exact original title, instructions, criteria and result summary.
Changed immutable payload or malformed placeholders refuse rather than losing
new content. Current lifecycle metadata is authoritative in SQLite; the archive
is never rewritten to pretend a later hold existed earlier.

Eligible closed tasks/actions/incidents/evidence/previews/transitions and proven
removed managed records can move from the hot JSON arrays to bounded cold
metadata rows. Every ordinary query, authority check, dependency check, task
selection, health projection and snapshot sees the merged current state. Late
uncertainty on a cold completed/cancelled task atomically updates its cold hold
and generation, even when all hot task slots are full. Old stop receipts cannot
clear a later hold. A fresh matching stop removes only that hold; it does not
resolve other incidents or perform cleanup.

The storage bounds remain explicit and finite:

| Resource | Default bound |
| --- | --- |
| Hot tasks/actions/incidents/previews/transitions/managed records | 4096 per kind |
| Cold metadata for those kinds | 4096 per kind |
| Hot evidence / cold evidence | 16384 each |
| Hot credential audit / cold credential audit | 4096 each |
| Combined historical event/notice/payload/entity index | 100000 rows |
| Stored hot JSON | 64 MiB |
| Materialized merged JSON | Twice the configured hot byte limit (128 MiB by default) |
| Export files | 32 files, 512 MiB total, 256 MiB per file |

Pressure reports hot and per-kind cold quotas separately, plus hydrated bytes and
the combined historical index. Filling cold metadata is not hidden by a low
aggregate index percentage. Hot and cold limits are independently enforced;
reaching either bound refuses before deleting records. Public/standalone state
validation and reducers retain their original hot limits. Only trusted repository
materialization uses explicit doubled cardinality bounds. Exports declare schema
17 for expanded state; earlier export schemas cannot reinterpret it.

Command-receipt capacity uses the separate `storage-reclaim` flow documented in
[control-receipt-reclamation.md](control-receipt-reclamation.md). This history flow
never drops command receipts. Live authentication registries, active effect
intents and unresolved evidence are not silently expired. Credential-audit
metadata has the explicit historical path above. Quotas without an eligible old
verified record still refuse safely;
this is bounded capacity recovery, not unlimited unattended retention.

Required archives are integrity-checked on startup and before mutations. A missing,
corrupt, insecure or mismatched file blocks writes/restart. Restore the exact
original private bytes and permissions to recover; recreating a different export
under the old UUID is not restoration. Later complete exports preserve current
state plus indexed command/event/notice/ack/credential-audit history, but do not automatically
retarget existing indexes or make older referenced files disposable. There is no
automatic archive deletion, index expiry or broker/native-journal import API.

Reads are synchronous, bounded work. Large indexed exports may require reading
and validating complete private files on the broker event loop. A small cache
retains at most 4 MiB of serialized source data (decoded objects have additional
heap cost); bigger files are not retained in that cache. Related reads within an
operation reuse parsed records rather than repeatedly decoding the same file;
that temporary view lasts only for the operation and is bounded by the configured
export capacity. Archive byte/count and
hydrated-state bounds limit work, but this is not a constant-time lookup or a
production latency benchmark. Keep deployment workloads within those limits and
review larger retention needs explicitly.


Provider contexts introduced in schema 18 remain protected while their transition
is prepared, established or uncertain. A construction receipt does not prove
resource disposal. Its plan, task and linked history stay pinned; successful
construction cannot make this evidence eligible for reclamation. Older schema
exports remain readable, but provider-establishment records require schema 18.


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
