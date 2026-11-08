# Codex native continuity extension: scoped development design

Development source: `openai/codex` commit `970111f6cb62cc02fe36a82ea7d71b37a2889c97`, isolated under ignored `.native-runtimes/codex`. This is an extension of native Codex, not a Turnlink request field that claims ownership. Production movement remains disabled. This native-source work does not replace installed runtimes or change global configuration. The separate current-environment integration installation is recorded in [IDE acceptance](ide-acceptance.md). No editor is launched by this work.

The installed-runtime evidence and remaining acceptance boundary are in [codex-native-continuity.md](codex-native-continuity.md). The native source changes described here are staged development until their tests and actual process acceptance pass.

## Native seams

`core/src/session/mod.rs::update_settings_if` validates a candidate and evaluates its synchronous commit predicate under the same state lock used for publication. `CodexThread::preview_thread_settings_overrides` calls a noncommitting preview, but its `ThreadConfigSnapshot` omits complete instructions and tool authority. `AgentsMdManager::refresh` resolves native instructions but publishes its cache and can call host providers, so calling it on the live manager is unsuitable for a read-only destination preview. `session/turn.rs::built_tools` can fetch external recommendations; `tools/spec_plan.rs::build_tool_router` centralizes assembly, but inspection confirms that it populates live MCP handler/search caches and adapts extension executors. Detached tool preparation must inject separate caches and known captured inputs rather than call this builder against the live session.

Settings updates and turn starts share `session/handlers.rs::submission_loop`. The ordinary settings RPC acknowledges enqueueing. Its optional core completion reply precedes event delivery and does not itself establish a flushed transition receipt. The extension must distinguish these stages explicitly.

Native connections already have host-owned `ConnectionId` values. The extension must capture connection identity in the transport session and attach it inside the native host; JSON parameters must not name or fabricate an owner. A restarted connection receives a new native identity.

## Stage 1: native reservation and mutation CAS

Add an opaque host-created connection identity and native-issued per-acquisition generation, plus a per-thread publication revision. Keep reservation state under the core session state lock. Acquire through the real submission queue only while no turn/admission, pending input, approval, realtime execution or background terminal is active. Acquisition and automatic mailbox admission use the same admission-lock order.

All competing mutation paths must refuse or invalidate the reservation. This includes queued turns/recovery/settings/realtime/shell/history operations and direct settings/config/environment/history changes. Reads remain available. Human interruption and shutdown continue immediately and invalidate the reservation. An uncertain or disconnected owner cannot silently release a hold or reacquire using a stale generation.

Commit requires the exact captured native connection, issued generation and publication revision. Validate them against the current state at publication under the persistence permit. Keep the reservation until the exact resulting receipt has been appended and flushed and the authenticated receiver has been rebound. A queued acknowledgement, native event or guessed path is insufficient. Unknown submission or flush outcomes retain a quarantined hold; restart invalidates old capabilities and does not replay.

Start with real native queue tests for foreign connections, competing mutation, stale generations, publication races, human interruption, disconnect and persistence failure. Then exercise staged app-server processes with the synthetic loopback provider, independently from the Turnlink fixture tests.

## Current native implementation boundary

The pinned source now has the core reservation/mutation gate, captured transport-owner lifetime, publication CAS, private Unix acquisition/submission/commit/release journals, and quarantine restoration before the native session is published. Private continuity operations use a small dispatcher on the same submission queue; they do not enter the general operation dispatcher's large debug stack frame. Commit retains the mutation writer permit through native rollout flush and its exact receipt. Completed transition UUIDs are checked against the bounded persisted history before a new effect.

This is still staged internal development. Commit currently checks canonical local cwd and native settings/permission validation; it does not yet resolve complete destination instructions, tool/plugin/environment authority or perform the exact destination receiver acknowledgment. The internal release primitive does not yet enforce that receiver handshake. No public continuity RPC or production adapter capability is exposed. Test results and the reproduced/fixed default-stack failure are recorded in [the execution ledger](remaining-development.md).

## Stage 2: nonpublishing native authority preparation

Extract a destination plan from the same native validation and resolution pipeline that execution uses. Capture effective filesystem/network/exec policy, approval policy and reviewer, named permission-profile provenance, environment selections and workspace roots, actual instruction provenance/content commitments, and the actual native tool inventory and policy. Preserve thread history, developer/global authority and model/provider selection.

Resolve repository instructions into a detached candidate. Do not publish live instruction caches, invoke hooks, start a model turn or launch MCP processes merely to make preflight appear ready. Pending or unresolvable native providers/catalogs are an explicit refusal. Cached labels and MCP-only inventory do not represent the full execution authority.

Bind the prepared plan to the native writer generation and revision. Revalidate native authority at commit; reject drift rather than retagging an older observation. Any proposed immutable preparation consumed by the following turn must still honor live permission revocations and native approval rules.

