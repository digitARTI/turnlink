# Codex native continuity development patch

Current source exposes an owner-bound retained destination candidate to the
private host and binds new resource plans to that object. The current build and
26 staged cases passed, including unstarted-plan abandonment and same-owner
lost-reply observation. Pre-effect rechecks do not exclude changes restored
between observations; the candidate ID is not a movement grant.
The app-server dependency check and exact patch reconstruction passed. The
new Core regression and seven destination assembly tests pass on the default
stack; boxing the regression's legacy-commit future fixed a test stack overflow.
The rebuilt staged server passed 19 real-process cases, including candidate
retention and document-drift refusal. The candidate is not yet consumed by an authorized
commit or established as execution-ready.
Current increment SHA-256:
`bff380ab5dbfd75d1d049ef416ad93a86e05d73724eef6da6b552e646434f553`,
source tree `bb70a236c9989a2f572ac4e1a646f771a870bbc6`.

Latest provider-input checkpoint: preparation now privately compares bounded
observations of declared environment inputs and direct Bedrock auth/region
variables during revalidation and factory construction. The 144-case provider
library passed for the preceding provider-input checkpoint, whose increment reconstructed tree
`0b9fb47593cb5b2b7800c88ef3851b0dc1cf8e5d` with SHA-256
`d6235024ef44b66ad0e4b8188e4a10cdf1797340b56392b989bfcbf9677972a6`.
The provider-input app-server dependency check passed with staging warnings. This does
not establish credential readiness, changes restored between checks,
undeclared SDK inputs or complete destination authority. The rebuilt app-server
passed 18 staged native/broker cases; those tests do not establish live
environment drift exclusion or full movement.

This is unfinished native-source development for roadmap gate 2. It does not enable movement in the installed runtime or production adapters.

Upstream repository: https://github.com/openai/codex
Pinned commit: `970111f6cb62cc02fe36a82ea7d71b37a2889c97`.
Patch: [native-continuity.patch](native-continuity.patch), applied at the upstream repository root.

The patch adds host-created connection ownership, native reservation generations and publication revisions, a mutation admission gate, queued acquisition/commit/release, bounded private Unix completion journals, and restart quarantine for unreleased journals. It also contains native queue tests. Connection identity is not accepted from model JSON parameters. Private control operations use a separate small dispatcher on the same submission queue to keep native persistence off the general dispatcher's large debug stack frame. Commit refuses completed transition IDs from the bounded durable history before changing settings.

The complete design and remaining authority requirements are in [the extension design](../../docs/codex-native-extension-design.md). Destination instructions/tools/plugin authority, exact destination receiver acknowledgment, Windows journal durability/ACL acceptance, incompatible-writer exclusion, production integration, process-level crash acceptance, and a full upstream test run remain required. A changed cwd and a flushed receipt alone do not satisfy those gates.

## Reproduce

Use a separate checkout at the pinned commit. Rust 1.99.1 is required by the pinned upstream toolchain. Keep any private `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR` and PATH changes command-local.

The code-mode host also requires the sandbox-enabled V8 archive and binding specified by [the pinned upstream CI setup](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/.github/actions/setup-rusty-v8/action.yml). Verify its downloaded two-file checksum manifest against the target entry in the pinned `third_party/v8/rusty_v8_152_2_0_release_manifests.sha256`, then verify both artifact hashes. Set command-local `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH` to those verified files before building. Default denoland release downloads do not provide this sandbox variant; keep the native sandbox feature enabled.

```sh
git checkout 970111f6cb62cc02fe36a82ea7d71b37a2889c97
git apply --check /absolute/path/to/agent-channel/native/codex/native-continuity.patch
git apply /absolute/path/to/agent-channel/native/codex/native-continuity.patch
cd codex-rs
cargo build --locked -p codex-code-mode-host --bin codex-code-mode-host
cargo test -p codex-core --lib continuity_queue -- --nocapture
RUST_MIN_STACK=8388608 cargo test -p codex-core --lib
cargo check -p codex-app-server
```

The pinned upstream `justfile` and CI require an 8-MiB test stack for the broad suite. The six continuity cases also pass separately without a stack override.

Both a forward application check against an isolated index at the pinned commit and a reverse application check against the actual development worktree are required after every export. These checks prove patch applicability, not behavioral correctness. Verification results are recorded in the execution ledger; do not infer a passing build from this artifact's existence.

