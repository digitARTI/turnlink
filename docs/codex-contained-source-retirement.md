# Codex contained source retirement

The optional retirement path is limited to source MCP owners that were launched
through Turnlink's local contained-owner mechanism. Before the worktree preview,
the host may capture a live, peer-correlated inventory and propose the exact
owners, aliases, Docker daemon, container IDs, operation IDs and wrapper PIDs.
The preview discloses both stop and removal and commits to the canonical list
with a digest. The broker copies that plan unchanged into the grant. A historic
grant without the plan cannot authorize this effect.

A resumed destination proxy does not currently execute retirement: it rejects
`AGENT_CHANNEL_CODEX_CONTAINED_RETIRE=1` before starting the native child. The
experimental coordinator requires the
matching approved grant, current receiver, source detachment and historical
native publication and source-shutdown observations. It rechecks broker
availability around effects and records container stop/removal intent in the
owner journal before dispatch. If an outcome is uncertain, a successor observes
the exact identity; it does not repeat an ambiguous effect. A known rejected
broker read may be retried, while the stop and remove operations are never
retried by that read retry loop. The receiver stays held throughout.

This is not complete source or remote-work reconciliation. It covers only the
captured containers and relies on point-in-time broker and Docker checks: it does
not establish atomic grant ownership across an asynchronous effect, exclude
external Docker operations, identify all source resources or prove remote work
has completed. The staging path is still experimental, the operator must be able
to inspect the full plan before approval, and this does not authorize movement
or close Gate 2.

An experimental broker fence and separately authenticated verifier can retain a
single authorized effect across a broker crash. The verifier used in the
integration fixture does not independently establish all native liveness and
source-resource guarantees. Reconnection under the fence is limited to the
existing receiver; delivery and task notifications remain suspended. If two
different revocation or authority-changing requests arrive under the fence, the
broker records their fingerprints in a bounded durable queue. Once the effect
is confirmed complete, each caller must resubmit its exact request in order.
The broker records replay intent before processing it; a crash or error during
processing leaves an uncertain outcome that cannot be replayed automatically.
An administrator can reconcile an uncertain session, host or adapter revocation
by resubmitting the exact original request to `control_codex_effect_reconcile_revocation`;
the broker advances only when its authoritative store confirms the revocation.
Other uncertain operations, unconfirmed revocations, queue overflow and legacy conflict latches remain blocked. Operators must
retain the fence rather than edit its state or retry an uncertain effect. The
production proxy remains disabled.

A process-local native witness now checks the actual publication and source
shutdown observations against the approved captured inventory and stays bound
to the exact grant, receiver, journal and native control connection. Native
control closure invalidates it. An experimental authenticated local bridge
binds a separate effect supervisor to that witness and drops its connection on
invalidation. The bridge is not wired into the production proxy. A connection
cannot by itself make an external container operation atomic with native
process liveness, and connection-loss detection is asynchronous.
An OS diagnostic can also inspect a local process's PID, parent and displayed
start time and reject an observed zombie or changed process. This is not a
dispatch credential: the displayed start time has one-second granularity, PID
reuse can repeat those values, and the process can die after the check. A real
native fixture shows that the OS can report death while the retained control
stream still appears open to the blocked JavaScript event loop. The OS
diagnostic does not establish process ownership, replace writer exclusion or
authorize a transition.
The native-death integration test blocks an already admitted removal, kills the
native app-server, then allows the removal to proceed. The removal completes
after native death; the supervisor reports uncertainty and retains the fence.
Recovery can observe this outcome, but does not prevent the operation. A real
broker-approved grant also fails to enable the production proxy before its
native child starts. Preventing or explicitly authorizing this post-loss effect
remains a prerequisite for enabling it.

Version 2 of the reviewable source-retirement plan explicitly states that an
admitted effect may complete after native loss, names the session/host/adapter
revocations intended to take effect immediately, and retains uncertainty until
reconciliation. Approval must repeat both the exact plan digest and the native
loss acknowledgement; version 1 grants cannot supply that acknowledgement.
This is a contract prototype: the experimental broker rejects every version 2
effect begin, and the production proxy remains disabled. A controlled test
delayed the verifier commit, applied adapter revocation, and then observed the
Docker operation begin; the desired revocation ordering is not yet implemented.