The first preparation component now provides a read-only preview on the actual native Codex-home instruction reader. It preserves native file precedence/normalization, refuses uncertain higher-priority reads, leaves the live cache and warning history untouched, and bounds each preparation file read to 1 MiB without truncating an accepted value. All ten home-reader tests pass. This is exported as a separate incremental patch; it is not yet the complete Core destination plan. The normal app-server always supplies a user-instruction provider, so integration must bind this known native reader to the same actual provider instance used for execution. Blanket provider refusal would exclude the standard host. Arbitrary provider callbacks must not be invoked just to claim read-only preparation.

The native app-server now installs its concrete home reader through a pre-start Core builder that selects the same `Arc` instance for execution and preparation. Root spawn inputs retain this binding. Core checks pointer identity and invokes only that concrete reader; unknown user/thread callbacks, pinned project snapshots and unrelated native instances refuse this host-only preparation step. Existing generic provider traits are unchanged. The combined snapshot passes 2,819 Core tests, ten home-reader tests, the additional six-case default-stack continuity run and the app-server check. The host-only method is intentionally not yet the complete destination planner.

Detached repository instruction preparation now uses the same native discovery and assembly pipeline without publishing the live cache. It requires an entirely ready environment view and never polls startup futures. Preparation refuses uncertain root discovery or disappeared/read-failed documents and reads complete raw streams within an aggregate 1-MiB cap before applying the native effective-prefix limit. Oversized raw input refuses preparation; ordinary runtime fallback/truncation stays unchanged. The combined snapshot passes 2,824 Core and ten home-reader tests, including five new repository/environment cases; six continuity cases also pass on the default stack. This component still needs native reservation-bound destination config/environment capture, complete policy/model/tool authority, commit revalidation and receiver/release integration.

Native candidate-input capture now binds the real reservation and current source configuration to completed configured executor handles without polling startup. Its cwd/root candidate shares commit's native settings validator and the native per-selection environment defaults. Retained source/destination Unix directory handles detect same-path replacement; native ownership and source bindings are checked again after directory I/O. Source-cwd shell snapshots are cleared from the detached destination view. The configuration still retains source layers/trust: candidate inputs are not complete destination authority, execution readiness, a grant, old-writer exclusion or a receiver/release receipt. The current full snapshot passes 2,830 Core and ten home-reader tests, twelve additional default-stack continuity/preparation cases, and app-server compilation.

The native Git trust parser now supports a strict preparation entry point. Ordinary resolution retains its Option/fallback and older-executor read behavior; preparation preserves typed I/O errors, refuses unresolvable administrative links, and reads streams through EOF within the native 64-KiB raw metadata limit. Both paths share linked-worktree registration, main-root validation and native path handling. Six new cases, including known absence, unreadable ancestry/HEAD, disappearance, file growth, late stream failure and foreign registration, pass in the current full snapshot: 2,836 Core, 46 Git-utils and ten home-reader tests. Twelve default-stack continuity/preparation cases and the app-server check also pass. The root API must still be consumed by actual destination project/config trust lookup and reservation-bound authority preparation; it does not itself approve a project, drain resources or enable movement.

Detached destination project configuration now captures discovery inputs directly from the native loader before credential remap replay. Preparation checks actual global and filesystem-produced project signatures, preserves explicit project-config suppression, resolves destination trust with strict native discovery, and shares ordinary project parsing, sanitization, relative paths and linked-root hook projection. Complete raw reads share a 1-MiB budget; disappearance after discovery and unreadable project-directory metadata refuse. Revalidation compares raw file presence/bytes as well as effective layers and trust. No hook is executed and no live source cache is published. All 387 config cases pass separately, and the combined Core/Git-utils/home libraries pass 2,837/46/10 cases; twelve default-stack continuity cases also pass. Applied global inputs are snapshots, not a forced refresh. This component still needs reservation-bound candidate/instruction consumption, current global/model/tool/policy authority, publication revalidation and receiver/release integration.

The native Session now has an internal reservation-bound instruction preparation that composes candidate capture, strict destination project configuration and detached instruction loading. A private instruction-only Config projection uses destination trust, layer stack, document limit and normalized fallback names; ordinary execution shares the same document-setting normalization. The projection is never installed as an execution configuration. Revalidation checks native ownership/revision, source bindings, retained directories, raw project configuration and freshly loaded instruction content/provenance. Four integration regressions cover destination document settings without publication, untrusted destination exclusion, project/document drift, and foreign/closed ownership. All four pass, including on the default stack. This does not yet resolve complete global/model/tool/policy authority or connect the prepared observation to commit/receiver/release.

Native model metadata preparation now uses safe concrete type inspection on the actual session manager and its native endpoint. This retains originator partitioning without reconstruction and refuses unknown implementations without invoking their callbacks. A nonblocking catalog observation shares execution's default/explicit matching, API-key discovery visibility and metadata overrides; native cached auth identity is checked before and after capture. Core binds the result to actual reservation, directory/environment inputs, provider pointer, step settings and startup model overrides. Same-revision model changes refuse revalidation. The six Core metadata cases and the native catalog-lock regression pass, including the Core cases on the default stack. This remains a current metadata observation: fallback metadata is preserved explicitly, and complete provider readiness, remote/global freshness, tool/policy authority and publication/receiver consumption are still required.