## Verified checkpoint

The complete native core library suite passed 2,816/2,816 with upstream's documented 8-MiB test stack and the exact built arm64 companion. All six continuity queue cases additionally passed without a stack override. The three companion transport/lifecycle cases passed against the real sandbox-enabled host. The exported patch exactly matches that tested source and passes pinned forward-index/reverse-worktree application checks. The app-server bridge also passes `cargo check --locked -p codex-app-server`. Remaining movement gates are recorded in the execution ledger; this checkpoint does not enable movement.

## Destination instruction preparation in progress

`instruction-preview.patch` is an additional patch applied after `native-continuity.patch`. Together they exactly reconstruct the current native worktree. This new component adds a bounded, read-only preview to the actual `CodexHomeUserInstructionsProvider`; it uses the native reader without publishing its fallback cache or consuming/resetting warning history. Reads over 1 MiB refuse preparation without truncation. Native live loading retains its existing behavior.

The increment also binds the standard app-server's concrete reader to the same execution-provider instance in Core. Unknown callbacks are not invoked, and a different native instance refuses preparation. The provider-binding checkpoint passed 2,819 Core and ten home-reader tests.

Detached repository preparation now shares native discovery, document-prefix assembly and provenance without publishing live caches. It requires all selected environments to be ready, never polls pending readiness, and refuses uncertain ancestor/discovered-file reads. Preparation streams to EOF within an aggregate 1-MiB raw budget before applying the ordinary effective-document limit, so a successful early prefix cannot hide a later read error. Oversized raw inputs refuse preparation; ordinary execution's fallback and truncation behavior is preserved.

Native candidate inputs now capture the actual queue-acquired owner/generation/revision, source configuration and completed configured executor bindings. The same native settings validator used by commit derives the cwd/root update; the native per-selection resolver supplies attachment roots. Source and destination Unix directory handles retain device/inode identity, so replacement at the same canonical pathname refuses revalidation. Capture leaves the live settings/cache/journal untouched and clears source-cwd shell snapshots from the detached destination view.

These are candidate inputs, not complete destination authority: the configuration still retains source project layers/trust until that authority is resolved separately. Model/tool metadata, destination trust, complete policy provenance, publication-time consumption, resource census and exact receiver/release integration remain required. Directory identity is not incompatible-writer exclusion.

Strict trust-root preparation now shares the native Git parser with ordinary resolution. It resolves linked worktrees to their registered main-root trust key through filesystem metadata, preserves native/portable path behavior, and distinguishes known absence from unreadable or unresolvable metadata. Preparation reads raw metadata streams through EOF with the existing 64-KiB per-file limit; growth beyond an earlier metadata observation and later stream failures refuse preparation. Ordinary execution keeps its Option/fallback behavior and older-executor whole-file transport. This is a trust-root observation, not project approval; actual destination project/config lookup remains required.

Detached destination project configuration now uses loader-owned discovery inputs and the shared native project parser, trust lookup, sanitization, relative-path resolution and linked-checkout hook projection. Source global and project signatures must match actual native loading; unknown or altered provenance refuses preparation. The preview replaces project layers only in a detached stack, reads complete raw streams within a shared 1-MiB budget, and revalidates file presence and bytes. It never executes hooks or refreshes cloud/thread providers. Global filesystem inputs are now revalidated as described below; complete provider/environment freshness and publication-time consumption are still required.

An internal reservation-bound instruction preparation now composes these native components. It captures candidate ownership and executor/directory bindings, resolves the destination's own project trust, and supplies destination document limits/fallback names through the same normalization as ordinary loading. Its private configuration projection is used only by instruction resolution and is never published as execution configuration. Revalidation checks current reservation/bindings, project-file provenance and fresh native instructions. Source settings and live instruction caches remain unchanged. Complete model/tool/policy authority, publication-time consumption and receiver/release remain open; this internal observation is not a movement grant.

Native model metadata preparation now inspects the actual concrete manager and endpoint without invoking discovery callbacks. It retains the manager's originator partition, reads current catalog state with a nonblocking lock, and shares ordinary catalog visibility, matching and configuration overrides. Unknown implementations refuse. Revalidation binds the manager instance, catalog/policy observation and actual thread model settings, including startup overrides changed at the same revision. No auth, disk-cache or network refresh occurs. Native fallback metadata remains explicitly represented; this observation does not certify provider readiness, remote freshness or complete destination authority.

