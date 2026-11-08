# Checkpoint policy codec: remaining native boundary

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


The implemented checkpoint grant contains a separately approved
`checkpointConfigSha256`. It identifies the exact `config.toml` bytes copied
into the new home. It is not a hash of the effective native policy. The
broker authorizes only `checkpoint-inspect` or recovery observation for this
grant and rejects ordinary movement authorization and `moved` settlement.
The importer returns `published_unverified`; the imported native thread is
still quarantined.

A future native policy codec needs two native observations: one of the proposed
destination before a second operator decision, and one of the actually loaded
guest before any receiver or execution release. The approval must bind the
codec version, both endpoint identities, the exact checkpoint and transition,
and the complete canonical projection digest. The broker must keep this
decision separate from approval of `config.toml` bytes. Observation, approval,
and revalidation must be tied to the same live grant and invalidated on
revocation or owner loss.

`ThreadSettingsSnapshot` alone is insufficient. A supported codec must account
for the resolved configuration and requirements layers, native invocation
overrides and environment, actual model and selected provider definition,
authentication and network routing, effective permission and approval
enforcers, project/instruction inputs, environment selection, hooks, plugins,
dynamic tools and MCP owners. Inputs containing secrets must either be
represented without transferring the secrets or rejected. Unknown keys,
unrecognized providers, mutable external policy, unsupported callbacks,
incomplete file discovery, and state that cannot be revalidated must refuse
the codec rather than be dropped. The native version and executable/build
identity are part of the interpretation; equal TOML bytes alone do not prove
equal constructors, defaults or managed requirements.

The current implementation retains native enforcer and provider observations
as process-local `Arc` identities inside `ContinuityDestinationPreparation`.
`ConfigLayerStack` also retains runtime cloud/config-server bindings and MCP
cancellation state. Those pointers and lifetimes cannot be serialized as
cross-process identity. They need a defined guest-side reconstruction and
freshness protocol, or must be excluded from the supported class. The guest
fixture also lacks a verified bubblewrap installation. Therefore no complete
projection or second policy approval is implemented yet; `config/read`, a
redacted `Debug` string, or a user-supplied digest must not stand in for it.

The debug-only private `inspectCheckpointJournal` path reads the imported
journal without constructing a session. It validates the exact reservation and
grant, reports only `quarantined_unverified`, and never permits release. Its
host wrapper rechecks broker authorization after the native reply and discards
that reply if revocation intervenes. This is an observation of the journal,
not an observation of effective policy, and the same-UID fixture is not an OS
trust boundary. The native public `thread/resume` now rejects a checkpoint-bound
quarantine before constructing a session, including after resolving a supplied
rollout path. An imported fixture remained unloaded with its journal unchanged
and no fixture-provider request; an ordinary resume without a journal succeeded.
The macOS integration test also changes the imported model, restarts the
existing app-server, confirms that the changed model is resolved, and verifies
that reconciliation and public resume still fail without contacting the
fixture provider or running its MCP sentinel. This exercises the quarantine
under configuration drift; it does not attest the destination policy.
An experimental private candidate path now verifies the imported rollout and
journal bytes against the checkpoint digest, builds a restricted anonymous
candidate without a Session, and retains it under the private owner for at
most 30 seconds. Its revalidation rereads the files and compares the retained
native model and policy components against a freshly reconstructed baseline.
The experimental comparison enumerates the `Config` shape so new fields need
review, and separately checks invocation, enforcer recipes and network/auth
route restrictions; `Config::PartialEq` alone has known opaque exceptions.
The new Rust path has not yet been built or
tested, and the existing runtime does not contain it. It is an unverified
observation: digest comparison does not authenticate its caller, protect the
files against same-UID writers, or represent the complete effective policy.
`TURNLINK_TEST_NATIVE_CHECKPOINT_CANDIDATE=1` adds a negative integration case
for unsupported MCP and credential inputs after a compatible runtime is built.
This point-in-time file observation does not exclude hostile same-UID writers.

The experimental source also retains a bounded, owner-bound copy of the
checkpoint bytes and compares subsequent reads with that copy. At most four
copies can be retained per native process; each rollout is bounded to 4 MiB
and each journal to 64 KiB. An experimental pin holds the local store's writer
mutex, and expires after 30 seconds or owner closure. A private watch closes
the native channel when the snapshot is invalidated. It cannot exclude another
store instance or a direct same-UID file writer. The host re-reads both files
with the expected digest and checks broker authorization before and after that
read. The local-writer, owner-close and environment invalidation tests passed;
isolated native/broker tests also refused a changed rollout and adapter
revocation.

An opt-in in-process verifier can record the observed digest in a separate,
bounded broker table while retaining its local lease through the SQLite
transaction. A replay or a record read after restart is historical only, and
does not revive the lease. A separate destination intent is committed before
the fixture sends the snapshot to the VM; a lost reply leaves it uncertain and
cannot trigger an automatic retry. The broker's schema-34 export includes the
source observation and destination intent/receipt.
The fixture verifier and broker share an operating-system identity. Notification
and database commit in different processes are not atomic, and direct writers
are not excluded: the stored record is therefore `observed_unverified`, never a
policy approval or authority to execute an import or release a receiver.

An isolated end-to-end fixture delivered an actual native source checkpoint
over an authenticated vsock relay to a disposable VM. The guest importer
published only a quarantined home and returned a receipt bound to its fixture
instance and checkpoint digest. The broker retained the receipt as historical
evidence after restart. A separate run simulated losing the receipt after guest
import; the intent remained uncertain and replay did not dispatch again. These
VM images, instance identifiers and keys are test fixtures: they do not prove
production guest identity, OS isolation, effective policy parity or a safe
receiver handoff.

The checkpoint and VM integration checks are archived on the experimental branch.

The former staged native-runtime integration fixture was retired along with the automatic-transfer experiment. The observations above are historical and do not enable automatic transfer.

Acceptance needs a real imported guest session under the protected
supervisor. Test matching native policy; changed managed requirements; changed
provider definition, enforcer, environment, tool or instruction state;
unknown components; approval mismatch and revocation; and crashes before and
after publication. Every refusal must retain quarantine, source fencing and
the held receiver. A successful projection alone still cannot prove complete
remote activity or authorize release.