The actual tool routing pipeline now accepts explicit cache ownership. Ordinary execution retains its existing live caches and extension callbacks; detached preparation uses separate MCP handler, shared-definition and tool-search caches and returns data-only declarations/routing properties. Two real native loopback MCP bindings verify output equivalence, unchanged source handler/definition/search state and zero additional requests. Further cases cover native policy/dynamic/Code Mode behavior, collisions, incomplete environments and unknown callback refusal. All five pass, including on the default stack. Extension contributors without bound native observations refuse rather than silently disappear; actual reservation-bound destination permission/configuration/MCP inputs are still required for standard-host use. This is not complete tool authority or an executable destination grant.

The native host can now hand Core data-only extension declarations bound to actual contributor Arc identities. The detached router checks exact contributor order and cardinality before assembly; missing, foreign, extra or reordered observations refuse without callbacks. A private adapter exposes only captured metadata to the shared builder, always refuses invocation and is never returned. Two new Core regressions verify those bindings, deferred visibility, no live callback invocation and parity with ordinary assembly, including on the default stack. This is a trusted Rust host bridge, not a generic claim that contributor methods are read-only: only owning-crate collectors may inspect known concrete metadata without provider/discovery/analytics side effects. Applied-scope observations must not be retagged as fresh destination state. Reservation-bound global/permission/MCP scope capture and publication revalidation remain required.

Eight owning-crate collectors now use concrete ToolContributor inspection, never unknown callbacks, to read already published native state. Web and Image share pure native schema builders without constructing providers or invoking the save-root resolver. The shared Skills construction path skips analytics initialization only for preparation; ordinary construction retains its existing publication. File-copy metadata requires no environment access, and Memories creates no storage. History requires a published identity and either active configuration or its explicit native disabled record. Message-board startup records completion separately from missing/failed initialization; its factory and namespace resolver are never called for preparation. Goal requires coherent applied configuration/runtime state and captures the native visibility and metadata. Nine regressions pass, including all nine on the default stack. Two existing host-loader tests were corrected to assert every fixture-owned entry without requiring the real user's unrelated skills root to be empty; runtime discovery is unchanged. Complete selected libraries and Goal backend tests pass. The collectors remain applied-scope observations: detached destination scope/configuration equivalence and reservation/publication freshness are still required.

The standard app-server now installs closed native collection through immutable registry registration. `codex-native-tool-preparation` owns the explicit eight-crate dispatch above Core's dependency boundary; each owning helper performs concrete type inspection before accessing its native scopes. Core does not depend on the host collector crate. Registration is a fixed native Rust function configured before registry publication, not a model/plugin-JSON assertion that callbacks are read-only. Registry cloning retains it and supplies the current registry at every call. Unknown contributors and uninitialized native state return bounded typed errors; no partial declaration set escapes. Core's native-scope entry point checks environment readiness before collection, passes actual session/thread/step stores, then retains the existing identity/order checks and private-cache assembly. Four host tests, two Core tests and six existing registry integration cases pass. The all-eight fixture runs ordinary lifecycle/Skills preparation once before observing metadata and confirms no further board/save-root lifecycle callback. Applied native scope metadata still does not establish fresh destination global/configuration/permission/MCP state, provider readiness or an executable movement plan.

Native configuration file freshness now binds loader-owned digests/absence from the actual global file reads to the same native epoch used for project and instruction preparation. Complete rereads share the global/project raw budget and reject file drift, uncertain streams, conflicting duplicate reads, retagged layers and replacement epochs. This checks filesystem inputs without refreshing callbacks or publishing destination configuration. All 392 config cases, 2,859 Core cases, six registry cases and 50 default-stack preparation cases pass; app-server compilation passes. MDM/provider/environment and auxiliary input freshness, complete destination permissions/MCP construction and publication-time consumption remain required.

The shared native destination construction path now routes custom model catalogs through its selected filesystem; direct host-disk reads no longer bypass a preparation filesystem. Two actual constructor regressions cover virtual catalog input and typed refusal despite an available host file. Current verification passes 2,861 Core cases, six registry cases, 52 default-stack cases and app-server compilation. This is an input-routing prerequisite: the memory-version existence check, captured invocation overrides, bounded auxiliary/discovery reads, strict native trust consumption and environment/provider provenance still need integration before complete destination materialization.

Native memory-version selection now uses selected-filesystem metadata instead of host-only existence. Only NotFound selects the fresh profile version; typed uncertainty retains V1, and explicit choices avoid the probe. Three semantic constructor regressions cover selected presence/absence against opposing host state, uncertainty and explicit choices; existing host memory remains unchanged. Current verification passes 2,864 Core cases, six registry cases, 55 default-stack cases and app-server compilation. Captured invocation overrides, bounded auxiliary/discovery provenance, strict destination trust consumption and environment/provider freshness still need integration before complete destination configuration/permission/MCP authority.