Detached tool assembly now shares the ordinary routing pipeline with explicitly private MCP handler, shared-definition and search caches. It returns effective declarations, search/exposure/routing metadata, Code Mode mappings and the native startup policy without retaining callable handlers. Actual loopback MCP fixtures prove equivalent output, unchanged live caches and no additional requests. Unsupported extension contributors and incomplete environment views refuse. Actual reservation-bound destination permissions/configuration/MCP capture and publication consumption remain required; this applied-scope preview is not a complete destination plan.

A trusted native-host metadata handoff now binds observations to the actual contributor instances in exact registry order and count. Detached assembly never invokes contributor callbacks; a private metadata adapter always refuses execution and is dropped before the data-only snapshot returns. Two regressions cover foreign instances, missing/extra/reordered observations, deferred visibility and ordinary-plan equivalence without callbacks. These observations describe already applied scopes; the standard host still needs reservation-bound destination scope freshness. No public request conversion or destination grant is provided.

Owning-crate read-only collectors now cover the standard native file-copy, message-board, Goal, History/Notes, Memories, Web Search, Image Generation and Skills contributors. Concrete type inspection rejects unknown callbacks before reading state. Web/Image reuse native spec builders without creating model providers; Image never resolves save roots. Skills shares native tool construction while skipping analytics initialization. History and message-board lifecycle distinguish completed/disabled state from uninitialized or failed startup. Nine regressions cover native metadata parity and state preservation; all nine pass on the default stack as well. Two existing Skills host-loader tests now compare all canonical fixture-owned entries, retaining exact merge/precedence assertions while allowing unrelated real user skills; runtime discovery is unchanged. These are observations of applied scopes, not fresh destination state.

The standard app-server now registers a closed native collection function on each immutable extension registry. The new `codex-native-tool-preparation` host-layer crate depends on Core and the eight owning crates; Core does not acquire those host dependencies. Registry clones retain registration, and collection receives the current registry so additions cannot disappear from the observed set. Nonempty unregistered hosts, unknown types and incomplete native state refuse without ordinary contributor callbacks or partial results. Core reads the actual session/thread/step scopes, rejects unready environment views before invoking collection, and validates contributor identity/order before shared detached assembly. Four host cases and two Core cases pass, including an all-eight native lifecycle/step fixture; the six existing registry integration cases pass as well. This is trusted native Rust host registration, never model/plugin JSON, and observes applied scopes only.

Native loading now captures digests and known absence at the actual reads of packaged, system, requirements, legacy managed, user and profile configuration files. Preparation binds the native loader epoch and checks complete current streams before destination trust resolution; global and project files share the 1-MiB raw budget. Mixed reads, changed bytes, uncertain reads and oversized aggregate inputs refuse preparation without replacing live configuration. Ordinary loading retains its existing size behavior. Five config regressions and one reservation-bound Core drift regression cover this increment. MDM/provider/environment freshness, auxiliary files and complete destination permission/MCP materialization remain open.

The shared native Config constructor now reads custom model catalogs through its selected ExecutorFileSystem, matching role and prompt inputs. Two constructor regressions prove that a virtual catalog can be supplied without a host-disk file and that a filesystem refusal cannot be bypassed by a valid host file. Existing JSON and nonempty validation remain unchanged. This prepares the constructor for bounded detached input capture; it does not itself provide that capture or complete destination authority.

The shared constructor also checks V1 memory presence through the selected filesystem, following symlinks as ordinary loading does. Only known absence selects a fresh V2 profile; uncertain reads retain V1, and explicit version/transition choices skip the probe. Three regressions cover disagreement with host disk, preservation of existing host data and uncertain/explicit choices. This makes the decision observable by a preparation filesystem without creating memory storage.

The native Config constructor now retains an opaque immutable record of its actual invocation overrides before consuming them. Clones share that record; the internal reader refuses missing provenance. Config equality continues to describe effective values, and Debug exposes only whether capture is present. Three regressions cover original/relative/ignored inputs, clone identity, equal effective configurations with different invocation choices and missing-input refusal. This records constructor arguments, not an integrity seal for later Config field changes. Actual session overrides, host-owned settings, relative-path/workspace semantics and bounded full destination materialization still require explicit binding and consumption.

