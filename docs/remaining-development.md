# Remaining development execution ledger

Objective: complete all remaining work in [the control-plane roadmap](control-plane-roadmap.md).
This ledger supplements that plan; it does not narrow its completion boundary.

The Codex native MCP runtime now has an internal, read-only inventory of its
actual materialized connection map. It records server names, transport family,
connection alias groups and the presence of the publication's event stream,
without exposing commands, URLs or credentials. The observation retains the
exact runtime publication and its request/event exclusion; a foreign or stale
owner is refused, and cleanup invalidates access to the captured entries.
Unknown transport identity stays unknown. Three focused tests and all 290 MCP
library tests passed; an existing sandbox capability test used the installed
Codex CLI with an isolated home. The exported native patch passed forward,
reverse and whitespace checks. This is a materialized-connection inventory,
not a complete census of old aliases, process identities, remote work or
physical cleanup. The private host now exposes the snapshot under the exact
held reservation and validates aliases; a rebuilt app-server reported a real
fixture connection and rejected a different reservation. The broker does not
use the snapshot as a cleanup proof.

For a ready local stdio connection, the inventory now also reports the
process-group ID retained by the native launcher. The contained wrapper records
its PID with its operation, and an isolated broker/app-server staging test
matched it to the source inventory; another real app-server test matched the
launcher ID to its ordinary fixture process. Host validation rejects aliases
with inconsistent IDs. A captured PID can be stale or reused, and matching it
to a journal is not authentication, liveness, a complete census or cleanup
evidence. The launcher now reports the ID only when its retained child handle
is immediately available and still carries that ID; a native test covered
handle contention and the completed child wait. This remains a point-in-time
observation and the receiver remains held.

The contained wrapper now exposes a private Unix socket with a per-operation
challenge. Under the held native source reservation, Codex retains the actual
local child handle while checking the kernel-reported peer PID and challenge.
An isolated broker/app-server fixture verified the source peer and retained
the destination; a wrong challenge stayed quarantined. A native test rejected a
socket owned by a different process. The wrapper's watchdog removes its exact
socket after a crash, while refusing to unlink a replacement. This binds a
point-in-time observation under a trusted local boundary; it does not prove the
complete owner census, exclude changes between observations, reconcile remote
work or authorize receiver release.

The experimental publication fixture can now revalidate and durably capture
that correlation before dispatch. A version-4 host journal preserves the exact
names and resource, operation, container and wrapper IDs, rejects substitutions
and rejects downgrade to an older version. The real broker/app-server fixture
captured and reopened the record before continuing source shutdown; 96 host
journal and inventory tests passed. These records are historical and do not
authenticate a successor owner or authorize retirement or receiver release.

The same experimental live owner can now refuse retirement of a container
whose exact captured identity differs, and can correlate the recorded source
shutdown with retired-container observations under the active publication
barrier and fresh broker authorization. A real app-server/broker test rejected
a substituted operation and unrelated resource, observed the correct removed
source while the destination remained running, and invalidated a revoked guard.
This is not dead-owner recovery or a broker release proof. One run also
reproduced the earlier intermittent provider-view refusal before the new path;
its following run passed, so the intermittent issue remains open.

Contained MCP stop recovery no longer redispatches a stop after its durable
intent has entered `stopping`. A successor observes an exited container and
records completion, but leaves a still-running container uncertain. A
controlled Docker-command fixture checked a lost reply, repeated successor
inspection and eventual exit with exactly one dispatch. A request that never
took effect needs separate authorized reconciliation; this does not complete
crash recovery or release the broker hold.
Two isolated real Docker tests subsequently confirmed both an applied stop
with its reply lost and a stop that was never dispatched; the successor did
not issue a second stop in either case.
The owner now distinguishes an operating-system `ENOENT` from spawning the
Docker executable itself: no Docker process was created, so the prior journal
phase is restored under its lock and a later owner can retry. A controlled
executable-removal test passed, along with the two real Docker uncertainty
cases. Other errors and a crash before recording the no-spawn result remain
uncertain; this does not authorize replay of an effect with a lost reply.
The same proven no-spawn recovery now applies to removal of a created or
stopped container. A controlled pre-dispatch test and three real Docker
removal/lost-reply regressions passed; uncertain removals still retain their
intent without replay.

The contained owner's removal of a never-started container now also records
intent before dispatch and observes exact-ID absence before recording a
tombstone. A watchdog subprocess and controlled Docker-command fixture checked
that a lost reply, repeated inspection and later absence produce one removal
dispatch. A container that remains present stays unresolved; this is not
complete source-resource recovery or broker release evidence.
The full 13-case contained-owner suite subsequently passed with real Docker,
and a separate real Docker test confirmed the lost reply for a never-started
container without replay. The experimental broker/app-server case also passed
with source shutdown and the destination container retained. These results do
not establish the production migration or a complete resource census.

The retained provider's nonblocking tool-model catalog read previously mapped
lock contention to a generic refusal. It now classifies only that lock failure
as `WouldBlock`, which allows the existing bounded retry of the complete
read-only validation; changed inputs and uncertain effects remain fail-closed.
Debug diagnostics now distinguish catalog contention from other provider-view
refusals. The app-server build and one broker/app-server/container case passed;
a preceding run timed out before initialization. Five additional staged
publication crash cases passed, without observing catalog contention. The
focused provider classification, bounded core retry and actual model catalog
lock tests passed. This change is not yet proven to be the cause or complete
fix of the intermittent failure.

An experimental local contained MCP owner now records creation and start intent,
pins the local Docker daemon and image, checks isolation settings and refuses
remote daemons. An actual MCP SDK client exercised a no-network, no-mount
container whose tool launched a detached descendant. A successor stopped the
same container after its owner was killed, and a separate Linux PID-namespace
observer confirmed the descendant had exited. Tests also recovered a lost
create reply by exact name and label and refused a changed daemon or restart
policy. These checks assume the local daemon and do not prove daemon/host crash
behavior or remote-work completion. This owner is not wired into Codex MCP
configuration or the broker cleanup verifier; arbitrary existing MCP servers
remain outside it. See [contained MCP owner](codex-contained-mcp.md).
An explicit stopped-container observation now retains the cooperative journal
lock, detects record changes and can revalidate daemon state. Tests exercised
lock contention, abort and restart-policy changes. It intentionally does not
implement the broker lease symbol: it cannot synchronously prove daemon state
or map this single container to the complete native MCP resource set.

An explicit stdio entry point now lets an isolated Codex app-server start that
owner as an MCP server. Actual Codex calls reached the contained fixture, and
after normal shutdown and forced app-server death the container stopped and
the detached fixture child was absent from a separate PID-namespace observer.
The first crash-test attempt encountered the still-held journal lock and left
an exited test container; the test was corrected to wait for that exact lock,
and the identified container was removed. This does not automatically allocate
approved instances, map the full native MCP owner set, or supply a broker
cleanup verifier. The server's no-network/no-mount restriction excludes many
ordinary MCP configurations. A watchdog now attempts recovery when the wrapper
dies, and the wrapper stops if its watchdog dies. Separate tests killed each
process, and a real Codex session recovered the container after its wrapper was
killed while the app-server stayed alive. This does not prove cleanup for the
complete native resource set or remote work.

An explicit two-directory configuration now gives source and destination
separate single-use contained MCP resource IDs, refusing repeated IDs, aliases
and unlisted directories. An SDK test ran both concurrently, then stopped the
source while calling a destination tool. A separate real broker/app-server
staging test authorized source MCP shutdown, observed the source container
stopped and destination container still running, and retained the publication
quarantine. This is still an operator-supplied mapping, not an authenticated
native resource census or production receiver handoff.

In a real local Codex app-server and broker fixture, source MCP shutdown
terminated the directly launched source MCP process while the destination MCP
process stayed alive. A separate fixture started a detached source descendant
with closed inherited pipes: the same `closed_local` result was returned while
that descendant remained alive. The publication barrier remained active and a
new native turn was refused. The fixture killed its own descendant during
cleanup. This confirms that the local shutdown receipt cannot establish
physical descendant cleanup or remote completion, so it must not authorize
receiver release. These are isolated fixture results, not production proof.

Additional real app-server tests killed the process after destination MCP
installation and before settings publication, then confirmed restoration
remained quarantined. When the native journal was removed after partial or
completed publication, resume was refused; an ordinary thread with no journal
resumed. The tests use the already-present native reservation marker and do not
prove safety against rollout loss, marker tampering or competing writers.

An explicit source-recovery owner CLI now claims or reconciles a quarantined
native owner, resumes the exact receiver, verifies source detachment and
stages the destination. Real OpenCode and CLI-broker tests passed for a source
that detached before loss and for successor detachment; both restarted the owner
and observed the existing stage without replay. Its opt-in `finish` mode also
commits placement, settles the broker, completes natively and releases the
receiver. A real CLI-broker and OpenCode test reached the destination after
source loss; further tests killed the controller after settlement, native
completion and receiver release. Each restarted with its unchanged original
configuration, discovered the current grant through the broker, verified it
against its own durable records and restored the destination API through a
private endpoint. Other failure points and production rollout remain open.

Native placement commit writes a dispatch record with the owner's native lease
before mutation. After takeover, a successor may try again only under a new
exclusive lease after observing no receipt; it records each lease before the
attempt. An existing receipt is observed without replay. Real OpenCode tests
covered lost replies before and after placement and a controller killed before
dispatch. In the crash fixture, lock timestamps were advanced only after the
old native process was confirmed dead; normal stale-lock timing still applies.
Older records without a lease remain uncertain. This does not prove remote
resource reconciliation or all native/platform failure modes.

The normal broker CLI can now use a separately authenticated local OpenCode
source-recovery verifier. A trusted, explicitly registered native owner checks
the source detachment; the broker checks and releases its socket lease around
the acknowledgement. Isolated tests passed with the actual native OpenCode
server and both in-process and CLI brokers. Additional tests covered missing or
wrong credentials, changed receivers, owner revocation and absent or expired
leases. The owner is started explicitly as described above, and the socket lease
does not prove instantaneous remote liveness. This is not full crash recovery
or Gate 2 acceptance.

An explicit OpenCode completion-owner CLI now reopens a completed native
destination, resumes the exact receiver, registers a local verifier and asks
the broker to release it. It remains alive as owner and can reopen an already
verified release after a normal shutdown. An isolated test used the broker CLI,
the actual OpenCode plugin and server, and a loopback-only model: a destination
task ran, produced stopped evidence, was accepted by a separate reviewer, and
was not rerun after the owner restarted. The native child inherited selected
fixture provider variables but not unrelated owner environment canaries.
The owner publishes its authenticated loopback endpoint to an exclusively
created private file. The same native tests connected using that file, checked
normal cleanup, refused an existing path and preserved a replacement. They did
not verify attachment from an IDE or establish a production deployment.
Seventy-eight receiver, verifier and owner regression cases passed, together
with two real-plugin CLI cases and `npm run check`.
Automatic discovery and orchestration before completion, recovery from every
failure point, physical remote-resource reconciliation and Codex acceptance
are still open; this is not Gate 2 closure.

The broker now identifies its global request-bucket rejection as
`BROKER_RATE_LIMITED_BEFORE_DISPATCH`; that response means the request handler
was not entered. OpenCode's candidate status and forwarded movement RPCs retry
only that result, with bounded backoff and a fresh owner, socket, credential and
receiver check around every attempt. Other failures, including a lost reply,
are not retried as if they were unexecuted. A real plugin test exhausted the
broker bucket during placement settlement and receiver release, kept it empty
through initial attempts, and passed twice after the bucket resumed. Eighty-seven
focused cases and 46 broader broker/verifier cases passed; one optional real
OpenCode service case was skipped. This does
not add retries to all broker operations, guarantee progress under sustained
load, implement the production orchestrator or close Gate 2. The new error code
replaces the previous text for this specific broker rejection; older clients
fail rather than automatically retry it.

OpenCode's recovered live owner now writes the exact placement receipt and
broker command ID to its exclusive movement journal before settlement. A
successor reuses that command, reobserves the native placement and refuses a
changed identity before recording the moved result. The same operations now
also use the recovered-destination journal when a successor prepared the
destination after source loss. Real-plugin cases killed the controller before
dispatch and after the broker effect but before its reply, for both original
and successor-prepared destinations. Each recovered through a new native owner
and completed verified receiver release; attempted command-ID changes were
refused. Tests advanced only the dead fixture's journal lock timestamps after
confirming both isolated processes exited, and waited for the broker's
request-rate bucket before verification. Sixty-three host and 38 native
regressions also passed.
The normal production orchestrator, rate-limit handling outside the bounded
OpenCode candidate path and Codex acceptance remain open. The subsequent
isolated real-plugin task case is recorded above.

The actual OpenCode plugin and native server now pass destination placement,
broker settlement, completion and verified receiver release. The plugin RPC
previously rejected `place-worktree`; it now forwards that authorization and
offers a grant-bound settlement operation through the held receiver. A lost
settlement reply was retried with the same command identity. The native
completion RPC previously returned an internal storage token that the strict
host schema rejected; it now returns only the public receipt. Twelve native
server tests, server typechecking and 37 host regressions passed. The native patch reconstructs
tree `a07a648c2d06426231761a8ae32608a145b45868` with strict forward and
reverse checks. The real-plugin test does not yet execute a destination task,
and production orchestration and Codex acceptance remain unfinished. The
subsequent isolated real-plugin task case is recorded above.

The earlier delivery diagnostic was traced to startup while the destination
receiver was deliberately held. Cleanup and quarantine were working; the
plugin now avoids reporting that expected state as an error. The real native
CLI fixture passed without that diagnostic after the change.

The normal broker CLI now supports an explicitly configured, authenticated
local OpenCode completion-verifier socket, receiver handoff and worktree task
dispatch. A registered native owner verifies the exact moved grant, receiver
and placement before a socket-held release; registration removal, native
owner closure, client disconnect or membership removal closes the connection.
Seventy-eight broker, transport and receiver cases passed; after native-owner
closure handling was added, a further 63 focused regressions passed. A separate
real OpenCode native process test used the CLI broker, including a lost
completion reply, owner death and successor, held receiver, queued delivery and
task acceptance. The subsequent investigation of its held-receiver diagnostic
is recorded above. The native owner registration
is still created programmatically by that test, source-recovery verification
is not configured by the CLI, and the socket lease cannot prove remote liveness
at the exact instant of commit. Codex publication and full Gate 2 remain open.

When worktree task dispatch is enabled, a broker without a native completion
verifier now refuses a legacy OpenCode receiver release and treats an already
released, unverified record as held. This prevents delivery and task execution
from being authorized solely by a simulated moved transition, including after
restart. The separate legacy mode with worktree task dispatch disabled remains
available. Sixty-eight broker, receiver and task cases passed, including a
simulated verified completion. A separate actual OpenCode native process case
passed for lost replies, verified receiver release, queued delivery and task
acceptance. It uses a programmatically configured verifier; this does not
provide the missing production verifier or establish complete native authority.

On 2026-11-05, both current OpenCode native movement and recovery integration
suites passed: 38 cases, none skipped. They cover the actual native server and
broker paths exercised by those fixtures, including lost replies, process
recovery, protected transport-release evidence and a held receiver. They
did not establish normal CLI broker startup, Codex destination acceptance or the
other open Gate 2 criteria. The subsequent CLI verifier wiring is recorded above;
the broker's completion-release handler is still restricted to OpenCode. A Codex completion proof and production
wiring are therefore still required; enabling handoff alone could strand a
receiver without a way to release it.
The normal broker and source proxy's separately configured cancellation path
was also rechecked on the current native server: three real cases passed for
broker CLI settlement, source-proxy crash recovery, and refusal when the
verifier was unavailable. Cancellation settlement does not release an MCP
resource hold or establish a completed migration.

New native reservations now require a local rollout and write, flush and
reread a thread-owned reservation marker before returning an owner that can
start effects. Six real app-server cases passed: normal resume, a missing
journal after reservation, effect-free abandonment and reacquisition, missing
journals after partial and completed publication, and broker preparation.
Six acquisition Core tests also passed with an 8 MiB test stack, including
refusal before journaling when local history is unavailable.
The marker is retained after release, so a later missing journal can cause a
conservative refusal. This applies to newly marked reservations only; it does
not establish power-loss durability, protect against loss or tampering of the
rollout, exclude independent writers, or reconcile remote work. Gate 2 stays
open and movement remains disabled.

When a native journal is absent but the local rollout contains this thread's
continuity publication marker, restoration now refuses instead of silently
starting a normal session. An actual staged publication followed by server
death and journal removal was refused on resume; an ordinary thread without
a journal resumed and completed another turn. Normal staged recovery and
broker preparation also passed. This check depends on an available local
rollout and a marker already written: it does not detect earlier unmarked
effects, lost rollout evidence, competing-writer tampering or remote work.

On Unix, the native journal reader now refuses an existing symlinked or
nonprivate parent even when the journal itself is absent, and observes the
parent's identity and change time around a read. Three Core cases passed,
including directory substitution during a read; real app-server cases passed
for initial preparation and publication and cancellation recovery. A genuinely
absent directory remains allowed for first startup, so this does not prove
that a missing directory never held a journal. It also does not lock writers;
unrelated concurrent directory changes may cause conservative refusal.

The actual Unix journal reader now has deterministic tests that replace the
file between the initial metadata check and open, mutate it after the read,
and replace the path after the read. Each altered observation is refused and a
stable valid journal remains readable. The first test run exposed a nonprivate
temporary fixture directory; setting its mode to 0700 corrected the fixture.
Both journal tests and two real app-server crash/recovery cases passed. This
does not exclude independent writers or changes after the final observation.

On Unix, native journal reads now compare the opened file and the path against
the initially observed identity, ownership, link count, size and timestamps
before and after reading. The open is no-follow and nonblocking. A Core metadata
test passed for replacement, hard link, changed contents and permissions;
normal Core shutdown and three real app-server crash/recovery cases passed.
The earlier metadata-only test did not inject a replacement during the read;
the subsequent deterministic reader tests are recorded above.
These observations do not lock out other writers or prove that the path cannot
change afterward; writer isolation and the remaining Gate 2 work stay open.

An inspection of the current host's global Codex TOML found no enabled MCP
servers in that file. This is not an effective runtime inventory: project,
managed, plugin and dynamically supplied servers were not included. Native
configuration supports both stdio and streamable HTTP transports, and the
existing shutdown receipt describes tracked local quiescence, not completion
of work delegated to an HTTP server. A physical cleanup verifier must bind its
evidence to every effective owner and obtain independent completion evidence
for external work; the global-file result cannot justify releasing a hold.

The remote cancellation verifier now unregisters its owner and closes any
outstanding verifier sockets on fence abort, broker disconnection or removal
of that agent's membership. Three local transport cases exercised revocation
after proof delivery, and the normal broker CLI and restored-cancellation
integration cases passed; 120 host cases also passed. Socket closure propagates
asynchronously: this reduces the invalidation window but is not an atomic
cross-process guarantee that the native guard remained valid through broker
settlement. It does not prove MCP cleanup or authorize movement.

Destination-cancellation settlement now requires a verifier lease with a
synchronous successful check and a release callback. Missing, incomplete,
false, asynchronous or invalid leases refuse a new settlement. The in-process
native verifier rechecks its guard and exact journal snapshot through that
lease; the verifier service holds and releases its local proof with the socket.
Thirty-five gateway/transport cases, 113 broker/journal regressions, two real
native cancellation/recovery cases and the normal broker CLI verifier case
passed. The remote socket lease does not by itself prove that every native
owner or remote resource remains current after the response. This does not
release MCP resources or complete Gate 2.

Live observation of the source-model shutdown now also revalidates the held
source MCP closed witness and destination exclusions. A Core test observed an
exact successful shutdown, invalidated the witness, and confirmed the next
observation was refused without changing the journal. The after-effect stale
witness regression and two real app-server cases for lost-reply observation and
held-receiver recovery passed. This does not prove physical MCP or remote-work
cleanup and does not release the receiver.

The source MCP witness is now also tested when invalidated after the local
model effect: a real cached WebSocket closes, the model-shutdown journal stays
uncertain, another shutdown is refused, and the thread remains quarantined.
The before-effect refusal and normal-shutdown Core cases also passed, using
the 8 MiB test stack. This is local recovery evidence, not physical MCP or
remote-work reconciliation.

The local source-model shutdown now revalidates the retained MCP closed witness
and destination exclusions before writing its intent and again after the model
effect. Stale evidence before dispatch refuses without changing the journal; if
it becomes stale during the effect, the outcome remains uncertain. The Core
test fixture now installs a Skills-only native collector and refuses other
contributors, matching its configured contributor set. The stale-witness and
normal-shutdown Core cases passed with the project's 8 MiB stack, as did two
app-server integrations including a real model WebSocket and restored journal.
The subsequent after-effect invalidation test is recorded above. These local
checks do not establish physical MCP or remote-work cleanup.

Restored-publication observation now invalidates the entire attempt if the
broker connection disconnects or the agent's membership is removed while the
observation is in flight. The event listeners are removed on success and
failure. Tests covered both transient events while the key and subscription
appeared unchanged afterward; 92 journal cases and two actual broker/app-server
recovery cases passed. This protects observation continuity, not remote work
reconciliation or receiver release.

The restored-publication coordinator now requires an active destination
subscription and checks its in-memory receiver key against the persisted key
for the exact host, agent and transition throughout observation. A missing or
changed key or subscription refuses recovery without changing the journal.
Ninety-two resource-journal tests passed, including substitution and changes
during the native observation; two real broker/app-server recovery cases
passed. These are guarded observations, not a receiver release, a durable
exclusion of other writers, or proof that remote work has stopped.

An explicitly enabled debug fixture now pauses after the prepared destination
MCP runtime is installed and before destination settings are published. A real
app-server crash and successor test verified the pending publication, absent
settings marker and continued quarantine at this point. The prior crash point
after model installation also passed on the same build. This does not prove
remote-resource cleanup, source ownership recovery or receiver handoff and
does not enable production movement.

The retained destination tool plan is now checked again before issuing its
step receipt, before binding a movement grant, and before staging publication.
The comparison uses the held router and captured native inputs; attachment
revisions are observed around the comparison. Three real app-server tests
injected a synthetic change in the plan at those respective points and each
refused the corresponding operation. Two further tests passed with an MCP
server advertising a tool and with an active message-board contributor. The
normal broker entry-point test and 149 host regression cases also passed.
These are local observations, not an atomic guarantee against untracked
external changes or proof of remote freshness and complete destination
authority. The remaining Gate 2 checklist still applies.

The retained destination step now compares its actual detached tool router
against the native tool-plan assembly using the same captured contributor
scopes, MCP binding, model, environments and recommendation inputs. A mismatch
or an unsupported preview refuses the step after its durable intent and keeps
the resource holds. Four real app-server cases passed: a normal step, an MCP
server advertising a tool, the active message-board contributor, and an
explicitly injected router mismatch. The mismatch produced an uncertain step
without a receipt or publication. The normal source proxy and broker CLI also
prepared approved resources with this check enabled. This is native tool-plan consistency, not a
complete authority digest, external freshness proof or permission to move.

The default-stack staging test was retried after boxing its newly added
publication-observation futures and again after boxing the staging branch.
Both attempts still overflowed before completing and were reverted. The earlier passing result used the repository's
8 MiB test-stack setting; the app-server integration ran in its ordinary
runtime configuration. The source of the default-stack overflow remains
unresolved and this experiment does not demonstrate destination authority.

The previously built Core test executable (SHA-256
`f05fb1dcfe413a0e850505006fe9ca807da457c0048b2f754634a11f0c65bfa6`)
was rerun without `RUST_MIN_STACK` under LLDB. It overflowed in the derived
`ConfigToml` deserializer, called by `deserialize_config_toml_with_base`
while reconstructing the source configuration in
`prepare_native_destination_inner`. This happens during destination
preparation, before resource staging. This diagnosis concerns that existing
debug test binary; it does not establish the stack use of a freshly built
production binary or fix the overflow. The debugger trace is retained locally
at `/private/tmp/turnlink-stack-lldb-backtrace.log`.

A subsequent experiment moved source and destination `ConfigToml`
deserialization to a blocking worker with the captured home context. The
freshly rebuilt Core test still overflowed with the default stack. LLDB then
located the overflow in project trust configuration deserialization during
project preview, a different point from the first trace. The experiment was
reverted and the native source checked against the exported patch index; the
overflow is not fixed. The test and second trace are recorded locally at
`/private/tmp/turnlink-stack-worker-test.log` and
`/private/tmp/turnlink-stack-worker-lldb.log`.

A restored cancellation recovery now retries a lost broker settlement reply
once with the same durable command ID and fresh credential, without repeating
native cancellation. Real broker CLI and app-server tests passed for one lost
reply and for two lost replies followed by a later recovery using that same ID.
If both attempts fail, the journal keeps the settlement uncertain. Resource
holds and the remaining Gate 2 requirements are unchanged.

A source successor can now reconcile an already persisted native movement
cancellation after the original process dies. It observes the exact native
cancellation and retained step, then uses the authenticated verifier and the
original broker settlement identity; it never repeats native cancellation.
The opt-in source proxy runs this recovery after a quarantined resume. Real
broker CLI and app-server tests covered direct and proxy recovery, a modified
native cancellation identity, and a lost broker settlement reply. The modified
identity kept the movement held; the lost reply reused the same settlement ID.
In all successful cases the MCP and provider resource holds remained in place.
This is cancellation recovery, not physical MCP release, remote reconciliation,
destination publication or completion of Gate 2.

After process loss, the destination recovery coordinator can now correlate a
publication even when neither source-shutdown record exists yet. The native
observation checks the exact reservation, publication, movement and step IDs,
the persisted journal and the thread-history marker; the coordinator brackets
it with current broker authorization and the exact held receiver. A real
broker/app-server test killed the owner after publication but before shutdown,
then observed `installed` on the restored quarantined thread while receiver
release and new turns remained blocked. Separate real-process cases checked a
partial publication, a completed publication and both historical shutdowns;
220 JavaScript checks passed. The initial partial-crash test expected its
fixture error even when process death invalidated the fence first; the corrected
test accepts that uncertainty and still checks the pending journal and fence.
This does not recreate resource owners, resolve remote work or authorize a move.

Same-owner publication recovery now uses the broker's read-only
`observe-worktree` authorization instead of requiring fresh idle evidence for
the observation. A real broker and app-server test marked the agent busy after
losing both publication and observation replies: the exact publication was
observed without replay, while a new source-MCP shutdown was refused until
fresh idle evidence was recorded. Three publication-recovery integrations and
241 broker, native-control and journal regressions passed. This does not permit
execution while busy or reconstruct an owner after process loss.

The experimental publication driver now automatically observes the same
live owner after a lost publication reply. It can also recover an exact
completed publication when the host failed to write its receipt: the native
control retains the installed owner, reauthorizes the grant and rechecks the
persisted native journal before the host records the original operation.
Neither path repeats publication. An uncertain observation remains fenced and
can be observed again by the same owner; this does not reconstruct a dead
owner or resolve remote work.

An experimental staged publication can now recover a lost success reply on
the same live owner without replaying the publication. The host reauthorizes
the original movement and checks its publication barrier; native observation
matches the reservation and operation, movement and step IDs, compares the
persisted journal and checks the exact installed model pair and MCP owner.
An isolated broker, private host channel and real app-server test dropped the successful native reply,
rejected a different operation ID, recovered the original receipt and observed
exactly one publication dispatch. The session remains quarantined. This is
not successor recovery, remote cleanup, production movement or receiver release.
Four focused Core cases also passed with the project's 8 MiB test stack,
including partial publication, persistence failures and replacement of the
installed model pair. The first Core run with the default test stack overflowed;
the real app-server integration passed with its ordinary runtime configuration.

The experimental source driver now checks a configured provider's declared
environment key before starting target MCP, and repeats the check before
resource dispatch. Missing and blank keys are refused without disclosing the
key name or value; a retained plan also rejects changed environment or
configuration observations. Providers without a declared key remain eligible.
This establishes local presence only, not remote authentication, the readiness
of other credential mechanisms, or an environment lock. Complete destination
authority and the other movement requirements remain open.
Four isolated source proxy, broker and app-server cases passed for a configured
key, a missing key, a blank key and a provider without a declared key. The
exported native patch reconstructs tree `5037afab0d7278a4762bbe30aba434154509fc2b`;
the app-server SHA-256 is `d1398528a8ce2094d9f3db67f8c4f51f4772ce5335a197946e7b3a9bd76a50e4`.

When an MCP owner is already established but the provider has not been
dispatched, the source driver now settles the exact unstarted provider grant
and stops the tracked MCP independently. If the source dies before or after
that broker settlement, a successor reads the restored native journal and
requires its exact MCP receipt and absence of any provider intent before
reconciling the original provider grant. Real proxy/runtime/broker tests covered
both crash points; a changed native MCP receipt remained quarantined. The tests
aged cooperative lock timestamps only after the old native process exited.
The exported patch reconstructs tree `2a1004364facda1821ed3fd43568ef314c173213`,
and the app-server SHA-256 is `903728a45b599381827b9e4b08f0ea682069cd321bb93015d2e3fa1c6fede376`.
This proves no provider construction under that grant; it does not recover or
release the retained MCP or any remote work, or establish destination authority.

The source Git-pair observation now also records the identities of each Git
directory and common directory, plus the content and change timestamps of the
worktree link and Git backlink files. Rewriting and restoring the destination
`.git` file while approval is pending is detected before resource dispatch;
a real proxy/runtime test confirmed the unstarted grant is closed and the target
MCP is not launched. A normal Git worktree pair still prepares successfully.
These are observations of specific files, not a lock on all Git metadata,
complete authority or a movement grant.

The source driver now resolves the real Git common directory for the source and
destination and requires the destination to be a distinct worktree root in the
same project. It rechecks the captured pair after approval immediately before
each resource dispatch and before destination-step preparation. Real broker,
proxy and native-runtime tests accept a matching pair, reject an unrelated
repository before creating resources, and change the destination's `.git`
link during approval: that attempt closes the unstarted grant without launching
the target MCP server. This is project-identity evidence, not a lock on Git
metadata, a complete native authority digest or permission to move.

The controlled source stop also handles a previously bound movement grant. It
first records and executes one cancellation, observes a lost native reply on
the same owner, and uses the protected verifier to settle the exact broker grant
before disposing the step and stopping the provider and tracked MCP. Missing
verifier, ambiguous binding, publication, or unresolved cancellation remain
held. A real app-server and normal CLI broker exercised this path with an
intentionally dropped native cancellation reply and a test-created authority
grant. This is not automatic creation of genuine destination authority or
physical MCP/remote cleanup; Gate 2 remains open.

An explicitly requested stop of an unbound source preparation now disposes
the exact retained step, journals and settles provider cleanup, and records the
tracked MCP shutdown under the existing authorizations. The source proxy accepts
`SIGUSR2` only after both owners are retained. An actual proxy, native runtime
and CLI broker test checked the disposed step, provider settlement, unchanged
MCP hold and blocked editor turn. A bound or unsettled movement cannot enter the
new step-disposal path. This is an operational local stop, not proof of physical
or remote MCP cleanup and not a receiver or admission release.

The normal broker CLI and opt-in source proxy can now configure the existing
authenticated native cancellation verifier through a private socket and token
file. The proxy owns the socket lifetime, requires a separate adapter secret,
and the broker rejects reuse of its host or administrator secret. The proxy
does not forward the verifier settings to its native child. A source proxy
and real app-server prepared approved resources against the normal broker CLI;
the test verified the private socket lifecycle and child environment. A separate
real native cancellation with a lost native reply was observed and settled by
the normal broker through the authenticated verifier service. The registered
verifier in that cancellation test is still driven by the isolated integration
harness, not by an automatic production movement driver. This does not establish
MCP cleanup, destination publication, receiver handoff or Gate 2 completion.

The normal broker entry point can now explicitly enable its existing movement
and resource grant protocol with `AGENT_CHANNEL_WORKTREE_GRANTS=1` alongside
`AGENT_CHANNEL_CONTROL=1`. The option defaults off; invalid values and a
grant flag without the control plane are rejected. A real temporary CLI broker
advertised the grant capabilities and issued an approved MCP preparation grant
while continuing to report movement and MCP execution disabled. This exposes grant plumbing for the existing source driver;
it does not provide native execution, verifier services or receiver handoff and
does not authorize production activation or Gate 2 closure.

The local Docker daemon and the preinstalled Alpine image are available. An
isolated MCP SDK client now initializes, lists and calls a real stdio MCP
fixture in a container with no network, host mounts, privileged mode or host
PID namespace. The tool starts a detached-session child. Both forced container
removal and a killed Docker client stopped that child; the latter was checked
before removing the stopped container. All three opt-in container probes pass.
This establishes a possible containment substrate for compatible local servers;
it does not isolate ordinary configured Codex MCP servers, verify daemon or
host crashes, reconcile networked work, issue a broker cleanup receipt, or
authorize movement. Gate 2 remains open.

The broker's MCP cleanup verification now requires a trusted synchronous lease
that remains valid through the broker's final grant recheck and settlement. It
releases the lease on success, refusal, disconnect, timeout, and when a delayed
verification result arrives after cancellation. An isolated broker test checks
that missing, expired, asynchronous, and late leases cannot clear the MCP hold;
an exact live fixture lease allows settlement and its committed retry is
idempotent. This closes a verifier-lifetime race in the broker interface. It
does not supply a production verifier, prove physical containment or remote
completion, or authorize Gate 2 closure.

The source proxy now reconciles an already completed local provider cleanup
after its native owner dies. A reopened quarantined thread independently reads
the exact reservation and cleanup receipt from its durable native journal; the
host verifies that receipt against the original broker resource and retries
only its recorded settlement. The MCP resource and native admission remain
quarantined. In two isolated process tests the native cleanup completed, a
host receipt write failed, and the app-server was killed. Both direct recovery
and the source proxy's failed-resume recovery settled the exact provider hold;
the original MCP broker hold remained established. Nine host variants cover
ambiguous broker responses and identity mismatches, and 215 host checks passed.
The rebuilt patch reconstructs tree `b22096602697af9b2f7aa0aa487173579885b749`;
app-server SHA-256 is `8e3860999da0b1237c00aec261a3116137d14f05dfc05452b46c72a4df9c24e0`.
This is evidence of local provider-owner cleanup, not physical MCP or remote
work completion, destination publication, receiver release, or Gate 2 closure.

The source successor can now recover a pre-dispatch journal left before the
host recorded its abandonment outcome. For `previewing` or `previewed`, it
requires two observations of the exact released native reservation before
marking the preview abandoned. For `prepared`, it additionally matches the
existing broker grant and durably records the same failed-settlement intent
before submitting it. A real-process test paused the native debug fixture after
its release journal was written, killed both source processes before the host
received the reply, and verified that a successor closed the original grant and
continued fresh approved preparation. Three prior real crash/mismatch cases and
279 host regressions passed. The tested patch reconstructs tree
`2c83957d88ce02b0fb531f44e45443722f6fc1df`; the app-server SHA-256 is
`da95888aeb1a5b41db30cc187c8cdec42af35230be4a602fc79150165ba651a9`.
The pause is enabled only by explicit debug fixture flags. This does not recover
an acquired reservation whose native release cannot be proved, or reconcile any
started or remote resources; complete destination authority and Gate 2 remain open.

The pre-dispatch crash recovery has now also passed with the real cooperative
lock stale interval: after the old source process exited, the successor waited
without changing lock timestamps, reconciled the same grant and resumed a new
approved preparation (72.6 seconds). This exercises stale-lock recovery, not
incompatible writers or started-resource reconciliation. The isolated real
OpenCode recovery bundle also passed nine cases, including the held receiver
release after placement and refusal when protected transport evidence is absent.
These results do not establish complete Codex destination authority or Gate 2.

An `aborting` pre-dispatch resource record can now be recovered after process
death. The reopened native thread must independently observe the exact released
reservation, with no held owner, movement, resource or publication record. The
source proxy waits for stale cooperative locks, holds its admission fence,
rechecks the receiver and the exact broker grant, and either observes its prior
failed settlement or submits the original idempotent settlement. It rechecks
the native release before marking the record `aborted` and starting a new
preparation. Real broker/app-server/proxy cases killed the source before and
after broker settlement; both recovered the original grant and proceeded to a
fresh approved resource preparation. A changed native reservation remained
fenced. Test lock timestamps were aged only after the old process exited; the
real stale-lock delay and incompatible writers remain separate limitations.
The first test run exposed a missing lock wait; a second exposed a test-only
name collision. After fixes, the three crash cases, three prior source cases,
and 275 host regressions passed. The native patch reconstructs tree
`25869293f26113c84dac7e40feae9a9dbdfe0e18`, passes strict forward/reverse
checks, and the app-server hash is
`f61f3727c20e4343764c7ddc40301bae779bfa7cf7f77470d4bfc35590fc1bc2`.
This covers only a reservation abandoned before resource dispatch, not physical
or remote cleanup, complete destination authority, placement or receiver
release. Gate 2 remains open.

Effect-free source preparation now also reconciles an exact broker grant when
the begin response was lost or the grant was recorded before native dispatch.
Under the journal and admission locks, it first observes and validates the
prepared grant, abandons the same native reservation, persists one failed
settlement intent, and verifies the broker's matching failed transition before
releasing queued work. A lost settlement reply is retried only with the same
command ID; a missing or mismatched grant or an unresolved settlement stays
held. Two isolated real broker/app-server/proxy tests dropped the successful
begin reply, and then both the begin and first settlement replies, on the
actual socket. Neither started the target MCP server; both retained one grant
and released the original session after exact settlement. Another 266 host
regressions passed. A crash with an `aborting` record remains quarantined; this
does not reconcile started or remote resources, publish a destination, or close
Gate 2. Older journal readers reject the new phases.

The source preparation driver can now abandon an effect-free native reservation
when preparation fails before resource authorization. Under the admission fence
and journal writer lock it requires every current record to be before
`authorizing`, abandons the exact native reservation, observes a lost reply on
the same owner, and only then records the preview as `abandoned` and releases
queued work. Authorizing, dispatching, uncertain and retained resources still
hold the fence. A real broker/app-server/proxy test reassigned the task while
approval was pending, verified that no target MCP process or transition was
created, resumed the original conversation, and then reclaimed the task and
prepared fresh resources after restarting the proxy. Two real retained-resource
and broker-disconnection regressions and 259 host regressions passed. The new
journal phase is rejected by older readers, which must be upgraded before they
can use a journal containing it. This does not release a started resource,
resolve remote work, publish a destination or complete Gate 2.

Native turn-extension input capture now keeps an application generation: an
applied replacement followed by the old initializer no longer revalidates a
previous candidate, even when the original attachment identities return. Two
focused native tests passed. This does not observe interior mutations of a
shared attachment or provide a complete destination authority or commit. The
exported patch reconstructs `5e4264645d40da5b0d0e43657dcfa4376e05f472`,
passes strict forward/reverse reconstruction and matches the manifest. The
app-server was rebuilt and the isolated broker/app-server/source-proxy
resource-preparation case passed with fixture services. The new executable's
SHA-256 is `c72337c10e75a4273e4691c0f10089ad532b13893c3979c98747ad18b821718d`.

The generic worktree coordinator no longer resolves a lost native move as
`moved` solely because the session is observed at the destination. Its trusted
harness port must twice observe the exact agent, transition and source and
destination in a native completion record while the exclusion is held; missing,
foreign or changing observations keep the transition uncertain. Tests verify
that later matching observation resolves it without replay. The combined
coordinator, broker and receiver suite passed 98 cases; the updated coordinator
suite passed 36. Its observations in these tests are fixtures, and neither
production harness currently supplies this generic port. This does not provide
the Codex native completion record or close Gate 2.

An isolated broker/app-server/source-proxy test now terminates the actual
broker sockets after destination resources are retained, waits for the source
and host to reconnect, and verifies that queued editor work remains held and
the resource journal is unchanged. It then restarts the source proxy and
confirms the interrupted owner remains quarantined without replay. The existing
native-control close listener invalidates the fence on broker disconnect; no
new disconnect behavior was needed. The real case and 157 related fence,
receiver and native-control tests passed. This is not remote work reconciliation
or a completed handoff. The Codex patch manifest was also synchronized with the
exported patch; `npm run check` now verifies the Codex and OpenCode patch sizes
and hashes, and rejected an altered patch in an isolated negative check.

Native destination configuration revalidation now compares the captured
turn-extension initializer's type-to-owner bindings and the selected shell
override. Replacing an attachment with an equal value therefore invalidates the
prepared candidate. This comparison does not observe mutation inside a shared
attachment, or a change that is restored before revalidation, and does not
establish complete destination authority. The exported native patch reconstructs
tree `06f9bf09f6d7ed83a36eefb4b748a628049e17f8`; strict forward and reverse
application were verified. The new native regression and three related native
configuration and constraint tests passed. The app-server was rebuilt and the
isolated broker/app-server/source-proxy preparation integration passed with it.
The test uses fixture model and MCP services, not production destination authority.
The rebuilt executable SHA-256 is
`a732411f5683bfbd9e31f79201fb99b222d9e45fcbf9c4195a7aa0960bb9c473`;
the exported patch SHA-256 is
`0e32a207beda43f1997ac408f807905a00224c05b4c27a912b0b1ad5761de9f8`.
Gate 2 remains open for complete authority, resource reconciliation,
writer isolation and full acceptance.

The Codex proxy now has an explicitly configured source preparation path. For
the selected subscribed thread and claimed task, it takes a cooperative source
driver lock, refuses a nonempty resource journal, acquires the native fence,
and prepares MCP, provider and destination step under their separate broker
approvals. It retains the owners and the fence while movement authority is
pending; it does not invent the final authority digest or publish a destination.
A real broker/app-server/proxy case verified that target MCP startup waited for
approval, both resources and the step were journaled, editor turns were held,
and a restart refused the interrupted thread without repeating preparation.
The test used isolated fixture services and automated operator approvals;
287 proxy, native-control and journal regressions passed with one skipped. This
is opt-in preparation, not the complete source movement driver, remote cleanup,
writer isolation or receiver release required to close Gate 2.

In explicit destination resume mode, the Codex proxy now observes the matching
historical publication after a quarantined `thread/resume` refusal, using the
same held receiver, native-control channel and host journal. An isolated test
killed the source app server, started the destination proxy against the same
actual test home and thread, and verified that the native thread remained
quarantined while the proxy correlated MCP and model journal records. The
receiver remained held. The test waited for the target native process to exit
before reopening that home. The source transfer state and capability evidence were
fixture inputs; this is read-only recovery, not reconstruction or publication
of a usable destination session. The real case and two related native cases
passed; 112 host regressions passed with one skipped. Normal source startup,
remote reconciliation, competing-writer exclusion and verified receiver
release remain open.

The opt-in destination proxy now binds its private native control to the same
dedicated client that owns the held receiver. An isolated integration used real
source and destination app servers: the target server initialized behind the
proxy, the receiver was transferred and held, and a replacement proxy resumed
it after termination. The target used a separate empty home; it did not load or
publish the source conversation, and source state and capability were fixture
inputs. The real case passed, as did 182 proxy/native-control/receiver
regressions (one skipped). The normal source driver, actual destination session,
remote reconciliation and verified release remain open.

The Codex proxy now supports an explicitly configured dedicated destination
receiver in offer or resume mode. It reads the exact broker grant from a private
file, removes that file's path from the native child's environment, and keeps
the receiver held. Offer mode requests a source recheck after transfer; resume
mode loads the persisted transition key. An isolated integration started an
actual destination proxy, transferred the receiver, killed that proxy,
restarted a new proxy in resume mode, and recovered the still-held receiver.
The source app server and broker were real, but the destination proxy's native
child, source state and capability inputs were fixtures. This startup path does
not run the missing source movement driver, publish a production destination,
verify remote resources or release the receiver; Gate 2 remains open. The
targeted integration passed, together with 68 proxy and receiver regressions
(one native integration skipped).

A dedicated Codex destination-receiver owner now offers or resumes the exact
transition key and rechecks both broker observation scopes and the held state
before returning it. A failed resume observation removes the subscription or
terminates the connection if cleanup fails; closing the owner closes its
dedicated client. An isolated broker/app-server case exercised offer, transfer,
lost-subscribe cleanup, forced receiver-socket loss, app-server death, successor
resume and restored journal observation. The source commit and capability
inputs were fixture-controlled. The real case and 106
receiver, host-journal and broker tests passed. The subsequent opt-in proxy
integration is described above; it cannot release the receiver or establish
remote resource completion, and the Gate 2 checklist remains open.

Receiver resume now serializes concurrent attempts per agent and cleans up even
when the broker reports an error, since an error does not itself establish that
no subscription was installed. A local broker test actually dropped the
subscribe response frame: the client timed out, removed the exact subscription
and a successor resumed the still-held receiver. The test used OpenCode
identity through the shared client; a separate Codex case previously injected
loss after the broker response. The receiver/broker/adapter regression bundle
passed 77 tests. This closes neither normal Codex movement startup nor remote
resource reconciliation.

Receiver recovery now cleans up a potentially installed subscription if its
reply is lost: it uses the exact persisted receiver key on the same socket and
terminates that socket if cleanup is uncertain. It does not assume that an
explicit broker error proves the subscription had no effect. Broker tests
verify that a successor can resume after
both successful cleanup and an uncertain cleanup/socket close (55 passed).
An isolated real Codex app-server and broker case also recovers the held
receiver and then observes the native journal; adapter regressions passed 36
cases with one skipped. These tests inject the lost
reply in the client after the broker has responded; they are not a network
partition or complete destination handoff test. Normal movement startup,
remote resource reconciliation and Gate 2 completion remain open.

The source-receiver acknowledgement now holds the admission ledger's
cooperative writer lock across the broker call, with consistency checks before
and after it. A real second process was refused while the acknowledgement was
in flight. The isolated broker/app-server source-detachment case passed with a
real admission ledger, and 63 host and adapter regression tests passed; the
source state and quiet predicate in the integration remain fixture inputs.
Older or unrelated writers can ignore this lock, so this is not complete
competing-writer isolation and does not authorize destination release.

Admission-ledger writes now take a per-agent cooperative writer lock and refuse
to overwrite a journal changed since that instance loaded it. The source
receiver's quiet check also compares its admission snapshot with the persisted
journal. A real second process with a stale snapshot was refused, preserving
the first process's intent. Codex/OpenCode proxy, task and recovery regressions
passed (91 passed, one skipped). An initial run exposed a false mismatch from
receipt field order; receipts are now normalized before persistence and the
regressions passed on rerun. Writers must reload after an external change.
This protects cooperating updated ledger writers; it is a point-in-time read
check and does not exclude incompatible processes or establish complete
competing-writer isolation.

The source-offer handler now invalidates its held publication fence whenever
the broker transfer was dispatched but returns an error, and also if success
arrives without the source ownership-loss event. It still refuses any further
offer for that agent in the same process. Unit tests cover loss, missing event,
duplicate offers and a refusal before dispatch; 206 host tests passed. A real
broker/app-server case performed the receiver transfer once and injected a
lost reply at the host wrapper after the broker response; the source remained
quarantined and the destination receiver remained held. This injected loss is
not a network-level crash or remote-resource completion proof. Normal movement
startup and Gate 2 completion remain open.

The Codex proxy now handles a broker receiver offer only when the exact live
native owner, journaled staged publication, both local source-shutdown
receipts and publication fence agree. The proxy rechecks the broker grant and
local state before committing; a dispatched ambiguous transfer prevents any
further offer for that agent in the same process. A real isolated broker and
app server exercised the offer handler, transfer, source recheck and held
receiver; source state and quiet checks were fixture inputs. A 250-test bundle
passed 249 cases with one native integration skipped, and the real case passed
separately. This handler requires the experimental publication fixture; the
normal proxy does not start the staged movement driver or enable that fixture.
It cannot release the receiver or establish remote completion.

Codex source-receiver detachment now has a separate broker recovery scope.
After an exact held receiver transfer, the destination may request a source
recheck; the source proxy acknowledges only if its original publication fence
was held, its local activity and journal were quiet, ownership was invalidated,
and the same fence remains quarantined. Active or unknown work retains the
hold. The real broker and app-server fixture exercised source transfer,
broker-requested acknowledgement and restart while preserving the receiver
hold; its source state/quiet predicate was simulated. An earlier integration
attempt exposed the broker's OpenCode-only check; after introducing the scoped
Codex action, the case passed. Broker, authorization, proxy, task and receiver
regressions passed (129 passed, one skipped); focused fence/quiet tests passed.
The normal Codex proxy still lacks a movement driver that initiates this
handoff, and source acknowledgement proves neither remote completion nor
destination readiness. Gate 2 remains open.

The Codex stdio proxy now reacts to loss of its source receiver: it invalidates
in-flight generation-bound work, clears buffered messages and notices, disables
task wakeups and selection, and invalidates any held native admission fence.
Later presence or task notifications cannot restore the disabled receiver;
only a successful explicit subscription can do so. This closes a local stale
receiver path introduced by enabling the staged broker handoff. The focused
ownership test and proxy, task, control and receiver regression bundle passed
(78 passed, one native integration skipped). This is not a source-detachment
proof of remote completion or a production handoff.

The broker now authorizes receiver handoff for an exact Codex movement grant
bound to prepared destination owners, with a distinct handoff action requiring
the current claim, grant, owners, capability and idle evidence. Previously
these grants were rejected before an offer could be committed. The resulting
receiver remains held; Codex release is still refused. A real isolated broker
and app server transferred such a receiver, restarted the app server and ran
the host observation of both restored historical records under the actual held
receiver and current grant. It confirmed that release was refused. The native
capability inputs and the original receiver are fixture preconditions; this is
not a production placement or end-to-end acceptance. The host coordinator
rechecks both broker scopes and preserves unresolved conditions. The real case
and 137 broker, authorization, receiver and host-journal regressions passed.
Normal startup still does not wire this coordinator or a Codex completion
verifier; remote work and the remaining Gate 2 requirements remain open.

A real app-server crash test now drops the successful local model-shutdown reply
and kills the process before host observation. The source WebSocket closes,
the host persists the exact intent as uncertain, and the replacement server
correlates the historical `closed` record without replaying shutdown, changing
the host journal or allowing a new turn. The targeted test passed. This is
historical local evidence only: it does not settle remote work or release the
receiver, and the production destination commit remains disabled.

After an app-server restart, the host can now correlate its exact model
shutdown intent with the restored native historical record. The observation
checks owner, operation, movement and step identities and the persisted journal;
it neither changes the host record nor releases quarantine. Three real server
restart cases passed for closed socket, absent socket and a lost reply recovered
before restart. Host tests reject inconsistent or substituted receipts (173
passed). The rebuilt server SHA-256 is
`1a7c001549968f7ad13a3ac380e6577783327fe6451faa55228bed2e349c6bf4`;
the exported patch passed strict reconstruction and reverse application.
Historical evidence does not reconstruct the old resource owner or establish
remote completion. Production handoff and the rest of Gate 2 remain open.

The experimental model shutdown now has a live owner observation and host
reconciliation path. It preserves an uncertain intent while the native result
is pending and only accepts a matching local receipt; host journal tests cover
pending, lost and mismatched outcomes (52 tests passed). An isolated real
app-server test closed a cached WebSocket, suppressed the successful reply and
recovered the local outcome without repeating the effect. It verified the
broker's separate observation authorization before and after the native read,
then restarted into quarantine. Two rebuilt-server regressions for ordinary
socket shutdown and an empty cache passed, together with 173 host tests. The
rebuilt app server SHA-256 is
`823aa1d6c62939fa011acd176ecd96a75e79037fb83ccb508e8d42dfcca5e2eb`;
the exported patch passed strict reconstruction and reverse application.
This is debug-only, with synthetic capability evidence: it does not establish
restarted-owner or remote reconciliation, production wiring or receiver
transfer. Gate 2 remains open. To permit the build, 23 GB of regenerable Rust
incremental cache was removed after confirming no compiler was using it.

The experimental host publication fixture now persists a separate model
shutdown intent before the native effect and checks the broker's specific
authorization both before and after it. A successful local receipt is recorded;
a lost or invalid receipt leaves a durable uncertain intent that cannot be
replayed. Journal schema 3 prevents older readers from silently accepting this
new state. The real app-server test exercised this host path with a live cached
model WebSocket, observed its peer close, rejected a duplicate and restarted
into quarantine using the actual native journal. The empty-cache case also
passed, as did 173 host journal and native-control tests. One instrumented
live-socket run failed during destination metadata validation, before reaching
the model effect; a retry passed, and the intermittent failure is unresolved.
This remains a debug-only fixture with synthetic capability evidence: remote
provider completion, uncertain-result reconciliation, production wiring and
receiver transfer are not established by these tests.

The control broker now records a separate `sourceModelShutdown` approval and
requires a fresh, specific `nativeModelShutdown` capability before authorizing
the model effect. MCP approval alone cannot authorize it. Read-only recovery
observation remains distinct from execution. Schema 31 preserves this scope,
rejects downgraded state and exports carrying it, and migrates older state
without inventing approval. Native grant serialization removes the host-only
field before calling the strict native protocol. Broker, schema, storage,
receiver, journal and native-control regression bundles passed (175, 146 and
149 tests respectively, with overlap). That earlier broker work did not yet
wire the host grant to the native model operation; the subsequent experimental
host fixture described above does so without establishing production readiness.

The real app-server fixture now uses a live cached model WebSocket on loopback.
After staged publication and local MCP shutdown, its debug-only inherited
channel invokes the native model shutdown; the test confirms the socket was
open, observes peer disconnection, checks the native journal's `closed` status,
refuses a duplicate and restarts into quarantine with the actual journal.
That case and the empty-cache app-server regression passed. The raw fixture
bypasses separate production host authorization; this does not prove remote
provider work has completed or the receiver has been transferred.

The real app server now has a debug-only private-channel fixture for the native
source-model shutdown. An isolated test stages the destination, completes the
local MCP shutdown, invokes the native model operation, confirms a duplicate is
refused, kills the server and verifies that a fresh server retains the actual
journal and rejects resume and turns. The source model cache was empty, and the
fixture invokes the raw private channel without separate production host
authorization; it is not proof of remote completion or receiver handoff. The
first attempt timed out because the test reused a non-monotonic private request
ID; after fixing the fixture the case passed. Native-control and host-journal
regressions passed 121 and 48 tests. App-server SHA-256:
`f11ff433ac02b81a587695b38d7c8d898ad187b42871695e8cd62c9c02123361`.
The native patch passed strict reconstruction and reverse application.

The rebuilt real app server was tested against an explicitly synthetic schema-9
pending model-shutdown record, inserted after a real staged publication and MCP
shutdown. On restart it refused thread resume and turns, preserved the journal
and exposed only the historical MCP observation. The targeted test and a
separate real MCP shutdown/restart regression passed; the first targeted run
timed out during initialize before reaching the journal, and the retry passed.
The app server binary SHA-256 is
`39c5147e2dc257db255dea01823acdc512e92f5fa2f3ee4be984b1a6e0343b03`.
The model intent in this test was fixture-written, so it does not prove the
real model effect, production authorization, remote reconciliation or receiver
handoff.

Restoring an unfinished native journal now also fences the recreated process's
model client. For each of the two real-socket process-death boundaries, a new
test process constructed a session fixture pointed at the same journal and
confirmed that ordinary mutation, model and MCP work, acquisition, release and
model-shutdown replay are refused while the journal bytes stay unchanged. The
two-process-boundary test, staged journal case, two cancellation cases and
five acquisition cases passed. This fixture does not reconstruct a full
production app-server thread, prove remote completion or authorize a receiver
handoff. Strict patch reconstruction and reverse application passed.

An isolated parent test now kills two native test processes with actual
loopback sockets, one after durable model intent but before the local effect and
one after the peer observes local socket termination but before the receipt.
After each death it reads the isolated journal and verifies the exact model
shutdown ID remains `pending` and the transaction phase remains `uncertain`.
The test and seven cancellation/acquisition regressions passed. It does not
start a fresh native process to restore that journal, establish remote provider
completion or authorize a production handoff. Strict reconstruction and
reverse application of the exported patch passed.

Controlled cancellation is now also tested with a real cached loopback socket.
After durable intent but before the local effect, the socket stays open through
the refused duplicate and quarantine restoration. After the effect but before
the journal receipt, the peer observes termination. Both cases keep `pending`
and refuse replay. The two new socket cases, the normal real-socket case and
two empty-cache interruption regressions passed. These are cancelled tasks, not
process-death tests, and do not establish remote provider completion or host
authorization. Strict patch reconstruction and reverse application passed.

A native staged test now combines the journal and a real loopback WebSocket
cached before acquisition. It verifies the socket remains open until the exact
source owner performs model shutdown, that the peer observes termination, the
journal records `closed`, duplicates are refused and restored state remains
quarantined. This test, two controlled cancellation cases and five acquisition
cases passed. The loopback test required execution outside the network sandbox.
The fixture is not production authorization, process-crash recovery, remote
provider completion or receiver handoff. Strict patch reconstruction and
reverse application passed.

The source client now has a real loopback cached-WebSocket test: an exclusion
from a different client is refused, the matching owner shuts down the local
pump, and the peer observes termination. The first fixture run failed because
its server lacked the client's compression extension; after matching the native
server configuration the test passed. The two cancellation cases and normal
staged journal regression also passed. This loopback test is separate from
the staged journal test, whose cache was empty; it is not a crash, production
authorization or remote-provider completion proof. Patch reconstruction and
reverse application passed.

Two controlled cancellation cases now pause the model-socket shutdown after
its durable intent and immediately after the local operation, respectively.
Both leave a pending marker, refuse a duplicate attempt and restore the
thread in quarantine. The cached socket was absent; cancellation of a task is
not a process crash or proof of physical socket closure. Two cancellation
cases, the normal journal case, five acquisition cases and one owner-identity
case passed. Strict patch reconstruction and reverse application passed.

The internal staged Codex transaction now writes a distinct durable model
socket-shutdown intent before its effect, requires the same owner and retained
source exclusion plus the live MCP shutdown proof, and refuses duplicate calls.
Its journal format records pending, closed, absent or uncertain, and restored
publication observations continue to leave the thread quarantined. One staged
empty-cache shutdown and restored-journal test, five acquisition cases, one
client identity case and one paired staging regression passed. The first test
run exposed and led to a fix for restored publication's schema handling. The
operation is not exposed or separately host-authorized in production, and
actual cached-socket integration, interruption at the effect boundary and
remote-resource reconciliation remain unverified. Strict patch reconstruction
and reverse application passed.

Source model exclusions now retain the exact client state identity. The
internal cached-socket shutdown refuses an exclusion from another client and
accepts an alias of the same client; a busy transport is retained instead of
being reported closed. One owner-identity test, five acquisition tests, one
realtime case and one paired staging regression passed. The owner test used an
empty cache; the real loopback socket was tested separately in the API layer.
No durable authorization, lost-reply recovery or provider completion is
established. The exported patch passed strict reconstruction and reverse check.

The Responses WebSocket now has an internal local shutdown primitive that
refuses a borrowed or already removed pump, aborts it and waits for its task to
terminate. A focused test covers busy refusal, joined task cleanup and replay
refusal; a real loopback WebSocket test also observed transport termination at
the peer. The loopback test ran outside the sandbox because binding a local
port was denied within it. This primitive is not yet connected to native
continuity's exact owner, durable intent or recovery, and it does not establish
remote provider completion. Its exported patch passed strict reconstruction and
reverse application.

Realtime admission now belongs directly to the WebSocket or sideband worker,
instead of a separate waiter. A controlled test aborts a waiter while the worker
continues and verifies that model exclusion remains unavailable until the
worker finishes. Two realtime cases, five acquisition cases and one paired
staging case passed; the exported patch was strictly reconstructed and reverse
checked. This still does not establish physical socket shutdown, remote
completion, detached work, or recovery after a process crash.

Realtime connection setup now obtains source model admission and transfers it
to a waiter for the local input worker. Admission remains held while that
worker's asynchronous shutdown is in progress, even when the conversation is
no longer marked active. One controlled realtime cleanup test, five acquisition
tests, one mapper test and one paired staging test passed; the exported patch
was strictly reconstructed and reverse-checked. The controlled worker is not
evidence of physical socket shutdown, remote completion, separately spawned
work, or safety if the waiter itself is aborted.

The fresh source reservation now also excludes direct model request setup and
holds a separate admission while HTTP or WebSocket response mapping is active,
including after the turn session drops. An actual acquisition test confirms a
source clone is refused until release. A mapper test confirms admission stays
held until consumer cancellation is processed. Five acquisition tests, four
client/mapper cases and one paired staging regression passed; the patch was
strictly reconstructed and reverse-checked. These local guards do not prove
physical socket closure, remote completion, a realtime sideband's later life,
other processes' exclusion, or restored-owner recovery.

Fresh Codex continuity acquisition now retains an exclusive turn-session
admission lock on the exact source model client, shared by its clones. Existing
sessions prevent exclusion; sessions created while excluded cannot preconnect,
prewarm or stream, and remain denied after the exclusion ends. Two focused
client tests, four acquisition tests and one paired staging test passed. The
acquisition-to-alias path has not yet been exercised end-to-end. Direct model
requests, streams outliving a session, restart quarantine, cached sockets and
remote completion are not covered. The patch was strictly reconstructed and
reverse-checked; this is not a receiver-release proof.

Completed startup prewarm handles are now retired before the source model
session busy check. An unfinished prewarm is refused without aborting its
work; a finished handle's returned client session is dropped and the normal
busy check still runs. Four native acquisition tests and the paired resource
staging regression passed. The exported native patch was reconstructed with
strict whitespace and reverse-checked. Retirement returns the session's socket
to the source cache; it is not proof of socket closure, remote completion,
independent alias exclusion, or receiver release.

Codex acquisition now refuses before journaling when the exact observed source
model owner has a live turn-scoped client session, including a session held
without an active turn. After that session drops, acquisition can proceed.
Three native acquisition tests and the paired resource staging regression
passed. The exported patch reconstructs the exact native tree with strict
whitespace and passes reverse application. This is a conservative observation,
not an admission fence: an alias can start later, cached transports and remote
effects remain unproven, and a completed retained prewarm can cause a refusal
until it is retired. No receiver release or Gate 2 closure follows from it.

Codex receiver release now fails closed even when the broker has no native
completion verifier configured. Previously the staged legacy path could release
a Codex receiver using a simulated movement settlement. Existing Codex records
already marked released by that path are treated as held on startup and during
delivery, task pulls and outbound sends. Sixty broker, receiver and task tests
passed, including a persisted legacy record across restart and the separate
OpenCode release path. A real Codex completion verifier is still required to
make release possible; this change does not complete receiver handoff.

Task-available notifications now respect the same receiver hold as task pulls
and message delivery. Both direct task changes and periodic readiness checks
are suppressed while held; readiness signals are reconsidered when the hold
clears. A handoff also forgets only the previous receiver's cached wakeups, so
a fast transfer between scheduler ticks can notify the new receiver without
duplicating unrelated receivers' signals. Eighty-seven broker, handoff and
OpenCode task regressions passed. Focused tests additionally verified that a
legacy released Codex record produces no task wake before or after restart,
and that a valid OpenCode release restores the pending wake. Codex native
completion verification remains unimplemented.

## Gate 2 closure checklist

This checklist tracks the end-to-end requirements, not the number of completed
components. Keep each item open until its production path and failure recovery
have been verified; component fixtures alone do not close an item.

The user has confirmed that a session may be stopped safely and resumed at the
destination. The transition must still preserve the original conversation and
saved work; this decision does not establish that in-flight work may be lost or
that unverified policy changes are acceptable. Use the installed runtimes and
their normal restart/resume paths where they satisfy the remaining requirements.
The user has since declined modifying the runtimes and offered to move the
session manually if needed. Do not rebuild or install modified runtimes for this
path; use the installed applications and clearly identify any manual step.

The broker recognizes an explicitly approved manual path through a separate
receipt; it does not represent that receipt as a native movement or receiver
handoff. A manual stop, move and rejoin by itself is insufficient: readiness
also requires the matching agent comparison, destination receiver and explicit
operator attestation that the source was stopped.

The current master can now create an explicitly manual preview from the
claimant's registered source and a proposed destination. Its digest binds the
request's task and paths, not observed runtime configuration; it cannot be used
to begin the existing native movement path and still requires operator approval.

The user selected agent-assisted session records instead of asking the human to
transcribe and compare settings. Turnlink should ask the agent in the existing
session to collect the information it can actually access, write a private
record, refresh it before stopping, and compare it after resuming. The record
must identify the session and approved destination, distinguish observed facts
from unknowns, avoid credentials, and preserve an actionable summary of work.
An agent report is an agent observation, not independent proof that an unseen
setting, old receiver, competing writer, or uncertain effect is safe. Unknowns
must remain visible and must not automatically authorize task dispatch. The
record must be accessible at the destination, including when it is on another
host. The control-plane tools `channel_prepare_session` and
`channel_verify_session` now let a current master ask the claimant to prepare
and later compare such a record for its latest approved preview. The claimant
is asked to send a sanitized copy through channel history for cross-host
retrieval; the broker and master can read that copy, and retention is not
guaranteed. `channel_session_status` checks structured records and reports for
the current claim and request, identifying differences, unknowns and invalid
reports. This remains agent-reported information: the tools do not create the
record or validate native ownership. Preparation now durably records a session
coordinator and requires a matching agent report as an additional broker task
dispatch condition. A coordinator that requested preparation watches for destination registration and a
matching record and automatically requests comparison. When it rejoins with
control enabled, it can reconstruct a pending watch from retained messages and
the currently approved preview. This remains dependent on history retention and
current master access. For manual previews, the broker can record the original
receiver and observe its later disconnection; interruption while armed remains
uncertain until the source reconnects and the observation is rearmed. This is a
connection observation, not proof of native-process termination. The operator
can now review the comparison and attest that the original session was stopped;
the broker then allows a distinct manual receipt for task dispatch without
pretending that native movement or receiver handoff occurred. The manual-only
broker startup mode, a simulated OpenCode adapter task and a Codex proxy/process
fixture have passed locally. These use synthetic agent behavior. A completed
task's manual observation is retained when the same session begins the next
manual move after the prior task is safely completed, released or reassigned;
history is bounded and not silently evicted. Competing-writer exclusion and
all interruption and recovery cases remain open; this does not close Gate 2.

An isolated live-model probe now uses the installed OpenCode 2.2.5 with
DeepSeek and synthetic data. The agent wrote the session-record JSON, the
service was stopped and restarted, the same session was moved to another
synthetic directory, and the agent read the record and recalled a marker from
the earlier conversation. The child was denied access to the user's repository
and provider credential; the local gateway held the real key. This probe did
not load Turnlink or exercise broker approval, manual attestation or task
dispatch, so it is not end-to-end Gate 2 acceptance.

An additional opt-in isolated test, `test/opencode-live-turnlink-manual.test.js`,
passed with the installed OpenCode 2.2.5, its real Turnlink plugin and DeepSeek.
Using synthetic projects and work, the agent joined and claimed a task, wrote
and sent its session record, resumed the same session after the source process
stopped, compared the record and executed the task after a simulated operator
attestation. The coordinator accepted its result. The test supplied an explicit
`build` agent; an unset agent remains unsupported by the task snapshot path.
The OpenCode process loaded a temporary copy of the plugin and installed
dependencies; tool permissions prevented the model from reading source or
credentials, and only synthetic test data was sent to the provider. The test
did not prove competing-writer exclusion, cross-host storage behavior, a live
Codex end-to-end task, or complete failure recovery. Gate 2 remains open.

On 2026-11-07 a read-only inventory found OpenCode 2.2.5 on the Mac and
OpenCode 1.18.14 on the example project Windows SSH account. A temporary, separately
configured instance of the installed Windows runtime was started with external
plugins disabled; its local API and documentation responded. The returned API
document did not list `/api/plugin` or `/api/experimental/session`, which the
existing 2.2.5 live fixture uses. This is an obstacle to reusing that fixture,
not proof that native session data is incompatible or that a cross-host move
works. No real session, model call or production configuration was used. The
temporary processes and directories were removed and their absence checked.
A follow-up created an isolated synthetic 2.2.5 session and copied its roughly
9 KB test data to a temporary Windows location. OpenCode 1.18.14 refused to start
with that copied database, reporting that the nonempty database had no session
table. The same Windows runtime started with an empty isolated data directory,
where it correctly could not find the synthetic session. Thus direct copying
from this 2.2.5 installation to this 1.18.14 installation is not a working
resume path. This does not establish that all version pairs are incompatible or
that an export/import path is unavailable. The temporary data was removed.
An additional Mac installation of OpenCode 1.19.0 exists, but its synthetic
session creation attempted to access the user's real `.opencode` directory;
the test sandbox denied this and no 1.19.0-to-1.18.14 conclusion is available.

A further two-physical-host probe used the unchanged official Windows OpenCode
2.2.5 CLI from the [matching release](https://github.com/anomalyco/opencode/releases/tag/v2.2.5),
downloaded into a temporary directory and verified against the release SHA-256.
The Mac's installed 2.2.5 created a synthetic session and a short exchange using
a fake loopback model, then its service was stopped. A copy of the synthetic
data was transferred to the Windows host; the temporary 2.2.5 service returned
the same session ID and title and both synthetic conversation messages. No
model or existing user session was contacted. Temporary data and the 116 MB
runtime download were removed; no matching process remained. This verifies
cross-platform history reading for this controlled version pair only. It did
not start a destination turn, integrate the broker's manual approval or prove
writer exclusion, native resource reconciliation or Gate 2 acceptance.

A subsequent isolated two-physical-host probe used the same unmodified 2.2.5
pair and local fake models. After the Mac service stopped and its synthetic
session data was copied, the Windows service moved that session to a synthetic
Windows project and completed a new turn. Its fake model received both prior
source messages, and the destination history retained them alongside the new
message and reply. The runtime checksum was verified; temporary processes,
data and the downloaded runtime were removed. This verifies a native
stop/resume and subsequent turn for this pair, not Turnlink approval or task
dispatch across physical hosts, writer exclusion, external effect recovery or
full destination acceptance.

The broker's manual transfer regression now also runs with a Windows drive
path containing spaces. It covers approval, detached-source authorization,
restart, destination join, comparison and task pull using that exact path;
different slash and case spellings are refused. This is a local broker test
with synthetic host identities, not proof that a Windows runtime reports the
same spelling or a replacement for the two-physical-host acceptance test.
After ownership rotation and broker restart, the same test now also checks a
partial destination proof and a missing proof: both refuse rejoin and leave
the broker's ownership hash intact. Restoring the original synthetic proof
allows the destination to rejoin and complete the test. This verifies failure
handling with an available backup, not recovery from permanent key loss.
The same synthetic cross-host test now restores the original coordinator's
watch from retained history after broker restart and destination ownership
rotation. It verifies that the coordinator requests the destination comparison
and that restoring the watch alone cannot dispatch the task. This covers the
original coordinator returning, not takeover by a different coordinator or
recovery when the preparation history is missing.
An independent synthetic Windows OpenCode 2.2.5 session was then created in a
temporary drive-absolute project path containing spaces. Its session API
returned exactly the requested path, including casing and separators. No
Turnlink source was transferred for this probe, and its temporary runtime and
data were removed. This checks a newly created Windows session, not the path
reported by a moved session or Turnlink's full physical-host dispatch.
New manual previews also reject Windows root-relative and incomplete UNC
paths, whose destination depends on a drive or missing share. The check occurs
when applying a new command, preserving replay of prior command receipts.

A Windows plugin preflight was prepared using a local fake model, an isolated
temporary profile and the official portable runtime. The attempt to transfer
the repository's `src`, `adapters` and dependencies to the example project server was
rejected by automatic approval review because that specific source-code transfer
was not authorized. The command was not executed and no files were transferred.
The original prepared script targeted `adminmatto`, although the user had
identified `Administrator`. A read-only SSH check confirmed that Administrator
is reachable and has Node and OpenCode on PATH; the prepared script now targets
its temporary directory. No conclusion about the active desktop session follows
from that inventory. The preflight remains pending explicit authorization to
copy those materials to the corrected account.
The proposed transfer set was inspected locally: it contained 31,411 files
and about 351 MB before compression, with no files matching the prepared
credential-name and extension denylist. This name check does not establish
that file contents contain no secrets. The prepared script now fails closed
on those names and out-of-tree files, and is configured to start its synthetic
runtime and fake model with a restricted environment rather than inheriting
the Administrator process environment. The user subsequently authorized the
temporary transfer to Administrator. A first attempt timed out during extraction;
its exact temporary files were removed and no corresponding process remained.
A second attempt using direct .NET extraction showed that a raw JavaScript file
URL did not register the plugin. With a temporary package wrapper equivalent to
the local fixture, the official OpenCode 2.2.5 Windows runtime loaded Turnlink
and a synthetic local model invoked `channel_session_context`, returning the
expected runtime version. The test then also passed using the repository's
documented `adapters/opencode` plugin package directly. No external model or existing user session was used.
Temporary files and test processes were removed and cleanup confirmed. This
preflight does not prove a cross-host broker transition or task acceptance.
An additional synthetic two-physical-host probe ran the broker on the Mac and
the official OpenCode 2.2.5 plus the documented Turnlink plugin on Windows
Administrator. A loopback-only SSH reverse tunnel connected them; a fake local
model invoked `channel_join`, and the Mac broker observed the Windows agent and
its synthetic project. The Windows tool completed and both hosts' temporary
processes and files were cleaned up. This verifies cross-host plugin-to-broker
registration, not moving an existing session, a destination task, competing
writer exclusion or recovery.
The opt-in `test/opencode-physical-manual.test.js` subsequently passed an
end-to-end synthetic OpenCode 2.2.5 manual move from the Mac to Administrator
on the physical Windows host. The live model on the source wrote the session
record; after source shutdown, the operator-authorized destination resumed the
same native session, joined the broker through loopback SSH forwarding, reported
a matching comparison, and completed a task that the coordinator accepted.
The test used isolated project/profile data and the existing guarded provider
gateway, with no existing user session or credentials copied to Windows. The
fixture confirmed removal of its temporary files and processes. A prior attempt
reached Windows but cleanup initially encountered a transient locked runtime
file; the fixture now waits and retries deletion. This is acceptance evidence
for this manual OpenCode path and version pair, not independent proof of writer
exclusion, all failure recovery, or equivalent Codex behavior.

The broker now forgets cached task notifications when a receiver is replaced,
so a fast disconnect/reconnect cannot leave a ready task attached to the old
socket's wakeup. A real-broker regression reproduced the missing notification
before the fix and passes afterward. Manual preview, destination observation,
and join also search member pages by their actual returned length, including
pages truncated to fit the broker response budget. Their focused regressions
and the combined broker, adapter and Codex-proxy suite pass.
An integration test also restarts an armed broker with a live source receiver:
the observation becomes uncertain, the destination cannot pull the task, and
only reconnecting the original source permits rearming before a later detach.
This tests broker restart, not every native process or network interruption.

The manual path now permits an operator to attest the source stop and authorize
one enrolled destination host. The destination must join at the approved path
using a fresh local session proof; old-host operations are fenced, outstanding
source-offered messages block authorization, and the agent comparison and
separate task confirmation still apply. Cancelling before the destination joins
returns the observation to uncertain and requires a fresh source record. A
broker integration test covers cancellation, stale and malformed records,
unauthorized hosts, source-proof reuse, and restarts before and after ownership
rotation. Active manual observations and pending host transfers retain the
session reservation beyond the ordinary five-minute expiry; cancelled,
reassigned transfers can expire normally. A Codex proxy/process fixture also
passes with different broker host identities, including a receiver that starts
before destination registration and a native turn that finishes before its
start reply. An opt-in live OpenCode/DeepSeek test also passed with two distinct
broker host identities, separate credentials and copied synthetic native state;
the destination process was denied access to source project files and retrieved
the record from channel history. This is a single-machine simulation, not proof
of actual remote file transfer, shared-store exclusion or physical-host safety.
The OpenCode agent can request a fingerprint of its native agent/session rules;
that fingerprint does not cover OS or remote policies. Codex live acceptance,
competing-writer exclusion and the remaining interruption cases stay open.
The session record and report now require a runtime name and version comparison
using v2 messages. The OpenCode session-context tool exposes the hosting app's
version to the agent; absent or malformed versions cannot arm the manual path,
and a different or unknown reported destination version cannot confirm it. The
report contains the destination version itself, and the broker rejects a
claimed match when that value differs from the recorded source version. The
runtime product in the record must also match the session harness; a Codex
version cannot stand in for an OpenCode session, or vice versa. The
isolated OpenCode/DeepSeek two-logical-host manual task passed again using this
record and report; it remains a single-machine simulation.
Manual confirmation now uses the scheduler's deduplicated readiness signal;
previously its immediate wake could be repeated by the next periodic scan. A
broker test forces repeated scans and checks that confirmation sends one wake.
This comparison is agent-reported and exact-version, not a proof of binary or
configuration equivalence. Legacy v1 evidence is held for recovery rather than
treated as if it contained a runtime comparison.
Health freshness is now bound to the receiver connection that reported it. A
real-broker regression covers unsubscribe/resubscribe on the same connection
and replacement by a new connection; neither can reuse the previous snapshot
as fresh. A new authenticated report restores freshness. This closes an
observation ambiguity, not the native writer-isolation requirement. The Codex
proxy now reports a stable three-part version from the correlated app-server
initialize response through opt-in, receiver-bound health; the agent can ask
for its own fresh entry. Unknown, uncorrelated and prerelease responses do not
produce a version. The observation is not binary attestation. A simulated
proxy test covers publication and refusal of an uncorrelated response.
An additional opt-in offline test runs unmodified official Codex 0.165.0 in a
network-disabled container with a synthetic local model, through the real
Turnlink proxy and broker. It stops the native process, resumes the same thread
at a second synthetic location, and completes and accepts a worktree task after
manual confirmation. The participant's record and comparison are supplied by
the test fixture, so this does not establish that a real Codex agent collects
or compares its own settings, nor does it test physical-host migration, writer
exclusion or recovery. The reproducible runner is
`test/fixtures/codex-offline-manual-runner.py`.
An attempted synthetic Codex 0.165.0 Linux-to-Windows resume reached the native
Windows app-server, but `thread/resume` returned `no rollout found` despite a
copied synthetic session and an explicit path. This result cannot establish
format incompatibility: the test's Windows isolation was invalid. Codex uses
the Windows known profile directory, not just the process's `USERPROFILE`, and
created `C:\Users\example\.codex` during the attempt. The operator was
informed and chose to leave that directory intact. A metadata-only inspection
found no running Codex process; the temporary test bundle was removed. No
further Windows Codex process should run under this account as an isolated test
until a separate Windows security profile or equivalent isolation is verified.
Do not infer that the runtime could not access the real account profile. The
unsafe experimental test launcher was removed.
On Reborn, the documented SSH account was reachable but Codex CLI was not on
PATH. The official Windows Codex 0.165.0 binary was integrity-checked, copied
to a temporary file and successfully reported its version. Both copies were
removed afterward. This was only a startup check: no Windows session was
started, no security profile was isolated, and cross-host resume remains
unverified.
Subsequent Reborn isolation probes created only uniquely named local test
accounts. A process launched with alternate credentials failed with Windows
status `0xc0000142`; a temporary scheduled task did not start; and an
explicit profile-creation attempt returned `0x800706f7`. The test accounts,
profiles and scheduled task were removed, and a separate read-only inventory
confirmed no matching temporary account, profile or task remained. These
results do not test Codex session migration and do not establish the cause
of the Windows process/profile failures.
With the operator's subsequent permission to use the normal Reborn account,
an unmodified Codex 0.165.0 thread was created in a network-disabled container
on the Mac, stopped, and its synthetic rollout copied to Reborn. A Windows
Codex app-server resumed that same thread and returned the synthetic message
when the thread had been explicitly created with `historyMode: legacy`. A
separate thread created with paginated history returned `no rollout found`
when only its rollout was transferred. The latter failure does not by itself
establish which additional native state is needed. These were native CLI
checks, not a Turnlink end-to-end migration or a general Codex compatibility
claim. Temporary executables and transferred rollout directories on Reborn
were removed. The official `thread/delete` command removed the legacy test
thread; it found no thread for the failed paginated attempt. The operator's
Codex profile was retained and may contain diagnostic or other metadata
created by the native app-server.
With a separately authorized temporary copy of the Turnlink proxy on Reborn,
an official Codex 0.165.0 legacy-history thread completed the manual broker
transfer from the Mac's Linux container to the physical Windows host. The
destination proxy executed a synthetic task and the coordinator accepted it.
The fixture supplied the record and comparison rather than demonstrating that
a general-purpose agent collected them. A previous run using an equivalent
Windows path with different capitalization stopped at `CONFIGURATION_CHANGED`:
the runtime returned the same directory with its on-disk capitalization.
Resolving both paths on Reborn confirmed that they refer to the same directory.
The proxy now resolves both existing paths before accepting unequal Windows
spellings and fails closed if resolution fails. After explicit authorization
to copy the updated module, the exact correction passed on Reborn: two spellings
of the same test directory matched, while a different and a missing directory
were rejected. This was a focused filesystem test, not a repeat of the complete
broker-to-task test with the updated module. The five synthetic thread IDs were deleted with
the official Codex app-server API. The temporary remote proxy, runtimes, proof
files and rollout directory were removed, while the user's profile remains.
The unmodified reference checkout's app-server code looks up a paginated
thread in the destination thread store even when a rollout path is supplied.
This is consistent with the observed failure, but the checkout was not proven
to be the exact source revision of the tested binary. No supported import or
safe merge of a foreign thread into an existing profile has been demonstrated.
The reference checkout also documents rebuilding a missing state database from
rollouts. That is a profile-wide recovery operation, not evidence of a safe
single-thread import into an existing profile; no existing database was moved,
deleted or rebuilt for this test.
A subsequent offline probe used the unmodified official Codex 0.165.0 in two
separate, network-disabled containers. The source created a paginated session
and completed a synthetic turn; with its rollout placed under the normal
`sessions` tree before the destination's first startup, an empty destination
profile indexed it, resumed the same thread ID, and returned the synthetic turn
through `thread/turns/list`. Both profiles and temporary binaries were removed.
A second offline probe initialized the destination with a separate paginated
session, placed the source rollout under its normal `sessions` tree without
replacing the existing database, and resumed both the existing thread and the
source thread. The source thread's synthetic message was returned by
`thread/turns/list`.
A physical-Windows follow-up placed one synthetic rollout in the existing
Reborn profile's normal sessions tree and resumed the same paginated thread ID
with the stock Codex 0.165.0 app-server; `thread/turns/list` returned the
synthetic message. The user explicitly authorized the test's temporary
profile changes after automatic approval review rejected the initial attempt.
The first authorized run could not resume because its synthetic model provider
was absent from the destination configuration; the test thread was deleted.
The successful retry supplied a fixture provider as process-only CLI options,
then deleted the test thread through the official API and removed its exact
rollout and temporary files. This does not demonstrate the full Turnlink path,
or equivalence of real source and destination model configuration, and it does
not authorize replacing a user's database.
The subsequent physical integration ran the actual broker, the Windows proxy
and stock Codex 0.165.0 through a manual cross-host move of a paginated thread.
The destination retained the thread ID and source message, executed a synthetic
task and received coordinator acceptance. The fixture supplied the record and
comparison, so this is not evidence of a general-purpose agent independently
collecting the settings. Reading `thread/turns/list` before dispatch initially
invalidated the proxy's native selection; a focused regression reproduced the
failure. The proxy now treats that audited operation as a read, while its
publication barrier still holds it appropriately. With this change and the
Windows path fix, the physical test passed with history reads both before and
after dispatch. The synthetic threads, proofs, runtime and copied proxy were
removed; the user's existing Codex profile was retained.
The full local suite subsequently passed with 1,358 tests passed and 424
skipped. The operator explicitly accepted source-stop attestation as the
manual path's safety boundary; it does not prove automatic writer exclusion.
The operator also accepted manually reviewing and resolving external actions
and background work using the agent's report; this is not an independently
verified resource census or reconciliation mechanism.
The preparation request also asks the agent to describe known pending
approvals, background jobs and external actions, including uncertain status.
This is an agent-reported work summary; it does not independently enumerate
or reconcile external effects.
DeepSeek documents a Responses-compatible endpoint for Codex, and a single
synthetic connectivity request succeeded. A proposed live-model smoke test
would send synthetic conversation content and the `channel_join` and
`channel_send` tool schemas to DeepSeek. Automatic approval review rejected
the request because those schemas derive from private project code; the live
test did not start. Specific user authorization is required before sending
that payload. Temporary runtime binaries were removed after the rejection.
The operator subsequently authorized the two schemas and, separately,
`channel_history` and `channel_status`. A live test with installed stock Codex
0.165.0 and DeepSeek used all four, sent and retrieved a synthetic message,
read health status, and left the runtime unknown when the status did not prove
its version. The key remained local. This was an isolated same-host tool test,
not a combined physical transfer, nor proof of autonomous configuration capture.
A subsequent live-model physical check stopped a synthetic stock Codex CLI
session on macOS and resumed its same session ID with stock Codex on Reborn.
The resumed agent joined Turnlink, retrieved the source record through history
and sent a `reported_match` comparison. DeepSeek received only synthetic
conversation content and the four explicitly authorized tool schemas; its key
remained on the Mac. Runtime, model, provider, permissions and work were supplied
synthetic facts. This check used direct broker/MCP access and did not execute
the manual coordinator or destination proxy task. Its unique remote temporary
directory was removed following the run.
On 2026-11-08 the live OpenCode manual path passed on macOS and physical Reborn
with stock OpenCode 2.2.6, the actual broker/adapter, operator stop attestation,
same-session destination join, agent comparison, task execution and coordinator
acceptance. The agent observed its native-rule fingerprint before and after;
that fingerprint does not cover OS or remote policy. DeepSeek received only
synthetic conversation and the nine OpenCode tool schemas explicitly approved
by the operator; the real key remained on the Mac. The first two attempts did
not reach destination task execution: the second identified Windows script
execution policy as the launch issue. A process-only PowerShell option fixed
the temporary fixture without changing the machine's persistent policy. Each
attempt removed its temporary remote files; a final Reborn inventory of the
test prefix returned zero. This verifies the manual OpenCode path, not native
writer exclusion or the original Codex destination-authority requirements.
The subsequent 2026-11-08 physical Codex run combined the live model, actual
coordinator/broker and proxy in a single manual move from macOS to Reborn. It
saved an exact private source record from the agent's message, stopped the
source, resumed the same thread on Windows, obtained a matching comparison,
executed the synthetic task in that thread and recorded coordinator acceptance.
The fixture performed claim and participant report using synthetic proofs, and
the test supplied model/provider/permission/work facts to the agent. It does not
prove autonomous claim/report or full native destination authority. DeepSeek
received only the explicitly approved four Codex tool schemas and synthetic
conversation; the real key remained on the Mac. Local and remote test-prefixed
files were removed and the Reborn inventory returned zero.
The [official app-server guidance](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
documents resuming a saved thread after restarting app-server; the guidance
does not establish how to import a paginated thread into a different host's
existing local store. The experimental resume-by-history parameter in the
local protocol is labeled for Codex Cloud and explicitly says not to use it,
so it is not treated as a supported migration mechanism here.
Session preparation rejects whitespace-only model, provider, permission and
work observations: a blank value cannot stand in for an observed setting or
support a matching comparison. An unknown observation must be reported as
`null`, and still prevents a complete match.
The broker and coordinator also refuse to arm a manual stop if the source
record contains any unknown observation, because such a record cannot pass
the subsequent complete comparison. The agent is asked for a correction or to
tell the operator when it cannot verify the missing information.
If an older armed observation is followed by an incomplete record, status
inspection remains available and reports that the baseline no longer matches;
the incomplete record cannot be used to arm again.
The Codex receiver now preserves a task-available wake that arrives while an
earlier broker pull is in flight and returns no task. Previously the empty
response could clear that later wake, leaving a claimed task idle until another
notification or reconnect. A controlled test reproduces the ordering and
checks the next poll; it does not establish that this was the sole cause of
every intermittent proxy-test failure.
The OpenCode adapter had the same empty-pull wake race. A focused regression
reproduced the lost notification, and the adapter now retains a wake that
arrives during the pull, including wakes from the broker notification and
task-watch recovery paths. The next poll dispatches the claimed task. This is a
Turnlink adapter change; it does not modify the OpenCode runtime or establish
the full cross-host acceptance.
Session-watch recovery also treats a malformed history response as an error
instead of reporting recovery as successful. An active watch marks the same
condition as requiring recovery; a genuinely empty history remains valid.
The related `codex-native-agent-manual.test.js` runs the official native Codex
and real Turnlink MCP server together in an offline container. A deterministic
synthetic model invokes join, claim, record send, destination rejoin, comparison
send and task report through MCP; the broker checks the native session identity
and the coordinator accepts the task. The fixture supplies the synthetic record
values, so it does not prove a general-purpose model independently observes its
settings. It passed again after the incomplete-record and task-wake fixes; this
repeat remains a same-host test. On 2026-11-08 it also passed directly with the
installed stock macOS Codex and a local deterministic model in an isolated
profile, with no runtime download or build. The sandbox denied unrelated
repository reads. This still supplies scripted agent responses and is not the
live-model physical-host test. This test exposed a same-host resume ordering defect: the proxy could
subscribe with the old source membership before the agent joined at the new
cwd, unnecessarily making the stop observation uncertain. The proxy now sends
its native cwd on subscription, and the broker only defers subscription until
the destination join; a real source reconnection still makes the observation
uncertain. Older brokers reject the optional field and retain their original
conservative behavior. The cwd does not authorize transfer or task dispatch.
On the current example project Administrator SSH profile, `codex.exe` was not on PATH
and the formerly documented `.vscode/extensions` directory was absent. This
only inventories those locations; it does not establish that a Codex binary
elsewhere or the Claude Desktop Code runtime is unavailable.
An isolated offline container probe of the official unmodified Codex 0.165.0
Linux binary found that its initialize response matched the binary's reported
version for multiple client names and client versions, including a name with a
slash. This is version-specific evidence, not verification of the installed
macOS or Windows app-server. The same official binary, running without network
or a user profile, also started a synthetic thread through the actual Turnlink
proxy; the agent obtained its fresh version observation from a temporary broker.
This verifies that particular integration path, not session migration or writer
isolation. An isolated probe of the installed Mac binary confirmed that `--version`
works with the user's profile and network blocked. Its app-server initialization
attempted to access the default `.codex` directory and was denied by the test
sandbox, so it yielded no server version response. The probe did not read the
user's profile or start a real conversation; it does not rule out a different
supported isolated configuration.
The destination host is trusted to present the right native session: possession
of its enrolled host credential and a fresh proof is not independent evidence
of native ownership or that the source process has stopped. The operator must
verify the stop and the availability of the saved session and work. Coordinator
messages for preparation and comparison are checked against the current master
generation when the broker sends them. Recovery when that coordinator changes
after preparation still needs end-to-end verification. Once a matching manual
observation exists, the broker now refuses to reassign its preview to another
coordinator: changing only the preview would orphan the observation and its
record. Restoring the original coordinator preserves its ability to inspect the
detached observation. If the original coordinator cannot return, an operator
can cancel any pending host transfer, reconnect the original source and retire
the observation using `manual-resume-reset`. A new coordinator must then create
a new preview and obtain approval and a fresh record; the retired preview cannot
be rearmed. A broker integration test covers refusal while disconnected,
non-admin refusal, rearming the old preview being denied and the new coordinator
arming a newly approved preview. That recovery restarts from the source. A later
operator-reviewed takeover supports an already completed host transfer: the new
coordinator asks the resumed agent for an unchanged copy of the original record,
and the broker requires matching retained records before changing coordinator.
The task remains held until a fresh comparison and operator confirmation. A
durable pending intent allows the same operation to finish after a control commit
and broker restart; an uncommitted attempt may be cancelled. A broker integration
test covers changed records, non-operator requests, exact replay, cancellation,
and an injected lost reply followed by restart while the new coordinator is
offline. It also checks that an already committed takeover can be reconciled
after the task is reassigned without reopening or dispatching that task. The
pending observation retains its session reservation until reconciled. This does
not resolve competing writers or missing retained records. A further synthetic
test confirms that a second coordinator change retains the chain of both
receipts across broker restart and still requires comparison and confirmation.
After the control-side takeover commits, recovery now checks its pinned original
messages even if a newer record arrives. A changed record cannot be used to
confirm a claimed match; an identical resend and fresh comparison can be
confirmed, with the baseline and report record IDs kept distinct across broker
restart. A broker regression covers these cases and idempotent confirmation.
The coordinator's `channel_session_status` now performs the same broker-bound
baseline check before reporting a manual comparison as matching. A different
record is reported as invalid, and an unavailable or older broker yields
`baseline_unavailable` rather than an unverified match. The check does not grant
task execution or prove that the native session stopped.

After these changes, the control suite passed 684 tests with 117 skipped. These
counts include synthetic fixtures and are not destination acceptance evidence.

Existing execution has an ordering constraint: worktree-required tasks cannot
be pulled until the movement and receiver checks have succeeded. Any agent
request to prepare the record must therefore run in the existing location (or
through a separately authorized message) before the worktree task is released.
After resumption, the comparison and receiver identity must be tied to that
same approved task and session; a generic chat reply alone is insufficient.

With isolated synthetic data, installed Codex 0.165.0 has resumed the same
stopped thread at the destination with its saved history and exposed settings;
the destination survived a further restart. This test was independently rerun
after removing the experimental runtime builds. Installed OpenCode 2.2.5 has stopped
and restarted its service, moved the same session, explicitly rejoined the same
channel identity and received queued and new messages. These are native-runtime
observations, not yet an approved end-to-end broker transition: destination
authority, automatic receiver continuity and uncertain-effect recovery remain
to be integrated and verified.

The OpenCode stop/resume fixture now also obtains a fresh source/destination
snapshot after restart and before moving. On the installed 2.2.5 runtime, the
agent registry initially returned `AgentNotFoundError` after restart; loading
the plugin context and waiting for the selected agent made that observation
available without explicitly starting a new model turn. The registry can also
change permissions during initialization, so the fixture retries only the
read-only preview when its observations differ, with a bound, and compares the
stable source and destination authority digests with those from before the
stop. The installed-runtime fixture then passed.
The snapshot remains non-executable and this readiness sequence has not yet
been wired to a production migration coordinator.

- [ ] Codex publishes the approved destination's provider, model client, model
  manager, MCP and settings as one coherent session transition.
- [ ] Codex reconciles source and remote resources and recovers safely after a
  crash, interruption or lost reply, without replaying an uncertain effect.
- [ ] Normal broker and proxy startup wire the authorized movement path and
  transfer the exact receiver, with delivery and task execution continuing.
- [ ] Incompatible Desktop and other competing writers are excluded from the
  relevant stores, including normal launch and existing-process paths.
- [ ] Both Codex and OpenCode pass full destination acceptance, including
  authorization, writer isolation, handoff and recovery failure cases.

The current Codex commit explicitly refuses a retained destination, and the
manifest records movement, complete destination authority and shared-store
ingress isolation as incomplete. Passing tests for individual preparations do
not alter those facts.

An explicit Codex-only broker startup mode now allows checkpoint inspection
without configuring an OpenCode completion verifier. It refuses OpenCode
handoff operations and existing OpenCode handoff state, and does not enable
receiver release or movement. A real broker-process test checked that an
inspection-only grant cannot transfer the receiver; 79 broker and handoff
regressions passed in an independent run. This is an inspection path, not a
completed destination or production handoff.

An isolated OpenCode source using DeepSeek completed join, claim and a held
reservation through a dedicated VM Docker relay. The test repeated the
read-only plugin seal checks with acknowledged results and closed the lease
and VM. The relay's empty-body framing and half-close fixes passed its Go race
suite independently. This is an observation test using synthetic task data;
it does not prove production same-user isolation, destination placement or
movement. A separate two-VM destination attempt ended without a captured
result and is not counted as a pass.

The Codex proxy now treats loss of native standard input or output as unknown
native activity even before a movement lease exists. It refuses new automatic
work and exclusive admission while still forwarding a human interruption.
Independent focused proxy and admission-fence tests passed (42, with one
opt-in native integration skipped). This protects the proxy path; it does not
exclude independent processes from the shared stores.

Codex receiver ownership now requires a broker-confirmed subscription on the
current connection. Disconnection fences automatic delivery, overlapping
subscribe and unsubscribe requests are serialized, and a handoff racing a
pending subscription change closes the ambiguous connection for recovery.
An independent broker and client regression run passed 194 tests, including
delayed acknowledgements and the handoff race. This does not establish
cross-process writer isolation or complete the destination handoff.

The same confirmed-connection check now covers OpenCode movement and Codex
verifiers; Codex observations also reject a receiver lost and reacquired during
an asynchronous operation. Recovery confirms the actual subscription at the
broker response, and a failed membership resume no longer replays a stale
subscription. The full control suite passed 780 tests with six skips before
the last resume correction; subsequent focused receiver and verifier tests
passed, including an independent run with 49 passes and two containment skips.
These checks do not establish destination acceptance or writer isolation.

Confirmed receiver activity now also ends as soon as its socket starts closing;
a replacement socket cannot inherit a prior confirmation. The focused tests
passed independently. The experimental OpenCode observation owner links source
and destination revocation, with independently passing owner-link and local
plugin tests; it remains observational and does not establish VM custody or
authorize execution.

The opt-in OpenCode CLI subsequently passed an observational flow using a real
source reservation, confined destination and broker: it recorded and approved
the preview, revoked the adapter, closed the reservation and confirmed cleanup
of the destination container. It reused local images on a shared Docker daemon
and synthetic task data. An earlier `recordPreview` request returned HTTP 500;
the cause was not determined and two later attempts succeeded. Neither the
successful run nor the unresolved error establishes full movement acceptance.

An experimental debug-only MCP send journal is connected to both native tool
call paths, recording each transport attempt before send and leaving it uncertain
on local response, cancellation or crash. Real app-server tests covered direct RPC,
a model tool call, crash during send, a session retry with separate records, and
slot exhaustion without sending. The cancellation fixture waited for its watchdog
to reclaim the lock naturally. The native patch was exported and verified. The
journal does not authenticate the backend, establish a complete inventory or
prove remote completion; it does not enable movement or release the receiver.

An intermittent Codex MCP construction refusal was reproduced while the native
catalog was still becoming stable. The native owner now waits up to five seconds
for that observation, checks cancellation and revalidates before one capture; it
does not repeat construction. A real app-server case observed the catalog become
stable and passed recovery; a debug-only permanently unstable case refused after
the bounded wait, left quarantine and called construction once. The native patch
was exported and checked in both directions, and 207 focused regressions passed.
The earlier failure does not prove every possible binding refusal has this cause.
A separate real broker/XPC/VM fixture also reconciled revocation with a restarted
native successor and new credential, retaining the receiver hold and unresolved
remote work. The system service and production dispatch remain disabled.

Codex publication recovery now retains the broker-observed source detachment
state, refuses a change during its native observation sequence, and reports a
pending detachment while keeping the receiver held. Broker/app-server tests passed
for both attached and detached source states; a separate real broker test also
confirmed a different socket cannot observe as the subscribed receiver. Ninety-seven
journal and receiver regression tests passed. This does not release the receiver
or reconcile remote work.

A separate Codex retirement v2 preview now discloses the effect semantics and
requires explicit acknowledgement of the exact plan digest. The administrative
review command displays that plan. A broker binding to a non-dispatching arbiter
was verified against session, host and adapter revocations using real grants. The
binding now survives unchanged ticks and is rechecked after sweeps, but v2 begin
and the proxy retirement switch remain refused. A test exposed an admission/revocation race before the
remote Docker request, so a dispatch cannot be enabled until that ordering and
recovery are proved. This does not close writer isolation or remote reconciliation.

Codex contained-source retirement has an experimental path bound to an inventory
and effects approved in the worktree preview and grant. Its proxy switch is refused
until authority can be held across asynchronous effects. Real broker, resumed proxy,
app-server and Docker tests passed for retirement and lost removal reply. A
separate real-container crash test, including natural lock expiry, preserved the
ambiguous removal intent and refused replay. The receiver stays held. The current
broker authorization is checked before asynchronous effects but is not held as a
lease through them; revocation can race with an effect. Remote work, other owners,
writer isolation and receiver release remain unproved.

After a Codex app-server crash, the destination proxy can optionally correlate
the restored publication and held receiver with exact retired contained MCP
owners under their tombstone leases. The operator supplies private owner
configuration; historical journal data alone does not create an owner. A real
broker, proxy, native app-server and Docker case passed after SIGKILL, and a
separate configured-without-inventory recovery case also passed. This read-only
local observation neither proves remote work has stopped nor releases the receiver.
Targeted recovery, inventory, journal and proxy regressions passed (one skipped).

The Codex proxy also has an optional macOS metadata preflight for declared
candidate home paths. It checks private ownership, permissions and ACLs, but the
Desktop UID is asserted rather than independently identified; native configuration
can override the declared SQLite path. It does not prove the effective stores,
exclude existing writers, or authorize movement. Three focused tests passed.

The optional native resolved-store guard now also checks Codex home and the
SQLite and log homes after native configuration and managed requirements are
resolved. The same SQLite policy is checked before StateRuntime initialization
and direct SqliteConfig pool opens. Two direct Rust cases passed; a real debug
app-server passed an allowed-path control and refused user sqlite_home, log_dir
and injected managed sqlite_home overrides without opening either SQLite store.
The guard forces strict app-server configuration when enabled. The updated
native patch was exported and checked in both directions. These checks are
point-in-time: previous opens, sidecars, other SQLite openers, path replacement,
stock binaries and competing writers are not excluded, so Gate 2 remains open.

The experimental Codex target check now also revalidates the retained session
grant revision, network owner, capability roots and discovery after staging.
The source model identity is checked separately because publication replaces
that owner. Five isolated broker/app-server cases passed: a debug fixture
advanced the grant revision before and during MCP shutdown and before model
shutdown; unchanged MCP and real model-WebSocket controls also passed. The
fixture advances the revision even with unchanged grant values. Network, root
and discovery changes were not independently injected after publication. These
are point-in-time checks, not full destination authority or an exclusion of
later changes; the full Core suite was not rerun.

The experimental Codex source-shutdown paths now also verify that the exact
published model client/manager/provider pair remains installed before the
effect, after it, and when observing a live receipt. Six isolated app-server
and broker cases passed, including a debug fixture that actually replaces the
manager owner before and during MCP shutdown, before model shutdown and before
model receipt observation, plus unchanged MCP and model controls. The four
replacement cases were repeated with explicit confirmation of the injection.
These are local checks and do not establish complete destination authority or
exclude later changes; the full Core suite was not rerun.

An experimental OpenCode broker path now retains an authenticated owner lease,
fences delivery until a prepared receiver and private endpoint are activated,
and re-fences it after owner or broker loss. A real broker/native fixture passed
lost prepare and activation replies, broker restart with a message held until a
new owner activated, persisted acknowledgement, owner SIGKILL and a new generation.
A separate real fixture passed task dispatch, report and acceptance followed by a
new message and acknowledgement. Delivery remains at-least-once. The owner lease
and endpoint gate use bounded liveness checks, not an atomic proof of continued
availability. Normal broker startup now supports explicit lease configuration;
real CLI broker/owner/discovery and source-recovery owner fixtures passed. Complete
Gate 2 acceptance remains open. The lease mode is disabled by default. Further
real fixtures passed broker SIGKILL with both the natural 60-second lock expiry
and, separately, simulated lock expiry; the latter also checked that task pull
stays held and no task wake is emitted before a successor lease. An immediate
restart and a competing owner were refused, and the successor delivered a queued
message with persisted acknowledgement. A separate case passed a subsequent task
without a worktree transition after acceptance. A subsequent task requiring a new
worktree still requires a new transition; all concurrent crash boundaries remain
unverified. A broader targeted suite passed 132 regressions, and 53 focused owner,
gate, verifier and receiver tests also passed.

The current control suite passed 766 tests with two Docker cases skipped; both
skipped cases then passed separately with Docker enabled. The latest opt-in CLI
also passed lost rotation reply followed by a single second-task prompt, and an
adapter revocation during takeover (the process exited about five seconds after
revocation). These tests use a fixture initial transition and model. A separate
client on the same Docker daemon remains outside the containment guarantee.

The explicit opt-in contained-host CLI has also completed a real Docker VM-volume
takeover after supervisor SIGKILL and a second task through review. The run uses a
fixture for the first transition and model; the CLI starts the broker and recovery
owner. A separate repetition passed in 69.8 seconds with one second-task prompt.
This does not prove isolation from other Docker clients or default-on production
orchestration, and does not by itself close cross-runtime acceptance.

An isolated host/VM integration now passed a second worktree task through review
after SIGKILL of the host supervisor: it retained broker fencing, verified the
previous container, reused the dedicated volume, authenticated the successor and
rotated the receiver held before fresh idle evidence and completion. The case was
independently repeated (87.5 seconds). It uses a fixture orchestrator and explicit
opt-in, and does not exclude other Docker clients or prove all lost-reply and crash
points. It is not full Gate 2 acceptance or default production orchestration.

The isolated OpenCode runtime has also passed a complete two-worktree movement
and second-task review inside the Docker VM, with SQLite on a dedicated volume
and clean shutdown. A lock test showed that a macOS/VM SQLite bind mount can
allow a concurrent write despite an active lock, so that configuration is unsafe
for authority. A dedicated volume passed a same-VM lock and crash test. Host
broker/app integration and takeover after a crash on the dedicated volume remain
unverified; the containerized path is not enabled for production.

An experimental second OpenCode movement now passed real promotion on the same
native owner, draining, receiver rotation, placement, a new owner lease and a
second worktree task through review. A separate lost-drain-reply case reached the
second task by authenticating the existing drain without replay; the prior gate
remained revoked and a queued message was subsequently delivered. SIGKILL during
drain leaves an intent fenced after natural lock expiry. Takeover and completion
after that SIGKILL remain unproved. This second-movement path is disabled by
default; the native OpenCode patch has been exported and independently checked.

The OpenCode completion and source-recovery owner CLIs now check for an already
occupied endpoint before starting the native owner and again before release;
the recovery owner also checks before committing placement. Eleven unit tests
passed, as did isolated real-broker/plugin scenarios including an occupied
endpoint that remained held and a crash immediately after release followed by
recovery. This preflight cannot prevent path removal or replacement after the
check: exclusive final creation still detects collisions, but a race may leave
the receiver released without a published endpoint. Reserving a placeholder
alone would obstruct crash recovery and would not prevent replacement. A
release/endpoint protocol bound to a recoverable owner is still required.

The OpenCode completion and finishing recovery owners now publish a loopback
gate rather than the native endpoint credential. The gate starts closed, uses
a distinct credential, checks the exact receiver status, and revokes HTTP,
streams and WebSockets on lost authorization or native process exit. Revocation
is irreversible for that gate. Observations are coalesced and cached for up to
750 ms, with periodic checks; this is not an atomic broker lease. Eighteen
focused gate/owner tests passed. An isolated real broker/plugin test also passed
32 concurrent requests and adapter revocation, which closed the owner and
removed its endpoint; crash-after-release recovery passed. The real fixture
separately demonstrated that the native API itself answers while the broker
receiver is held. A path collision after release was also reproduced: the
receiver was already released and recovery required removing the test's own
collision. Persistent broker/owner binding, re-fencing on restart and atomic
endpoint discovery remain open; see `opencode-endpoint-release-protocol.md`.

The normal broker/source-proxy resource-preparation case and the experimental
held-receiver case with a real destination app-server were rerun on the current
build and passed. The latter initially failed its assertion because the source
fence's expected loss of ownership wrapped the fixture's completion marker in
`NATIVE_PREPARATION_UNCERTAIN`; the assertion now checks that exact underlying
cause while preserving quarantine. The preparation error retains its cause as
a non-enumerable Error cause, and 66 preparation and receiver regressions passed,
including a check that serialization does not expose that cause.
The receiver remains held; the run uses fixture authority and is not production
destination acceptance or verified release.

A real app-server characterization now toggles the test-only router drift flag
after staged publication. With the flag set before publication, the existing
guard refused staging; after staging, historical observation and source MCP
shutdown still completed while the receiver remained quarantined. The flag
simulates a differing rebuilt plan and does not mutate the actual router. This
demonstrated that the pre-publication comparison was not repeated on that
earlier path; it was not a production incident or proof of current destination
authority. The experimental path now rechecks the retained local tool plan
before source MCP shutdown and before returning its live shutdown observation.
The synthetic drift case refuses before native shutdown intent and leaves the
source running. This check is point-in-time, not an exclusion against subsequent
drift. With the rebuilt app-server, five isolated broker cases
passed: synthetic router drift before shutdown, MCP list-change refusal, normal
shutdown, recovery of a lost shutdown reply, and refusal of the live receipt
while synthetic router drift was present followed by recovery after clearing the
flag. Broader contributor drift and interruption coverage remains needed before
that authority can be used for release.
The subsequent real-memory test exposed a gap: changing the retained target's
memory summary after publication did not alter the local router plan, so the
earlier build shut down the source. The experimental check now also runs each
contributor's existing input revalidation, outside the session and persistence
locks and with a two-second timeout, before shutdown and live observation. On
the rebuilt server, the changed memory file blocked shutdown before native
intent; a separate lost-reply case refused a live receipt after memory changed,
without repeating shutdown. Normal shutdown passed. A synthetic router case in
the same run failed earlier during resource preparation with an uncertain
dispatch; a separate rerun passed. The later experimental shutdown path leaves
the native journal pending after the effect while it revalidates contributors
outside the session and settings locks. It reacquires the settings permit and
requires a monotonic permit revision to show no intervening settings or
checkpoint acquisition; otherwise it records uncertainty and does not replay.
The rebuilt app-server passed four broker integration cases: a real memory file
changed after the shutdown effect, an intervening settings checkpoint, normal
shutdown, and lost reply recovery. The first two remained uncertain. These are
still point-in-time observations; the check does not exclude changes after its
last read or prove remote authority. A counter at or reaching saturation refuses
confirmation. A standalone Rust test compiled from the extracted revision helper
passed normal, intervening and saturation cases; the full Core test suite was not
rerun for this change. After the saturation fix, the final app-server rebuild
and the checkpoint and normal-shutdown integration cases also passed. The other
two integration cases above used the immediately preceding build. Process
restart still retains quarantine.

The source model shutdown previously trusted the earlier MCP shutdown receipt
without revalidating the retained destination. A real memory-summary change
after MCP shutdown demonstrated that the preceding build still closed the
source model socket. The experimental model path now revalidates the exact
retained target and MCP witness before the effect, after it and before a live
receipt; post-effect persistence ordering uses the same revision fence. A
failed post-effect check keeps the native outcome uncertain without replay.
The current app-server passed five isolated broker cases across runs: normal
real WebSocket closure, lost-reply observation, and actual memory changes before
shutdown, during shutdown, and before live receipt observation. The first run
passed three and failed two because the new tests expected an exception where
the protocol returns null; both passed after correcting the assertions and
checking the host journal stayed uncertain. The observations are local and
point-in-time; they do not establish full destination authority, remote state or
receiver release. The full Core suite was not rerun for this change.

The retained target's instruction files were another separate gap: on the
preceding build, changing the destination `AGENTS.md` after publication still
allowed source MCP shutdown. The experimental shared target check now also
revalidates the captured native instructions with the destination configuration
and environments, within the existing bounded observation and outside locks.
The current app-server build and five isolated broker cases passed: changed
instructions before MCP shutdown, during that effect and before model shutdown,
plus unchanged MCP and real model-WebSocket shutdown controls. The first changed
instructions case was reproduced as a failure on the preceding build. These
reads do not exclude later file changes or establish complete destination
authority, remote work or receiver release. The full Core suite was not rerun.

The preceding build also allowed source MCP shutdown after modifying a captured
skill or a plugin's captured skill following publication. The experimental
target check now includes the retained plugin selection and skill-root/input
observations within its bounded local validation. The current app-server build
passed four isolated cases in the first run: changed skill, unchanged plugin,
normal MCP shutdown and normal model-WebSocket shutdown. The changed-plugin
case failed earlier in resource preparation with an uncertain dispatch, then
passed when rerun alone. Both drift cases had reproduced the gap on the preceding
build. These are point-in-time checks, not exclusion of later changes or proof of
complete destination authority, remote work or receiver release. The full Core
suite was not rerun.

The prior target check also allowed source shutdown after changing the captured
`config.toml` approval policy. The experimental check now revalidates the native
destination configuration inputs and closed enforcer bindings within the bounded
observation. Five isolated broker/app-server cases passed on the current build:
configuration changed before MCP shutdown, during that effect and before model
shutdown, plus unchanged MCP and real model-WebSocket shutdown controls. The
before-shutdown drift was reproduced on the preceding build. This is a local
point-in-time check, not complete destination authority or exclusion of later
changes; remote work, writer isolation and receiver release remain open. The
full Core suite was not rerun.
An additional actual MCP fixture changed its advertised tools and emitted
`tools/list_changed` after publication. The server did not receive a fresh
`tools/list` request during a three-second observation; the authorized source
shutdown then completed with quarantine retained on the earlier build. With the
new witness guard, the same notification instead caused refusal before native
shutdown intent, with the source alive and the host journal held uncertain.
The test reports refresh timing; this observation does not prove
whether the notification is permanently blocked or that a revised catalog was
installed. The first exploratory run expected a refresh and failed that
expectation before the test was corrected to characterize both outcomes.
The combined native MCP test now passes: a retained binding observation stays
current after installing its exact destination runtime, with both runtime
fences retained. The earlier build was stopped when free disk space fell to
about 1.2 GiB; a later offline build passed after removing old reproducible
binaries. The full MCP library suite passed all 290 tests using the installed
Codex CLI with an isolated CODEX_HOME; an initial direct run passed 289 and
failed one because the CLI path was not supplied. A current local binding
revision does not establish that an external
server has not changed or that every pending notification has been observed.
An experimental source-shutdown guard now checks the retained local binding
before writing native shutdown intent and again after the effect; a stale
post-effect observation keeps the outcome uncertain. The Core fault-injection
test passed for a refused pre-check, foreign owner and post-effect uncertainty
without replay. A broader continuity-filtered run passed 117, failed one and
ignored one; the background-compaction acquisition failure repeated in
isolation. An earlier sandboxed run also failed eight cases that needed local
sockets. These checks are not atomic and do not prove remote state; the
app-server was rebuilt and four real broker/app-server cases passed: normal
shutdown, refusal after an observed MCP notification, lost shutdown reply and
loss followed by server crash. The first new-notification run reached the
expected refusal but a later generic test assertion incorrectly expected a
completed shutdown; the corrected rerun passed. The failing background-
compaction fixture now attaches a rollout and its focused test passed. Its
first rebuild failed with ENOSPC; a second passed after removing unused
incremental build cache. A review also found that the live source-shutdown
observation could incorrectly promote an uncertain post-effect outcome to a
receipt. The experimental correction now requires a closed journal, retained
source proof, exact owner and current target MCP witness before issuing that
receipt. Two Core tests passed for uncertainty remaining unpromoted, a stale
witness refusing a receipt and normal successful observation. The updated
app-server built and passed four isolated broker cases: normal shutdown,
refusal after an observed MCP notification, lost reply and loss followed by
server crash. Historical restart observation remains distinct, and receiver
release remains blocked.
The source detachment and lost receiver-handoff reply cases also passed with a
real app-server after their assertions were updated to verify the exact
underlying completion marker when the lost source fence wraps it as uncertain.
A 344-case preparation, journal, receiver and task-dispatch bundle passed with
loopback access. Its initial sandboxed run failed to bind loopback sockets.

## Paired native resource staging — 2026-11-05

An internal staging path records a durable publication intent and installs
the prepared model pair, MCP runtime and in-memory destination settings while
retaining the source owners and configuration. The configured provider is
the actual provider retained in the installed model slot. The session stays
quarantined. Five Core cases passed, covering the installed owners and
settings, an injected failure after model installation, grant binding, and
failures injected before a settings-history append and after its flush. The
partial model failure retains the source owner and leaves source settings in
place. The settings snapshot is appended to actual thread history and the
existing thread-store flush completes before installation is recorded. A
present snapshot after an uncertain outcome does not cause replay. The flush
has not been verified as a power-loss durability guarantee, and the snapshot
does not reconstruct the complete destination configuration or resource
owners. This path is not exposed by the production commit and does not
reconcile source or remote resources, recover after a crash, or hand off the
receiver. Failure after MCP installation and settings-side callbacks still need
explicit reconciliation and end-to-end tests.

Thread-settings events produced by this staging operation now carry its exact
operation ID. An internal read-only successor observation compares the
restored journal with its on-disk copy and locates a unique matching event in
the thread history; malformed history, mismatched identity or destination, and
duplicate markers are refused. Five Core tests passed, including a restored
in-process owner with the marker present or absent, wrong operation IDs and
continued quarantine. The event field is optional for older histories. This
is not an authenticated assertion against competing writers or proof that
source and remote resources were released. The private host now exposes this
read-only observation for a subscribed thread. A two-process integration
cases passed with a real retained step and movement binding and a
fixture-created publication intent: the successor reported an absent marker,
found a synthetic matching marker, rejected a different operation ID and a
duplicate marker, and refused a new turn. The synthetic history record must
carry a valid rollout ordinal; an initial fixture lacking it was rejected
before the native observation. The production staging operation was not
invoked in those fixture-created cases. An earlier independent run failed
before restart because target step assembly became uncertain; that intermittent
issue is still open.

An explicitly enabled debug-build fixture now invokes the actual native
staging operation under the host publication barrier. A two-process test
installed the real prepared model/MCP owners and settings, observed the native
installed journal, killed the server with `SIGKILL`, and verified that its
successor found the actual operation marker while still refusing new turns. The
same fixture was refused without its explicit opt-in, before the publication
journal or settings changed. A second debug-only pause killed the first server
after the model pair was installed but before MCP installation. On restart, the
real journal remained pending, the operation's settings marker was absent, and
the successor refused new turns. The completed-staging and default-off cases
also passed on that build. This is not a production commit API; it does not
prove recovery at every interruption point, broker settlement, source or remote
resource reconciliation, competing-writer exclusion, or receiver handoff.
On the later inventory-enabled app-server build, this completed-publication
crash case passed six consecutive isolated runs. Both partial-publication
crash cases also passed on that build. These repetitions did not reproduce
the previously observed intermittent preparation refusal; they do not prove
it resolved or turn the fixture into a production commit.

The staged native owner can now journal a separate source-MCP shutdown intent,
close the replaced local runtime without reopening its request aliases, and
retain the destination and event exclusions. Its closed-runtime witness becomes
stale if later cleanup changes the source activity generation. Core coverage
exercises the installed source shutdown, refusal to replay, exact-ID observation
and journal restoration; 287 MCP tests and four native activity tests passed.
The broker now supports an explicit source-MCP shutdown disclosure in a Codex
movement preview. It is retained by the approved transition, requires the
connected enrolled receiver and current capability/idle evidence to authorize
the effect, and offers a separate read-only observation action. A schema-30
migration and export guard reject attempts to represent that new approval as
schema 29. An explicitly enabled debug-only host path now journals publication
and source shutdown IDs before dispatch, checks broker authorization around the
native effect, and can observe a lost shutdown reply on the same live owner
without replaying it. The native endpoint also requires the separate debug
fixture opt-in. One real local broker, app-server and MCP integration completed
publication and authorized source shutdown with the barrier held; the session
remained quarantined. A separate real lost-reply case observed the exact
shutdown on the same owner without sending shutdown twice. The first success
attempt timed out at app-server initialization before any effect; the first
lost-reply attempt encountered the existing intermittent destination validation
refusal before publication. Host journal tests cover lost replies, missing approval,
repeated dispatch and journal reload. This fixture does not establish
production publication, remote work or physical process release, recovery from
a crash during source shutdown, or permission to release the receiver.

A successor can now read the historical source-shutdown status from the
restored native journal after verifying the matching publication history and
exact publication, movement, step and shutdown IDs. The host correlates that
result with its durable record without advancing the record or releasing the
session. Two real broker/app-server/MCP cases passed after `SIGKILL` and
restart: one after an acknowledged shutdown and one after the native shutdown
reply was deliberately lost. In the latter, the host record stayed uncertain;
no shutdown was resent. Wrong shutdown IDs and new turns were refused. The
result is historical local evidence, not proof of physical process exit or
remote reconciliation; interruption during the shutdown effect itself and
safe promotion out of quarantine remain unproven.

Two additional explicitly enabled debug-only checkpoints were exercised with
real local broker and MCP fixtures: one killed the app server after the
shutdown intent was persisted and before the native shutdown call, and the
other killed it after the call returned but before the result was persisted.
In both cases the successor observed the shutdown as pending, the host journal
remained uncertain, no second shutdown was dispatched, and new turns were
refused. A completed-shutdown lost-reply crash regression also passed on that
build. These checks cover the call boundaries, not arbitrary interruption
inside the shutdown worker, physical process termination, remote work or
receiver release. The pause hooks are absent from non-debug builds and require
the separate staging-fixture opt-in.

After the broker contract change, the general local suite completed with 1,031
passes, 111 skips and no failures. Additional targeted cases passed for a real
local broker, missing approval or capability, altered approval, stale or
uncertain grants, receiver authentication, schema downgrade and migration.

The JavaScript host now retries only an explicit refusal of a read-only step
observation, with fresh authorization on each attempt. A lost reply is not
retried, and persistent refusal remains uncertain. All 187 relevant host
tests and syntax checks passed. Three real native retained-step binding
regressions passed, while a fourth failed with an uncertain step preparation
before observation; that intermittent failure remains unresolved. None of
these integration cases exercises the internal resource staging path.

Additional debug-level labels narrowed one intermittent refusal to the model
check immediately after destination instructions were revalidated. In that
run `constructMcp` refused before starting its native effect, while the host
preserved its durable uncertain intent. A further independent 30-run series
with finer provider-versus-metadata labels had 29 passes and one distinct
failure during target step validation at `model-inputs`; it did not reproduce
the first check, so neither cause is established. A separate 25-run lost-reply
series had two resource-dispatch uncertainties and 23 passes, with the same
pre-publication quarantine behavior. The new labels do not log model or
credential contents and do not alter authorization, retries or recovery.
These failures remain open; their exact error categories need deterministic
reproduction or more precise evidence.

The native core now permits at most three complete read-only model checks, or
target-turn validations after assembly, when the observation explicitly returns
`WouldBlock`. Other errors and changed-state refusals are not retried; native
effects are never replayed. A deterministic native test verifies successful
recovery, the retry bound, and immediate refusal for changed state. Five
target-step regression tests passed. Two real broker/app-server/MCP cases
passed, including a lost source-shutdown reply; in one case an existing
read-only host observation retry recovered a refused step observation. The
earlier intermittent failures have not been proven to result from `WouldBlock`,
and some native refusal paths do not preserve that error category. They remain
open. The initial app-server link failed for lack of disk space; it passed
after removing generated incremental build caches.

The three native read-only provider-lock checks now preserve `WouldBlock` when
the provider is borrowed, so the bounded validation retry can distinguish that
case from a changed or invalid owner. A native test held the actual provider
lock, verified direct validation refused immediately with that category,
released the lock during read-only recovery, and confirmed owner revocation
still refused. The bounded retry test and five target-step regressions passed.
On the rebuilt server the real local publication/source-shutdown case passed;
the first lost-reply case stopped during preparation before shutdown, while a
fresh isolated lost-reply case passed without replay. This fixes the lost error
classification, but does not prove it was the cause of every earlier refusal
or close the other Gate 2 requirements.

Further tracing reproduced a separate refusal while binding the movement
grant after the step had been retained: six serial cases passed before the
seventh failed. The exact validation responsible was not captured. Additional
debug markers now distinguish step assembly, freshness checks, and binding
observation versus target validation. With those markers, twelve serial cases
passed on a rebuilt native server. These repetitions do not establish that the
intermittent failures are fixed, and the markers change no recovery behavior.
More detailed assembly markers were added without changing the refusal path.
Seven further serial binding cases passed; the eighth refused target-turn
revalidation after assembly, with source and target attachments still current.
The particular target-turn check that refused remains unknown.
Additional read-only validation diagnostics distinguish the retained candidate,
owner, provider and volatile-input checks. On the rebuilt server, 14 serial
binding cases passed before one independently failed during MCP construction
with an uncertain outcome; ten further cases passed. No target-turn refusal
occurred in that series, so its cause remains unknown and the MCP construction
failure is also unresolved. No construction was retried in a failed fixture.

## Isolated OpenCode test installation — 2026-11-05

A copy of the current Turnlink source was staged under a private temporary
directory, without changing the user's OpenCode profile or production broker.
Using OpenCode 2.2.5 and a local model fixture, the real V2 service loaded the
adapter and passed its tool, wake, steering, blocked-delivery and reconnect
test. Its passive alert CLI test passed separately. The native OpenCode
movement/recovery suite passed all 30 cases using the staged host code and the
existing native source checkout. These are isolated test results, not a live
cross-host Claude acceptance or proof that Codex destination publication is
complete.

A separate test copy was staged for the example project Windows Administrator account
with pinned Node dependencies. The embedded Claude Code runtime reports
version 2.1.317. An isolated remote Claude MCP client passed its Windows
protocol test and exchanged and acknowledged a synthetic message with the
local OpenCode adapter over a loopback SSH tunnel and a separate broker with
distinct host credentials. This test used a synthetic client and session ID;
it did not establish that the running Claude Desktop Code conversation loaded
the adapter or received a message. A project-scoped MCP configuration is staged
for a separate desktop test, and uses an explicitly synthetic test identity.

The user subsequently connected a real Claude Desktop Code session using that
initial synthetic binding. The broker independently reported the receiver as
connected. Its initial `channel_join` reply had reported the earlier reserved
state because the reply was assembled before receiver subscription. The MCP
tool now fetches fresh membership after successful subscription; local channel
and session-binding tests passed (14 cases), and the Windows Claude protocol
and binding fixtures passed (3 cases). Claude Code's documented
`CLAUDE_CODE_SESSION_ID` is now accepted as the stdio server's session binding;
conflicting explicit and native bindings refuse startup. The test project was
updated to use the native ID; a fresh Desktop Code session then joined with a
different ID, and a fresh
broker query confirmed `connected: true` and `nameState: claimed`. The test
project configuration no longer sets an explicit ID. The user relayed Claude's
report that `CLAUDE_CODE_SESSION_ID` in a PowerShell subprocess matched the
ID used to join; this is model-reported evidence, not an independently captured
process-environment observation. A running MCP process retains its startup
session ID across `/clear`, so it must be reloaded before using a changed
session identity. A repeated isolated
OpenCode-to-Windows MCP exchange passed after these changes. None of these
observations establishes native unsolicited wake-up in the Desktop Code
session.

With explicit user authorization, an isolated OpenCode source review was
attempted through the configured OpenCode API, but the provider returned a
free-usage-limit error and produced no review. The temporary copy of the API
credential was removed. This does not affect the fixture results above.

The user then explicitly authorized switching the isolated OpenCode profile to
DeepSeek. The `deepseek-flash` model passed a readiness prompt and reviewed the
approved excerpts with agent tools disabled. A separate real OpenCode agent
joined the isolated channel, listed members, and reported the Desktop Claude
test member connected without sending a message. Its launcher reads the
existing DeepSeek API key into the child environment rather than storing a
copy in the test project. The review raised a potentially replaceable
interrupted commit intent, a purported uncertain-step overwrite, and a target
configuration mismatch. The uncertain-step claim is rejected by the existing
owner assertion; the other two prompted additional native checks. Their
verification is tracked below.

## Host publication read barrier — 2026-11-05

The Codex admission fence now offers the established-destination owner a
publication barrier. It stops forwarding new reads, waits for already sent
reads to finish, and releases queued reads only when the owner completes the
barrier. A failure, timeout, unexpected native approval request or user
interruption invalidates the fence and keeps queued work quarantined. Human
interrupts still pass immediately. A separate stdio fixture process verified
the ordering of an in-flight read and a subsequent held read.

The admission-fence, native-control and native-preparation suites passed 185
cases; JavaScript syntax checks passed. The barrier covers the one proxied
stdio connection and is not a server-wide read lock or Desktop writer exclusion.
The destination commit is not implemented and does not yet invoke the barrier;
model/MCP/settings publication, recovery, receiver release and Gate 2
acceptance remain open.

The debug staging and source-shutdown coordinator now requires a live guard
issued by the exact publication barrier assigned to its native control, for
the same thread, both before journaling an intent and around private native
calls. A forged function, a guard from another fence or thread, an undrained
barrier or an ended barrier is refused. When the debug publication fixture is
enabled, the resource coordinator also rejects a different fence before
native acquisition, so it does not start resource preparation under a fence
that cannot authorize publication.
This closes an accidental host-call path that previously trusted the caller to
start the barrier. The guard is an in-process coordination capability; it does
not by itself verify that the assigned fence actually forwards the native owner's
stdio or exclude independent writers. The admission, journal, native-control
and preparation suites passed 240 cases. Initial integration attempts stopped
in target-step assembly and destination-binding observation before publication;
the intermittent refusals remain open. A third independent local fixture
passed the lost-reply crash case with the exact assigned fence; the check before
acquisition and the same crash fixture passed again after the final change.

The normal stdio proxy now constructs its fence and native private control
from the same child in one boundary, which owns the child's stdio write and
observes each decoded stdout frame before proxy handling. A child-process test
confirmed an in-flight read drains before the publication guard becomes ready,
held a subsequent read, and rejected a different fence. Proxy/task regression
tests had 34 passes and one opt-in skip; the separate opt-in test initialized
the staged native app server through the normal proxy. This does not yet run a
production publication through that proxy or exclude independent processes.

The proxy boundary now requires an active output observer and live stdio, plus
the private stream when configured, before entering or retaining the publication barrier. EOF or
an output error invalidates an active owner; malformed or non-frame stdout
also marks native activity unknown, including when it occurs before ownership,
so later admission cannot assume the missing output was harmless. The original
line remains forwarded. Thirty-seven proxy, task and fence tests passed with
one opt-in skip, including real child stdout closure and malformed output;
the real native staging fixture also passed with this boundary. This remains a
single-process boundary, not exclusion of independently launched writers.

An additional opt-in integration now uses that same child-owned stdio boundary
with a real broker, retained Codex destination and debug-only native staging.
It verifies a real `thread/read` remains queued throughout model/MCP/settings
staging, source-MCP shutdown and the subsequent quarantine, then kills and
restarts the isolated server and observes the correlated shutdown journal.
The case passed twice; the separate lost-shutdown-reply crash regression also
passed after the fixture change. The test supplies synthetic capability and idle
evidence and does not exercise production movement dispatch, receiver release,
or exclude an independent writer.

## Destination MCP runtime installation — 2026-11-05

An exact retained and started MCP destination runtime can now be installed in
the session slot while retaining its source runtime and both matching request
exclusions. The operation refuses foreign source or destination exclusions,
stale slot observations and a runtime that has already begun shutdown. Its
returned owner retains the exclusions; an invalidated owner must remain
quarantined. This is not proof that source processes or remote effects stopped.

Sixteen MCP request, lifecycle and exclusion tests passed. Three Core tests
passed for the retained MCP installation, separate model-pair installation and
grant binding. The rebuilt app server also passed one isolated private-channel
retained-step regression; that case does not invoke MCP installation. The patch
reconstructs tree `e80b6dec0f3687e51a89092a3eb599e119c68012` and passed forward,
reverse and whitespace checks. The app-server SHA-256 is
`925cd46d1e941cdfe50207fa59ca5a4a41cb85989064e1615d1f92a75625081f`.

The production destination commit does not invoke either installation. A single
coherent model/MCP/settings transaction, durable recovery, source reconciliation
and receiver release remain open.

## Destination model-pair installation — 2026-11-05

The retained destination provider can now install its actual model client and
manager together in the shared session slot, after checking both observations
against the exact current source. The slot retains the exposed destination
provider and the operation returns the original source owner for reconciliation.
A stale pair is rejected before the provider callback runs. A Core test performs
this transfer with a real prepared provider, checks source owner retention and
stale refusal, and confirms that the admission fence remains held and settings
remain at the source. Two related Core tests also passed.

The production destination commit does not invoke this operation: coordinating
MCP, settings, durable intent, source reconciliation and receiver release remains
required. The rebuilt app server passed two private-channel regression cases,
which do not exercise this model-pair installation. The patch reconstructs tree
`fcdfaff7e4720907e05b54604449f08b32c7c05e`, passed forward, reverse and
whitespace checks, and the server SHA-256 is
`6a6cb520556237c328233f2f9d317329dbc509ae3c4b414b6f8c10775a134e31`.

## Restored legacy commit observation — 2026-11-05

The private host can now observe a legacy settings commit restored into
quarantine, using its exact transition ID. A pending intent reports uncertain;
a completed receipt is returned only when its journal, reservation and current
restored cwd agree. Foreign identities, changed journals and records containing
destination resource ownership are refused. This is read-only: it does not
release the native fence, authorize a broker settlement or reconcile remote
resources. A failed public resume can attach its requesting connection to the
quarantined thread solely so the subscribed private host can query it; the
resume still fails and execution remains fenced.

Three Core tests passed for an actual interrupted commit, an actual completed
commit restored in the test runtime, and ordinary completion/release. The host
control suite passed 114 tests. Two isolated process-restart tests passed through
the rebuilt server and private channel, using fixture-created pending and
completed journals; these are not end-to-end crash tests of a native commit.
The native patch reconstructs tree `747684679e1e3bead5cd4f25debd54d3b98f0b13`
and passed forward, reverse and whitespace checks. The rebuilt app-server
SHA-256 is `76d59cd5c5f65bdf9e73ab7045167921a5c64b6e126d90a4f3fec01324ad5df4`.
Complete successor recovery, destination publication and receiver handoff
remain open.

## Paired model capture in target preparation — 2026-11-05

Target turn preparation now captures the source client and manager from one
session slot and compares the manager with the reserved owner before creating
the destination client. An unrelated session slot is refused even if it holds
the same underlying manager. Five targeted Core tests passed, including that
negative case, model revision observations, retained target and step preparation,
and manager change-and-restore. The exported patch reconstructs tree
`3662ce505d2c02cc9cf6b34ac051081c26a62245` and passed forward, reverse and
whitespace checks. The app server was rebuilt and passed two isolated
private-channel cases for retained destination step preparation and movement
grant binding. Its SHA-256 is
`bebf6309f2b9d546e5e8f461d7ed4579068ff406a3b1979513fc17b80656fc5d`.
This is preparation evidence; publication, reconciliation and both-runtime
Gate 2 acceptance remain open.

## Release during an interrupted commit — 2026-11-05

The native release path now refuses a submitting commit, so it cannot erase
an unresolved durable intent or reopen admission while the effect is unknown.
It allows an untouched acquisition or a completed commit whose receipt,
reservation and journal identity agree. A real commit future paused after
writing its intent was tested both while running and after cancellation; both
release attempts refused, and the journal and admission fence remained intact.
Three additional Core tests passed for a completed commit and release, reuse
of a completed transition ID, and effect-free preparation release. The exported
patch reconstructs tree `0be4c0abd29c9157d0d0cb5708eb33379f4a02e5` and passed
forward, reverse and whitespace checks. The rebuilt app server passed an
isolated private-channel test that binds a movement to a retained destination
step; that test does not exercise the interrupted commit release. Its SHA-256
is `f120b6f2101a24cb1af0c7d0f488e592911a297b783f3d6b9ecf1d95343716d3`.
This prevents premature release; it does not implement successor recovery.

## Shared model-owner slot — 2026-11-05

Real Codex session initialization now puts the model client and model manager
in a shared slot. Their existing individual revision semantics remain intact;
a reader still must coordinate this slot with MCP and settings, and there is
no production destination replacement path yet. A first version invalidated
both observations for a change to either resource and failed an existing
retained-target test; the corrected revision handling passed that test, the
retained-step test, manager change-and-restore, and a new observation test
(four cases total). The tests required an increased thread stack and local
socket access. Core test compilation passed. The exported patch reconstructs
tree `686a7b86f28f39e16d8f61c3f534fdef608620b8` and passed forward, reverse
and whitespace checks. The app server has not been rebuilt for this revision.
This is a prerequisite, not destination publication or Gate 2 acceptance.

## Interrupted native commit intent — 2026-11-05

A commit that has written an unresolved `submitting` intent now refuses both
the same transition and a different transition; it preserves the original
journal and does not replay the effect. Provider transfer also checks that the
supplied configuration matches the retained candidate before exposing the
provider. The interrupted-intent regression now cancels an actual commit future
immediately after the durable intent is written, then checks that both retries
are refused and the journal bytes and settings remain unchanged. That test and
the existing normal commit/receipt-retry test passed. This does not prove
crash-successor recovery. The exported patch reconstructed tree
`1615cfc60e2a189669b0eb0d3726214e55e59433` and passed forward, reverse and
whitespace checks. The app server has not yet been rebuilt for this test-source
revision; destination publication remains open.

## Retained provider and client transfer — 2026-11-01

The provider publication owner can now transfer its exact provider and model
manager once while the retained step remains shared. A retained-step helper
constructs a destination model client from that actual provider and keeps the
published owner alongside it. The session commit does not call the helper:
the complete barrier, atomic MCP/settings publication, recovery and old-owner
reconciliation remain necessary before it is safe to do so.

The full provider library passed 154 tests, including one-shot transfer across
two stages; the Core library type-check passed. The exported native patch
reconstructs tree `378703c003f8172c8431ba4ec26ff9b17907f5c5` and passed
forward, reverse and whitespace checks. The app server was rebuilt for that
source and passed three real private-channel cases: retained-step preparation
and cleanup with injected preflight and no-intent responses, lost binding, and
lost cancellation with a separate-process verifier. Its SHA-256 is
`7d6587399c1b7d83db8531272b94e027c9a846685d01e039db16ed644da00dff`.
The Core helper has not been exercised in an end-to-end publication. This is
not Gate 2 acceptance.

## Native step pre-intent refusal — 2026-11-01

When the immediate retries exhaust, the live native-control owner now retains
the exact no-intent proof in memory. Same-owner recovery under the existing
exclusive journal can reauthorize and retry the same operation; the proof is
cleared before dispatch, so a lost retry reply cannot authorize another retry.
An observed fresh no-intent response may restore that authority. This does not
persist proof across a crash and does not establish successor recovery. The
host native-control suite passed 109 tests, including journaled recovery,
broker revocation and a lost reply after the recovery dispatch. The complete
control suite passed 622 tests with local Unix socket access.
The established-destination coordinator also passed a fixture case that
exhausts the immediate retries, recovers the same operation, validates the
retained step and enters its callback. This fixture does not prove native
private-channel delivery of the no-intent response.
An opt-in real app-server fixture also suppresses the first three requests
before native dispatch and injects matching no-intent replies. The host then
recovers with the same operation against the real retained native owners and
completes step disposal and resource cleanup. That fixture passed; its injected
responses do not establish native generation of the proof over the channel.
The combined preflight-refusal and no-intent fixture also passed with the real
app server, checking that all four preparation attempts use the exact operation
ID returned by the retained native step.
The journaled dispatch and same-owner recovery also recheck their admission
fence after broker authorization and immediately before a native dispatch.
Revocation during that authorization now prevents the request; 155 focused
native-control and resource-journal tests passed, including both initial and
recovery dispatch revocation cases.

The native owner reports an exact no-intent result only
when the same live owner and retained resources remain held, no step journal
exists, and a per-owner preparation gate excludes a concurrent attempt. After
that proof the host reauthorizes and may retry the exact operation at most twice;
lost, malformed or mismatched proofs never authorize replay. A failure after
the journal intent remains uncertain. Exhausting the no-intent retry limit
remains uncertain until same-owner recovery succeeds; the host does not persist
that proof for later cleanup or successor recovery. The host's earlier 105 native-control tests and
the full 618-test control suite passed. Five target-step Core cases passed; the
retained-binding case also verified the serialized no-intent proof, an absent
step intent and a successful retry of the same operation. The final app server
passed three real retained-step and lost-reply cases, including an injected
read-only preflight refusal. Repeated real-channel tests did not naturally
produce the no-intent response; that proof is covered by Core and host tests,
not yet end-to-end over the private channel. Additional repetitions exposed
separate MCP construction and post-intent step uncertainty failures. This work
does not establish crash-successor recovery or destination publication.

## Read-only Codex step preflight retry — 2026-10-31

A completed native refusal of the read-only step preflight now preserves the
exact live owner. The host retries at most twice after the initial attempt,
checking its fence and obtaining fresh broker authorization each time; timeout,
malformed response, cancellation and an actual step dispatch are not replayed.
The native-control suite passed 100 tests, including successful retry, exhausted
retry, cancellation and an unexpected error. A local native fixture passed with
one injected preflight refusal against the rebuilt server matching the exported
native source. A refusal after step dispatch can still leave an uncertain record,
and auth or plugin changes are not ignored.

## Destination provider publication owner — 2026-10-31

Target preparation now stages the actual retained provider and model manager
together through the same shared owner. The stage checks exclusive inner
handles, metadata and configuration; the transfer API rechecks under that
owner lock and retains the original owner evidence. Refusal or cancellation
leaves the owner held. The session commit does not call the transfer: combined
provider/client/manager/MCP/settings publication, old-owner and used-resource
reconciliation, durable commit recovery and receiver handoff remain unfinished.

The provider library passed 153 tests, and the retained-target and binding Core
cases passed. The rebuilt native server initially failed the combined lost-
binding and retained-step fixtures with resource and step uncertainty. The
unchanged traced rerun passed all three selected native cases; fourteen additional
concurrent fixture processes passed the binding and retained-step cases. The
initial failures remain unexplained. Strict forward, reverse and whitespace
checks reconstructed source tree `fa12da98d8442af6d36e8b2caea4262a4ae4b4a5`;
the verified patch is exported, but this is not Gate 2 acceptance.

A later traced repetition reproduced the binding failure: native
`bindDestinationGrant` returned a refusal in 39 ms, and the fixture then
dropped that response. This reproduction was not a one-second timeout.
Further runs observed `WouldBlock` from native auth-cache observation during
binding and model revalidation. A detailed capture identified an in-progress
auth reload that finished without a credential change, and another capture
found the auth-cache write lock held. A separate run found a stale or busy
plugin observation. These observations must still fail closed until the host
can coordinate or safely distinguish no-effect refusals from uncertain effects.
MCP construction and step preparation also refused in other runs; their exact
causes have not all been proven. The lost-binding fixture now drops only a
successful binding reply and passed once with that correction. Temporary native
diagnostics were removed after capturing the evidence; the exported native
patch remains unchanged.

## Cancellation verification connection lifetime — 2026-10-31

The separate-process cancellation verifier now keeps the exact owner
registration and socket occupied after returning its proof. The broker checks
that connection immediately before synchronous settlement and releases it on
success or refusal; unregistering the owner destroys its connections. The real
native lost-cancellation fixture passed with a separate broker process and
confirmed that a second verification is refused during observation, after the
first proof is delivered, and after a disconnected observer while its native
call is still pending. The full control suite passed 608 tests before the final
disconnect-exclusion change; 31 verifier and settlement tests and the native
fixture passed afterward. This does not establish atomic cross-process
liveness: operating-system disconnect notification can lag a process crash.
Normal broker and proxy startup remain unwired, and durable successor recovery,
destination publication, remote reconciliation, writer isolation, receiver
handoff and full Gate 2 acceptance remain open.

## Lost-binding fixture investigation — 2026-10-31

The native lost-binding fixture uses a one-second timeout for every private
native request, including construction and step preparation, even though it
only deliberately drops the binding reply. Opt-in fixture diagnostics now
record request method, duration and refusal without recording request contents.
One isolated run and two simultaneous runs passed. In those runs construction
and preparation replies arrived within 395 ms. A timeout under heavier load
is plausible, but these observations do not identify the cause of the earlier
intermittent failures and must not be treated as their resolution. The fixture
still uses its original timeout and production uncertainty behavior is unchanged.

## Session model-manager ownership — 2026-10-31

The native checkout is being updated so session consumers pin the selected
model manager for each operation and a continuity reservation witnesses its
identity and generation. The full Core library suite passed 2,975 tests, with
one ignored. The server build and three real native retained-step and lost-reply
integration cases passed; the exported patch reconstructs the verified source
tree. Earlier intermittent lost-binding failures remain unexplained. A slot is
not a destination publication protocol: provider/model/MCP installation,
old-owner and remote-resource reconciliation, crash-safe commit, writer
isolation, receiver handoff and both-runtime acceptance remain unfinished.

## Separate-process Codex cancellation verifier — 2026-10-31

An opt-in macOS Unix-domain transport now lets a broker call the verifier in the
process holding the actual Codex native control, admission fence and exclusive
resource journal. The broker chooses a configured private socket and separate
32-byte secret; each connection uses a fresh challenge and authenticated bounded
frames. The fd-based listener avoids Node's automatic unlink of a replaced
socket pathname on shutdown; it depends on `/dev/fd` and Node's internal handle
on the tested macOS runtime and refuses unsupported server platforms. The host registers the exact transition only while cancellation
settlement holds the journal, rejects simultaneous verification of that
transition, and removes the registration afterward. Disconnect, timeout,
malformed frames and failed authentication refuse verification.

The real native lost-cancellation case passed with the broker in a separate
process. It exercised wrong secret, wrong host, changed receipt, concurrent
observation refusal, and rejection after registration removal. The transport,
journal, preparation, broker and receiver suites passed 146 tests after the
descriptor-based listener change. The full control suite passed 606 tests
before that change. JavaScript syntax checks passed after it. The earlier intermittent binding
failures remain unexplained.

This is an explicitly supplied programmatic integration, not normal broker or
proxy startup wiring. Its secret and private socket assume a trusted local user
and separately provisioned credentials; they do not prove independent process
identity against another process with that user's privileges. The response is a
point-in-time owner observation, not an atomic lease held across broker commit.
Process-crash successor recovery, verifier deployment and key management,
destination publication, remote resource reconciliation, writer isolation,
receiver handoff and full Gate 2 acceptance remain open.

## Event completion and transport-close race — 2026-10-31

A real local event-server regression held a continuity request exclusion after a
successful response and observed it become stale when transport cleanup began
later. The native checkout now keeps the event request activity permit until
the client shutdown worker has completed. Successful response plus successful
local closure permits exclusion; an error response or interrupted/failed
shutdown retains uncertainty. The regression failed on the prior source and now
passes; all 27 MCP extension and 285 MCP library tests passed, along with 29
lower-level native activity and transport tests. The app server rebuilt and
three real private-channel cases passed for lost MCP stop, lost binding and lost
cancellation. Those integration cases do not exercise event-stream completion.
Strict reconstruction and reverse application passed for tree
`098d6bbd8627871cb9754b235f31b07fc1ad0280`, patch SHA-256
`73c53878f3dfcc82069c11d6963e41ba9d5ed71a8f961d1786400ae1cf9c386a`, and
app-server SHA-256
`c09b575861f5e94d9c6b777d027f372aececc7893f4cef12c2b66d18afc9df8b`.
This change does not establish remote server quiescence or hand off queued
events. Managed streams that cancel without a final response remain uncertain.

## Destination event-owner integration — 2026-10-31

The native checkout now constructs a detached destination with the source task's
event owner. A destination runtime cleanup exclusion retains the matching source
exclusion, and source ownership is rechecked while the candidate is held.
Provider cleanup also preserves quarantine if the source exclusion or runtime
observation becomes stale. Core construction and cleanup tests passed, including
source and destination fence invalidation. All 285 MCP library tests and 25 MCP
extension tests passed; the latter include a real local event stream opened by
the prepared destination and checked against the reloaded task. The app server
rebuilt and five real private-channel cases passed: target MCP stop, lost stop
reply, lost binding reply, lost cancellation reply, and retained-step cleanup.
Those integration cases do not themselves exercise event-stream reload.

Strict patch reconstruction and reverse application passed for tree
`b82d1e5f56658bee738215ea62734b1f0cf1624a`, patch SHA-256
`72ddefb40583bb0f8b8dcae39259152999dc38ef0f17e2a1009f873b57ed9856`,
and app-server SHA-256
`a637a8423ef852d967ad159d88d9543d39982b72d10addaf8e66434aaa45101b`.
Destination publication, queued-event handoff, physical and remote release,
crash recovery, writer isolation and full Gate 2 acceptance remain open.

## MCP event-stream ownership across runtime unload — 2026-10-31

Native source now gives retained event subscriptions a task-scoped request owner
that survives runtime unload and is shared with reloaded sessions in the same
process. The continuity reservation excludes both runtime requests and retained
event work. Clean owners can be reclaimed after their last alias disappears;
uncertain owners stay registered. Both the direct resource API and retained
opener use that owner, and credential resolution is fenced before external work.
An interrupted preliminary operation leaves the owner uncertain.

The two previously failing extension cases now pass: openers work after runtime
shutdown, and streams survive task unload. All 284 MCP library tests and 24 MCP
extension tests passed, including reload fencing, direct subscription fencing,
authentication exclusion and uncertainty after all runtime aliases disappear.
The Core destination-binding test and app-server build passed. The two real
lost-binding and lost-cancellation tests passed together on the unchanged final
rerun; two earlier combined runs failed the binding case with different
uncertainty errors before its expected assertion, for an undetermined reason.
The native integration cases do not themselves exercise event-stream reload.
Strict reconstruction and reverse application passed for tree
`937a909aa06e00fdf8c7e44dd77541a94e313271`, patch SHA-256
`8e4acdd2dd52ee0fa3b0ae11d0e4638071cbb86fd07c068b1ac570dc7fdc493e`,
and app-server SHA-256
`0c29c24df2d855c94483a577c2a5dc54b568962bef25259bce70400caab946d8`.

The registry is process-local and retains uncertain owners without an implemented
reconciliation path. The later destination integration above joins the prepared
runtime to this owner but does not publish it. The tests do not prove remote termination,
cleanup of queued updates, successor-process recovery, or atomic destination publication. Provider
and model installation, physical resource reconciliation, writer isolation,
receiver handoff and full Gate 2 acceptance remain open.

## MCP runtime generation bound to reservation — 2026-10-31

The session MCP runtime slot now supplies an opaque generation observation.
A native continuity reservation captures the source slot generation along with
its request exclusion; all subsequent owner checks require that observation to
remain current. A changed-and-restored runtime cannot revive an old observation,
and a busy or poisoned generation lock fails closed. The slot still has no
production replacement path.

All 283 MCP library tests passed, including change-and-restore and lock
contention. The Core destination binding/cancellation case passed with an
injected foreign source runtime observation. The app server rebuilt, and two
real lost-binding and lost-cancellation compatibility cases passed; actual
change-and-restore is tested in the library, not through the live app server.
Strict reconstruction passed for tree
`c6d6d8ff9de1ebbd6932646614f59037f4261d69`, patch SHA-256
`fd1c83707df7ef945a12bdd620c78b1892ae6dac95dc373ac8d2ee6b9aecc49e`, and
app-server SHA-256
`e1d781da8e3f90d0c65eff85508bddea3ba8e01939a8ec456c7549d510220456`.

A reservation witness is not a publication barrier or process-release proof.
Coordinated MCP/provider/model installation, event and old-owner handling,
process-crash recovery, production verifier transport, physical and remote
effect reconciliation, writer isolation, receiver handoff and both-runtime Gate 2
acceptance remain open.

## Shared session MCP runtime handle — 2026-10-31

Session MCP calls, hook execution and session resource clients now use one
shared runtime slot. Each operation loads and retains a concrete runtime for its
duration; independently constructed clients keep their own fixed slot. A
library test switches the slot under test and verifies that shared clients follow
the new runtime while a pinned client remains on the source. Production runtime
replacement is not exposed or performed by this change.

The complete Core test target type-checked, five retained-step Core tests and
all 283 MCP library tests passed, and the rebuilt app server passed three real
retained-destination compatibility cases including an active message board and
the lost binding and cancellation paths. Strict reconstruction passed for tree
`4de2db4bbc9205053549b7d0b921be7d12fff926`, patch SHA-256
`0cef4b2e0df0115685f2086f5a1aad9641f13042fc70b7f9a37ba0626982ce0f`, and
app-server SHA-256
`43f651f7aa52ce4ee40ea6fe137e5e05d8cbe2b324ea061a958f0b8be45e031c`.

The slot is not an atomic destination commit. Existing event subscriptions,
request fences, runtime-specific resource origins, provider/model ownership and
old-runtime shutdown must be coordinated before switching it. Process-crash
recovery, production verifier transport, physical MCP and remote effect
reconciliation, writer isolation, receiver handoff and full both-runtime Gate 2
acceptance remain open.

## Same-owner binding observation — 2026-10-31

An uncertain destination binding can now be observed on the exact same live
native owner without sending the binding again. The native check binds the
retained step, grant and directory identities to the original reservation; the
host rechecks broker state around observation. The durable host journal records
binding uncertainty and advances it only after a matching observation. A failed
host receipt write also preserves an observation path.

The Core binding test passed, including wrong-owner and wrong-grant refusals;
179 host and broker tests passed. Two real native integration cases passed,
including a deliberately dropped binding reply recovered through a reopened
host journal and the existing lost-cancellation flow. The app server rebuilt and
strict patch reconstruction passed for tree
`02202388697af9ccb2e0cb90f8c653bdb869676c`, patch SHA-256
`3d8377e8274881ca038a56fa291cf68d7f68f3a73549ae46b1160fa683dca1ab`, and
app-server SHA-256
`3f50e725687498593892d19f09ccabb02b76d490d09cf9f46ff873870381e4a3`.

This is same-owner recovery, not process-crash successor recovery. Normal
separate-process verifier deployment, native destination publication and
commit, physical MCP and remote effect reconciliation, writer isolation,
receiver handoff and full both-runtime acceptance remain open.

## Exact settlement replay after verifier loss — 2026-10-31

The broker now returns a previously committed, exactly matching cancellation
settlement after restart even when the trusted verifier is unavailable. It checks
the authenticated adapter and durable command fingerprint first; a new command
or a changed receipt still requires verification and cannot reuse the ID. This
is receipt recovery only: it cannot settle an unverified cancellation or release
the provider and MCP holds. The broker, host and storage suites passed 240 tests,
including a store restart and changed-command refusal; source checks passed.

This does not recover the native owner after process death. The normal separate
broker/proxy deployment still lacks a protected verifier transport, and native
destination publication, resource reconciliation, writer isolation, receiver
handoff and full Gate 2 acceptance remain unfinished.

## Co-located native cancellation verifier — 2026-10-31

A reusable verifier now checks an actual `CodexNativeControl`, its bound client,
the active admission guard and the exclusively held resource journal. It
revalidates the exact grant, cancellation receipt, host and subscribed agent
before and after observing the same native owner. The real integration fixture
uses this verifier with the broker, rejects wrong-host and changed-receipt
requests, and then settles and cleans up under the existing resource holds.
The host and broker suites passed 176 tests, the real native integration passed,
and the source check passed.

This verifier requires the broker and trusted native host to be co-located and
share the live control object. The normal broker and Codex proxy are separate
processes; no authenticated cross-process verifier transport or automatic
production wiring is implemented. The callback therefore does not yet make the
standard deployment recoverable. Process-crash successor recovery, physical
MCP release, native destination publication and commit, remote reconciliation,
writer isolation, receiver handoff and both-runtime acceptance remain open.

## Verified cancellation settlement — 2026-10-31

A destination cancellation can now be settled as a failed, unmoved broker
transition only after a configured trusted verifier observes the exact native
cancellation. The gateway checks broker ownership before and after verification;
a caller-supplied or mismatched receipt is refused. Schema 29 preserves the
receipt across storage and export and rejects a downgrade that would erase it.
The host journals a stable broker settlement command ID before submission and
can retry that exact idempotent command after a lost broker reply without
repeating native cancellation. Once settlement succeeds, the journal permits
separately authorized step disposal and resource cleanup.

A real integration fixture dropped a native cancellation reply, observed the
native record through the original live owner, verified and settled it through
the broker, disposed the retained step, observed tracked MCP quiescence and
released the unpublished provider owner. A timed-out MCP shutdown was observed
without replay. The MCP broker hold remains because quiescence is not physical
release. The fixture injects its trusted verifier in-process; production wiring
for an independent verifier is not supplied by this change. The affected host,
broker, storage and archive suites passed 317 tests, and source checks passed.

Process-crash successor recovery, production verifier deployment, native
destination commit and publication, physical MCP and remote effect
reconciliation, writer isolation, receiver handoff and both-runtime acceptance
remain open. This does not close Gate 2.

## Durable movement binding and cancellation intents — 2026-10-31

The host resource journal now records the exact approved movement grant before
binding and records a unique cancellation ID before native cancellation. The
coordinator retains ambiguous binding and cancellation intents without replay;
a cancellation can be observed on the same live native owner and its exact
receipt stored after a lost reply or failed receipt write. The journal validates
movement references against the retained step and both resource records, and
keeps step disposal fenced while the movement record exists.

The resource, host and broker regression suites passed 174 tests. Five focused
journal cases passed, including mismatched step identity, ambiguous binding,
failed intent or receipt writes and lost cancellation replies. Two real native
integration cases passed, including a deliberately dropped cancellation reply
followed by observation through a reopened host journal on the original live
native owner. Source checks passed.

The journal makes the intent durable; it does not make the native owner survive
process death. Binding uncertainty has no successor observation yet, and a
cancellation receipt is not independently verified or settled by the broker.
The movement and resource holds therefore remain. Native destination commit,
remote effect reconciliation, writer isolation, receiver handoff and full
both-runtime Gate 2 acceptance remain open.

## Private cancellation observation — 2026-10-31

The same live native owner can now cancel an exact bound destination grant via
the private channel. The host asks the broker before and after cancellation,
keeps an uncertain result fenced, and can observe the exact cancellation after a
lost reply without repeating the operation. A completed cancellation can also
be observed again on that same owner. Broker authorization allows this recovery
after task cancellation, while the movement and resource holds remain intact.

A real native integration test deliberately dropped the cancellation reply and
then observed the same native record without replay; the broker transition stayed
prepared. The real binding regression also passed, as did 134 host and broker
tests and the source check. Strict patch reconstruction passed for tree
`c5828df00ccbb1bd5bda9650ac97f8cd31d728c1`, patch SHA-256
`2eb3619d3e2a6c97f1c64d9bb279ca0108c4325b9dece576fe8d1d8585788d6a`, and
app-server SHA-256
`2718f3eda39a41fc8f3bfe0e0510c9f9cbfe4216bdd20114ed4353db9ff86ad3`.

The native cancellation is not yet durably coordinated with an independently
verified broker settlement. The host's recovery identity is in memory, so this
test does not establish successor or process-crash recovery. Native commit and
publication, remote work reconciliation, writer isolation, receiver handoff and
both-runtime acceptance remain open. This does not close Gate 2.

## Private broker-to-native destination binding — 2026-10-31

A private native operation now binds the exact broker movement to the retained
native destination step. The host checks both resource IDs and the step receipt,
checks the broker immediately before and after the native call, and closes the
owner if the result or subsequent authorization is uncertain. Post-bind step
revalidation observes the existing step and rechecks the movement. The native
owner serializes its retained-step state and blocks cleanup while it is bound;
this does not prove global competing-writer or external-process exclusion.

The rebuilt app server passed a real broker-to-native binding test and a
separate preparation/cleanup compatibility case. An initial integration run
exposed incorrect post-bind revalidation; the fix passed on rerun. Host and
broker suites passed 133 tests, including revocation after the native call.
Strict patch reconstruction passed for tree
`289c943e840eaafd00617748635f5c29f3160be3`, patch SHA-256
`ae130ecc60a90ca91288aca6bc302020d7a4a366e863013e1fd7fdad82fbbf7a`, and
app-server SHA-256
`1e2f31ae23fa0601c93214118d6072345068ac3a913a34752645a9f314ebe92f`.

This private binding API is not yet integrated into a complete migration
coordinator. Cancellation and its broker settlement, successor recovery,
native commit and publication, remote work reconciliation, independent writer
isolation, receiver handoff and both-runtime acceptance remain open. A cleanup
already in flight across other owners or channels is not proven excluded by the
broker record alone. Movement and final settlement remain disabled.

## Broker destination-owner movement binding — 2026-10-31

The broker can persist an approved Codex movement referencing the exact retained
MCP and provider transition and resource IDs, plus the asserted destination step
ID. Both owners must be established for the same task, claim, paths and native
reservation, and MCP must disclose step preparation. A prepared or uncertain
movement fences later broker-authorized owner cleanup and step disposal. Schema
28 prevents older stores and exports from silently losing these references.

This records only a broker assertion of the step ID; it does not prove the step
exists in the native owner. Movement execution and moved/failed settlement remain
refused until native publication and authenticated completion or cancellation
proof are wired. The broker check does not by itself serialize a cleanup already
in flight when the movement is prepared; that race needs a durable coordination
and native-owner protocol before movement can be enabled. Successor recovery,
remote reconciliation, physical MCP release, writer isolation, receiver handoff
and both-runtime acceptance remain open.

The broker, persistence, provider, archive and related suites passed 164 tests;
the updated MCP and live broker suites passed 40 tests, including restart,
tampered identity, cleanup and settlement refusal, and schema downgrade checks.

## Same-owner destination grant cancellation — 2026-10-31

The native journal can now record cancellation of the exact bound movement grant
before commit, under the same live owner and reservation. It writes the schema 6
record before clearing the in-memory binding; exact retries and observation return
the recorded result. Separately authorized step disposal, provider cleanup and
tracked MCP quiescence can then proceed without downgrading the journal schema.
Rebinding is refused until a future settlement/recovery protocol resolves the
cancellation. This supersedes the cancellation limitation in the historical entry
below, but only for this private same-owner path.

The Core binding/cancellation test, five retained-step regressions and four
host-grant regressions passed; no crash was injected. Two native private-channel
preparation/cleanup compatibility cases passed; cancellation was tested only in
Core. Strict patch reconstruction and reverse checks passed.
The app server rebuilt from tree `1aa4b19cf90da7aebbca091226a43d6b1051ea6b`,
with patch SHA-256 `3ae38876415492335999ea7a1cc2235fcfee65b40a30695922443eb9351aadbc`
and app-server SHA-256 `f7ce8a352f19120d8884b72711c50101dd42f9ced2877c06cfe7f2f40e769675`.

The operation is not exposed through the private channel or authenticated and
settled by the broker. Successor recovery, remote cleanup and physical MCP
release remain unproven. Destination publication and commit, writer isolation,
receiver handoff and both-runtime Gate 2 acceptance remain open.

## Retained destination movement-grant binding — 2026-10-31

A private native primitive can now record a separately identified movement
grant against the exact retained provider, MCP owner, candidate and prepared
step without overwriting either resource grant. It requires matching task,
claim, channel and paths, distinct movement and resource previews and transition
IDs, current retained target observations, and writes journal schema 6. The
bound step and resource owners remain held. The primitive assumes its host has
freshly authenticated the broker assertion; it is not wired to the broker or
private channel and does not authorize execution, commit or receiver release.
Cancellation and restart recovery of this bound state remain unimplemented.

The Core binding case passed, including identity mismatches, same-grant retry,
retag refusal, journal readback and cleanup refusal. Four legacy host-grant and
five retained-step cases passed. The app server rebuilt and two private-channel
preparation/cleanup compatibility cases passed; the new binding was tested in
Core only. Strict reconstruction and reverse checks passed for tree
`36faedd96e3ff590a29aa3a72a4c401b164f3500`, patch SHA-256
`9690964a9b27f10da12038ad416186b17d2c8a88d25645c334740680a8e465cc`, and
app-server SHA-256
`ffb2dc27cebf18b5ff034080af98369059107cb9ab2e3ff66f67c52e5e433f55`.

The broker cannot yet create a movement grant alongside these resource holds;
native commit and recovery, MCP and remote-work reconciliation, writer
isolation, receiver handoff and full Gate 2 acceptance remain open.

## Model-client generation witness — 2026-10-31

The private session model-client slot now provides generation-bound native
observations. Test-only replacement changes the generation, so restoring the
same client object does not revive a stale destination or compaction witness.
Target-turn validation and background-compaction adoption use this observation.
No production replacement method is enabled; an eventual commit must coordinate
its own publication, the session lock and all retained resource ownership.

The Core test target checked successfully. A retained-target replacement and
restore case, eight stale-compaction cases including restore, and five retained
step cases passed. The rebuilt app server passed two private-channel retained
preparation and cleanup compatibility cases; replacement was tested in Core
only. Strict reconstruction and reverse checks passed for tree
`a8e6712c1667a174c6647ddd7d16299976bd9c46`, patch SHA-256
`e269a5417f1a34427d5a7d03eafccac9864e1cd505572193dcefed1f0b04fec3`, and
app-server SHA-256
`025fa9f8b20877166365ca70a5c38c1cdda90bcc8b65e2363a1e0df759e0036e`.
Actual destination publication and recovery, MCP and remote-work
reconciliation, competing-writer isolation, receiver handoff and full Gate 2
acceptance remain open.

## Detached destination model client — 2026-10-31

Target-turn preparation now retains an unpublished model-client snapshot built
with destination configuration and the inert target provider view. It preserves
conversation identity and session context while starting model connection state
fresh. Revalidation checks the current source-client identity; that check is
point-in-time and does not detect replacement and restoration of the same
object. The snapshot does not resolve credentials or authorize execution, and a
future commit must construct and publish against the actual retained provider.

A Core test checked distinct destination settings and preserved identity; five
retained-step regressions and a source-client drift case passed. The five cases
ran before the final test-only addition. The app server rebuilt and two real
private-channel retained preparation and cleanup cases passed; differing client
settings were unit-tested, not published. Strict reconstruction and reverse
checks passed for tree `f89720599782dc77da945fbfbce454e90627469b`, patch SHA-256
`c7e2cbb6ad9fcae0dbf9bb5607061848e75d5f473a48d8f339b2f5365ed67d62`, and
app-server SHA-256
`05193eead2d8b4e6ab8e2e786d11c36e9b77748b24ae79d2090e8dc6ecb5d60a`.

Atomic generation tracking, actual destination publication and recovery, MCP
and remote-work reconciliation, competing-writer isolation, receiver handoff,
and full Gate 2 acceptance remain open.

## Auxiliary user-shell admission — 2026-10-31

A user-shell command started alongside an active turn now retains continuity
admission in the spawned worker until local execution returns. Previously the
foreground turn could disappear while that worker continued without the
admission hold. A Core test ran a real short-lived shell command, removed the
foreground turn and verified admission stayed held until command completion.
The existing standalone shell regression passed. This does not establish that
any detached descendants or remote work have stopped.

The app server rebuilt and two private-channel destination preparation and
cleanup compatibility cases passed; those cases did not run the auxiliary
shell. Strict reconstruction and reverse checks passed for tree
`9dd95933e79f7c5ed57606867e7fd3d2051bfea8`, patch SHA-256
`b3bde39eb7922a82a562a1f528d3f0eb77071c5821ed797b0b010d02543059c8`, and
app-server SHA-256
`42cbc7ea0fc7d1ab79efb901923f364d782f2213f37561b4ffb0b0113aaf4555`.
Destination publication, MCP and remote-work reconciliation, competing-writer
isolation, receiver handoff and full Gate 2 acceptance remain open.

## Failed Apps MCP initialization investigation — 2026-10-31

With a synthetic ChatGPT account, Apps enabled, and a local mock that does not
implement the Apps MCP endpoint, native MCP request exclusion becomes
unavailable during step capture. Temporary local instrumentation showed the
Apps client initialization and unclosed transport reporting unsuccessful
activity. Immediately after capture the native activity count was one and its
uncertain flag was set; after three seconds the count was zero and uncertainty
remained. The diagnostics were removed. A focused regression passed against the
uninstrumented code and checks that exclusion stays unavailable in this case.

This identifies the failure path in the fixture; it does not prove a remote
server did no work or provide a recovery protocol. Native resource reconciliation
and the remaining Gate 2 work stay open. Strict reconstruction and reverse
checks passed for tree `9e891d49cc7b1ab97a59320d9acf57b764d7ef34`, patch SHA-256
`304a3c6cb9d64d9614774107ab65b73328b2bdaa6e59818868095708d6110ea8`.
Only test code differs from the previously built app-server source tree
`772872f21f31446c0e2e0852007015371b1661e8`.

## Compaction acquisition with MCP disabled — 2026-10-31

The delayed-compaction test now retains its temporary home and explicitly
disables MCP servers. It confirms that MCP request exclusion is available
before and after step capture, that an active compaction blocks reservation,
and that the reservation succeeds after completion and retires the candidate.
All three async-compaction tests passed. The previous default configuration
became unavailable during step capture before compaction began; this comparison
does not identify whether that hold was active work or uncertainty and does not
resolve the general MCP release requirement.

Strict reconstruction and reverse checks passed for tree
`a4e52b164b2e867a343d5731e0be3a4064ac4f89`, patch SHA-256
`f75f81a38d3ce2e74c284bd75025376b978dc4e5540b4fdaa66e71588f81dbf6`. Only
test code changed from app-server source tree
`772872f21f31446c0e2e0852007015371b1661e8`; its prior build and integration
results remain historical evidence, not a new app-server run.

## Background compaction admission — 2026-10-31

A background compaction worker now holds continuity admission through local
completion. Once no worker remains, a successful reservation discards the
completed optional result and its source-client reference under the session
lock. This prevents a reservation from overtaking this local work; it does not
prove remote work has stopped after a failed or cancelled request.

Three async-compaction tests and six native reservation regressions passed. A
delayed local HTTP response verified that the write admission is unavailable
while the real worker runs and that completed speculation can be retired under
the write admission. Full acquisition after that particular request was not
verified: the fixture separately retained MCP activity, so the test preserved
that hold and exercised the retirement operation directly. The rebuilt app
server passed two private-channel preparation and cleanup compatibility cases;
they did not inject delayed compaction.

Strict reconstruction and reverse checks passed for tree
`772872f21f31446c0e2e0852007015371b1661e8`, patch SHA-256
`50bbfe7bc2da28143c21112fdd9a6864c0a488ed2202dc41bb31582989d2ff87`, and
app-server SHA-256
`5188b600607c7c2c0b6e5d7be095de10f886a605bf04de2974781953449138f6`.
Destination publication, MCP and remote-work reconciliation, writer isolation,
receiver handoff and full Gate 2 acceptance remain open.

## Background compaction client ownership — 2026-10-31

Background compaction now captures the exact model-client snapshot with its
input, uses it for the request, and checks its identity before adopting or
installing the result. This prevents equal authentication generations from
making results from two different clients interchangeable. Six stale-prefix
cases passed, including client replacement with the same authentication
generation and both skip and foreground fallback; two existing asynchronous
compaction cases passed. The Core test target checked successfully.

The app server rebuilt and two private-channel source-continuation and target
preparation compatibility cases passed; they did not exercise live model-client
replacement or compaction end-to-end. Strict patch reconstruction and reverse
checks passed for tree `efc9daba0f3e1bfa4350ac1efaa83fb0641a06f8`, patch SHA-256
`7840d0ff07a23b063eae14d95c6be3df1b3b22057535232896ebfacad06872d9`, and
app-server SHA-256
`fff24557d0057b8bd06923774cf381fe261bd4128655f9aacb5e98b6cf3f188e`.

No replacement is enabled. A future commit must coordinate replacement under
the session lock and separately drain or reconcile in-flight requests; these
point-in-time comparisons do not themselves authorize publication. MCP
ownership, resource reconciliation, writer isolation, receiver handoff and full
Gate 2 acceptance remain open.

## Session model client snapshots — 2026-10-31

Session model-client consumers now capture a stable client from a replaceable
slot. A focused test replaced the slot using distinct source and destination
authentication owners and confirmed that an earlier snapshot kept the source
owner. No production replacement is enabled. The future native commit must bind
replacement to its reservation and reconcile old prewarm, realtime, compaction,
model connections and cached state; this change does not do that.

The Core test target checked successfully before formatting and the added test,
and the focused snapshot test passed. The app server rebuilt and two real
private-channel cases passed, covering source continuation and retained target
preparation, not a live replacement. Strict reconstruction and reverse checks
passed for tree `8853a35d3ae3451557687e0966f4c543688b23fc`, patch SHA-256
`8c518a528046da80840d394a3e64f6a55c600574767673be11360fbcf31841b9`, and
app-server SHA-256
`99e536eaec7f712b4027b7afdff7e35df4e8073c628b1d4279035d5f0605db08`.
Destination commit, MCP ownership, resource reconciliation, writer isolation,
receiver handoff and full Gate 2 acceptance remain open.

## Startup prewarm admission fence — 2026-10-31

Startup authentication and model prewarm now hold the source continuity
admission until their spawned work exits. Code-mode startup holds its own
admission for the same period. A held reservation prevents these paths from
starting. This closes a local race where a reservation could overlap source
startup work; it does not prove cleanup of a started code-mode process, remote
work, or other background tasks.

The reservation-first Core case and a shutdown regression passed. The rebuilt
app server passed two real private-channel destination preparation and cleanup
cases. These tests did not inject a blocked in-flight prewarm worker. Strict
patch reconstruction and reverse checks passed for tree
`9269b0923f5899e21e9000a1d4da5808327aa188`, patch SHA-256
`b53abfbc43387aacff245fb2c2ac145e397ac8b417f9031e727dcefd958c20c9`, and
app-server SHA-256
`78b7e327ffd1310bf8399b0d422e8bd79be7e8cfd1cdcb8d3b5f6acd294c9d68`.
Destination publication, all resource reconciliation, competing-writer
isolation, receiver handoff and full Gate 2 acceptance remain open.

## Model client provider ownership — 2026-10-31

The native model client can now be constructed with an existing provider owner,
so a future authorized destination publication can use the exact retained
provider instead of silently constructing another one. The ordinary constructor
still creates the provider as before. A focused Core test verified provider
identity in the client and a new model session; the test source was formatted
after that run. The app server rebuilt, and one real private-channel retained
destination preparation case passed. Strict patch reconstruction and reverse
checks passed for tree `d5db601089eef6b3eb5cd3ae89696add99b9bd67`, patch SHA-256
`3db191a182ffd4a276eb2c143c8ce6db2d3280445090f08fca593a668c477fd4`, and
app-server SHA-256
`7876a28bc0ab24deced0b27ea612066a17580458e1a118ccde97855d524c4b93`.

This constructor does not publish a provider, transfer MCP ownership, commit a
destination, recover a crash or release the receiver. Those paths and the other
full Gate 2 requirements remain open.

## ChatGPT catalog provider owner release — 2026-10-31

The completed catalog owner-release path now also supports an unchanged cached
ChatGPT account with an explicit catalog endpoint. Authentication revision changes
during the request keep the owner held; external, command and gateway auth remain
outside this verified scope. Thirty selected provider tests passed, including a
forced account witness revision while a request was in flight. This test did not
inject an actual OAuth refresh.

The rebuilt app server passed two private-channel cases using a synthetic ChatGPT
token, checking the request Authorization and continuing the source conversation.
A lost cleanup reply was observed without replay. Strict patch reconstruction and
reverse checks passed for tree `59e3bfdc3d2990bbbd45c2ac25c72aa7f2e466d4`, patch
SHA-256 `05f48bd7b6c42dd652bca47f6811f8f4990119c2006fa142eaf4c8a720a15fb0`,
and app-server SHA-256
`a07b719e2c344d354b129ea91731338477d465e11c8609d537deb6c270c83162`.

Enabled destination history, other provider effects, physical MCP release,
competing-writer isolation, native commit and receiver handoff, and complete
both-runtime acceptance remain open. This change does not close Gate 2.

## Completed catalog provider owner release — 2026-10-31

The native cleanup path can now release an unpublished provider after a
successful catalog response and successful native cache write, when the exact
configured provider used an explicit catalog endpoint and API-key credentials,
the cached account was absent or an unchanged API key, and no external auth,
command auth, gateway auth or live provider handle was exposed. The actual
provider and model manager must be exclusive; the process-local native cache
worker cut stays held through synchronous disposal. Interrupted or failed
requests, failed cache writes, unsupported auth and exposed handles remain held.
The catalog worker also releases its extra resource alias before responding.

Twenty-nine selected model-provider tests passed, including a cancelled real
HTTP request, failed HTTP/cache cases, strong and weak aliases, a competing cache
hold and live-handle exposure. Three Core cleanup cases passed on tree
`538a5f9e0666d2d65df11154c4fbef23132f5802`; the final tree differs only in
provider test code. The rebuilt app server passed seven private-channel cases:
completed catalog cleanup and continuation of the same source conversation,
lost cleanup reply observed without repeating disposal, host-journal settlement
while the separate MCP hold remains, cache failure, receiver disconnect and
two model-context controls. Strict reconstruction and reverse checks passed for
tree `c0111e85f031f50d2c9b5c1a2ac1b23c37ecad73`, patch SHA-256
`4a44ae74dbc5b92e4bc272f7a91c9af859792b440473d32e87c522ae43a9e1ba`, and
app-server SHA-256 `a2eb2115d48256e22fd15da56e1640221d3ee9e4945e3c32757e499dff590ee2`.
The broader host run initially exposed stale step-dispatch fixtures missing the
required preflight method. Those fixtures now implement the current contract
and cover a preflight refusal before any step intent; the provider-establishment
and resource-journal suites then passed all 58 cases.

This is local owner release for the verified completed catalog case, not global
credential or network cleanup, remote-effect reconciliation or destination
execution authority. Used-provider recovery for other account and effect types,
enabled history, physical MCP release, competing-writer isolation, placement,
receiver handoff and both-runtime Gate 2 acceptance remain open.

## Launchd delegation escape and sandbox control — 2026-10-31

The launchd-owned MCP fixture now exercises a tool that asks launchd to start a
second uniquely labeled fixture job. Without a sandbox, the delegated job runs
in a different coalition and remains alive after the original server and its
detached child stop. A query of the original coalition therefore cannot by
itself prove that all work initiated by the server has stopped. The test
explicitly removes both fixture jobs and checks its path-verified processes.

The paired case starts the same MCP fixture under an inherited macOS sandbox
that denies `mach-lookup` of `com.apple.xpc.launchd`. The real MCP SDK still
initialized the server and invoked its tools; the delegation attempt returned
an error, and no second fixture job or record appeared. Both the unsandboxed
escape and sandboxed denial cases passed on macOS 26.6.2 using the opt-in
`test/codex-mcp-launchd-native.test.js` test.

This demonstrates one concrete escape and blocks that exact `launchctl submit`
path in one controlled setup. It does not show that all XPC, process, network,
or filesystem-mediated delegation paths are contained; that other MCP servers
remain compatible with the sandbox; or that the sandbox, identity, crash
recovery and broker verifier are wired into Codex. It does not authorize an
MCP release or close Gate 2.

## Launchd-owned MCP transport experiment — 2026-10-31

An opt-in macOS fixture now starts a temporary MCP server as a distinct launchd
job, attaches its stdin/stdout to a private Unix socket, checks the socket peer's
effective user and PID against the fixture executable, and confirms the server
and its detached-session child share a coalition distinct from the controller.
The actual MCP SDK client initialized the server, listed a tool and called it
successfully across that socket. After job removal the child remained alive and
the targeted coalition query still reported one active task. The test terminated
only the fixture binary's path-verified child and observed no remaining fixture
processes. The fixture records both process IDs before allowing the child to
detach, so early setup failures can clean up the recorded owner.

`TURNLINK_CODEX_MCP_LAUNCHD_PROBE=1 node --test test/codex-mcp-launchd-native.test.js`
passed on macOS 26.6.2. This demonstrates a possible transport shape and a
positive observation of the orphan in one controlled setup. It uses temporary
`launchctl submit`, a minimal server and private coalition interfaces; it does
not modify the Codex launcher or produce a cleanup receipt. Durable launch and
identity binding, the server's full environment and stderr, process-creation
paths outside the coalition, crash and broker recovery, remote work, and an
independent release verifier remain unimplemented. Gate 2 remains open.

## Direct macOS coalition observation — 2026-10-31

The prior coalition-list probe's caller-buffer check cannot detect every
truncation. [Apple's published XNU implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
first counts coalitions, allocates an internal buffer, then enumerates again;
if coalitions are added between those passes, it may return an incomplete list
without filling the caller's larger buffer. The fixture now explicitly treats a
missing entry as unknown. A missing list entry is not a cleanup receipt.

The same self-cleaning launchd fixture now also queries the exact coalition via
the private `coalition_info_resource_usage` interface. On this macOS 26.6.2
host, its started-minus-exited count was two while the worker and detached
child were alive and one after launchd removed the worker while the child
survived. After the fixture child was terminated, the query returned errno 3
(not found), as did a query for ID zero; that failure is not classified as
proof that the expected coalition was ever owned or released. The asserted
fixture passed and left no visible fixture processes. The code is a probe, not a
production verifier, and the published XNU main-branch source is not verified as
the exact build installed here.

The direct query avoids this particular system-list omission for a *successful*
query. It does not establish the complete lifecycle on this OS build, durable
coalition identity or sealing, an independently verified relationship to the
real MCP owner, other process-creation paths, remote work, or crash recovery.
MCP release and the other Gate 2 requirements remain open.

## Isolated Desktop application turn — 2026-10-31

The installed Desktop application completed a real UI chat turn against a
loopback mock model in a disposable macOS sandbox. The test created distinct
synthetic Desktop home and Electron profile, denied external IP connections and
reads from the actual user home, and verified the application's SQLite database,
native session SQLite and rollout under the isolated home. A separate synthetic
shared-home sentinel and instruction trap remained unchanged, and the trap did
not appear in model requests. The opt-in integration test passed using the
installed application and a local mock; no real provider or credentials were
used. It directly launches the application executable, and uses `--no-sandbox`
for Chromium inside the inherited outer test sandbox because nested sandbox
initialization fails on this host.

This adds full-turn evidence to the earlier isolated startup and app-server
tests. It does not test the real application through Launch Services or the
production renderer sandbox, establish managed-configuration coverage, or
exclude an already-running Desktop instance or another launcher using the
shared home. The full competing-writer boundary and Gate 2 remain open.

## Target step panic recovery — 2026-10-31

The detached target step worker now catches unwinding during contributor
assembly, asynchronous validation, and the final retained-input check. If the
operation still matches the durable pending intent, the existing failure path
marks it uncertain, keeps the provider and MCP owners held, and refuses replay.
Previously an unwinding worker could leave that intent reported as pending
indefinitely. The catch does not establish that external effects stopped, and
does not cover aborting the process, panics outside these boundaries, or a
failed uncertainty-journal write; those cases still require reconciliation.

Five Core retained-step tests passed. The added case injects a panic after the
intent and before assembly, verifies the persisted uncertain state and
observation, and checks that replay, provider cleanup and MCP quiescence remain
refused. The final retained-input catch is not separately panic-injected. The
app server rebuilt and nine real private-channel compatibility cases passed;
the panic injection is Core-only. Strict reconstruction and reverse checks
passed for tree `3b8bd4a0bf728ab79a560bc600e1c5f27a120e74`, patch SHA-256
`f7a380a40fc9dbebdefc64171d50473c692af5eae27ffe0f516f969b2194b3c5`, and
app-server SHA-256 `7ff8b4115168133dd957e236472fefff887f6be5e14e01c98e03bb0450e8dada`.
Enabled destination history, used-provider recovery, physical MCP release,
writer isolation, placement/recovery, receiver handoff and full both-runtime
Gate 2 acceptance remain open.

## Destination publication dependency — 2026-10-31

The legacy `continuity_commit` rejects a held destination candidate, provider
plan, MCP plan or host grant. Its `update_settings_if_authorized` call rebuilds
session settings and marks MCP runtime inputs dirty when they differ; it does
not install the retained target router, provider or MCP runtime. Thus relaxing
the refusal cannot publish the prepared destination. A production commit needs
an explicit publication path that binds those exact retained owners, coordinates
settings and runtime installation under the reservation, and persists a receipt
that the receiver verifier can recover. Its crash ordering must also account
for settings publication before the rollout flush and receipt write. These are
implementation requirements, not evidence that publication is complete.

## Destination history effect boundary — 2026-10-31

Inspection of the native call path changes where the enabled-history work must
be integrated. `continuity_assemble_target_step` prepares contributor state
and the detached tool router; it does not build the initial prompt or invoke
the history hint. `build_initial_context_with_world_state` invokes
`contribute_thread_context_for_step` later, when the initial context is built.
The history contributor's ordinary path issues a POST through the provider's
authentication and HTTP transport. Its target path currently returns no hint,
and enabled history is refused by preflight. The existing durable step intent
therefore cannot, by itself, account for a later promoted-turn hint request.

The retained target context currently contains `NativeToolProvider`, an inert
planning view; it cannot perform that request. Borrowing the actual provider
through `NativeConstructedProvider::provider()` permanently marks it exposed,
and `try_release_unpublished` then refuses cleanup. The provider's ordinary
auth resolution may also do work before the HTTP request's own timeout starts.
Consequently, wiring the hint to a cloned provider or treating completion of
step preparation as completion of the hint would leave used-provider and
interrupted-request recovery unresolved.

The destination implementation must bind the prompt operation to the retained
candidate, actual provider and destination identity, authorize and record its
effects before execution, retain ownership across the request, and handle a
lost response or process failure without replaying an uncertain operation. It
must preserve the hint and history tools across actual promotion, and reconcile
the used provider before releasing its resource hold. A timeout or dropped
client future alone cannot establish that remote work stopped. Acceptance needs
the real enabled-history path, interruption/lost-reply cases, and cleanup and
handoff evidence; the current preflight refusal remains in place until those
pieces work together.

## Closed destination turn-input contributor check — 2026-10-31

The trusted host now classifies destination turn-input contributors before step
preparation and before target callbacks. The standard skills contributor must
be the exact instance registered for tool preparation. Missing, unknown or
unpaired contributors are refused without calling their callbacks; an empty
registry remains valid. Ordinary source turn input is unchanged.

Seven native collector tests passed, including an unknown callback trap, absent
classifier, missing and different owners, a matching owner and registry clone.
Six extension-registry API tests and four Core retained-step tests passed. The
new Core case confirms preflight and direct preparation refuse an unknown
contributor before its callback and that unused provider cleanup and MCP
quiescence succeed. The rebuilt app server passed nine real private-channel
compatibility cases. A promoted live target turn is not exercised end-to-end.
Strict reconstruction and reverse application passed for tree `423f74860c227a6e447d14f956e5aba824b88a11`,
patch SHA-256 `65a5689ecb8b1519120c60c0e39c2e38b46bf5005f7a557960f111da274e3ebb` and app-server SHA-256 `0fea309cb44f7725f6dec9a67e9a40bf564ef437b7816e68a8e9a91c608700a3`.

Type and instance recognition do not certify external state or recover effects.
Durable provider recovery, pending shadow and diagnostic handoff, target
environment authority, live publication, physical MCP release, writer isolation,
placement/recovery, receiver handoff and full both-runtime Gate 2 acceptance
remain open.

## Target skill input single-flight — 2026-10-31

Detached skill turn input now reserves an in-process, step-bound attempt before
provider discovery. An active attempt makes the target unavailable to external
readiness checks. A duplicate, completed-attempt replay, cancellation or failed
freshness check marks the attempt uncertain; a duplicate does not re-enter the
provider. Core's target turn-input assembly checks contributor validity after
each callback so that an empty rejection is not accepted as a valid prompt.
Ordinary source turns do not use this gate.

All 182 skills library tests passed. They include a blocked provider, concurrent
duplicate and cancellation attempts, completed-attempt replay, and the readiness
method consumed by Core. Three Core retained-step tests and nine real
private-channel compatibility cases passed. The duplicate and cancellation
behavior is unit-tested; a promoted destination turn and Core's new post-callback
check are not exercised end-to-end. Strict reconstruction and reverse
application passed for tree `0671842c610d9e5f901455108cd815a049ccbbd4`, patch SHA-256 `f814c0a53bf180ace2bf26199dff77009d0f41037d54cfe34d85d8d304e9e103` and app-server
SHA-256 `1049a1a5a53f0c600fea40be714b2240cdc167b104186c977d6563d136510ac1`.

The attempt state and generated fragments are not durable, and a cancelled
provider may have external work that this in-process guard cannot prove stopped.
There is no atomic publication barrier, crash-safe effect receipt or recovery
protocol, nor a completed handoff for pending shadow work and diagnostics.
Unknown turn-input contributors, provider and environment authority, physical
MCP release, writer isolation, placement/recovery, receiver handoff and full
both-runtime Gate 2 acceptance remain open.

## Target skill shadow preparation — 2026-10-31

Detached skill shadow selection now freezes its target ranking inputs and
pending observations without spawning the source extension's background worker.
The pending value retains neither the source metrics client nor its trace parent.
Ordinary source turns continue to launch their existing worker. A target may
observe whether its frozen job is pending while the binding and policy remain
current; the observation does not launch work or grant publication.

All 180 skills library tests passed, including a counting selector that does not
run during preparation, the ordinary shadow ranking regression, pending-target
observation and witness invalidation. Three Core retained-step tests and nine
real private-channel compatibility cases passed. Shadow-enabled target behavior
is unit-tested, not exercised through live publication. Strict reconstruction
and reverse application passed for tree `97feb8d02e400f393df9a252dd68a007288cb080`, patch SHA-256 `861a6bc931bf97461ae9ccd28c2a87b6912f6ccd9f63d822572e10658827ecdc`
and app-server SHA-256 `7d9fbc35992bcdbff99bf364a65bfefc477cdfbb4888b21b982bc68efa2a22d3`.

The pending job and diagnostics are in memory and are not durable or sealed.
There is no owner-authorized post-handoff launch, destination metrics binding or
crash recovery. This is not an effect dispatcher or replay gate; a repeated
turn-input callback can perform provider discovery before detecting an existing
pending job. Provider execution and recovery, target environment authority,
live publication, physical MCP release, writer isolation, placement/recovery,
receiver handoff and full both-runtime Gate 2 acceptance remain open.

## Target skill turn binding and diagnostics — 2026-10-31

Detached skill turn-input and world-state callbacks now require the exact
retained destination turn object, not merely an equal turn ID. World-state
rendering uses captured destination model settings. Target catalog warnings and
render metrics are staged in a bounded in-memory diagnostic snapshot instead of
being emitted through the source sink; an overflow makes the step unavailable.
Turn-local warning and host-catalog markers are initialized before retained
attachment revisions are captured.

All 179 skills library tests passed, including same-ID different-turn refusal
before provider work, target model world-state rendering, staged catalog warnings
and metrics, unchanged target attachment revision and overflow refusal. The
first run exposed that standard metrics use 513 histogram boundaries, exceeding
the initial bound; the bound was corrected and the full suite passed. Three
Core retained-step tests and nine real private-channel compatibility cases
passed. Turn binding and diagnostic isolation are unit-tested, not exercised
through live publication. Strict reconstruction and reverse application passed
for tree `b51b53e19ab9715f2ebe27cda51a24bf84999356`, patch SHA-256 `471f5e77f2927b4f7a33d49c24d8051d5aefd8526b06a45bef80d2d9a52ee397` and app-server SHA-256 `7f0092945074f27c49dc837f82d7ceb6a91ed2b926ab17fe156e76ac0dfaa8ec`.

The diagnostic snapshot is in memory, non-consuming and not sealed: no durable,
exactly-once delivery or recovery exists. Shadow-selection effects, provider
execution and recovery, target environment authority, live publication and
complete destination authority remain unproven. Physical MCP release, writer
isolation, placement/recovery, receiver handoff and full both-runtime Gate 2
acceptance remain open.

## Target skill turn-input routing — 2026-10-31

Detached skill turn-input assembly now uses the destination's private skill
state, MCP handle and captured model usage and context window rather than the
source session's corresponding values. Explicit skill selection and reads
continue through the selected target provider. Policy and custom-provider
freshness are checked around provider work; custom providers require a witness
even when automatic skill instructions are disabled. Source-session skill
analytics are not emitted for the unpublished target.

All 178 skills library tests passed, including different source and destination
MCP handles, an explicit destination skill read, target model usage and stale or
missing custom-provider witnesses. An initial run had one new assertion fail
because it inspected truncated debug output; it passed after inspecting the full
fragment. Three Core retained-step tests and nine real private-channel
compatibility cases passed. The explicit skill-input content is unit-tested,
not executed end-to-end. Strict reconstruction and reverse application passed
for tree `f32574f1d81e2007b6b5caabadf09636a973f617`, patch SHA-256 `0ba4457360ec1e397cf6b5ad0075ab70abadf49a9eb28a32a3c92107f5b8068c` and app-server SHA-256 `c9fbe8571b6cda0358fe400fca8c9baec4aa6a5e6e47e3263cc35396ed79e443`.

These checks do not establish ownership or recovery of provider effects, target
turn/environment scope, deferred warning and telemetry delivery, skills
world-state side effects, live publication or complete destination authority.
Physical MCP release, writer isolation, placement/recovery, receiver handoff and
full both-runtime Gate 2 acceptance remain open.

## Closed destination prompt-contributor check — 2026-10-31

The trusted native host now classifies the four built-in prompt contributors
before detached step preparation. Each recognized prompt must also be the exact
same instance registered for tool preparation; missing, different and unknown
contributors are refused without invoking their prompt hooks. The read-only
preflight and native step entry both enforce the check. An empty prompt registry
is allowed; a nonempty registry without the classifier is refused.

Six native collector tests passed, covering the built-in types, unknown callback
traps, missing and different owners, exact matching and registry cloning. Six
extension-registry API tests and three retained-step Core tests passed. The
rebuilt app server passed eight of nine private-channel cases; the memory-drift
case timed out waiting for a provider operator preview before step preparation,
then passed alone on an unchanged rerun. The timeout's cause was not established.
Unknown contributor refusal is unit-tested, not injected into a live server.
Strict reconstruction and reverse application passed for tree `7102ce2517ec0acde21bb2cdd72c2b0e16a4bc7c`,
patch SHA-256 `e30c09efaaf33ea83b4daa446eb81b0b6baecb50c7d1fb3082b564240ec3c4c0` and app-server SHA-256 `8692304cb6f85285896c9632844995578eed67fd9f96450017cbcc0adb4b2505`.

This verifies concrete type and instance pairing only. It does not establish
freshness of contributor inputs, destination credential ownership, safe prompt
execution, physical MCP release or full destination authority. Skills world-state
side effects, writer isolation, placement/recovery, receiver handoff and full
both-runtime Gate 2 acceptance remain open.

## Target Git attribution policy — 2026-10-31

Detached Git attribution now reads the destination configuration's backend
endpoint under the existing step effect grant, using frozen session-wide cached
credentials rather than the source thread's policy cache. It rejects redirects,
request failures, unauthorized responses and stale auth observations. A retained
step rechecks the remote policy and cached auth; a failed preparation removes any
older snapshot. The ordinary source path retains its existing behavior.

Six attribution tests passed, including conflicting source and destination
policies in the rendered world-state section, policy drift, auth change during a
request and redirect refusal without credential forwarding. Five collector
tests passed. The rebuilt app server passed nine real private-channel cases,
including attribution drift, memory drift, enabled and disabled history,
API-key history, active board, retained-step cleanup and lost-reply recovery.
The differing endpoint prompt content is unit-tested, not exercised end-to-end.
Strict reconstruction and reverse application passed for tree `3b5a5046068fa0e32bc5a9a7f87850dc41a01e2b`,
patch SHA-256 `d83148241377fbaed8753476182f2eedf9310772823c8430901cdb7088fd3993` and app-server SHA-256 `eb5122c9a8af47f4b84494878376a85ccba889b43485b8c4b5de5b83cd48bd0f`.

Policy revalidation is point-in-time and cannot detect a remote change and
restore between reads. Cached credentials remain session-wide; this does not
prove destination credential ownership, mutable external auth or proxy state,
complete prompt authority or execution eligibility. Skills world-state rendering
also still needs review for source event-sink and turn-state effects. Physical
resource release, writer isolation, placement/recovery, receiver handoff and full
both-runtime Gate 2 acceptance remain open.

## Target skill thread-context snapshot — 2026-10-31

The skills thread-context hook no longer falls back to source thread policy for
a detached target. Preparation snapshots the fragment under the target skill
policy, model usage setting and MCP handle. Custom providers require a separate
host witness for their mutable external inputs, including change-and-restore;
missing or invalidated evidence refuses the snapshot. Standard non-custom
providers produce no thread-scoped entries for this query. The snapshot is not
proof of turn-level or world-state prompt authority, backend ownership or
execution eligibility.

All 178 skills library tests passed, including custom target content, missing
and invalidated provider witnesses and configuration change-and-restore. An
intermediate run failed an existing direct-detachment test; the preparation
behavior was preserved and the witness check placed at the retained prompt
boundary. Three Core retained-step tests passed. The rebuilt app-server passed
five retained-step, active-board, memory-drift and cleanup cases; custom prompt
content is unit-tested, not end-to-end. Strict reconstruction and reverse
application passed for tree `7e47284a535f1dc07d0c24ad4c3ece4208d1c465`, patch
SHA-256 `bd035cba36c7c6608be00fed698d046eb8de800d71965c36ce7737f646c98741`.
Complete prompt and destination authority, physical resource release, writer
isolation, placement/recovery, handoff and full acceptance remain open.

## Closed destination tool-contributor check — 2026-10-31

The immutable native host now classifies the eight supported concrete tool
contributors before detached step preparation. Unknown contributors are
refused before their callbacks are invoked; the read-only host preflight can
refuse before a step intent, and native preparation independently enforces the
same check. An empty registry is allowed, while a nonempty host without the
classifier is refused. Recognition establishes contributor type only: it does
not certify mutable state, external resources, context contributors or execution.

Four native collector tests passed, including all eight known types, an unknown
contributor whose callbacks panic if called, and registry cloning. Three Core
retained-step tests passed with a preflight assertion. The rebuilt app-server
passed five standard, active-board, memory-drift and cleanup cases; an unknown
contributor is tested in the native collector, not end-to-end. Strict patch
reconstruction and reverse application passed for tree
`72163d2310b87b0c4ca241ce15f50d595e905a5e`, SHA-256
`a7203471b1135f0eaf4c3c75d2e58ee0a3446d806f01ebd0a1761f64d0530ec7`.
Unsupported contributors, complete authority, physical resource release,
writer isolation, placement/recovery, handoff and full acceptance remain open.

## Message-board startup witness — 2026-10-31

The message-board backend and namespace are thread-startup bindings; ordinary
configuration changes do not replace them. Detached preparation now requires
successful board initialization and witnesses the retained startup binding,
using the existing attachment-map revisions to detect replacement. A failed
or incomplete startup refuses the detached observation. The witness does not
certify external board availability, mutable backend state or resource release.

Two board tests passed for active binding, preserved startup namespace, failed
or incomplete startup and reinitialization. Four native collector tests passed.
The rebuilt app-server passed a real retained-step case with an active in-memory
board and four retained-step and cleanup cases on unchanged rerun. An earlier
cleanup run failed while the collector was compiling concurrently; its cause
was not established. Strict reconstruction and reverse application passed for
tree `ae397bf21a76e656a2f1f43db1bc258d85d58d96`, patch SHA-256
`0d07e50b33f16a2be4f9cddd1fe5f156d74e267625521dc702dd5b2140f1a082`.
Full destination authority, physical resource release, writer isolation,
placement/recovery, receiver handoff and full acceptance remain open.

## Target goal tool projection — 2026-10-31

Detached goal tools now use destination enablement and token-budget policy
while retaining the conversation's existing accounting state and thread-level
visibility restrictions. Source runtime state is not changed. An explicit
host witness covers mutable external inputs to the configuration callback;
missing or invalidated witnesses refuse the detached step. The app-server's
callback reads only its retained Config. This is an unpublished router
projection, not execution authority or a live goal-runtime handoff.

All 30 goal backend tests passed, including different source/destination
policies in both directions, target budget enforcement, source visibility
changes, and missing or invalidated host witnesses. The rebuilt app-server
passed seven retained-step, history and cleanup cases; those fixtures do not
exercise different goal policies end-to-end. Strict reconstruction and reverse
application passed for tree `a1dbd7d8d9abae7e2a2a23c7405e56084dbb4236`, patch
SHA-256 `52631a31ae02e1da7c146391b183804ac1800fb8b88c610b4f8a60433db143db`.
Complete contributor authority, physical resource release, writer isolation,
placement/recovery, receiver handoff and full acceptance remain open.

## Container process-containment probe — 2026-10-31

The local Docker daemon reports Linux and cgroup v2. An opt-in test uses the
existing `alpine:3.21` image without pulling, with networking disabled, a
read-only filesystem and all capabilities dropped. A child creates a separate
process group and closes its standard streams; a separate container in the
Docker VM's PID namespace observes that child before removal and verifies its
PID is absent afterward. The test passed, and no labeled probe container
remained. This is evidence for one local container lifecycle, not an MCP
cleanup receipt or independent broker verifier. Docker runs Linux programs in
a VM on this macOS host, so ordinary macOS MCP executables cannot simply be
moved into this environment. Daemon loss, process creation outside the
container, remote effects, recovery and actual MCP compatibility remain open.

## Early destination history refusal — 2026-10-31

An owner-bound, read-only preflight now checks the target configuration and
cached authentication before the host writes a step-dispatch intent. A known
enabled history backend is refused at this point, allowing the existing host
recovery path to settle unused-provider cleanup and observe MCP quiescence.
The broker MCP hold and admission fence remain: quiescence is not physical
release. An API-key configuration with the history flag set is not rejected
solely for that flag. The check is an early refusal only; it is not readiness
or execution authority, and later drift may still produce an uncertain step.
Lost or malformed preflight replies close the private owner and keep the fence.

The rebuilt app server passed seven real private-channel cases, including
enabled-history refusal with no step intent, provider cleanup and observed MCP
quiescence; disabled-history and API-key controls; memory drift; and retained
step disposal and lost-reply recovery. Host control and preparation suites
passed 134 cases. Strict reconstruction and reverse application passed for
tree `7e535251464ef775f412d97bdfa0fadffd04765f`, patch SHA-256
`7058cb12f63cb8d9bc73f3f07c3ddd7a0b8f03b70e67266f5ea4f48b2224bb75`.
Enabled history, used-provider recovery, physical release and the other Gate 2
acceptance requirements remain open.

## Destination history and notes boundary — 2026-10-31

The retained target step now observes destination history settings and cached
authentication without borrowing the live source backend. When history is
disabled at the destination, target tools and prompt fragments are empty even
if the source has history enabled. When destination history is enabled, the
step is refused: a usable target backend and its thread-hint request still need
owned provider use and recovery before execution can be authorized. The step
grant discloses network and credential effects, but the current provider marks
a live handle exposed to consumers and cannot prove unpublished cleanup after
that exposure. This change does not implement the enabled case.

All nine history/notes library tests passed, including the different source and
destination settings and enabled-target refusal. The rebuilt app server passed
four real retained-step, memory-drift and cleanup cases. Two additional real
cases use the same OpenAI-named provider and fixture ChatGPT credentials with
history enabled and disabled: the source's enabled hint is observed, then the
enabled destination is refused without another hint request, retaining an
uncertain step and the admission fence; the disabled destination retains a
step. The first run had a live Apps connector that prevented acquisition, and
the isolated fixture now disables it. Strict forward reconstruction and reverse
application passed for tree `2fbb7db474c14c1c48d4c01b845ec5f740c57511`,
patch SHA-256 `fce7cc2df09788d2c5fe111fed44daf72bfbc5055b76241b556d7c50daff11a7`.
Complete contributor authority, physical resource release, writer isolation,
placement/recovery, receiver handoff and full two-runtime acceptance remain open.

Earlier recovery boundary: the host persisted its dispatching step before invoking the
native operation. Native code subsequently records `pending` before running
contributor preparation; a failed contributor currently marks the owner and
step uncertain. The host cannot interpret a generic error or a missing reply as
proof that preparation had no effects, and both native and host cleanup paths
require an observed disposal before releasing a step owner. Supporting safe
early refusal therefore requires a durable, owner- and operation-bound native
receipt recorded before contributor effects, a matching host-journal terminal
state, and lost-reply observation before either resource can be cleaned up.
The matched enabled-history fixture demonstrates the present quarantine; it
does not prove such a receipt or recovery path exists.

## Target memory snapshot revalidation — 2026-10-31

The retained step now revalidates the bounded memory summary outside session
locks under the existing step grant's disclosed filesystem scope. It compares
the captured bytes and file identity after verifying stable metadata during
each read, and brackets the read with retained attachment checks. Changes,
same-content replacement and creation of a previously missing summary make
the step unavailable. Disabled memory needs no file read. The check is
point-in-time: it does not lock the file or prove parent-path containment, and
the Windows identity path was not compiled or tested on this host.

All 21 memories tests and three Core retained-step tests passed. The rebuilt
app-server passed four real retained-step cases, including a changed-memory
case that confirms the broader destination candidate still validates before
the retained step is refused. An intermediate run expected only one refusal
code; the test now accepts unavailable or uncertain while requiring the same
owner, callback and fence conditions. Strict patch reconstruction and reverse
application passed for tree `77dcd5fdd388a5d0ad02f2ee600b4ccfa857a600`,
SHA-256 `27432a539db4aa5dfa8cb6816bad8f2a506ee6a3cf633df89941c2fcf7975ff9`.
Other contributor freshness, physical MCP release, execution authority,
writer isolation, handoff and Gate 2 acceptance remain open.

## Target memory prompt snapshot — 2026-10-31

During the separately authorized target-step preparation, the memories
contributor now captures a bounded prompt snapshot from a regular UTF-8
summary file, rather than rereading it when the step-aware prompt is assembled.
The capture refuses files over 1 MiB, non-regular files, and final-component
symlinks on the tested Unix host. Missing summaries and disabled memory yield
an empty snapshot; unreadable or invalid files refuse target preparation.
The ordinary source-thread reader retains its prior behavior. The snapshot is
immutable, but later changes to the file are not yet observed or rejected, and
the snapshot does not establish complete prompt authority or path containment.

All 21 memories tests passed, including changed-after-capture, oversized,
non-regular and symlink cases. The rebuilt app-server passed three real
retained-step/disposal integration cases; those do not exercise memory snapshot
content end-to-end. Strict patch reconstruction and reverse application passed
for tree `1988cbe2a3050bf1fa865d9053a8822bc3a15e06`, SHA-256
`0b5353fd546f2f23011935e1999d244cb6d41cc0f3ef43cc420cc39175c8b7c3`.
Physical MCP release, complete destination authority, writer isolation,
handoff and Gate 2 acceptance remain open.

## Target memory prompt context — 2026-10-31

Prompt assembly now offers contributors the current step's extension state,
while the default preserves existing thread-scoped behavior. The memories
contributor uses the prepared target home and preserved conversation memory
version when that target state is present, checking the target and source
attachment identities around the read. A native test uses distinct source and
target summary files and verifies that the target fragment contains the target
content. If the prepared state is unavailable or stale, this hook returns no
fragment; the unpublished step is not authorized for execution by that result.

All 20 memories tests, 12 Core initial-context tests, three Core retained-step
tests and three real app-server retained-step/disposal cases passed. Different
source and target memory summaries are covered by the native contributor
test, not end-to-end. The summary is still read during prompt assembly; its
file content is not a retained, revalidated snapshot, and complete prompt
authority is not established. Strict patch reconstruction and reverse
application passed for tree `a884fb6f9587e469f24aae9c61a015dab3f7aecb`,
SHA-256 `fbe5892ec52c2fee5e9e57542c7ed43dd14d2a420e12b30a2292b85aff90f2e4`.
Full contributor freshness, physical MCP release, execution authority, writer
isolation, handoff and Gate 2 acceptance remain open.

## Target memory tool projection — 2026-10-31

Detached memory tools now use the destination's enablement, dedicated-tool
policy and home while preserving the conversation's existing memory version,
matching ordinary configuration-update behavior. Core rechecks the target
context and the source configuration attachment through its existing revision
checks. Missing target or source state refuses preparation. Ordinary source
tools remain unchanged. The separate memory prompt-context contribution still
reads source thread state and has not been projected or verified for a target
with different memory settings or home; this router is not execution authority.

All 19 memories library tests and three real retained-step/disposal integration
cases passed after rebuilding the app-server. Differing memory settings and
namespace preservation are unit-tested, not exercised end-to-end. Strict patch
reconstruction and reverse application passed for tree
`fcb1c8975b5cd6de86deef36900d38e2039e807d`, patch SHA-256
`3d9d3884c73a940073b52193aee2f4e36bdae177290c53e570915d0394afe7d4`.
Full contributor freshness, physical MCP release, execution authority, writer
isolation, handoff and Gate 2 acceptance remain open.

## Target image-generation tool projection — 2026-10-31

Detached image preparation now uses the target Config, projected save root and
the inert target-provider view instead of retaining the source authentication
manager and configuration. A host-provided witness covers mutable external
inputs to the save-root resolver; without one, the detached step is refused.
Core rechecks supported contributor-specific target witnesses before and after
router assembly and during observation. A missing witness from an unrelated
contributor is not treated as proof of that contributor's freshness.

All 16 image library tests, three Core retained-step tests and three real
app-server retained-step/disposal tests passed. The target save root, provider
identity and witness failures are covered by a native unit test; the native
integration fixture does not exercise an enabled destination image request.
Strict patch reconstruction and reverse application passed for tree
`355048410c135f867e145690db318502757b3b06`, patch SHA-256
`d57db2b971343123b976466a6f85b59b98e6f50f6d1057baa0185e79a553a716`.
Full contributor freshness and binding, physical MCP release, execution
authority, writer isolation, handoff and Gate 2 acceptance remain open.

## Target web-search tool projection — 2026-10-31

The detached router previously built web search from the live source thread's
configuration and authentication manager, even when the destination had
different settings. It now uses the destination Config and the retained inert
target-provider view. Core retains and rechecks the exact target context; the
provider view cannot authorize real requests or publish the router. Ordinary
source-thread tools still use their existing path. Image generation and other
contributors remain to be checked for equivalent destination binding.

The web-search suite passed 10 tests, including different source/target policy
and exact provider identity. Three Core retained-step tests passed; the rebuilt
app-server passed three native retained-step/disposal cases. Those integration
cases do not exercise differing web policy. Strict patch reconstruction and
reverse application passed for tree `27b80a548e83e98f967a830b5447dcf4085cc81c`,
patch SHA-256 `10eb17296448216640eca7c53aebf8fdbd58edf3eafed201c75ca2d1b5321a43`.
Physical MCP release, execution authority, full contributor binding, writer
isolation, handoff and Gate 2 acceptance remain open.

## Host skill-projection freshness witness — 2026-10-31

Detached skill projection now requires an explicit host-supplied, side-effect
free witness for all mutable external inputs to the projection callback. It
is captured before projection, checked afterward and checked during retained
step validation. The standard app-server projection reads its retained Config
and captures no mutable external host state; custom hosts without a witness are
refused. This is a trusted host contract: a custom witness must detect every
relevant change, including change and restore. Target Config and other
contributors still need their separate freshness evidence.

All 177 skills tests and three Core retained-step tests passed. Strict patch
reconstruction and reverse application passed for tree
`398eb7b1a6ccfb84956bd7306c349dee0338800f`, SHA-256
`596936ce72d772cf4e5f0f7384a7c8fd6a06d861e07349a3e119e78a1ea39585`.
The app-server rebuilt, and three real private-channel retained-step, disposal
and lost-reply cases passed. Gate 2 remains open.

## Detached target skill policy witness — 2026-10-31

The retained destination step now captures the exact detached skill state and
its complete projected configuration, then checks the prepared configuration
and a non-reusable generation after contributor preparation, router assembly,
and later observation. This catches changes that leave tool shapes unchanged,
including a change followed by restoration. The witness fails closed on lock
contention and detached-state replacement. It does not witness mutable external
inputs to the host projection callback or prove complete contributor freshness.

The targeted skills regression and three Core retained-step tests passed. The
app-server rebuilt, and three real private-channel retained-step, disposal and
lost-reply cases passed. Strict-whitespace patch reconstruction and reverse
application passed for tree `e4015e063aaf25136379338b4fa408d40ba4b06e`, patch
SHA-256 `bc8527d1d1defb470095ad1134104b106ab1afecda66d49b9b4ef724f49653ae`.
Physical MCP release, full destination authority, writer isolation, handoff
and Gate 2 acceptance remain open.

## Resumed native verification — 2026-10-31

After disk space was freed, the current native checkout passed
`cargo check --offline --locked -p codex-app-server`. The extension API, goal
and skills library suites passed 2, 3 and 176 tests respectively, including the
new destination projection and cache regressions. The Core continuity suite
passed 78 tests with one ignored after a rerun with loopback access; its first
run had 77 passes and one mock-server failure because the sandbox denied the
local bind. A fresh app-server binary built successfully from the same
checkout (SHA-256 `b9a59131b1fa5d00bbc18a5c4b4bddac1771a1ecf7639d230150811872f2ad33`).
The private-channel integration suite passed 72 tests with local loopback
access. Its first run passed 71 and failed one lost-step-disposal case because
the one-second fault-injection timeout also made subsequent MCP shutdown
uncertain. That test now observes the exact shutdown without replay and passed
both individually and in the full rerun.
The full CLI was also built from this checkout. Its two isolated continuity
cases passed on rerun: same-version active-writer exclusion and release after
owner process exit, plus destination instruction observation. The first
attempt with the freshly linked CLI timed out in `--version`; the first attempt
using the app-server binary was invalid because this suite requires the CLI.
These cases explicitly do not establish the production owner contract or
Desktop isolation.
The earlier checksum-protected build and test archive directories are no longer
present. The source checkout and exported patch still match by reverse check.

These results do not establish complete contributor freshness, physical MCP
release, writer isolation, destination handoff or full Gate 2 acceptance.

## Ambiguous native request correlation — 2026-10-31

Two simultaneous client requests could previously reuse an ID, replacing the
tracked mutation with a read. A read response could then remove the pending
record and falsely permit admission. Overlapping request IDs now mark native
activity unknown and invalidate any active admission owner while requests
continue through the proxy. The unknown state remains conservative until the
process is restarted. Two regressions reproduced the unsafe behavior and now
pass. Fence, preparation, private-proxy and task tests passed 93 cases with one
opt-in native case skipped; the loopback task tests required access outside the
sandbox. This does not prove physical cleanup, global writer exclusion or Gate
2 acceptance.

## Cross-thread interruption during admission — 2026-10-31

The process-wide admission fence previously forwarded an interrupt for another
thread without invalidating the held owner; it could drain queued work with
that interrupt pending or after its response. Human interrupts still pass
immediately, but any such interrupt now invalidates the owner because a reply
alone does not prove process-wide quiescence. Successful release also refuses
any pending mutation, including one without the owner token. Both response
order cases reproduced the previous behavior and now pass. The fence,
preparation and private-proxy suites passed 64 tests with one opt-in native
test skipped. This does not establish native server-wide writer isolation or
physical MCP cleanup; Gate 2 remains open.

## Admission fence release check — 2026-10-31

An unsuccessful final activity check could previously throw and then drain
queued editor work when the owner had sent no mutation. The final check also
omitted the adapter-flushing condition. The fence now quarantines on failed or
unavailable release checks, requires flushing to be false, and checks fresh
activity before draining after a callback failure. Regression cases reproduced
the previous behavior for unknown, busy, blocked, flushing and unavailable
activity; they now pass. The fence, preparation and private-proxy suites passed
61 tests with one opt-in native test skipped. This is single-process exclusion,
not proof of complete competing-writer isolation or native Gate 2 acceptance.

## Cancelled MCP cleanup verification — 2026-10-31

A new gateway regression cancels an in-flight cleanup verification, then
returns an otherwise matching proof. The proof is refused, and the exact MCP
resource hold and task-release refusal survive a store restart. The MCP
establishment suite passed 22 tests; the loopback broker integration suite
passed 17 tests after running with local socket access outside the sandbox.
The first combined run could not bind its loopback listener in the sandbox.

This checks cancellation safety with a synthetic verifier. It does not provide
the independent physical-process verifier or close Gate 2.

## Current host coordination verification — 2026-10-31

The current native patch still passes a reverse-application check against the
native checkout. With Node 24.21.0 selected on the command-local PATH, the five
host preparation, resource dispatch, journal, MCP establishment and provider
establishment test files passed 140 tests with no skips or failures. The initial
attempt used the shell's Node 22.5.1 and failed because it lacks `node:sqlite`;
that attempt is not a product failure or a passing verification result.

These tests exercise host coordination and simulated boundaries, not the
current native implementation or physical process cleanup. The volume has
about 550 MiB available, so the current native patch remains unbuilt and its
native integration tests remain unrun. The prior checksum-protected build
artifacts were retained. Destination authority, writer isolation, physical MCP
release, handoff and full Gate 2 acceptance remain open.

## Target skill-policy projection — 2026-10-31

After the step intent is journaled, the detached step now asks the registered
skill contributor to project the actual destination configuration. It computes
cloud availability from that contributor's providers and the destination
environment set, installs a new detached state with the target MCP client, and
compares prepared target skill-tool shapes with the projected policy. The
retained step rechecks those shapes. The original source-policy observation
remains a separate source-freshness check. A native test was added with
different source and destination settings and local/nonlocal environment
cases, including a check that the projection callback is not used by the
earlier source-detachment helper.

The callback is host supplied; its mutable external inputs are not yet covered
by a freshness witness, and complete contributor and destination authority are
not established. The new code and tests, including end-to-end native step
construction, have not been compiled or run because of disk space. The exported
patch reconstructs tree `d005b0ca042ac28742f8b4084cbc1280e224ee69`, SHA-256
`ae4e02b5b432e3d44833ca936056d24e7e770325897b0bfea723abd5e61c7a56`;
strict-whitespace reconstruction and reverse application passed. Physical MCP
release, handoff and Gate 2 acceptance remain open.

## Target skill-policy projection gap — 2026-10-31

Before the later projection change above, detached skill state copied the source thread's applied
`SkillsExtensionConfig` and source `cloud_skills_available` value. The app
server normally projects skill instruction, budget, bundled-skill, cloud and
shadow-selection settings from its effective `Config`, and initializes cloud
availability from the selected environments. The retained target turn has a
separate destination `Config` and environment snapshot, but the detached
skill path does not project those target values. The `skill_tool_shapes`
observation also uses the source policy. Therefore the target MCP client and
fresh cache work recorded below do not establish the destination's effective
skill policy when source and destination differ.

The host-supplied configuration projection is an arbitrary callback; invoking
it as a supposedly effect-free read or duplicating the standard app-server
projection in Core would not cover custom host behavior. The target needs an
explicit owner-bound projection under the disclosed effect boundary, matching
target environment availability and revalidation, followed by a native test
where source and destination settings differ. This remains implementation work;
the current unbuilt step is not destination execution authority.

## Fresh target skill discovery caches — 2026-10-31

Detached skill state no longer copies any source executor discovery cache.
An empty V2 discovery snapshot can compare equal across different contexts,
so retaining the source cache could otherwise skip target discovery. The
detached state starts with fresh executor and cloud caches while preserving
the independently copied alias assignments; the live source caches are not
modified. A native regression covers all three executor cache kinds.

The new regression and current native build have not run because of disk
space. The exported patch reconstructs tree
`402054db33151e2bf23bcbdb30221ff471336bdc`, SHA-256
`4333d652daf86bef3d7b22268dcf4685ba589e6852c9fb62d49d4ca0ec5f8ccd`;
strict-whitespace reconstruction and reverse application passed. This does
not prove complete destination freshness, physical MCP cleanup, handoff or
Gate 2 acceptance.

## Retrying partial executor discovery — 2026-10-31

Executor skill catalog caches now refuse to reuse a partial result in all three
discovery paths. A later discovery can therefore recover after a provider
failure, while complete results with valid ownership can remain cacheable. The
native regression covers failure and recovery in all three paths, reuse of
complete V1/V2 results, and refusal to reuse a matching partial roots-only
entry. An unbound roots-only request correctly does not reuse even a complete
result; an earlier version of the test incorrectly expected it to. The current
native tests and build remain unrun because disk space is insufficient.

The exported patch reconstructs tree
`29f3536296db2f662906d3805f6e9d22a6ad60e1`, SHA-256
`4620d9ed93f260eb1a8cc02d59b049952dd9c3146caeab0edddc2583a06e3fc4`;
strict-whitespace reconstruction and reverse application passed. This does not
establish destination authority, physical MCP cleanup, handoff or Gate 2
acceptance.

## Distinguishing partial skill catalogs — 2026-10-31

Provider aggregation now marks a catalog partial when a provider returns an
error, instead of recording only a warning. Detached preparation can therefore
reject partial cloud, executor and host catalogs while accepting warning-only
diagnostics. The corrected partial status also applies to ordinary aggregated
provider failures, so this is an observable change beyond the detached path.
Native regressions were added for failure versus diagnostic warnings, and the
detached target tests were updated to cover both.

These native changes and tests have not been compiled or run because the volume
is space-constrained. The exported patch reconstructs tree
`addc812f9212c2975ee3fe6bd26ce10dce2cff0a`, SHA-256
`6335edfd5eeadfd338f8e810bd6a18f5c8a6debbb884479ec755fe52c8d9bb0f`;
strict-whitespace reconstruction and reverse application passed. Complete
destination authority, physical MCP cleanup, handoff and acceptance remain
open.

## Detached skill catalog completeness — 2026-10-31

The detached skill path now refuses partial or warning-bearing cloud, executor
and host catalogs before marking the step ready. Executor aggregation can
convert provider errors to warnings without setting `is_partial`, so accepting
that result could silently omit destination skills. This is deliberately
conservative: benign warnings also prevent the detached step and need finer
classification before full parity can be claimed. Ordinary skill preparation
keeps its existing behavior. Native regressions were extended for partial and
warning-bearing cloud results and an executor-provider failure.

The new native code and regressions have not been compiled or run because of
disk space. The exported patch reconstructs tree
`7c9e15fbb923c83697505fb8671720ca188ec733`, SHA-256
`0d5eb36c5f084a3242085328f8450258dd54ef117a3a6683b730211eeeca753c`;
strict-whitespace reconstruction and reverse application passed. Complete
destination authority, physical MCP release and Gate 2 acceptance remain open.

## Target MCP resources for detached skills — 2026-10-31

Detached skill preparation and executors now select an MCP resource client
created from the retained target runtime, instead of the source session's
client. Core retains and rechecks that exact runtime alongside the target MCP
binding. The detached state discards its copied source cloud generation and,
when cloud skills are enabled, refreshes against the target before marking
the skill step ready. A failed or unavailable refresh leaves the step unready;
Core refuses router construction. Ordinary skill steps retain their original
resource selection. Native tests were added for target/source client identity,
cloud discovery through the target and refusal on refresh failure.

The native skills tests, Core and app-server have not been compiled or run;
the volume is still space-constrained. The target runtime binding is not proof
of physical MCP cleanup, external skill-file freshness, complete contributor
authority, placement or receiver handoff. The exported patch reconstructs tree
`f383d3763267b2506630fe3b889767c0f7e27f7f`, SHA-256
`3e702693aa1c60b36247392ce78f45bc7901c8123cb2d318da18c9d558070842`;
strict-whitespace reconstruction and reverse application passed. Gate 2
remains open.

## Detached skill executor binding — 2026-10-31

The retained destination skill executors previously captured the live source
`SkillsThreadState` even though contributor preparation used a detached copy.
Those executors can later consult and mutate the thread's skill read cache and
aliases. They now retain the same detached state as destination preparation;
ordinary steps still use their source state. A native regression checks exact
state identity for both paths and keeps the existing metadata-parity check.

The skills crate and the new regression have not been compiled or run because
of disk space. This change does not establish target MCP resource binding,
external skill-file freshness, other contributor isolation or permission to
publish the router. The exported increment reconstructs tree
`2f34b570c332655b0fd6ded6172d26d782b0909e`, SHA-256
`a929293a6ae8ca0d9908980adf5a7da61e96d8c893012cfc8d7ac49cda7fb4ee`;
strict-whitespace forward reconstruction and reverse application passed.
Full physical MCP release, handoff and Gate 2 acceptance remain open.

## Retained target attachment revisions — 2026-10-31

The native detached step now also witnesses its private turn and step
attachment maps. It captures their revisions after contributor preparation has
populated them, checks them around router construction and rechecks them during
retention and observation. Native Core regressions were added for a change and
restore of each target map. The standalone attachment and goal visibility
primitive tests passed (five cases); these do not run the new Core regressions.

The current native app-server and integration tests remain unbuilt because the
volume is space-constrained. These revisions do not detect mutation within an
attached object, external backends, all contributor state or changes after the
last check, and they do not authorize publication. The exported increment
reconstructs tree `72a8aedf8a5fe571b153bd5bf241da05e168b396`, SHA-256
`2944784b5aa31995d75f5e87ff18fc3e22298087d7105989b82e9ec1ee82f77e`;
strict-whitespace reconstruction and reverse application passed. Physical MCP
release, destination handoff, full authority and gate acceptance remain open.

## Launchd coalition count probe — 2026-10-31

The opt-in, self-cleaning `test/fixtures/codex-launchd-coalition-probe.py`
compiled and ran the temporary launchd worker outside the sandbox on macOS
26.6.2. The private coalition list reported two tasks before job removal and
one after removal, while the detached child was alive. After the child was
terminated, the coalition was absent from the returned list; both fixture
processes were no longer visible. The probe checks fixture executable paths
before sending signals. Its caller-buffer saturation check does not detect the
kernel's separate internal truncation race described above.

This gives a concrete candidate for distinguishing an alive orphan in this
controlled setup. The API is private, and absence from this listing has not
been established as durable proof of an empty, sealed coalition. Authorization,
complete enumeration, job/coalition identity binding across crashes and ID
reuse, other process-creation paths, remote work, and an independent broker
verifier are unimplemented. No cleanup receipt or Gate 2 release follows from
this experiment.

## Temporary launchd ownership-boundary probe — 2026-10-31

A uniquely labeled, temporary per-user launchd job ran
`test/fixtures/codex-launchd-worker.c` on macOS 26.6.2 outside the sandbox. The
controller, worker and detached child had nonzero resource coalition IDs. The
worker's ID differed from the controller's, while the detached child's matched
the worker's. After removing the job, the worker was gone and the detached
child was still alive in that coalition. The probe removed its exact job and
sent SIGKILL only to processes whose executable path matched the fixture;
a subsequent process scan found no visible fixture processes.

This differs from the XPC case below and identifies a candidate boundary for
further investigation, not a production solution. The observation used the
private coalition query and one launch setup; isolation against other ways of
creating work, complete and authorized membership enumeration, PID reuse,
remote work, crash recovery, job removal and independent broker verification
are not established. `launchctl submit` was used for this temporary test and
is not proposed as a supported production integration. A held MCP owner must
not be released merely because the job was removed or a scan found no visible
processes. Complete Gate 2 acceptance remains open.

## XPC resource-coalition probe — 2026-10-31

The same temporary XPC fixture was extended to query only its own client,
service and child using the private `proc_pidinfo` coalition flavor. On this
macOS 26.6.2 host all three had the same nonzero resource coalition; after the
client and service exited, the detached child remained alive in that same
coalition. The fixture processes were identified by exact executable path,
terminated and subsequently confirmed absent. This observation is limited to
that launch arrangement and uses a private interface; it does not prove all
coalition behavior or safe ownership of other processes. It does show that
using that shared coalition as the MCP cleanup boundary could include the
client itself, so it is not a separately owned process group in this fixture.
[XNU's coalition implementation](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/coalition.c)
describes separate privileged management of coalitions; no such privilege,
production verifier or physical-release proof has been established here.

## XPC detached-child probe — 2026-10-31

An ad-hoc signed temporary app and embedded XPC service were built from the
fixture in `test/fixtures/codex-xpc-process-probe`. The service forked a
30-second child that called `setsid` and closed standard streams, then returned
both process IDs to the client. Four seconds after the client exited, the
service was no longer present but the exact detached child was still running.
The first sandboxed attempt was refused by the XPC lookup sandbox; the probe
was rerun outside it. Cleanup targeted only the fixture binary's verified
process path: SIGTERM did not stop the child, so SIGKILL was sent; subsequent
`proc_pidpath` checks showed both fixture processes absent.

This is a local macOS 26.6.2 result for one ad-hoc XPC setup, not a survey of
all XPC configurations. It establishes that automatic termination of this
service is insufficient evidence that its detached MCP-like child exited.
The broker's physical-release hold therefore cannot be cleared from a service
exit alone. Complete descendant ownership, crash recovery, external work and
Gate 2 acceptance remain open.

## Endpoint Security descendant-client availability — 2026-10-31

Apple documents an [Endpoint Security descendant client](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client%28_%3A_%3A%29)
that can observe the caller's descendant subtree, including later forks and
execs. The installed macOS 27 SDK marks this API available beginning with macOS
27; this host runs macOS 26.6.2. The reproducible read-only availability probe
`test/fixtures/codex-endpoint-descendants-probe.c` loads the system
`libEndpointSecurity` and finds no `es_new_descendants_client` symbol. It does
not create an Endpoint Security client or inspect other processes. An initial
probe used an incorrect framework path; the successful result above uses the
SDK's actual dylib path.

Apple requires an [Apple-granted Endpoint Security entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.endpoint-security.client)
for this API; the staged app-server is ad-hoc signed and has no embedded
entitlements. Event-loss detection, process cleanup, supervisor failure and
restart reconciliation would still require a concrete design and acceptance
tests. This newer API cannot currently establish the required cleanup proof on
the user's host, and no entitlement, production client or gate release is
claimed. The physical MCP hold remains in place.

## macOS descendant-tracking probe — 2026-10-31

The current macOS kernel refuses a new `EVFILT_PROC` registration that requests
`NOTE_TRACK`, returning `ENOTSUP` (45), while an ordinary `NOTE_EXIT`
registration for the same probe process succeeds. The reproducible fixture is
`test/fixtures/codex-kqueue-track.c`; it watches only itself and does not
create, signal or inspect other processes. The first probe mistakenly modified
an existing filter and returned success; using a fresh kqueue for the tracking
registration produced the supported conclusion. The local SDK also says the
tracking flags are unsupported, and [Apple's XNU implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c)
rejects those flags during a new attachment. A kqueue descendant tracker alone
therefore cannot supply the missing complete process ownership and orphan
release proof on this platform. The existing broker hold remains required.
Other containment or ownership approaches and real acceptance remain open.

## Goal witness regression coverage — 2026-10-31

The standalone visibility suite now also exercises 8,000 concurrent updates
and verifies that no revision is lost; all three tests passed. A goal-crate
integration regression was added to obtain the witness from the installed
contributor, update its runtime through the configuration callback and check
that the original witness refuses the equal-looking update. That regression
has not been compiled or run: the native build remains space-constrained.
The native patch reconstructs tree `79b148360bd45a4c02f9289b2fa17dbe931c323c`,
SHA-256 `695fbff7476c4460222d4f96eb8b81c3f1fc1be17078195a63ee34940cb37ad3`;
strict-whitespace forward reconstruction and reverse application passed.
This does not establish physical MCP cleanup, complete contributor freshness
or Gate 2 acceptance.

## Goal visibility witness — 2026-10-31

The goal runtime now gives each visibility update a monotonic token, preserving
ordinary enabled/disabled behavior while detecting a change followed by a
restore. Its tool contributor supplies a witness that the detached-step owner
captures before contributor preparation and checks after assembly, at retention
and during observation. Attachment-map revisions also cover replacing the goal
runtime attachment. An optional witness is not a claim that other contributors
are fresh: unsupported contributors and external state remain unresolved.

The two standalone native visibility tests passed, including saturation and
change-and-restore. The goal crate, native Core integration and current
app-server have not been compiled or run with this change because the volume
has insufficient free space. No production execution or movement authority is
enabled. The exported increment reconstructs tree
`67a159ad47d2b8bbd229fb1aca98fed3ddd9d2a8`, SHA-256
`f582dcf17cf232df4982c521cdf447dadda287d869bc52aec8c813da0afecb3a`;
strict-whitespace temporary-index reconstruction and reverse application to
the native worktree passed. Physical MCP/orphan release, full destination
authority, handoff, writer isolation and full gate acceptance remain open.

## Attachment-map revision witness — 2026-10-31

Native `ExtensionData` now advances a monotonic revision on each successful map
mutation, including replacement with an equal-looking value. A contended,
poisoned or saturated map refuses native revision observation. Detached target
step assembly captures the session and thread revisions before contributor and
router construction and checks them afterward; retention and later native step
observation check those revisions again. A Core regression was added for
change-and-restore in each source scope. The standalone `ExtensionData` test
module was compiled directly with `rustc` and both tests passed, including
unchanged reads, replacement, removal, contention, poisoning and saturation.

The new Core regression and current native executable have not been compiled or
run because disk space is insufficient. Map revisions do not track mutations
inside attached `Arc` values, external backend changes or changes after the
last check; they do not supply isolation, destination binding or publication
authority. Complete contributor freshness, physical MCP cleanup, commit and
handoff remain open. The exported native increment reconstructs tree
`27620cf4b876f56b8a46bb130ef75c4dada60c5b` and has SHA-256
`a6811cf744f5960da07d2fd3cd3f6e54366170d394249313273f57086a6c5ed3`;
temporary-index forward reconstruction with strict whitespace and reverse
application against the current worktree passed.

The host private-control regression now also verifies the cleanup path after a
native step revalidation refusal: the retained step is not prepared again,
and its exact disposal requires fresh paired-owner broker checks. The host and
coordinator suites passed 131 tests using a simulated native stream. This does
not run the new native Core check. One concrete remaining interior mutation is
the goal runtime's `enabled` atomic: `set_enabled` changes tool visibility
without replacing its thread attachment, so the attachment-map revision cannot
detect it. It needs a contributor-specific freshness witness or equivalent
protected ownership before the router can be considered current.

## Destination executor ownership audit — 2026-10-31

The detached router uses private MCP, definition and search caches, but its
`extension_tool_executors` still passes the live session and thread stores to
`tools_for_step`. This is not limited to preparation callbacks: the message
board contributor reads its live `Binding` and clones the board handle into
its executors; the goal contributor reads the live goal runtime and binds its
accounting state and state databases; history/notes reads the live thread
configuration and clones its backend into its executors. Core tool assembly
also reads `WaitForEnvironmentToolConfig` directly from the live thread store.

These are concrete retained bindings, not evidence that every such binding is
wrong to share: session continuity may require some of them. Before publication,
each needs an explicit destination binding or a justified shared owner, an
identity and freshness check that covers replacement and mutation, and recovery
behavior for an owner change. Arbitrarily cloning the attachment map would
still share interior-mutable `Arc` values and would not provide isolation. The
native step observation currently revalidates the target turn but does not
revalidate these executor bindings. No native implementation or acceptance is
claimed by this audit; complete destination authority remains false.

## Failed provider establishment and contributor boundary — 2026-10-31

If provider establishment fails before its native dispatch intent is recorded,
the coordinator now attempts authorized tracked shutdown of the already
established MCP owner. If provider dispatch was attempted or its result is
uncertain, neither owner is assumed safe to release. Integration tests cover
both cases; 184 host, coordinator, journal and dispatcher tests passed. Tracked shutdown still leaves the MCP
hold and admission fence in place and is not physical process cleanup.

Inspection of the native step path also confirms a remaining authority gap:
retained-step observation calls `continuity_validate_target_turn`, whose own
contract does not establish contributor or tool-router freshness. Step
preparation supplies live session and thread stores to every registered tool
contributor. Skill-specific isolation does not establish that other contributors
cannot mutate or retain aliases to those stores. Full isolation and freshness
must be implemented and verified before the retained router can support a
production handoff.

## Recovering resource settlement replies — 2026-10-31

The established-destination coordinator now retries the exact durable broker
settlement if an MCP or provider construction receipt was recorded but the
broker acknowledgement was lost. It never repeats native construction and does
not promote an uncertain native effect. A repeatedly lost acknowledgement keeps
the observed journal entry and admission fence held. Integration cases cover both
resource kinds, later cleanup and repeated acknowledgement loss; 182 focused
host, journal, dispatcher and simulated private-channel tests passed. This does
not verify native execution or physical MCP release, and the remaining Gate 2
requirements below still apply.

## Explicit retained-step coordination — 2026-10-31

The established-destination coordinator can now explicitly request retained
step preparation. It refuses the option before acquisition unless the native
owner supports step observation, validation and disposal. After both exact
resource owners are checked, it records fresh combined MCP/provider capability
and idle evidence, obtains the separately scoped step authorization, and
prepares the step under the fence. This combined evidence is necessary because
the two resource dispatches otherwise replace one another's capability record.
The coordinator validates the actual retained native step before and after the
callback, observes a lost preparation reply without replay, and disposes a
known retained step before cleanup if pre-callback validation fails. Pending or
uncertain effects keep the owners fenced. The option is off by default.

The focused host, broker and simulated private-channel suite passed 239 tests,
including stale steps, failed authorization, lost preparation or disposal
replies and unresolved pending observations. A staged real-native coordinator
case is present but skipped: the current native executable and tests have not
been built or run. This option does not publish placement, release the MCP
broker hold or establish complete destination authority or Gate 2 acceptance.

## Cleanup after retained-step disposal — 2026-10-31

Two staged native/broker acceptance cases now cover real destination-step
preparation, disposal, provider cleanup and tracked MCP shutdown, including a
lost disposal reply without replay. They also assert the MCP broker hold remains
established. Both cases are currently skipped: the staged native executable is
older than the implementation, and the current native build and tests have not
run. These fixtures do not claim physical MCP or orphan release.

A separate loopback broker integration now exercises the host journal and
dispatcher with actual broker grants and a simulated native owner. It observes
a lost disposal reply without replay, refuses task release while the holds are
active, runs tracked MCP shutdown and provider cleanup, and confirms that the
MCP grant remains established until the separately configured synthetic
verifier approves its cleanup. This is not a production physical-release proof.

The host journal now permits provider cleanup and tracked MCP shutdown after
the exact step-disposal receipt is durably recorded. Before invoking either
effect, the host persists its cleanup intent and asks the same live native
control owner to acknowledge that recorded disposal. Pending, uncertain,
substituted and unrecorded disposals continue to block cleanup. Native Core's
cleanup guards and journal validation were updated to retain the step history
through either cleanup order. The MCP shutdown receipt remains tracked
quiescence; it does not prove physical process release or clear the broker hold.

The focused host, broker and simulated private-channel suite passed 228 tests,
including both cleanup orders, forgery refusal, lost replies and a killed
cleanup writer. Native tests were added for both cleanup orders and journal
round trips, but the current native changes and tests have not been compiled or
run because of disk space. The exported patch reconstructs tree
`ea114788b71e6eeb661a4ec8e5a098de8be8fc72`, has SHA-256
`897d71850919df0e001c56577b1703ba122e0c22f28fd241892023daf9134e48`, and passes
forward, reverse, whitespace and exact reconstruction checks. Full native
verification, physical MCP and orphan reconciliation, destination handoff,
writer isolation and Gate 2 acceptance remain open.

## Retained destination-step disposal — 2026-10-31

The host resource journal now records a separate, exact-step disposal intent
and native receipt. The dispatcher obtains a fresh paired-owner disposal check,
writes the intent before the effect and observes a lost reply without replay.
The private control client and native channel now expose disposal and same-owner
observation under the experimental step option. Native Core writes a pending
intent before dropping the retained unpublished step and records a completion
receipt only for the same still-live owner. The receipt does not establish
physical MCP shutdown or release either resource hold. The later change above
implements the next cleanup transitions; complete reconciliation remains open.

The focused host, broker and simulated private-channel suite passed 227 tests;
the expanded journal suite passed 34 tests, including a killed disposal writer.
Native Core compiled on the current source. The overall app-server compiler
check reached the app-server crate but was stopped at the disk reserve before
finishing; the native disposal regression has not been compiled or run, and
the staged executable remains older than this source. The exported patch passes
forward, reverse, whitespace and exact reconstruction checks, reconstructs tree
`e6f51276a45138f1b815206666c826669fa531ac` and has SHA-256
`9f77705ce13b387e9ecfa5b874bb8e5a0e37f18bc3df95ad5607bce26d764767`.

## Detached destination router caches — 2026-10-31

The real retained destination router now constructs its MCP handlers, shared
definitions and tool-search handler in private caches instead of the live
source session's caches. It retains the actual executors; only the temporary
cache indexes are discarded. The ordinary step continues using shared caches.
The two-server native regression was extended to verify destination tool
inventory and preservation of source handlers, definitions and search handler;
the regression has not been compiled or run. The then-current app-server source
passed `cargo check --offline --locked -p codex-app-server`.

The exported patch reconstructs tree `14db708a8f260de94e0cdeadbf5157fc7fad1126`
and has SHA-256 `0e09323e3313630fb951a39487c1723f4342675312afa3ae5c61cb6a5a1c592d`;
forward, reverse, whitespace and exact reconstruction checks passed. This does
not establish isolation of arbitrary contributor callbacks, destination
freshness, native test execution, resource disposal, handoff or Gate 2 closure.

## Detached skill preparation — 2026-10-31

The native destination step now captures private skill catalog and alias caches
before contributor effects. Cache lock contention or missing source skill
state refuses preparation. The skills contributor uses that private state,
and constructing its destination tools no longer creates source-turn metrics
or attaches the source turn's active metrics. Ordinary step behavior remains
unchanged. Tests were added for source cache and alias isolation, contention,
actual contributor preparation and metrics publication; the skills library and
test targets compiled offline and locked, but the tests have not been run.
The then-current native app-server also passed its offline locked compiler check.

The exported patch reconstructs tree `5540fdf106b30eb57a1febd52514aa779f41896e`
and has SHA-256 `113ddcfaa29ae7ec14164c50101812a046ec9004c56ee599de36f53d216ab43c`;
forward, reverse, whitespace and exact reconstruction checks passed. This is
limited to the identified skill mutations. Other contributor and router cache
effects, skill cache freshness and handoff/rebinding, physical resource release,
real native execution and full Gate 2 acceptance remain open.

## Private destination-step channel — 2026-10-31

The native private channel now exposes preparation and same-owner observation
of the retained destination step. The host control can bind the operation to
the exact retained MCP and provider receipts, recheck the broker before and
after the effect, and observe a lost reply without replay. Recovery has a
separate paired-owner broker check that can observe after task cancellation
without authorizing a new step. Retained steps prevent the host from issuing
provider cleanup or MCP shutdown. The host dispatcher now checks retained
resource owners instead of the plan handles consumed during construction.

The then-current native app-server source passed `cargo check --offline --locked`.
The host and broker suite passed 214 tests, including the actual host
dispatcher and private-control client connected to a simulated native channel,
lost-reply recovery, pending observation and broker revocation. The native
patch passes forward, reverse, strict-whitespace and exact reconstruction
checks, reconstructs tree `2d0bb9f164d290abbe893b05db1108a6bab3f1b0` and has
SHA-256 `5bc6b8a42ea733cda95346a8fb36796b7d2933b7d010f8a44002f59994a62b2b`.
The new Core test and the other Core test targets also passed
`cargo check --offline --locked -p codex-core --lib --tests`; the test has not
been linked or run and the app-server executable was not rebuilt. The existing
established-owner regression passed against the older staged app-server, which
does not exercise the new step. Checksum-verified staged executables were
restored after the compiler check.

The channel's step capability is disabled by default and available only via
an explicit experimental constructor option. The later coordinator option
above is also explicit and is not enabled in production. The simulated channel tests are
not a real native step test. Step disposal, complete contributor and filesystem
freshness, physical MCP release, placement and full Gate 2 acceptance remain
open.

The later skill-specific change above addresses the identified catalog, alias
and metrics mutations. Native preparation still passes live session and thread
stores to contributors; complete contributor isolation remains unproven.

## Native retained destination step — 2026-10-31

The native owner now has an internal step-preparation operation. It verifies
the retained candidate and exact MCP/provider resources, persists a pending
operation before contributor effects, and runs contributor preparation and the
normal tool-router builder in a detached worker. The actual prepared inputs and
router are retained without publication. A successful operation records an
owner-bound receipt; a failed or invalidated worker records uncertainty, and a
repeat operation, provider cleanup or MCP quiescence is refused. A same-owner
observation can report the retained result or the pending/uncertain state.

The app-server compiler check passed on this production source before final
formatting. The native patch passes forward, reverse, strict-whitespace and
exact tree reconstruction checks, reconstructs tree
`ecf1687343e669490bdb9edc504327189302b979` and has SHA-256
`d0909e845f6d6735b1650acb39109bbfc89edc311d8f4213db4f3c882225bb85`.
A native test for retained router, observation, replay refusal and cleanup
refusal was added but has not run. A separate Core test-target compiler check
was interrupted during dependencies when free space approached 400 MiB, so it
does not establish that the test compiles. The app-server binary was not
rebuilt. Build artifacts were archived with verified checksums to avoid filling
disk; the staged helper binaries were restored.

The later private channel change above exposes this operation for explicitly
enabled experimental hosts. It does not prove complete contributor or filesystem
freshness, executable destination authority, step disposal, physical MCP
release, placement or Gate 2 acceptance. Native and host observation must be
wired and tested under a real broker grant before this operation can be used.

## Host destination-step dispatch and observation — 2026-10-31

An internal host dispatcher now queries the two established grants, obtains
the fresh step-specific broker check, revalidates the retained destination and
writes its step intent before calling the native owner. A completed receipt is
bound to both resource owners and stored. A lost reply, failed write or lost
fence leaves the intent held; a separate same-owner observation can recover a
retained receipt without replaying the native effect. The dispatcher requires
explicit native step support and matching native dispatch, observation and
uncertainty hooks. The current `CodexNativeControl` does not advertise or
implement that support, so this path is not enabled in the established
destination coordinator or production.

The focused host and broker run passed 207 tests. A subsequent focused
journal run passed 24 tests after adding recovery of a mismatched native reply.
An existing staged established-owner regression also passed with the older
app-server from tree `4d198f714ce7ec405304787086ef5a3a4c9ee6f9`; it does not
exercise the new step operation.
These tests use a fake native step owner; the real broker authorization path
is covered separately. They exercise success, revoked approval, stale
candidate, changed authorization, unsupported native owner, intent and receipt
write failures, lost or pending replies, owner loss, receipt mismatch and
recovery without replay. The initial host test exposed differing JSON field
order in equivalent grants; the host now compares parsed contracts.

The native owner still needs to implement and bind this operation, enforce its
own effect and observation checks, retain the real contributor output, and
provide step disposal. MCP physical release, placement, handoff and full Gate 2
acceptance remain open.

## Write-ahead destination-step ownership — 2026-10-31

The private Codex resource journal can now persist one destination-step
dispatch intent under the established MCP record and bind it to the exact
provider and MCP grants, receipts, retained candidate and operation identity.
It checks the two records together on every write and reload, rejects other
unresolved owners, changed or forged receipts and unsafe phase changes, and
prevents provider cleanup or MCP quiescence while a step intent is retained.
After a lost reply, the record can move from dispatching to uncertain and then
to an observed retained receipt; the dispatch itself cannot be repeated.

The host and resource-journal suites passed 136 tests; the expanded run with
broker and establishment tests passed 196 tests. A real child
process was killed immediately after persisting a step intent; a successor
observed the intent and could not replay it or dispose the provider. Separate
tests verify provider cleanup and MCP shutdown do not reach native callbacks
while the intent exists, and a substituted owner is refused on reload.

The internal host dispatcher described above writes this intent, but it is not
wired into the production coordinator. No native step preparation, observation or disposal RPC
exists. It does not establish physical MCP release, placement or Gate 2
acceptance. A native owner-bound operation and recovery path must consume this
record before any contributor callback is enabled.

## Fresh destination-step broker check — 2026-10-31

The broker now provides a separate `prepare-destination-step` check for the
same authenticated receiver and exact established MCP and provider owners.
It requires the approved MCP plan to disclose step preparation, the latest
resource preview to remain approved, a claimed task without a terminal hold,
current combined MCP/provider capability evidence and a fresh idle observation.
It refuses stale or replaced grants, changed approval, cancellation, busy or
stale evidence, foreign receivers and mismatched reservations. The two owner
records are checked in one broker snapshot.

The broker, resource and host suites passed 192 tests, including a real
loopback broker transport case. This is a fresh broker-state check only: the
existing capability bits do not prove contributor execution support, and the
result is not a durable dispatch intent, native replay fence, placement grant or
MCP release proof. No contributor callback is enabled or dispatched. The host
and native owner still need a journaled step operation, recovery and explicit
native execution support before this check can be consumed for an effect.

## Disclose destination contributor preparation — 2026-10-31

Native MCP plans can now explicitly disclose destination step preparation. The
flag requires a retained destination and skill, plugin and MCP binding capture;
the broker additionally requires the complete conservative process, network,
credential, filesystem and plugin effect ceiling. It covers contributor and
provider callbacks and their shared-cache effects. Control schema 27 preserves
the disclosure and refuses state or exports disguised as older schemas. Legacy
records migrate without gaining it. The host refuses to dispatch such a plan
until native step-preparation execution support is explicitly implemented.

The JavaScript host, control, storage and related suites passed 270 tests,
including disclosure, schema downgrade, rehashed export and unsupported-native
refusal. A wider control and storage regression run passed 231 tests; its scope
overlaps the first run. Native rustfmt checks and patch forward, reverse, whitespace and exact
tree reconstruction passed. The patch reconstructs tree
`611c6d4102df6412d67181024205bd09a1978bba` and has SHA-256
`deb65981ea0b1a9a3616b511ded34d4d54259ab960063de4a4855f961d7691b9`.
The native app-server compiler check passed on the current tree after an
initial run was interrupted at Core to avoid exhausting disk space. No native
test or executable was run for this change. Build artifacts were
checksum-verified and archived with restoration records; the staged helper
binaries were restored after the check.

The flag is disclosure only. The broker now has the fresh step-specific check
described above; durable dispatch and recovery are still needed. Native contributor preparation,
router construction and freshness checks remain unimplemented. The MCP hold,
physical process cleanup, placement, receiver handoff, writer isolation and
full Gate 2 acceptance remain open.

## Joint destination-owner observation — 2026-10-31

The broker can now observe the exact established MCP and provider owners in one
state snapshot, after authenticating the connected Codex receiver. It checks
both approved grants and receipts, the same task, claim, source, destination,
process generation and native reservation, and refuses cancelled or held tasks,
other unresolved transitions and active managed operations. The established
destination host rechecks its journaled receipts and calls this observation
before entering its callback. A refused observation runs the existing
pre-operation cleanup sequence; if cleanup remains uncertain the fence stays
quarantined. This is a point-in-time observation, not a native owner lock, a
step-preparation grant, physical MCP release or movement authority.

The host, native-control, resource, broker and establishment suites passed 186
tests. Five staged native/broker cases passed for established owners,
post-operation drift and lost pre-operation cleanup replies. The staged
app-server was built from the earlier tree
`4d198f714ce7ec405304787086ef5a3a4c9ee6f9`. An initial sandboxed broker run
failed to bind loopback and passed with local network permission. A first host
run exposed equivalent plan objects with different field order; the final check
uses the existing typed plan comparisons. A transport fixture also needed its
test clock advanced to replenish the broker's request bucket.

## Current app-server compiler check — 2026-10-31

After the interrupted run below, the current native app-server passed
`CARGO_BUILD_JOBS=1 cargo check --offline --locked -p codex-app-server` in
5 minutes 8 seconds. The check reported one MCP library warning and 19 Core
warnings; it did not rebuild an executable or run destination acceptance. The
exported patch SHA-256 remains
`80a7002b471ed9e81e8d10a01479cfbc9cb22a738d43b6da17d3e0b097aa5669`
and its reverse application check passed against the current checkout.

To make room, older compiler libraries and metadata were compressed, verified
by decompression and recorded in the native artifact restoration index. The
interrupted check metadata was restored before the retry. After the passing
check, additional older build artifacts were similarly archived, leaving about
1.27 GiB free. No staged executable was replaced.

The broker presently authorizes MCP and provider establishment and their
recovery separately, but has no action authorizing destination step preparation
after both owners are established. Step preparation may invoke executor, cloud
and custom skill providers, in addition to the sealed host skill capture already
disclosed by the MCP plan. These effects need their own bound authorization and
recovery before the actual contributor callbacks and router can be used.

## Current native check and step assembly inspection — 2026-10-31

An offline app-server compiler check of the current native tree was interrupted
before completion when free disk space fell below 500 MiB. It does not establish
that the current app-server compiles. The interrupted check's unlinked metadata
and three compiler libraries were moved to checksum-verified compressed
archives with restoration records in `.native-runtimes/codex-build-artifact-archive/index.jsonl`;
the staged executable and existing archives were preserved. Free space after
archival was approximately 1.15 GiB.

The ordinary native step invokes each tool contributor's `prepare_for_step`
before constructing the router. The skills contributor can refresh shared
executor catalogs and query providers, and recommendation preparation can
consult authentication and external plugin candidates. These operations cannot
be treated as a read-only continuation of the retained preview. The next native
assembly must account for their effects, ownership and freshness under the
approved destination rather than calling them as an unguarded preview. The
existing MCP quiescence result also remains insufficient for broker release: a
previous real fixture left a detached, closed-pipe child alive after quiescence.

## Recover lost pre-operation cleanup replies — 2026-10-31

When pre-operation invalidation requires cleanup and its reply is lost, the
host now makes up to three bounded observations of the same native owner. It
does not repeat provider cleanup or MCP shutdown. Once provider cleanup is
observed, it can retry the exact journaled broker settlement. If the result or
settlement remains uncertain, the host preserves the admission fence and MCP
hold. The recovery reserves time on the existing fence and respects cancellation.

The host, control, dispatch and journal suite passed 129 tests. Two staged
app-server cases passed with a provider-cleanup or MCP-shutdown reply dropped;
three staged no-loss and post-operation regressions also passed. An initial
MCP lost-reply test showed that a single observation could time out while
shutdown was still finishing; bounded observation retries resolved that case
without replaying shutdown. The staged executable was built from source tree
`4d198f714ce7ec405304787086ef5a3a4c9ee6f9`, not the current native source.
These results do not establish physical MCP release, broker hold release,
authorized reselection or full Gate 2 acceptance.

## Host cleanup after pre-operation destination invalidation — 2026-10-31

If a retained destination fails validation after MCP establishment but before
the operation begins, the host now journals and quiesces that exact MCP owner.
If the provider was also established, it first journals native provider cleanup
and settles that cleanup with the broker. MCP quiescence does not clear the MCP
broker hold or release the admission fence. A cleanup that remains uncertain
after bounded recovery stops the sequence and leaves the fence quarantined.
Failures from the operation itself
are not automatically treated as an effect-free abort.

The native control channel now preserves the owner only for an exact, completed
`NATIVE_CONTINUITY_UNAVAILABLE` response to read-only destination validation.
The refused candidate is marked invalid and cannot be used for another plan or
construction, including when broker authorization is already in flight.
Timeouts, unexpected errors and malformed replies still close the channel. An
effect-free candidate can instead be abandoned under its exact reservation.

Both staged native cases passed with a real app-server: destination instruction
drift after MCP establishment, and drift after both resources were established.
Eight related staged owner, destination and quiescence cases and 126 host, native
control, dispatch and journal tests also passed. The first sandboxed staged run
could not open a loopback listener; the local-only fixture passed outside the
sandbox. An initial staged run exposed that validation closed the owner before
cleanup; the control-channel fix was tested before the passing runs. These staged
cases used the previously tested app-server from source tree
`4d198f714ce7ec405304787086ef5a3a4c9ee6f9`, not the newer native source, and
used instruction drift as the trigger rather than a V1 discovery change. They
do not prove physical MCP release, clearing the broker hold or authorized
reselection. The full destination step and router, resource reconciliation,
placement, receiver handoff, writer isolation and Gate 2 acceptance remain open.

## Stale selection native cleanup — 2026-10-31

The V1 destination regression now checks that after discovery invalidates the
retained selection and new preparation refuses it, dropping retained readers
still permits native provider cleanup and MCP quiescence. The V1 cleanup test
and the hosted-plugin selection regression passed. This covers the test fixture;
it does not prove broker settlement, physical MCP release or a fresh authorized
reselection and recovery path.

The Core test executable used the documented 8 MiB stack and was linked without
debug information. It was archived with a verified checksum; the previously
tested app-server and helpers were restored. The patch reconstructs source tree
`c29fa86749b9e8eb8758da7c7cdd487b5d7d4456` with forward, reverse and
strict-whitespace checks. The app-server check and binary have not been rebuilt
on this revision. The actual destination step and router, resource
reconciliation, placement, receiver handoff, writer isolation, production
wiring and full Gate 2 acceptance remain open.

## Bind retained plugin selection to discovery — 2026-10-31

The retained step plugin selection is now tied to the ready-root identities and
the exact discovery results used to select it. V1 requires the same cache owner,
activity generation, sandbox contexts and result identities; disabled discovery
and local V2 remain distinct. The checks run around selection and during retained
destination validation. Discovery activity invalidates the old selection, so a
new turn cannot silently reuse it. A fresh authorized reselection and recovery
path is still needed; this change does not observe arbitrary contributor state or
prove filesystem freshness.

The V1 invalidation test passed and verified both the original turn and a new
preparation refuse the stale selection. The hosted-plugin, skill-policy and MCP
grant replay-fence regressions also passed. These fixtures do not prove a
nonempty executor-root inventory. The Core test used the documented 8 MiB stack
and a test executable linked without debug information; its archive was verified.
The previous app-server and helpers were restored. The patch reconstructs source
tree `9658c2885cc6284e90a1e8d78ef0e9ae27562fa0` with forward, reverse and
strict-whitespace checks. The app-server check and binary were not rebuilt on
this revision. The actual destination step and router, resource reconciliation,
placement, receiver handoff, writer isolation, production wiring and full Gate 2
acceptance remain open.

## Retained destination executor hook sources — 2026-10-31

The retained destination now derives executor hook sources using the same native
builder as an ordinary step, with its retained MCP binding, selected plugins and
captured discovery mode. Disabled, V1 and empty local V2 modes preserve the
normal builder's distinct inputs. This retains point-in-time data; selection,
discovery and filesystem freshness still need proof before execution.

The V1 invalidation, hosted-plugin selection and skill-policy Core regressions
passed on source tree `b28111c21d31bda9884fef7f7134a25db38dae4a`. These tests
do not cover a nonempty executor-hook inventory. The test executable used the
documented 8 MiB stack and was linked without debug information; it was archived
with a verified checksum. Previously tested app-server and helpers were restored.
The patch passed forward, reverse and strict-whitespace reconstruction checks.
The app-server check and binary have not been rebuilt on this revision. The
actual destination step and router, resource reconciliation, placement, receiver
handoff, writer isolation, production wiring and full Gate 2 acceptance remain
open.

## Hosted plugin selection in the retained destination — 2026-10-31

A Core test now installs a hosted-plugin MCP contributor fixture, constructs the
retained destination and verifies that its step data contains the expected
nonempty hosted plugin identity. The hosted-selection test, V1 activity
invalidation test and skill-policy change-and-restore test passed. This checks
the native selection path with a fixture; it does not establish freshness of a
live contributor or plugin filesystem inventory.

The Core test executable used the documented 8 MiB stack and was linked without
debug information. It was archived with a verified checksum; the previously
tested app-server and helpers were restored. The patch reconstructs source tree
`c314919893d098fa68962cbf58ee151189553486` and passes forward, reverse and
strict-whitespace checks. The app-server check passed before the test-only
changes; the app-server binary has not been rebuilt. The actual destination
step and router, resource reconciliation, placement, receiver handoff, writer
isolation, production wiring and full Gate 2 acceptance remain open.

## Retained destination step plugin selection — 2026-10-31

During the effect-authorized MCP construction, the destination now invokes the
native step plugin selector with the destination configuration, retained MCP
plugin policy, captured ready roots, discovery results and environment selection.
The resulting point-in-time selection is retained with the MCP plugin cache
observation and inserted into the detached destination step data. Holding that
input participates in the existing MCP cleanup ownership check. It does not
prove freshness of contributor state or filesystem inventory, and must not be
used as execution authority without those checks.

The app-server compiler check passed on source tree
`1fb183cf2c5031dbb842fb64e369cfb5c1ab01fd` after an initial context type
mismatch was corrected. The V1 destination invalidation test, the two existing
destination tests and the MCP grant replay-fence test passed. These cases do not
prove a nonempty plugin selection or complete contributor preparation. The
Core test executable used the documented 8 MiB stack and was linked without
debug information; it was archived with a verified checksum. Previously tested
app-server and helper binaries were restored. The patch passed forward, reverse
and strict-whitespace reconstruction checks. The app-server binary has not been
rebuilt; the actual destination step and router, resource reconciliation,
placement, receiver handoff, writer isolation, production wiring and full Gate 2
acceptance remain open.

## Retained destination V1 discovery regression — 2026-10-31

A dedicated Core fixture enables V1 discovery in the trusted destination
configuration and asserts that the retained turn actually holds a V1 cache
observation. After discovery activity, validation rejects that retained turn;
a freshly prepared turn is accepted. The V1 case and both existing destination
fixtures passed. This verifies activity-generation invalidation, not filesystem
inventory freshness, a nonempty root inventory, or execution authority.

The test executable used the documented 8 MiB stack and was linked without
debug information. It was archived with a verified checksum; the previously
tested app-server and helpers were restored. The patch reconstructs source tree
`bb56bf9feae339fbd221699a4738b6660fcf93cf` and passes forward, reverse and
strict-whitespace checks. The app-server compiler check passed on the same
production source before the test-only changes; its binary has not been rebuilt.
The actual destination step and router, resource reconciliation, placement,
receiver handoff, writer isolation, production wiring and full Gate 2 acceptance
remain open.

## Retained destination Core regression — 2026-10-31

The Core retained-destination tests passed with and without the native skill
contributor, as did the equal ready-report republication regression. Both
destination fixtures reported that they did not hold a V1 observation, so these
tests do not cover V1 discovery invalidation in the destination. The focused executor
V1 owner-observation test passed separately on the prior source revision.

The successful test used an 8 MiB stack and an executable linked without debug
information. An earlier attempt was interrupted for disk space; the successful
single-job retry required verified archival of older compiler libraries and
metadata and cleanup of completed intermediates. The tested executable was
archived with a verified checksum, and the previously tested app-server and
helpers were restored. The patch reconstructs source tree
`575a0427ccdcb1327303e7ba87cffeff4e413807` and passes forward, reverse and
strict-whitespace checks. The app-server compiler check passed before a later
test-only logging change; the app-server binary has not been rebuilt. Actual
step and router assembly, resource reconciliation, placement, receiver handoff,
writer isolation, production wiring and full Gate 2 acceptance remain open.

## Retained destination step inputs — 2026-10-31

The normal native step and the retained destination now share the same
step-extension-store initialization for model messages. The retained local
destination store also contains the captured resolved capability roots, as the
normal step store does before tool contributors run. This is a private input
store; contributors, plugin selection, hook sources, the executable router and
step publication are not yet assembled by this path.

The app-server compiler check passed on source tree
`73245d733055462351586a826d28518aa3f4eca8`, and the patch passed forward,
reverse and strict-whitespace reconstruction checks. The Core destination
integration test did not execute: the Core test build was interrupted while
compiling the test target when free disk space fell below 400 MiB. It used the
8 MiB stack and a linker configured to omit test-executable debug information.
Earlier check metadata and stale compiler libraries were archived with verified
checksums and restoration records; completed build intermediates were removed.
The app-server has not been rebuilt. The previously tested app-server and
helpers were restored from verified archives. Resource reconciliation, placement, receiver handoff,
competing-writer isolation, production wiring and full Gate 2 acceptance remain
open.

## Retained destination local discovery integration — 2026-10-31

Retained local destination turns now observe the existing V1 discovery cache
using the same sandbox and root selection rules as normal native steps, without
starting discovery. Revalidation checks the cache owner and activity generation;
V2 local and disabled-discovery modes are represented separately. This remains a
point-in-time observation, not filesystem freshness or execution authority.

The app-server compiler check passed on source tree
`1b606ac577b8b34ba088e214e23cdd63002666e3`. The modified executor owner-observation unit test and the lazy-environment
regression passed on this revision. The added Core destination integration test
has not been run, and its conditional V1 branch has not been proven to execute.
The app-server has not been rebuilt from this revision. The prior tested app-server and helper
binaries were restored with their verified checksums. The patch reconstructed
the source tree and passed forward, reverse and whitespace checks. The actual
destination step and router, placement, resource reconciliation, receiver
handoff, writer isolation, production wiring and full Gate 2 acceptance remain
open.

## Local executor discovery cache observation — 2026-10-31

The native V1 executor discovery cache now tracks discovery activity and can
provide a nonblocking, owner-bound snapshot of completed local-root entries.
It refuses missing, retryable, remote, active, contended or poisoned state;
ordinary discovery entry and exit advance the observation generation, including
cancelled work. The snapshot does not start discovery or consume recovery state.
It is a point-in-time cache observation, not a filesystem freshness proof,
remote discovery implementation, reservation or execution permission.

The focused executor test passed for the exact local owner and environment,
missing/retryable entries, lock contention, active work and invalidation after
normal discovery. The existing lazy-environment inspection regression passed.
The first build ran out of space before the executor library completed; a
single-job retry passed. The tested executable and older compiler libraries
were archived with verified checksums, and the prior app-server and helpers
were restored. The patch reconstructed tree
`c7b7ddeb042e0565065f4abff7035ae7efea1de2` and passed forward, reverse and
whitespace checks. The app-server check and rebuild have not been rerun on this
revision. At that revision the new cache observation was not yet wired into
retained destination turns; actual step and router assembly, placement, resource reconciliation,
receiver handoff, writer isolation and full Gate 2 acceptance remain open.

## Retained target capability roots and skill declarations — 2026-10-31

Destination turn preparation now applies the same root ordering, filtering and
deduplication used by ordinary native steps. It retains the selected roots and
the exact environment ready-report identities, refuses changed reports or root
selection, and derives the skill tool declarations from the retained native
skill policy, selected roots and discovery-version feature. This is detached
metadata: executor-discovered inventories, extension scopes, tool suggestions,
the complete router and execution authority remain outside its proof.

The app-server compiler check passed. The Core destination-turn test passed with
the native skill contributor and compared retained roots with the normal step
resolver; the no-contributor test, equal-report-republication check and two
existing root-selection regressions also passed. The Core tests used the
documented 8 MiB stack and an executable linked without debug information.
The tested executable was archived with a verified checksum; the prior tested
app-server and helpers were restored. The patch reconstructed source tree
`4a5563f00b26459c5316b86e77153932971cd410` and passed forward, reverse and
whitespace checks. The app-server has not been rebuilt from this revision.
Production step and router assembly, placement, resource reconciliation,
receiver handoff, writer isolation and full Gate 2 acceptance remain open.

## Native skill policy Core integration verified — 2026-10-31

The dedicated Core test passed with the real native skill contributor installed:
it verifies that a retained destination turn refuses a skill-policy change and
still refuses it after the original policy is restored. The corresponding
no-contributor regression also passed. Both ran against source tree
`3adeb31681572dfc9040043b200d1f56c30282d0` with the documented 8 MiB test
stack. To fit the link, the final test executable omitted debug information;
the native source and app-server build settings were unchanged. The executable
was archived with a verified checksum.

The first three link attempts failed for lack of space. Before the successful
attempt, 180 older metadata-only compiler files were archived and verified;
the archive includes a restoration index. The prior tested app-server and
helpers were restored with verified checksums. This verifies the private
preparation's policy check, not a real destination step, tool router, placement,
resource reconciliation, receiver handoff, writer isolation or complete
Gate 2 acceptance; those remain open.

## Native skill policy destination-turn integration test — 2026-10-31

Added a Core fixture that installs the actual native skill contributor in the
session registry and changes its policy through the registry's configuration
callback. The intended test checks a retained destination turn against policy
change and restoration, then prepares a fresh turn; the original no-contributor
case is retained. This is test coverage for the existing integration, not a
new production handoff.

The first three attempts compiled but did not execute: they failed while linking
the Core test executable because the filesystem ran out of space. The third
attempt reused built dependencies but still exhausted the available link space.
Older compiler libraries and the previous tested executables were archived with
verified checksums and indexes; failed build outputs were cleared. The prior
tested app-server and helpers were restored with verified checksums. The patch
reconstructs tree `3adeb31681572dfc9040043b200d1f56c30282d0` and passed
forward, reverse and whitespace checks. The preceding app-server check covered
the same production source; this tree changes only test code. The dedicated
Core integration was subsequently verified as recorded above. Gate 2 remains open for the real step and
router, placement, resource reconciliation, receiver handoff, writer isolation
and full end-to-end acceptance.

## Native skill policy observation — 2026-10-31

The native skill thread now provides a nonblocking, owner-bound observation of
its applied tool policy. A new generation is published on configuration updates,
so a changed and restored policy invalidates earlier observations. Scope or
policy-lock contention, poisoning, missing state and owner replacement refuse
observation. The detached destination turn retains and revalidates this witness
when the concrete native skill contributor is registered. It does not observe
executor capability roots, skill catalogs or complete tool-router readiness.

The skill policy test covered missing state, lock contention, policy change and
restoration, and owner replacement. All 168 skill-extension tests passed. A
separate extension-scope test passed for contention and poisoned locks. The
app-server compiler check passed on the same production source, and the patch
reconstructed tree `0f02dbdb86e210c61a3398f368a466d4fb3e6a2f` with forward,
reverse and whitespace checks. The first focused build exposed two direct
cloud-policy reads that were updated before the passing retry. The prior tested
app-server and helpers were restored with verified checksums; the app-server
has not been rebuilt from this tree. No dedicated Core destination-turn test
with the skill contributor installed has yet exercised this integration.
Actual step and tool-router assembly, placement, resource reconciliation,
receiver handoff, writer isolation and full Gate 2 acceptance remain open.

## Read-only native skill tool definitions — 2026-10-31

The native skill contributor now obtains tool declarations from the same pure
specification functions used by the executable list, read and installations
tools. The new metadata-only function does not instantiate skill executors,
load catalogs, publish analytics or invoke discovery. Its enabled and discovery
version inputs still require a real retained target step observation; callers
cannot treat the supplied booleans as authority or destination freshness.

The focused contributor test compared read-only declarations with the actual
executable tools for both discovery versions and verified disabled steps; all
167 skill-extension unit tests passed. The first test build was stopped for
low disk space; the retry passed after completed caches were reclaimed. The
patch reconstructs tree `36d230f07c362931ad0303c2897838336ec44b29` and passed
forward, reverse and whitespace checks. The prior app-server and helpers were
restored with verified checksums. The app-server check and rebuild have not
been rerun on this source. Additional older compiler libraries were archived
with verified contents and an index to make restoration possible.

Real target step observations, complete tool-router assembly, production
placement, resource reconciliation, receiver handoff, writer isolation and
full Gate 2 acceptance remain open.

## Rebuilt app-server and staged regression — 2026-10-31

Rebuilt the native app-server from source tree
`4d198f714ce7ec405304787086ef5a3a4c9ee6f9` (SHA-256
`1be5876d8cdba3d8f67f053053bae0d12f39da1da91d88a4af084ac2e4e9574d`).
Eleven staged destination, drift, plugin and MCP-quiescence cases and ten
lost-reply, cleanup and shutdown cases passed against that executable. These
process tests do not invoke the private detached-turn preparation; its grant
and owner behavior is covered by the focused core tests recorded below.

The first build was stopped as disk space fell below 1 GiB; the next reached
the linker and failed for lack of space; the final link retry passed after
completed caches were reclaimed. Three helpers were restored with verified
checksums. Nine older compiler libraries were archived with verified contents
and an index under `.native-runtimes/codex-build-artifact-archive/` to recover
space. The prior app-server remains in its verified archive.

The staged cases do not prove the real destination step, tool router, placement,
resource reconciliation, receiver handoff, competing-writer isolation or
end-to-end Gate 2 acceptance; those remain open.

## Session grant revision for destination turns — 2026-10-31

Session permission grants now share their lock with a monotonic revision. The
normal native grant writer increments it when applying a grant; revision
exhaustion permanently refuses observations without blocking ordinary grant
storage. Detached destination turns capture the values and revision together,
so validation rejects a grant change even when the original values are restored.
Network-proxy identity remains a point-in-time observation and does not cover
proxy policy changes or change-and-restore; this does not grant execution.

The focused owner test passed including grant change-and-restore refusal and
fresh preparation after restoration. Its default-stack run overflowed before
assertions; the same executable passed with the native project's documented
8 MiB test stack. The revision exhaustion test and two existing session-grant
regressions passed with that stack. The app-server compiler check and native
patch forward/reverse/whitespace checks passed for source tree
`4d198f714ce7ec405304787086ef5a3a4c9ee6f9`. The previous app-server and helpers
were restored with checksums verified; this source has not been rebuilt into
the app-server. Native step and router assembly, placement, resource
reconciliation, receiver handoff, writer isolation and full Gate 2 acceptance
remain open.

## Detached turn grant and proxy observations — 2026-10-31

Detached destination turn construction now copies session permission grants
instead of sharing the mutable live grant map. It retains a weak observation of
the live network-proxy owner and checks grants and proxy identity before and
after asynchronous owner revalidation. This prevents the prepared turn from
silently absorbing changed grants and refuses a changed live observation.
These are point-in-time comparisons: change-and-restore, proxy internals,
complete network-policy freshness and execution exclusion remain unproven.

The focused native core test passed, including insertion of a live grant,
confirmation that the detached turn does not absorb it, refusal during drift,
and successful revalidation after removal. The app-server compiler check and
native patch forward/reverse/whitespace checks passed on source tree
`ccc00626f43d84e8e9b2e2fd6f1ca672f3a03bb2`. The previous app-server and helper
binaries were restored with checksums verified; the app-server has not been
rebuilt from this source. Native step and router assembly, production
placement, resource reconciliation, receiver handoff, writer isolation and
full Gate 2 acceptance remain open.

## Detached target turn from retained inputs — 2026-10-31

The retained destination now supplies the native turn constructor with its
target model and model list, inert provider view, target environment, plugin
selection, captured skills, and session settings. The private preparation
retains its owner witnesses and rechecks them alongside model, provider, code
mode, realtime, and multi-agent observations. It requires approved skill
capture. It does not publish a turn, assemble a step or tool router, establish
complete freshness of every turn input, or grant execution authority.

The app-server compiler check passed on the same production source. The focused
core owner test passed with captured skills, target model and directory checks,
foreign-owner refusal, plugin-cache drift refusal, and resource cleanup after
the preparations were dropped. The exported patch reconstructs source tree
`617ba9d7fb5620eac45c8ad9efe59adc61433be5` and passed forward, reverse, and
whitespace checks. The previous app-server and helper binaries were restored
with verified checksums; this source has not been rebuilt into the app-server.
Native step and router assembly, production placement, resource reconciliation,
receiver handoff, writer isolation and full Gate 2 acceptance remain open.

## Explicit turn model-list input — 2026-10-31

The native turn constructor now accepts its available model list as an explicit
input. Normal turn construction and existing test helpers still read the list
from the same live models manager with the same empty fallback. This creates a
path for the retained destination list without handing the target manager to
the turn constructor. The destination path does not yet construct a turn or
consume that list, and no execution or router authority is established.

The app-server compiler check passed on source tree
`e90d52435552bb1359441a553ae6e7999089ab67`. The native patch passed forward,
reverse, and whitespace checks. The app-server executable has not been rebuilt
from this tree. The earlier exact-owner test executable was checksum-verified
and archived as `codex-core.target-tool-owner-tested.gz`; it covers the previous
source tree, not this constructor change. Complete destination assembly,
resource reconciliation, receiver handoff, writer isolation, and full Gate 2
acceptance remain open.

## Inert target provider view for tool preparation — 2026-10-31

The retained target input set now includes a non-executing provider view and
the target model manager's current model list. The view copies the retained
provider's metadata and capabilities, cannot resolve request credentials or
construct an API provider, and does not expose the retained provider or its
manager. Its creation and later input revalidation check the original owner,
provider configuration, model observation, and copied list. A focused native
provider test passed, including target-only model data, refused API/auth
access, and unpublished-provider cleanup while the view remained alive. The
app-server compiler check passed. Two attempts to link the exact-owner core
test failed for lack of disk space; after reclaiming space, the third attempt
passed `continuity_target_tool_inputs_retain_exact_approved_resources`.

The view is tool-preparation input, not a live turn or executable provider.
The prior tested app-server and helpers were restored with verified checksums;
this revision has not been rebuilt into the app-server.
Complete tool-router assembly, plugin-file freshness, production placement,
resource reconciliation, receiver handoff and writer isolation remain open.

## Plugin skill-cache agreement — 2026-10-31

When a parsed plugin skill root is already cached for the target, detached
skill preparation now compares that cached root with an independent scan
through the controlled filesystem. A mismatch refuses preparation. Absent
entries remain absent, and the comparison never writes to the live plugin
skill cache. The existing owner and cache-revision observations still have to
be revalidated; this check does not cover all plugin files or establish a live
turn grant.

The focused stale-cache test passed, including matching data, a changed skill,
confirmation that the cache was not modified, and no additional filesystem walk.
All 19 host skill-service tests, the app-server compiler check, and a native
app-server rebuild passed. The first rebuild ran out of disk space; the retry
passed after completed build caches were cleared. The native patch passed
forward, reverse, and whitespace checks. Eighteen staged destination, drift,
recovery, and shutdown cases passed against the rebuilt app-server. Two further
staged cases passed with an active plugin skill: an unchanged destination was
established, and changing the skill after preview kept the fence held and
prevented target MCP startup. The staged refusal does not by itself identify
which freshness guard fired; the skill-service test specifically verifies the
stale-cache comparison.

## Captured skill text for destination preparation — 2026-10-30

The approved retained skill snapshot can now carry the text of each discovered
skill, read through the filesystem owner that supplied it before that owner is
sealed. Captured reads use only those stored bytes and reject unknown paths;
the sealed filesystem still refuses direct reads. A missing owner or a file
changing during capture refuses the operation, and the retained filesystem
observations continue to detect later changes. This is preparation data, not a
live turn grant or a capture of scripts referenced by a skill.

The native app-server compiler check and rebuild passed. A focused native core test passed
for actual plugin-skill discovery, captured-text stability after a file edit,
unknown-path refusal, direct sealed-read refusal, and changes during capture.
The patch passed forward and reverse application and whitespace checks. Nine
staged native process cases passed against the rebuilt app-server, including
approved destination startup, skill-file drift, catalog drift, required-server
exit, and MCP quiescence. Nine additional recovery and shutdown regression
cases passed. The helpers were restored with verified checksums.

## Approved retained skill preparation — 2026-10-30

Destination MCP plans can now disclose skill capture as a distinct approved
effect, including possible bundled-skill installation. The approved capture
uses the retained plugin selection and controlled filesystems, keeps the skill
snapshot with the MCP owner, and revalidates the observed inputs and the exact
skill-service root selection. Quiescence refuses to release a borrowed capture.
Schema 26 preserves the effect and rejects older-schema disguises; dispatch
refuses to publish an approval when the native owner lacks the capability.

The native app-server compiler check passed, the patch passed forward and
reverse application and whitespace checks, and 244 host/control tests passed.
After tightening the capture prerequisites, 119 affected host tests passed,
including the additional dispatch capability guard. The native app-server was
rebuilt from this source and nine staged process cases passed, including
skill-file drift, catalog drift, required-server exit, and MCP quiescence.
Nine additional staged recovery and shutdown regression cases passed.
Two earlier rebuild attempts and the first focused root-observation test were
interrupted as disk space became low. After archiving 235 older duplicate
compiler libraries with verified checksums and reclaiming completed build
caches, the rebuild passed; all three helper executables were restored with
their checksums verified. The focused root-observation test also passed,
including rejection of changed roots and a different skill service.

The retained snapshot still needs reconciliation with live turn behavior and
complete tool-router construction. Plugin-file freshness, executable authority,
physical resource cleanup and reconciliation, placement, receiver handoff,
competing-writer isolation and full Gate 2 acceptance remain open.

## Detached skill discovery through controlled filesystems — 2026-10-30

The native host skill service can now perform detached, uncached discovery
through caller-supplied repository and local filesystem owners. User, system,
admin, extra, plugin and repository roots follow the selected filesystem, and
implicit invocation path canonicalization no longer bypasses the controlled
local owner in this path. Bundled-system installation is refused unless the
caller explicitly permits it. The ordinary live loader keeps its existing
filesystem and cache behavior.

A shared strict preparation filesystem can now be sealed after discovery. It
serializes concurrent walks, retains cancellation markers for waiting and active
walks, and refuses subsequent reads after sealing. A native core test exercised
actual concurrent plugin skill roots through this wrapper, verified captured
inputs, detected a later skill-file edit and refused live reads after sealing.
Two skill routing/installation tests, nine existing skill-root tests, 17 host
service tests and 19 native preparation-filesystem tests passed. The first
loader test build ran out of space; after archiving verified artifacts its retry
found a macOS path alias assertion, corrected in a passing retry. The first core
test link also ran out of space; the retry passed after archiving verified
libraries. Tested runtime binaries and helpers were restored.

This detached result deliberately bypasses mutable live skill caches. It is not
yet journaled under an operator-approved destination effect, reconciled against
the live turn, or used to construct and publish the complete tool router.
Environment and root-selection freshness, plugin-file freshness, placement,
recovery, receiver handoff, competing writers and full Gate 2 acceptance remain
open. The app-server remains the previously tested binary and does not include
these changes.

## Strict preparation walk — 2026-10-30

The native preparation filesystem now implements complete recursive walks using
its existing strict bounded directory, metadata and canonicalization operations.
Those observations can be revalidated; changed contents, over-budget scans,
unsupported directory transports, errors, and cancelled walks cannot be turned
into a complete preparation. It preserves ordinary complete-walk handling of
symlinks, depth and hidden-directory pruning while refusing incomplete scans.
Two focused native tests passed for parity, drift, limits and cancellation, and
all 18 related native preparation-filesystem tests passed. The tested app-server
and three helper executables were restored from verified archives.

This is point-in-time filesystem evidence only. At that checkpoint the skill loader had not yet been changed to route its roots
through this filesystem, and plugin-file freshness had not been established. The app-server is
still the previously tested binary and does not include the new walk changes.
Destination tool authority, placement, recovery, receiver handoff, competing
writers and full Gate 2 acceptance remain open.

## Bounded native skill-directory walk — 2026-10-30

The native filesystem walk used by skill discovery previously collected every
name in a directory before enforcing the requested entry limit. It now bounds
that collection by the remaining entry and response-byte budgets, reports an
incomplete result as truncated, and counts skipped or broken entries against
the global examination budget. Complete walks retain sorted behavior. A
truncated walk can return a different partial subset because it no longer reads
the whole directory merely to choose the lexicographically first names; callers
requiring complete evidence must refuse a truncated result.

Five native walk unit tests and the existing local and remote bounded-tree
integration cases passed. The first unit-test build failed before execution for
lack of disk space; after checksum-verified build artifact archival, the retry
passed. The previously tested app-server and its helper binaries were restored
and verified. That app-server is from the preceding source tree and does not
include this change. At this checkpoint the destination preparation filesystem still refused walks,
and native skill roots used separate local filesystems; this fix alone did not
prove file freshness, complete the tool router, or close Gate 2.

## Approved plugin capture under the retained MCP owner — 2026-10-30

The destination MCP plan now discloses `pluginCapture` separately before
operator approval. Under that exact journaled grant, the target MCP projection
captures the native host-plugin witness at the actual plugin load that supplies
its configuration. The retained owner rechecks that witness with the destination
candidate and MCP binding; the owner-bound tool inputs retain the exact witness.
Plugin cache/auth/parsed-skill-cache drift makes validation fail, while cleanup
refuses an active witness borrower before recording shutdown. These observations
are point-in-time, and plugin and skill files on disk are not yet certified.

Schema/export 25 preserves the disclosure and refuses downgraded records or
rehash-relabelled exports; schema 24 migrates without gaining the effect. The
native app-server check and rebuild passed. The focused native owner regression
passed, including an actual plugin cache invalidation followed by safe cleanup.
Eight isolated app-server cases passed with the new disclosure asserted at
approval, including catalog and required-server drift and MCP shutdown; nine
related legacy and recovery cases also passed. The
control/host suite passed 188 cases, and a further 52 migration/archive cases
passed. The first host suite used sandboxed sockets and had seven permission
failures plus four expected-version assertions; after running the isolated
sockets with appropriate permissions and updating those assertions, it passed.
The old app-server and generated build objects were checksum-verified in archives
to make space; helper binaries were restored.

The patch reconstructs source tree `48a234f067dc8b9386c238c3d31518724c35f3c6`,
and the tested app-server SHA-256 is
`140dd665d0149cd4619167ebb9bf3714518343a7c9f9c31836a18ddd822afe97`.
This is not a complete tool router, plugin/skill file freshness proof, physical
resource release, placement, receiver handoff, competing-writer isolation or
full Gate 2 acceptance.

## Plugin skill-cache mutation observation — 2026-10-30

The native plugin witness now retains a mutation token for the concrete parsed
plugin skill cache owned by its exact loaded cache entry. Every insertion replaces
the token under the same lock as the cache update. A retained witness therefore
refuses any insertion, including an equal replacement or change and restore; it
does not rely on a wrapping generation counter or an opaque callback. A fresh
witness can observe the updated cache. This observes in-process cache mutation,
not file-system changes or a future-use reservation.

Three focused plugin witness tests passed, and three existing cache eviction,
invalidation and configuration-reuse tests passed. The initial test compile
failed because four existing test call sites used the old constructor; the
interface was corrected and the retry passed. The native app-server has not
been rebuilt with this change. The witness remains unwired to destination grant
and tool preparation; skill and plugin filesystem freshness, production handoff,
recovery, incompatible writers, and full acceptance remain open.

## Native plugin cache witness — 2026-10-30

A native witness can now bind an already-loaded plugin outcome to the exact
manager, auth-cache observation and cache-entry allocation. It refuses a missing
cache, an altered outcome, a foreign manager, disabled/enabled changes, auth
drift, cleared entries and replacement entries even when the data compares
equal. Disabled plugins have an explicit empty witness. Capture and revalidation
perform native installed-root filesystem checks and LRU updates; a future caller
must disclose and authorize those effects. Two focused native plugin tests pass.

The witness does not load or refresh plugins, establish plugin file integrity,
prove skill freshness or reserve against later changes. Plugin skill snapshot
handles are mutable and do not establish freshness. No destination grant, router
or app-server rebuild is wired to this witness yet. The first test attempt ran
out of disk before executing tests; older generated objects and duplicate
libraries were checksum-verified and archived before the successful retry. The
previously tested core test binary was similarly archived with SHA-256
`a619bced6b34bb0f7518a5687406b5526087ecf6d12de4355ad3563e3d74875f`.
Gate 2 remains open for complete destination authority and acceptance.

## Owner-bound target tool inputs — 2026-10-30

The native owner now collects an exact retained destination candidate, target
model and provider capabilities, target-constrained web-search mode, and the
approved MCP binding as one borrowed input set. Revalidation checks the same
owner, reservation, candidate, provider and MCP witness as well as the copied
target data. Provider cleanup now refuses a borrowed resource before writing
cleanup intent, so the same cleanup can proceed once its borrower releases it.

The core library check passed. A focused native regression passed for the
actual retained provider and MCP binding, foreign owners, stale reservations,
and cleanup/shutdown refusal while borrowed followed by successful release. A
second native regression passed for borrowed provider cleanup. The first test
link failed for lack of disk space; 144 older generated objects were archived
and checksum-verified before the successful retry. The source was formatted
after that test; the app-server remains the previously tested binary and was
not rebuilt for this change.

These are point-in-time inputs, not a complete tool router or execution grant.
Destination plugin and skill loading require separately disclosed effects and
freshness, and production commit, recovery, receiver handoff, competing-writer
isolation and full acceptance remain necessary. Gate 2 remains open.

## Target model inputs for tool preparation — 2026-10-30

The native retained provider can now return copied target model metadata and
its actual native provider capabilities after revalidating the source, target
definition, auth observations and model context. Unknown provider implementations
remain refused. This does not expose provider handles or interfere with
unpublished cleanup. A focused provider test verifies different source and
target web-access capabilities, target catalog selection, changed-definition
refusal and cleanup. The initial test failed because its fixture supplied the
target as the source definition; the corrected test passed.

This is an input primitive only: it is not yet connected to owner-bound tool
assembly and provides neither a future-use reservation nor destination authority.
The app-server binary remains from the previous source tree; it has not been
rebuilt or tested with this addition. MCP, plugins and skills, commit, recovery,
receiver handoff and competing writers still require their existing acceptance
evidence. Gate 2 remains open.

## Approved destination MCP binding capture — 2026-10-30

The opted-in destination path now asks for `bindingCapture` in the MCP plan
before operator approval. Under that exact journaled grant and retained native
owner, it materializes one target MCP binding, retains the actual binding and
catalog witness, and rechecks it during destination candidate validation. A
catalog-change notification invalidates the candidate and keeps the fence held.
Tracked MCP shutdown drops the retained binding only after its stop intent is
journaled and refuses a concurrent borrower. Capture can reconnect servers and
request or refresh catalogs; these effects are disclosed before approval.

The first staged run passed two required-server cases and failed four cases
because optional startup could settle during the first binding capture, leaving
no before/after catalog witness. The corrected worker permits at most one further
capture in that same approved operation, only after startup is stable and the
owner, provider and destination are revalidated. Six staged native cases then
passed, including a real catalog-change notification and shutdown after capture;
eleven related cleanup, recovery and legacy-startup cases passed. The native
app-server build and dependency check passed. Schema/export 24 preserves the new
disclosure and rejects downgraded state/exports; schema 23 remains readable on
upgrade, but older software cannot open the upgraded database. The exported
patch passed forward/reverse and whitespace checks, reconstructing native tree
`2778013b6f3667dc96e533c7777d03fe7dd33191`; the app-server SHA-256 is
`bdefb21727bb425acbb641476ad637427213d978ab8c4ca33b035d5e2b9dda7e`.

The binding witness observes native catalog state at a point in time. It does
not prove unreported remote changes, complete tool/plugin/skill authority,
physical and orphan cleanup, atomic publication, placement or exact receiver
handoff. Production wiring, writer isolation and both-runtime acceptance remain
open; Gate 2 is not closed.

## Native cached MCP binding observation — 2026-10-30

Added a native observation of an already materialized, still-retained MCP
binding and its actual publication and stable catalog revisions. It refuses a
missing or busy cache and rechecks the exact publication and catalog state;
it does not capture a new binding, reconnect a server, refresh tools, reserve
future use or certify executable destination authority. The observation is not
yet integrated into destination tool preparation: native binding materialization
can reconnect servers and needs its own approved, journaled effect boundary.

The focused native test covers missing and busy cache, a real catalog refresh,
exact binding identity and publication replacement. The full MCP library suite
passed 282 tests, and the current app-server dependency check passed. The first
suite lacked its CLI fixture; the next run hit the short CLI probe timeout; after
a direct probe of the checksum-verified archived CLI, the isolated case and
unchanged full suite passed. The staged app-server executable was not rebuilt.
The patch passed forward/reverse and whitespace checks, reconstructing tree
`ac1357e379879b0c2d33f42a42c7da36f9c05fc0`. Complete destination tool authority,
physical and orphan cleanup, placement, receiver handoff, production wiring,
writer isolation and both-runtime acceptance remain open.

## Native provider and authentication checks — 2026-10-30

The focused native provider test now passes for a destination-specific auth
owner changing after construction and for source-auth change-and-restore. The
native auth reload test also passes for pending, interrupted and completed no-op
reloads. The first reload attempts were interrupted before the volume filled;
the successful retry used the completed dependencies and additional free space.
The 185 older generated library variants removed from the build directory were
first compressed with per-file SHA-256 verification and restorable manifests in
`.native-runtimes/codex-build-artifact-archive/stale-rlibs-20261030{,-2}`.

A new core regression holds the actual constructed target provider lock, requires
candidate validation to refuse without waiting, then releases it and rechecks
validation and continued reservation. Its focused native core test passed
on the default stack. The patch reconstructs tree
`2d52c9e93293919dba0300efe51cfa7f4df0922e` with forward/reverse and whitespace
checks. The previously verified app-server is from tree
`671b278fa1bc174c00f75629f996a300ec61bdbf`; the difference is test-only.
Complete destination authority, physical and orphan cleanup, placement, receiver
handoff, production wiring, writer isolation and both-runtime acceptance remain
open.

## Current Codex daemon writer compatibility — 2026-10-30

A read-only process and open-file inspection found an installed 0.166 app-server
using the ordinary Codex state directory. This is point-in-time evidence, not a
process census or proof that it owns a particular thread. It was not interrupted.
In isolated synthetic homes, 0.166 refused a second 0.166 writer until the first
fixture process exited; both 0.166 → Desktop 0.135 and Desktop 0.135 → 0.166
allowed the second process to resume the same thread, change cwd and finish a
fixture turn while the first stdio fence remained unaware. The separate 0.166
settings case preserved the tested thread/governance fields and observed the
destination instruction. These measurements do not establish production owner
or complete authority. The pinned 0.166 executable SHA-256 is
`39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1`.

The first mixed-version run completed the behavior probe but failed fixture
cleanup while a background plugin clone was still creating files. The leftover
synthetic directory was removed after checking for open files. The fixture now
disables plugins, redirects HTTP(S) Git clones to a nonexistent local path, and
uses bounded removal retries. All three writer pairings and the 0.166 settings
case then passed with version-specific assertions enabled. This configuration
is not a network sandbox. The normal Desktop launch path and existing processes
still need a verified application-level isolation boundary; Gate 2 remains open.

## Recovery after successful native effects and failed receipt writes — 2026-10-30

When construction, unpublished-provider cleanup or tracked MCP shutdown returns
success but its host journal receipt cannot be written, the live native control
now restores an observation state bound to the exact retained receipt, reservation
and grant. Same-owner observation can complete the journal without repeating the
native effect. Forged receipt and reservation tests refuse that restoration. If
restoring observation itself fails, the control channel closes, retaining the
existing quarantine boundary. This is not recovery of a dead owner or proof of
physical MCP cleanup.

The affected host and broker suites passed 169 tests. Four staged construction
cases and four staged cleanup/shutdown cases passed against the native server,
including three injected receipt-write failures and lost-reply controls. The
first construction run had one fixture failure: its request counter was not
enabled for the new case; the corrected four-case rerun passed. Native placement,
complete destination authority, physical and orphan cleanup, receiver handoff,
production wiring, writer isolation and both-runtime acceptance remain open.

## Recovery after an uncertainty journal write failure — 2026-10-30

A native resource effect can have started even when the following journal write
fails. Same-live-owner observation now accepts the durable `dispatching` state
as well as `uncertain`, records the exact observed resource as uncertain before
broker settlement, and never repeats construction. This does not recover a dead
native owner, clear the resource hold, or establish physical cleanup.

A host-level regression simulates failure of the uncertainty write after a lost
construction reply and confirms observation, broker quarantine and one native
effect. The dispatcher and journal suites passed 21 tests. Two staged native
MCP cases also passed, including the same injected journal-write failure against
a real retained native owner and the existing lost-reply control. The focused
Rust provider authentication test was attempted but stopped before completion
when free disk fell below 300 MiB; only outputs from that interrupted build were
removed. Full destination authority, orphan cleanup, placement, receiver handoff,
production wiring, writer isolation and both-runtime acceptance remain open.

## Retained destination provider revalidation — 2026-10-30

Retained destination validation now checks the exact constructed provider's
native auth, provider definition and model context/catalog observations before
and after the asynchronous MCP observation. It takes the provider lock without
waiting and refuses if the resource is borrowed or its observations differ. This
is point-in-time validation; it does not reserve later use or establish complete
destination authority.

Three staged native cases passed, including an approved target model-catalog
refresh, normal construction and a required MCP server exiting. Eleven related
native destination, cleanup and recovery cases passed. A target-only provider
change or held-lock negative has not been exercised in this composition, and the
focused Rust authentication tests remain unrun because of disk pressure. The
app-server linked after a disk-space failure and removal of generated compiler
intermediates. The exported patch passed forward/reverse and whitespace checks,
reconstructing tree `671b278fa1bc174c00f75629f996a300ec61bdbf`; the app-server
SHA-256 is `d34b1d3ecbad10063992b1d48584869d32af773d16dee0439c5ca99f9db14b70`.
Physical MCP and orphan cleanup, full destination authority, native placement,
receiver handoff, production wiring, writer isolation and both-runtime acceptance
remain open; Gate 2 is not closed.

## Required destination MCP connection revalidation — 2026-10-30

Retained destination revalidation now observes the exact published MCP runtime
and its already-ready required clients without starting or reconnecting them. It
rejects missing, cancelled, closed or replaced clients, a changed runtime
publication, and a changed native owner or MCP startup while observation was in
progress. This is a point-in-time check; it does not reserve a future request or
prove complete tools, remote work, physical cleanup or destination authority.

A staged required server was terminated after both destination owners were
constructed. The previous build still revalidated the candidate; the new build
refused and retained the fence. The healthy-required, failed-required-startup
and failed-optional controls also passed, as did nine related destination and
recovery cases. The build linked after reclaiming only compiler intermediates.
The exported patch reconstructs tree `f30cc4dd5292c9066639e90bbb832514ec5cf9b3`
and passed forward/reverse and whitespace checks; the app-server SHA-256 is
`636b58cb6a64b8040b867753e5535b792ad0e5b7df33263c7e9d46a2fa1608b2`.
Physical MCP and orphan cleanup, complete destination authority, placement,
receiver handoff, production wiring and both-runtime acceptance remain open.
The focused Rust authentication unit suite remains unrun due to disk space.

## Required destination MCP startup — 2026-10-30

A retained MCP runtime is now checked with Codex's ordinary required-server
startup validation before native construction is reported as complete. After
that wait, configuration, provider preparation and the retained destination are
revalidated again. A failed required server leaves its native journal and host
resource record uncertain and keeps the fence held; an optional failure retains
ordinary native behavior. The native required-server policy may accept cached
catalog readiness, so this is not complete live server, tool, credential or
physical-release proof.

A real staged fixture succeeded at the source and failed at the destination;
the prior app-server incorrectly reported MCP construction complete. With the
change, that regression passed, along with healthy-required and failed-optional
controls. Nine related native destination, cleanup, shutdown and fence-release
cases also passed. The app-server build passed; forward/reverse patch application
and whitespace checks reconstruct tree `787a18a667c5d3143208ff95d3e8b52285b48201`.
The app-server SHA-256 is
`b2c5ec4f8ec2560b90bf6a767e088d3026d7dd4092232c35036d0613f96d2eae`.
Full destination authority, physical MCP and orphan cleanup, placement,
receiver handoff, production wiring and both-runtime acceptance remain open.
The focused Rust authentication unit suite remains unrun due to disk space.

## One-owner Codex destination resource establishment — 2026-10-30

The internal host path now retains one destination candidate and native
reservation, obtains separate operator approvals, and establishes the target MCP
owner and provider/model context under one admission fence. It revalidates the
candidate before and after both effects and again after the callback. Native
candidate validation now accepts the exact retained constructed provider only
when its grant, receipt, target configuration and owned resource match; pending,
failed, cleaned-up and mismatched states still refuse. Candidate creation remains
restricted to the acquired phase.

Three staged native cases passed: both owners with model context, a factory-only
control, and instruction drift after construction, which kept the fence held. Six
existing native cleanup/shutdown/release cases and 159 host/broker tests also
passed. The first implementation accidentally changed candidate creation rather
than revalidation; the failing cases exposed it and the corrected build passed.
The patch reconstructs native tree `7b71032a525939a3e410c42cfca648c73726cdc8`
and passed forward/reverse and whitespace checks; the staged app-server SHA-256
is `b23628169c89b05f9d0088a19b8d2f89f8dc6e1121c896057450dbca5c02714d`.
This path does not certify full destination authority, release the retained MCP
owner, perform native placement, rebind the receiver, or enable production
movement. Physical cleanup, orphan recovery, placement and both-runtime
acceptance remain required. The focused Rust auth unit suite remains unrun due
to insufficient disk space.

## Native owner-close fence drain — 2026-10-30

Native owner-close listeners now remain installed until the admission fence has
finished its final guard and queue-drain decision. A targeted regression forced
an owner close after the cleanup callback returned but before fence release: the
previous code incorrectly drained queued work; the corrected code quarantines it.
The same window is covered for effect-free preparation abandonment.

Host and broker verification passed 158 tests with loopback access, and both
staged native provider-only release/MCP-held cases passed. The broker's release
check remains point-in-time; physical MCP cleanup, durable cross-process resource
recovery, complete destination authority, placement, receiver handoff, production
wiring and end-to-end acceptance remain open.

## Broker check for provider-only fence release — 2026-10-30

The provider-only abort path now obtains an authenticated, fresh broker check
for its exact settled cleanup before releasing the local admission fence. The
broker rejects the check if any other transition for the same agent holds the
conversation, a managed operation is unresolved, or a conflicting task still
owns execution. It also checks the current membership, claim, preview and exact
transition. This closes the gap where a matching cleanup alone could overlook a
separate broker hold. The check is a point-in-time observation, not a durable
broker lease or a physical-resource proof.

The host and broker suites passed 156 tests with loopback access; two staged
native cases passed, including refusal when the MCP broker hold remains and
continued source execution after a provider-only abort. A sandboxed broad run
initially failed to bind its local sockets and was rerun with the required access.
Physical MCP cleanup, orphan recovery, full destination authority, placement,
receiver handoff, production wiring and both-runtime acceptance remain open.

## Provider-only abort releases the Codex fence — 2026-10-30

The internal fenced resource owner can now release queued source work after an
explicit provider-only abort, but only after the same live native control port
confirms its exact unpublished owner was cleaned up, the durable cleanup journal
is settled, and the same broker reports the matching failed transition and
cleanup receipt. Outstanding requests, a different broker, stale receipts,
uncertainty or any retained MCP plan or owner prevent release. The native owner
completion is consumed once; this is an abort back to source, not a move.

Two staged native cases passed: provider-only cleanup released the fence and the
same source conversation completed a new turn; a live MCP owner caused the same
release request to remain quarantined. The related host suites passed 106 tests,
including mismatched broker, unsettled cleanup, changed connection and native
refusal. The focused native auth unit suite was retried but interrupted before
completion due to disk pressure. Its test-only build artifacts were archived in
`provider-trace/auth-unit-interrupted.tar.gz` after per-file checksum verification;
the staged app-server was restored from its verified archive. Full MCP physical
release, orphan recovery, destination authority, placement, exact receiver
handoff, production wiring and both-runtime acceptance remain open.

## Journaled Codex MCP shutdown — 2026-10-30

The internal resource journal now records the exact established MCP owner and
shutdown ID before the tracked native stop. It records the returned quiescence
receipt, and an uncertain reply is observed under the same live native owner
without a second stop request. The journal rejects altered owner bindings,
receipt substitution, phase regression and reused identifiers. A restarted or
otherwise lost owner cannot use the historical receipt as release authority.

Two staged native cases passed with a real local fixture process, including a
dropped shutdown reply; the fixture process exited, the MCP broker transition
remained established and the admission fence stayed held. Related host suites
passed 100 tests, including a killed-writer no-replay case. Quiescence still does not cover detached descendants, remote
servers, external work or orphan recovery; it cannot settle MCP cleanup, clear
the fence, or establish Gate 2 acceptance.

## Journaled Codex provider cleanup — 2026-10-30

The internal resource dispatcher now journals the exact established provider
owner and cleanup ID before native disposal, then persists the native receipt
before settling the broker hold. A lost native reply requires observation under
the same live owner and cannot repeat disposal. A lost broker settlement reply
replays only the durable settlement. Changed owner bindings, receipt substitution,
phase skips, and a successor replay after a killed writer are refused. A killed
writer can leave an unresolved intent; this path does not recover a dead native
owner or clear the admission fence.

Both staged native cases passed with a real fixture MCP owner: normal provider
cleanup and a deliberately lost native cleanup reply. The provider broker record
settles while the MCP owner and admission fence remain held. The related host
suites passed 98 tests, including the crash and lost-settlement cases. This is
unpublished provider-owner cleanup, not physical MCP cleanup, placement, receiver
handoff, production wiring, or full Gate 2 acceptance.

## Candidate-bound provider after MCP — 2026-10-30

Isolated the prior provider refusal to an unchanged native authentication reload:
its pending-change guard invalidated the retained provider observation even when
no applied credential changed. A completed reload now preserves that observation
only when native auth publication has not changed it; pending observations still
refuse, actual changes advance the revision, and interrupted reloads invalidate it.
A regression test covers the guard, but its Rust test run was interrupted when
the separate test dependency build exhausted available disk space.

A clean rebuilt app-server passed both staged native process cases: a retained
destination followed by an empty MCP owner and by a real fixture MCP server,
then approved provider construction. Both settle the two resource records and
keep the admission fence held. These are component tests, not movement acceptance.
The exported patch reconstructs source tree `8910354fcbb6ebfaa0bc74998953a3a42b97a3ea`
and passed forward/reverse application and whitespace checks; the clean app-server
SHA-256 is `8cd8a6874388b6c05745b917d325063e155e6e9b933b6ddc4f225876fca848e1`.
Older generated build artifacts were preserved as checksum-verified archives.
Physical resource release and orphan recovery, placement, exact receiver handoff,
production wiring, isolation coverage, and both-runtime acceptance remain open.

## Desktop runtime session isolation — verified

Reverified on 2026-11-05: the installed wrapper verifier passed its real
synthetic runtime session and point-in-time path checks, and the sandboxed
Desktop application completed a local-model chat turn with its application
database, native SQLite and rollout in the isolated home. The real-application
test still launches the executable directly, not through Launch Services. These
results do not exclude a normal or already-running Desktop writer and do not
close the Gate 2 isolation requirement. Logs are retained locally at
`/private/tmp/turnlink-desktop-isolation-current.log` and
`/private/tmp/turnlink-desktop-session-current.log`.

The installed 0.135 wrapper and preserved executable were verified with a
temporary home and local synthetic model. A real app-server turn completed, its
rollout and SQLite state appeared in the isolated home, the inherited shared
home trap remained unchanged, and its instruction trap did not reach the model.
This covers that runtime/session path only; full
Desktop application, managed configuration, and production preflight integration
remain unverified. Gate 2 remains open for those and the movement requirements.
Static inspection of the installed app bundle found a concrete parent-process
gap: Desktop resolves `CODEX_HOME` itself, creates an application SQLite path
under it, and the wrapped child cannot change that parent environment. The
verifier no longer reports full Desktop isolation. It also checks the current
real store paths for symlink aliases and nesting, including an explicitly set
SQLite home; fixture regressions pass. These path checks are point-in-time and
do not prevent future changes or establish exclusive writer ownership.
An application-level launcher now supplies both isolated Codex homes and an
isolated Electron user-data profile, including Chromium's early profile argument,
before macOS starts the app. A temporary
macOS application received all three variables through Launch Services; unit
tests also cover launch arguments and overlapping store refusal. The real Desktop
executable started directly under an IP-network-denied temporary sandbox and
created its Electron profile and application SQLite database at the isolated
paths without changing the shared-home trap. Two initial attempts denied its
local Unix singleton socket; after narrowing the network policy the test passed.
An intermediate assertion expected `codex.db`, but this environment created
`codex-dev.db`; the corrected test accepts either native filename. A full real
Desktop session through Launch Services has not been exercised, and normal or
already-running instances are not excluded. It is not wired into Gate 2 preflight.

## Opt-in Codex private proxy channel — staged launch verified

The proxy now owns a private inherited descriptor when explicitly enabled with
`AGENT_CHANNEL_CODEX_NATIVE_CONTROL=1`, a valid separate adapter credential,
and a Unix stdio app-server. It rejects an externally supplied descriptor flag,
closes the native owner on proxy shutdown, and keeps private responses out of
editor output. A real staged app-server initialized through the proxy, and
fixtures covered default-off behavior, malformed private replies and non-stdio
refusal. The broader proxy, task and native-control run passed 109 cases with
one separately gated native test skipped. This is channel ownership only: no
preparation or movement dispatcher is connected, and an ordinary unpatched
runtime does not implement the private descriptor. Gate 2 remains open.

## Effect-free Codex preparation and fence — verification in progress

The host can now acquire its admission fence before acquiring the native
reservation, retain it through candidate planning and approved resource
effects, and quarantine rather than release it when the resource callback ends.
This exposed a substantive remaining integration failure: with both plans
bound to one retained destination candidate, MCP construction and candidate
revalidation succeed, but the subsequent private native provider construction
is refused before its provider receipt is written. The broker retains the MCP
hold, the provider journal remains uncertain, and queued editor work stays
held. The earlier two-resource success did not retain a destination candidate
and therefore did not cover this case. The staged negative regression passed
after one separate fixture run failed during MCP startup; the underlying native
provider refusal is not fixed. The host ownership helper is not yet wired into
the production proxy and cannot release resource ownership.

Additional staged controls narrow the refusal: both owners construct after
abandonment and reacquisition when no destination candidate is retained; a
candidate-bound provider constructs when there is no MCP plan and also when
the MCP plan is retained but unstarted. After constructing even an empty MCP
owner, candidate-bound provider construction is refused, while candidate
revalidation itself still succeeds. Four staged control cases pass, including
the expected held-fence refusal. The exact failing native validation has not
yet been identified; these controls do not justify dropping the candidate or
weakening native validation.

The dispatcher also rejects an incompatible earlier resource owner before
publishing a second preview. A regression covers a different native process and
reservation, and the compatible two-resource staged case still passes.

The internal dispatcher now retries a lost pre-effect preview or grant response
using its original journaled broker command identity. It checks the host's
still-retained native plan and reservation before retry; native construction
continues to perform its own fresh authorization and owner checks. Two staged
native cases pass for those dropped replies. A third case dispatched the MCP
and provider owners under one reservation and fence after separate operator
approvals; both broker holds remained established. Its first run hit the broker
rate limit from fixture polling; the retry passed with slower operator polling
and the existing broker limit. The relevant host, journal, approval and fence
suites passed 90 cases. These results do not prove dead-owner recovery, physical
resource release, placement, receiver handoff, or production proxy dispatch.

An internal resource dispatcher now publishes the exact owner-bound plan,
waits for operator approval, records broker authorization and dispatch intent,
constructs through the native owner, and journals the receipt before broker
settlement. The exact settlement can be retried without repeating construction.
On a lost native reply, same-live-owner observation records the retained owner
as uncertain rather than claiming release. Three real staged app-server/local
broker cases pass: ordinary approved MCP construction, lost broker settlement,
and lost native construction reply; the actual fixture MCP process started only
once in each case. Editor work remained fenced. This dispatcher is not connected
to the production proxy, cannot recover a dead native owner, and provides no
physical cleanup, placement, or receiver release. Gate 2 remains open.

A private Codex resource coordination journal now binds the exact plan, task,
preview, transition, native receipt and broker settlement across process
restart. It records dispatch intent before an effect, refuses a repeated
dispatch admission, and retains uncertain native observations and their exact
broker settlement. A forced process kill left the dispatching record visible;
provider, MCP, identity-mismatch and uncertainty regressions pass. The journal
does not itself verify native observations or reconcile a dead owner. The new
internal dispatcher uses it, but is not connected to the production proxy. Its killed
writer lock is subject to the existing store-lock stale interval.

The resource approval observer now waits for an operator-approved, latest
preview of the exact owner-bound provider or MCP plan, checking the claimed
task before and after preview observation and stopping on fence cancellation.
It creates neither a broker grant nor a native effect; the later effect must
still obtain fresh broker authorization. Six broker-store cases and a real local
broker/staged MCP-owner case pass. The latter uses the existing native owner
fixture; the observer is not yet connected to the production dispatcher.

Destination preparation now composes candidate retention, MCP planning and
provider planning inside one native reservation and admission fence, with
candidate revalidation before and after the callback. Plans are owner-bound and
cannot be used as authority after the helper abandons the reservation. Four
staged app-server cases passed for normal abandonment, changed destination,
lost abandonment reply and changed-journal refusal; the host and fence suites
pass 71 cases. This data-only workflow is not a production dispatcher or proof
of resource readiness, physical cleanup, commit, or receiver handoff.

The native control owner now immediately invalidates and aborts the active
preparation fence when its channel closes or the broker disconnects, rather
than waiting for the callback's next native request. A real staged app-server
and local broker disconnect test confirms queued editor work stays held. The
host/fence/preparation suites pass 70 cases. The opt-in proxy now owns the
channel, but does not dispatch preparation or movement through it.

Current source adds same-live-owner observation of a completed abandonment
from the persisted released journal, allowing a lost reply to be reconciled
without replay. It does not establish successor-process recovery. The host and
fence suites passed 68 cases at that checkpoint, and the rebuilt native app-server passed 26 staged
process cases, including a lost reply and a changed-journal refusal. An initial
cold initialization timed out before a successful retry.
The preparation helper now reserves a bounded window for both a timed-out
abandonment and its observation. A delayed-reply regression and two staged
native recovery cases pass when the original fence and request deadlines match;
uncertain observation still quarantines queued work.
An invalidated admission fence is now quarantined even when it sent no editor
mutation. The current patch reconstructs tree
`bb70a236c9989a2f572ac4e1a646f771a870bbc6`, SHA-256
`bff380ab5dbfd75d1d049ef416ad93a86e05d73724eef6da6b552e646434f553`.
The tested app-server is archived at
`.native-runtimes/codex-build-artifact-archive/abandon-observation/codex-app-server.gz`,
SHA-256 `3c480c365a5366af00410bf7da4a54c01b5290e6f3c65dd8dae8c3b525ba42bc`.
The prior generated Core test library is preserved at
`.native-runtimes/codex-build-artifact-archive/previous-core-test-lib/libcodex_core-18d95c046496b55f.rlib.gz`,
SHA-256 `6fdf0140d03075cb3e8fce8a8ca9fc0f20de67cefcf1b6432a278c44e7eca67f`.

Native code now provides a private, owner- and reservation-bound abandonment
operation for a preparation and unstarted plans only when no resource effect
or movement is present. The host validates the exact receipt and does not infer
release from a lost reply. A preparation helper keeps the stdio admission fence
held until a receipt or same-owner observation; unresolved acquisition, release
or interruption quarantines it.
The helper is not yet wired into the proxy's movement flow. The
host, fence and helper suites passed 64 cases; the rebuilt native app-server
passed 23 staged process cases, including candidate and unstarted-plan
abandonment. The first cold process initialization timed out; its retry passed.
Focused cases also passed reacquisition after a native restart and confirmed
that a direct private native abandonment request is refused after MCP startup.
Direct Core abandonment regressions remain unrun: linking exhausted disk space,
and a retry was interrupted after an archived library proved active; the five
verified library files were restored. The preceding
exported patch reconstructed tree `936a0ac3c28c35cbcffa3261ffac3c1985f190c8`, SHA-256
`54f3ab9c69e0967d289c27bef4ee086223ced8d9795e0f43ae06cf2046c5ec4b`.
This operation does not release resource owners or authorize movement.
The tested app-server is preserved at
`.native-runtimes/codex-build-artifact-archive/abandon-unstarted-plans/codex-app-server.gz`
with SHA-256 `5d60cb2b7f089179af130c835747682ab7cd93390b6711904278ebf5c6f0670e`.
Two older execution-server libraries were checksum-verified and archived in
`.native-runtimes/codex-build-artifact-archive/older-exec-server` for build space.

## Codex receiver verification boundary

When a broker is configured with a native completion verifier, Codex receiver
release can no longer fall back to the unverified legacy path. The existing
verifier accepts only OpenCode proofs, so Codex remains held until a real Codex
completion verifier is implemented. A previously released, unverified Codex
hold is also treated as held when that verifier is enabled after restart.
Two broker regressions check fresh and restart cases, including held task pulls,
blocked outbound messages and queued inbound delivery; the receiver handoff and
task-dispatch suites passed 43 cases. Legacy handoff with no completion verifier
is still available for the explicitly staged simulated path and is not native
placement or Gate 2 acceptance. The related broker and Codex-control suites
also passed 64 cases. Production Codex verification, native commit,
receiver integration and resource release remain unfinished.

## Private retained destination candidate — integration in progress

Current work binds provider and MCP plans to the same retained native candidate,
rechecks that candidate before effects, and refuses adding a candidate after a
resource plan has already been created. Additional rechecks after asynchronous
resource validation pass a current app-server rebuild and 22 staged process
cases; they do not eliminate change-and-restore races. The preceding build passed
21 staged cases, including approved MCP startup with a bound candidate and refusal
before startup after instruction drift. A separately added provider-drift case
also passed. The direct Core regression against retagging a pre-existing plan,
the retained-candidate regression and seven assembly tests pass on the current
source tree `88ef0fa07053855d3e93e2cddca4816a7b2a8743`; the other process
results below apply to the preceding checkpoint.
The current tested app-server is preserved as
`.native-runtimes/codex-build-artifact-archive/candidate-recheck/codex-app-server.gz`
with SHA-256 `3320a62a01563a6d7b9e90438f4bac690cf10f8946298da0698a3e0d40dd047b`;
its generated cache copies were removed to recover disk space.
Generated test objects from the previous checkpoint are archived with verified
checksums in `.native-runtimes/codex-test-artifact-archive/retained-candidate/bound-plan-objects`.
The current tested Core executable is archived at
`.native-runtimes/codex-test-artifact-archive/retained-candidate/codex_core-bound-plans.gz`
with SHA-256 `5341d9c0b1c2a72b5e8f425f4646c34d56f67876ef563cd78a7d289f86513055`;
its generated cache copy was removed to recover disk space.
The rebuilt executable is preserved at
`.native-runtimes/codex-build-artifact-archive/candidate-plans/codex-app-server.gz`
with SHA-256 `83fcdbf6651e9d8956e0cc8eea56cc8f6aa53a34a8f48cd0e750d6a7d0a66825`.
Two older configuration libraries were archived with verified checksums in
`.native-runtimes/codex-build-artifact-archive/older-config` to free build space.

Native Core can retain one data-only destination candidate under the exact
owner and reservation, revalidate that same retained object after asynchronous
reads, and refuse the legacy cwd-only commit while the candidate is present.
It is exposed to the private host for retention and revalidation, but is not
consumed by a movement commit; it does not establish resource readiness,
receiver continuity or Gate 2 acceptance. The host wrapper rejects mismatched
reservation, destination and candidate ID, including a planning race; 47
host-control unit cases pass.

The preceding app-server dependency check passed with staging warnings. Its patch
reconstructed tree `6a53e0cc59b60ab48d72ead818cd1fd5a3445963` with SHA-256
`c6aff8d5218fbfdc385682345321061f627f7197c2c8dcd9a1e6a6eb4624840d`.
A new Core regression covers ownership, stale ID, input drift and legacy commit
refusal and passes on the default stack; seven destination-assembly tests also
pass on the default stack. An earlier version of the regression overflowed the
default test stack; boxing its legacy-commit future fixed that test failure.
The previous test executable is preserved compressed with SHA-256
`93f52449cb70aaca0d36a8df54530cfb33b935699181d2ecfd6af9d4d472df48`.
The default-stack tested executable is preserved at
`.native-runtimes/codex-test-artifact-archive/retained-candidate/codex_core-default-stack.gz`
with uncompressed SHA-256
`342f67319d55473110003c48ce24dc0d84353f5d05e7f0b06c957d82261c6e3b`.
The rebuilt app-server has SHA-256
`37ffee1a9fd9c10067ee46016530f207f017395873bbc53496727ab4d869c868`.
A real private-channel regression passed retention and revalidation, then
confirmed changed destination instructions were refused while the thread
remained at its source. It does not establish resource or movement readiness.
All 19 staged native cases passed against this rebuilt process, including the
escaped closed-pipe child case that keeps the broker hold when physical cleanup
is not proven.
The tested executable is preserved as a verified compressed archive at
`.native-runtimes/codex-build-artifact-archive/candidate-host/codex-app-server.gz`;
its generated cache copies were removed to restore disk headroom.
Generated test objects were individually archived and checksum-verified in
`.native-runtimes/codex-test-artifact-archive/retained-candidate/objects` to
make room for that rebuild.

## Declared provider environment drift

Native provider preparation now captures bounded, private digest observations
of its declared key/header inputs, GCP project/location variables, and the five
direct Bedrock auth/region variables. Existing
provider revalidation compares these observations, including before and after
factory construction; a changed observation refuses construction. Tests cover
changed and missing values, bounds and refusal at construction without mutating
the process environment. The model-provider library passed 144 cases, including
25 focused native cases. Five HTTP fixtures first failed to bind inside the
sandbox and passed with loopback access. The updated patch reconstructs tree
`0b9fb47593cb5b2b7800c88ef3851b0dc1cf8e5d` and passes strict forward/reverse
checks; its SHA-256 is
`d6235024ef44b66ad0e4b8188e4a10cdf1797340b56392b989bfcbf9677972a6`.

This detects values visible at the checks, not changes restored between reads,
undeclared AWS/SDK or helper inputs, credential freshness or physical cleanup.
The final app-server dependency check passed with staging warnings.
The app-server rebuild initially failed while linking because disk space ran
out. After preserving hash-verified compressed copies of two generated MCP
test executables and the older CLI executable, their build-cache copies were
removed; the previous app-server executable was also archived. The retry passed,
producing a 732,495,712-byte executable with SHA-256
`d40a5ab1511ca633fb2868824351f2cc8cb145129bd8062b46890f0a743217a2`.
All 18 staged native/broker cases passed against that executable, including the
escaped closed-pipe descendant hold case. The archived CLI and test binaries
can be restored from `.native-runtimes/codex-build-artifact-archive/cli-preserved.kFyEw6`
and `.native-runtimes/codex-test-artifact-archive/pre-rebuild.gU5ssE`.
These cases do not test a live environment change inside the app-server or
establish full Codex destination authority. Gate 2 remains open.

## MCP cleanup settlement remains held

A disposable local Docker probe used an existing Alpine image with no network,
no host mounts, a read-only filesystem and dropped capabilities. Inside it, a
child ran in a separate process group; after `docker kill`, the daemon reported
the container exited with status 137, and the probe container was removed. The
daemon reports Linux and cgroup v2, while this Codex runtime is macOS. This is
evidence only for that contained Linux fixture: it does not show that arbitrary
macOS-native MCP commands, remote servers, external work, aliases, or a trusted
restart-safe owner/verifier are covered. The existing broker hold remains.


The broker gateway refuses a caller-supplied MCP cleanup receipt unless an
explicitly configured trusted verifier independently returns the exact receipt.
It rechecks the receiver, grant and ownership after asynchronous verification;
disconnect, timeout, altered receipt or changed state leave the hold intact.
The reducer's receipt schema remains useful for storage, but shape and identity
alone are not native proof. Gateway tests cover matching, foreign and stale
proofs, and a real broker test exercises refusal and settlement using a synthetic
verifier. No production verifier or native physical-release receipt exists yet;
therefore the normal broker still refuses MCP cleanup settlement. Implementing
those native and host pieces remains required before this path can be enabled.
An exact verified-settlement retry now retrieves its durable command receipt
after receiver authentication, including after broker-store restart, without
repeating native verification or cleanup. A changed command under the same ID
is refused. The broker, storage and MCP suites passed 41 cases; an initial
sandboxed run could not bind loopback sockets and passed when rerun with the
required permissions.

A real staged Codex/broker regression now starts a target MCP server that
launches a detached child with both output pipes closed. Native tracked
quiescence succeeds while that child is still alive, demonstrating that process
group exit and pipe hangup do not prove physical cleanup. The same test submits
a matching fabricated cleanup receipt and confirms the normal broker refuses it
and retains the task hold. The synthetic child is terminated by fixture cleanup.
This rules out using the existing quiescence receipt as the trusted verifier's
physical-release proof; a containment or equivalent complete ownership mechanism
and crash recovery remain necessary.

## MCP stop authorization recheck

The Codex private host now rechecks the exact broker grant after provider and
MCP construction, provider cleanup, and provider/MCP recovery observation, as
well as after MCP quiescence, before accepting their results.
Revocation or a changed grant at either boundary closes the owner channel and
leaves the native operation held; the stop is not replayed. Regressions exercise
revocation after dispatch and after observation, and broker disconnect during
confirmation. The 44-case host suite passed; all 17 staged native integration
cases passed before the final additional closed-channel guard, which is covered
by the host regression. This does not establish physical resource release or
complete Gate 2.

## Current closure boundary — 2026-10-30

All remaining in-repository OpenCode full-destination items are implemented.
The production native placement and completion handlers are exercised through a
real isolated broker/native path with protected transport release, exact
executable-authority revalidation, successor takeover, exact receipt observation,
held receiver release, queued delivery and destination task dispatch. Negative
coverage proves that a missing transport-release record cannot commit placement
and that a grant naming a different placement receipt cannot dispatch native
completion. Movement remains explicitly default-off.

The current native artifact is 1,898,447 bytes with SHA-256
`43ce60c88e4d382260a8f3cc6b4690ce338b329f9fa6c07f77a93881e15852bf`.
It reconstructs source tree `4da53ed9039d55308c4a104fe736b5f193274683`
from upstream commit `d7d44a7e03a9a390a3b66d1da8bb59aa03b65f9e`.
Temporary-index forward application, strict whitespace validation, exact tree
comparison and reverse application to upstream tree
`0420fc066e3f06fdce2796ef1896a461cb9bbfa8` all passed.

The Desktop 0.135.0-alpha.1 launch wrapper selects distinct Codex and SQLite
homes. Full application and managed-configuration isolation remain unverified.
The preserved runtime hash, installed wrapper hash and real binary
launch into a synthetic shared-home trap all verify. Standalone 0.165.0 again
passes destination-instruction and same-version writer exclusion/owner-exit
probes.

That resolves only incompatible-writer exclusion. The earlier classification of
it as the sole Gate 2 blocker was wrong: `native/codex/manifest.json` still marks
complete destination construction and authority false. Provider credential
readiness, approved grant-bound resource establishment, complete cleanup and
orphan reconciliation, production commit/recovery, and exact receiver handoff
remain implementation work. Gate 2 remains open unless those Codex requirements
are completed or the gate's supported-runtime scope is explicitly changed.

## Broker-verified native completion release

An explicitly constructed broker can require a trusted native completion
verifier before it releases an OpenCode receiver. It checks the exact moved
transition, native receipt identity, destination and receiver hash; after the
asynchronous observation it rechecks the receiver, grant and enrollment before
persisting release and its completion identity. A verifier-required private
plugin RPC uses the plugin's own socket. A resumed plugin can observe an
already verified release and retry without repeating the move, including after
both broker and plugin restart; queued delivery remains recoverable. An
integrated test runs the real broker and native process with the destination
plugin owning the receiver socket. Other tests cover changed enrollment,
disconnect, queued delivery, and persistence failures before and after write.

The verifier is a trusted in-process broker dependency and is not configured by
the ordinary launcher. The legacy release method still exists when no verifier
is configured. If verification is enabled later, an earlier unverified release
is treated as held for delivery, sends and task pulls; it requires separate
reconciliation. Native completion does not prove complete destination authority
or resource readiness, and the placement/completion operations have no
production dispatcher. The control suite passed 504 tests before the final
control-fault fence check; 85 focused tests passed afterward. This path therefore
does not close Gate 2.

## Internal native quarantine completion

An internal native transaction validates the committed placement and installed
receiver-bound membership under the current owner and execution reservation,
then records completion and atomically removes the membership seal and
quarantine. The protected completion record survives process exit and does not
depend on the membership remaining unchanged afterward. Isolated tests cover
rollback, changed receipt, native owner exclusion, restart and completion by a
successor lease. This transaction does not itself establish authority, resource
readiness or broker-held receiver continuity and has no production dispatcher.
The private native channel and broker-bound host recovery can observe the
completed placement without reclaiming the removed quarantine; they check the
current Session, destination membership and exact held receiver. A real broker
and restarted native process exercise this path with fixture-created earlier
authority and transport evidence. Observation does not release the receiver.
The old per-Session archive and stage remain retained; later transitions now
use separate immutable records keyed by Session and transition. Native tests
complete three placements, preserve all three receipts and recover a later staged
transition across private-host restart and lease takeover. This is not yet a
production repeat-movement flow, and retention remains unbounded. The broker
must not release the receiver on this evidence alone. Verification passed 7,276
native core tests (43 skipped), 97 server tests (one skipped), both native
builds, all 35 workspace checks and 495 host control tests. The host suite
preceded final archive identity hardening and third-move assertions; 25 focused
host tests passed afterward. The patch reconstructs tree
`49ab00e216befa4212b6d0acb3cab5ad972f4a6f` with SHA-256
`6a3d0b6a430303f17215f047221d7d416ed9a25aef22b819e0351478f359c1f7`.
Gate 2 remains open.

## Broker-authorized committed placement observation

The successor bridge can read a committed native placement receipt using its
durable original-owner or recovered destination stage. Fresh broker grant and
held-receiver checks bracket native observation; changed receiver identity,
release, source acknowledgement, stage, workspace or receipt refuse the
result. Observation neither dispatches placement nor releases the receiver.
A real broker and native process exercise lost-acknowledgement recovery with
fixture-created earlier transport and detachment evidence. Additional native
server tests cover both stage journals before placement. Full authority,
resource reconciliation, production dispatch and both-runtime acceptance
remain open. A separate read-only broker authorization also permits recovery
after the transition has been recorded as moved, provided the exact receiver
remains held and the source acknowledgement remains present. A native-process
test observes the same receipt after settlement and a successor takeover. The
settlement receipt ID must match a deterministic digest of the native receipt
for this recovery observation;
the digest binds values but does not itself authenticate the native process or
provide permission to release. The control suite passed 486 tests before the
final digest and held-receiver checks; 72 focused tests passed afterward.

## Held destination candidate during plugin recovery

The destination plugin now creates a fenced Session state as soon as its own
receiver candidate is established. Recovery preserves that candidate while the
broker hold remains active and queues early deliveries until native location,
installed membership, moved transition and released hold are verified. A real
broker test simulates placement and settlement and checks recovery across the
periodic scan and subsequent message admission. Production placement dispatch,
authorization, physical resource reconciliation and both-runtime acceptance
remain open. The control suite passed 482 tests before the final form-change
handling; 45 focused receiver, control and task tests passed afterward.

## Native placement transaction primitives

An internal transaction engine now uses the actual database-bound native execution coordinator and
quarantine-preserving SQLite guards to couple the Session move, receiver-bound
membership installation, durable event and placement receipt. It restores the
protected connection binding after rollback. Tests cover hostile writes,
duplicate calls, failures before commit and after event persistence, and
successor observation after lost acknowledgement and process takeover. The
fixture uses an activation-issued native owner; real authority and broker-held
receiver proofs are not yet wired to invoke the engine. Post-placement source
inspection is limited to receipt-aware observation, and delivery remains held.
Movement event projectors and listeners receive independent copies, so one
consumer cannot rewrite the destination observed by another.

An internal receipt can now be created only inside the exact persisted native
move event's bus transaction, under the current native lease and quarantine
claim. The activation-issued capability still needs complete authority and
broker-held receiver proof before real dispatch. Observation rechecks the
Session, protection binding, event and projected message against
the source archive, seal, staged receiver and installed membership. Replacement
guards cover the receipt, archive, stage and seal; version-2 storage installs
the new archive and seal guards at startup. The earlier receipt-only fixture
assembled evidence after projection; the transaction tests above also exercise
a real quarantined placement. The isolated native server now
persists new events and refuses a sync marker when the requested history has
missing or unknown events. A live server test verifies persisted events after
restart and rejection of a prior non-persisted history. New fork and import
reservations are recorded on their persisted anchor event within the native
transaction; strict reads validate the anchor and reject overlaps. Older
reservations without that evidence still fail closed, and need a safe migration
or an explicit incomplete-history workflow.

The native durable event bus can run internal work before projection and after
event persistence in its transaction; failing the latter rolls back projection,
event and sequence without notifying listeners. A guarded Session protection
binding can be advanced inside a transaction and refreshed from the committed
Session after a rollback. The ordinary movement path does not call these
primitives. A placement transaction still needs an exact durable receipt,
quarantine-preserving membership installation, post-commit recovery and a
native readiness proof before receiver release or execution can be enabled.
In particular, removing the durable quarantine around the event projector
would let other projectors execute while its SQLite guards are absent; the
commit must preserve or narrowly authorize that fence throughout projection.

## Native well-known configuration observations

The OpenCode native configuration loader pins its well-known catalog entries,
selected credentials and resolved responses. Under the native reservation it
can re-read the live manifest and response without mutating the cache, compare
the actual resolved URL and headers before sending, and refuse stale catalog,
credential, response, outage or cached-fallback evidence. Credential-backed
substitutions are checked against the current selected native credential. Local
inputs are checked again after remote reads. These are bounded observations,
not remote locks, plugin execution proof or native placement and receiver
continuity. Managed preferences and other unsupported sources still fail
closed. Movement remains disabled.

## Native local configuration input observations

The OpenCode loader now records keyed, process-local observations of local
configuration file reads and the process environment and file substitutions it
actually consumes. Native preparation and its revalidation recheck those reads
and discovery topology; a detected mismatch remains invalid until a successful
reload. Unsupported credential-injected substitutions and managed preferences
fail closed. These are observational checks, not an atomic filesystem lock,
remote configuration verification or complete plugin authority. Resource
reconciliation, native placement and receiver continuity remain open.

## Native configuration ownership

The OpenCode configuration service and its test implementation now return
independent schema-preserving entries. A real configuration regression mutates
returned nested provider settings, permission rules and the outer array, then
verifies the loaded configuration and authority revision were unaffected.
Freshness of source files and environment, executable plugin state, native
resource reconciliation, placement and receiver continuity remain open.

## Native directory identity during preparation

OpenCode's staged native owner keeps source and destination directory
descriptors open across authority preparation and exposes an owner-bound
recheck. Cached Location graphs also retain their own directory identity in the
opt-in movement runtime, so preparation rejects a graph loaded before a same-path
replacement. This is not yet a placement transaction: graph content provenance,
child-file authority, remote and native resources, destination installation and
receiver continuity remain open. The mechanism fails closed where directory
identity is unavailable.

## Staged destination task dispatch

An explicitly enabled, launcher-inaccessible broker switch and separate adapter switches now exercise worktree task dispatch after a released receiver handoff. The broker requires the exact moved transition, approved preview, current task claim and destination scope; OpenCode and Codex persist and recheck the transition binding before native task processing. If verification fails after task preparation, a missing journal cannot be silently adopted. Isolated broker tests use a simulated movement settlement and cover both adapters through artifact/stop evidence, participant report and master acceptance, plus receiver-loss recovery behavior. These tests do not prove native movement or destination installation and do not close Gate 2. Complete destination authority, native placement, resource reconciliation and the real receiver integration remain required.

## Current execution

| Workstream | Current implementation | Acceptance still required |
| --- | --- | --- |
| Native continuity | OpenCode native ownership/fencing and owned destination preparation; Codex private owner/reservation, approved provider construction and unpublished-owner cleanup, with native immutable-rule provenance, retained MCP request fences and receipts verified | Complete authority, resource/permission census and cleanup/handoff, native commit/receiver continuity, OpenCode parity, full task/master and platform acceptance |
| Recovery operations | All six operations have durable broker intent/receipt handling; receiver-authenticated delivery pull/finish bridge and adapter wake policies passed native acceptance | Physical rollout and remaining cross-platform/IDE acceptance; Codex unknown native admissions remain refused |
| Storage capacity | Schema-19 verified history, per-kind cold metadata, credential audit and exact receipt lookup; operator RPC/CLI implemented; full bounded budgets and actual Windows acceptance passed | Production workload/lifecycle review and rollout; archive/index/hydration bounds remain finite |
| Dashboard/background alerts | Console/passive hints, durable attention journal, Windows identity setup and reviewable supervisor artifact generation implemented | OS registration/supervision, actual native notification delivery and remaining workflow/IDE acceptance |
| Deployment/platform | Development stays opt-in; actual Windows launcher/idle-delivery/ACL acceptance passed in an isolated temporary checkout | Full remaining platform gates, deployment review and real target acceptance |

## Binding implementation choices

- Existing session identity, project/global instructions, selected agent/model,
  native permissions and approvals remain authoritative.
- A broker delivery-retry scheduling receipt is distinct from native admission;
  native outcomes need the exact receiver/action/evidence binding. Codex unknown
  native admissions are observed, never blindly resent.
- Referenced receipt archives become required private storage. Reclamation
  preserves every original command UUID/fingerprint/result and never deletes
  unresolved state/evidence. Archive/index pressure remains visible and bounded.
- Gate 2 uses a native host-created ownership capability. The existing plugin
  RPC registry has no caller identity and cannot authenticate native ownership.
- Destination startup and ordinary `SessionMove.move` cannot simply run inside
  the current reservation: startup invalidates its own stable-authority guard,
  and ordinary movement waits for activity exclusion. The native movement
  service needs explicit owned preparation/commit phases.
- Native context assembly must be shared with normal execution. Caller-supplied
  hashes, path matching, selected model names or a partial tool catalogue do not
  establish complete destination authority or receiver continuity.

## Storage follow-through

Detailed contracts, limits and restoration: [history reclamation](control-history-reclamation.md).

Schema 17 now supports explicit verified reclamation of eligible old events,
settled notices, acknowledged alert events/receipts and terminal task text. The
operator-only `storage-reclaim-history EXPORT_UUID VERIFIED_SHA256 CUTOFF_MS`
command requires a Unix-millisecond cutoff at least 30 days old. It binds an
immutable verified export and exact retry receipt. Pending/unresolved graph
references stay live. Original task collaboration text hydrates exactly from
required archives; lifecycle fields, dependencies, artifact references and hold
generations remain present. Restart tests cover later uncertainty reinstating a
terminal hold and an exact matching stop clearing it.

Live event/notice/acknowledgement and stored-state byte quotas recover. Hydrated
state has a separate explicit bound; archive/index/disk budgets remain finite.
Bounded cold entity/tombstone lookup now recovers hot entity/evidence counts,
including full task/evidence/managed/audit test budgets.
An archive must never hide a late uncertainty hold, change managed cleanup
meaning, or drop retained artifact/notification receipt identity. Full gate 5
remains unfinished.

## Verification record

- Prior resumed baseline: 427 parent passes, three Windows-only skips; 24 browser
  passes, syntax/build checks. See [the checkpoint](migration-resume.md).
- Receipt repository/service integration: 125 focused tests passed.
- Independent receipt review: no actionable findings; nine initial repository/
  service tests passed independently. Five additional private-directory,
  cumulative-archive and corrupt/link restart cases subsequently passed, for
  fourteen repository/service cases total.
- Integrated parent run with Codex/OpenCode/native-TUI flags: 460 passed, three
  Windows-only skips, zero failures (463 total). Syntax checks, dashboard build
  and all 24 desktop-light/mobile-dark browser cases passed.
- The three skipped platform checks also ran on the documented Windows host:
  Windows 10 build 26100, Node 24.18.0, a fresh cross-compiled native launcher,
  isolated source/dependencies and temporary fixture state. All three passed:
  argument/stdout/exit preservation, authenticated V2 idle delivery and private
  atomic-file ACLs. A further 66 broker/effect/receipt-reclamation/dashboard
  cases passed on the same Windows snapshot, with zero skips or failures. Its
  source predates the later approval-preview/history additions. The SSH log
  retrieval wrapper had a PowerShell parameter typo after tests finished; the
  complete copied test output records all 66 passes and empty stderr. No
  production services or global configuration changed.
- Recovery review found a Codex finish-receipt ordering defect. Native acceptance
  now persists before finish; its process restart regression failed before the
  fix and passed afterward, with one native call and eventual finish/ack.
  The complete integrated run above includes this fix. Real isolated OpenCode
  2.1.3 acceptance covers queue/steer/paused, lost native response, approved retry
  and native permission preservation; Codex proxy acceptance also passed.
- Operator attention: twelve cases passed, including journal/restart dedup,
  uncertain submissions, readonly live status, bounded paginated reads,
  reconnect/outage episodes and authentication refusal. Native utility submission
  is not proof of OS delivery or human receipt; installation remains unfinished.
- Frozen native ownership/quarantine/destination-preparation patch: focused
  162/162, complete core 7,156 passed/43 skipped/zero failures (308 files), server
  85 passed/one skipped, SDK 14/14 and canonical checks 35/35; core build and
  pinned-base patch forward/reverse/whitespace checks passed. This establishes
  the bounded internal stage only. No public host capability, authorized native
  placement commit or destination receiver acknowledgement exists yet.
- Work continues on native owned commit, archived entity/tombstone storage and
  Windows notification setup. Full roadmap completion remains open.

## Approval preview follow-through

The dashboard now presents the exact proposed wake policy, action/requester,
master generation, policy revision and native admission/evidence binding before
approval. It distinguishes broker retry scheduling from native admission.
The regression failed on the missing wake policy, then passed; all 29 HTTP
cases and all 26 desktop/mobile browser cases passed. Changed wake policy or
recovery evidence refuses confirmation without sending a command. Browser
preview/cancel leaves the actual broker action awaiting approval.

History integration verification: 59 cases passed across history core/service,
notifications, receipt reclamation and dashboard HTTP. The real broker test
starts with a full one-event budget, refuses another command, reclaims the old
verified event, then accepts that same command. Operator authentication, strict
schema, 30-day retention, exact repeat/conflict and typed CLI refusal passed.
A wider 118-case repository/service/schema integration also passed. Further
adversarial tests and count archival remain in progress.


Actual Windows attention acceptance subsequently passed all 15 cases: twelve
cross-platform daemon lifecycle cases with a private compiled native fixture,
and three real PowerShell/COM shortcut identity cases. Fixtures use explicit
bounded readiness/completion phases, release gates and confirmed-dead writer
lease recovery; Windows forced termination is not a POSIX graceful signal.
No real desktop toast, Start-menu installation or supervisor registration ran.

A third history service case starts the actual broker after cold archival and
store closure. An enrolled matching receiver cannot obtain a new task grant
while late uncertainty holds its archived terminal task. An obsolete stop receipt
is refused; the current matching receipt releases that hold, then dispatch
succeeds. Original archived text and terminal status remain intact. All three
service/CLI cases passed.


Native ownership re-entry verification subsequently passed 7,157 core tests
(43 skipped, zero failures, 308 files), 163 focused cases, 85 server tests
(one skipped), and 35 canonical checks. This adds a private native owner
capability for reservation entry under quarantine; forged serialized owner data
cannot authorize it. Session-specific transport close settlement and acquisition
census are the next stage, still in progress. No placement commit or receiver
capability is inferred from this result.


## Reviewed storage and supervisor milestone

Schema-17 storage is frozen and independently reviewed: thirteen core history
cases plus three real service/CLI cases passed. Full task/evidence/managed/audit
budgets recover while preserving exact metadata, authentication and late hold
semantics. Per-kind cold limits and worst-case 32-entry diagnostics stay visible.
Review found one Important integration defect: effect authorization used the
standalone state limit on an expanded repository snapshot. A real verified
4096-cold + one-hot fixture failed before the fix; trusted executor validation
now opts into repository expansion. Wake-policy execution and settled retry
grants pass, while the standalone reducer still refuses expanded input.
Forty-one focused integration cases and the full combined suite passed afterward.
No second review was substituted for the regression and suite.

Final combined parent run: **483 passed, six Windows-only skipped, zero failures
(489 total)** with Codex/OpenCode/native-TUI integration flags. Syntax checks,
dashboard build and all **26** desktop/mobile browser cases passed. Windows
schema-17 source acceptance is running from a separate digest-verified snapshot.

Supervisor generation passed five cases on macOS (including native `plutil`)
and five on Windows (including in-memory Task Scheduler COM parsing without
registration). It renders only; no installation, startup or toast occurred.
[Reviewable artifacts and lifecycle commands](operator-attention-supervisors.md)
keep actual OS delivery and deployment acceptance explicit.

Review ruling: native extension work stays outside this parent/storage review;
its separate native evidence and gate-2 prerequisites remain required. Cost if
wrong: a native integration defect would not be caught by parent fixture passes.
Review ruling: physical notification installation, supervisor registration and
human receipt remain deployment/manual acceptance. Cost if wrong: successful
utility submission or valid XML may still produce no visible desktop delivery.
Review ruling: finite archive/index/hydration quotas remain enforced; unlimited
retention is not promised. Cost if wrong: an unattended workload reaches a visible
refusal and needs reviewed capacity/lifecycle changes rather than silent deletion.


## Current verified checkpoint

The subsequent Windows run exposed an actual long-path ACL helper defect:
Node-created 290-character credential files could not be inspected through the
ordinary .NET path. The same ACL read succeeded with its extended Windows path.
The Windows helper call now uses Node's `toNamespacedPath`; policy checks are
unchanged. The regression failed first, then passed; a fresh process still
refuses a broad ACL on that long file. The original nested cold-dispatch fixture
now passes too.

After this fix, **483 parent tests passed, seven Windows-only skipped, zero
failures (490 total)** with all three native integration flags. **49/49 actual
Windows cases passed**: history 13, service 3, effects 11, ACL 2, attention 12,
shortcut setup 3 and supervisor 5. The source bundle digest and both Windows
path-fix overlay digests were verified. Logs were copied locally, all fixture
processes had exited, and the exact isolated Windows directory was removed.
No production services, editor profiles, accounts, runtime installations or
global settings changed. Syntax/whitespace checks passed; the unchanged
frontend's final build and 26 browser cases passed before this Windows-only fix.

The native kernel/storage stage separately passed 7,170 core tests (43 skipped,
zero failures, 309 files), 145 focused cases, 85 server tests (one skipped),
35 canonical checks and Core build, with pinned patch validation. Further
placement epoch/release hardening and true native host/authority/commit/receiver
work continues; that gate stays open.

Remaining independent work is now also examining exact Codex native continuity
contracts and isolated IDE acceptance. These investigations use installed-native
schemas and local fixtures, preserving actual accounts and editor profiles.

## Linux supervisor acceptance

Actual systemd 252.39 parsing in an isolated Debian 12 container exposed another
supervisor defect: executable-path dollars were doubled even though systemd
does not expand that path as an argument. Quotes and backslashes in executable
paths also produced invalid units. The renderer now preserves executable dollars
and refuses parser-unsupported executable paths. Both the contract test and the
native parser regression failed before the change and passed afterward; manual
and login-start units locate a real executable under spaces, dollars and percent
signs. Other arguments retain their separate escaping rules.

The final Linux run passed **22/22** attention/supervisor/history-service cases
with Node 24.22.1, including the opt-in actual parser test. External networking
was disconnected during testing, no host directories were mounted and no host
service was installed. Only the owned container and private source/config
directory were removed afterward. Logs remain in
`/tmp/turnlink-linux-acceptance-final.log` and
`/tmp/turnlink-linux-supervisor-red.log`. This does not establish a running user
manager, desktop notification delivery or human receipt. The parent verification
above predates these two added supervisor cases and the new IDE/Codex fixtures;
a final combined run will follow their implementation freeze.

## Current parent verification and manual-session path

The subsequent full combined run passed **488 tests, 11 explicitly skipped,
zero failures (499 total)** with Codex/OpenCode/native-TUI deterministic native
integration enabled. The skips are seven Windows-only cases, one opt-in Linux
parser case, two separately opt-in Codex continuity probes and the failed
experimental IDE automation. This run includes the Linux executable-path fix
and the four pure IDE-manifest cases. Log:
`/tmp/turnlink-development-current-final.log`. The Linux native parser and Windows
acceptance evidence above remain separate scope-matched results.

The user stopped automatic editor launches and clarified that verification can
use the already open session, or a clean session they open when needed. The
[manual-session workflow](ide-acceptance.md) supersedes repeated Electron UI
automation. The five old attempts did not complete acceptance; no surviving
fixture editor/native process remained after cleanup. No further automatic editor
launches are authorized by this plan.

Read-only local inspection found the preserved legacy broker on loopback 47321
(Node 22.5.1) and the configured V2 broker on 47323 (Node 24.21.0). The latter
accepted an authenticated protocol-2 operator connection; its `control_info`
request did not return usable capabilities. This proves the existing V2 endpoint
is reachable, not that the newly developed control features are deployed.
Neither running broker, its configuration nor existing session membership was
changed. Current-session acceptance must first identify the actual endpoint and
loaded adapter; default-port assumptions are insufficient.

[Codex native measurements](codex-native-continuity.md) cover three installed
runtimes and seven writer pairs. Ten explicit local-only native probe executions
passed their expected classifications; an old desktop writer bypasses newer
cooperative locks. These passes preserve production movement refusal. Native
owner-generation/preflight work is proceeding in a separate pinned source
checkout, independently of the OpenCode patch.

Separate installed Windows native acceptance subsequently passed both Codex
continuity probes with the extension's actual `0.162.0-alpha.17.2` binary and
Node 24.18.0. This verifies settings/instruction behavior and same-version writer
exclusion/forced-owner-exit release without opening an editor. Private native
home, AppData, SQLite and temporary paths prevent user-state fallback. Both Mac
standalone probes passed again with this environment isolation. The exact
remote source bundle was digest-verified; native child closures and temporary
cleanup completed before the isolated root was removed. Evidence and limits are
in [the native continuity record](codex-native-continuity.md). UI and full native
transition acceptance remain open.

The next frozen OpenCode authority snapshot passed canonical 35 checks, 85
server cases (one skip) and Core build, but its full Core run was **not green**:
7,175 passed, 43 skipped, two failed (7,220 total, 309 files). The periodic
plugin-refresh serialization and `.hg/branch` watcher cases are under focused
investigation. The earlier accepted 7,170-pass kernel snapshot remains separate;
none of the newer individual passes is a replacement for the failing full run.

## Manual fixture and expanded native parent verification

The editor-launch experiment has been removed. Its replacement is a runnable
loopback-only manual fixture, with private configuration, bounded metadata,
explicit phase/stop controls and exact-root cleanup. Ten runner/manifest cases
passed. An actual installed Codex 0.162-alpha process, through the real proxy and
generated MCP configuration, completed baseline → join → volunteer → role offer
and native admission → explicit acceptance → task claim → native result/evidence
and report → explicit master review. Thread, cwd, model, read-only sandbox and
approval policy were preserved; no editor or hosted provider was used.

The subsequent full parent run enabled all five native integration flags,
including the two installed-native continuity probes and the new manual-fixture
native flow: **497 passed, eight platform-specific skips, zero failures
(505 total)**. The skips are seven Windows cases and the opt-in Linux parser.
Syntax checks passed. Logs: `/tmp/turnlink-development-manual-final.log` and
`/tmp/turnlink-development-manual-check.log`. This is backend/native-process
acceptance; actual IDE presentation remains pending.

Independent review then found an Important fixture race: concurrent authenticated
phase requests could duplicate a wake/task/incident before its stored ID was
set. A fix and explicit concurrency/lost-reply regressions are in progress.
Review also identified the native fixture test's unbounded version probe and
late cleanup registration; these are being corrected. The passing parent run
above predates these review fixes, and no repeat review substitutes for their
regressions.

The user agreed to open the prepared private UI context themselves. No editor
was launched by the agent. The live fixture is reserved for initial UI/baseline
observation while phase controls are corrected; its model counter was zero at
handoff. Do not claim the already running process has hot-loaded later source
changes. Actual user observations and correlated IDs remain required.

## Existing-environment installation and reviewed-fixture verification

The user superseded the private-profile/manual-editor approach and explicitly
authorized installing the integration in this current test environment. No editor
was opened. Current-source development broker state is at
`/Users/example/.local/share/turnlink-development`, endpoint
`ws://127.0.0.1:47325`. Control effects and existing-cwd task dispatch are enabled;
managed worktree movement remains disabled. User Codex MCP configuration and the
existing VS Code executable setting were merged with private transactional backups.
The normal home, model, provider, permissions and existing hooks were preserved.
Actual broker control-storage, eight MCP tool definitions, and native 0.162-alpha
app-server initialization through the installed wrapper passed. Existing-window
activation and observed session/UI delivery remain pending. The earlier private
fixture opening instructions are superseded.

The Important fixture race fix now has passing concurrent and committed-response-
loss regressions for all four phases. Operations reserve a stable ID/payload and
member before awaiting, serialize/coalesce concurrent calls, and retry the same
uncertain operation. A changed member cannot retarget an uncertain wake. The
native-probe deadline and early cleanup regression also passed. The combined
fixture/manifest/real-native run passed **23/23** in 37.2 seconds, log
`/tmp/turnlink-fixture-review-final.log`.

The following combined parent run enabled all five native integration flags:
**509 passed, eight platform-specific skips, zero failures (517 total)** in
80.5 seconds. Syntax checks passed. Logs:
`/tmp/turnlink-development-installed-final.log` and
`/tmp/turnlink-development-installed-check.log`. These results supersede the
505-case pre-review run without claiming IDE observation or native movement.

Codex native source development was recovered from the ignored pinned checkout.
Its current receipt-path function did not compile because `AbsolutePathBuf` was
returned where `PathBuf` was declared; the native build reproduced error E0308.
The path now uses the native explicit `to_path_buf` conversion. Native queue
verification is in progress. A reviewable patch and reproduction instructions are
being exported under `native/codex`; patch applicability is distinct from test or
full continuity acceptance. Installed runtimes are not replaced by this source work.

The recovered native Codex build then compiled but its new exact-commit test
aborted on a default-stack overflow (SIGABRT), after two queue cases passed.
The identical cached commit case passed with a diagnostic 16-MiB test stack;
that diagnostic is not acceptance. The queued commit now boxes its large native
settings/persistence future, matching the surrounding native initialization
pattern. The default-stack five-case regression is rebuilding with
`RUST_MIN_STACK` explicitly removed. Logs:
`/tmp/turnlink-native-codex-current.log` (type failure),
`/tmp/turnlink-native-codex-queue-final.log` (stack failure),
`/tmp/turnlink-native-codex-stack-diagnostic.log` (diagnostic only), and
`/tmp/turnlink-native-codex-boxed-final.log` (current verification).

Native default-stack investigation: boxing the commit alone and then its storage
append did not resolve the failure. Temporary stage markers showed acquisition
and submission succeeded, with failure before the persisted completion reply.
The same cached commit passed with a diagnostic larger stack; that is not a fix.
Measured futures were only 43,312 bytes for commit and 1,856 for append, while
actual arm64 disassembly showed the general submission dispatch poll frame alone
allocates `0x100000 + 0xb80` stack bytes, in addition to the outer loop's
`0x3c000 + 0x9e0` frame. The existing native settings-checkpoint regression passed
on the default stack. The new private continuity operations now execute in a
small dispatcher before entering the general operation match, on the same native
queue and trace span. The ineffective append allocation was removed; temporary
diagnostics were removed. Default-stack verification is in
`/tmp/turnlink-native-codex-dispatch-final.log`. Earlier failed attempts remain
recorded; no larger-stack run is counted as acceptance.

The dedicated continuity dispatcher fixed the default-stack failure: **all five
native queue tests passed**, with `RUST_MIN_STACK` removed and temporary diagnostics
removed. This includes actual native cwd publication, preserved approval and
permission settings, a durable private receipt, exact retry, changed-payload
refusal, foreign host/stale generation/disconnect refusal and immediate human
interrupt. The native linker's existing oversized unwind-table warning remains
visible; it is not a test failure. The full native library run and a new regression
for completed transition-ID reuse follow before this milestone is considered
fully verified. This remains a core native-source milestone, not destination
preflight, receiver continuity or production movement acceptance.

The next real queue regression reproduced reuse of a completed transition UUID
for a different destination after an otherwise valid release/reacquisition. The
second commit actually succeeded before the fix, failing the new assertion in
`/tmp/turnlink-native-codex-transition-reuse-red.log`. Native commit now refuses
any transition UUID already in its bounded durable receipt history before
publishing settings or recording a submission. Exact current-operation retries
keep their original behavior. Source formatting completed without unrelated
file changes; upstream stable-rustfmt warnings about nightly-only import
configuration remain visible. The full native core library suite, including all
six continuity cases, is running with the default stack in
`/tmp/turnlink-native-codex-core-library-final.log`.

The obsolete private manual fixture had expired and its recorded PID no longer
existed. Exact device/inode identity and process-argument ancestry checks found
no remaining user/editor/native reference to that root. Only its unused 865-MiB
copied extension directory was removed to recover build space; fixture records,
original installed extension, current integration and active native build files
were preserved. The old root is explicitly marked obsolete. No editor was opened.

All **six native continuity queue regressions now pass on the default stack**,
including the completed-ID reuse case (RED→GREEN) and unchanged-cwd/releasable-hold
assertions after refusal. Log: `/tmp/turnlink-native-codex-six-default-final.log`.
The broad default-stack library run aborted in existing
`agent::control::residency::tests::interrupted_v2_agent_is_lost_after_residency_eviction`
before completing the suite. Inspection found an omitted upstream requirement:
the pinned `justfile` line 8 and Rust CI both set `RUST_MIN_STACK=8388608` (8 MiB).
The full core library suite is therefore rerunning with that exact documented
upstream setting in `/tmp/turnlink-native-codex-core-upstream-final.log`. The prior
16-MiB diagnostic is not acceptance, and the six-case default-stack pass remains
separate evidence. The general-dispatch stack reduction is retained because it
lets native continuity control work even under the smaller default stack; it is
not a claim that all upstream tests support that stack.

The upstream-stack full native core library run completed: **2,813 passed,
three failed, zero ignored (2,816 total)** in 92.47 seconds. Every continuity
case passed, including the default-stack-verified ID-reuse fix. The three failed
cases were `code_mode_host::tests::{grpc_stdio_host_exits_when_stdin_closes,
grpc_stdio_sessions_share_a_host_and_isolate_state,
hung_grpc_stdio_host_is_reaped_and_the_session_recovers}`. Each error explicitly
reports that `codex-code-mode-host` is absent at the native target's debug binary
path. The exact pinned-source companion is now being built with `cargo build
--locked -p codex-code-mode-host --bin codex-code-mode-host`; no installed or
version-mismatched binary is substituted. The full result remains red until the
prerequisite is present and verification passes. Build log:
`/tmp/turnlink-native-codex-code-mode-host-build.log`.

The first companion build failed because the default denoland V8 release does
not publish the required sandbox-enabled artifacts. The pinned Codex CI supplies
its own OpenAI-built pair; its setup action identifies the exact target and a
trusted manifest digest in the checked-out source. The native arm64 archive and
binding were downloaded from that exact `rusty-v8-v152.2.0` release and verified
through the pinned manifest digest `5cebc5830127b460ae8af23004430fd70b535bb22d599d68d024b60df08400d8`.
Archive SHA-256 is `feab9ae0384bebaa99c1d000654462c9d42123d587185c7876aaeef7d76ff749`;
binding SHA-256 is `b9d5652ebca515eb2bf4c2ee4a6551b2567117b5aa720f430d2032616dd7e3b5`.
The companion build is rerunning with the same command-local archive/binding
overrides as upstream CI, preserving the sandbox feature. No version substitution,
installed-runtime replacement or editor launch is involved. Log:
`/tmp/turnlink-native-codex-code-mode-host-verified-build.log`.

The exact native arm64 code-mode companion now builds successfully with the
verified sandbox-enabled V8 pair (42.45 seconds). The three previously failing
real-process host tests are running against that built binary. To recover disk
space after the companion build completed, only the two inactive `codex_core-*`
incremental compiler-cache directories were removed after checking no Core
compiler was active. Source, built libraries, test executable and companion were
preserved. This cache removal affects future incremental compilation speed,
not native state or installed runtimes. Host test log:
`/tmp/turnlink-native-codex-code-mode-host-tests-final.log`.

All three previously missing-companion cases passed against the exact built
native arm64 sandbox-enabled host, including actual process sharing/state
isolation, stdin-EOF closure, SIGSTOP detection/forced reap and session recovery
(51.51 seconds). No assertion or timeout changed. The full native core library
suite is now rerunning with upstream's documented 8-MiB stack and the real
companion present; log `/tmp/turnlink-native-codex-core-complete-final.log`.
The previous 2,813/3 result remains recorded until this complete run terminates.

The full native core library rerun is now **green: 2,816 passed, zero failed,
zero ignored**, 91.97 seconds, with the pinned project's documented 8-MiB stack
and exact source-built arm64 code-mode companion. All six continuity queue cases
also remain independently verified on the default stack. This closes the
recovered source's compile/queue/host-prerequisite verification checkpoint; it
does not close full destination authority, receiver handshake, native process
movement acceptance or production integration. The app-server's modified
connection-owner bridge is undergoing `cargo check --locked -p codex-app-server`
in `/tmp/turnlink-native-codex-app-server-check-final.log`.

The exported source patch was compared byte-for-byte with the tested worktree,
then passed forward application against an isolated index at the exact pinned
commit, reverse application against the current native source, and whitespace
checks. Manifest SHA-256 remains
`9e284339b610b5b7c6ae221eeddc03e93cd0382e02e843d304c3f0ec76abfd4d`.

The app-server bridge check also passed: `cargo check --locked -p codex-app-server`
completed successfully in 2m58s. The native checkpoint therefore has full core
library 2,816/2,816, six additional default-stack continuity cases, three actual
companion lifecycle cases, app-server type checking, pinned patch equivalence/
application checks and whitespace verification. The first six-case subset is
contained in the full library count; it is not added to that count. Native source
preparation of complete destination authority, exact receiver/release handshake,
Windows native journal acceptance, incompatible-writer migration/isolation and
production integration remain open. The overall development goal is active.

## Native destination preparation: global instruction reader

Inspection showed that the ordinary native app-server always supplies a global
instruction provider; rejecting all providers would reject the intended standard
host. The actual `CodexHomeUserInstructionsProvider` now has a read-only preview
using the same native file selection and normalization pipeline. It never writes
the applied-value cache or live warning deduplication state, and uncertain reads
refuse preparation even when a fallback file is readable. Native runtime loading
retains its previous cache/fallback/warning behavior.

Two new cache/warning/uncertainty tests failed first on the missing API, then the
whole home-reader library passed nine cases. A third actual boundary regression
then reproduced acceptance of 1,048,577 bytes. The bounded stream reader now
accepts 1,048,576 bytes and refuses the extra byte without truncation; typed I/O
causes remain available to preparation. All **10/10 home-reader library tests
passed**, including the seven existing cases. Logs:
`/tmp/turnlink-native-codex-home-preview-red.log`,
`/tmp/turnlink-native-codex-home-preview-green.log`,
`/tmp/turnlink-native-codex-home-budget-actual-red.log` and
`/tmp/turnlink-native-codex-home-preview-budget-final.log`.
An earlier budget invocation selected zero tests because it started before the
file update finished; it is explicitly excluded from verification.

Ruling: preparation reads have a 1-MiB per-file raw-byte budget — bound native
preparation memory while refusing oversized authority rather than silently
truncating it — cost if wrong: a legitimate larger global instructions file
needs a reviewed budget change before movement can be prepared. Existing runtime
loading is unchanged. Typed causes and a bounded stream handle file growth
without relying on an earlier metadata length check.

Native compilation used substantial space for additional Cargo feature variants.
After confirming no native compiler remained active, the task-owned incremental
cache was cleared, preserving source, compiled libraries, test executables and
companion; free space recovered to 11 GiB. Future cold incremental work may cost
additional compile time. No global/user cache or installed runtime was removed.

The new reader increment is exported as `native/codex/instruction-preview.patch`.
An isolated index applying the continuity baseline plus this increment exactly
matches the native worktree, and the new patch passes reverse/whitespace checks.
The earlier 2,816-case Core pass is the continuity baseline; it is not claimed
as full verification of this new preparation increment. Next implementation is
the concrete native provider-instance binding and detached project-instruction,
permission/model/tool authority plan, then commit-time revalidation and exact
receiver/release integration. The full goal and movement gates remain open.

## Native preparation provider-instance binding in progress

The next implementation binds the known native file reader to the same actual
`Arc` used for execution. A pre-start manager builder will install both references
from one concrete `CodexHomeUserInstructionsProvider`; the ordinary app-server
will use that builder. Generic instruction-provider interfaces remain unchanged.
Core's host-instruction preview will check pointer identity before invoking the
concrete read-only reader. Unknown user/thread callbacks and a foreign native
instance must refuse without callback execution. Three real native tests now
exercise root spawn input construction, fresh file/source observations, unknown
callback refusal and two distinct concrete homes. Their initial compile run is
pending in `/tmp/turnlink-native-codex-provider-binding-red.log`.

Ruling: use a concrete native reader binding rather than a new self-declared
read-only callback on arbitrary provider traits — preserve a standard host path
without invoking unknown code to obtain authority evidence — cost if wrong: Core
acquires a direct dependency on the native home-reader package, and other host
providers need an explicit native preparation contract. This does not enable a
movement grant or stand in for project/policy/model/tool authority preparation.

The provider binding's initial native compile failed on the three missing API/
field surfaces (five expected diagnostics). After implementation, all **three
binding tests passed**. The normal app-server now installs one concrete provider
for both ordinary execution and preparation; root spawn inputs retain that exact
instance. The host-only preview reads fresh native file data/source paths,
refuses an unrelated native instance, refuses unknown user/thread callbacks
without invoking them, and does not publish the project cache. Existing generic
provider interfaces are unchanged. The full Core plus home-reader library run
is now active in `/tmp/turnlink-native-codex-provider-combined-final.log`.

Three normal-library dead-code warnings remain because the host-only preview is
not yet consumed by the complete destination planner; they are not suppressed.
The staged preview and its data type are not a complete authority plan or grant.
Project instructions, complete policy/model/tool capture and receiver/release
integration remain required. The previous full Core checkpoint is historical
until the combined run terminates; no production movement is enabled.

The combined provider-binding snapshot passed the full libraries: **Core 2,819
passed and home reader 10 passed, zero failures**. The three binding regressions
are included in the Core count, not added again. The current app-server bootstrap
check and the additional default-stack continuity check are in
`/tmp/turnlink-native-codex-provider-app-server-check-final.log` and
`/tmp/turnlink-native-codex-provider-continuity-default-final.log`. The preparation
increment was re-exported relative to the unchanged continuity baseline; applying
both patches to the pinned source exactly matches the current worktree. Reverse
application and whitespace checks passed. This is host-instruction preparation
coverage, not a complete destination authority or receiver-release contract.

The updated app-server bootstrap check passed in 1m01s, and all six continuity
cases passed again on the default stack in the same source snapshot. Preparation
increment SHA-256 is
`74020e993fdc6d9e06d5a6c435cdae248bdb1ffd2d6a9bbc2eeb95ea1a8de199`.
No instruction-provider trait was extended with self-declared preview callbacks;
only the concrete native instance binding is accepted. Full destination
preparation and receiver/release integration remain open; the goal stays active.


## Detached repository instruction preparation in progress

The existing test-environment installation was rechecked without launching an
editor. The installed broker process and actual authenticated control-storage
request both responded. Disk pressure is critical (about 5 GiB free); native builds
remain sequential and only inactive task-owned build caches may be reclaimed.
The old manual fixture's “replaces the environment” meant process environment
variables, not project/system replacement; its separate-profile workflow remains
superseded by the user's existing-environment authorization.

Four new preparation regressions failed on the missing native preview and strict
reader surfaces (`/tmp/turnlink-native-project-preview-red.log` and
`/tmp/turnlink-native-project-preview-strict-red.log`). The implementation now
shares native repository discovery/assembly while using strict preparation I/O,
rejects empty or partially ready environment views, and leaves the source's
applied cache untouched. A fifth case checks that a starting environment's future
is never polled. Verification is pending in
`/tmp/turnlink-native-project-preview-green.log`; no passing claim yet.

Ruling: repository preparation streams complete files to EOF within a shared
1-MiB raw-byte budget before applying the existing effective document-prefix
limit — preserve native accepted text and refuse later I/O errors rather than
certifying an early prefix — cost if wrong: large legitimate project documents
require a reviewed preparation budget increase. Ordinary execution retains its
existing fallback, disappeared-file and truncation behavior. An error/drop is
not a physical resource-release receipt. Destination policy/model/tools, native
reservation binding, commit-time revalidation and receiver/release integration
remain open; no movement grant is enabled.

The preparation run passed **8/8 selected cases**: five new repository/environment
cases plus the three existing provider-binding cases. It accepted the exact raw
budget, refused the extra byte and aggregate exhaustion, preserved native prefix
text and destination provenance, kept the source cache's exact Arc, and refused
uncertain discovery/reads (including a later stream error) or incomplete views.
The starting-environment case recorded zero polls. Logs:
`/tmp/turnlink-native-project-preview-green.log`.

After confirming all native compilers had exited, inactive task-owned incremental
cache was cleared again: 5,445 MiB logical, about 4 GiB actual recovered, free disk
5.47 GiB. Built libraries/executables, source and installed integration remain.
The full combined Core/home library run is now in
`/tmp/turnlink-native-project-preview-combined-final.log`. Six normal-library
warnings remain because these preparation entry points await the full native
planner; the existing large-unwind linker warning remains. They are not suppressed.

The combined native library run passed **2,824/2,824 Core and 10/10 home-reader
tests**, zero failures. Five new cases are included in the Core count, not added
again. This uses the pinned upstream's documented 8-MiB suite stack and exact
sandbox-enabled code-mode companion. The additional default-stack continuity run
and current app-server check are the remaining verification for this source
snapshot. This is still instruction preparation, not complete movement authority.

The current source also passed the six default-stack continuity cases and
`cargo check --locked -p codex-app-server` (1m02s). The final increment is 43,953
bytes, SHA-256 `90f3060422803878bdf2279cd2615efdaea912b2d87c821dfb3bb38e2c1748b9`.
Reapplying baseline plus increment in an isolated index exactly matches the native
worktree, with no omitted untracked source; reverse/whitespace checks passed.
Logs: `/tmp/turnlink-native-project-preview-continuity-default-final.log` and
`/tmp/turnlink-native-project-preview-app-server-check-final.log`.
The existing-environment installation and manual handoff clarification remain in
place. No editor was opened, runtime executable replaced, commit made or movement
enabled. Next native work is reservation-bound destination config/environment and
complete permission/model/tool capture, then commit revalidation and exact
receiver/release integration. Remaining platform/live acceptance stays open.


## Native reservation-bound candidate inputs in progress

The previous goal turn made verified progress: detached repository instruction
preparation passed the combined Core/home libraries, default-stack continuity
cases and app-server check. The goal remains active; no complete-authority or
movement claim follows from that checkpoint.

Native candidate input capture now has five new tests written before production
implementation. They exercise the actual queue-acquired owner/generation/revision,
source configuration/provider handles, completed environment bindings, pending
startup refusal without polling, source-binding replacement, invalidation, and a
real destination-directory rename/replacement that preserves the pathname.
`/tmp/turnlink-native-candidate-inputs-red.log` found the missing API plus a fixture
Arc type error; that mixed failure is excluded as the clean RED checkpoint. The
fixture and an incorrect StepSettings pointer assumption were corrected: the native
settings validator legitimately clones step values. The corrected run is pending
in `/tmp/turnlink-native-candidate-inputs-corrected-red.log`.

Ruling: capture the actual native configured binding by observing only completed
Shared startup results, preserving the existing executor Arc/config ownership —
never poll startup or install Pending owner configuration just to make preparation
look ready — cost if wrong: an environment that has not completed ordinary native
initialization refuses preparation until that initialization occurs normally.
The source SessionConfiguration and native settings validator remain authoritative.
Candidate inputs are an internal prerequisite, not complete destination trust,
model/tool authority, a receiver acknowledgment, publication or a grant. Exact
source/destination directory handles will bind local Unix identity; other-platform
native durability and writer-compatibility gates remain open.

The corrected RED run terminated with only 15 missing-method diagnostics; no
fixture type error remained. Native implementation now captures owner/reservation
and source configuration under the state lock, shares the exact ordinary native
settings validator with commit, retains the same actual executor/provider handles,
and validates the source binding again after directory I/O. Directory handles
bind Unix device/inode identity; a destination's source-cwd shell snapshot/cache
is cleared rather than relabeled as destination evidence. The source-binding and
invalidation assertions were split into separate cases so either omitted check
cannot hide behind the other's failure. Six focused cases are building in
`/tmp/turnlink-native-candidate-inputs-green.log`; no pass is claimed yet.

Inspection also disproved the design note's “pure tool router” description:
`build_tool_router` writes live MCP handler/search caches. The note now requires
detached cache injection and captured executor inputs for tool preparation. This
changes the next implementation boundary; calling the live builder would not be a
read-only preparation step.

The first native implementation run terminated: one no-poll case passed, five
positive/candidate cases failed. It is not a green checkpoint. Inspection traced
the session failures to comparing normalized attachment configuration against raw
thread defaults: native `ThreadEnvironmentDefaults::for_selection` inserts the
selection's workspace roots (and local sandbox type). Candidate capture now uses
that exact native resolver for both source validation and destination projection;
the positive case also explicitly checks the destination attachment roots. The
environment fixture had populated only active turn bindings, leaving configured
bindings empty; it now follows native configured-update plus activation. Production
still refuses empty configured state. The normalized run is pending in
`/tmp/turnlink-native-candidate-inputs-normalized-green.log`.

The normalized run passed **6/6 candidate/environment cases**, log
`/tmp/turnlink-native-candidate-inputs-normalized-green.log`. No source setting or
journal phase was published; the exact provider/config/dynamic-tool handles and
selected step values were preserved. Source/destination attachment roots use the
native per-selection resolver. Foreign/stale/inactivated ownership, changed source
bindings at the same reservation revision, pending startup/configuration, and
same-path directory replacement refuse. The combined full-library run is active
in `/tmp/turnlink-native-candidate-inputs-combined-final.log`. Fourteen normal-library
dead-code warnings remain for unconsumed staged preparation APIs, plus the existing
large-unwind linker warning. Complete destination trust and policy/model/tool
capture, publication-time consumption and receiver/release are still outstanding.

The candidate-input snapshot passed the complete libraries: **Core 2,830/2,830
and home reader 10/10**, zero failures. The six new candidate/environment cases
are included in the Core total. The current default-stack run includes both the
six original queue cases and the six candidate/environment cases; app-server
compilation and final export checks remain before closing this checkpoint.

The final default-stack run passed **12/12** (six original native queue cases plus
six candidate/environment cases), and `cargo check --locked -p codex-app-server`
passed in 1m01s. Source formatting checks passed with the known stable-rustfmt
nightly-setting notices. Logs:
`/tmp/turnlink-native-candidate-inputs-continuity-default-final.log` and
`/tmp/turnlink-native-candidate-inputs-app-server-check-final.log`.
The exported increment is 71,979 bytes, SHA-256 `8c4f2e2e1b2dac7da65dea27b997b203904987d08446e759d33758bbb77aa521`.
An isolated pinned index applying the unchanged continuity baseline plus this
increment exactly reconstructs the native worktree, with no omitted untracked
source. Reverse and whitespace checks passed. No editor/runtime was launched or
replaced; no public continuity API, grant or managed movement was enabled.

Next authority work must resolve actual destination project trust/config inputs
without copying source trust, then bind actual model/tool/policy metadata and
complete publication-time revalidation, resource/release and receiver handshakes.
Inspection located the existing native Git trust resolver in
`git-utils/src/trust.rs`: it resolves linked worktrees to the main repository via
filesystem metadata (no git process), but returns Option and ignores some I/O
errors. Preparation must share its native semantics while distinguishing absence
from uncertain/oversized metadata; its ordinary runtime behavior must stay intact.
Tool assembly must use detached MCP/shared-definition/search caches and known
captured contributor inputs rather than invoke arbitrary contributors on live
state. The full goal remains active; platform/live acceptance is still open.

All native verification commands are terminal. With no cargo/rustc process active,
inactive task-owned incremental cache was reclaimed again to avoid leaving only
3.2 GiB free: 5,671 MiB logical removed,
4.23 GiB actual recovered, 7.43 GiB free.
Built libraries/test executables, companion, source, patches and installed
integration were preserved. A later compile may take longer; no global/user cache
was removed and broad disk pressure is not claimed resolved.


## Strict native Git trust-root preparation in progress

The previous goal turn made verified progress: reservation-bound native candidate
inputs passed all 2,830 Core and ten home-reader library tests, twelve additional
default-stack cases and app-server compilation. The full goal is still active.
Current pinned source and manifest were rechecked before this step.

Six new Core trust cases use the existing native Git trust filesystem fixtures.
They cover valid main/linked/nested roots and known absence, unreadable ancestry/
HEAD, metadata removed after discovery, exact 64-KiB acceptance plus growth beyond
a smaller metadata observation, a later stream error after a valid gitdir prefix,
and a foreign registered checkout. Existing ordinary resolver checks remain in
the same tests where fallback behavior matters. The initial compile is in
`/tmp/turnlink-native-trust-preview-red.log`; it currently reports the missing
strict preview API. The whole-file transport is unavailable in the growth fixture,
so preparation must use a bounded stream rather than rely on an earlier length.

Ruling: share one native trust-root parser for execution and preparation, retaining
ordinary execution's Option/fallback/older-executor whole-file transport while
preparation returns typed I/O/invalid-metadata errors and consumes bounded streams
to EOF — preserve linked-worktree/main-root and native path semantics without
certifying uncertain absence — cost if wrong: unsupported streaming or malformed
administrative metadata refuses preparation until resolved; runtime fallback is
unchanged. A trust-root observation is not project approval, config authority,
a resource-release receipt or a movement grant.

During the strict trust build, completed inactive Core incremental cache was
identified separately from every running compiler's open cache paths; the active
cache was preserved. All candidate cache session locks were obtained exclusively
without blocking and no working session was present before removing only
`codex_core-1aeqipdmdoyf2`. Recovered 0.53 GiB, leaving
3.46 GiB free. Compiled libraries/binaries and source were retained;
no live cache or unrelated user/system data was removed.

The initial strict-trust compile terminated with only the eight expected missing
API diagnostics. After implementing the shared native parser, all **6/6 new trust
cases passed** in `/tmp/turnlink-native-trust-preview-green.log`. The ordinary
entry points still return Option and ignore their historical recoverable errors;
preparation returns the original typed filesystem cause or InvalidData for
unresolvable links/oversized raw metadata. It uses full EOF observations bounded
to 64 KiB per metadata file without an unbounded-read fallback. Native main-root,
linked registration and exact canonical comparison logic is shared, not duplicated.

The valid nested fixture was additionally strengthened with an empty `.git`
directory without HEAD, which native discovery must traverse past rather than
mistake for unreadable authority. The full combined Core/home/Git-utils library
run is the next check; the six-case result above precedes that fixture addition.
Fourteen existing staging dead-code warnings and the known large-unwind linker
warning remain unsuppressed. This API still needs to be consumed by actual native
destination project/config trust preparation before it can support full authority.

The combined library binaries finished linking and began executing with about
1.4 GiB free. With no rustc process active, completed task-owned incremental
directories were reclaimed only after acquiring all their session locks
exclusively without blocking; working or locked directories were skipped.
Recovered 3.46 GiB, leaving 4.91 GiB free.
Running test binaries, compiled libraries, source, companion and installed runtime
were preserved; the same combined test handle continues, without a restart.

The combined current libraries passed **Core 2,836/2,836, Git-utils 46/46 and home
reader 10/10**, zero failures. The six new trust cases are included in Core; the
Git-utils suite's nested one-case child invocation is part of its 46-case parent
result and is not counted again. The strengthened empty-.git fixture passed in
this current snapshot. All **12 default-stack continuity/preparation cases** also
passed again. Current app-server compilation and final export verification are
pending; no complete destination trust or authority claim is made.
Logs: `/tmp/turnlink-native-trust-preview-combined-final.log` and
`/tmp/turnlink-native-trust-preview-continuity-default-final.log`.

The strict-trust source snapshot also passed current app-server compilation in
1m24s. Formatting checks passed with stable rustfmt's known nightly-setting
notices; no new warning suppression was added. The final increment is 96,659
bytes, SHA-256 `b789268fae49406d0ac9a0efcda250a3699bc59d8f20f805d063c9b4dfdc5a2c`. Applying the unchanged continuity baseline and this
increment to an isolated pinned index exactly matches the native worktree; no
untracked source is omitted, and reverse/whitespace checks passed.
Log: `/tmp/turnlink-native-trust-preview-app-server-check-final.log`.

Next implementation is actual destination project/config trust lookup using the
strict native root, captured/fresh native configuration provenance and reservation
revalidation; source project trust must not be copied to the destination. The
existing instruction preview then needs that correct destination view. Complete
model/tool/policy authority, publication-time consumption, source resources,
receiver/release, incompatible-writer exclusion and platform/live acceptance remain
open. The goal remains active. No editor/runtime was launched or replaced, no
commit was made, and no managed movement or public continuity capability enabled.

Final storage housekeeping found obsolete loose Core debug/codegen objects from
prior builds. With no cargo/rustc process active, `dsymutil --dump-debug-map` read
the current tested Core executable without warnings; all 256 referenced
objects were present and preserved. Only 1,280 same-test-target objects
absent from that map were removed (1.66 GiB logical).
The executable's inode/mtime/size stayed fixed across map capture. Completed,
unlocked task-owned incremental caches were also reclaimed. Current executable,
its debug objects, libraries, companion, source, patches and installed integration
were preserved; free disk is 6.13 GiB. Native source is unchanged
after verification. Broad host pressure is still not claimed resolved.


## Detached native destination project configuration in progress

Previous goal turn: verified progress, with strict trust-root preparation exported
and full libraries/default-stack/app-server checks passing. Current source and
manifest were inspected before continuing; no native verification handle was live.

Five new configuration tests failed first on the absent preview API (eight missing
function diagnostics). The first implementation compile exposed a native type
mismatch: credential-broker filtering consumed sourced requirements, while the
applied stack exposes their raw projection. A shared value-level helper now feeds
the same filtering logic from either representation, preserving network-disable
and feature requirements. All **5/5 focused config cases passed** in
`/tmp/turnlink-native-project-config-preview-values-green.log`. Logs also retain
the initial missing API and type failure in
`/tmp/turnlink-native-project-config-preview-red.log` and
`/tmp/turnlink-native-project-config-preview-green.log`.

The actual native loader now retains private discovery/trusted-broker inputs and
explicit project-config suppression. Preparation uses these applied inputs,
strict native root discovery, and the same project parser, sanitizer, path
resolution and linked-root hook projection as execution. It replaces source
project layers in a detached stack, resolves the destination's own trust, records
raw project-file presence/bytes, and can revalidate their provenance. It never
executes hooks, refreshes cloud/thread providers or publishes source caches.

Ruling: retain actual native loader-owned discovery inputs instead of replaying
already-merged layers — native credential remaps can discard fields needed for
project filtering — cost if wrong: snapshot memory and explicit refusal for an
unowned or globally changed layer stack until coherent native loading settles.
Discovery signatures are recomputed from actual config values and disabled state,
not accepted from mutable version labels. Runtime config equality stays about
config contents; preparation checks the separate native provenance explicitly.

Ruling: preparation has a 1-MiB aggregate raw budget for project configs and shared
root-hook configs, consumes streams through EOF and distinguishes known absence
from disappearance after discovery — bound new I/O while preserving native
accepted content and refusing uncertainty — cost if wrong: larger legitimate
configuration sets need a reviewed preparation budget increase. Ordinary loading
keeps its original transport, fallback and parsing behavior.

The focused cases additionally check that root-checkout hook declarations win
without creating a real hook sentinel. A stale-global-provenance assertion and a
Core I/O regression were then added for broader verification: ordinary loading
still skips an unreadable project directory, while preparation must return its
typed error. This snapshot remains in progress. Applied globals are preserved,
not forcibly refreshed; complete global/model/tool/policy authority, reservation-
bound consumption and receiver/release are still required.

The first broader config invocation did not reach tests: an added stale-source
assertion used a nonexistent helper name. It was corrected to the existing native
`with_user_config`; that compile is excluded from passing evidence.

Review found a real source-provenance gap: globals were checked, but changed or
thread-injected project layers could be silently replaced. A new regression
reproduced acceptance of a source project layer changed from the native loader's
111-byte document policy to 999 without changing the global inputs; it failed in
`/tmp/turnlink-native-project-config-source-provenance-red.log`. The native loader
now records the exact filesystem-produced project-layer values, disabled state
and hook folders before later thread-layer insertion. Preparation checks those
against actual source project content, recomputing hashes rather than trusting
version labels. Detached target output receives its own freshly produced project
signature. The complete config library is running in
`/tmp/turnlink-native-project-config-preview-provenance-library-final.log`.
Unknown or altered source project provenance refuses instead of being dropped.

The project-source-provenance regression passed after the native produced-layer
signature guard, and the complete configuration library passed **387/387**, zero
failures. This includes six new project configuration cases. The strengthened
stale-global assertion also passed. The combined current Core/config/Git-utils/home
libraries are now running in
`/tmp/turnlink-native-project-config-preview-combined-final.log`; the new Core
I/O case is not yet claimed passed. Applied global inputs are coherent native
snapshots, not a forced global-file/provider refresh or full authority grant.

The attempted four-package combined verification was intentionally interrupted
(exit 130), not timed out or treated as passing: selecting config's dev graph
with Core rebuilt another dependency feature set, reducing free disk to 1.3 GiB
before tests. Its exact cargo process group was identified and interrupted; all
compilers exited. The first interruption helper stopped before signaling because
it parsed a ps header; the corrected headerless identity check performed the
actual stop. No job was restarted on an observation timeout.

With all native builds terminal, only dependency artifacts/directories born during
that aborted feature build were removed, preserving known verified executables
and prior artifacts; completed unlocked incremental caches were reclaimed too.
Removed 7,088 new feature files (2.43 GiB logical) and
442 new feature directories; 5.51 GiB is free. Source and
installed integration are unchanged. Config's complete 387-case result remains
valid; Core/home/Git-utils will be checked separately on the established graph.
The aborted combined log is excluded from verification.

Core retry exited 101 before tests with ENOSPC while archiving normal Core. No passing evidence is attributed to it. Inactive incremental cleanup completed; additional stale loose objects were identified against current rlib member tables with no cargo/rustc active. Archives and every referenced object were preserved. Existing-environment installation remains the authorized UI test path; no editor is launched.

Resource recovery removed 8,960 obsolete loose objects (3.83 GiB logical) only after checking current rlib member tables and retaining every referenced object. An older test-binary debug-map cleanup refused because its map reported missing unrelated dependency objects; no deletion was made by that attempt. The established-graph retry compiled successfully and started all 2,837 Core tests in `/tmp/turnlink-native-project-config-preview-core-retry.log`. Completed unlocked incremental caches were reclaimed while active compilation was preserved. Formatting passed for all 28 changed/new Rust files. Temporary-index export reconstruction passed with the new module included; 147,201 bytes, SHA-256 `6772826e1859c9396952515e1df9be0a330d8211a849b8d6b03af990c9062f9a`. Export remains staged in /tmp until behavior checks finish.

The retry terminated successfully: **Core 2,837/2,837, Git-utils 46/46 and home 10/10**, zero failures; Core includes the new unreadable project-directory metadata case. Config 387/387 was verified separately on its existing dev graph. All **12 default-stack continuity/preparation cases** passed by invoking the same freshly built Core test binary directly with RUST_MIN_STACK unset. The nested one-case Git child is included in the parent 46 and is not counted again. Current app-server compilation uses the verified sandbox V8 archive/binding and is pending in `/tmp/turnlink-native-project-config-preview-app-server-final.log`.

Current app-server compilation passed in 1m29s with the verified sandbox-enabled V8 artifacts. The final exported increment is **147,201 bytes**, SHA-256 `6772826e1859c9396952515e1df9be0a330d8211a849b8d6b03af990c9062f9a`; the unchanged baseline plus increment exactly reconstruct the pinned native worktree using a temporary index, with no omitted untracked source, and reverse/whitespace checks passed. Manifest, reproduction notes and design now record this checkpoint. No editor was launched or restarted, no public movement capability enabled and no commit made. Next: consume the project preview in reservation-bound destination instruction preparation; complete fresh global/model/tool/policy authority, commit-time revalidation, source resources, receiver/release, incompatible-writer and platform/live acceptance remain required.

## Reservation-bound destination instruction integration in progress

Previous goal turn classified as progress: complete current libraries/default-stack/app-server verification and exact patch export. Revalidated terminal run marker and no cargo/rustc before new work. Task-owned archive member checks reclaimed 43,010 obsolete loose objects across 50 archives (3.67 GiB logical); every current archive member and archive identity was preserved. Four new integration cases target destination-specific document limits/fallback names, destination untrusted state, raw project-config/effective-document drift, and foreign/closed owners. The API is intentionally internal, carries actual candidate reservation ownership and does not publish source settings or live instruction cache. Full model/tool/policy/receiver authority remains required.

Ruling: use a private instruction-only Config projection populated from the native project preview and the source applied snapshot; share ordinary document settings normalization. Never publish that projection as an execution config — avoid copying source trust/document settings or triggering ConfigBuilder side effects during reservation preparation — cost if wrong: any future native instruction input must join the private projection and its regression coverage. Preparation and revalidation bracket I/O with actual candidate ownership/binding checks and compare fresh native project and instruction results.

The initial test compile found absent API methods and two mistaken `.join(...).unwrap()` fixture calls. The path calls were corrected; the repeated RED compile terminated with exactly 12 missing-method errors in `/tmp/turnlink-native-reserved-instructions-api-red.log`. The internal implementation now composes candidate capture, native destination config preview, shared document-setting normalization and detached AgentsMdManager preview, then revalidates actual reservation/directory/environment bindings, native project bytes and fresh instruction output. Focused verification is running in `/tmp/turnlink-native-reserved-instructions-green.log`.

The first implementation compile built normal Core successfully (17 unsuppressed staging warnings) but did not reach tests: the fixture attempted Display conversion on native AbsolutePathBuf. Corrected to an explicit native-path string conversion. That log is excluded from passing evidence; focused retry uses `/tmp/turnlink-native-reserved-instructions-fixture-green.log`.

All **4/4 focused reservation-bound instruction cases passed** after the fixture conversion fix. All **16 default-stack continuity/preparation cases passed**, including the four new integration cases, by invoking the newly built Core test binary with RUST_MIN_STACK unset. Full current Core/Git-utils/home libraries are running in `/tmp/turnlink-native-reserved-instructions-libraries-final.log`. Formatting and temporary-index reconstruction passed for the staged 160,898-byte increment, SHA-256 `bb9dd58165dad9a7bfa0cd869f1bc006237fccfd555c07c75ba300c1c9139b2c`; it is not yet substituted for the previous verified export.

The complete current native libraries passed: **Core 2,841/2,841, Git-utils 46/46 and home 10/10**, zero failures. Core includes the four new integration cases. The nested one-case Git child is part of its parent 46 and not counted again. All sixteen default-stack continuity cases also passed. The config library source is unchanged from its previous verified 387/387 checkpoint. Current app-server verification is pending in `/tmp/turnlink-native-reserved-instructions-app-server-final.log`.

Current app-server compilation passed in 58.66s using the verified sandbox-enabled V8 artifacts. Exported the tested increment: **160,898 bytes**, SHA-256 `bb9dd58165dad9a7bfa0cd869f1bc006237fccfd555c07c75ba300c1c9139b2c`. The unchanged baseline plus increment exactly reconstruct the pinned source with all new files included; forward temporary-index, reverse and whitespace checks passed. Manifest and reproduction/design notes record current evidence and boundaries. Seventeen normal-library staging dead-code warnings and the known linker unwind warning remain unsuppressed. No editor/runtime was launched or restarted, no public continuity RPC or movement capability enabled, no commit/push made. Next: complete native source/global/model/tool/policy authority and publication-time consumption, then source resources and exact receiver/release, incompatible-writer/platform/live acceptance. The goal remains active.

## Native model metadata preparation in progress

Previous goal turn classified as progress: reservation-bound destination instructions, 2,841 Core/46 Git-utils/10 home libraries, sixteen default-stack continuity cases, current app-server compilation and exact source export verified. Revalidated terminal marker/no cargo/rustc and 6.89 GiB free before this increment.

Inspection found that even OpenAiModelsManager in-memory metadata lookup invokes endpoint policy/identity callbacks. Ruling: use safe Any trait upcasting to inspect actual concrete native manager and endpoint instances, with no discovery callback or reconstruction; retain their real Arc identity and originator partition. Native preparation reads current cached metadata with a nonblocking catalog lock and known native cached auth/endpoint policy, shares ordinary selection/override helpers, and refuses unknown types without invoking them — avoid side-effectful generic provider/endpoint callbacks during preparation — cost if wrong: adding a supported native manager implementation needs an explicit concrete path and tests. No network/cache/auth refresh is used to make preparation appear ready.

Six new Core cases target actual session overrides/source model drift, static catalog binding/config drift, unknown manager/endpoint refusal without callbacks, bundled namespaced lookup, and live originator catalog capture/drift without refresh. A manager-library case targets nonblocking refusal while the real catalog lock is held. The explicit HTTP fixture warms the catalog during ordinary setup, before preparation. RED verification is running in `/tmp/turnlink-native-model-preparation-red.log`. Complete provider/tool/policy authority and publication/receiver integration remain required.

RED verification terminated with exactly the expected missing native preparation APIs: three model-manager diagnostics and fourteen Core diagnostics. The implementation now safely inspects concrete native types, binds actual manager identity/originator, takes a nonblocking detached catalog snapshot, and shares native catalog visibility, exact/prefix matching and metadata overrides. Native endpoint facts use cached native auth only, with strict identity errors; unknown callbacks are never invoked. Core binds the result to reservation/candidate directories and checks actual provider pointer, step settings and startup metadata overrides, including same-revision changes. Focused verification is running in `/tmp/turnlink-native-model-preparation-green.log`.

All **6/6 focused Core model metadata cases and the 1/1 model-manager lock case passed**, zero failures. All **22 default-stack continuity/preparation cases passed**, including the six new Core cases. No native auth/model/cache refresh is performed during capture; the native metadata fallback flag and exact/prefix semantics are preserved as observations, not certified provider readiness or complete authority. Formatting and temporary-index reconstruction passed for staged increment 191,935 bytes, SHA-256 `858dc1597488afe34cdfe5734a1976b9494894f76776463f3f5c91b031de271d`. Full current Core/models-manager/Git-utils/home verification is running in `/tmp/turnlink-native-model-preparation-libraries-final.log`.

The complete current libraries passed **Core 2,847/2,847, models manager 57/57, Git-utils 46/46 and home 10/10**, zero failures. All 22 default-stack continuity/preparation cases passed. The nested one-case Git subprocess is included in the parent 46 and is not counted again. The edited model-provider library is being built with the same Core/models-manager/Git-utils/home package selection using --no-run, then its exact cargo-reported test executable is run separately; this avoids repeating Core and avoids dropping the established feature selection. Logs: `/tmp/turnlink-native-model-provider-build-final.log` and `/tmp/turnlink-native-model-provider-library-final.log`. No current app-server success is claimed yet.

The complete edited model-provider library passed **119/119**, zero failures, in 7.85s after its 7.22s build on the established combined feature graph. Existing auth, originator partitioning, gateway identity/cache and catalog behavior remained green. Current app-server compilation is pending in `/tmp/turnlink-native-model-preparation-app-server-final.log` with the verified sandbox-enabled V8 artifacts.

Current app-server compilation passed in 1m10s using verified sandbox V8 artifacts. Exported the tested increment: **191,935 bytes**, SHA-256 `858dc1597488afe34cdfe5734a1976b9494894f76776463f3f5c91b031de271d`. The unchanged baseline plus increment exactly reconstruct the pinned native source, including both new project/model preparation modules; forward temporary-index, reverse and whitespace checks passed. Manifest, design and reproduction notes record this checkpoint. Nineteen normal-library staging dead-code warnings and the known linker unwind warning remain unsuppressed. No editor/runtime was launched or restarted, no public continuity RPC/movement grant enabled, and no commit/push made. Complete current global/provider readiness, destination permissions/tools, full plan publication consumption, source resource census, exact receiver/release, incompatible-writer exclusion and platform/live acceptance remain required. The goal remains active.

Final strict `git apply --cached --whitespace=error-all` checks passed for both exported patches. With all cargo/rustc jobs terminal, completed unlocked incremental caches were reclaimed. Ruling: remove the obsolete alternate-feature Core test executable `codex_core-cbf980aa4b87c144`, its own loose codegen objects/depinfo and exact fingerprint, after checking it is older than and inode-distinct from the current tested executable and not running — recover task-owned storage without invalidating shared dependencies — cost if that obsolete feature graph is requested again: Cargo rebuilds that test target. The current tested executable identity/mtime/size, current libraries, companion, source, installed integration and verified patches were preserved. Recovered 3.65 GiB logical; 7.27 GiB free.

## Detached native tool assembly in progress

Previous goal turn classified as progress: actual native model metadata observation, 2,847 Core/57 models-manager/119 model-provider/46 Git-utils/10 home libraries, 22 default-stack cases, current app-server compilation and exact export verified. Revalidated terminal marker/no cargo/rustc and 7.27 GiB free before this increment.

Native routing writes the live MCP handler cache, manager-wide weak definition index and tool-search cache and invokes arbitrary extension contributors. Ruling: inject explicit cache ownership into the single actual routing pipeline; ordinary execution keeps its live caches and callbacks, while preparation uses private caches and returns only effective declarations/routing data — share actual registration, exposure, collision and Code Mode logic without publishing cache state or retaining dispatch handles — cost if wrong: complete native contributor preview and reservation-bound context/permission/MCP capture remain necessary before the standard host can use this as full destination authority. Unsupported contributors explicitly refuse; they are never silently omitted.

Five regressions target actual loopback MCP binding parity/cache isolation/no additional requests, policy/dynamic/Code Mode equivalence, unknown contributor callback refusal, incomplete environments and native collision refusal. Test-only setup materializes real native MCP bindings before preparation using a private file-based OAuth store. The first compile found absent API plus two Arc<Vec> versus Arc<[T]> fixture assignments; these were corrected, and the native fully qualified collision expectation was normalized. The repeated RED run terminated with exactly eight missing API diagnostics in `/tmp/turnlink-native-tool-preparation-api-red.log`. The shared builder and data-only snapshot are now implemented; focused verification is running in `/tmp/turnlink-native-tool-preparation-green.log`. No native permission loading, model turn, extension preparation callback or runtime/editor launch is added to preparation.

All **5/5 focused tool preparation cases passed**, zero failures. The actual loopback native MCP fixtures materialized real bindings before preparation; source handler identities, manager-wide definition index and search handler identity remained unchanged, native output matched ordinary assembly, and neither server received additional requests. All **22 default-stack continuity/preparation cases plus the five distinct default-stack tool cases passed**. Formatting, exact source reconstruction and strict patch whitespace checks passed for staged increment 213,873 bytes, SHA-256 `8d221793cc72476e92b51dd2caf2570d2e7c287042a88bc40bbfe6e7d6ab1ce0`. Full current libraries are running in `/tmp/turnlink-native-tool-preparation-libraries-final.log`. The standard host still requires actual native contributor previews and reservation-bound destination configuration/permission/MCP capture; no complete tool authority claim is made.

Complete current libraries passed **Core 2,852/2,852, models manager 57/57, model provider 119/119, Git-utils 46/46 and home 10/10**, zero failures. Core includes all five new tool assembly cases; the nested one-case Git child is counted only in its parent 46. The existing config-library source remains unchanged from its separately verified 387-case checkpoint. Current app-server compilation is pending in `/tmp/turnlink-native-tool-preparation-app-server-final.log` with verified sandbox V8 artifacts. No complete standard-host contributor or destination permission authority is claimed.

Current app-server compilation passed in 1m09s using verified sandbox V8 artifacts. Exported the tested increment: **213,873 bytes**, SHA-256 `8d221793cc72476e92b51dd2caf2570d2e7c287042a88bc40bbfe6e7d6ab1ce0`. Baseline plus increment exactly reconstruct pinned source with both new modules included; strict whitespace, forward temporary-index and reverse checks passed. Manifest/design/reproduction notes record current scope. Twenty-four normal-library staging dead-code warnings and the known linker unwind warning remain unsuppressed. No editor/runtime was launched or restarted, no public continuity RPC/movement grant enabled and no commit/push made. Next: native contributor metadata previews and actual reservation-bound destination global/permission/MCP capture, then full-plan publication consumption, source resources, receiver/release, incompatible-writer and platform/live acceptance. The goal remains active.

After all verification jobs terminated, task-owned completed unlocked incremental caches were reclaimed. Current Core test debug-map cleanup preserved all 256 referenced objects and removed 1024 same-target obsolete objects (1.33 GiB logical). Current executable identity/mtime/size stayed unchanged. Free disk: 6.77 GiB. Libraries, companion, source, installed integration and patches are preserved.

## Native contributor metadata bridge in progress

Previous goal turn classified as progress: revalidated the existing test-environment installation, matching installed configuration hashes, live broker process and reachable broker endpoint. No second editor/profile was launched. The first small Node test command used the shell's unsupported Node 22.5.1 and failed on node:sqlite; repeating with installed Node 24.21.0 passed four plan cases with one explicitly disabled native case. This is not new UI acceptance.

Revalidated no cargo/rustc jobs and 9.71 GiB free. Two new Core regressions cover contributor-instance/order/cardinality binding and metadata parity without live callbacks. The RED command exited 101 on exactly five absent imports/functions in `/tmp/turnlink-native-contributor-bridge-red.log`. Ruling: the native host may supply data-only observations bound to actual contributor Arcs, with exact registry matching before detached assembly — avoid Core/host extension dependency cycles and preserve the shared assembly path — cost if wrong: this low-level trusted Rust bridge is not a closed native collector or destination freshness proof; unsupported normal hosts must still refuse until their concrete collectors exist. No serialized/model-supplied conversion or public continuity RPC is introduced. The default preview still refuses nonempty unsupported registries.

Implemented metadata-only declarations and a private detached adapter whose invocation always returns a fatal error. The adapter is local to assembly, and only the resulting data snapshot escapes. Focused verification is running in `/tmp/turnlink-native-contributor-bridge-green.log`; the previous verified export remains authoritative until all required checks and source reconstruction pass.

Both focused contributor regressions passed (2/2), zero failures. Formatting passed, and the staged 224,200-byte increment (SHA-256 `f922aa79c3665be836d2675be8a136aa504c147de16cd79e25aa421f93b38f8c`) exactly reconstructs the current pinned native source with all three new project/model/tool-preparation modules included; strict whitespace, forward temporary-index and reverse checks passed. Complete current native libraries are running in `/tmp/turnlink-native-contributor-bridge-libraries-final.log`. During compilation, completed incremental directories were removed only while holding every directory session lock exclusively and after refusing any working directory; 14 completed unlocked directories reclaimed 4.43 GiB logical. Active compiler outputs, loose codegen objects, source and installed integration were preserved. Native closed collectors and scope freshness remain unfinished.

Complete current libraries passed **Core 2,854/2,854, models-manager 57/57, model-provider 119/119, Git-utils 46/46 and home 10/10**, zero failures. The Git child case belongs to its parent 46 and is not counted twice. Config source remains unchanged from its separately verified 387-case checkpoint. All **22 default-stack continuity cases, five distinct tool-assembly cases and two distinct contributor-binding cases passed** (29 unique). Current app-server compilation is pending in `/tmp/turnlink-native-contributor-bridge-app-server-final.log`; both sandbox V8 artifact hashes were reverified before starting it. This increment still does not provide closed native contributor collection or destination freshness/permission/MCP authority.

Current app-server compilation passed in 1m04s using verified sandbox V8 artifacts. Exported the tested increment: **224,200 bytes**, SHA-256 `f922aa79c3665be836d2675be8a136aa504c147de16cd79e25aa421f93b38f8c`. The unchanged baseline plus increment exactly reconstruct pinned native source including all three new modules; final temporary-index reconstruction, reverse and strict whitespace checks passed. Manifest, design and reproduction notes record the verified scope. Twenty-six normal-library staging dead-code warnings and the known linker unwind warning remain unsuppressed. No editor or installed integration runtime was launched or restarted, no public continuity RPC or movement grant enabled, no commit/push made. The overall goal remains active. Next: closed native extension collectors (including Web/Image metadata without provider creation and Skills metadata without analytics initialization), actual reservation-bound destination global/permission/MCP state, then full-plan publication consumption, source resource census, receiver/release, incompatible-writer exclusion and platform/live acceptance.

## Concrete native contributor collectors in progress

Previous goal turn classified as progress: trusted native metadata handoff, 2,854 Core tests, supporting libraries, 29 default-stack cases, app-server compilation and exact exported source were verified. Revalidated no cargo/rustc jobs, the terminal marker and 4.41 GiB free. Current Core debug-map cleanup preserved all 256 referenced objects and executable identity/mtime/size; 512 obsolete own-target objects were reclaimed.

Ruling: use concrete Any inspection in each owning native extension crate before reading applied scopes; do not invoke unknown contributor callbacks or reconstruct providers merely to obtain specs — preserve the native Core/host dependency boundary — cost if wrong: these applied-scope observations still require a closed host collector and reservation-bound destination freshness before authorizing anything. Web/Image share pure native spec builders without provider/save-root initialization. Skills shares native construction while bypassing analytics initialization. History and message-board lifecycle now record successful disabled/completed initialization separately from missing/failed state; incomplete state refuses instead of silently vanishing.

Nine regressions cover unknown callbacks; message-board absence versus failed startup; Web/Image enabled, disabled and missing state; Skills metadata parity with no analytics publication; Memories metadata with no storage creation; History active/known-disabled state; Goal tools; and static file copying. The complete RED command exited 101 for missing preview APIs and initialization marker in `/tmp/turnlink-native-contributor-collectors-complete-red.log`. The eight owning-crate metadata helpers are implemented; formatting is running. No public continuity RPC, execution grant or editor launch is added.

The first focused execution compiled the new helpers and passed both Core cases, Goal, History, Image and Memories; it then stopped at the new copy-file fixture's incorrect expected name (`copy_file` instead of the actual native `multi_env_copy_file`). This is a fixture correction, not a production change. Skills and Web were not reached in that execution. The file-copy unknown contributor now panics if invoked, and History's disabled observation test is strengthened to obtain the marker through actual native configuration loading rather than inserting it manually. No success is attributed to this failed command.

All **nine focused contributor regressions passed**, zero failures, in `/tmp/turnlink-native-contributor-collectors-focused-final.log`. This includes seven cases in the owning crates/integration targets plus two in Core. History's known-disabled marker is now obtained through the actual native config path; the Image save-root callback and Skills host-config callback panic if invoked; Skills' ordinary path positively demonstrates the analytics publication which preparation avoids. Formatting and exact temporary-index source reconstruction passed for staged increment **266,916 bytes**, SHA-256 `f23c8cced19c5fc5fcea54479a588a9ea5cdb60124df2b2949d1e57b2078a6fa`, including the new file-copy integration test. Full selected native libraries, all Goal backend cases and the copy-file target are running in `/tmp/turnlink-native-contributor-collectors-libraries-final.log`. The Core test executable for this expanded package feature graph is `codex_core-7b85c8ac0dcd88e8`; the previous verified `0e338323f202f4d1` executable has not been removed.

The complete selected run exited 101 at Skills: Core **2,856/2,856**, Goal backend **28/28**, History **8/8**, Image **15/15**, Memories **18/18**, models-manager **57/57**, model-provider **119/119**, Git-utils **46/46**, home **10/10** and copy-file **1/1** passed; Skills was **161 passed, two failed**, and Web was not reached. The failures are `host_service::tests::snapshot_for_config_merges_extension_host_and_legacy_plugin_roots` and `host_service::tests::snapshot_for_config_preserves_host_precedence_for_symlinked_plugin_root`. Inspection proved both unexpectedly include the actual user `.agents/skills` root, which the normal loader intentionally discovers; these tests assumed an empty host. Ruling: compare all canonical fixture-owned entries in those two host-loader assertions, retaining exact plugin merge and symlink precedence checks — tolerate legitimate unrelated host skills without changing runtime discovery, configuration or the running environment — cost if wrong: these cases do not assert on unrelated user-root contents; native root discovery has its own tests. No production code change is made for this test isolation issue.

Both previously failing host-loader cases passed after the test-only fixture-root assertion correction (`/tmp/turnlink-native-contributor-collectors-skills-isolation-green.log`). All selected current test executables are rerunning in `/tmp/turnlink-native-contributor-collectors-libraries-rerun-final.log`; this uses the exact executables Cargo rebuilt/ran for the current package graph, with upstream's 8-MiB stack. Current app-server compilation runs independently with both sandbox V8 hashes reverified. All **38 distinct default-stack preparation cases passed**: 31 Core cases (22 continuity, five tool assembly, two prior contributor bindings and two new concrete-collector cases) plus seven owning-crate/integration cases. The final staged increment, including both host-loader test corrections, is **269,381 bytes**, SHA-256 `2a5af582e3bd8ad805ee8c86e00d444c00acc53f019cd6676656021172286a7d`; exact pinned reconstruction, all new files, strict whitespace and reverse checks passed. The installed editor/integration configuration remains unchanged.

The complete current selected test-binary rerun passed with **zero failures**: Core **2,856**, Git-utils **46**, home **10**, models-manager **57**, model-provider **119**, Skills **163**, Web Search **9**, Image Generation **15**, Memories **18**, History/Notes **8**, Goal backend **28**, and copy-file preparation **1** — **3,330 unique selected cases**, excluding the nested Git child already counted in its parent 46. The empty explicit Goal/file-copy lib-test targets are not counted. App-server compilation passed in **1m36s** with the verified sandbox V8 artifacts. All **38 default-stack cases** passed separately. Config library source is unchanged from its separately verified 387-case checkpoint.

Exported the tested **269,381-byte** increment, SHA-256 `2a5af582e3bd8ad805ee8c86e00d444c00acc53f019cd6676656021172286a7d`. The baseline remains unchanged. Exact final pinned temporary-index reconstruction, all new files, strict whitespace and reverse checks passed; manifest/design/reproduction notes record all eight concrete collectors and distinguish the still absent closed host collection wiring. Twenty-six normal-library staging warnings and the known linker unwind warning remain visible. All verification handles are terminal and no cargo/rustc remains active. No editor or installed integration runtime was launched or restarted, no public continuity RPC or movement grant enabled, no commit/push made. The overall goal remains active. Next: closed host collection wiring and actual reservation-bound destination global/configuration/permission/MCP scope capture and equivalence, then full-plan publication consumption, source resources, receiver/release, incompatible-writer exclusion and platform/live acceptance.

After verification terminated, reclaimed 53 completed unlocked incremental directories (4.21 GiB logical), preserving source, exported patches, current/previous Core test executables, codegen objects and installed integration. Free disk: 5.80 GiB.

## Closed host native tool collection in progress

Previous goal turn classified as progress: eight concrete native collectors, 3,330 selected native cases, 38 default-stack cases, app-server compilation and exact source export verified. Revalidated the terminal marker/no cargo/rustc and 5.80 GiB free. Ruling: put closed standard-native collection in a host-layer crate above Core, register its fixed Rust function on the immutable extension registry and consume actual session/thread/step scopes through that registration — preserve the Core dependency boundary and per-registry identity without generic ToolContributor callbacks or model JSON — cost if wrong: this remains trusted native host configuration and applied-scope metadata, not destination freshness or execution authority. Existing direct metadata observations retain independent Core identity validation.

Two Core regressions target registered native scope consumption and refusal of unready environment views before collection. Their RED command exited 101 on missing collection APIs in `/tmp/turnlink-native-host-tool-collection-core-red.log`. A new host-layer crate has four tests for absent host registration, registry order/identity and clone registration, unknown/uninitialized refusal without partial results, and all eight standard native contributors initialized once through ordinary native lifecycle/step preparation before read-only collection. No editor, public continuity RPC or movement grant is added.

The initial host-crate RED invocation selected only the new package, which caused a redundant narrower dependency graph to codegen existing libraries and pressure disk. It was deliberately interrupted with SIGINT after identifying that exact Cargo command (exit 130); it is not RED or passing behavioral evidence. All cargo/rustc processes terminated; 37 completed exclusively locked incremental caches were reclaimed (1.52 GiB logical). The RED invocation was corrected to select the established twelve-package graph plus the new host crate, using the locally updated lockfile with no external dependency updates. Its log is `/tmp/turnlink-native-host-tool-collection-host-red-final.log`.

The corrected host/Core RED command terminated with exactly missing native collection APIs: eleven host-crate and six Core diagnostics; no fixture type errors were reported. The registered path and closed collector are now implemented, including per-registry clone retention and a ready-environment guard before host invocation. The standard app-server installs the closed function while building each registry. Cargo.lock changes only add the new local host-layer package and its app-server edge; no external version updates.

With all compilers terminal, removed the obsolete `codex_core-0e338323f202f4d1` alternate-graph test target, its own objects/depinfo and exact test fingerprint after confirming it is older/inode-distinct and absent from the current `7b85c8ac0dcd88e8` debug map. Current executable identity/mtime/size was preserved; this recovers task-owned storage, and that old graph will rebuild if requested. Generated loose library objects are additionally reclaimed only after byte-for-byte equality with a member of a preserved self-contained (non-thin) native rlib; prefixes with an executable are excluded. Archives, executables and source are preserved. This replaces the earlier more conservative policy of retaining archived duplicates because disk pressure made the redundant bytes material.

Byte-verified archive duplicate cleanup removed 36,570 loose generated objects across 1,407 preserved self-contained archives, reclaiming 4.73 GiB logical; archive bytes and executable-owned prefixes were preserved. Free disk recovered to 8.85 GiB before the current build. The Core scope-consumption test also checks distinct session/thread/step publication and refusal after the actual thread scope is invalidated, so substituting a turn store or caching the result cannot satisfy it. Formatting passed. Focused six-case host/Core verification is running in `/tmp/turnlink-native-host-tool-collection-green.log` with the established package selection plus the new native host crate.

All **six focused host/Core cases passed** (four real native host collection cases and two Core scope/admission cases), zero failures. The all-eight fixture initializes actual native lifecycle and Skills step state once before collection, pins relevant fixture policy, verifies exact advertised tools, and confirms board/save-root lifecycle callback counts do not change. The ordinary native contributor methods are never a collection fallback. Current normal Core has 28 unsuppressed staged dead-code warnings; linker unwind warnings remain visible. Full current selected native libraries plus Goal backend and copy-file integration targets are running in `/tmp/turnlink-native-host-tool-collection-libraries-final.log`. Formatting and exact staged reconstruction passed for increment **298,397 bytes**, SHA-256 `b20262f8750ea2e3c7bd0e1d4988717474c9d11a3f406144525d4fbc961776e0`, including all seven new files and local workspace/lock changes. The previous verified exported increment remains authoritative until complete checks pass.

Complete current selected native libraries and integration targets passed with zero failures: **Core 2,858; native host collection 4; Git-utils 46; home 10; models-manager 57; model-provider 119; Skills 163; Web Search 9; Image Generation 15; Memories 18; History/Notes 8; Goal backend 28; copy-file preparation 1** — **3,336 unique selected cases** (nested Git child excluded from the total because its parent already counts it). The separately built extension API registry target reused the already verified Core executable unchanged (`fresh: true`); no additional Core feature graph was built. Current app-server compilation is pending with both sandbox V8 hashes reverified.

The six existing extension API registry integration cases passed, including every contributor category, registration order, selected executor availability, event sink retention and legacy/host discovery behavior. All **44 default-stack preparation cases passed**, with no overlap in that count: 33 Core cases, seven owning-crate/integration cases and four native host collection cases. App-server compilation passed in **1m02s** with verified sandbox V8 artifacts, including the actual new host dependency and registration. There are **3,342 unique selected native/registry passes** across the current full library/integration and registry runs; the default-stack run repeats a subset and is not added to that total. Config source remains unchanged from its separately verified 387-case checkpoint.

Exported the tested **298,397-byte** increment, SHA-256 `b20262f8750ea2e3c7bd0e1d4988717474c9d11a3f406144525d4fbc961776e0`. The unchanged baseline plus increment exactly reconstruct pinned native source including all seven new files, local crate membership, the local-only lock update and app-server wiring; final strict whitespace, temporary-index reconstruction and reverse checks passed. Manifest/design/reproduction notes record closed host collection and explicitly retain applied-scope/destination-freshness limits. Twenty-eight normal-library staged dead-code warnings and known linker unwind warnings remain unsuppressed. All verification handles are terminal and no cargo/rustc is active. No editor or installed integration runtime was launched/restarted, no public continuity RPC or movement grant enabled, no commit/push made. The overall goal remains active. Next: native reservation-bound destination global/configuration/permission/MCP scope capture and equivalence, full-plan publication consumption, source resources, receiver/release, incompatible-writer exclusion and platform/live acceptance.

## Native configuration file input freshness in progress

Previous goal turn classified as progress: closed native host collection, 3,342 selected native/registry cases, 44 default-stack cases, app-server compilation and exact export verified. Revalidated the terminal marker, no cargo/rustc and 6.31 GiB free. A new Core regression reproduced the actual gap: after source preparation, modifying the global user file was accepted by instruction revalidation. Its RED log is `/tmp/turnlink-native-config-file-freshness-core-red.log` (one failed assertion, not a compile error).

Ruling: record private bounded size/digest/absence observations at the actual native global readers, before their returned text is parsed; bind them to loader-owned layer/requirements provenance and reuse strict streamed preparation reads — detect changed, newly present, oversized or uncertain input without invoking cloud/thread callbacks or changing ordinary loading — cost if wrong: this proves file input freshness only; MDM/provider/environment and auxiliary role/catalog/prompt inputs plus full destination permission/MCP authority remain required. Normal loading stays unrestricted by the preparation budget, and oversized or conflicting reads make preparation provenance unavailable. Ignored user files are not treated as missing reads.

Five loader regressions cover all six global file kinds, absence versus ignored files, native epoch/stack tampering and aggregate overflow, late/growing/disappeared/unreadable streams, and mutation after the native read with duplicate/mixed-load refusal. The first compile exposed two ambiguous assertion macro imports; corrected before repeating RED. The repeated RED terminated on exactly ten missing preview API diagnostics, with no fixture type errors (`/tmp/turnlink-native-config-file-freshness-config-red-final.log`). The implementation adds a private loader-owned file epoch to existing native project inputs and consumes it during project/instruction preparation before target trust is derived. Global and project streams share the 1-MiB raw budget; the prior project boundary fixture now accounts for its known global file bytes and uses private global fixture paths. Ordinary reader behavior, provider calls and live publication are unchanged.

All **five focused configuration file cases passed**, zero failures (`/tmp/turnlink-native-config-file-freshness-config-green.log`). No new normal-config compiler warning appeared. The normal readers preserve their public entry points and existing behavior; captured variants are used only by full native loading, and replay/managed-only callers keep their ordinary paths. Revalidation is tied to the same native file epoch, rejects changes even when effective TOML is unchanged, and does not accept a separately reloaded epoch as the old observation. Complete config-library verification is running separately from Core to retain the established feature graph.

The full current config library passed **392/392**, zero failures, including all five new cases and the tightened shared raw-budget boundary. Config tests remain in their separate established build graph. The five reservation-bound instruction cases, including the semantic regression that failed before implementation, are building/running in `/tmp/turnlink-native-config-file-freshness-core-green.log` with the usual native package selection.

During Core compilation, reclaimed 83 completed exclusively locked incremental directories (5.70 GiB logical); 5 active/working/unavailable directories were skipped. Archives, current executables, loose codegen objects and source were preserved. Free disk: 6.80 GiB.

All **five reservation-bound instruction cases passed**, including the new semantic global-file drift regression which failed before the implementation. This verifies refusal both while revalidating the existing observation and while trying to prepare again from the stale source configuration; the live source Config Arc remains unchanged. Full selected native libraries and Goal/copy-file integration targets are running. Exact staged source reconstruction, strict whitespace and reverse checks passed for **330,955 bytes**, SHA-256 `3caa723121d08005582707cd6e4a5f7001f0156f47a509bfc5980a479e1720eb`, including all nine new files. The previous export remains the verified checkpoint until the broader checks finish.

Complete current native libraries and Goal/copy-file integration passed: **Core 2,859; native host collection 4; Git-utils 46; home 10; models-manager 57; model-provider 119; Skills 163; Web Search 9; Image Generation 15; Memories 18; History/Notes 8; Goal backend 28; copy-file preparation 1**, zero failures — **3,337 unique selected cases**, excluding the nested Git child counted in its parent. Config separately passed all **392** current cases. Rebuilding the existing API registry test target against current dependencies before final registry/default-stack/app-server verification. No destination configuration is published by these observations.

Final current verification passed: all **6 existing registry cases**, **50 distinct default-stack preparation cases**, and `cargo check --locked -p codex-app-server` (**1m26s**) with the verified sandbox V8 artifacts. Together with the 3,337 selected library/integration cases and 392 config cases, this is **3,735 distinct selected cases**; default-stack reruns are not added again. All jobs are terminal and no cargo/rustc process remains. Twenty-eight normal-library staging warnings remain unsuppressed.

Exported the exact tested **330,955-byte** increment, SHA-256 `3caa723121d08005582707cd6e4a5f7001f0156f47a509bfc5980a479e1720eb`. Pinned temporary-index reconstruction, strict whitespace, all new-file coverage and reverse-worktree checks passed again before replacing the export. Baseline unchanged. The manifest and design/reproduction notes record filesystem input freshness separately from still absent MDM/provider/environment/auxiliary freshness and full destination configuration/permission/MCP materialization. No editor launched or restarted, no public movement enabled, no commit or push. The overall development goal remains active; next is shared native destination configuration/permission/MCP preparation and its complete input provenance.

## Native destination constructor input routing in progress

Previous goal turn classified as progress: verified/exported native global-file freshness and recorded all final checks. Current terminal marker and exported hash were rechecked before proceeding. Inspection of the actual full Config constructor found that roles and prompt files use its selected ExecutorFileSystem, while custom model catalogs bypass it with std::fs. Ruling: route catalog reads through the same selected native filesystem before reusing this constructor for detached destination configuration — a preparation filesystem must observe/refuse every auxiliary read — cost if wrong: a changed filesystem transport must retain native UTF-8, JSON validation and typed read errors. Two semantic constructor regressions cover a virtual catalog absent from host disk and selected-filesystem refusal despite a valid host file. Full destination construction, other input capture and publication remain open.

Both constructor regressions compiled and failed semantically against the old reader (exit 101, 0/2 passed): the virtual catalog returned host NotFound, and the denied catalog incorrectly loaded from host disk. Log `/tmp/turnlink-native-constructor-catalog-red.log`. Changed the shared native catalog loader to use the constructor's ExecutorFileSystem and await its text reader; JSON/nonempty validation and typed errors are retained. No preparation-size limit is added to ordinary loading. Full destination materialization still requires bounded preparation reads, captured invocation overrides, strict trust injection, auxiliary discovery/error provenance and environment/provider freshness.

After RED completed, reclaimed 72 completed exclusively locked incremental directories (4.78 GiB logical); 4 working/unavailable directories skipped. Preserved source, archives, current test executables and loose codegen objects. Core formatting passed.

Current staged increment is **339,011 bytes**, SHA-256 `70adcadc6e1c2b744bcd74fda44d2d78fe075bd2ed4c9a9ad667ae6e2dced68f`. Compared with the prior export, only the shared Core config module and new `config/native_input_tests.rs` change. Exact pinned temporary-index reconstruction, strict whitespace, all new-file coverage and reverse-worktree checks passed. The prior export remains authoritative while GREEN and broad verification run. Current GREEN session handle 29147, `/tmp/turnlink-native-constructor-catalog-green.log`; the marker also retains the actual Cargo PID.

Both new constructor regressions passed (2/2, exit 0) in `/tmp/turnlink-native-constructor-catalog-green.log`; compilation **3m54s** with the established package graph. Full selected libraries and the 52-case default-stack selection are running under session 60535. Current app-server check and current-dependency API registry build/test are running sequentially under session 69114, with both sandbox V8 hashes reverified. The marker records both handles.

Final verification passed: **Core 2,861; native host collection 4; Git-utils 46; home 10; models-manager 57; model-provider 119; Skills 163; Web Search 9; Image Generation 15; Memories 18; History/Notes 8; Goal backend 28; copy-file preparation 1** — **3,339 unique selected cases**, zero failures/skips. The nested Git child is already counted in its parent 46. All **52 distinct default-stack cases** passed, including both new constructor regressions. Current-dependency API registry tests passed **6/6**; Cargo marked current Core artifacts fresh. App-server compilation passed with verified sandbox V8; 28 unsuppressed normal-library staging warnings remain. Config source is unchanged from its separately verified 392-case checkpoint, giving **3,737 distinct selected cases** across these scope-matched results. Logs use prefix `/tmp/turnlink-native-constructor-catalog-`.

Exported exact tested **339,011 bytes**, SHA-256 `70adcadc6e1c2b744bcd74fda44d2d78fe075bd2ed4c9a9ad667ae6e2dced68f`. Repeated pinned temporary-index reconstruction, strict whitespace, all new-file coverage and reverse-worktree checks passed. Baseline unchanged. Manifest/design/reproduction notes updated. Both verification sessions are terminal; no editor was launched/restarted, no public movement enabled, no commit or push. Overall goal remains active. Next: selected-filesystem memory-version presence, native invocation-override provenance and bounded auxiliary observation around the shared full constructor; consume strict destination trust and integrate actual destination permissions/MCP without source Config cloning or publication.

## Native memory-version constructor input routing in progress

Previous turn classified as progress: selected-filesystem catalog routing implemented, semantically RED/GREEN verified, complete selected suites/default stack/app-server/registry verified, exact increment exported. Revalidated terminal marker and no native Cargo/rustc process before continuing. The actual shared constructor still uses tokio::fs::try_exists for V1 memory presence. Ruling: use selected-filesystem metadata with symlinks followed, treating only NotFound as known absence and retaining V1 on uncertain reads — preserves ordinary fail-closed version selection while making the input observable by future bounded preparation — cost if wrong: a transport must preserve native existence/error semantics. Three constructor regressions cover selected presence despite empty host storage, selected absence despite preserved host data, and uncertain reads/explicit choices with no unnecessary probes. Native invocation-override provenance and full detached destination construction remain open.

Before compilation, reclaimed 40 completed exclusively locked incremental directories (3.02 GiB logical), skipped 4 active/working/unavailable; preserved source, archives, current executables and loose codegen objects.

All three memory constructor regressions compiled and failed semantically against the old reader (**0/3**, exit 101, build 2m13s), `/tmp/turnlink-native-memory-input-red.log`. Changed only the shared constructor's existence probe to selected-filesystem metadata with default symlink-following behavior. Only NotFound selects V2; other errors retain V1. A direct probe against the pinned Rust 1.99.1 standard library confirmed NotADirectory is an error in the old try_exists path; the uncertainty cases include it. Explicit choices still short-circuit without a storage probe. Formatting passed; GREEN runs all five native constructor input cases (catalog plus memory).

Staged exact native source increment: **344,613 bytes**, SHA-256 `98ec7015c8daf4df73728d76da595394c51c22446a0ac841fc9ec0a9d31f6ba5`. Pinned temporary-index reconstruction, strict whitespace, no untracked-source omissions and reverse-worktree checks passed. Only the shared Core config module and existing native input test module differ from the previous export; the previous export remains authoritative pending broader verification.

All **five native constructor input cases passed**, exit 0 (catalog two, memory three), build 2m31s. Full selected libraries/default-stack checks run under session 64445; current app-server check and API registry rebuild/test under session 26123. Marker records both live handles. Both sandbox V8 hashes are reverified before the build check. OpenCode's outstanding full-Core timeout will be revisited after these jobs terminate, avoiding native build competition.

Final memory-input verification passed **Core 2,864; host collection 4; Git-utils 46; home 10; models-manager 57; model-provider 119; Skills 163; Web 9; Image 15; Memories 18; History/Notes 8; Goal backend 28; copy-file 1** — **3,342 unique selected cases**, zero failures/skips (nested Git child already counted in parent 46). All **55 distinct default-stack cases** passed, including five constructor-input cases; current API registry **6/6** passed, with Cargo marking current Core artifacts fresh. App-server compilation passed with verified sandbox V8. Config source is unchanged from its separately verified 392-case checkpoint; combined scope-matched selected evidence totals **3,740 distinct cases**, excluding duplicate default-stack reruns. Twenty-eight normal-library staging warnings remain unsuppressed.

Exported exact tested **344,613 bytes**, SHA-256 `98ec7015c8daf4df73728d76da595394c51c22446a0ac841fc9ec0a9d31f6ba5`. Repeated pinned temporary-index reconstruction, strict whitespace, complete new-file coverage and reverse-worktree checks passed. Baseline unchanged; manifest/design/reproduction notes updated. Both native final sessions are terminal; no editor launched/restarted, no public movement enabled, no commit/push. Complete destination construction and other movement gates remain open.

The current OpenCode workspace pins `bun@1.4.2`; no Bun executable was found on PATH or in the checked existing tool locations. Installed that exact official release under ignored `.native-runtimes/bun-toolchain/1.4.2`, preserving normal HOME/PATH configuration. Verified the release-published arm64 archive SHA-256 `90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f` before extracting its sole requested executable; version check returned 1.4.2. Installation metadata and checksum manifest are retained beside the binary. Next verification is OpenCode's complete current Core suite with no competing Rust build; its previous full result was not green.

Before OpenCode verification, confirmed no Cargo/rustc process remained and reclaimed 40 completed exclusively locked incremental directories (4.22 GiB logical), skipping 4 working/unavailable entries; preserved source, archives, current native executables and loose codegen objects. Free disk 4.89 GiB.

Started full current OpenCode Core verification with the package's ordinary `bun run test` driver and pinned Bun 1.4.2, without changing its 30-second timeout or five-second watcher assertions. Session **43940**, actual runner PID recorded in `/tmp/turnlink-opencode-core-current.json`, log `/tmp/turnlink-opencode-core-current.log`. Source freeze: HEAD `d7d44a7e03a9a390a3b66d1da8bb59aa03b65f9e`, **217** changed/new source files, fingerprint `50aa576d11f942db4308fea58a9d113e9d783bd137213a5b21329fd53bfb5923`; the runner recomputes it after completion. No Cargo/rustc build is running.

## Native invocation provenance regressions prepared

While the isolated OpenCode full suite runs, prepared three Codex constructor regressions without starting another Rust build. The full destination constructor must retain actual native ConfigOverrides: effective Config values cannot reveal whether a permission/model choice was an invocation override, a configured value or an ignored persisted fallback. Ruling: capture immutable raw overrides at the actual shared constructor, retain that native identity through Config cloning, refuse missing provenance and explicitly keep provenance out of existing effective Config equality — matches the existing layer-stack distinction between semantic equality and private provenance — cost if wrong: later preparation still must bind actual source/session state and handle host-owned post-construction settings; retained inputs alone are not a complete destination grant. Regressions cover original/relative/ignored inputs, clone identity, equal effective configurations with different native choices, and refusal of missing provenance. Production capture is not implemented yet; RED waits until the OpenCode suite terminates.

OpenCode's current unchanged-source full Core run terminated **7,177 passed / 43 skipped / 1 failure**, **7,221 tests across 310 files**, exit 1, 246.68 seconds. The prior Git packing timeout did not recur; the sole failure is the newer `session-movement-model-work.test.ts` helper-request fixture, which fails before making its loopback request: `Service not found: @opencode/storage/Database`. Working direct SessionGenerate fixtures explicitly export Database.node and the native llmClient from their root graph; this fixture only exported Session and other facades, whose private dependencies are not root context outputs. A focused untouched reproduction is recorded in `/tmp/turnlink-opencode-model-work-red.log`. No green full-suite claim is made.

The focused fixture reproduced the missing Database before any model request. After explicitly exporting Database.node and the actual native llmClient (matching working SessionGenerate fixtures), it reached the real held loopback request and failed semantically: owner.prepare incorrectly succeeded while the helper's HTTP request was pending and its ordinary Session runner was idle. Preserved this RED in `/tmp/turnlink-opencode-model-work-semantic-red.log`. This exposed a production lower-helper admission gap, not a timeout issue.

Ruling: wrap the actual common SessionGenerate helper's complete native operation in existing SessionExecution.withActivity, and provide the already captured native service at the public facade call — shares the established counter, quarantine check, reservation serialization and settlement boundary instead of inventing a second census — cost if wrong: direct internal callers now require that service explicitly; pure generation unit fixtures use the existing recording-only compatibility layer, which cannot authorize native movement. The native integration fixture uses the real service, now also checks no request is sent after a durable hold, and keeps its actual instruction/session correlation and unchanged native Session assertions. Complete physical transport closure/resource census and movement publication remain separate requirements.

All **41 focused real-helper/generation/coordinator tests passed**, zero failures, `/tmp/turnlink-opencode-model-work-focused-final.log`. The native real-request case now proves refusal while the held HTTP request is in flight with ordinary runner idle, successful preparation after native helper completion, no replacement of the native Session, and no second HTTP request after the durable hold. This is no complete physical transport/release proof. The focused native graph exports actual Database/LLM services; normal generation unit fixtures explicitly use the recording-only compatibility service. Source formatting passed. Full current Core and canonical type/lint verification follow before exporting the OpenCode patch.

The first canonical check stopped before linting because this shell selected Node 22.5.1, which cannot load the repository's TypeScript oxlint plugin. This was a toolchain failure, not a source diagnostic. Reused the already installed Node 24.21.0 from the current integration's recorded plan through command-local PATH, leaving normal configuration unchanged. With Node 24, canonical lint and all **35 workspace typecheck tasks passed** (29 cached, 6 executed). Read the repository's unit-test and Effect workflows and checked existing real helper/dependency patterns. Corrected the touched fixture's pre-existing nested service yield to the required named service binding before the final frozen run. The native recording-only fixture remains unable to authorize movement.

Prepared current full OpenCode patch (**1,256,183 bytes**, SHA-256 `339d37badac88eaee8e48ec002d8be32052876a4a919a0eef11c778791079b57`) in `/tmp/turnlink-opencode-model-work-increment.patch`. Exact pinned temporary-index reconstruction, strict whitespace, full new-file coverage and reverse-worktree checks passed. The previous exported artifact remains authoritative until final current checks finish. Final sequential check/build/repetition/full-Core driver session **24662**, live phase/PID in `/tmp/turnlink-opencode-model-work-active.json`. No Rust build starts while this full-suite work runs.

Final current canonical check passed all **35 workspace tasks**, Core and Server builds passed, Server tests passed **85 with one skip**, and the real native helper regression passed **10/10 repeated runs** in 2.32s. The full frozen Core rerun is active under session 24662; marker `/tmp/turnlink-opencode-model-work-core-final.json` records Bun 1.4.2, source fingerprint `a1671c4566c507e1b852a5556400feeb4d54998acf48229989677d5352554c78`, **219** changed/new source files, and actual process PID. No new Rust compilation is running.

Read-only independent review of the current helper fix completed with **no Critical, Important or Minor findings**. It checked the shared activity lifetime through instance/plugin/context/model/hook/request work, native execution service wiring, nested public/helper activity safety, durable fence recheck after waiting, and the real loopback assertions. Reviewer ran no tests/builds and mutated no checkout state.

Review disposition — physical transport closure after cancellation remains required before any movement grant: this regression proves activity through successful native helper completion, not remote cancellation settlement; cost if prematurely treated as closure is an old request outliving the local census. Arbitrary low-level model calls remain a separate admission-coverage requirement: this fix owns the common SessionGenerate helper only; cost of treating it as exhaustive is an unregistered request. Destination publication and exact receiver/release remain gated and disabled; cost of enabling before those requirements is incomplete destination authority. The wider migration remains under the full original goal, with the existing incomplete-gate ledger retained; this review is not branch/goal completion.

OpenCode's final full current Core suite passed **7,178 / 43 skipped / 0 failed**, **7,221 tests across 310 files**, exit 0, **219.34 seconds**. Before/after source fingerprints match exactly. The previously failing helper now passes in the complete suite as well as ten focused repeats; old Git packing and watcher cases passed in this run. The independently observed raw watcher delivery limitation is not erased by a passing run.

Exported full current OpenCode patch **1,256,183 bytes**, SHA-256 `339d37badac88eaee8e48ec002d8be32052876a4a919a0eef11c778791079b57`, after repeating exact pinned-index reconstruction, strict whitespace, all new-source coverage and reverse application. Added `native/opencode/manifest.json` so the current verified snapshot and incomplete authority/transport/publication/receiver boundaries are machine-readable; reproduction README updated. Canonical all-35 checks, Core/Server builds, Server 85+one skip, focused 41 and repeated real helper 10 all passed. No editor, commit, push or public native movement capability was introduced. Overall goal remains active; prepared Codex native invocation tests can now run without competition from this full suite.

Invocation RED terminated exit 101 with **nine diagnostics solely for missing native provenance field/getter APIs**, no fixture type errors (`/tmp/turnlink-native-invocation-input-red.log`). Implemented an opaque native capture at the shared constructor before overrides are consumed. Clone retains the immutable Arc; default has no provenance and the internal reader refuses it. Debug reveals only capture availability. Effective Config equality intentionally excludes provenance; ConfigOverrides itself now supports direct value comparison for the captured-input contract. No serde/public request conversion, destination publication or authority grant is added. Native host post-construction settings and actual destination materialization still require separate binding/consumption.

Current Codex invocation increment staged at **352,801 bytes**, SHA-256 `80d94d1d42d5116ba51eb7a583e1c8a39df05cb8107122c54aaa064f2e4548ca`. Exact pinned temporary-index reconstruction, strict whitespace, all new files and reverse-worktree checks passed; normal source changes are limited to constructor capture, opaque origin storage/access and ConfigOverrides value comparison, with three new regressions. The opaque record is not an integrity seal for later public Config field mutations and is not a destination grant. GREEN session **99927**, actual process/log in the active marker. Previous verified export remains unchanged pending behavioral verification.

All **eight constructor input regressions passed**, exit 0, including original/relative/ignored invocation inputs, shared immutable clone identity, effective equality with different raw invocation choices, and typed refusal of missing provenance. GREEN build **3m48s**, `/tmp/turnlink-native-invocation-input-green.log`. The previous five catalog/memory cases also passed unchanged. No destination configuration or live policy is published. Full current selected libraries, 58-case default stack, app-server and API registry verification follow.

Current invocation final verification sessions: selected libraries/default-stack **49493**, app-server/API registry **49799**, active marker updated. Upcoming full destination construction must consume this record together with actual session/source bindings, strict native project trust and bounded auxiliary observations; preserve native relative-path/workspace semantics and host-owned post-construction policy explicitly. Raw retained arguments alone settle none of those execution-authority requirements.

Final invocation verification passed **Core 2,867; host collection 4; Git-utils 46; home 10; models-manager 57; model-provider 119; Skills 163; Web 9; Image 15; Memories 18; History/Notes 8; Goal backend 28; copy-file 1** — **3,345 unique selected cases**, zero failures/skips (nested Git child already counted in its parent 46). All **58 distinct default-stack cases** passed, including all eight constructor-input cases. Current API registry **6/6** passed; Cargo marked current Core artifacts fresh. App-server check passed with verified sandbox V8 in **1m49s**. Config source is unchanged from its separately verified 392-case checkpoint, giving **3,743 distinct selected cases** across these scope-matched results. Normal-library staging warnings are now **29**, including the invocation reader awaiting the complete planner; none are suppressed.

Exported exact current Codex increment **352,801 bytes**, SHA-256 `80d94d1d42d5116ba51eb7a583e1c8a39df05cb8107122c54aaa064f2e4548ca`. Pinned temporary-index reconstruction, strict whitespace, all eleven new source files and reverse application passed again; baseline unchanged. Manifest/design/reproduction notes updated. Both native final sessions are terminal. OpenCode's independently verified full checkpoint remains 7,178 passed/43 skipped/zero failures with its helper-activity fix exported and independently reviewed. No editor launched/restarted, no commit/push, no public native movement enabled. Overall goal remains active. Next: complete shared native destination Config construction with bounded auxiliary/discovery provenance and strict project trust, consuming retained invocation inputs and actual host/session settings; then complete permission/MCP/model/tool authority publication, resource census, exact receiver/release, old-writer exclusion and remaining platform/live acceptance.

## Bounded native constructor filesystem inputs — 2026-10-28

Continued Gate 2 from the verified invocation-input checkpoint. The next complete
destination constructor needs bounded auxiliary/discovery provenance before it
can consume retained invocation inputs. Native helpers may swallow an I/O error
and preserve their ordinary fallback; a detached preparation must retain the
uncertainty independently of that helper's return value.

Implemented an internal read-only preparation filesystem: streamed EOF reads,
1-MiB shared payload/path budget, 256-operation and per-file chunk limits,
known-absence/content/metadata/canonical observations, repeated-input consistency,
cancellation/error poisoning and fresh bounded revalidation. Mutation methods,
sandbox-context substitution, no-follow reads and unbounded directory/walk
operations refuse without delegating. Ordinary native loading is unchanged.

All ten new focused regressions passed, including the actual native model-catalog
reader and full constructor swallowing an uncertain memory-existence probe. The
same ten cases passed with `RUST_MIN_STACK` unset. Current selected libraries passed
**Core 2,877; native host collection 4; Git-utils 46; home 10; models-manager 57;
model-provider 119; Skills 163; Web 9; Image 15; Memories 18; History/Notes 8** —
**3,326 unique cases**, zero failures/skips. The nested Git child is included in
its parent 46, not counted twice. App-server compilation passed in **1m05s** with verified sandbox V8 artifacts,
and all **six registry integration tests** passed. Rustfmt and native/root
whitespace checks passed. Thirty-nine normal-library staging warnings remain
unsuppressed; this component is staged for the complete destination planner.

The first broad sandboxed run failed under process/loopback restrictions; the
accepted broad result above is the approved outside-sandbox rerun. Logs use
`/tmp/turnlink-native-capture-` (focused/default-stack/libraries `-final.log`).
No current full upstream suite or fresh parent/IDE/platform acceptance is inferred.
The capture bounds the observations and consumes the selected streaming API;
readiness and a genuinely streaming native delegate must still be bound by the
planner. It does not certify hidden allocation inside an arbitrary remote delegate.
This is a constructor-input prerequisite: bounded directory discovery, complete
destination Config construction, strict trust consumption, environment/provider
and host/session authority, publication, resource census and exact receiver/release
remain required. No public movement capability or installed runtime is changed.


Exported the exact tested Codex increment: **377,010 bytes**, SHA-256
`10ffd371d8d92f3795d5f5254c7759b305e3e24217439f3483cfeb92231108ad`.
Unchanged baseline plus increment exactly reconstruct the pinned native source,
including all thirteen new source files. Strict whitespace, pinned temporary-index
forward application, exact resulting tree and reverse-worktree checks passed.
Manifest and reproduction notes record this checkpoint. Final verification
processes terminated successfully. No editor/runtime was launched or replaced,
no commit/push made and no movement capability enabled.

Next: implement bounded native directory discovery, then consume the captured
invocation and filesystem inputs in shared destination Config construction with
strict project trust and actual host/session settings. Complete permission/MCP/
model/tool authority, publication-time revalidation, source resource census,
exact receiver/release, incompatible-writer and platform/live acceptance remain
required. Gate 2 and the full platform plan remain incomplete.

## Bounded native directory discovery — 2026-10-28

Continued Gate 2 from the bounded constructor-input capture checkpoint. Added a
strict, bounded Rust filesystem operation with default refusal for unsupported
implementations. The native local implementation checks entry/byte limits while
iterating, retains ordinary symlink-following semantics, and refuses entry errors,
lossy names and partial results. Only failure to open an absent directory may
return `NotFound`; later entry/target errors retain uncertainty instead of being
laundered as absence. No public wire protocol or ordinary directory reader changed.

Preparation now consumes this bounded operation through the existing native role
discovery path. It shares a 4,096-entry budget across directory reads, shares the
existing 1-MiB payload/path and 256-operation budgets, normalizes enumeration order,
records complete membership/type/known-absence observations and revalidates them.
Malformed names, ambiguous results, unsupported transports, mutation and cancelled
reads refuse preparation. Full destination construction and authority publication
remain unfinished.

The accepted final-source parallel run passed **Core 2,883; executor 429;
Git-utils 46; home 10; models-manager 57; model-provider 119; host collection 4;
Skills 163; Web 9; Image 15; Memories 18; History/Notes 8** — **3,761 unique
library cases**, zero failures/skips. File-system/agent-role library targets
compiled with no library cases; actual discovery is covered in Core/executor.
The nested Git child is included in its parent 46. All sixteen capture cases
also passed on the default stack, including the final nested-refusal assertion.
App-server compilation passed in **1m26s** with reverified sandbox V8 artifacts,
and all six registry cases passed. Rustfmt and native/root whitespace checks
passed. Thirty-nine normal-library staging warnings remain unsuppressed.

The native trait rebuild required storage follow-through: after verifying no
process used the obsolete `codex_core-7b85c8ac0dcd88e8` target and that its inode
was distinct from the current executable, removed only that earlier feature
graph's executable/loose objects/depinfo (2,306 task-owned files, 3.68 GiB logical).
Current artifacts, source, patches, companion and installed integration were
preserved. Reusing that obsolete graph would require rebuilding its test target.

Scoped review also required overriding the new bounded method on the capture
wrapper itself. Native discovery still enters its ordinary `read_directory`
interposition; a direct nested bounded-capability probe is explicitly refused
and poisons capture. A swallowed trait-default `Unsupported` must not leave a
valid capture. The refusal regression now checks this path.

The first Mac fixture attempted to create a non-UTF-8 filename and failed at
creation with OS error 92 (APFS rejects that name), before invoking the reader.
The actual-filesystem non-UTF-8 case is now Linux-only; it has not been run on
Linux in this increment. Four supported native Mac cases and sixteen capture
cases passed. The failure is retained in
`/tmp/turnlink-directory-fixture-platform-failure.log`.

An intermediate broad run before the final refusal-path review passed 2,883 Core
cases but failed one existing executor tracing-context assertion (`None` rather
than the inbound request span): 428 executor cases passed, one failed. That exact
network-policy case passed immediately in isolation; no tracing test or timeout
was changed. The intermediate result is retained in
`/tmp/turnlink-directory-libraries-pre-refusal-review.log`. The accepted final
full parallel run passed all 429 executor cases, including that exact case,
without changing its assertions or tracing code. This record does not claim the
initial failure's root cause or a tracing fix.


Final export: **401,121 bytes**, SHA-256
`ed36a3f4bd455b0a9c6f55a0c313c634a9ccb61ae02914533ffc124fe6f56eaa`.
Baseline plus increment exactly reconstruct the pinned source, including all
thirteen new source files. Strict temporary-index application, resulting tree,
reverse-worktree and whitespace checks passed. Compared with the prior accepted
export, only four files change: the filesystem trait, native local directory
reader, preparation capture and its regressions. Manifest/reproduction/design
notes updated. Final logs use `/tmp/turnlink-directory-` with libraries,
app-server, registry and default-stack `-final.log` suffixes. All final
verification processes terminated successfully. No editor/runtime replacement,
commit/push or native movement activation occurred.

Next: consume the retained invocation, strict destination project preview and
bounded filesystem observations in shared native destination Config construction,
binding actual host/session settings and current global/environment provenance.
Complete permission/MCP/model/tool authority, publication-time revalidation,
source resource census, exact receiver/release, incompatible-writer exclusion
and remaining platform/live acceptance remain required. Gate 2 stays open.

## Shared full destination Config construction — 2026-10-28

Continued Gate 2 from bounded native directory discovery. Implementing a detached
full `Config` through the same constructor as ordinary native loading, consuming
retained invocation inputs, strict native source/destination project previews and
bounded auxiliary/directory observations. Source reconstruction must match the
effective values of the actual immutable source Config before destination
construction may succeed; unknown post-constructor value edits refuse. The two explicitly app-server-owned
network/auth route fields retain their actual native source values. This is not
fresh provider/MDM/auth readiness or a frozen revision of their mutable state.

A native-only construction context supplies the preview's exact cwd/trust root/
active project and captured PATH/TMPDIR/SQLite-home/effective-home/process-cwd inputs. Strict
construction avoids the ordinary Git trust fallback. Relative additive roots use
native resolution for the destination; explicit absolute workspace roots keep
their original native meaning. Known environment inputs are frozen for the
constructor and checked again, without changing global environment settings.

Reservation-bound preparation retains actual native session choices separately
from destination Config defaults, checks source ownership/directory/environment
bindings before and after reads, and refuses changed model/provider, permission,
instruction, cwd/root and other consumed session settings. Neither Config nor
session settings are published. Complete provider/tool/permission authority,
commit-time exclusion and receiver/release remain separate work.

The final-source verification and export recorded below supersede the previous
accepted checkpoint. Tests exercise constructor parity, destination trust, selected
invocation/relative roots, native roles/MCP/prompt declarations, missing/stale
provenance, unknown host edits, auxiliary budgets, exact-source revalidation,
environment input checks and native owner-bound no-publication/model drift.

Before building, verified there was no Cargo/rustc process and acquired each
cache's exclusive lock before removing three obsolete Oct-24 Core incremental
cache directories (`1aeqipdmdoyf2`, `1rwxqh8etwnmc`, `2fl3i8ixbbsqi`). Current
incremental graphs, libraries, test executables, companion, source and installed
integration remain. Recovered roughly 2 GiB available; those old graphs would
need compiler-cache regeneration if requested again.

The source comparison uses native Config value equality; it does not inspect or
certify opaque validator/normalizer closures, callback state or mutable host
policy revisions. Original session choices/constraints remain separately retained.
Those identities and authority must be consumed by the later permission/provider/
tool authority stage before publication. Constructor parity is not an authority
seal and no public movement/grant path consumes this detached result.

Review added native constructor cwd provenance: the opaque invocation record now
binds the constructor's actual resolved cwd, and its reader refuses a later
edited cwd. Reservation-bound full construction also requires current session
cwd/home to match the source Config; it does not reuse stale constructor context
after an ordinary cwd change or an incomplete earlier move. A source-cwd edit
is covered by the refusal regression. Raw invocation arguments and clone identity
remain retained; this is still not an integrity seal for other fields/closures.

The broad pre-boxing run passed **2,891 Core / 429 executor / 3,769 unique selected
library cases**, app-server and six registry cases. The additional default-stack
probe then aborted with a stack overflow in full constructor preparation. That
failure is preserved in `/tmp/turnlink-destination-default-stack-red.log`.
Large full-project/Config preparation and revalidation futures are now boxed at
the native boundaries, following the existing native constructor strategy. No
stack limit or test assertion was raised/weakened. All eight new cases (seven constructor cases plus native owner-bound preparation)
now pass with `RUST_MIN_STACK` unset. Final-source broad verification passed as
recorded below; pre-boxing logs retain `-before-boxing.log`.


Accepted final-source verification: **Core 2,891; executor 429; Git-utils 46;
home 10; models-manager 57; model-provider 119; host collection 4; Skills 163;
Web 9; Image 15; Memories 18; History/Notes 8** — **3,769 unique selected library
cases**, zero failures/skips. The nested Git child is included in its parent 46,
not counted twice. File-system/agent-role library targets compiled with no
library cases; constructor/discovery coverage runs through Core/executor. All
eight new cases passed on the default stack. App-server compilation passed in
**18.30s** with both sandbox V8 artifact hashes reverified; all six current-dependency
registry cases passed. Formatting of the new modules/invocation/session files and
native/root whitespace checks passed. Forty-seven normal-library staging warnings
remain unsuppressed; installed runtime/global settings are unchanged.

Exported exact tested increment **435,091 bytes**, SHA-256
`72cf3768b38dca4cf790e7e387088255d1d935df6466caef76a56faeb112c0c7`.
The unchanged baseline plus increment exactly reconstruct pinned native source,
including all fifteen new source files. Strict temporary-index application,
exact resulting tree, complete new-file coverage, reverse-worktree and whitespace
checks passed. Relative to the prior checkpoint, only six files change: shared
Config construction, the new constructor module/tests, native invocation provenance
and continuity preparation/tests. Manifest/reproduction/design notes record scope.
Final logs use `/tmp/turnlink-destination-` with libraries, app-server, registry
and default-stack `-final.log` suffixes. All final verification processes terminated
successfully. No editor launched, native movement enabled, runtime replaced or
commit/push made.

Next: assemble complete reservation-bound permission/provider/model/MCP/tool and
instruction authority from the detached Config and retained actual session choices.
Bind opaque validators, mutable host policy revisions and fresh applied provider/
MDM/environment state; semantic Config equality is not that proof. Then consume
that authority atomically for placement commit, exact receiver acknowledgement,
resource census/release, incompatible-writer exclusion and production adapter
acceptance. Full executable destination construction and Gate 2 remain open.

## Native constructor and runtime enforcer bindings — 2026-10-28

Continued Gate 2 authority assembly at the concrete opaque-enforcer gap. Four
new semantic regressions failed against the previous source: replacing a source
or detached-destination validator with the same effective value passed
preparation, and replacing the live session approval/profile validator with the
same value passed owner-bound revalidation. Native value equality intentionally
ignores these allocations. RED: `/tmp/turnlink-authority-red.log` (four failed,
zero passed), with healthy preparation controls before each runtime mutation.

Added a native Rust-only opaque binding which retains actual validator and
normalizer Arcs and compares their identities/type without invoking either
callback or cloning policy values. No addresses, caller hashes, JSON conversion
or public wire capability is introduced. Ordinary value equality stays unchanged.
Each completed native Config constructor now records installed approval, permission
snapshot, residency, MCP and web-search enforcers in its opaque invocation
provenance. Missing or replaced enforcers refuse retained-input reads and source
preparation. Detached destination revalidation checks its own constructor binding
as well as the source binding. Native continuity additionally compares actual
runtime approval/profile enforcers to its captured session state.

Identity is enforcement lineage, not mutable callback-state freshness or a
permission grant. A regression explicitly changes state captured by the same
callback: identity still matches while ordinary validation correctly refuses.
Complete state/revision and destination permission/provider/model/tool authority,
publication, resource census and receiver/release remain required.

The separate current config library passed **398/398**, including six binding
cases: no metadata callback sampling or value-clone requirement, retained clone
identity across value changes/drop, same-value/type substitution, composition,
normalizer-only replacement and the mutable-state limitation. Native regressions,
default-stack and broader verification passed as recorded below. The final
export supersedes the previous accepted native checkpoint.

Before the foundation rebuild, verified no Cargo/rustc process remained and took
exclusive session locks before removing three superseded completed Core compiler
cache sessions; the latest session in every graph, all libraries, executables,
companion and source were preserved. This removes only rebuildable task-owned
incremental backups, not installed native state.


After the focused foundation rebuild, available disk fell to 1.1 GiB. With no
Cargo/rustc process left, reclaimed 90 superseded completed compiler-cache
sessions under exclusive locks, preserving the newest completed session in each
graph and every compiled library/executable, companion, source and installed
integration. This removed 6.37 GiB logical backup state (roughly 4.6 GiB available
recovered); only old incremental fallback/regeneration performance is affected.

Accepted final verification: **Core 2,896; executor 429; Git-utils 46; home 10;
models-manager 57; model-provider 119; host collection 4; Skills 163; Web 9;
Image 15; Memories 18; History/Notes 8** — **3,774 unique selected library cases**,
zero failures/skips. The nested Git child is included in 46, not counted twice.
Together with the separately verified **398 config cases**, this is **4,172
unique cases** across the two package-selection scopes. The five Core regressions/
control passed, including all four previously failing reproductions. Thirteen
Core cases (all destination construction and authority-binding cases) plus six
config-binding cases passed with `RUST_MIN_STACK` unset: **19 distinct default-stack
cases**. App-server compilation passed in **1m16s**, both sandbox V8 artifacts
were reverified, and all six current-dependency registry cases passed. Formatting
of the touched constraint/invocation/destination/session modules and root/native
whitespace checks passed. Fifty normal-library staging warnings remain unsuppressed.
Final logs use `/tmp/turnlink-authority-` with config, focused, libraries,
app-server, registry and default-stack `-final.log` suffixes; RED remains separate.

Exported exact tested increment **453,659 bytes**, SHA-256
`c6429d08361f293462781be9c8358484203329610e8b19c16318784adf88cfde`.
Unchanged baseline plus increment exactly reconstruct pinned native source,
including all sixteen new source files. Strict temporary-index application,
exact tree, complete new-file coverage, reverse-worktree and whitespace checks
passed. Compared with the previous export, only the ten intended configuration/
constraint/permission/continuity source and test files change. Manifest,
reproduction notes and design record this bounded checkpoint. All final
verification processes terminated successfully. No editor was opened, runtime
replaced, public wire protocol changed, native movement enabled or commit/push made.

Next: bind mutable callback/host-policy state revisions and fresh applied global/
provider/model/MCP/tool readiness. Compose that evidence with retained live session
choices and constructor lineage into complete destination authority; neither value
equality nor stable callback allocations alone suffice. Atomic placement commit,
resource census/exclusion, exact receiver acknowledgement/release, production
adapter integration and platform/live acceptance still follow. Gate 2 remains open.

## Gate 2 closure goal and audit — 2026-10-28

Active user goal: complete every remaining step needed to close Gate 2. The full
scope is the native-worktree-continuity gate in `control-plane-roadmap.md`, its
contracts in `control-plane.md`, and the native design/reproduction records for
both OpenCode and Codex. Other delivery gates and production activation retain
their separate acceptance/approval boundaries. The preceding implementation turn
was progress: four verified enforcer-replacement defects were fixed and exported;
it was not Gate 2 completion.

Closure remains unproven. Required evidence to audit before marking it complete:

| Requirement | Current authoritative evidence | Still required |
| --- | --- | --- |
| Authenticated native owner, exact session/attempt and approved broker grant | Fresh enrolled-receiver broker authorization of exact prepared grants, broker fences and staged native host-created owner/reservation contracts | Complete production owner RPC wiring; no capability from arbitrary peer/model/plugin input |
| Complete effective destination authority | Codex detached native Config, strict project/filesystem observations, enforcer lineage and applied policy/catalog/auth-cache change bindings plus one-candidate data assembly; OpenCode owned preparation milestones | Fresh global/managed/provider/model/instruction/MCP/tool/environment state and live permission revocations; no hash/value-only equivalence or hidden startup |
| Native admission and writer exclusion | Scoped native source patches, mutation/admission guards and compatible kernel/storage prerequisites | Complete source/consumer/alias/orphan/resource census, pending/acquired/cleanup coverage and incompatible-writer refusal in both runtimes |
| Native placement commit | Staged durable journal/CAS primitives and approved transition contracts | Consume complete fresh authority under native exclusion; exact effect receipts; preserve history, selected agent/model and approvals |
| Exact destination receiver continuity | Broker receiver contracts and native same-session/cwd primitive measurements | Native destination acknowledgement and exact receiver rebind before release; arbitrary OpenCode moves still detach |
| Uncertain/crash/restart handling | Broker receipts and native intent/quarantine/restart primitives | End-to-end interrupted commit/rebind/release recovery; no blind replay of uncertain movement; native platform durability/ACL evidence |
| Source resource release/re-establishment | Scoped native helper/process/resource tests with explicit limits | Physical source cleanup/reconciliation and approved destination establishment for every supported resource class |
| Production adapter integration | Existing-cwd task flows and default-off movement integration scaffolding | Approved grant → actual native effect → exact rebind → task evidence/report → explicit master acceptance for OpenCode and Codex |
| Scope-matched final verification | Historical/full and bounded native/parent checkpoints retained separately | Fresh complete affected native/adapter/integration suites, negative drift/race/foreign-owner/failure cases and required platform evidence at the final source/patch freeze |
| Reviewable artifacts and completion decision | Pinned patch manifests, design notes, roadmap and this ledger | Exact final-source patch reconstruction, current manifests/reproduction commands and a requirement-by-requirement completion audit; retain production switches off until separately authorized |

Current next action: bind mutable application-policy changes to preparation.
Existing account revision alone is insufficient because policy contents can
change (including ABA) within the same revision. New native observation must be
read-only/nonblocking, tied to the actual policy owner/view and availability,
monotonic across effective updates, and rechecked after asynchronous preparation.

## Native mutable application-policy observations — 2026-10-28

Progress toward the full Gate 2 closure goal. Two Core reproductions failed
against the preceding source: preparation accepted an unavailable managed policy,
and policy A → B → A within one account/load revision left an old preparation
valid. RED: `/tmp/turnlink-policy-red.log` (two failed, zero passed).

Added a native read-only observation bound to the actual application policy owner,
immutable endpoint/account view, applied availability and an independent monotonic
effective-policy generation. Successful effective publication, unavailability and
invalidation advance the generation under the policy mutex; stale/no-op publication
does not invent a change. Checked exhaustion is permanent for observation purposes;
ordinary native enforcement behavior is unchanged. Capture and revalidation use
nonblocking lock acquisition, refuse unavailable/stale-account/poisoned/exhausted
state, and create no transport permit, provider refresh or network work. The
observation is native Rust data with private fields and redacted Debug, not a
caller-supplied epoch/hash or public wire capability.

Detached Config preparation captures policy before asynchronous reads and checks
both source/destination views before and after them. An actual-local-filesystem
wrapper injects policy ABA at the asynchronous stream boundary to verify late
revalidation and initial preparation refusal; later reads cannot retag the old
epoch. Applied network-policy state alone does not prove external managed policy,
auth/provider/model/MCP/tool freshness or commit-time exclusion. Those requirements
and the full Gate 2 objective remain unchanged.

The separate HTTP-client library passed **125/125**, including seven observation
cases: unmanaged/view binding and no permits, exact owner/account/readiness,
ABA/unavailable recovery/no-op/stale publication, busy and poisoned mutexes,
exhaustion and redacted metadata. Core verification is pending. Its initial build
terminated with OS error 28 while writing Rust's query cache; no Core test result
was produced. Preserved `/tmp/turnlink-policy-core-disk-failure.log`, confirmed
Cargo/rustc were terminal, then removed 135 superseded/abandoned compiler sessions
under exclusive locks, preserving the newest completed session in every graph,
compiled artifacts, source and installed integration. Reclaimed 8.15 GiB logical
backup/failed state and restored about 6 GiB available; the same focused command
was then retried. The previous exported patch remains authoritative until current
verification finishes.


Current policy checkpoint verified and exported: **3,777 selected native library
cases** (Core 2,899, executor 429 and companion roots), **125 HTTP-client** and
**398 configuration** cases: **4,300 unique cases** across these scopes, zero
failures/skips. Nested Git child is counted only within its parent root. The three
Core policy cases and seven HTTP observation cases pass. Sixteen relevant Core
and seven HTTP cases pass separately without RUST_MIN_STACK (23 distinct).
App-server check and all six extension registry cases passed; normal Core library
retains 50 unsuppressed staging warnings. All verification processes terminated.

Exported additive increment: **475,471 bytes**, SHA-256
`b3a784d0c4f0deb75ccf1f2c153c06a9cb204be9933b849ae7adfb949a870073`.
Temporary-index strict forward application reconstructed the exact source tree
`76fb54fbdf9abf7faaa32b44a90569a195f93af5`; reverse check, native/root whitespace
checks and touched-file format checks passed. Sixteen new source files remain
included. Compared with the preceding export, only four policy/Core files changed
(499 insertions, one deletion). Immutable baseline and both pinned sandbox V8
artifact hashes remain unchanged. Manifest/reproduction/design/roadmap now record
this checkpoint. No runtime replacement, editor launch, public wire change,
movement activation or commit/push occurred.

The full closure audit above remains authoritative and the goal remains active.
Next bind account/auth ownership and native catalog changes to model preparation:
current model preparation compares catalog values and endpoint policy facts, while
native AuthManager already publishes distinct credential/owner/source/login
revisions. Equal values can conceal intervening changes. Any witness must use
actual native owners, reject unavailable/uncertain state and avoid callback,
auth refresh, provider startup or network work during preparation. Complete
provider/tool readiness, exclusion, placement publication, exact receiver handoff,
adapters and platform/end-to-end acceptance remain required.

Parent native-continuity test invocation also terminated successfully with both
installed-runtime cases skipped by their opt-in guards (zero run). It adds no new
live acceptance evidence. Final manifest byte/hash/default-off assertions and
root whitespace check passed after documentation updates.


## Native catalog/discovery change binding — 2026-10-28

Progress toward the unchanged full Gate 2 objective. Two native regressions failed
on the exported policy checkpoint: actual catalog publication A → B → A and
shared API-key-discovery false → true → false both retained equal preparation.
RED: `/tmp/turnlink-catalog-red-final.log` (two failed, zero passed). An initial
standalone manager invocation was intentionally interrupted (terminal exit 130)
because its different feature graph rebuilt large dependencies; the reproductions
ran on the existing 16-root graph instead, not a timeout-triggered restart.

Implementation retains native allocation change identities for catalog/discovery.
Catalog capture shares the actual publication read/write boundary; discovery
capture and ordinary updates share the value's revision mutex. Originator managers
share discovery and its revision. Snapshot equality includes retained allocation
identity, preventing ABA. Publication/invalidation/source conversion advance the
catalog token; exact no-op and rejected foreign publications preserve it. Busy or
poisoned observations refuse nonblockingly, with no endpoint/cache/auth callback
or network request. Ordinary updates still apply under recovered poison while
preparation remains refused. Auth/account/provider readiness and commit exclusion
remain unfinished. Six manager regressions/controls are present; final verification
is pending and the prior 475,471-byte policy export remains authoritative.

Disk handling: before compilation, no Cargo/rustc process was running; removed 87
superseded completed query-cache sessions under exclusive locks, retaining newest
sessions. The next build nevertheless terminated with LLVM OS28 while producing
Core/Core-test-support artifacts, with no new test result. Preserved its log as
`/tmp/turnlink-catalog-core-disk-failure.log`, confirmed exit 101 and no Cargo/rustc,
then removed 28 superseded/abandoned sessions. The remaining headroom was too small
for a complete retry, so all remaining disposable incremental query caches were
removed under exclusive session locks. Compiled libraries/test executables/native
code-mode host, source and installed integration were preserved. This trades
incremental speed for sufficient verification headroom.


Catalog checkpoint completed verification and export. During review, shortened the
discovery observation lock to sampling its token/value, then rechecked it after
metadata construction; catalog cloning no longer retains the discovery lock.
An intermediate compile was explicitly interrupted (terminal exit 130) after this
refinement, before starting the final frozen-source verification. Core's concrete
provider/originator test now rejects restored discovery ABA, accepts fresh equal
metadata and confirms no new requests. Source stayed byte-identical throughout
final verification, checked against its pre-build SHA-256 freeze.

Final **3,783 unique selected native library cases**: Core 2,899, executor 429,
models-manager 63 and companion roots, zero failures/skips. Six new manager cases
cover catalog/discovery ABA, shared originator state, no-op/foreign publication,
busy revision locks and poisoned observation versus ordinary update behavior.
Separate config **398/398** and HTTP-client **125/125** were freshly rerun:
**4,306 unique cases** across these scopes, with nested Git child counted once
within its parent. Six relevant Core plus six native manager cases pass without
RUST_MIN_STACK (twelve distinct). App-server check and all six registry cases pass.
Core normal-library staging warnings remain 50, unsuppressed. Final build/test
processes terminated successfully. Cleared 284 disposable compiler query sessions
under locks, recovering about 11 GiB headroom; compiled artifacts remained intact.

Export: **489,152 bytes**, SHA-256
`b99207422bb7c12eed5b61368455472776441a1e3883592e27a3a37ba171106b`.
Strict temporary-index forward reconstruction yields exact tested native tree
`ed5a13a9354c03da2be9d590d0c11ef4acd8bde6`; reverse/whitespace checks pass.
Sixteen new files remain included. Relative to the prior policy export, changes
are exactly three files, 296 insertions/eight deletions. Touched-file formatting
and source-freeze checks pass. Manifest, complete selected-root reproduction
command, roadmap and design now record this checkpoint. No runtime replacement,
editor launch, wire capability, movement activation or commit/push occurred.

The full Gate 2 audit and goal remain active. Next: replace model preparation's
cached auth-mode/value sampling with nonblocking native owner/change observations
for both actual manager and endpoint auth sources. Preserve native account/source
ownership and live changes without calling auth refresh, arbitrary callbacks or
provider startup. Applied catalog tokens do not prove current authentication,
external policy, full execution readiness, resource exclusion, atomic destination
publication or exact receiver acknowledgement/release. Both runtime adapters and
platform/end-to-end acceptance remain in scope.

Final export/manifest byte and hash checks, immutable-baseline hash, sixteen-new-file
coverage, frozen-source/default-off assertions and root whitespace check passed.


## Native applied auth-cache/source observations — 2026-10-28

Progress toward the unchanged full Gate 2 objective. The previous catalog turn
was verified implementation/export progress. Two new Core reproductions failed
on that export: model preparation survived cached credential ABA and replacement
of the external auth source with equal credential values. RED:
`/tmp/turnlink-auth-red.log` (two failed, zero passed). The fixtures exercise real
native provider/static model managers and ordinary external-auth installation,
not caller-supplied native authority or hash-only permission equivalence.

Current implementation retains actual cached-auth owner/change identities and
external-source allocation binding. Native observation is nonblocking and performs
no storage/keyring/source callback, login, refresh or network work. Busy/poisoned
cache/external/shared-JSON locks, permanent refresh failure, pending changes and
checked-counter exhaustion refuse. Static and concrete OpenAI model metadata bind
both actual manager and endpoint sources separately, rechecking after metadata
preparation. ChatGPT identity helpers receive detached frozen JSON, with a token
for actual shared identity-metadata persistence; metadata persistence cannot
silently mutate an old observation. Native Debug is redacted.

Ordinary source install/clear, reload/account reload, refresh, logout/revoke,
identity bootstrap and forced-workspace changes enter native change scopes. These
retain pending refusal across awaits and invalidate on completion/cancellation.
Private observations do not change existing account/credential watch revisions or
ordinary enforcement outcomes. New tests cover pending installation/reload and
cancellation, distinct manager/endpoint owners, credential/account ABA, busy and
poisoned locks, failures, absent/no-op caches, nested scopes/exhaustion, workspace
ABA and redaction. Existing account-owner and real legacy-identity-persistence
regressions include native observation checks. A limiting test explicitly shows
unpublished state inside the same external callback is not observable without
invoking it; only ordinary reload applies it and invalidates the cached witness.
This is applied native state, not full external callback/managed policy/provider
freshness, transport readiness, commit exclusion or Gate 2 closure.

Before compiling, confirmed Cargo/rustc were absent and removed 110 disposable
incremental query-cache sessions under exclusive locks, preserving compiled
artifacts/source/installed integration and restoring about 11 GiB headroom. Initial
app-server compilation passed before the final additional pending-operation fences.
Frozen final-source verification now covers seventeen selected library roots
(including login), app-server, registry, config and HTTP-client. Previous exported
489,152-byte catalog patch remains authoritative until final verification passes.


Auth checkpoint verified and exported. Frozen-source verification passed **4,007
unique selected native library cases** across seventeen roots: Core **2,904**,
executor **429**, newly selected login **219**, models-manager **63** and companion
roots. The prior sixteen-root comparison is **3,788**; selecting login adds its
219 existing/new cases rather than claiming 219 new regressions. Separate config
**398/398** and HTTP-client **125/125** were freshly run: **4,530 unique cases**
across these scopes, zero failures/skips; nested Git child counted once inside its
parent. Five native auth-model Core cases and ten native auth-library cases pass.
Eleven total model-preparation Core cases and ten native auth cases also pass
without RUST_MIN_STACK (21 distinct). App-server and all six registry cases pass;
normal Core staging warnings remain 50, unsuppressed. All final processes exited
successfully, source hashes stayed identical throughout verification.

Exported additive patch: **529,229 bytes**, SHA-256
`ab376c3e6beb11cb23bb3ae1a0ecd674c712c3b4b6bfa6a28d1652e7719a5c04`.
Strict temporary-index forward reconstruction equals exact tested native tree
`a9ab1b66b746ea45611c4befd3c46f68a77fd2c4`; reverse/whitespace checks pass.
Seventeen new files are included (the new native auth module is the only new file
since the catalog checkpoint). Difference from that checkpoint: eight files,
694 insertions/20 deletions. Touched-file format checks and final eight-file source
freeze pass. Manifest/reproduction/design/roadmap now record the checkpoint. No
editor launch, runtime replacement, public wire capability, movement activation
or commit/push occurred.

The full Gate 2 audit and goal remain active. Next assemble the retained Config,
model/auth, instruction and native tool observations into the owner-bound
destination path while filling actual managed-policy/provider/environment/gateway
and MCP/tool readiness gaps. Do not promote applied metadata or stable external
callback allocation into full authority: unpublished callback state is explicitly
unproven. Destination resource establishment must be an explicit approved native
effect, not hidden preflight startup. Complete resource census/exclusion, durable
placement publication, exact receiver acknowledgement/release, both production
adapters and platform/end-to-end master acceptance remain required.

Final byte/hash/immutable-baseline checks, seventeen-new-file coverage, source-freeze,
default-off/open-authority assertions and root whitespace check passed.


## Reservation-bound destination data assembly — 2026-10-28

Progress toward the unchanged full Gate 2 objective; the previous auth turn was
verified implementation/export progress. Current work assembles full detached
native Config, actual retained model/auth choices and bound native instruction
data around one owner/reservation/candidate. Instruction reads consume the actual
destination Config rather than composing separately captured candidate objects.
Runtime model/provider/settings remain separate from Config defaults; no live
settings, instruction cache, journal placement or resource scope is published.

Assembly validation brackets instruction I/O with configuration/runtime/owner
checks and rechecks actual model/auth state before and after that I/O. A final
synchronous instruction-source check follows the last async configuration check.
Instruction sources now have retained native owner/change identity and checked
pending-refresh state. Ordinary instruction refresh enters before semaphore
acquisition, invalidates on completion/cancellation and does not retain an
observation lock across awaits. Bound reads reject pending, exhausted, busy or
poisoned source state and stale/foreign ownership; equal text cannot retag old
preparation after native refresh. Existing closed native provider readers remain
in use; no unknown callback is sampled.

Five new assembly cases cover retained live model/context-window versus different
Config defaults, destination document settings, no publication, stale/closed/foreign
ownership, document/config drift, runtime/same-value enforcer drift and actual
source refresh with equal resulting destination data. Three native instruction
binding cases cover pending/nested/cancelled/exhausted changes, owner/busy-lock
refusal and poisoned observation with unchanged applied-cache read behavior.
A document-restoration control intentionally verifies current data observations;
it is not evidence of filesystem-writer exclusion or an instruction-file ABA fence.

Tool preview still describes actual applied source scopes; it is not labeled as
destination tool readiness. Explicit approved destination resource establishment,
provider/environment/gateway and MCP/tool authority, full census/exclusion, durable
commit, exact receiver handoff and both adapter/platform acceptance remain in the
full audit. The assembled data type is not an execution grant and cannot close
those requirements or be consumed by the current bare placement commit as one.

Before compilation, confirmed Cargo/rustc absent and removed 133 disposable query-
cache sessions under exclusive locks, preserving compiled artifacts/source and
installed integration; free space rose to about 15 GiB. Frozen-source verification
now runs seventeen library roots, app-server, registry, config and HTTP-client.
Normal Core compilation currently reports 55 staging warnings (five added for
this still-unwired assembly), unsuppressed. No verified export promotion yet; the
529,229-byte auth checkpoint remains authoritative until verification completes.


First verification findings: Core **2,912/2,912** passed, including all eight new
cases, on the upstream broad-suite stack. The separate default-stack run aborted
with a real overflow in `continuity_destination_assembly`; a single healthy case
reproduces it, while all three instruction-binding cases pass. Preserved
`/tmp/turnlink-assembly-default-stack-overflow.log` and the isolation log. Before
final export, moved nested ordinary ConfigBuilder/test-fixture futures onto the
heap; production component/validation boundaries were already boxed. The same
default-stack cases are being rechecked, without increasing the stack override.

That broad invocation also ended with executor **428 passed/one failed**:
`remote::direct::tests::direct_websocket_reuses_registration_and_stops_on_permanent_errors`
hit its existing deadline. The exact isolated case then passed (one passed, zero
failed, about 22 seconds); no test/timeout/product changes were made to it. The
original log is retained at `/tmp/turnlink-assembly-pre-default-fix-libraries.log`;
a fresh complete executor/selected-root pass is still required. A child LLDB
diagnostic produced no backtrace and was explicitly terminated along with its
own debugserver/stopped fixture (terminal exit 143); it supplies no acceptance
evidence. Final verification has not been promoted or called complete.


Default-stack isolation/update: boxing fixture setup alone still reproduced the
overflow. The predecessor instruction and configuration cases each passed alone
on the default stack. Boxing the composed future at the native API boundary also
proved insufficient by itself; returning the large owned preparation through a
Box, in addition to the boxed future, resolved the caller poll/result-move frame
growth. The unchanged five assembly and three binding cases now pass with no
RUST_MIN_STACK override. Production API, not test stack size, carries this boundary.
Retained explicit fixture boxing prevents unrelated nested setup from growing
callers. Final source hashes have been re-frozen before a fresh full selected-root
run, including the previous executor deadline case; the earlier failing run is
not relabeled as success. No export promotion yet.


Assembly checkpoint verified and exported. The fresh final source passes **4,015
unique selected library cases** across seventeen native roots: Core **2,912**,
executor **429**, login **219**, models-manager **63** and companion roots. Separate
config **398/398** and HTTP-client **125/125** were freshly rerun: **4,538 unique
cases** across these scopes, zero failures/skips, nested Git child counted once
in its parent. All eight new cases pass. The five assembly and three instruction
binding cases additionally pass without RUST_MIN_STACK. App-server and all six
registry cases pass; normal Core staging warnings remain **55**, unsuppressed.
The previously timed-out executor case and its entire 429-case root pass on the
final run without test/deadline changes. Earlier failures/isolation logs remain
separate evidence. All final verification processes exited successfully.

Exported additive patch: **550,796 bytes**, SHA-256
`9c0cddfe81c86411ac75df57a4f88497fbe497c015401a85e7cec268252571bf`.
Strict temporary-index reconstruction equals exact tested tree
`fde0f16b07078d85b2da864a873f99406f53470c`; reverse and whitespace checks pass.
Seventeen new files remain included; this increment changes exactly three existing
files, 527 insertions/one deletion. Touched-file format checks and final three-file
source freeze pass. Manifest/reproduction/roadmap/design record current scope.
No editor launch, installed runtime replacement, public wire capability, movement
activation or commit/push occurred.

The full Gate 2 audit/goal remain active. Next: bind actual destination provider/
environment/gateway/MCP/tool readiness and explicit approved resource establishment
to this retained candidate. Source applied scopes must not be relabeled as ready
destination scopes, and configuration/model/instruction data alone must not unlock
commit. Finish native writer/resource census and exclusion, authenticated owner RPC,
durable placement publication/recovery, exact receiver acknowledgement/release,
both production adapters and complete platform/end-to-end master acceptance.

Final export byte/hash/immutable-baseline checks, seventeen-new-file coverage,
source-freeze/default-off/open-authority assertions and root whitespace check pass.


## Native selected-provider definition and resource planning — 2026-10-28

Progress toward the unchanged full Gate 2 objective. The preceding assembly turn
was verified implementation/export progress. Current work binds the actual native
provider object and selected key to its source constructor definition, resolves
that same key in the native destination provider map, and honors the destination's
applied required-provider constraint. Missing selection, foreign object, incoherent
source, changed destination definition and conflicting requirement refuse; no
provider alias/default or value-only authority guess substitutes for selection.

Native concrete inspection supports the standard configured, GCP and Bedrock
factory classes and rejects unknown provider callbacks before info/auth/model
methods. GCP/AWS expose dedicated raw-field access for preparation: AWS's ordinary
auth accessor can inspect environment credentials and is deliberately bypassed.
All three factories now retain their actual base-auth input before provider-scoped
command-auth replacement. Preparation binds both stored and original factory auth
observations, including ABA/pending/cancellation; future explicit construction must
not accidentally use the command wrapper as the original account input.

The data plan declares command/gateway/AWS and environment-name inputs without
resolving values, launching commands, constructing destination gateway/credential
state, logging in or fetching catalogs. The provider factory remains outside
read-only preparation. Declarations are not resource readiness, credential validity
or a grant. The same retained Config/model/instruction candidate now includes and
revalidates this selected provider definition before/after async reads.

Eight native provider cases cover selected-key/source/definition binding, missing
selection and required-ID conflicts, all three factory families/original auth
input, unknown callbacks, no startup/env lookup, auth ABA and pending cancellation.
Core adds an incoherent-source rejection, preservation of native project-config
protections and actual native GCP default auth cwd resolution for the destination.
Initial fixture failures were corrected to follow native rules, not weaken them:
command auth cannot combine with a primary env key; built-in OpenAI cannot be
overridden through model_providers; repository config cannot alter provider
selection/credential destinations. Those invalid inputs remain rejected/masked.
The generic declaration test keeps selected-key preservation independent of a
map's other entries; the Core project test verifies actual native filtering.

A test-only import from a private re-export was corrected to its owning protocol
module. Preserved the invalid-combination and invalid-built-in fixture logs as
diagnostics; they are not passing acceptance evidence. Focused provider and
provider-related scopes passed before the final raw AWS/GCP accessor change. The
final eight-file source is frozen and fresh full seventeen-root/app-server/registry/
config/HTTP verification is running. Before builds, removed 98 then 66 disposable
incremental sessions under exclusive locks with Cargo/rustc absent; compiled
artifacts/source/installed integration remain intact. Prior 550,796-byte assembly
export stays authoritative until final verification completes.

Full destination provider/gateway/environment/MCP/tool readiness, authenticated
approved owner effects, complete native resource/writer census, commit/recovery,
exact receiver rebind/release, both adapters and platform/live master acceptance
remain in the full Gate 2 scope.


Final selected-provider checkpoint verification: 2,915 Core cases passed; the
original parallel executor run passed 427 and failed two network-deadline cases.
That failure log remains preserved. The same frozen executor binary passed all
429 with `--test-threads=1` in 110.01 seconds, with no assertion/deadline changes.
The other fifteen selected roots passed 682 unique cases, including login 219,
model-provider 127 and models-manager 63. Accepted per-root runs total 4,026 unique
library cases; separate Config 398 and HTTP-client 125 total 4,549 across scopes.
Nineteen affected default-stack cases passed (Core 11, provider 8), alongside six
registry tests and app-server compilation. Fifty-five staging warnings remain.

Promoted the verified increment: 583,273 bytes, SHA-256
`7c0818030e5a92c0bdf928cb286ed8df1cedf6f12104b367db3b73f431f81381`,
reconstructed native tree `dc23029af38dbb9ea3c313e1c480f749bdc98b36`.
Strict baseline/forward application, exact reconstructed-tree equality and reverse
application checks passed. The increment contains eighteen new files; this phase
changes eight source files (690 insertions, one deletion) from the prior export.
All eight frozen source hashes match the tested source. The immutable baseline
patch remains unchanged. No installed runtime/editor replacement, wire activation,
commit or push occurred; movement and complete-destination flags remain false.

Next implementation must connect authenticated owner/approved grants to explicit
native provider/gateway/environment/MCP/tool resource establishment and cleanup,
rather than treating definition observations as readiness. Complete writer/resource
census, commit journal/recovery, exact receiver acknowledgment/rebind/release,
both production adapters and platform/live master acceptance remain required by
the full Gate 2 audit. This checkpoint does not close Gate 2.


### Explicit native provider construction — 2026-10-28 (verified component)

The previous selected-provider checkpoint made authoritative progress: the tested
patch was promoted and its source/export hashes verified. The next change adds
an explicit native factory effect separate from preparation. It consumes the
retained provider plan, revalidates selection/source/account inputs, constructs
through the ordinary native factory using the original base-auth input, refuses
already-known deferred gateway setup errors, and retains the actual constructed
provider plus a destination cached-auth observation. It revalidates source and
destination observations after construction. It neither resolves credentials nor
installs the provider in the session. No broker approval or readiness is inferred
from this primitive; trusted approved invocation remains to be wired.

Owned handles follow normal native lifetime semantics, including process-shared
auth/gateway caches. Dropping the wrapper is not a claim that those global caches
were rolled back or that a complete resource census/cleanup gate passed. Tests
cover command-auth removal restoring the original account input (rather than
accidentally retaining the source command wrapper), new destination command-auth
changes, source credential ABA, conflicting selection, all three native factory families and deferred gateway failure.
Ordinary Bedrock construction may inspect environment inputs to select its auth
source; this is an explicit effect and does not bind those inputs or prove their
readiness. The prior pinned artifact stays authoritative while this source is verified.


Final construction checkpoint: the standalone model-provider library passes all
131 cases (zero failures/ignored), and all four new construction cases pass with
`RUST_MIN_STACK` explicitly unset. App-server compilation passed on the same final
source. This change does not rerun or extend the earlier complete seventeen-root
acceptance claim. The three source files were frozen and hash-checked across
verification and export. Initial diagnostic runs passed 128/failed two, then
130/failed one: command auth conflicted with requires_openai_auth in one fixture;
the gateway fixture lacked its required explicit base URL. Corrected fixtures
preserve native validation rules; the final full 131-case run is green. No
production validation rule or test deadline was weakened.

Promoted increment: 594,405 bytes, SHA-256
`b4fd348679292113d47deaddd51748326693c8be04aae1be1d3e582135c808e9`,
exact reconstructed native tree `746b8b04438a6a8b66a72b1631932482740a618e`.
It retains eighteen new files; this phase changes three provider files with 261
insertions and six deletions from the prior export. Strict forward/reverse
application and reconstructed-tree checks passed; immutable baseline unchanged.
No installed binary/editor replacement, commit, push or movement activation.

Next required work remains the authenticated owner/approved-grant control path
and actual pending/acquired/cleanup resource census, including native shared-state
aliases and orphan owners. The factory primitive must be invoked as an approved
native effect, with credential/environment/MCP/tool readiness and cancellation
cleanup proven before publication. Native commit/recovery, exact receiver ack/
rebind/release, both adapters and live platform/master acceptance remain open.
Gate 2 and the full goal remain active.


### Fresh authenticated broker worktree authorization — 2026-10-28 (verified broker component)

Previous turn classified as progress: verified and promoted explicit native
provider construction, with the retained original account input, owned result,
source/destination observations, four default-stack cases and production build.
This phase advances the broker-to-effect path rather than another native data
observation. The coordinator previously obtained a grant and queried/local-checked
state, but lacked a fresh receiver/credential-bound broker authorization request
immediately before its effect.

Added `control_worktree_authorize` through strict protocol parsing, session-proof
injection, broker dispatch and enrolled receiver authentication. A current-state
validator requires the exact prepared transition, claimed task/generation, latest
approved preview/authority, clear transition/managed/task resource occupancy and
fresh capability/idle evidence. Its response is not a command receipt, transferable
native capability or permission snapshot. Both harness coordinators require the
fresh response before writing their inflight journal or invoking the native port.
Refusal/response loss before invocation records only a no-effect result when the
source remains observed; no recovery replays native movement. Default flags and
production movement capabilities remain disabled.

Focused verification passed 45 cases, including actual broker transport, enrolled
credential revocation/re-enrollment, exact expected-grant mismatch, default-off,
administrator/foreign receiver rejection and deliberate receiver replacement.
The replacement fixture initially tried simultaneous receivers and correctly hit
the existing single-receiver refusal; it now explicitly unsubscribes the former
receiver. Growing that test also exhausted the real host request bucket under a
fixed fixture clock; explicit clock advancement refills it without changing rate
limits. A first command used unsupported shell Node 22.5.1 and failed before tests
on node:sqlite; verification uses installed Node 24.21.0 with command-local PATH.

The first wider parallel control run retained a storage-watch failure, plus the
then-invalid simultaneous-receiver fixture. The first serial full run reproduced
the storage case; a diagnostic copy established actual overall critical disk
pressure (about 1.9 GB free) dominating its expected command warning. The product
correctly reported critical pressure with both commands and disk. Fixed only that
command-quota fixture to inject a healthy disk through the existing diskStats
seam, preserving all severity/assertion/deadline behavior and separate disk-pressure
coverage. All fourteen storage cases then passed. Final frozen-source full
JavaScript verification is running again with test-file concurrency one; native/OS integration flags retain their
default opt-in status. Native patch and installed runtimes are unchanged.


While final verification runs, reclaimed 144 disposable Rust incremental sessions
only after confirming Cargo/rustc were absent and obtaining each session's
exclusive nonblocking lock. Source, compiled binaries/libraries, toolchains and
installed integration were preserved. Available disk increased to about 7.1 GiB;
no production storage-pressure rule changed. The deterministic command-quota
fixture remains independent of real machine pressure.


Final frozen-source verification passed: the complete JavaScript suite on Node
24.21.0 with `--test-concurrency=1` reports **521 passed, 14 opt-in/platform skips,
zero failures (535 total)** in 138.15 seconds. Syntax checks passed. All ten changed
source/test file hashes match the frozen verification input; root whitespace
checks pass. The focused 45-case run and fourteen storage cases also passed;
earlier failures and the diagnostic disk-pressure trace remain separate evidence,
not relabeled green. Native integration flags were not enabled for this run, so
these counts do not claim new installed-native or platform acceptance.

Both pinned Codex patch hashes/byte counts remain unchanged, including the
594,405-byte explicit-construction increment. No installed runtime replacement,
editor launch, commit, push or movement activation occurred. The new internal
broker request is authenticated and actually used by both coordinator paths;
it is not yet a native owner-bound execution capability. Complete Gate 2 remains
open and the full goal remains active.

Next: connect the trusted native control channel's captured owner/reservation to
fresh approved broker state, then invoke explicit destination construction with
pending/acquired/cleanup census and complete native authority checks. Do not mint
an owner or native permit from the returned grant JSON or checkedAt value. The
full requirements for both production adapters, incompatible-writer exclusion,
complete destination provider/environment/MCP/tool readiness, journal/CAS/recovery,
exact same-conversation receiver acknowledgment/rebind/release and approved task
evidence through master acceptance remain in the closure audit above.


### Private native host owner/grant channel — 2026-10-28 (verified Unix component)

Previous turn was verified progress: real broker authorization and both internal
coordinator paths passed the complete 521-pass/14-skip JavaScript suite. Native
owner binding remained explicitly missing. This phase adds a distinct inherited
Unix stream for trusted host control, configured by a hidden descriptor argument
and default absent. It is bound to the actual initialized stdio connection's
native ContinuityOwner, not an owner field or client name in JSON. Target-thread
subscription is checked before/after the operation. Framing and pending requests
are bounded; EOF, malformed/unknown/overflow frames, lost writes and cancellation
close the native owner and invalidate its holds. The original descriptor is
caller-owned; the native copy is close-on-exec and the original is marked likewise.
This does not prove a complete descriptor/other-writer alias census.

Only acquisition and grant binding are exposed. Acquisition uses the actual
native submission queue. Native binding validates the owner/reservation and real
source/destination directory identities, retains those handles, and persists the
exact host-asserted broker record under native state/persistence locks. Equal
retries must match; foreign owner/generation/source/conversation and replaced
directories refuse. The host assertion is delivered on the trusted private
channel; broker grant JSON alone is not proof. Bound grants are refused by the
legacy cwd-only commit and release paths while complete authority and receiver
checks remain absent. Restart/disconnect keeps an unresolved quarantine.

The separate CodexNativeControl host client obtains native reservations and must
perform fresh receiver/credential-bound broker authorization before sending a
binding request. Adapter credentials stay on the host side. This port does not
expose commit, movement or release and is not enabled in the production proxy.
A focused 51-case JavaScript run (six new host-client cases plus coordinator/broker
coverage) and syntax checks passed. Initial app-server production compilation
passed after correcting ThreadId parsing to the native owning helper. The first
combined CLI check stopped on a missing offline addr2line dependency; it is not
passing CLI evidence. Native Core/app-server tests and final CLI check are pending.

The first native test build was stopped with SIGINT after real disk monitoring
showed only about 1.2 GiB free, not because of an observation timeout. After all
Cargo/rustc processes terminated, removed 171 disposable incremental sessions
under their exclusive locks, preserving source and compiled artifacts. Repeating
verification with command-local CARGO_INCREMENTAL=0 bounds cache growth. The
prior pinned 594,405-byte patch remains authoritative during verification.


Final outcomes supersede the initial pending verification notes above. The first
focused native grant run passed three/failed one: exact retry was refused by the
acquired-only preparation guard after the journal entered grant_bound. Corrected
binding to validate the retained record/directories directly on exact retry,
without widening ordinary preparation or enabling legacy commit/release. Final
Core library: **2,919/2,919**, zero ignored/failures, 92.77 seconds. All four affected
cases pass with RUST_MIN_STACK unset. Three private-channel app-server unit cases
pass; production app-server and CLI checks pass, and the standalone app-server
build passes. Fifty Core staging warnings and the macOS linker unwind warning
remain unsuppressed. Missing offline CLI dependencies were obtained through the
locked Cargo graph; no lockfile or global toolchain was changed.

Native verification again approached actual disk exhaustion. After stopping the
Cargo/compiler work, removed 195,404 loose code-generation/split-debug inputs
(35,932,731,160 logical bytes), preserving executables, libraries and source.
Those inputs are reconstructible; this does not preserve their optional debugger
information. Interrupted invocations remain distinct from the final green runs.
Subsequent builds used command-local CARGO_INCREMENTAL=0 with sufficient space.

The host now observes broker disconnect and owned membership removal, closes its
private descriptor and never silently reuses that native owner across broker
reconnection. Final host/broker/coordinator JavaScript scope: **53 passed**, zero
failures/skips (eight host cases). Syntax checks passed. The new host cases are
included in test:control. The full parent suite was not rerun; the prior complete
521-pass/14-skip result retains its original scope.

An opt-in real staged-process component passed with two actual native app-server
processes, a loopback model and real enrolled broker transport. Ordinary conversation
initialization precedes reservation; binding does not start inference to manufacture
readiness. Public stdio rejects acquisition. The private channel obtains a real
native reservation, binds the exact synthetic approved record, retains source cwd,
and journals grant_bound. EOF changes the journal to uncertain. Restart refuses
reactivation/reacquisition and leaves the broker transition unresolved. The resume
constraint is named native_continuity (underscore); corrected only the fixture's
error classifier after a diagnostic run proved the expected native mutation refusal.
No production guard was weakened. Broker capability/authority inputs are deliberately
synthetic in this component test and prove neither complete authority nor movement.

Promoted **631,404-byte** increment, SHA-256
`4ad200e667705475d5481870b042541685eeb88e9e278ca02bd88880431ee0a7`,
exact reconstructed tree `f0e661878e9d6f9ce40add3d94ee53ce50bf2205`.
Ten native files changed (739 insertions, one deletion) from the prior export;
nineteen new native files are covered. All ten source hashes match the verified
builds. Strict forward/reverse application and exact reconstructed-tree checks
passed. Staged app-server: 726,293,904 bytes, SHA-256
`61cee9e200e0166208393dd853ca254a27a366cae10dbdac0825597d3f357177`.
The immutable baseline remains unchanged. Installed runtimes, editors and live
profiles were not replaced/restarted; no commit/push or movement activation.

Next: explicit destination resource-establishment approval and native pending/
acquired/cleanup ownership, kept distinct from final complete movement authority.
Do not recycle synthetic authority digests or a host-bound record as resource
readiness. Native provider construction must consume its approved scope and retain
actual resource owners/aliases; then complete provider/environment/MCP/tool state,
writer exclusion, native commit/recovery and exact receiver acknowledgment/rebind/
release remain required for both adapters and platform/live task/master acceptance.
Gate 2 and the full goal remain open.


### Scoped provider-establishment approval — 2026-10-28

Previous goal turn was verified progress: the private Unix owner/grant channel
was built, tested in real native processes, exported and pinned. This phase fixes
the approval bootstrapping gap: final movement authority cannot be fabricated just
to authorize the startup needed to discover destination resources.

Added an `establish-provider` purpose to preview/grant/settlement contracts. The
closed `provider_factory` plan references a native candidate, actual reservation,
participant/source/destination, selected provider/family, process generation and
opaque digest. Operator approval and receiver-authenticated fresh authorization
are separate from movement authority; constructor API support can be recorded
while sameConversationWorktree is false. Mixed scopes, arbitrary kinds, wrong plan/
reservation/process receipts and destination placement on construction refuse.
The current native movement-record binding rejects this purpose before any I/O.
No native constructor is invoked by the new broker contract yet.

A centralized hold predicate treats established provider contexts as still owned.
Applied it to validation, managed effects, native transition admission, task dispatch,
ready-task selection, storage diagnostics and history pinning. Found and fixed a
conversation-wide dispatch gap: an unresolved transition for one task previously
did not exclude scheduler admission of another task belonging to the same participant.
A resource approval also cannot satisfy task movement approval after a known
no-effect failure. Once a constructed receipt exists, failure cannot erase ownership;
uncertainty retains the original receipt, including through successful-command
replay and restart. Actual cleanup and dependent movement handoff remain deferred.

SQLite/export schema 18 prevents old reducers from dropping the new held state.
Legacy command shapes/defaults remain byte-compatible; migration does not rewrite
existing state/receipts. Pre-18 data cannot disguise new provider resource records.
The first complete run found two remaining migration fixtures still expecting
schema 17; corrected only their final-version assertions, preserving raw-byte,
audit and receipt-preservation checks. Final complete JavaScript suite: **538
passed, 15 opt-in/platform skips, zero failures (553 total)** in 137.59 seconds,
with serial test files. Syntax checks passed. The seven new broker cases and
real receiver-authenticated wire test cover scoped approval/authorization and
retained ownership; these are contract fixtures, not native resource readiness.

Two counterfactual runs used isolated source copies: removing the established
resource hold fails the retained-ownership test, and allowing provider approval
to satisfy movement approval fails the scope-separation test. Authoritative source
was not mutated. Native source/export and installed runtimes remain unchanged;
no live-profile migration, editor restart, commit/push or execution activation.

Next is the native plan producer and exactly-once approved factory effect through
the private owner channel, with pending/acquired/cleanup ownership and actual
shared-resource classification. The approval contract is now available without
claiming complete destination authority. Complete provider/environment/MCP/tool
readiness, all writer/alias exclusion, native commit/recovery, exact receiver
handoff, both production adapters and live/platform/master acceptance remain in
the full Gate 2 audit. Goal remains active and Gate 2 remains open.

Final schema-18 compatibility check also passed the staged native stdio/private
channel disconnect/restart component using the unchanged pinned binary and its
explicit synthetic readiness preconditions. All 22 changed source/test hashes
match the frozen full-suite input. Both native patch byte counts/hashes remain
unchanged; whitespace checks pass. Provider-establishment execution and movement
remain disabled. No native plan producer/factory consumer is claimed complete.


## Provider-only native preparation — 2026-10-28

The native provider factory scope now has separate reservation-bound preparation
and revalidation, retaining the actual native destination Config and selected
provider inputs. Full destination preparation reuses it and retains its additional
model/instruction checks. Both the future and owned result remain boxed. No
constructor or credential callback runs in this narrower preparation phase.
Instruction changes alone remain outside its readiness contract; constructor
configuration changes, native runtime/provider changes, foreign/closed owners and
stale reservations remain refused.

Verification: 2,920/2,920 Core library tests passed; seven affected destination
assembly cases passed without a stack override. The new provider-scope case passed
on the default stack and covers instruction-only changes, configuration drift,
foreign/closed owners, stale reservations and unchanged published settings.
The 635,786-byte native increment reconstructs exactly and reverse-checks; SHA-256
`482588ed8bdfdb6cdadb7838126c3381871a0b672fb6ea03e84e5a9aaa2c1585`.
Logs: `/tmp/turnlink-provider-scope-tests.log`,
`/tmp/turnlink-provider-scope-default-stack.log`, and
`/tmp/turnlink-provider-scope-core-full.log`. Two changed native source hashes are
retained in `/tmp/turnlink-provider-scope-source-freeze.json`.

The previous app-server executable was not rebuilt; previous entrypoint and process
component results do not cover this new source increment. No installed runtime,
live broker or editor was changed. Factory registries inspected during this step
retain weak references, but live provider aliases can share resources; this is not
a cleanup proof. The native opaque plan producer, approved factory invocation,
retained ownership/census and cleanup/handoff remain unwired. Complete authority,
commit/receiver continuity, both adapters and platform acceptance remain open.
Gate 2 remains open and movement remains disabled.


## Approved native provider-factory construction — 2026-10-28

Implemented the concrete Codex native effect rather than treating broker approval
or a configuration digest as readiness. `planProvider` retains actual native Config,
selected provider/base-auth preparation and source/destination directory identities.
The disclosure binds an opaque plan ID, native process generation, exact reservation,
paths, selected provider/family and commitment. It is not executable authority.
The host retains the observed plan and checks fresh broker authorization for the
exact `establish-provider` grant immediately before `constructProvider`. Core
checks its actual owner/reservation, exact retained plan and scoped digest.

The native journal persists `provider_pending` before factory invocation. There
is no await between intent, the synchronous ordinary factory and retention of the
actual provider/Config. Success persists `provider_constructed` and a resource
receipt. Pending/error/receipt loss retains quarantine; duplicate effects refuse.
Legacy commit is blocked even before construction once a provider plan is retained;
legacy release cannot discard pending or constructed resources. The broker's
`established` receipt continues to hold the task and conversation.

Real-process verification initially refused normal source reconstruction. Static
stage diagnostics and temporary field-name-only comparisons identified native
startup token-budget state and app-server `codex_self_exe` inputs. Startup now binds
configured preferences and actual activation at its owning producer; ConfigManager
binds its actual executable/sandbox inputs into captured constructor overrides.
Missing/tampered bindings, different original preferences, unbound executable edits
and unrelated Config changes still refuse. No model/auth callback is replayed during
preparation. Temporary field comparisons were removed before the accepted binary.

Final accepted verification on frozen source:

- Core: 2,926/2,926 library tests; five provenance/enforcer cases and three factory
  cases also pass with `RUST_MIN_STACK` explicitly unset.
- App-server: four private-control cases; both app-server/CLI production checks and
  standalone app-server build passed. Native sandbox-enabled V8 settings retained.
- JavaScript: 545 passes, 16 opt-in/platform skips, zero failures; syntax checks pass.
- Staged Unix process: two passes. One uses a genuine native provider plan, actual
  explicit operator approval, fresh enrolled-receiver broker authorization, the
  real factory and native/broker receipt holds through disconnect/restart. Its
  capability advertisement is a component fixture, not full production readiness.
  The movement-record case still has synthetic authority inputs and proves no move.
- Isolated removal of the host digest guard failed the authorization-boundary test
  as expected; authoritative source was unchanged.

Accepted logs: `/tmp/turnlink-provider-effect-provenance-final-tests.log`,
`/tmp/turnlink-provider-effect-default-stack-final.log`,
`/tmp/turnlink-provider-effect-all-core-final.log`,
`/tmp/turnlink-provider-effect-all-entrypoints-final.log`,
`/tmp/turnlink-provider-effect-all-app-tests-final.log`,
`/tmp/turnlink-provider-effect-all-parent-final.log`, and
`/tmp/turnlink-provider-effect-native-process-final.log`.
The source freeze covers 16 implementation/test files. The native delta from the
preceding provider-only checkpoint is 13 files, 805 insertions and eight deletions.

The increment is 671,648 bytes, SHA-256
`18bbc69ec105374c17a14536d3438c5dd6d455165bba79510d649faac9e3e735`,
reconstructed tree `f6d21ea584eaa7c7a6813a502c3545785ffbff09`.
Strict baseline-plus-increment reconstruction, reverse application and whitespace
checks pass; the immutable 52,157-byte baseline is unchanged. The accepted staged
app-server is 727,240,656 bytes, SHA-256
`47b53f5c28b5c8cff78730c0a417a9c9153aafebbe47dbb3d218071223f96cea`.
Only test-source additions followed its production build; production code matches.

Failed/interrupted observations remain separate: the direct legacy-commit test
reproduced a default-stack overflow and was changed to use the actual production
submission queue, after which the unchanged stack limit passed; early process
runs exposed the missing startup/path provenance above. A test-only path API typo
was corrected before final compilation. No assertions, ownership guards or stack
limits were weakened. To maintain build space, with Cargo/rustc stopped, 3,468
optional split-debug/code-generation inputs (6,483,846,336 logical bytes) were
reclaimed; executables, libraries, metadata and source were preserved. Optional
debug inputs are regenerable and were not claimed preserved.

The full seventeen-root native suite was not rerun. This is configured-provider
process acceptance, not complete provider/tool/MCP/credential or placement readiness.
There is no cleanup/disposal/handoff operation or live provider installation.
Provider aliases and process-shared state still require census; process death is
not a broker disposal proof. Mutable callback/permission freshness, complete native
authority, commit/CAS/recovery, exact receiver acknowledgement/rebind, OpenCode
parity, full task/evidence/report/master acceptance and platform evidence remain
open. Installed runtimes, live profiles/brokers and editors were unchanged.
Gate 2 remains open; production native control and movement remain disabled.


## Unpublished provider-owner cleanup — 2026-10-28

Continued the unchanged full Gate 2 objective. Implemented actual abort cleanup
for the newly established provider scope. This does not close the whole resource
cleanup/census item: active contexts, closed owners and other resource classes
remain required.

Native provider access now permanently records exposure. The consuming unpublished
release checks `Arc::get_mut`, excluding strong and weak aliases without a count
race, and returns ownership intact on refusal. Known configured/GCP/Bedrock factory
owners release through the same closed implementation. The proof releases this
owner's share only, never claims destruction of shared account/global state.
Core checks actual owner/reservation/resource identity, journals
`provider_cleanup_pending`, drops the provider and retained Config/preparation
handles, verifies source identity, then journals `owner_released` before releasing
admission. There is no await through that sequence. Exposed/aliased providers,
persistence errors or uncertain outcomes retain native quarantine. Exact retries
are tied to the original native owner; a new reservation cannot reuse the proof.

The trusted host remembers the native construction receipt and obtains fresh
`cleanup-provider` authorization for the exact current broker record. It does not
serialize credentials to native control or replay uncertain disposal. Broker
schema/export 19 accepts failed provider setup with retained construction history
only when the cleanup proof matches the complete original resource receipt and
source path. Generic failure cannot clear ownership. Cancelled setup can be cleaned
without revival; capability/idle revocation cannot strand this unused resource.
No cleanup receipt satisfies movement/worktree approval. Older schema 18 records
migrate without rewriting receipts; new cleanup cannot masquerade as schema 18.

Accepted verification:

- Core library: 2,928 passed; the two new cleanup cases also pass on default stack.
- Model-provider library: 134 passed; three default-stack cleanup cases cover all
  native families, strong/weak alias refusal and permanent exposure refusal.
- Both production entrypoint checks, five private-channel cases and standalone
  app-server build passed; sandbox-enabled V8 and normal warnings retained.
- Parent suite: 553 passed, 17 opt-in/platform skips, zero failures. Focused broker/
  host scope: 31 passed. Isolated removal of the complete resource comparison
  fails the foreign-owner cleanup test as expected.
- Real staged Unix process: three passed. The cleanup case constructs an approved
  native provider, disposes its unpublished owner, proves the broker holds until
  receipt acknowledgement, then completes another ordinary turn in the same
  source conversation. The other two retain their binding/construction and
  disconnect/restart-quarantine scope. No full migration/master acceptance claimed.

Logs use `/tmp/turnlink-provider-cleanup-`: `core-full.log`, `model-full.log`,
`core-focused.log`, `model-focused.log`, `entrypoints.log`, `app-tests.log`,
`app-build.log`, `parent-accepted.log`, `native-process-final.log`,
`root-final-focused.log` and `owner-match-red.log`. Two initial focused assertions
were corrected to reach the existing idle/approval guards and use their actual
error code; production guards were not weakened. The final source freeze covers
25 files. The native delta is seven files, 408 insertions and two deletions.

The 688,318-byte increment reconstructs tree
`40a60b523e3c35bd96b5c9b4f2d0f2d5e4381daa`; SHA-256
`94b04d84ff25f560dd603ee47764273300a3b824251933d3fc7979dcbbe42fc3`.
Forward/reverse/whitespace checks pass; immutable baseline unchanged. Staged binary:
727,382,640 bytes, SHA-256
`3f81b3ba60eb72a43300c218a39ac25b46cacde4715d831692642399687e7c25`.
The seventeen-root native suite was not rerun. Installed runtimes, live profiles,
production brokers and editors were unchanged; production movement stays disabled.

Still required for Gate 2: complete effective destination authority and all
resource/consumer/alias/orphan coverage; live permission/callback freshness;
active-resource cleanup and closed-owner/crash reconciliation; native placement
commit/CAS/recovery; exact receiver acknowledgement/rebind; both production
adapters including OpenCode; complete task/evidence/report/master acceptance and
remaining platform evidence. A Windows test-host endpoint has been requested
asynchronously; other implementation work remains authorized and must continue.
The long-running goal tracker still reports its previous blocked status; this
checkpoint does not claim automatic background execution or Gate 2 completion.


## Native immutable policy-rule provenance — 2026-10-28

Native constraints now distinguish fixed rules with owned immutable policy data
from arbitrary validators and normalizers. Native requirement factories, permission
snapshot projection, MCP allowlist normalization and deny-read composition retain
this provenance at their actual construction boundaries. Generic callbacks remain
opaque even when allocation identity and current values match. Unknown equality
implementations cannot certify captured state. Appending a generic validator
invalidates the classification; projection cannot upgrade an opaque base rule.
The specialized native rule entrypoints accept policy data, with no caller freshness boolean.

Destination preparation can inspect this scoped fact for source and destination
Config bindings and the actual retained runtime approval/permission constraints.
The check does not invoke callbacks, approve values, establish resources or grant
placement authority. Existing enforcer identity, configuration/policy/source epochs
and reservation fences remain necessary. Complete callback/live-permission
freshness and complete destination authority remain open; their manifest flags
stay false. No commit, receiver release or production activation was added.

Verification at the nine-file native freeze: **403 Config tests**, **2,930 Core
tests**, five focused native-rule tests and two destination-enforcer tests passed.
The seven focused tests ran without a stack override. Both production entrypoint
checks, five private-channel tests, the staged executable build and three actual
private-channel process cases passed. The process cases retain their binding,
provider construction/quarantine and unpublished cleanup/source-continuation scope;
they do not prove full migration. Core normal-library warnings number 30 and the
Mac linker unwind warning remains unsuppressed. Parent JS source is unchanged:
the preceding 553-pass/17-skip checkpoint is retained, not reported as rerun.
The seventeen-root native suite and Windows acceptance were not rerun.

Two initial focused compile errors were corrected (the public MCP requirement
path and the actual Disabled permission-profile enum variant); production policy
checks were not weakened. Logs use `/tmp/turnlink-closed-rules-`: `config-focused`,
`core-focused`, `config-full`, `core-full`, `entrypoints`, `app-tests`, `app-build`
and `native-process`, with `.log` suffixes. Optional standalone debug object inputs
were reclaimed with no Cargo/rustc active; libraries, metadata, executables and
sources were retained. This does not preserve all optional debug objects.

The native increment is **724,747 bytes**, SHA-256
`a1c094cfba494d1ebb9f8a20c82222afaf11f73eb329635a9b7c6ba50c56564a`,
reconstructing tree `874bf626bdd2ba59d1cd449b00547a8b856383ee` from the unchanged
baseline. Strict forward/reverse/whitespace checks passed. The staged app-server
is **727,417,648 bytes**, SHA-256 `5a62956ab7fe133fe16b963ba3cecad2b9c082270423b949f747c9a4c5380763`.
Installed runtimes, live profiles/brokers and editors were unchanged.

Gate 2 remains open for complete destination tool/MCP/provider/environment/model
readiness, the complete consumer/resource/alias/orphan census, active and closed-owner
cleanup/recovery, native placement commit and receiver acknowledgement/rebind,
OpenCode and both production adapters, full task/evidence/report/master acceptance
and required platform evidence. The Windows endpoint question remains pending.
The historical goal tracker remains blocked; this checkpoint does not claim
background execution or completion of the full user objective.


## Native MCP retained-request exclusion — 2026-10-28

Continued the active full Gate 2 objective. This checkpoint closes a concrete
request-exclusion hole, not the overall MCP/resource census. Previously an old
binding or prepared call could retain its original connections after runtime
replacement and operate outside the session admission fence.

An actual native request owner now follows MCP runtime publications into native
client factories and clients. Client operations enter before OAuth/request work;
retained prepared calls enter before irreversible caller preparation, including
sandbox capability probes. Native request permits span their futures; event
requests retain a private permit until an actual response is received. Moving a
raw request handle away abandons the private permit and retains uncertainty.
Cancellation and outer errors do not become proof of stopped server work. Ordinary
MCP remains available after an uncertain operation, but continuity request
exclusion cannot be acquired from that state. No caller-supplied JSON or reference
count manufactures an exclusion capability.

Continuity acquisition retains this request exclusion with its real native
reservation. Source release drops it. Restored unresolved journals retire the
fresh request owner and suspend MCP startup while keeping the conversation
quarantined; this does not advertise an empty destination as ready. Background
refresh/publication paths now also acquire session admission. A refused publication
cannot replace configuration/plugin scopes or clear refresh invalidation. Native
runtime construction/publication is fallible, and its first-party callers handle
that result. The native wrapper future is boxed to preserve bounded caller types
and stacks; the initial compiler recursion overflow was fixed at this boundary,
not by raising the recursion limit.

Verification at the fifteen-file native freeze:

- Core library: **2,931 passed**; MCP library: **272 passed**; RMCP client library:
  **263 passed**, one child-only harness entry ignored in the parent enumeration.
  Its owning store-lock test actually invoked and passed that child subprocess.
- Seven new fence/alias/publication/quarantine tests passed on the default stack.
  Actual captured old/new calls cannot invoke preparation while excluded.
- The existing current-auth integration test passed from its unchanged source body,
  including on the default stack. It runs a real local MCP fixture and proves
  calls use the AuthManager token updated after construction. A temporary Cargo
  test-target symlink exposed only that original test; it was removed afterward.
  Both aggregate integration build attempts failed for disk space, including the
  final-target-only debug-info reduction attempt. No aggregate-suite pass claimed;
  the accepted isolated test used the normal test profile.
- Both normal production entrypoint binaries built. Three staged private-channel
  process cases passed in the warm run, retaining binding/restart quarantine,
  provider construction, and cleanup/same-source continuation scope.

Failed-run history remains explicit. The first full MCP run lacked a staged Codex
CLI; after building it, the first capability probe exceeded its five-second bound.
An isolated CLI help/readiness probe then completed in 185 ms; the full MCP suite
passed with isolated application homes. The first rebuilt app-server initialization
exceeded the existing 30-second bound; the subsequent two cases passed and the
separate warm run passed all three. The exact cold-start cause is not established.
Cold-start/platform acceptance remains open; no timeout or assertion was weakened.
Normal Core staging warnings number 30 and the Mac linker unwind warning remains
unsuppressed. Parent JavaScript source is unchanged; its preceding 553-pass/17-skip
checkpoint is retained rather than claimed as rerun. OpenCode was not changed.

Logs use `/tmp/turnlink-mcp-request-`: `tests-compile`, `core-full`, `mcp-full`,
`rmcp-full`, `owner-focused`, `binding-focused`, `core-focused`, `native-build`,
`native-process-warm`, `auth-integration-isolated` and
`auth-integration-default-stack`, with `.log` suffixes. Initial missing-binary,
first-probe and first-initialization failures remain in `mcp-full-initial`,
`mcp-full-cli-first` and `native-process-initial`; aggregate build failures remain
recorded separately. The incorrect test approval enum was corrected to the existing
Approve variant before acceptance; production guards were not weakened.

To recover build space, optional standalone debug object inputs were reclaimed
only with no Cargo/rustc active. Thirty-six inactive previous test binaries were
then losslessly archived, each decompressed and SHA-256 verified before its original
cache file was removed. Current executables, libraries, metadata and source remain
in place. The archive index is
`.native-runtimes/codex-test-artifact-archive/index.jsonl`, with original paths,
permissions, timestamps and content hashes for restoration. This preserves old
binary bytes, not immediate executability at their former cache paths. No installed
runtime, live profile, production broker or editor was changed.

The **778,036-byte** increment, SHA-256
`1396593829ab48a0c886b46219357e781a846fc75650c167dc9aba4c462b5dc0`,
reconstructs tree `1b34dca40ab3de0437d0da7a103d5276f3f12738` over the unchanged
baseline; strict forward/reverse/whitespace checks passed. Staged app-server:
**729,800,048 bytes**, SHA-256
`0cdac0b0c15ad2459a0a79a5927cf0aa61bb24602f8aa3d3adfc6df185a93c00`. Staged CLI:
**933,425,320 bytes**, SHA-256
`ae8373c65ffb776ec5b850daa26f983c8cfb71837ab22c87ec5ab4c63e10c9bf`.

Still required for the unchanged full objective: autonomous/background MCP
resource ownership, internal/raw SDK aliases and uncertain-resource reconciliation;
fresh live catalogs and complete destination provider/model/MCP/tool/environment
establishment; the full writer/consumer/alias/orphan census and physical cleanup;
native placement commit/CAS/recovery and exact receiver acknowledgement/rebind;
OpenCode and both production adapters; full task/evidence/report/master acceptance,
cold startup and required platform evidence. Unknown outer failures conservatively
retain request uncertainty; a typed physical reconciliation path remains required.
The Windows endpoint question remains unanswered. All movement/full-authority
flags remain false. The goal tracker is active; this is progress toward the whole
objective and is not a request for another user "proceed" instruction.


## Effective destination runtime policy inputs — 2026-10-28

The full Gate 2 objective remains active. Destination data preparation now retains
actual source approval and permission selections with both source and target native
rules. The rule intersection refuses opaque callbacks, normalizers and unknown
value types before invoking their callbacks or Clone implementations. Permission
profile identity and roots remain intact. Ordinary session/environment/guardian
validation runs against the target constructor configuration; shared in-place
runtime projection supplies actual selected model/provider inputs. Provider-based
web/tool readiness still requires approved target resources.

The binding covers actual effective and requirement enforcers, including equal-value
replacement of six requirement rules. Revalidation checks those identities plus
the saved runtime rules and reconstructs the effective projection. Full preparation
rejects opaque source rules before candidate creation. The original target Config
and the effective runtime Config remain distinct, with constructor lineage retained.

At the seven-file source freeze, all 406 Config and 2,933 Core library tests passed.
Fourteen focused cases passed on the default stack. Both native entrypoints built;
three unchanged private-channel process cases passed. The first app-server launch
after this build initialized in 15.88 seconds, inside the existing 30-second bound.
That diagnostic initializes only: it does not establish cold migration acceptance.
Earlier startup failures remain recorded. No timeout or production guard changed.

The initial new test fixture changed selections without updating its captured
environment and was correctly refused. The fixture was corrected to retain actual
selections and tighten only their enforcers. An initial test compilation exhausted
disk; optional debug object inputs were reclaimed and five additional inactive
binaries were losslessly archived with verified hashes in the existing archive
index. Normal Core staging warnings number 31; linker warnings remain unsuppressed.
Parent JavaScript, OpenCode and the full selected-root suite were not rerun.

Logs and freeze/export/artifact evidence use `/tmp/turnlink-effective-runtime-`.
The current increment is 799,917 bytes, SHA-256
`e129bee20dba25b3cdde16a21b8cf7a9303cfd8bac3644575fa5b9a3deeb2fd3`,
reconstructing tree `cbe4c0eeec4c1e2d3e61e892482b54988eff8c52`; export strict
forward, reverse and whitespace checks passed. Binary hashes are in the manifest.

Still required: complete target provider/model/MCP/tool/environment establishment,
resource/alias/consumer ownership and cleanup, native commit/CAS/recovery, exact
conversation receiver acknowledgement/rebind, both production adapters and OpenCode,
full task/evidence/report/master acceptance and required platform evidence.
Windows host details remain unavailable; independent implementation can continue.
All full-authority, production-port and movement flags remain false.

## Native acquisition outcome integration — 2026-10-29

Native acquisition now returns a typed distinction between refusal before owner/
journal installation and failure/uncertainty. Only the exact private native result
allows the host to retain its channel. Existing reservations/restored quarantine,
unreadable journals, post-install failure, transport loss and malformed replies
remain errors. Error text cannot mint the no-effect outcome. The host performs no
automatic retry, and refusal is not absence-of-prior-owner or movement authority.

Verification: 2,935 Core and 406 Config tests; two new default-stack native tests;
22 host cases; complete serial parent suite 555 passed/17 opt-in or platform skips;
app-server production dependency check, both entrypoint builds, and three warm native
process cases passed. One process case now holds an actual conversation's model
response, verifies refusal without a journal, completes that same turn, and
explicitly acquires through the same private owner. Restart quarantine continues
to return the uncertain/unavailable result. Existing provider construction and
unpublished cleanup/source-continuation cases retain their original scope.
The first rebuilt process exceeded the unchanged 30-second initialize bound;
its failure remains in `native-process-initial.log`. The separate warm run passed
all three cases, including the new actual busy-turn scenario. Cold startup remains
unresolved and is not inferred from the warm pass. The earlier 15.88-second
initialization evidence belongs to the preceding effective-runtime artifact.
The parent run began before the opt-in process fixture edit; that fixture was
skipped there and was exercised separately against the rebuilt native executable.

The frozen five-file native delta exports an 806,216-byte increment, SHA-256
`ada16fe25661970715ed7000441e108402b4ce02551ace916946dab3b51cf747`,
reconstructing tree `05c07ac037cb3dd28b4abb0dbf8dcf14308f0d39`. Strict forward,
reverse and whitespace checks passed. Binary hashes are in the manifest and
`/tmp/turnlink-acquisition-artifacts.json`; test/build logs, freeze and export use
the same prefix. Before rebuilding, 1,289 optional standalone debug object inputs
(3,094,901,296 bytes) were reclaimed with no Cargo/rustc active. Libraries,
metadata, current executables, sources and installed runtimes were preserved.
The initial CLI link exhausted disk after the app-server succeeded; its original
log remains in `native-build-disk-failure.log`. With no compiler active, another
914 optional standalone object files (1,733,601,432 bytes) were reclaimed before
the unchanged retry. Core staging warnings remain 31; linker warnings are
unsuppressed.

The complete Gate 2 objective remains active. This prerequisite does not complete
target resource establishment, ownership/cleanup census, native commit/CAS and
recovery, exact receiver acknowledgement/rebind, both production adapters,
OpenCode native movement, full task/evidence/report/master acceptance or required
platform evidence. Full-authority, production-port and movement flags stay false.


## Approved target model-context construction — 2026-10-29

The full Gate 2 implementation now has an explicit `provider_context` plan scope,
separate from the original factory-only plan. Native disclosures bind the actual
selected model, target configured/provider-default catalog, ordinary native cache
configuration and API-key discovery setting; the commitment also binds actual
catalog and model-override inputs. The actual retained native plan must match
fresh broker authorization before construction. Factory-only plans/receipts
cannot acquire or impersonate the new scope.

Native construction retains the target provider's ordinary manager and metadata
observation under the actual resource owner. It uses provider-specific catalog
normalization, target catalog data and native selected model overrides. It starts
no catalog request, credential helper/refresh, disk-cache I/O, MCP/tool/environment
startup or session publication. The larger context stays on the heap. Revalidation
checks the actual manager/config/auth observation. Unpublished cleanup drops its
own metadata alias, checks actual Arc exclusivity including weak aliases, and
retains physical ownership on refusal. Failed cleanup invalidates metadata rather
than retaining reusable ready data. Broader uncertain/exposed-resource
reconciliation is still required; this is not full runtime cleanup.

Schema/export 20 preserves model-context resource/cleanup holds and refuses them
when disguised as schema/export 19. Factory-only records continue to migrate.
Review caught canonical key reordering that would break schema-19 factory command
fingerprints. An actual stored-legacy-receipt regression failed with
COMMAND_IDEMPOTENCY_CONFLICT before the fix and passed after preserving the old
factory field order. The initial wrong Rust Feature module path and expected test
refusal code were corrected; production guards/assertions were not weakened.

Verification: **2,936 Core**, **406 Config**, **136 model-provider** library cases
passed in the explicit three-root feature union. Three new native cases passed
on default stack. Changed host/broker scope passed **40**; the final complete
serial parent run passed **562**, with **19** opt-in/platform skips. Both native
entrypoints built. Five warm private-channel process cases passed, adding actual
model-context construction/restart quarantine and model-context cleanup followed
by an ordinary turn in the same source conversation. Existing busy-turn refusal,
factory construction, cleanup and quarantine checks remain covered.

The first launch after build initialized in **20.66 seconds**,
inside the unchanged 30-second bound.
That separate diagnostic initializes only, before session/grant creation; it does
not prove cold migration acceptance. Historical startup failures remain recorded.
Logs, source freeze, test binary paths, first-initialize diagnostic, export and
artifact hashes use `/tmp/turnlink-model-context-`. Current increment:
**820,828 bytes**, SHA-256
`eec26e0d4591689ec52e94cba4662baedf09db22df78c4158ee7d6ef034b521c`,
reconstructing tree `cc634a0da2697c5fd2a9788c7c27b3540f4fb431`; strict forward,
reverse and whitespace checks passed. Binary hashes are in the manifest.

For space, eight inactive previous test binaries were losslessly archived with
verified decompression hashes, modes and timestamps in the existing archive index,
reclaiming 2,231,738,155 bytes. Their bytes are preserved, not immediate
executability at former cache paths. Installed/staged entrypoints, libraries,
metadata and sources were preserved. Before rebuilding, 714 optional standalone
compiler objects (1,735,929,104 bytes) were reclaimed with no Cargo/rustc active.
Normal Core staging warnings remain 31 and the linker warning is unsuppressed.

Still required for the unchanged full objective: approved fresh catalog/auth and
MCP/tool/environment establishment, complete writer/consumer/alias/orphan ownership
and physical reconciliation, native placement commit/CAS/recovery and exact
receiver acknowledgement/rebind, OpenCode and both production adapters, complete
task/evidence/report/master acceptance and required platform evidence. Windows
host details remain unavailable. Full-authority, production-port and movement
flags remain false; the full goal remains active.


## Native provider ownership observation and reply recovery — 2026-10-29

Provider construction/cleanup timeouts and explicit native effect errors now
retain the private owner in an uncertain host state. No effect is automatically
resent. Fresh broker `observe-provider` authorization precedes a read-only native
custody query. Only actual retained objects under the same open owner/process or
its actual completed cleanup record can produce an observation. Foreign/closed
owners and restored journals cannot manufacture custody. Bounded timed-out reply
correlations are retired only after observation; late replies are discarded and
cannot become unsolicited readiness or trigger replay. An observed owner still
requires separate fresh cleanup authorization.

Native effect intent reserves an ownership ID before construction, without making
that pending intent positive evidence. Once an actual object is retained, a
partial construction can be observed as `retained`; it can only enter broker
`uncertain` ownership, never `established` readiness. Existing ownership receipts
cannot be replaced by another resource. Schema/export 21 protects the retained
phase against older reducers or rehashed schema-20 exports, while preserving older
factory/model-context records and command fingerprints.

Cleanup validates the same live owner, exact receipt/reservation, actual exclusion
and source witness even after invalidation. A failed cleanup retry must use its
original ID. After actual object/config disposal, the source directory witness
and admission remain held until durable completion. A failed final write can
finish that exact receipt without disposing again. The native observation labels
that interval `cleanup_pending`, not completed release. A completed cleanup reply
can be recovered read-only from actual native completion memory.

Verification: **2,938 Core** (one child-only entry ignored by enumeration but
actually invoked and passed by its parent), **406 Config**, **136 model-provider**;
two new default-stack parent cases and their real filesystem-fault child passed.
The isolated child uses RLIMIT_FSIZE/SIGXFSZ handling only in its own process to
allow pending intent but fail the larger final journal write. It proves actual
objects are gone, admission remains held, wrong-ID retry refuses, and same-ID
retry durably completes. The first focused run exposed invalidation's `uncertain`
phase missing from cleanup recovery. The implementation was corrected without
weakening owner/resource checks; the failed run remains recorded.

Changed host/broker scope: **46 passed**. Complete final parent suite:
**568 passed / 21 opt-in or platform skips**. Both native entrypoints built.
Seven warm process cases passed. The two added cases actually drop a native
construction or cleanup reply, recover the native ownership/completion record,
assert exactly one corresponding effect request, release exact broker holds and
continue an ordinary turn in the same source conversation. Existing construction,
model-context cleanup, busy-turn and restart-quarantine cases remain covered.
The first process run passed six cases; the new construction-recovery fixture
incorrectly compared the original native prepared grant with the broker's later
uncertain record. Its comparison now checks the original immutable native grant;
all seven passed afterward. The initial run remains recorded. The parent suite
skipped this opt-in fixture and its corrected body was exercised separately.
First public initialization after this build took **18.258
seconds**, inside the existing 30-second bound;
that diagnostic proves initialization only, not cold migration acceptance.

Logs, six-file source freeze and artifacts use `/tmp/turnlink-provider-recovery-`.
The **835,547-byte** increment, SHA-256
`63e9a701b543d0bf6c2bc4b808954668a749d1d392c23c00cfd43720f591ac29`,
reconstructs tree `5be6ff3e4449d5b03ca6c5fee3e111a3d713f6e3`; strict forward,
reverse and whitespace checks passed. Binary hashes are in the manifest. With no
Cargo/rustc active, 1,611 optional standalone compiler objects (3,439,244,496 bytes)
were reclaimed before the corrected test build and 86 (639,845,624 bytes) before
the entrypoint build. Libraries, metadata, installed/staged runtimes, sources and
user data were preserved. Core staging warnings remain 31; linker warnings are
unsuppressed.

The full goal remains active. Hard disconnect/new-owner and process-restart
physical reconciliation, exposed/global/SDK/orphan resource ownership, full
catalog/auth/MCP/tool/environment establishment, complete authority/census,
placement commit/CAS/recovery, exact receiver acknowledgement/rebind, OpenCode,
both production adapters and complete task/evidence/report/master/platform
acceptance remain required. Windows host details are still unavailable.
Full-authority, production-port and movement flags remain false.


## Strict catalog publication data — 2026-10-29

The ordinary native picker can fall back after an endpoint error, skip discovery,
ignore identity drift and ignore a refused publication. Those outcomes cannot
stand in for fresh destination catalog data. A separate explicit-effect native
API now returns a private-field response/publication observation only after an
actual registered endpoint response is published under current identity.

The observation binds actual catalog/discovery/refresh allocation identities and
records response-model membership separately from merged bundled fallback. It
reports native cache-write outcome explicitly, including failed persistence rather
than hiding it behind fresh memory. A later refresh, active work, identity change
or publication drift invalidates it. Errors/cancelled refresh futures retain
uncertainty for this strict data domain; no successful later picker retry silently
clears it. Ordinary picker fallback, retries and non-fatal cache behavior remain
available. Endpoint identity callbacks run before the observation's native locks.

This remains a data primitive: callers must independently bind concrete endpoint/
cache implementations, authorize effects and own actual work/resource lifetimes.
It is not credential freshness, global request quiescence, callback closure,
execution authority or a broker-approved catalog/bootstrap operation. Native Core
has not yet been wired to run approved catalog/auth work through this API; no
factory-only grant was broadened to permit network/helpers/cache writes.

Verification: **69 model-manager** and **137 model-provider** library cases
passed. Six new catalog cases passed on the default stack: response versus
fallback provenance, identity drift before publication, cancellation, cache-write
failure, skipped/failed fetches and publication refusal after cache work. The new
built-in-provider loopback HTTP test also passed on default stack, verifying the
actual authenticated request and native cache file contents. The app-server
production graph check and both normal entrypoint builds passed. Seven existing
warm private-control process cases passed against the rebuilt executable; they
retain their prior ownership/quarantine/cleanup scope and do not certify new
catalog-grant integration. Core and parent suites were not rerun; their preceding
2,938 Core (plus parent-invoked child), 568-parent/21-skip checkpoint remains
historical. OpenCode native scope was unchanged.

First public initialization after the final normal build took
**13.045 seconds**, inside
the unchanged 30-second bound. This is initialization only, not cold migration
acceptance. Logs, three-file source freeze, export and artifacts use
`/tmp/turnlink-strict-catalog-`. The initial missing Debug derive and incorrect
fixture constructor were fixed before acceptance. Current increment:
**856,263 bytes**, SHA-256
`d56ef621ece167e671d2208519f913d7ddc3e04c94cbba241f1edcce152705fc`,
reconstructing tree `f9db31a3440e6e1847079a9e49775c4146910d02`; strict forward,
reverse and whitespace checks passed. Binary hashes are in the manifest.

Build history preserves two disk failures: alternate library-root preparation,
then initial CLI dependency preparation. The successful retry used the actual CLI
root graph, followed by the normal locked/offline entrypoint build with no custom
compiler arguments. Eight inactive test binaries were losslessly archived with
verified decompression, reclaiming 2,545,043,240 bytes. Another 128 inactive library/
metadata files created during the failed alternate-root build were likewise
archived (1,031,889,446 bytes reclaimed). Twenty-one inactive Core compiler-library
hard-link groups were archived with every link recorded inside the dedicated
cache (2,723,716,435 bytes reclaimed). These byte-preserving archives are indexed
under `.native-runtimes/codex-test-artifact-archive` and
`.native-runtimes/codex-build-artifact-archive`; former cache paths are not all
immediately usable until restored or rebuilt. Optional standalone object inputs
were reclaimed only with no Cargo/rustc active, with per-pass JSON records.
Installed/staged entrypoints, source and user data were preserved. Normal Core
staging warnings remain 31 and linker warnings are unsuppressed.

The full Gate 2 objective remains active. Approved fresh catalog/auth and MCP/
tool/environment establishment, complete ownership/alias/orphan reconciliation,
hard disconnect/new-owner and restart recovery, native commit/CAS/recovery, exact
receiver acknowledgement/rebind, OpenCode, both production adapters and full task/
evidence/report/master/platform acceptance remain required. Windows host details
remain unavailable. Full-authority, production-port and movement flags stay false.


## Approved native catalog bootstrap component — 2026-10-29

A separate `provider_catalog` plan now discloses catalog network, credential and
native cache effects. Factory-only and local-context approvals cannot authorize
it. Core retains the actual provider in a resource cell before registering a
Session-retaining worker, releases the session/persistence locks during HTTP,
and retains custody when the private receiver disappears. The actual native
manager requires the selected slug in the successful endpoint response and
fresh published metadata without fallback. This is scoped configured-provider
data/resource construction, not complete destination authority or execution.

Starting catalog work permanently excludes unused-factory cleanup. If writing
the catalog-pending journal fails before any worker starts, the unused owner
remains observable and can complete exact cleanup. The existing isolated child
now uses real file-size limits to verify both that path and failed final cleanup
persistence. Default-stack affected Core cases pass; full final Core is 2,938
passed and one child-only skip (the parent executes that child). Provider tests
are 139 passed, including two new actual loopback HTTP cases. Parent verification
is 571 passed/21 skipped in its run; focused contracts are 49 passed. Schema and
exports advance to 22, with restart and correctly rehashed downgrade rejection.

Both normal locked/offline entrypoint builds passed. All nine staged process
cases passed, including approved catalog/cache construction and a blocked real
HTTP request whose receiver disconnects: public reads stay responsive, the
retained worker finishes its cache write, ownership stays retained/uncertain,
and restart remains quarantined. Capability advertisements remain fixture
preconditions; this does not certify production adapter migration or cold
migration acceptance. The first process run's two new failures were traced to
missing required instruction data in the fixture catalog response and fixed;
failed/debug logs remain alongside final logs. No native source changed for
that fixture repair. OpenCode native was unchanged and was not rerun.

The current increment is 874,026 bytes, SHA-256
`baf4390cae37df827be8c3fb760b6fec0ee24472ceb4659be5f80ddaacc61183`,
reconstructing tree `a57b085f6b5e495a056c45f774201ae56c1f08a5`.
Strict forward/reverse/whitespace and seven-file source-freeze checks passed.
Artifacts and logs use `/tmp/turnlink-catalog-bootstrap-`; binary hashes are in
the manifest. Eight inactive test artifacts were losslessly archived with
verified decompression, reclaiming 3,107,103,846 bytes. Optional standalone
objects were reclaimed only with no Cargo/rustc active; per-pass records remain.
Earlier compiler-library archives remain indexed and require restoration or
rebuild where their former cache paths are needed. Installed entrypoints and
user data were preserved; production-port, full-authority and movement flags
remain false.

Gate 2 stays active for complete fresh destination authority; used-resource,
MCP/tool/environment and alias/orphan reconciliation; incompatible-writer
exclusion; native commit/CAS and recovery; exact receiver acknowledgment/rebind;
OpenCode and both production adapters; and full task/evidence/report/master and
platform acceptance. This component does not remove those requirements.


## Native model-cache physical worker ownership — 2026-10-29

The old Tokio filesystem futures could disappear while their blocking work
continued. Every built-in file-cache load, store and composite TTL renewal now
registers before submission and moves its permit/actor into the actual blocking
closure. Cancelling the caller or dropping the cache does not hide queued I/O.
Known I/O errors end worker lifetime; panic/unobserved termination retains
uncertainty. A bounded native registry supplies an exclusive process-local cut
over compatible cache actors. Retained aliases, independent factories for the
same file and originator partitions all pass through it. Late registration
invalidates the census without releasing the fence. Paths describe actors;
they are not canonical filesystem identity or older-writer exclusion.

The isolated default-stack child occupies the only blocking worker, queues a
real cache write, cancels the caller and destroys the cache. Acquisition still
refuses until the orphan worker finishes its actual file write. Further checks
cover aliases, independent same-path factories, originator registration, all
three cache APIs under the fence, release, ordinary I/O errors and worker panic.
The parent invokes the child; the child-only main-run skip is intentional.

A new real HTTP/cache obstruction regression also reproduced a false successful
catalog-construction result. The higher-level native catalog component now
requires `NativeCatalogCacheWrite::Succeeded`; primitive catalog data and normal
picker fallback retain their existing semantics. Failed persistence leaves the
actual used provider retained and uncertain. The new staged process case verifies
authorization-bound ownership observation, task holds and disconnect/restart
quarantine after that real failure.

Accepted verification: model-manager 70 passed/one child-only skip, model-provider
140 passed, app-server graph check, both normal locked/offline entrypoint builds,
and ten staged native process cases. Core, parent and OpenCode native suites were
not rerun; their preceding results remain historical. Initial implementation/test
compile failures and the failing cache-write regression remain in the logs.
No installed runtime, user data or production switch changed. Optional standalone
objects were reclaimed only with no Cargo/rustc active, with per-pass JSON records.

Current increment: 897,171 bytes, SHA-256
`e1ca5d17d8f01fb0b0ad4524b1a695afbb1639944d0dbd5f5db6c68319a44b12`,
reconstructing tree `7376db0da49614af5940bbefa3a8b37f0b107d80`.
Strict forward/reverse/whitespace and four-file freeze checks passed. Artifacts,
logs and source freeze use `/tmp/turnlink-cache-io-`; binary hashes are in the
manifest. The cut is not yet composed into Session commit/CAS and does not close
shared credential/helper/HTTP lifetimes, custom backends or external storage.
Full destination authority, remaining resource/census and compatible-writer
exclusion, exact owner recovery/commit/receiver rebind, both native adapters and
the complete approved-grant-to-accepted-task flow remain required for Gate 2.

Scope audit against the original roadmap: Gate 2 requires complete effective
destination authority/native exclusion, owner RPC/journal/quarantine recovery,
exact conversation receiver continuity and approved grant → native effect →
rebind → task evidence → acceptance, for both runtimes. Actual Windows/IDE rollout,
live-model operational acceptance and deployment review are separately Gate 7.
Those later rollout items do not by themselves block Gate 2; no claim that either
gate is complete follows from this component. Production movement stays disabled.


## Catalog selection and cache publication boundary — 2026-10-29

The native catalog bootstrap now uses the actual manager's metadata-selection
rule and requires the winning entry to come from the fetched response. This
preserves default-catalog prefix and single-namespace choices, while explicit
provider catalogs retain exact matching. Merged fallback winners, stale proofs
and observations from a different manager do not qualify. The model ID itself
is preserved; API acceptance and complete destination authority remain separate.

A non-Send guard now keeps the existing process-local native cache census lock
through a synchronous publication. It checks the exact hold and revision and
refuses nested, stale and foreign holds. It is not yet composed into Session
commit/CAS and does not cover other resource domains.

Model-manager: 72 passed, one child-only skip (executed by its parent); provider:
141 passed. The namespaced actual-loopback HTTP case failed before the change
and passed afterward, and checks the explicit-catalog refusal as well. Both normal
native entrypoints built and all ten existing staged control-channel cases passed.
Those process cases do not cover the new namespaced selection. Core, parent and
OpenCode native suites were not rerun. Movement and production control remain
disabled. Full destination/resource reconciliation, owner recovery, native
commit and exact receiver rebind, and both-adapter end-to-end acceptance remain
required for Gate 2. Logs: `/tmp/turnlink-native-selection-`.

The current increment is 907,120 bytes, SHA-256
`a41f9c545e5f765d481a9eda068c194d72cf4dc40c54f805fe8bdc5e641ccf64`,
reconstructing tree `a88ca748f9470eb3dc559b3bc014aca94d07b53c`. Strict
forward, reverse and whitespace checks passed; binary hashes are in the manifest.


## Namespaced catalog through the native process — 2026-10-29

The staged private-channel suite now exercises a namespaced model through actual
source conversation initialization, broker approval, native catalog construction,
resource retention, disconnect and restart quarantine. All 11 cases passed. The
new case uses synthetic file-based ChatGPT credentials, a loopback-only server,
and explicitly disables Apps in this isolated fixture. It exercises the default
catalog's namespace selection; it does not establish Apps/MCP continuity or a
completed worktree migration. Two initial fixture attempts returned the native
busy-before-acquisition result while Apps was enabled; these logs are preserved.
The fixture retries only that explicit no-acquisition result while waiting for
idle; it does not retry a submitted migration effect. Logs use
`/tmp/turnlink-catalog-alias-process-`. The native patch and binary are unchanged.

Gate 2 still needs complete destination authority, resource reconciliation,
compatible-writer exclusion, native commit/recovery, receiver rebind and the
approved grant-to-accepted-task flow for both Codex and OpenCode.


## Apps-enabled native catalog fixture — 2026-10-29

The earlier Apps-enabled fixture failed MCP initialization because it returned
model-response data to the MCP endpoint. Instrumented native diagnostics showed
zero active requests with persistent uncertainty, and identified the failed
initialization call; no acquisition or migration effect occurred. Those debug
changes were removed, and the source reconstructs the previously accepted tree.

A loopback MCP fixture now completes the actual Apps initialization and empty
tool discovery with synthetic credentials before native acquisition. The
namespaced catalog component then passes through broker approval, construction,
disconnect and restart quarantine. All 12 staged process cases passed against
both rebuilt native entrypoints. The fixture has no Apps tools and does not
prove MCP resource shutdown, destination handoff, or full migration. Logs use
`/tmp/turnlink-apps-`; native patch SHA and source tree are unchanged. Optional
standalone build objects were removed after compilers stopped, with an indexed
local record. Installed runtimes and user data were not changed.

Gate 2 remains open for complete authority and resource reconciliation, compatible
writer exclusion, native commit/recovery, exact receiver rebind and end-to-end
acceptance for both Codex and OpenCode.


## Apps tool-call fencing through the native process — 2026-10-29

The Apps-enabled loopback server now advertises a real fixture tool. Its native
public tool call succeeds before acquisition. After the native reservation is
held, the same call is refused and the server observes no second call. The
namespaced catalog approval, retained ownership and restart quarantine also pass
in the same case. All 12 staged process cases passed. Logs use
`/tmp/turnlink-apps-tool-fence-`. The fixture uses synthetic credentials and a
loopback server; it does not establish autonomous server shutdown, MCP transport
cleanup, destination rebind or the full worktree migration. Native source and
patch are unchanged; movement remains disabled. Gate 2 still requires complete
destination authority, resource reconciliation, native commit/recovery, exact
receiver rebind and the approved flow for both adapters.


## MCP executor termination ownership — 2026-10-29

An executor-backed stdio process handle previously marked itself terminated
before its termination future finished. A second caller could report success
while the first later failed. The outer stdio transport and its inner executor
transport also independently terminated the same process. Both failures were
reproduced before the changes.

The actual handle now owns a serialized termination worker which survives caller
cancellation. Both transport layers share that handle. A failed or interrupted
attempt remains uncertain while the handle exists; later calls refuse to report
success or implicitly replay it. Three focused cases cover the two races and
caller cancellation. This is an in-memory handle boundary: it does not retain a
lost last handle in the Session journal or prove local process-group exit, quiet
descendants, raw executor aliases or physical transport closure. Those remain
required before cleanup or migration can be declared complete.

The final rmcp-client suite passed 266 cases with one ignored, and the MCP manager
suite passed 272. Its first run had one cold CLI capability-probe timeout at the
existing five-second limit; the same real probe took 15.48 seconds on first launch
and the unchanged suite passed after warmup. Both normal entrypoints rebuilt and
all 12 staged process cases passed. These process cases include loopback Apps,
not a proof of executor-backed process-tree shutdown. Core, parent and OpenCode
suites were not rerun. Logs use `/tmp/turnlink-mcp-termination-`. Eight inactive
test artifacts were losslessly archived with verified decompression, and optional
standalone objects were removed only after compilers stopped. Installed runtimes
and user data were preserved.

Current increment: 921,482 bytes, SHA-256
`33f6c70d6f263b05625e43d2012949142567153aab73c35c2d097a27c18f3a99`,
reconstructing tree `79cb9d20af61b0fbe66127915680dc4e0cf9efbc`. Strict
forward/reverse/whitespace and two-file freeze checks passed. Full destination
authority, native resource reconciliation and durable recovery, commit, exact
receiver rebind and both-adapter end-to-end acceptance remain open for Gate 2.
Movement remains disabled.


## MCP cleanup owner and reservation freshness — 2026-10-29

The native stdio process handle now binds to its MCP request owner. Its
termination worker registers cleanup before the executor effect and propagates
failed or interrupted cleanup as uncertainty to that owner, including after
the client handle is dropped. Starting cleanup invalidates an existing request
exclusion; Session reservation checks now reject a stale, retired or uncertain
MCP owner. A focused executor test covers cancellation, owner binding and
failure surviving handle drop; a Core regression covers retirement of an
owner after reservation. Successful local termination still means only that
the best-effort termination method returned, not that the process tree exited.

The rmcp-client library passed 267 tests with one ignored, the MCP manager
passed 272 after warming the real CLI following its existing cold capability
probe timeout, and the targeted Core regression passed. The app-server graph
checked, both native entrypoints rebuilt normally, and all 12 staged process
cases passed. The process cases exercise loopback Apps request fencing, not
stdio process-tree recovery. Parent and OpenCode suites were not rerun. Logs
use `/tmp/turnlink-mcp-owner-cleanup-`. Inactive build artifacts were verified
and archived, and optional compiler objects were reclaimed.

The increment is 927,412 bytes, SHA-256
`3675275b28f1317d703c9b647f9af94c58779a66c1f86a1efd0b123be1b2e667`,
reconstructing tree `dc83010aa3c04ac3139874f4cfb9b01417937277`. Strict
forward, reverse, whitespace and source reconstruction checks passed. The
owner state is in memory: physical process exit, HTTP transport shutdown, raw
aliases, retained orphan ownership and durable recovery remain unresolved.
Gate 2 remains open for complete destination authority, resource reconciliation,
native commit and recovery, exact receiver rebind, and end-to-end acceptance
for Codex and OpenCode. Movement remains disabled.


## MCP last-handle cleanup ownership — 2026-10-29

The last stdio process handle could previously start fallback termination
without registering it with the native MCP owner. A regression reproduced an
existing reservation remaining current while that termination was in flight.
Fallback cleanup now registers with the owner before scheduling the effect,
retains its permit until the executor returns, and leaves uncertainty on
failure, cancellation or inability to schedule. Local termination errors now
propagate; a tracked local process with no termination handle is uncertain.
Successful local signalling remains best effort and is not physical exit proof.

The rmcp-client suite passed 271 tests with one ignored, including four new
last-handle and missing-handle regressions; the MCP manager passed 272 after
warming the real CLI. Its first unchanged run hit the existing five-second
cold capability probe timeout; the warmup itself took 24.77 seconds. Both
native entrypoints rebuilt and all 12 staged process cases passed. Core,
parent and OpenCode suites were not rerun. Logs use `/tmp/turnlink-mcp-drop-owner-`.
Inactive test binaries were archived with verified decompression and optional
compiler objects reclaimed; installed runtimes were not replaced.

The increment is 934,662 bytes, SHA-256
`c1cb55ccedc7f8d54d46bdb937f1d8a6caf4098ace6251b6f931af98ca7ad95e`,
reconstructing tree `0792e3a4b6807b6a855c588ccd84727c7c1374c5`; strict
forward, reverse, whitespace and source reconstruction checks passed. Physical
process exit, HTTP transport shutdown, raw aliases, retained orphan ownership
and durable recovery remain unresolved. Gate 2 remains open for complete
destination authority, resource reconciliation, native commit/recovery, exact
receiver rebind and end-to-end acceptance for both runtimes. Movement remains
disabled.


## MCP transport and SDK shutdown ownership — 2026-10-29

An inner executor transport drop could schedule cleanup while an existing
reservation still appeared current; the new regression reproduced the race.
It now registers with the owner before scheduling. Stdio close remains
registered through the actual transport close. All native-owned SDK transport
variants, including streamable HTTP and in-process transports, now track close
results and leave uncertainty on error, cancellation or unclosed drop. This is
necessary because the SDK logs transport-close errors without returning them
from service cancellation. Client shutdown registers before releasing its
service, retains its permit in a cancellation-independent worker, waits for
the uniquely owned SDK service, and leaves uncertainty when aliases prevent
proving closure. A real in-process SDK regression exercises the exclusive and
aliased shutdown paths; transport tests cover success, failure and cancellation.

The rmcp-client suite passed 276 tests with one ignored and the MCP manager
passed 272 after CLI warmup. Its initial unchanged run hit the existing
five-second cold capability probe timeout; the warmup took 32.16 seconds. Both
native entrypoints rebuilt and all 12 staged process cases passed, including
loopback Apps. Core, parent and OpenCode suites were not rerun. Logs use
`/tmp/turnlink-mcp-transport-`. Inactive build artifacts were archived with
verified decompression; optional compiler objects were reclaimed.

The increment is 951,853 bytes, SHA-256
`52fe77f26ee4e4a7f2c232d70e558d6b7c47514c5cd12be9220049b30a510873`,
reconstructing tree `87cd6f4f8f74ba23182229f0eb630fc68b133b92`. Strict
forward, reverse, whitespace and source reconstruction checks passed. Client
transport closure does not establish remote server shutdown, quiet descendants,
physical process exit, raw alias ownership, retained orphan reconciliation or
durable recovery. Gate 2 remains open for complete destination authority,
resource reconciliation, native commit/recovery, exact receiver rebind and
end-to-end acceptance for both runtimes. Movement remains disabled.


## MCP HTTP session DELETE ownership — 2026-10-29

The upstream HTTP worker logs session DELETE failures and timeouts without
propagating them through its close result; the adapter also preserves normal
client behavior when a server returns 405. The native owner is now bound to
the actual HTTP adapter, including the OAuth variants and recovered transports.
Its DELETE effect holds a cleanup permit and leaves uncertainty on error,
cancellation or 405, while a successful response completes the permit. A
real loopback SDK connection verifies 204, 405 and 500 responses through
client shutdown; a controlled adapter test additionally verifies cancellation.
These responses do not prove that autonomous remote server work has stopped.

The rmcp-client suite passed 278 tests with one ignored and the MCP manager
passed 272 after the unchanged cold CLI probe timed out and the actual CLI was
warmed (35.03 seconds). Both native entrypoints rebuilt and all 12 staged
process cases passed. The first CLI link ran out of disk; optional compiler
objects were reclaimed and the unchanged normal build passed on retry.
Inactive artifacts were archived with verified decompression. Core, parent
and OpenCode suites were not rerun. Logs use `/tmp/turnlink-mcp-delete-`.

The increment is 967,695 bytes, SHA-256
`e4bb26c3f70d3e7d2899a81cfe42574d8394627730702aeea68053fbd7f14fe0`,
reconstructing tree `789df3a72fb84342268113c286ade8648c599884`. Strict
forward, reverse, whitespace and source reconstruction checks passed.
Autonomous server work, physical process-tree exit, raw aliases, orphan
reconciliation and durable recovery remain unresolved. Gate 2 remains open
for complete destination authority, resource reconciliation, native commit and
recovery, exact receiver rebind, and both-runtime end-to-end acceptance.
Movement remains disabled.


## Unix local MCP process escalation ownership — 2026-10-29

Local Unix MCP termination previously scheduled a detached SIGKILL after
returning, allowing owner quiescence and direct-child reaping before the delayed
signal. The transport and termination worker now share the actual child handle.
The worker holds it through SIGTERM, the escalation delay, SIGKILL and a bounded
direct-child wait; caller cancellation cannot detach the owner permit from the
worker. The transport's wait path uses the same lock, preventing it from reaping
the child and making its process-group ID reusable before escalation. If the
child identity is unavailable or signalling/wait fails, cleanup is uncertain.
Two real shell-process tests cover a SIGTERM-ignoring child, the owner fence,
direct-child reaping and cancellation. This is not evidence for escaped
descendants, all process-group members exiting, Windows, or remote executors.

The rmcp-client suite passed 280 tests with one ignored; the MCP manager passed
272 after the unchanged cold CLI capability probe timed out and the actual
CLI was warmed (25.35 seconds). Both native entrypoints rebuilt and all 12
staged process cases passed. The first build ran out of disk while writing Core;
after optional object reclamation and verified archival of inactive libraries,
the unchanged build passed on retry. Core, parent and OpenCode suites were not
rerun. Logs use `/tmp/turnlink-mcp-local-`.

The increment is 977,968 bytes, SHA-256
`bc0d72611a020b4551a7470436381f43efa75eef9aaf5d5f728132b1ad6b03d8`,
reconstructing tree `5aa3ddb787e1ef284d30c62f35c55b8e1e750f59`. Strict
forward, reverse, whitespace and source reconstruction checks passed. Full
resource and alias census, quiet descendants, remote server shutdown, orphan
reconciliation, durable recovery, complete destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes
remain required for Gate 2. Movement remains disabled.


## Unix MCP process-group exit observation — 2026-10-29

After terminating and reaping the direct child, the Unix MCP cleanup worker
now waits for the original process group to disappear. It uses a read-only
signal-zero check: a still-present group, permission error, invalid identifier
or bounded observation timeout cannot be reported as cleanup success. The
existing real shell fixture checks group disappearance after escalation;
additional regressions check an existing group and timeout. This observation
does not cover descendants that have escaped to another process group or prove
process ownership across restart.

The rmcp-client suite passed 282 tests with one ignored; the MCP manager passed
272 after its unchanged five-second cold CLI probe timed out and the actual CLI
was warmed (16.33 seconds). Both native entrypoints rebuilt normally and all
12 staged process cases passed. Core, parent and OpenCode suites were not
rerun. Logs use `/tmp/turnlink-mcp-group-`; optional compiler objects were
reclaimed after compilers stopped.

The increment is 980,894 bytes, SHA-256
`c13be7aff0406d2bb77b84ee9254dc583908f3cdd78fc74afb129795ec4a966c`,
reconstructing tree `66ad13b5b916788250dfe8c22bb6ea81fb60f8dd`. Strict
forward, reverse, whitespace and source reconstruction checks passed. Full
resource/alias census, escaped descendants, remote server shutdown, orphan
reconciliation and durable recovery, complete destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes
remain required for Gate 2. Movement remains disabled.


## MCP termination scheduling ownership — 2026-10-29

A direct stdio termination future could queue its worker before registering
cleanup with the native MCP owner. A regression reproduced an acquired request
reservation remaining current in that scheduling window. Registration now
occurs before spawning; the worker owns the permit through its result, including
when a caller is cancelled. A second regression drops the runtime before the
queued worker is polled and verifies that the owner remains uncertain.

The rmcp-client suite passed 284 tests with one ignored; the MCP manager passed
272 after its unchanged cold CLI probe timed out and the actual CLI was warmed
(33.35 seconds). Both native entrypoints rebuilt normally and all 12 staged
process cases passed. Core, parent and OpenCode suites were not rerun. Logs use
`/tmp/turnlink-mcp-schedule-`; optional compiler objects were reclaimed after
compilers stopped.

The increment is 983,474 bytes, SHA-256
`dadfc7b873962467fde02fc9ade3360b797776eb5f680bd3ac1f1fc1a0ee5263`,
reconstructing tree `38a47a10dc3a364190cbc30123699601c2747c72`. Strict
forward, reverse, whitespace and source reconstruction checks passed. The
Codex approved destination state still cannot be committed by the existing
legacy commit path; target MCP/tool resource establishment, complete authority,
resource/alias and orphan reconciliation, durable recovery, native commit,
exact receiver rebind and both-runtime end-to-end acceptance remain required
for Gate 2. Movement remains disabled.


## MCP runtime-wide shutdown and publication fence — 2026-10-29

Runtime shutdown previously queued the connection-set worker before registering
with the native owner; a regression reproduced the stale reservation window.
Shutdown now registers its own cleanup permit before scheduling, retains it in
a worker independent of the caller, and leaves uncertainty on worker failure
or runtime teardown before polling. Beginning shutdown permanently refuses new
native requests. A lifecycle lock serializes publication and shutdown; shutdown
loads the latest published connection set after acquiring the lock, while queued
publications refuse after shutdown starts. Four runtime regressions cover the
scheduling window, caller cancellation, unpolled worker loss and publication race.
This is request and client shutdown accounting, not proof of remote server exit
or an approved destination resource construction or release receipt.

The MCP manager suite passed 276 tests and rmcp-client passed 284 with one
ignored. Both native entrypoints rebuilt and all 12 staged process cases passed.
An earlier manager run hit its unchanged cold CLI capability probe timeout and
passed after warming the real CLI (16.01 seconds). The build reports an unused
connection-set shutdown wrapper used only by tests. Core, parent and OpenCode
suites were not rerun. Logs use `/tmp/turnlink-mcp-runtime-lifecycle-`.

The increment is 990,772 bytes, SHA-256
`cc89c4cc809cf858df3cd2b10cf653a187db6810243f50857d5608aa023975d1`,
reconstructing tree `07e5a53048cfc08326131515c11c4d6fefb6b015`. Strict
forward, reverse, whitespace and source reconstruction checks passed. Target
MCP/plugin discovery and startup still need their own scoped grant and retained
resource ownership, and the approved destination cannot yet be committed.
Complete authority, resource and orphan reconciliation, durable recovery, exact
receiver rebind and both-runtime end-to-end acceptance remain required for
Gate 2. Movement remains disabled.


## Broker grant and compatible holds for destination MCP — 2026-10-29

The broker now has an `establish-mcp` scope distinct from provider construction
and worktree movement. Its strict opaque plan discloses process, network,
credential, filesystem and plugin effects without carrying commands, URLs or
credentials. Separate native MCP capability evidence, exact plan and receipt
matching, receiver-authenticated authorization, and exact owner cleanup are
required. An established provider and MCP owner may coexist only when their
agent, task, claim, source, destination, process generation and native
reservation match. Pending or uncertain effects prevent another establishment;
all retained owners independently hold the task until exact cleanup. Recovery
looks up its own approved preview rather than losing access after another
compatible resource preview.

SQLite/export schema 23 preserves the new scope and rejects a schema 22
downgrade or rehashed export that contains it. A migration regression verifies
that schema 22 legacy provider command receipts replay unchanged. The new
contract and authenticated broker tests cover mixed-scope refusal, stale plans,
receiver identity, restart, exact cleanup and compatible owner holds. The
control suite passed 303 tests. The full parent run passed 578 tests with 26
skipped; the final migration regression passed separately, and JavaScript
syntax checks passed. Logs use `/tmp/turnlink-mcp-grant-`.

This is a broker contract only: no native MCP plan construction, fresh grant
consumption, journaled target startup, retained target owner, target tool
readiness, native commit or receiver handoff is implemented by this change.
Codex and OpenCode complete authority, orphan and durable recovery, and
end-to-end acceptance remain open for Gate 2. Movement remains disabled.


## Retained native target MCP plan — 2026-10-29

The private native host can now prepare an MCP plan bound to its actual thread,
open owner, reservation, target configuration and directory witnesses. The
disclosure is an opaque plan reference and conservatively includes all five
effect categories; it does not expose server commands, endpoints or secrets.
Planning performs no MCP startup, plugin discovery or credential effect. A
matching provider plan can be retained for the same target and process
generation. Until the native journal can retain both resource owners, provider
construction, source release and legacy commit refuse while the MCP plan is
held. The trusted host validates the exact private reply and refuses a known
incompatible provider effect before broker authorization.

The default-stack Core regression passed for foreign owners, duplicate plans,
mismatched target, matching provider, refused construction/release and unchanged
source settings. Its first version overflowed the default stack; boxing the
preparation boundary fixed the failure and the same test passed without a stack
override. The staged private-channel suite passed 13 cases, including the real
native plan and separately authenticated broker grant; both native entrypoints
rebuilt. The control suite passed 306 tests and JavaScript checks passed.
Other Core, MCP, parent and OpenCode suites were not rerun. Logs use
`/tmp/turnlink-mcp-native-plan-`.

The increment is 998,956 bytes, SHA-256
`b55618240069d4095893b8a20a41a1b28d1e83fa9af4e232e43178391c0dd162`,
reconstructing tree `1af923de9f57d3d2cb8b86d9e3c0e51395aea42c`. Strict
forward, reverse, whitespace and source reconstruction checks passed. The
broker can retain compatible provider and MCP grants, but the native journal
cannot yet retain both resources, consume the MCP grant, start or reconcile
target servers, or cancel this plan through a broker-correlated recovery path.
Complete destination authority, native commit, exact receiver rebind, orphan
and durable recovery, and both-runtime end-to-end acceptance remain required
for Gate 2. Movement remains disabled.


## Provider resource and retained MCP plan — 2026-10-29

An approved provider can now be constructed while the native owner retains a
matching MCP plan for the same target and reservation. Both prepared target
configurations are revalidated before the provider effect. The native journal
records the MCP plan in schema 2; exact provider cleanup preserves the plan,
thread reservation and admission fence. A stale cleanup retry is refused after
a different reservation is acquired. Restart or owner disconnect preserves
quarantine; serialized plan data does not recreate live custody.

The default-stack MCP Session regression passed, and the provider regressions
passed nine cases with one ignored. An initial provider run exposed the stale
cleanup retry and the corrected run passed. The control suite passed 306 cases,
JavaScript checks passed, both native entrypoints built, and all 13 staged
private-channel cases passed. The extended staged case exercised a real broker
provider grant and native effect, a separate MCP grant, exact provider cleanup,
continued source fencing and restart quarantine. Other Core, MCP, parent and
OpenCode suites were not rerun. Logs use `/tmp/turnlink-mcp-dual-owner-`.

The increment is 1,003,291 bytes, SHA-256
`2e322dce15632b0a28ac2eacc6e6a26cfa0cd7e1059b222e6490255e265b6cf3`,
reconstructing tree `4217dfb5989ab515f93012f5e4b292e80f3db64b`. Forward,
reverse, whitespace and reconstruction checks passed. This retains one live
provider resource and an MCP plan, not two live resources. MCP grant consumption,
target startup and reconciliation, plan cancellation and durable owner recovery,
complete destination authority, native commit, exact receiver rebind and
both-runtime end-to-end acceptance remain required for Gate 2. Movement remains
disabled.


## Approved detached MCP startup — 2026-10-29

The private Codex host now obtains fresh broker authorization for an exact MCP
plan and prevents concurrent resource authorizations for the same conversation.
Native code retains an initially empty runtime and a schema 3 pending grant and
receipt before target contributor discovery or server startup. Startup runs in an
owned worker that survives a cancelled waiter; failure or abandonment remains
uncertain. Target inputs use the existing native intersection of source session
permissions and destination rules, followed by revalidation of the retained
configuration and effective enforcer bindings. Publication produces an owner
receipt, not complete tool readiness. A separate owner observation can reconcile
a lost reply while that same private owner remains live.

A default-stack Session test verified exact plan matching, replay refusal,
retained MCP publication, matching provider construction and cleanup, source
fencing and the schema 3 hold. Nine native MCP runtime lifecycle tests passed,
including cancelled waiters, failed publication and an unpolled worker. Both
native entrypoints built; 309 control tests and JavaScript checks passed. The
14 staged private-channel cases passed, including a real broker grant and an
isolated destination MCP server process, simultaneous provider ownership, no
target startup replay after restart, and quarantine. Fixture processes exited
before temporary teardown. One earlier full staged run produced an unexplained
provider refusal; that case passed alone and the complete suite passed twice
subsequently. The strengthened restart case initially failed in fixture teardown
while a temporary directory was being written; its teardown now waits for the
fixture processes and retries directory removal, and the case and full suite
passed. Earlier Session attempts refused the projected constraint check; the
corrected regression passed. Other Core, full parent and OpenCode suites were
not rerun. Logs use `/tmp/turnlink-mcp-grant-` and
`/tmp/turnlink-mcp-owned-startup-`.

The increment is 1,034,244 bytes, SHA-256
`60efd1d6772bd1f33e849b7315a8901cfb917ba232a7d8ca9153ec6524fe6dd4`,
reconstructing tree `351fc05fe0772bc5f9e1aa94a9c0b7e29bf3bd72`. Forward,
reverse, whitespace and source reconstruction checks passed. The host does not
expose an MCP cleanup operation until the native path can prove exact physical
release. Full server readiness, aliases and escaped or remote processes,
cancellation and durable recovery, complete authority, native commit, receiver
rebind and both-runtime end-to-end acceptance remain open for Gate 2. Movement
remains disabled.


## MCP shutdown outcome propagation — 2026-10-29

MCP client shutdown now carries its owned process and SDK worker result through
the managed-client and connection-set layers. A cancelled or failed startup,
an outstanding service alias, or an ambiguous repeated client shutdown cannot
be turned into a successful result. Connection-set shutdown visits every distinct
connection even after a failure. Runtime shutdown retains one worker across
concurrent callers and caller cancellation; all waiters observe its result, and
an abandoned worker reports uncertainty. A successful worker must also obtain a
current native request exclusion. This is tracked quiescence, not proof that
remote services, escaped descendants or untracked aliases have stopped. No MCP
broker cleanup receipt is exposed yet.

The MCP manager library passed 282 tests and the lower-level client library
passed 284 with one ignored. The first manager run passed 280 cases but timed out
the staged CLI sandbox probe; an isolated retry timed out too. After directly
launching the CLI, the isolated case and the complete suite passed. Both native
entrypoints built. The first staged process run passed 13 cases and timed out
initializing the freshly linked binary at 30 seconds; a complete rerun passed all
14. The combined native build was deliberately interrupted after the app-server
bin succeeded when disk space fell below 500 MB; inactive build objects were
reclaimed and the CLI was then built separately. No full Core, control or
OpenCode suite was rerun for this native-only change. Logs use
`/tmp/turnlink-mcp-cleanup-outcome-`.

The increment is 1,042,050 bytes, SHA-256
`e0bf965af5a2b8b4c66d558649311757f629e528de77d68358a706023b4722d7`,
reconstructing tree `34725eda91c3cfb69e3dfcb16ef997436eee0aed`. Forward,
reverse, whitespace and source reconstruction checks passed. Complete resource
census and physical cleanup, durable recovery, effective destination authority,
native commit and receiver rebind, and acceptance for both runtimes remain
required for Gate 2. Movement remains disabled.


## Broker-authorized MCP tracked stop — 2026-10-29

The private host can now obtain fresh broker cleanup authorization for the
exact retained MCP resource and request a tracked stop. Native schema 4 records
the shutdown identity and pending intent before invoking the retained runtime.
The worker survives caller cancellation, and an ambiguous result retains
quarantine. A successful response is explicitly `quiesced`, not an owner-release
receipt; the exact runtime, source reservation and broker resource hold remain.
Same-owner observation can recover a lost response without repeating shutdown.
A stopped MCP owner cannot be used to construct a later provider.

The default-stack Session regression passed for foreign owner/resource refusal,
exact idempotent retry, observation, schema 4 and source fencing. The app-server
dependency check passed, 311 control tests and JavaScript checks passed, and
both native entrypoints built. All 15 staged process cases passed: the isolated
target MCP process exited, a source MCP process remained running, a dropped
shutdown reply was observed without replay, the broker rejected quiescence as
a cleanup receipt, task release remained refused, and restart did not replay
target startup. The first dropped-reply observation timed out while the same
shutdown worker was active; polling the same owner succeeded. Initial Core and
app-server links failed for insufficient disk; unchanged retries passed after
verified artifact archival. The first CLI build was interrupted for disk space,
the next link ran out of space, and the final retry passed. MCP/RMCP, full Core,
parent and OpenCode suites were not rerun for this increment. Logs use
`/tmp/turnlink-mcp-quiesce-`.

The increment is 1,051,661 bytes, SHA-256
`8c90e82e945d80c83b5d5182415ab43ee39c33603000a351382419fd7ae414c9`,
reconstructing tree `98ce8bfcaaedc029d958adeb3f8371f0554afb7b`. Forward,
reverse, whitespace and source reconstruction checks passed. Quiescence does
not prove untracked aliases, escaped descendants, remote-server termination or
complete physical resource release. A broker owner-release receipt, durable
recovery, complete effective destination authority, native commit and exact
receiver rebind, and both-runtime end-to-end acceptance remain required for
Gate 2. Movement remains disabled.


## Retained MCP quiescence request exclusion — 2026-10-29

After the authorized tracked stop, the native Session retains the target MCP
request exclusion rather than relying on a point-in-time quiescence snapshot.
Observation and exact retries check the live owner and refuse a stale exclusion;
the host reauthorizes and returns to the native owner on an exact retry without
repeating shutdown. The exclusion is in memory and cannot be reconstructed from
the journal after restart, which remains quarantined. It is a request fence,
not physical cleanup or a broker owner-release receipt.

The focused default-stack Session regression and app-server dependency check
passed, as did 312 control tests, the JavaScript check and both native builds.
The staged real-process suite passed all 15 cases on a warm rerun; the first run
passed 14 and its initial cold app-server initialization timed out at 30 seconds.
No fixture MCP process remained. MCP/RMCP, full Core, parent and OpenCode suites
were not rerun. Logs use `/tmp/turnlink-mcp-fence-`.

The increment is 1,054,266 bytes, SHA-256
`e6e2f5e7939895160cdee1720d446176fbb979ccaa34e71253eefa7b97c91bd9`,
reconstructing tree `d3106fd0be7031cb297e35f2b1c18611d8678871`. Forward,
reverse, whitespace and source reconstruction checks passed. Complete resource
census and physical cleanup, broker owner release, durable recovery, effective
destination authority, native commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


## Stale MCP custody quarantined at observation — 2026-10-29

The shared native reservation check now refuses every ordinary operation when
a retained target request exclusion becomes stale. Authenticated exact MCP
observation and retry retain owner/source checks and can record the stale
custody as an uncertain journal phase. A foreign plan cannot alter that phase.
The shutdown receipt remains historical and cannot release the broker hold.
This is not physical cleanup or durable owner recovery.

Two MCP continuity cases passed on the default stack, including the stale
shared check, foreign-plan refusal and uncertainty persisted before retry. The
production app-server dependency check passed, its native artifact built, and
all 15 staged private-channel process cases passed; no fixture MCP process
remained. Two earlier Core test build attempts were interrupted for disk space;
the unchanged final retry passed. The first app-server build was interrupted for
space and the next link failed with ENOSPC; the final unchanged retry passed.
The CLI, control suite, full Core suite and OpenCode were not rerun for this
increment; the earlier staged CLI does not match this native source. Logs use
`/tmp/turnlink-mcp-shared-check-`.

The increment is 1,056,569 bytes, SHA-256
`eaf7760bc9d572744308a5329042acca602f26174b3748292356b0bab625cbcd`,
reconstructing tree `37e17dd60ffef3413a021e5b92c38db2d5df31b8`. Forward,
reverse, whitespace and source reconstruction checks passed. Complete resource
census and physical cleanup, broker owner release, durable recovery, effective
destination authority, native commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


## Provider cleanup preserves MCP quarantine — 2026-10-29

An independently authorized provider cleanup can dispose its exact unpublished
provider owner while the MCP owner is retained. It no longer replaces an MCP
uncertain phase with `mcp_plan_held`: existing uncertainty and a stale target
exclusion detected during cleanup remain quarantined across the pending and
completed provider journal updates. The provider cleanup receipt remains scoped
to that provider; it does not release the MCP resource or prove physical MCP
cleanup. Exact provider cleanup retries preserve the same MCP journal state.

Three default-stack provider cleanup cases and two MCP continuity cases passed.
The new regression tests stale custody both before and after an exact MCP
observation, provider cleanup, its exact retry and continued release refusal.
The app-server check and build passed. The staged private-channel suite passed
all 15 cases on a warm rerun; its first run passed 14 and timed out the initial
cold initialization at 30 seconds. The staged suite exercises existing flows;
the newly added combined stale-custody scenario is covered by the native test.
No fixture MCP process remained. CLI, control, full Core and OpenCode suites
were not rerun; the staged CLI does not match this source. Logs use
`/tmp/turnlink-mcp-provider-quarantine-`.

The increment is 1,060,858 bytes, SHA-256
`34e9a15d8573b2aa87fe4e61279dbd635f32df5f1cfff32b093ef51df5fe6b0c`,
reconstructing tree `dd40ebd4c04b12c44dd22162f4aca72613617da3`. Forward,
reverse, whitespace and source reconstruction checks passed. Resource census
and physical cleanup, broker owner release, durable recovery, effective
destination authority, native commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


## Provider settlement after MCP quiescence — 2026-10-29

The staged private-channel flow now uses the real broker to authorize and settle
cleanup of the actual retained provider after stopping the destination MCP
runtime. It validates the provider owner-release receipt and journal, rechecks
the same MCP quiescence through the native owner, and verifies task release
remains refused. The native restart still quarantines the MCP owner and does
not replay target startup. This covers both normal and lost-MCP-reply flows.
The real fixture demonstrates a destination server exited and a source server
remained alive; it does not prove a complete process/alias census or MCP owner
release. Stale custody during provider cleanup remains covered by the focused
native regression from the preceding checkpoint.

All 15 staged process cases and 312 control tests passed, and the JavaScript
check passed. The first control attempt used Node 22.5.1 and failed because
`node:sqlite` was unavailable; the Node 24.21.0 retry passed. No fixture MCP
process remained. Logs use `/tmp/turnlink-mcp-provider-broker-`. The native
patch and binaries are unchanged from the preceding checkpoint; the CLI still
does not match this native source. Gate 2 remains open for physical MCP release,
orphan and durable recovery, full destination authority, native commit, exact
receiver rebind and end-to-end acceptance for both runtimes. Movement remains
disabled.


## Tracked local MCP stderr closure — 2026-10-29

Local native MCP termination now records whether its stderr reader actually
reached EOF. The cleanup permit remains held until that observation completes;
a timeout, read error, abandoned reader or open writer leaves the tracked stop
uncertain instead of turning the 250 ms diagnostic drain deadline into success.
The last-handle Unix cleanup also retains its native activity permit through
the reader result. Ordinary untracked cleanup keeps its prior behavior.

A real local test starts a child that escapes the original process group and
keeps stderr open; native termination refuses and cannot be replayed as success.
A staged private-channel case starts an escaped destination child, verifies the
real broker-authorized stop is journaled uncertain, and confirms task release
remains refused. The fixture kills the escaped process during cleanup. This
observes one concrete escaped-resource condition, not all escaped descendants:
a descendant that closes stderr, remote autonomous work, raw aliases and orphan
recovery remain unproven. No MCP owner-release receipt is issued.

The MCP client suite passed 285 tests with one ignored. The MCP manager suite
passed 282 tests after its initial 281-pass run timed out the staged CLI probe;
a direct probe succeeded before the unchanged retry. The app-server check and
build passed after an ENOSPC linker retry; all 16 staged process cases, 312
control tests and JavaScript checks passed. The first client and manager builds
were interrupted for disk space and retried. No fixture process remained. The
CLI was not rebuilt for this increment; full Core and OpenCode were not rerun.
Logs use `/tmp/turnlink-mcp-stderr-proof-`.

The increment is 1,067,338 bytes, SHA-256
`404bc7024374dd63cd55770783329f7f5a117e6a0ab8de573d7b2c8bada4ae95`,
reconstructing tree `691e9580462e2517cc98c055ea81064f6c073d47`. Forward,
reverse, whitespace and source reconstruction checks passed. Full resource
census and release, durable recovery, effective destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes remain
necessary for Gate 2. Movement remains disabled.


## OpenCode MCP tool authority handoff — 2026-10-29

The MCP catalog-to-tool-registry consumer now fences native reservation
authority before change-event publication and holds that fence through its
debounced read and registry reload. A failed reconciliation retains the fence
until a later success. The regression fails with the previous code and passes
with the change. Eighty-eight focused MCP, authority-event and placement tests,
7,179 full Core tests (43 skipped), 35 workspace check tasks, both builds, 85
server tests (one skipped) and 14 embedded SDK tests passed. Test setup and
other scope limits are documented in `native/opencode/README.md`. This is one
destination-authority boundary; full producer attribution, resource release,
owner recovery, native commit, exact receiver rebind and both-runtime end-to-end
acceptance remain required for Gate 2. Movement remains disabled.


## Tracked local MCP stdout closure — 2026-10-29

Unix local MCP startup retains a close-on-exec duplicate of the server stdout
read descriptor. During tracked stop, native cleanup polls that descriptor for
the kernel last-writer hangup without consuming MCP data. A missing or failed
witness, or a writer remaining after the bounded wait, leaves cleanup uncertain;
the last-handle cleanup worker keeps its native permit through that check. The
extra read descriptor is retained for the process-handle lifetime and can delay
a writer seeing a broken pipe until that handle is released. Windows and
executor-backed ownership are not established by this observation.

Native tests use real escaped descendants separately holding stdout with stderr
closed and holding stderr with stdout closed. They also verify close-on-exec and
that polling leaves buffered protocol data untouched. Both escaped cases passed
through the real staged broker/private owner and kept task release refused.
The MCP client suite passed 287 tests with one ignored; the manager suite passed
282; the app-server dependency check and rebuild passed; all 17 staged cases,
312 control tests and JavaScript checks passed. The initial native run had two
failures because macOS did not report hangup with no requested poll events; the
corrected flags passed. The first app-server build was interrupted for space,
the next failed with ENOSPC, and the final retry passed after verified artifact
archival. No fixture process remained. CLI, full Core and OpenCode were not
rerun; the staged CLI does not match this source. Logs use
`/tmp/turnlink-mcp-stdout-proof-`.

The increment is 1,074,004 bytes, SHA-256
`914c82c6f1eb310f134cb1f0bd8b7fcb7b92900c49e6239eaf352a8241b7f105`,
reconstructing tree `7121f35c26ba56a5d89c821142afb5f7ddaa64c9`. Forward,
reverse, whitespace and source reconstruction checks passed. Descendants that
close both pipes, remote work, raw aliases and orphan recovery remain unproven;
no MCP owner-release receipt is issued. Full destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes remain
necessary for Gate 2. Movement remains disabled.


## MCP stdout witness lifetime — 2026-10-29

The Unix local stdout witness now has one shared owner. A successful tracked
hangup check releases the extra read descriptor, while an uncertain check
retains it and continues to refuse replay. Dropping an untracked transport or
starting untracked cleanup releases its extra reader, reducing the broken-pipe
behavior change noted in the preceding checkpoint. Before an untracked
transport is dropped, and while a tracked check remains uncertain, the extra
reader can still delay a writer observing a broken pipe. If untracked drop
races native binding, loss of the witness makes tracked cleanup fail closed.

The focused native tests passed 28 cases, including untracked transport-drop
reader release and both escaped-output checks. The full MCP client suite passed
288 with one ignored, the manager suite passed 282, the app-server dependency
check and build passed, and all 17 staged private-channel cases passed. No
fixture process remained. Control, CLI, full Core and OpenCode suites were not
rerun; the staged CLI does not match this source. Logs use
`/tmp/turnlink-mcp-stdout-lifetime-`.

The increment is 1,076,507 bytes, SHA-256
`7fba62db35885ac1c5c496861bc2d0dfe1f8e07596e854de6dae2e542f39988b`,
reconstructing tree `b1918e2ce43fb971492c91c7a02aa5a0bbf3fe6e`. Forward,
reverse, whitespace and source reconstruction checks passed. Descendants that
close both pipes, remote work, raw aliases and orphan recovery remain unproven;
no MCP owner-release receipt is issued. Full destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes remain
necessary for Gate 2. Movement remains disabled.


## Native-only MCP stdout witness — 2026-10-29

The local transport now owns its stdout reader through a shared wrapper and
exposes only a weak reference to its process owner. Native binding upgrades that
reference and duplicates the live descriptor under the reader lock, preventing
a stale integer descriptor from being reused. If the reader is gone or cannot
be duplicated, binding fails and cleanup cannot report success. An untracked
transport never acquires the extra descriptor, eliminating its earlier
broken-pipe lifetime change. A tracked witness remains held while its cleanup
outcome is uncertain and is released after successful last-writer observation.
The shared reader adds a short mutex acquisition around protocol reads.

The focused native suite passed 29 cases, including untracked no-duplicate,
late binding refusal, non-consuming hangup observation and both escaped-output
cases. Full MCP client passed 289 tests with one ignored; the manager passed
282; the app-server check and build passed; and all 17 staged private-channel
cases passed. No fixture process remained. A first compilation failed because a
new test lacked a comma; it was corrected before the passing runs. Control,
CLI, full Core and OpenCode suites were not rerun; the staged CLI does not
match this source. Logs use `/tmp/turnlink-mcp-native-bind-proof-`.

The increment is 1,080,639 bytes, SHA-256
`3752b0c423cdadd73288552c7400b1f3da67c81940afd6026a508a2febd9271e`,
reconstructing tree `007b370ff0167f36439192f0a11b3df2ba017c12`. Forward,
reverse, whitespace and source reconstruction checks passed. Descendants that
close both pipes, remote work, raw aliases and orphan recovery remain unproven;
no MCP owner-release receipt is issued. Full destination authority, native
commit, exact receiver rebind and end-to-end acceptance for both runtimes remain
necessary for Gate 2. Movement remains disabled.


## OpenCode native MCP producer provenance — 2026-10-29

The native MCP tool transform now carries identity and Scope-bound provenance
in the actual registry snapshot. Forged metadata and unrelated transforms do
not gain its origin, and closing the owner Scope makes it stale. This identifies
the producer only; MCP servers, permission hooks, resource release, effective
destination execution authority and durable ownership remain separate.

Focused MCP and placement tests passed 249 cases over three repetitions; full
Core passed 7,180 with 43 skips, the 35 workspace check tasks passed, both
builds passed, the server passed 85 with one skip, and the embedded SDK passed
14. The prior-source regression failed as expected. Setup failures and exact
scope are documented in `native/opencode/README.md`. Full resource and owner
reconciliation, destination authority and commit, exact receiver rebind and
both-runtime end-to-end acceptance remain required for Gate 2. Movement remains
disabled.


## OpenCode pending permission authority — 2026-10-29

Native request creation, reply, cancellation cleanup and service close now
invalidate a held authority reservation while leaving human permission actions
responsive. The prior implementation failed the revision regression; the
updated permission and movement suite passed 375 cases over three repetitions.
Full Core passed 7,183 with 43 skips; all 35 workspace checks, Core and server
builds, 85 server tests (one skipped), and 14 embedded SDK tests passed. The
server listener warning and initial corrected fixture timeout are documented
in `native/opencode/README.md`. This closes a pending-request freshness gap,
not complete permission policy or destination authority. Full resource and owner
reconciliation, destination commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


## OpenCode pending permission grant aliases — 2026-10-29

Pending permission grant fields no longer share mutable request and saved-grant
arrays with callers, event subscribers, or request and authority readers. The
regression reproduced a pending request changing through the caller's array on
the preceding patch, then passed through the actual persisted `always` grant.
Permission tests passed 1,090 cases over ten repetitions; the permission and
movement suite passed 378 over three repetitions, and full Core passed 7,184
with 43 skips. All 35 workspace checks, both builds, 85 server tests (one
skipped), and 14 embedded SDK tests passed. The corrected fixture-readiness
retry and server warnings are documented in `native/opencode/README.md`.
Nested metadata remains opaque and this does not establish full destination
authority. Resource and owner reconciliation, destination commit, exact
receiver rebind and both-runtime acceptance remain necessary for Gate 2.
Movement remains disabled.


## OpenCode quarantine successor claim — 2026-10-29

A later native process can record a durable successor claim for the exact
quarantined attempt after obtaining a different storage lease. The original
intent, source placement and execution quarantine remain in place; this claim
does not grant a reservation, release resources or perform a move. SQLite
journal triggers refuse writers without the native ownership function, not a
hostile local writer that can provide a forged function or alter storage.
Separate-process tests cover abrupt exit, mismatched plugin and transition,
unregistered journal writes, two successors and continued reservation refusal.
Movement and storage passed 60 cases over three repetitions; full Core passed
7,186 with 43 skips, all 35 workspace checks, both builds, 85 server tests
(one skipped) and 14 embedded SDK tests passed. The listener warnings and proof
limits are recorded in `native/opencode/README.md`. Complete authority,
physical orphan reconciliation, owner RPC, native commit, exact receiver rebind
and end-to-end acceptance for both runtimes remain necessary for Gate 2.
Movement remains disabled.


## OpenCode quarantined successor inspection — 2026-10-29

An exact native recovery owner can inspect retained Session selection and
queue/history counts under native exclusion, with recovery identity and lease
revalidated around the read. Process tests verify retained input and refusal of
unclaimed and superseded owners. The inspection keeps resource, destination
authority and receiver state unresolved; counts do not prove content continuity
or release. Movement and storage passed 60 cases over three repetitions, full
Core passed 7,186 with 43 skips, all 35 workspace checks, both builds, 85 server
tests (one skipped) and 14 embedded SDK tests passed. Details and listener
warnings are in `native/opencode/README.md`. Physical resource and orphan
reconciliation, complete authority, owner RPC, native commit, receiver rebind
and both-runtime acceptance remain necessary for Gate 2. Movement remains
disabled.


## OpenCode inherited recovery control descriptor — 2026-10-29

An explicitly configured staged server can serve recovery inspection and
quarantine claims over an inherited socket fixed to one Session and location.
It rejects unsupported movement methods and malformed or foreign requests,
and cleans up on interrupted activation. Separate-process tests and the full
server suite passed (92, one skipped); 21 focused cases over three repetitions,
all 35 workspace checks, the server build and 14 SDK tests passed. The initial
ENOSPC failure, Bun descriptor compatibility issue, listener warning and exact
validation scope are recorded in `native/opencode/README.md`. Core source is
unchanged from its earlier 7,186-pass, 43-skip run and was not rerun.

The descriptor is not production owner RPC: no adapter launcher or broker
credential/grant verification is connected, and in-process code can access
server descriptors. Complete destination authority, physical resource and
orphan reconciliation, authenticated owner/broker wiring, native commit,
exact receiver rebind and end-to-end acceptance for both runtimes remain
necessary for Gate 2. Movement remains disabled.


## OpenCode native recovery host client — 2026-10-29

The host-side `OpenCodeNativeRecovery` client now uses the staged inherited
descriptor with a fixed Session, plugin and source location. It requires an
exact quarantined intent before claiming recovery, checks that the returned
lease and activation are new and that the owner generation advanced, then
re-reads the original intent before accepting the claim. Inspection checks the
same recovered owner, Session and explicit unresolved resource, destination
and receiver states. A lost claim reply is uncertain and is never resent by
the client; malformed, foreign, oversized and out-of-order replies fail closed.
The public return values are copies and the client exposes no movement or
resource-release method.

A separate-process test uses the actual staged native server after an abrupt
exit and verifies the retained input and unresolved resources through the host
client. Focused recovery and transition tests passed 39 cases; the full control
suite passed 319 and JavaScript syntax checks passed. The first unit run exposed
a closed-channel error classification; it was corrected before the final
runs. Logs use `/tmp/turnlink-opencode-native-recovery-`. The native patch was
unchanged and retains its previously recorded verification.

This client is not yet connected to a production launcher or the enrolled
adapter's broker authorization. A recovery claim is not proof of physical
resource release, full destination authority, native commit or receiver
continuity. Those items, authenticated owner/broker wiring and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


## OpenCode isolated recovery launcher — 2026-10-29

A host can now start the staged OpenCode CLI source in isolated loopback stdio
mode with an inherited descriptor and compatible native storage, then use the
recovery client against an exact Session and location. A separate-process test
verified recovery inspection, retained input, competing native lease refusal and
clean shutdown. This is recovery after a process exit, not a live receiver
handoff or an approved movement. No installed service was restarted or modified.

The full CLI suite passed 330 with 9 skips, all 35 workspace checks and the
Turnlink control suite passed 322. The first CLI run's shared-config fixture
failures and clean retry are recorded in `native/opencode/README.md`. The CLI
binary was not built; the staged source entry was exercised. Full destination
authority, physical resource and orphan reconciliation, broker/owner
authentication, native commit, exact receiver rebind and end-to-end acceptance
for both runtimes remain necessary for Gate 2. Movement remains disabled.


## Receiver-authorized OpenCode recovery observation — 2026-10-29

The broker now has a recovery-only `observe-worktree` check for an exact
prepared or uncertain movement transition. The enrolled current receiver,
credential, claimant/generation, approved preview and exact current record are
required. The check deliberately does not require fresh idle evidence, and it
rejects provider/MCP grants and terminal transitions. It authorizes neither
movement nor settlement.

The staged OpenCode recovery host checks the broker immediately before and
after claiming a quarantine and inspecting it. A changed grant, wrong receiver,
revoked credential or disconnect refuses the operation; failure after a native
claim is reported as uncertain and is never automatically replayed. The two
checks are snapshots, not an atomic broker/native lease; at that checkpoint the
host had no durable uncertainty receipt. A separate-process test used the real enrolled broker receiver, approved
transition, staged CLI launcher and native owner, then verified an uncertain
transition and credential revocation. This is a recovery observation path, not
the approved movement flow or proof of resource cleanup.

Focused broker, resource and recovery tests passed 50; the full control suite
passed 328 and JavaScript syntax checks passed. Logs use
`/tmp/turnlink-opencode-authorized-recovery-`. The native patch remains
unchanged. Production adapter wiring, complete destination authority, physical
resource/orphan reconciliation, native commit, exact receiver rebind and
both-runtime end-to-end acceptance remain necessary for Gate 2. Movement remains
disabled.


## Durable OpenCode recovery claim and native observation — 2026-10-29

The staged recovery host records a private write-ahead claim before native
dispatch and retains `claiming`, `claimed`, `uncertain` or `observed` state.
Restarting the host does not automatically resend a recorded claim. A new native
owner can observe a matching prior recovery record under its current lease and
execution exclusion, with fresh broker checks around the observation. Missing
native records remain unresolved; an observed claim does not prove cleanup,
move the Session, clear quarantine or settle the broker transition.

A separate-process host crash at a simulated dispatch boundary left the
write-ahead record and refused replay. A real broker/native restart test read a
prior claim under a new lease while the transition remained uncertain. Full
Core passed 7,186 with 43 skips, 60 repeated native movement/storage cases, 21
repeated channel cases, 92 server tests with one skip, 14 SDK tests, all 35
workspace checks, both builds and 335 host control tests passed. The exact
fixture scope, filesystem-lock limits and warnings are in `native/opencode/README.md`.
Production adapter wiring, full destination authority, physical resource and
orphan reconciliation, native commit, exact receiver rebind and end-to-end
acceptance for both runtimes remain necessary for Gate 2. Movement remains
disabled.


### OpenCode model WebSocket crash record — 2026-10-29

The staged compatible native runtime now journals socket acquisition before
opening and blocks release when a prior lease's acquisition remains unresolved.
A real loopback socket crash/restart test, closure test and ordinary unaware
writer refusal passed; Core passed 7,191 / 43 skipped and Server 92 / one
skipped. See `native/opencode/README.md` and its manifest. This is uncertainty
retention, not remote cancellation or physical orphan reconciliation; prior
untracked resources, other resource families, complete destination authority,
native commit, exact receiver rebind, production integration and both-runtime
end-to-end gate acceptance remain open. Movement remains disabled.


### Recovery inspection sees tracked WebSocket acquisitions — 2026-10-29

The broker-checked host can inspect current- and other-lease WebSocket journal
counts under the exact native recovery claim. A real loopback socket and
abrupt native-owner exit carried the prior record through a broker-authorized
recovery inspection; revocation refused further inspection. Full Core passed
7,191 / 43 skipped, Server 92 / one skipped, and host control 336. Zero counts
do not establish physical or remote cleanup. A successor cannot yet take over
an observed earlier recovery claim via the host journal; resource
reconciliation, destination authority, commit, receiver rebind, production
integration and both-runtime acceptance remain open. Movement stays disabled.


### Recovery successor takeover — 2026-10-29

The staged OpenCode owner and broker-checked host can now transfer an observed
recovery claim to a new native lease with an exact predecessor comparison and
a durable dispatch record. Tests cover real broker/native restarts, simulated
lost reply after commit, pre-dispatch failure, stale and forged predecessors,
and broker revocation. Core passed 7,191 / 43 skipped, server 92 / one skipped,
and host control 341. This supersedes the preceding note that successor
takeover was absent. It does not release quarantine or reconcile resources.
Full destination authority, commit, receiver rebind, production integration
and both-runtime Gate 2 acceptance remain open; movement stays disabled.


### Hook and tool registry authority aliases — 2026-10-29

Staged OpenCode now owns model-hook provider filters and isolates tool entry
metadata and transform editor lifetimes. Real dispatch/execution regressions
were red before the fix and green afterward. Full Core passed 7,193 / 43
skipped, Server 92 / one skipped, host control 342 and isolated focused Core
130. Other registry domains (including agent returned data), mutable schema
objects and callback state remain unproven. Physical resource reconciliation,
complete destination authority, native commit, receiver rebind, production
integration and both-runtime Gate 2 acceptance remain open; movement stays
disabled. See `native/opencode/README.md` for failures and test scope.


### Agent registry ordinary-data isolation — 2026-10-29

The staged OpenCode agent registry now revokes retained editors and detaches
plain agent data after synchronous transforms and on reads; direct synchronous
editor changes are preserved. Full Core passed 7,195 / 43 skipped, focused
Core 134, Server 92 / one skipped and host control 342. The Agent source was
reindented after full Core began; the difference was whitespace-only and all
12 agent tests plus Core typecheck passed after formatting. Non-plain opaque
provider values, accessors, callback state and other registries remain
unproven. Resource reconciliation, complete destination authority, commit,
receiver rebind, production integration and both-runtime Gate 2 acceptance
remain open; movement stays disabled. See `native/opencode/README.md`.


### Authority-aware shared editor lifetime — 2026-10-29

Staged OpenCode now expires authority-aware State editor interfaces after
synchronous transforms and copies command definitions. Actual command and
nested-editor regressions passed after reproducing the bypass. Core passed
7,197 / 43 skipped, focused Core 196, Server 92 / one skipped, and host control
342. Mutable values returned from editors, including MCP configs, are not
generally detached. Resource reconciliation, complete destination authority,
commit, receiver rebind, production integration and both-runtime Gate 2
acceptance remain open; movement stays disabled. See `native/opencode/README.md`.


### MCP configuration and catalog alias isolation — 2026-10-29

Staged OpenCode now detaches MCP configuration drafts after transforms, copies
runtime overrides and isolates catalog/status reads. Real isolated MCP process
and loopback catalog tests reproduced and verified the fixes. Core passed
7,201 / 43 skipped, focused Core 164, Server 92 / one skipped, host control
342, and Core/server builds and typechecks passed. This supersedes the prior
note that MCP config aliases were unhandled. Tool registry JSON schemas and
other authority remain unproven; resource reconciliation, complete destination
authority, commit, receiver rebind, production integration and both-runtime
Gate 2 acceptance remain open. Movement stays disabled. See
`native/opencode/README.md` for scope and failure history.


### Tool JSON schema and Code Mode snapshot isolation — 2026-10-29

Staged OpenCode now detaches tool JSON schemas and returned Code Mode catalog
snapshots; tests reproduce the previous alias mutations and verify input
validation, synchronous edits and standard-schema projections. Core passed
7,205 / 43 skipped, focused Core 133, Server 92 / one skipped and host control
342. Opaque Effect/standard-schema state and plugin callbacks remain unproven.
Physical resource reconciliation, full destination authority, commit, receiver
rebind, production integration and both-runtime Gate 2 acceptance remain open;
movement stays disabled. See `native/opencode/README.md`.


### Prior tracked WebSocket restart hold — 2026-10-29

Staged OpenCode now refuses prior-lease tracked WebSocket reacquisition and
quarantines affected suspended Sessions and their ancestors through pending
subagent jobs and stored Session parent links. Real crash/restart regressions
proved that a parent claim could be cleared before its child's job was persisted;
the fix preserves parent and child claims and pending work. Focused checks
passed 11; clean Core passed 7,211 / 43 skipped; server passed 92 / one skipped;
host control passed 342; both builds and typechecks passed. This does not prove
remote cancellation, physical resource/orphan reconciliation, coverage of
untracked model work, full destination authority, commit, receiver rebind,
production integration or both-runtime acceptance. Movement remains disabled.
See `native/opencode/README.md` for verification details.


### Dependent recovery census and task transition binding — 2026-10-29

OpenCode recovery inspection now counts distinct dependent Sessions with
prior-lease tracked WebSocket records through Session ancestry and pending
subagent jobs. A crashed native process and actual broker-authorized host path
verified the child is reported and an unrelated record excluded. The count is
not remote or physical cleanup evidence. The broker's task.prepare rule now
requires a settled movement for the same claim and latest approved preview, and
a matching destination scope; the scheduler still excludes worktree tasks.
Regressions showed preview-only preparation previously succeeded and that an
old movement cannot satisfy a newer preview. These checks do not prove
receiver rebind or the authenticity of a synthetic movement fixture.

Focused Core passed 23, host/native recovery 27, full Core 7,212 with 43
skipped, server 92 with one skipped, host control 345, and both native builds
and typechecks passed. Full destination authority, physical/orphan
reconciliation, native commit, exact receiver rebind and full acceptance for
both runtimes remain open; movement stays disabled. See
`native/opencode/README.md` for patch identity and verification limitations.


### Staged broker receiver handoff — 2026-10-29

A source receiver and destination candidate can now stage an exact grant-bound
broker handoff in isolated tests. The destination persists a fresh key before
offering; the broker rechecks both connections and rotates the session proof
before switching the receiver. The old proof can no longer issue participant
operations. A durable hold blocks incoming/outgoing peer delivery and task
pulls until the matching movement has been settled and the new receiver
releases it. Restart, lost replies before/after durable writes, in-flight
delivery, expired offers, changed grants, revoked credentials and unrelated
Session reconnects are covered. This proves the staged broker protocol, not
actual native placement or receiver installation. The broker constructor option
is off by default and is not wired into the normal launcher or either adapter.
It relies on adapter settlement and does not exclude hostile processes under the
same OS account. Existing older strict-schema brokers cannot read its added
state. Physical/orphan reconciliation, complete destination authority, native
commit, adapter integration and end-to-end acceptance for both runtimes remain
open; movement stays disabled. See `receiver-handoff.md`.

Verification: 17 focused receiver tests, 362 control tests and full host suite
637 passed / 31 skipped; JS syntax and whitespace checks passed. Earlier test
runs overlapped a one-line client edit or failed a test-only response-shape
assertion, and are not counted. Final source fingerprints matched before and
after the clean runs. Logs use `/tmp/turnlink-receiver-handoff-`.


### OpenCode source receiver detachment — 2026-10-29

The staged broker now records an exact source-socket detachment acknowledgement
and refuses receiver release until it is durable. The real OpenCode source
adapter invalidates its Session, serializes and removes its membership, verifies
absence, and acknowledges on the old connection. A pending form, active channel
tool, delivery/task/control work or membership removal failure leaves the hold
unacknowledged. Source tools cannot reuse the relinquished Session, while
ordinary moves still detach. Two-party broker and adapter fixtures cover those
cases and durable acknowledgement failures before and after the broker write.
This proves local source adapter cleanup only, not native resource cleanup,
destination receiver installation or native placement. The broker remains
staged and disabled by default. If the source socket or broker dies before the
acknowledgement, the hold remains unresolved; no recovery is inferred. Native
commit ordering must also prevent `session.moved` from detaching the source
before an authorized broker swap. Full destination authority, physical/orphan
reconciliation, native commit and both-runtime end-to-end acceptance remain
open. See `receiver-handoff.md`.

Focused source/broker tests passed 24, existing OpenCode/task regression tests
passed 39, host control passed 369, and the complete host suite passed 644
with 31 skipped. Earlier form fixture attempts expected the unprefixed form ID
and failed; the corrected fixture was verified before the clean suites.
Source fingerprints and whitespace/syntax checks passed. Logs use
`/tmp/turnlink-opencode-detach-`.


### Fenced source membership and recovery seal — 2026-10-29

OpenCode preparation now fences the plugin's actual membership key in the
native storage transaction and marks the intent. Compatible storage protocol 2
prevents the prior patch's bootstrap from opening it; the marker cannot be
removed or downgraded by ordinary SQLite writes. An exact native recovery
owner can seal an already absent fenced source membership. The seal remains
across owner restart and prevents normal recreation or removal. Old unfenced
intents and present memberships refuse. A real broker-authorized host writes a
durable dispatch intent, rechecks authorization and observes an existing seal
after a lost reply; a missing seal after uncertainty is not replayed. This is
local membership evidence only. Destination installation needs an exact
authorized operation to consume the seal; other resources, full authority,
native placement, receiver continuity and both-runtime acceptance remain
open. Storage upgrade/rollback and same-account hostile writers remain outside
this evidence. Movement stays disabled. See `native/opencode/README.md`.

Clean Core passed 7,216 / 43 skipped; focused Core 35, server 92 / one skipped,
host control 375, and full host suite 650 / 31 skipped. Focused broker/native
recovery passed and both builds and typechecks passed.

### Approved live owner transport release — 2026-10-29

The private native control can explicitly run in live mode for one Session.
The host binds preparation and one tracked model-WebSocket release to the
exact prepared broker grant, checking authorization before and after each
effect and persisting dispatch first. Rejected or lost replies remain held;
the durable journal prevents a successor from replaying the operation. The
ordinary launcher continues to use recovery mode. Real isolated broker,
native-process and loopback-WebSocket tests cover success, lost preparation
and release replies, revocation before preparation and revocation after
release. This establishes a local transport receipt for a live owner, not
remote cancellation or reconciliation of prior owners, other resources,
destination authority, native placement or receiver installation. Gate 2
remains open and movement remains disabled.

The five isolated live-owner cases passed. The server suite passed 93 tests
with one skip, host control passed 385, the full host suite passed 660 with
31 skips, and the server build and typecheck passed. The workspace check
passed 35 tasks before the last server test-only
edit; the server typecheck and full server suite were rerun afterward. The
Core suite was not rerun because Core source did not change from its prior
7,230-pass, 43-skip verification. The staged patch reconstructs native tree
`c17b3b5c1bd9670e700f67b1b7c1e3f6a0863fd6` and has SHA-256
`ff4fc34ec8a72b479fd82053757b4784908e902ebd937200d09c19982a35aede`.

### Isolated live server owner — 2026-10-29

The private channel can be installed explicitly inside a new loopback stdio
server's actual native service graph. Its host launcher validates the private
endpoint and generates an isolated server password; it cannot attach to an
existing server. Real broker/native server tests prepare the approved Session,
check its HTTP API and release its empty tracked transport inventory. A separate
real-socket case exercises physical closure in the direct native graph. A
prompt sent through the server during quarantine is refused without an inbox
write, but its processing can interrupt a following release attempt. That
attempt remains durably uncertain and has no completed reconciliation path.
The tests do not establish remote cancellation, complete physical resource
reconciliation, native placement, receiver installation or Gate 2 acceptance.

Host control passed 389; the native server suite passed 93 with one skip;
the CLI isolation test, server build, and 35 workspace check tasks passed.
The interrupted server-input case also passed three consecutive focused runs.
The staged native patch reconstructs tree
`8133840ee9653f75e7b11b1cc8fbc9aa0c199319`, SHA-256
`8fbc1fd4dc9e78c2ff4911dbddf2f47a14191a9a7813a322ebf53e2af9e83865`.

### Guard Session routes before Location construction — 2026-10-29

The interruption described above was caused by Location graph construction
starting before a quarantined prompt reached the native Session activity
guard. In the movement-enabled server, Session-bound Location and form routes
now enter the Session activity boundary first and reload the Session after
acquiring it. Held prompt, shell, instruction and form requests receive an
explicit invalid-request response without constructing their Location graph;
the inbox remains empty and the following approved transport release succeeds.
An ordinary prompt reaches the inbox, ordinary form reads work, and the human
interrupt route stays available. Global forms and generic Location routes do
not use this Session-bound guard. Complete resource release, native placement
and receiver installation remain open.

The final real-server checks covered held prompt, shell, instruction and form
requests, ordinary prompt and form access, and the interrupt endpoint. Host
control passed 391, the native server suite passed 93 with one skip, all 35
workspace checks passed, and the server build passed. The native patch
reconstructs tree `55da57ed262a5ff612c8c3b15c46e037e8d0d9f8` and has SHA-256
`5490d91730eeffea31ffaec9b4e6161253e981bbe1dfc395f8af51852c7bee54`.

### Real-server model transport and pre-effect busy result — 2026-10-29

An isolated native server now performs a real fixture model turn over a local
Responses WebSocket, blocks held Session input, and releases the same socket
under the exact approved broker transition. When native idle reservation
returns its specific busy error before entering the preparation transaction,
the private channel records a definite pre-effect refusal. The host journals
that refusal and permits a new attempt only after fresh broker authorization;
it does not replay a lost reply. Real-server cases cover an active turn, a
successful later attempt, a lost busy reply and revoked enrollment. This is a
local transport proof only: remote cancellation, orphan resources, other
resource families, actual destination placement, receiver continuity and
both-runtime acceptance remain open.

The initial graceful-restart test found that the socket closed but its journal
record survived because the background closure observer had already been
interrupted during scope finalization. The owning runtime now performs a
bounded closure and reader check during shutdown and settles only an exchange
with a terminal observation. A sent exchange without a terminal observation remains journaled despite
local closure, because the remote outcome is unknown. The restart test reads
the actual database to distinguish these cases and then checks a newly
authorized attempt. An initial synthetic connector test timed out because it
emitted a frame before send; a queue-driven fixture corrected that ordering.

Final verification passed 7,232 Core tests with 43 skips, 93 server tests with
one skip, 398 host control tests, all 35 workspace check tasks, and Core/server
builds. The private-index patch reconstructs tree
`2c101af5d86b1552c340e3548dc2a2a0fcad970e`, SHA-256
`d9eae2c765efa251dbd35bc487cc2a3acedf978614fdf076a0baf41c9ab287d2`.

### Live dispatch to native recovery — 2026-10-29

The host now checks the exact durable live dispatch, broker grant and native
quarantine together before claiming prior-owner recovery. It can inspect the
recovered Session and seal already absent fenced source membership through
the existing separately journaled operation. When a claim or seal reply is
lost, or the live-journal lock reports failure after an effect, a successor
observes the existing native record and takes over without replay. Tests use
actual isolated server and broker processes and reject a foreign grant,
revoked enrollment and a lost preparation that created no quarantine. An
uncertain broker settlement remains bound to the original transition. This
does not clear the live journal or prove resource cleanup, destination
placement or receiver installation. Gate 2 remains open.

The real-server recovery test also seeds an actual source membership. Recovery
observes it as present and refuses to seal or remove it; an authorized source
detachment path is still required. Further restart cases cover a lost
successor-takeover reply and a lock-release failure after takeover, followed
by native re-observation rather than replay.

The current host control suite passed 412 tests. The native source and patch
fingerprints are unchanged from the preceding 7,232-pass Core and 93-pass
server verification; those suites were not rerun for this host-only bridge.

### Held-handoff source membership recovery — 2026-10-29

An exact successor native owner can archive the full quiet Turnlink membership,
remove its source key and install the source absence seal in one SQLite
transaction. The archive is insert-only and guarded against compatible writes;
the stored payload is not returned in the receipt. The host checks the exact
broker grant and held receiver before and after dispatch and records a durable
intent first. Tests use a real broker receiver swap and isolated native server,
including a lost reply, no dispatch, pending forms, mismatched source/channel,
missing membership, revoked enrollment, no handoff and a still-live source
owner. An uncertain result is observed through the archive and seal, never
replayed. The broker's source acknowledgement remains false; destination
archive consumption, receiver release, other resources, native placement and
both-runtime acceptance are unfinished.

Verification passed 13 real broker/native detachment cases, 425 host control
tests, 7,232 Core tests with 43 skips, 93 server tests with one skip, all 35
workspace checks, and Core/server builds. The native patch reconstructs tree
`2781e34b3a71b06d04c7eae5bd79336ea0a14782` and has SHA-256
`4c30dbec69fe47192c242339eed632b3c153b31ba85f08d7b963f091449eab21`.

### Staged source offer notification — 2026-10-29

The destination client now registers its prepared receiver key before a new
readiness request can notify the exact source connection. An explicitly opted-in
OpenCode source verifies the grant and native idle state, fences new local work,
and commits the offer itself; a blocked or busy source does not commit. Cleanup
also refuses persisted membership with a changed channel or pending forms. Tests
cover the ordering, candidate identity, blockers and lost-handoff recovery. The
full host control suite passed 429 tests before the final cleanup guard; the
subsequent focused receiver suite passed 30 tests. Forty-eight native recovery
and movement tests and the isolated OpenCode 2.1.3 service regression passed.
This is staged source-side wiring using an adapter fixture, not a
native destination installation or a complete movement acceptance. The held
handoff after a source crash still lacks broker-recognized detachment evidence.
Gate 2 remains open for those items, complete destination authority, physical
resource reconciliation and both-runtime end-to-end acceptance.

### Live-owner membership detachment and source recheck — 2026-10-29

The original live native owner can now atomically archive a quiet source
membership, remove its key and seal its absence under the original quarantine
lease. The destination-side bridge requires a matching held receiver, the
released native transport, fresh broker authorization and a durable dispatch
record. Lost results are reconciled by a successor observing the archive and
seal, without repeating deletion. The source adapter retains its membership
for native archival; an authenticated request to the exact old socket lets it
independently recheck absence and acknowledge detachment. A real broker and
native server exercised this flow with an adapter fixture backed by the same
SQLite database. The test does not claim that the plugin was loaded in the
native server or that a destination was installed.

Native verification passed Core 7,232 tests with 43 skips, server 94 tests with
one skip, both builds and all 35 workspace checks. The host control suite passed
443 tests before a final host-only recheck timing guard; the final 32 focused
receiver tests and the SQLite-backed integration passed after that guard. The
exported patch reconstructs native tree `d59719217fb5def0df19274d24afa10e70df07cb`
and has SHA-256 `5d50ef3de96302e59f96eca4aa4276d2503de3bd2e8482484c4c630635b88a75`.
The broker still cannot recover source acknowledgement after the old socket
disappears. Complete destination authority, native placement and membership
installation, physical resource and orphan reconciliation, both-runtime adapter
wiring, and approved-grant-to-accepted-task acceptance remain necessary.

### Receiver-bound inert destination membership — 2026-10-29

The current held receiver can authorize the original live native owner to
stage a destination membership after the source acknowledges detachment. The
native transaction validates the source archive and seal, preserves the entire
membership with only its directory changed, and records the exact receiver-key
hash under a protected insert-only key. The normal plugin membership remains
absent, the Session remains at the source, and broker delivery stays held. The
host journals dispatch and rechecks broker authorization, source acknowledgement
and receiver identity. A successor observes an existing stage after a lost
reply; absence after an ambiguous dispatch stays unresolved. A refusal before
dispatch can be retried after its condition is fixed.

An isolated real broker and native server with a SQLite-backed adapter fixture
proved source acknowledgement followed by staging, unchanged native placement
and held delivery. Focused tests covered lost and undispatched replies, rollback,
revocation, receiver-key drift, acknowledgement gating, and lost lock release.
Verification passed Core 7,232 with 43 skips, server 96 with one skip, both
builds and 35 workspace checks. The control suite passed 452 tests before the
final host-only lock-loss and dispatch-count test additions; the final 11 staging
and combined integration cases passed afterward. The exported patch reconstructs
native tree `d596d0eb165f109fb8a50ef5df1df75ec3ed8634` and has SHA-256
`42786c7e21f2fe8273b1aef3cf852e25b6114beade41ee25530a682b475078f4`.
This is not an installed destination membership or a placement commit. Complete
destination authority, physical resource reconciliation, recovery after loss of
the source acknowledgement, both-runtime integration and end-to-end acceptance
remain open.

### Native approval and form data ownership — 2026-10-29

Native permission preparation compares ordered source and destination rule
observations, separately identifies pending requests and executable hooks, and
rereads saved rules during validation. Managed policy, permission request
metadata, and native form fields and answers now use owned copies. Permission
and form event consumers receive separate copies. Data that cannot be cloned
without loss is refused. This is a compatibility constraint for plugins and
does not authenticate arbitrary event publishers or fence every form entry point.

The focused authority, permission, form, event and movement checks passed 229
tests. Full Core passed 7,242 tests with 43 skips; server passed 96 with one
skip; both builds, all 35 native workspace checks, 453 host control tests and
host syntax checks passed. Core and server tests preceded comment-only lint
annotations; 195 affected focused tests and all workspace checks passed after
those annotations. Server tests emitted listener warnings. The patch reconstructs
native tree `78d994e7bcf52ce0f8932e6c24878f29f948e277` and has SHA-256
`0b62850aff87e00192865962357fa59d39a51b7878d27bbe3918c64014b5e215`.
The built-in permission hook and atomic exclusion of external authority changes
remain unverified. Destination installation and placement, physical and orphan
resource reconciliation, source-acknowledgement recovery, production adapter
integration and both-runtime end-to-end acceptance remain necessary for Gate 2.
Movement stays disabled.

### Destination receiver recovery binding — 2026-10-29

New inert native destination stages include the exact transition ID and
receiver-key hash in the preserved membership. Older stages remain observable,
but a value without the current binding cannot establish plugin recovery. The
opted-in destination plugin can recover the transition-specific private key
after broker release, check the actual Session location and moved transition,
and retain the binding across membership writes. Deliveries are queued while
verification runs. Changed keys, held handoffs and mismatched destinations do
not admit work. A lost subscribe reply releases the possibly installed socket;
if cleanup is uncertain, the socket is terminated. A delayed move event to the
verified destination retains the membership, while a move elsewhere detaches.

A real broker and native server supplied the staged membership to the plugin
fixture; that test simulated native placement and broker settlement. It did not
load the destination plugin in the native server or establish placement,
installation, candidate ownership, or permission to release. Verification
passed Core 7,242 with 43 skips, server 96 with one skip, both native builds,
35 native workspace checks, and 457 host control tests. The host suite preceded
the last adapter race fixes and two added tests; afterward 28 focused adapter
tests and the staged-membership integration passed. Host syntax and whitespace
checks passed. The native patch reconstructs tree
`9c97763ae40c4893e00afb27ea6a33f36988617b` with SHA-256
`660fecdf20e1c8d3dd80352cc65757eba9a9d31bcfee43a1ae549c0440531872`.
Gate 2 remains open for actual destination installation and placement, complete
authority and resource reconciliation, source-acknowledgement recovery,
production adapter integration and both-runtime end-to-end acceptance.

### Plugin-owned destination candidate and recovery — 2026-10-29

The opted-in OpenCode destination plugin can now own the broker's held handoff
candidate through a Location-scoped RPC guarded by a separate private
capability and the enrolled adapter credential. The host forwards narrowly
scoped broker authorization and source recheck through the plugin's actual
socket, so existing live detachment and staging use the same receiver. The RPC
cannot settle a movement, install membership or release the hold. A unique
plugin incarnation and socket disconnect generation invalidate stale host
handles; capability checks are repeated after forwarded calls. Lost offer and
resume replies can be reconciled using the already persisted receiver key.
The loopback client refuses redirects and bounds responses.

An isolated real native server loaded the destination plugin and exercised
broker handoff, source detachment, source acknowledgement and destination
staging. After a Location reload, the old host handle was refused; a fresh
plugin recovered the same held receiver. After graceful shutdown of the native
server, an explicitly enabled recovery server resumed that receiver, claimed
the prior native quarantine and observed the staged membership. The source
adapter was a SQLite-backed fixture, and the source-run native CLI's `local`
version was replaced with the checked-out version by a test wrapper. This is
not an actual placement, installation, cleanup proof or complete end-to-end
movement. A separate adapter fixture simulated placement for the released
receiver recovery check.

The host control suite passed 463 tests before the final resume revalidation,
response-size and redirect guard, and two added tests; afterward 22 focused tests and both native
integration variants passed. JavaScript syntax and whitespace checks passed.
The native source and its verified patch fingerprint remain unchanged from the
preceding checkpoint. Complete destination authority, physical and orphan
resource reconciliation, native placement and installation, source
acknowledgement recovery, production wiring and both-runtime acceptance remain
required for Gate 2.

### Recovered source acknowledgement and successor staging — 2026-10-29

An explicitly configured broker-owned verifier now inspects the claimed native
recovery owner, protected source archive and seal rather than accepting a
caller-supplied receipt. The broker refuses while the old source socket is live,
rechecks receiver identity, grant and enrollment after verification, and
persists the original, recovery and seal lease identities with the seal nonce.
Failed persistence is reconciled after restart. The verifier is a trusted
in-process broker dependency and is not configured by the normal launcher;
this is not independent cryptographic attestation of a remote host.

After that acknowledgement, a successor native owner can stage the exact
archived membership for the held receiver. A separate durable journal records
dispatch before the native effect. Lost replies are observed under a later
recovery owner without repeating the stage; no-dispatch and rollback cases
remain unresolved. Staging refuses an unacknowledged source or a changed
receiver key. Native integration variants cover original-owner detachment,
successor detachment, source and broker restarts, recovery-owner takeover,
lost replies, no dispatch and transaction rollback. The source adapter remains
a fixture; the source Session stays in place and the receiver stays held.

Verification passed Core 7,242 with 43 skips, server 96 with one skip, both
builds and all 35 workspace checks. The host control suite passed 477 tests
before the final receipt identity checks and one added mismatch test; afterward
48 focused broker/adapter tests and nine native integration variants passed.
The Core run preceded a server-test-only negative case; the final server suite
and workspace checks included it. Server listener warnings remain. The patch
reconstructs tree `2ac026880c9edac49c445b40e07831843d2221ca` and has SHA-256
`9aa286603f83b73c5813343c5c5a2421ae3b7a4b95cdcd3799b6b168a1c459af`.
Actual native placement and membership installation, full destination authority,
physical and orphan resource reconciliation, production wiring and both-runtime
end-to-end acceptance remain required for Gate 2.

### Native model-acquisition check at placement and completion — 2026-10-29

The native transaction engines now reject outstanding durable model WebSocket
acquisition records for the moving Session and its persisted or pending child
ancestry. They check current-lease as well as earlier records inside their
database transactions. A focused test exercises root and child refusal, rollback,
eventual completion after native settlement, and an unrelated Session control.
Placement and completion now also reserve the known descendant execution keys
and recheck the census before proceeding. Registered descendant activity is
refused if already active and deferred while the reservation is held. These
checks do not move children or prove exclusion of untracked resources, external
work, remote work or incomplete destination authority. Those boundaries,
production wiring and both-runtime acceptance remain open.

### Delegated handoff testing — 2026-11-05

The connected Claude Desktop Code agent reported running the receiver handoff
and worktree task dispatch suites on a temporary Windows project snapshot: 43
passed, with no failures or skips. This is the agent's report, and that snapshot
is older than the current workspace; it is not full migration acceptance.

The current workspace now also tests an OpenCode message held until verified
release, acknowledged after delivery, and not redelivered after a broker
restart. The acknowledgement is checked in the reloaded store. The completion
verifier and receipt are fixtures, and the test does not promise exactly-once
delivery before a persisted acknowledgement. The receiver handoff suite passed
47 tests. Two cases inject failures immediately before and after the
acknowledgement store write, after verified release. Following broker restart,
the message is redelivered if the write did not occur, and is not redelivered
if it did; retrying the persisted acknowledgement succeeds. Both writes return
an error to the client; the after-write case models a lost successful reply.
These are injected persistence failures, not a real network partition.
In a separate Codex task fixture, a lost report response was followed by a
runtime restart: the native task and report were each invoked once, and the
explicit participant report left the task in review. This focused test passed
on 2026-11-06. It uses a simulated native task and does not establish recovery
for every lost task reply or the full production handoff. These results do not
close Gate 2.