The shared native Config constructor now captures actual invocation overrides into an opaque immutable record, preserving clone identity and refusing missing provenance rather than inferring original choices from effective fields. Semantic Config equality excludes this provenance, as layer-stack equality excludes native loader provenance; authority validation must bind actual native ownership independently. Debug does not reveal raw overrides. Three new constructor cases pass, with the full current checkpoint at 2,867 Core cases, six registry cases, 58 default-stack cases and app-server compilation. This captures inputs only: later host/session settings, original relative-path/workspace semantics, strict destination trust, bounded auxiliary reads and full destination configuration/permission/MCP construction remain open.


The shared constructor's next input-capture prerequisite is now staged as a read-only preparation filesystem. EOF streaming, shared 1-MiB payload/path and 256-operation/chunk budgets, known absence and exact file/metadata/canonical observations permit bounded revalidation; uncertain or cancelled reads poison capture even when native fallback logic succeeds. Unsupported unbounded directory/walk operations, writes, sandbox substitution and no-follow reads refuse without delegation. Ten regressions include actual catalog loading and a full constructor swallowing uncertain memory existence. Current verification is 2,877 Core cases, 3,326 unique selected library cases, ten new default-stack cases, app-server compilation and six registry cases. This is not complete destination construction: bounded native directory discovery, actual delegate readiness/streaming, strict trust consumption, environment/host/session authority and publication/receiver/release remain required.


Bounded native local directory discovery now participates in constructor input capture. The Rust filesystem trait defaults unknown transports to Unsupported without falling back to ordinary enumeration. Native local enumeration charges entries/bytes before collecting them, retains native symlink semantics and rejects partial results, entry uncertainty and lossy names. NotFound is reserved for an absent directory at open; a broken entry cannot disguise the whole directory as absent. Capture normalizes order, shares a 4,096-entry quota with its existing byte/operation budgets, records membership/type/absence and revalidates it. Direct nested bounded-capability probes explicitly poison capture on refusal. Full constructor fixtures demonstrate native nested role discovery with ordinary configuration parity. Current final verification is 2,883 Core / 429 executor / 3,761 unique selected library cases, sixteen capture cases on the default stack, app-server compilation and six registry cases. A prior tracing-context fixture failure and its passing isolated/final full reruns remain recorded, not described as fixed. Linux non-UTF-8-name acceptance remains unrun. Complete reservation-bound destination construction/authority, host/session/environment freshness and publication/receiver/release remain open.


Full detached Config-value construction now shares the ordinary constructor, with a native-only context for strict project cwd/trust and captured PATH/TMPDIR/SQLite-home/effective-home/process-cwd inputs. It first reconstructs source effective values from actual retained invocation/loader provenance, then resolves destination permissions, model/MCP declarations, prompts and roles with bounded native reads. The invocation record binds the actual resolved constructor cwd; edited/relabelled cwd or current session cwd/home mismatch refuses. Native owner-bound preparation retains actual session settings/provider separately, revalidates consumed runtime fields and source bindings, and publishes neither value. Seven constructor cases plus native ownership/no-publication/model-drift pass on the default stack; large preparation/revalidation futures were boxed after reproducing an overflow, without changing stack limits. Current verification: 2,891 Core / 429 executor / 3,769 unique selected library cases, app-server and six registry passes. Config equality establishes value parity, not opaque callback identity, mutable host revision or fresh provider/MDM readiness. The two app-server-owned policy/auth route fields retain their actual source references; complete native authority assembly, commit/publication and receiver/release remain open.


Native constructor and runtime enforcer identity now have explicit witnesses. The config crate's opaque native binding retains validator/normalizer Arcs and checks typed identity without invoking them or cloning values. Core records completed-constructor approval, permission-snapshot, residency, MCP and web-search enforcers in invocation provenance. Missing/replaced records refuse source preparation; detached revalidation checks destination lineage, and owner-bound continuity checks actual runtime approval/profile enforcers even when values remain equal. Four RED reproductions failed before implementation and pass afterward. Enforcer-checkpoint verification: 2,896 Core / 429 executor / 3,774 unique native cases, separate config 398 (4,172 across scopes), nineteen default-stack cases, app-server and six registry cases. This is allocation lineage only: mutable capture changes remain invisible to identity by design and have an explicit limiting regression. Complete state/revision, provider/model/tool permission authority, publication and receiver/release remain open; no public wire capability or movement activation changed.

## Compatibility boundary

The native file writer lock is cooperative. Adding generation/CAS to the current native source can protect participating native ingress, but cannot constrain an already loaded old runtime that ignores the lock. A sidecar lease, executable allowlist, filesystem scan, or chmod after a file descriptor was opened does not repair that boundary.

Production support therefore also requires an explicit, verified runtime migration or OS-enforced storage/execution isolation that removes the old writer's ability to continue the same managed resource. This source extension does not install that boundary or infer it from a source/binary hash. Existing incompatible native homes continue to refuse movement. The exact task grant, owner fence, native effect, receiver rebind and restart reconciliation must all pass together before gates 2/3 can close.