The constructor has a staged, read-only preparation filesystem for auxiliary and directory inputs. File EOF reads, directory membership/types, known absence, metadata and canonical results share a 1-MiB payload/path budget and 256-operation limit. Directory entries additionally share a 4,096-entry limit. Reads are revalidated, repeated observations must agree, and filesystem uncertainty or cancellation invalidates capture even when an ordinary helper swallows the error. Writes, sandbox substitutions, no-follow reads and unbounded walks refuse. Direct nested bounded-capability probes also explicitly refuse and invalidate capture; native discovery uses the wrapper's ordinary directory method, which delegates only to the strict bounded capability.

The new native local directory operation enforces limits during enumeration and preserves ordinary symlink-following semantics. Entry/target errors, lossy names and partial results refuse; only an absent directory at open returns NotFound. Unknown/older/remote implementations default to refusal without an unbounded fallback. Ordinary directory readers and public wire protocols are unchanged. Full constructor fixtures discover nested native agent roles, match ordinary configuration values and detect membership/type drift. This is not reservation-bound complete destination construction or authority publication. Actual delegate readiness, streaming behavior, strict destination trust and host/session settings still need binding and consumption.

Full detached destination Config construction now uses the same native constructor as ordinary loading. It consumes source/destination project previews, the actual retained invocation and bounded filesystem inputs; effective source-value reconstruction must match before resolving destination values. Strict construction consumes the exact preview cwd/trust root/active project instead of the ordinary Git fallback. PATH, TMPDIR, SQLite-home, effective home and process cwd are captured, used for native path/permission construction and revalidated. Raw relative additive roots follow native destination resolution; explicit absolute workspace roots retain their original meaning. The opaque invocation now also binds the actual constructor-resolved cwd, refusing a later edit or relabeling.

Reservation-bound preparation retains actual session model/provider/settings separately from Config defaults, checks current cwd/home alignment with the source Config, and revalidates native ownership, source bindings and consumed runtime settings before/after filesystem reads. Nothing is published. The two explicitly app-server-owned network/auth route fields retain the actual source values; unknown effective-value edits refuse source parity. Native Config equality does not inspect opaque validator/normalizer closures or mutable host-policy revisions, and provider/MDM/auth readiness is not refreshed here. These remain authority-assembly requirements. `nativeDestinationConfigValueConstruction` records this completed data-construction component; `completeDestinationConstruction` and `completeDestinationAuthority` remain false for the full executable destination.

Native enforcement lineage is now bound separately from value parity. A native Rust-only opaque witness retains actual validator/normalizer Arcs and compares identity/type without sampling callbacks or cloning policy values. The completed constructor records its installed approval, permission-snapshot, residency, MCP and web-search enforcers. Replaced/missing bindings refuse retained invocation reads and source preparation; detached destination revalidation also checks its own constructor record. Owner-bound runtime revalidation detects same-value approval/profile enforcer replacement. Four semantic regressions failed before the fix and pass afterward, alongside healthy clone/no-callback controls. Ordinary Config/Constrained value equality and ordinary validation behavior are unchanged.

These witnesses prove allocation lineage, not captured callback-state freshness, current authorization or mutable host-policy revisions. A specific test changes state captured by the same callback and verifies that identity still matches while ordinary validation refuses. Complete permission/provider/model/MCP/tool authority and exact receiver/release remain open; no publication or movement capability is enabled.

Applied application-policy preparation now retains a native owner/view-bound epoch. Effective publication, unavailability and invalidation advance it independently of account/load revisions, including A → B → A. Capture/revalidation are nonblocking and refuse unavailable, busy, poisoned, stale-account or exhausted state. Config preparation checks both views before and after asynchronous filesystem reads; a real filesystem-boundary regression verifies late changes cannot retag old preparation. This observes applied policy only; external requirements, arbitrary callback captures and full execution authority remain unfinished.