The separate `codex-effect-arbiter` prototype persists an operation digest and
prepares a durable intent before a final synchronous authority check and direct
child-process creation in one owner. There is no yield or disk write between
that final check and spawn. A crash retains its exclusive ownership marker and
an ambiguous intent; it cannot automatically replay or take over. This is
only a local ordering primitive. A binding-only wrapper has no dispatch method;
an experimental broker can bind it to the current grant only after checking the
actual held receiver and adapter authorization, then invalidates it before
potential authority-changing requests or receiver disconnect. After synchronous
sweep/tick work the broker rechecks the exact grant, held receiver, credential,
task and expiring evidence, invalidating the binding on any failure. Unchanged
authority survives a tick; elapsed idle evidence does not. This broker-local
check is not a native liveness or external-writer guarantee and cannot authorize
dispatch by itself. Synchronous authority checks or spawn can still delay
event-loop processing of a revocation, and spawning the Docker CLI is not
atomic with acceptance or execution by the daemon. Safe recovery of an abandoned
ownership marker and unregistered external writers also remain open. The local
operator CLI discloses the exact version 2 plan before sending an approval; the
dashboard does not currently offer worktree approvals.
Run `control-admin worktree-review <channel> <previewID>` to inspect the plan
and the exact approval fields before issuing a separate `control-admin command`.
Review and approval do not enable effect execution.

An additional single-owner preparation prototype binds an approved-grant
candidate to the process's checked effective UID and a private directory. It
does not expose a Docker or dispatch method. Intent and revocation are stored
in separate durable records; revocation closes the in-memory gate immediately
and its asynchronous persistence does not wait for stalled intent I/O. A
failed write leaves a faulted owner and retained ownership marker; a crash
does not authorize takeover or replay. The broker can bind this owner after its
own grant and held-receiver checks and invalidate it on revocation. The checked
UID is not proof of another process's identity or of a dedicated OS boundary:
parent directory ACLs, same-UID writers, privileged processes, inherited file
descriptors and access to Docker are not excluded. No dedicated account is
created or modified by this prototype.

One local diagnostic run (small, warm test state) measured 64 SQLite snapshot
plus grant-authorization checks at 0.302 ms median, 0.413 ms p95 and 0.730 ms
maximum; 24 OS process checks at 1.933 ms median, 3.316 ms p95 and 4.914 ms
maximum; and 24 prototype preparation fsyncs at 7.948 ms median, 9.581 ms p95
and 9.953 ms maximum. These are observations on this host, not service limits.
A controlled 200 ms stalled synchronous guard delayed a queued revocation by
at least 175 ms. A separate real-Docker test also demonstrated that a spawned
CLI can reach the daemon and remove its fixture container after revocation.

For an uncertain removal, an experimental authenticated successor can retain
the exact owner's `removed` tombstone and recheck container absence against the
daemon recorded in the approved grant. It dispatches no container operation;
unknown or changed identity, a different daemon, a missing tombstone, or native
witness loss refuses reconciliation. A real-process fixture covers native death,
native restart and successor observation. Stop effects and unconfirmed removal
remain fenced, and this observation does not prove remote work has completed.

Run focused tests with Node 24:

```sh
node --test test/codex-contained-source-retirement-contracts.test.js test/codex-contained-mcp-inventory.test.js test/mcp-establishment.test.js
TURNLINK_CODEX_MCP_CONTAINER_PROBE=1 node --test test/codex-contained-source-retirement.test.js
TURNLINK_RETIRE_NATURAL_LOCK=1 TURNLINK_CODEX_MCP_CONTAINER_PROBE=1 node --test --test-name-pattern='owner crash after removal intent before effect' test/codex-contained-source-retirement.test.js
```

The Docker tests create temporary isolated containers from an already-present
`alpine:3.21` image and remove their own fixtures. The crash test normally ages
its own lock only after the child exits; the last command waits for the natural
lock timeout instead. A previous isolated test exercised the temporary proxy
path before it was disabled; it is not evidence that production enables it.