## Build isolation

The pinned source requires Rust 1.99.1. Its official toolchain is installed only under `.native-runtimes/codex-toolchain`, with the official rustup-init SHA-256 checked before execution. `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `PATH` are command-local. No shell profile or global Rust installation is changed. Dependency build output and source artifacts remain in ignored development directories; the current development patch, pinned manifest and reproduction instructions are exported under [native/codex](../native/codex/README.md). Forward-index and reverse-worktree application checks pass; native tests and complete transition acceptance remain separate requirements.


Applied network-policy epoch checkpoint (2026-10-28): native detached Config preparation now binds actual application-policy owner/view, availability, account/load revisions and a separate checked effective-change generation. Nonblocking capture/revalidation creates no permit or refresh and rejects busy/poisoned/exhausted state. Effective updates, including ABA, invalidate prior preparation; checks bracket asynchronous reads. Three Core and seven HTTP regressions/controls pass; full scope is 3,777 selected native cases plus HTTP 125 and config 398 (4,300), with 23 default-stack cases, app-server and six registry passes. This supplies applied policy observations, not external requirements/provider/model/tool freshness or atomic commit authority. Full Gate 2 remains open.


Catalog/discovery checkpoint (2026-10-28): model metadata retains native allocation change identities for actual catalog publication/invalidation/source conversion and shared API-key-discovery updates. Retained allocations cannot be reused across ABA; originator managers share the actual discovery witness. Capture is nonblocking and refuses busy/poisoned observation locks. Discovery locking ends before metadata construction and is rechecked afterward; ordinary updates still apply under recovered poison. Two RED regressions precede six passing native manager cases, and Core verifies real provider/originator discovery ABA without new requests. Verification: 3,783 selected native cases, separate config 398 and HTTP 125 (4,306), twelve default-stack cases, app-server and six registry passes. Auth/account and external requirements/provider/tool readiness remain unfinished; this is applied metadata observation, not commit authority or Gate 2 closure.


Applied auth checkpoint (2026-10-28): native cache/source observations retain actual owner/change identities, external-source allocation and shared ChatGPT identity-metadata changes; metadata identity reads use detached frozen JSON. Capture is nonblocking and refuses busy/poisoned/permanent-failure/pending/exhausted state. Native install/clear, reload/account reload, refresh, identity bootstrap, logout/revoke and forced-workspace changes keep preparation refused across awaits and invalidate on completion/cancellation, without changing existing auth-watch revision semantics. Static/OpenAI model metadata separately binds actual manager and endpoint auth owners before/after preparation. Two RED regressions precede five Core and ten auth cases, plus enhanced real identity/account tests. Full verification: 4,007 selected native cases (including login 219), separate config 398 and HTTP 125 (4,530), 21 default-stack cases, app-server and six registry passes. The explicit same-callback/unpublished-state test demonstrates the remaining external freshness boundary. These applied observations do not establish complete destination authority, execution readiness or commit exclusion; Gate 2 remains open.


One-candidate data assembly checkpoint (2026-10-28): the native acquired reservation now owns one detached Config/current model-auth/bound instruction assembly, preserving actual operator choices separately from Config defaults. Instruction reads consume the native destination Config; configuration/runtime/owner checks bracket instruction I/O, model/auth are rechecked and native instruction-source identity is checked after the last async Config read. Native instruction refresh has pending/owner/change identity across wait, completion and cancellation; equal resulting text cannot retag old preparation. The API boxes its future and large owned result to avoid a reproduced default-stack overflow; fixture/future boxing alone was insufficient. Five assembly and three binding cases pass on the default stack; final scope is 4,015 selected native cases, config 398 and HTTP 125 (4,538), app-server and six registry passes. Ordinary restored document bytes remain observational data, not filesystem exclusion or permission authority. Destination provider/MCP/tool resources still require explicit approved native establishment and complete authority; this type cannot stand in for that grant or receiver/release flow. Gate 2 remains open.


Selected-provider definition checkpoint (2026-10-28): the reservation-bound data
candidate retains the actual native provider, exact selected key, native destination
definition and both stored/original factory auth observations. Configured, GCP and
Bedrock inspection uses closed raw native fields; arbitrary callbacks refuse.
Resource declarations do not resolve credentials, start commands or construct a
destination provider. GCP destination cwd uses the real native constructor and
project provider restrictions remain intact. Verification and pinned hashes are
recorded in the execution ledger. Full authenticated approved resource effects,
writer exclusion, commit/recovery and exact receiver handoff remain open for Gate 2.


Explicit provider factory checkpoint (2026-10-28): a separate consuming native
construction API uses the ordinary factory with retained original base auth,
not the source command wrapper. The owned result retains its actual provider and
destination cached-auth observation, validates source/destination observations
before returning and rejects known deferred gateway setup failures. This is an
explicit effect, separate from read-only preparation; native shared caches keep
ordinary lifetime semantics. Latest changed-scope verification is 131 provider
library tests, four default-stack construction cases and app-server compilation.
Broker-approved invocation, complete credential/environment readiness, native
resource census/exclusion, session publication and exact receiver/commit remain
open. No public RPC or movement activation was added.


Broker boundary checkpoint (2026-10-28): the internal coordinator now calls fresh
`control_worktree_authorize` after local verification and before native invocation.
Actual enrolled receiver/credential and exact current prepared grant/claim/approval,
occupancy and runtime evidence are checked without replayable command receipts.
This response is broker eligibility, not a native owner/permit. Native integration
must bind the trusted control channel's captured owner and reservation to approved
state before calling explicit resource construction; arbitrary grant JSON and a
checkedAt value cannot create that authority. Native commit/receiver and complete
resource establishment remain unimplemented. JavaScript verification is recorded
separately from unchanged native patch evidence in the execution ledger.


Private owner/grant channel checkpoint (2026-10-28): an optional inherited local
Unix descriptor is attached to the actual initialized stdio session. Its private
acquire/bind operations capture that session's opaque owner and require target
subscription; broker validation is performed by the trusted host client before
binding. Core retains directory identities and a durable exact host record.
This is not independent broker verification inside Core or complete authority.
Bound records cannot use the legacy cwd-only commit/release path. Descriptor/broker
loss invalidates the owner and retains quarantine; there is no automatic reuse.
The caller-owned original descriptor remains an alias requiring census.

Verification includes 2,919 Core cases, four affected default-stack cases, three
app-server control cases, both production compilation checks, 53 JavaScript cases
and a staged Unix disconnect/restart process component. Its broker readiness
preconditions are synthetic; it does not prove the full movement chain. The
production proxy remains unwired. Explicit establishment approval, complete
resource owners/readiness/exclusion, permission freshness, native commit/recovery,
exact receiver handshake and both-adapter/platform acceptance remain unfinished.


Provider-establishment approval boundary (2026-10-28): broker schema/export 18 now
supports a separate `establish-provider` preview/grant with an exact opaque native
plan/reservation/process-generation reference. It does not require inventing a
ready destination authority digest before startup. A constructed receipt retains
resource/conversation exclusion; it neither permits movement nor proves credential/
tool readiness. Existing native movement-record binding refuses this purpose.

Next native work must produce the scoped plan from actual retained source/native
destination construction inputs and consume it exactly once through the private
owner channel. Register pending work before calling the real factory, retain the
actual constructed provider and classify shared/native owners through cleanup.
Do not substitute plan hashes, process IDs or JSON receipts for native ownership,
complete permission authority, alias census or disposal proof. Movement consumes a
separate complete authority/receiver protocol. The constructor consumer and scoped
cleanup/handoff are still unwired; production execution remains disabled.


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


## Scoped native provider-factory effect — 2026-10-28

The private inherited Unix channel now implements `planProvider` and
`constructProvider` in addition to acquisition and movement-record binding.
Planning retains the actual reservation-bound native Config, selected provider
preparation and directory identities. Its JSON disclosure contains an opaque plan
ID, process generation, reservation, paths, provider ID/family and commitment. The
commitment is not a complete destination authority digest. JSON cannot recreate
the owned native plan.

The trusted host retains the observed plan and obtains fresh broker authorization
for the exact `establish-provider` grant immediately before construction. Core
checks the actual captured owner/reservation, exact retained plan, scoped digest,
source/destination and current native preparation. Broker validation remains
trusted-host delegated, not independent broker authentication inside Core.

Before invoking the ordinary native provider factory, Core durably records
`provider_pending`. There is no await between that record, the synchronous factory
call and retention of the resulting provider/configuration. Success durably records
`provider_constructed` and returns a resource receipt. Failure after pending keeps
quarantine; receipt loss or duplicate invocation never causes factory replay.
Legacy movement binding/commit cannot consume a provider plan, and legacy release
cannot discard an established or pending provider resource.

The provider and retained Config remain native-owned. The broker's constructed
receipt keeps the conversation held; it does not authorize task dispatch, movement,
credential resolution or release. Descriptor/broker loss invalidates the owner;
restart retains quarantine and does not reconstruct a live resource from JSON.
Process-wide registries use weak references, but live provider aliases can share
resources. No cleanup, disposal or handoff proof is inferred from wrapper drop or
process death. Those operations, full resource/callback/permission freshness,
complete destination authority, native commit/receiver continuity, both production
adapters and platform acceptance remain open. Production movement/control wiring
remains disabled.


Native startup provenance follow-through: session startup binds configured token-
budget preferences and actual activation after its ordinary model/auth producer
runs. Reconstruction checks both the immutable binding and original configured
preferences before applying only those native fields. ConfigManager also applies
its actual `arg0` executable/sandbox paths through a constructor-input binding.
Neither mechanism blesses arbitrary Config edits, provides executable identity,
or certifies model/auth freshness. The accepted process component covers a real
approved configured-provider factory; complete migration acceptance remains open.


Unpublished factory-owner cleanup now uses the actual retained resource, never
process liveness, a PID, a digest or a caller-provided cleanup boolean. The provider
wrapper permanently records public handle exposure. Its consuming release refuses
exposure and uses `Arc::get_mut` to exclude both strong and weak aliases atomically;
refusal returns ownership intact. Shared pre-existing account/process state is not
evicted or claimed globally disposed. Core persists cleanup intent, destroys the
provider and all preparation fields, validates source directory identity, then
persists `owner_released` before dropping admission. Exact same-owner retries use
native completion memory; changed identities and new reservations refuse.
The broker's schema-19 cleanup receipt must match the entire original native
resource receipt, including resource ID. Only then may the abandoned provider
scope settle failed and release exclusion; its task and movement approval are
unchanged. Closed-owner/process-restart reconciliation and live-context disposal
remain unfinished and continue to quarantine.


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


Current increment: 724,747 bytes; SHA-256
`a1c094cfba494d1ebb9f8a20c82222afaf11f73eb329635a9b7c6ba50c56564a`.
Staged app-server: 727,417,648 bytes; SHA-256 `5a62956ab7fe133fe16b963ba3cecad2b9c082270423b949f747c9a4c5380763`.
Full authority, native resource/receiver migration and Gate 2 remain unfinished.


## Native MCP request fencing — 2026-10-28

Native runtime/client factories share a request owner across publications and
retained call handles. Reservation exclusion fences native requests and call
preparation before their effects. Event requests retain their permit through the
actual response; cancellation/outer errors retain uncertainty. Refresh publication
honors session admission and preserves invalidation on refusal. Restored unknown
owners suspend MCP startup and remain quarantined. This does not prove autonomous
servers, background credentials/raw SDK aliases, complete resource cleanup or
fresh destination authority. No ordinary MCP configuration was disabled.

Verification: 2,931 Core, 272 MCP and 263 RMCP library passes; one parent-ignored
child entry was actually run by its owner test. Seven new default-stack cases and
the unchanged current-auth integration case passed; that integration also passed
on default stack. Both source-built entrypoints and three warm private-channel
process cases passed. Initial CLI-probe/app-server-startup timeouts remain recorded
and cold acceptance stays open. Aggregate integration builds exhausted disk;
only the exact changed integration test ran through a temporary source symlink.
Parent JS/OpenCode scope was not rerun or relabeled. See the execution ledger for
logs, artifact archival/restoration and the complete remaining requirements.


## Effective runtime policy input binding — 2026-10-28

Destination data preparation preserves actual source selections while retaining
both source and target native approval/permission rules. Actual constructor,
effective and requirement enforcer identities are checked, including equal-value
replacements. Opaque source enforcers refuse before candidate creation. Shared
ordinary runtime projection and validation supply the effective input Config;
target provider-dependent capabilities and resource establishment remain required.

Verification: 406 Config and 2,933 Core tests, fourteen focused default-stack cases,
both entrypoint builds and three native private-channel process cases passed.
First initialization after build took 15.88 seconds within the existing 30-second
bound; this proves initialization only. Current increment: 799,917 bytes, SHA-256
`e129bee20dba25b3cdde16a21b8cf7a9303cfd8bac3644575fa5b9a3deeb2fd3`.
See the manifest and execution ledger for scope, artifacts and remaining work.
Gate 2, full authority and production movement remain open/disabled.


## Typed native acquisition refusal — 2026-10-29

Native pre-acquisition refusal preserves the private host channel without an
automatic retry. Existing owners/quarantine, journal errors and ambiguous transport
outcomes remain unavailable. Actual busy-turn refusal followed by same-owner idle
acquisition passes against the rebuilt executable. Verification: Core 2,935,
Config 406, two default-stack acquisition cases, host 22, parent 555/17 skipped,
both entrypoint builds and three warm private-channel process cases. The first
rebuilt initialize exceeded 30 seconds; cold startup remains unresolved. This is a
prerequisite for adapter integration, not full migration acceptance.
Current increment: 806,216 bytes; SHA-256
`ada16fe25661970715ed7000441e108402b4ce02551ace916946dab3b51cf747`.
See the manifest/ledger for artifacts and remaining full Gate 2 requirements.


## Approved target model-context construction — 2026-10-29

A distinct `provider_context` plan authorizes local construction of the actual
target provider's ordinary model manager, target catalog/normalization, native
cache configuration and selected model metadata. Native ownership retains the
manager and observation; exact-kind receipts and strong/weak alias checks protect
unpublished cleanup. Catalog fetch, credential helpers, cache I/O and complete
runtime readiness remain separate. Schema/export 20 protects this scope while
preserving schema-19 factory command fingerprints (red/green migration regression).

Verification: Core 2,936, Config 406, model-provider 136; three new default-stack
cases; changed host/broker 40; complete parent 562/19 skipped; both entrypoint
builds; five warm process cases including model-context construction/quarantine
and cleanup/same-source continuation. The first-launch initialization diagnostic
is recorded separately in the manifest/ledger and does not prove cold migration.
Current increment: 820,828 bytes, SHA-256
`eec26e0d4591689ec52e94cba4662baedf09db22df78c4158ee7d6ef034b521c`.
The full Gate 2 objective, resource/commit/receiver integration, both production
adapters and required platform acceptance remain unfinished; movement stays off.


## Same-owner resource reply recovery — 2026-10-29

Fresh broker authorization now permits read-only observation of actual retained
native ownership or actual completed cleanup. Effect timeouts retain the owner
and uncertainty; late replies cannot replay effects. Partial owned construction
stays uncertain, protected by schema/export 21. Cleanup after invalidation still
requires the same actual owner, exact resource and source witness. Final journal
failure retains admission and finishes the same receipt without repeating disposal.
Hard disconnect/new-owner and process restart remain quarantined, not reconciled.

Verification: Core 2,938 plus an actually invoked child-only fault case; Config
406; model-provider 136; two default-stack recovery parents and their isolated
real filesystem-fault child; changed host/broker 46; parent 568/21 skipped; both
entrypoint builds; seven warm process cases including dropped construction and
cleanup replies. First initialization is recorded separately, not cold migration.
Current increment: 835,547 bytes, SHA-256
`63e9a701b543d0bf6c2bc4b808954668a749d1d392c23c00cfd43720f591ac29`.
See the ledger/manifest for scope and the unchanged full Gate 2 requirements.


## Strict catalog publication data — 2026-10-29

An explicit-effect model-manager API now distinguishes actual endpoint response/
publication from picker fallback, skipped discovery, identity drift and refused
publication. Response membership excludes merged fallback; cache-write outcome
is explicit. Refresh epochs and active/uncertain work invalidate the observation.
Ordinary picker retries/fallback remain available. This is data only: concrete
implementation binding, effect authorization, physical resource ownership and
approved native catalog/auth bootstrap remain required.

Verification: model-manager 69, model-provider 137; six new default-stack cases
and an actual built-in-provider HTTP/native-cache case; app-server graph check,
both normal entrypoint builds and seven existing warm private-control cases.
Core/parent/OpenCode suites were not rerun. First initialization, preserved disk
failure history and lossless cache archival are recorded in the ledger/manifest.
Current increment: 856,263 bytes, SHA-256
`d56ef621ece167e671d2208519f913d7ddc3e04c94cbba241f1edcce152705fc`.
Full destination authority, bootstrap/commit/receiver integration, production
adapters and Gate 2 remain unfinished; movement stays disabled.


## Approved native catalog bootstrap component — 2026-10-29

`provider_catalog` is a separate native approval scope for configured-provider
catalog network, credential and cache effects. A retained worker owns the actual
provider through receiver cancellation, while session locks remain available.
Actual response membership and fresh non-fallback metadata are required. Used
resources cannot use unused-factory cleanup; a failed pending write before the
worker starts can release the exact unused owner.

Final verification: Core 2,938 plus parent-invoked child, nine affected Core cases
on default stack, provider 139, parent 571/21 skips in its run, 49 focused contracts,
both normal native builds and nine staged process cases. The new process cases
verify actual catalog/cache effects and disconnect during a real request, followed
by retained ownership and restart quarantine. Schema/export 22 prevents earlier
formats from hiding the new approval scope. Full authority, used-resource cleanup,
MCP/tool/environment establishment, writer exclusion, commit/CAS/recovery, exact
receiver rebind, OpenCode, production adapters and full acceptance remain open.
See the manifest and execution ledger for artifacts, failure history and scope.
Current increment: 874,026 bytes, SHA-256
`baf4390cae37df827be8c3fb760b6fec0ee24472ceb4659be5f80ddaacc61183`.
Movement remains disabled.


## Native model-cache worker ownership — 2026-10-29

Built-in cache reads/writes/TTL renewal now retain a native permit in their actual
blocking worker, surviving caller cancellation and cache destruction. A bounded
process-local registry and exclusive native cut cover compatible cache aliases,
independent same-path factories and originator partitions. New registration
invalidates the census; unknown worker termination prevents a clean cut. This is
not external/older-writer exclusion, HTTP/auth cleanup or Session/CAS integration.

Catalog construction now requires successful native cache persistence. A real
failing-write regression was red before the requirement and green afterward;
actual ownership remains retained/uncertain after failure. Verification: manager
70 plus parent-invoked child, provider 140, app-server check, both normal native
builds and ten staged process cases including failed-cache ownership recovery.
Core/parent/OpenCode suites were not rerun. The ledger/manifest records scope and
failure history. Current increment: 897,171 bytes, SHA-256
`e1ca5d17d8f01fb0b0ad4524b1a695afbb1639944d0dbd5f5db6c68319a44b12`.
Gate 2 remains open for full destination/resource/commit/receiver and both-adapter
acceptance; Gate 7 separately retains Windows/IDE and operational rollout.
Movement remains disabled.