Native catalog observations now include retained change identities, synchronized with actual catalog publication and shared API-key-discovery updates. Actual A → B → A cannot reuse an old identity. Originator managers share discovery and its witness. Capture uses nonblocking observation locks, holds the discovery lock only while sampling, and rechecks after metadata construction. Busy/poisoned state refuses; ordinary updates continue under recovered poison. Exact no-op and rejected foreign catalog publication preserve the observation. Core's concrete provider/originator test verifies discovery ABA invalidates old preparation, permits a fresh observation with equal metadata and adds no requests. This remains applied metadata, not auth/account freshness or executable destination authority.

Applied auth-cache observations now bind actual native cache/source ownership and change identities. Static/OpenAI model metadata separately observes manager and endpoint auth owners before/after preparation. Observation uses nonblocking cache/external/shared-JSON locks, refuses permanent failure and pending/exhausted change state, and creates no source callback, keyring/storage access, login/refresh or request. Shared ChatGPT identity metadata has its own native change witness, and identity helpers receive detached frozen JSON. Ordinary install/clear, reload/account reload, refresh, identity bootstrap, logout/revoke and forced-workspace changes retain refusal across awaits and invalidate old observations on completion/cancellation. Existing native account watch revisions and enforcement outcomes are preserved.

Two prior Core regressions failed on credential ABA and equal-credential replacement sources. Five Core cases now cover both native model-manager classes, distinct manager/endpoint owners and pending/cancelled installation/reload. Ten native auth cases cover owner/ABA, no-op/absent cache, failures, nonblocking busy/poisoned state, nested scopes/exhaustion, workspace ABA, redaction and the explicit limitation that unpublished state within the same callback cannot be observed without invoking it. Ordinary reload applies that state and invalidates the cache witness. Existing real identity-persistence and account-owner tests also verify observations. Applied cached state is not full external callback/policy/provider/tool authority or execution readiness.

Reservation-bound destination data assembly now shares one native candidate across full detached Config, actual retained current model/auth metadata and bound instructions. Instruction reads use the destination's native Config; Config defaults do not replace actual step settings/provider/model/context-window choices. Validation brackets instruction I/O with configuration/runtime/owner checks, checks model/auth repeatedly, then checks the native instruction source after the last async Config check. Native instruction refresh has owner/change identity and checked pending state across semaphore waits, completion and cancellation; equal text cannot retag old preparation. Observations retain no writer lock and do not publish settings, caches or journal placement.

The composed native API returns both a boxed future and an owned boxed result. A real default-stack overflow reproduced with one case; fixture/future boxing alone was insufficient, and boxing the large result at the boundary fixed caller poll/result-move growth. The five unchanged assembly cases and three instruction-source cases pass without a stack override. Restored document bytes remain data observations; filesystem exclusion and complete execution authority are separate requirements. Tool preview still observes applied source scopes. Actual destination provider/MCP/tool/resource establishment must remain an explicit approved native effect, and this data object is not a grant or executable destination.

Selected-provider preparation now binds the actual native provider, exact selected ID, destination definition and original factory auth input before command-auth replacement. Closed inspection supports configured, GCP and Bedrock providers without invoking credential callbacks. Resource declarations identify command/gateway/AWS and environment-name inputs; they do not resolve credentials or establish destination resources. Native project configuration protections remain enforced, and GCP destination auth cwd follows the native constructor.

The preceding selected-provider definition checkpoint covers **2,915 Core, 429 executor, 219 login, 127 model-provider and 63 models-manager cases**, plus companion roots: **4,026 unique library cases**. Separate configuration **398** and HTTP-client **125** bring these scopes to **4,549**. Nineteen affected cases pass without a stack override; app-server compilation and six registry cases pass. The original parallel executor run had two deadline failures and is retained separately. The same frozen executor executable passed all 429 cases with `--test-threads=1`; no deadlines or assertions changed. The other fifteen selected roots passed 682 unique cases on the same frozen feature graph. Fifty-five normal-library staging warnings remain unsuppressed. Linux filename/platform acceptance retains its prior unrun status; movement remains disabled.

The earlier provider-primitive increment adds a separate explicit native provider construction primitive. It consumes a validated plan and uses the ordinary native factory with the original account input, retaining the actual destination provider and its cached-auth observation. Construction rechecks source/destination bindings and refuses known deferred gateway setup errors. Removing command auth restores the original account input; adding command auth creates the proper native wrapper. Configured, GCP and Bedrock construction are covered. Native process-shared caches retain their ordinary lifetime; wrapper drop does not certify global rollback. Ordinary factory environment inspection is an effect, not an environment-value binding.

Latest changed-scope verification: **131 model-provider library tests**, **four construction tests without a stack override**, and **app-server compilation** passed. The complete seventeen-root suite was not rerun for this three-file provider-only change; its earlier results above retain their original scope. Initial invalid auth/gateway fixture results are preserved in the ledger. This primitive is not wired to broker approval or live session installation. `completeDestinationConstruction`, `completeDestinationAuthority` and movement remain false.

The private-channel checkpoint adds an optional private inherited Unix control descriptor, bound inside the actual initialized stdio session. Only `acquire` and `bindGrant` are exposed. The trusted host checks fresh broker state; native code binds its assertion to the actual owner/reservation, current source and retained source/destination directory handles, then durably journals the exact record. JSON owner fields cannot choose that identity. Exact retries revalidate the existing binding; changed records/directories refuse. A bound record cannot enter the legacy cwd-only commit or release path. Descriptor EOF and broker disconnect/membership loss close the owner and retain uncertainty. The original descriptor remains caller-owned and alias census is incomplete.

Private-channel checkpoint verification: **2,919 Core library cases**, **four affected Core cases without a stack override**, **three private-control app-server unit cases**, app-server/CLI checks and the standalone app-server build passed. **53 changed-scope JavaScript cases** and syntax checks passed. An isolated staged-process component test exercised a real stdio/private descriptor pair, local synthetic inference, fresh enrolled-receiver broker authorization, native journal binding and disconnect/restart quarantine. The broker capability/digest preconditions in that test are explicitly synthetic: it proves the owner/channel component, not complete effective authority, movement or master acceptance. The complete selected-root and parent suites were not rerun for this checkpoint; their older counts retain their original scope.

The descriptor defaults absent. The production proxy does not enable this host port. No movement, provider/MCP startup, commit or release operation is exposed through it. A scoped establishment approval must remain distinct from final movement authority; a bound broker record does not make destination resources ready.

```sh
git apply /absolute/path/to/agent-channel/native/codex/instruction-preview.patch
cd codex-rs
RUST_MIN_STACK=8388608 cargo test --locked --lib \
  -p codex-core -p codex-login -p codex-native-tool-preparation -p codex-git-utils -p codex-home \
  -p codex-models-manager -p codex-model-provider -p codex-skills-extension \
  -p codex-web-search-extension -p codex-image-generation-extension \
  -p codex-memories-extension -p codex-history-notes-extension -p codex-goal-extension \
  -p codex-multi-env-copy-file -p codex-exec-server -p codex-file-system -p codex-agent-roles
RUST_MIN_STACK=8388608 cargo test --locked -p codex-model-provider --lib
env -u RUST_MIN_STACK cargo test --locked -p codex-model-provider --lib native_provider_construction
RUST_MIN_STACK=8388608 cargo test --locked -p codex-config --lib
RUST_MIN_STACK=8388608 cargo test --locked -p codex-http-client --lib
cargo check --locked -p codex-app-server
cargo test --locked -p codex-extension-api --test registry
RUST_MIN_STACK=8388608 cargo test --locked -p codex-exec-server --lib bounded_directory
```

The affected default-stack checks run on the Core test executable produced by that selected-root build, with `RUST_MIN_STACK` unset: filters `continuity_destination_assembly` (seven), `native_instruction_binding` (three) and `native_selected_provider_gcp` (one). The model-provider executable additionally passes `native_selected_provider` (eight) without a stack override. For the accepted executor verification, run the selected-root executable with `RUST_MIN_STACK=8388608` and `--test-threads=1`; the parallel command above alone is not the accepted executor result. They do not require rebuilding a different feature graph.


The staged Unix native-runtime integration test has been retired with the automatic-transfer experiment. The following notes are historical; they do not enable automatic transfer.

Provider-only preparation checkpoint (2026-10-28): native Core now separates
reservation-bound Config/provider planning from model-catalog and instruction
readiness. The composed destination path reuses this boxed preparation and still
checks its model and instructions. Provider-only preparation does not invoke the
factory, resolve credentials, publish settings, or authorize construction. It
retains the actual native inputs and rejects configuration/runtime/provider drift,
foreign or closed owners, and stale reservations. Instruction changes alone do
not invalidate this narrower effect scope.

Verification: **2,920 Core library cases**, including the new scope test, and
**seven affected destination-assembly cases without a stack override**, passed.
The exported increment was reconstructed and reverse-checked. The previous staged
app-server binary was not rebuilt and represents the preceding private-channel
checkpoint. Its process acceptance and both entrypoint checks retain that scope.
Approved factory invocation, retained resource ownership/cleanup, complete authority,
commit and receiver handoff remain unfinished; movement remains disabled.


Scoped approved provider-factory checkpoint (2026-10-28): the private Unix channel
now supports `planProvider` and `constructProvider`. Core retains the native Config,
provider preparation and directory identities behind an opaque plan disclosure.
The trusted host obtains fresh broker authorization for the exact scoped grant;
Core checks the actual owner/reservation and retained plan/digest. It persists
`provider_pending` before the ordinary factory, retains the real provider and Config
before another await, then persists `provider_constructed` and a scoped receipt.
Duplicate effects refuse. Neither legacy commit nor release can discard ownership.
There is no provider installation, cleanup/disposal or receiver-handoff operation.

Real-process acceptance exposed two normal startup inputs absent from earlier
fixtures: native token-budget startup activation and app-server executable paths.
Both are now bound at their actual producers. Source reconstruction still rejects
missing/tampered bindings, different configured preferences and unrelated edits;
preparation neither fetches models nor replays startup to invent those inputs.
Safe debug diagnostics contain static stage labels. Temporary field comparisons
were removed before the accepted build.

Current verification: **2,926 Core tests**, **five provenance/enforcer cases plus
three factory cases on the default stack**, **four private-channel app-server
cases**, both entrypoint checks, and **545 JavaScript tests with 16 opt-in/platform
skips** passed. Both staged-process cases passed; the provider case uses a genuine
native plan, actual operator approval and the real native factory, then verifies
retained broker/native holds and disconnect/restart quarantine. Its capability
advertisement is a component-test fixture, not complete authority or production
adapter acceptance. The other process case retains synthetic movement-authority
inputs and does not prove movement. The complete seventeen-root suite was not rerun.

The accepted standalone app-server is 727,240,656 bytes, SHA-256
`47b53f5c28b5c8cff78730c0a417a9c9153aafebbe47dbb3d218071223f96cea`.
The exported increment is 671,648 bytes, SHA-256
`18bbc69ec105374c17a14536d3438c5dd6d455165bba79510d649faac9e3e735`;
strict forward reconstruction, reverse application and whitespace checks pass.
Installed runtimes and production control/movement remain unchanged and disabled.
Full resource/permission authority, census/cleanup, native commit/receiver handoff,
OpenCode parity and task/master/platform acceptance remain open.


Unpublished owner cleanup checkpoint (2026-10-28): `cleanupProvider` drops only an
unused factory owner and its retained native Config. Public provider access marks
it exposed permanently; strong or weak aliases also prevent release. Native cleanup
journals intent before destruction, preserves ownership on refusal, verifies the
source directory and journals completion before admission release. Broker schema
19 requires the exact original resource and native owner-release receipt. Cleanup
can abort cancelled setup but cannot revive it, authorize movement, or qualify a
provider preview as worktree approval. Closed-owner recovery and published/context
cleanup remain unsupported; these outcomes retain quarantine.

Current verification: **2,928 Core**, **134 model-provider**, **553 parent tests
with 17 skips**, **five private-channel cases**, both production checks and
**three staged process cases** passed. Two Core and three model-owner cleanup
cases pass without a stack override. The cleanup process case verifies real
object disposal, broker hold before receipt acknowledgement, and another ordinary
turn in the same source conversation. The other two cases retain their original
construction/quarantine scope. Complete authority/census and migration acceptance
remain open. The 688,318-byte increment has SHA-256
`94b04d84ff25f560dd603ee47764273300a3b824251933d3fc7979dcbbe42fc3`;
the 727,382,640-byte staged app-server has SHA-256
`3f81b3ba60eb72a43300c218a39ac25b46cacde4715d831692642399687e7c25`.
No installed runtime or production movement/control flag changed.


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
