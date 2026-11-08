# OpenCode destination observation experiment

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


The opt-in `destinationFixture` field in the private source-host configuration
starts a synthetic destination observer before the source owner. It contains
absolute paths named `directory`, `nativeBundle`, and `runner`; the caller must
prepare the native bundle and the synthetic fixture project beforehand. The
source plugin's private options must also contain `destinationFd: 6`.

The source supervisor owns the observer process and passes a dedicated inherited
descriptor to the source owner. The owner can inspect the held source and
destination reservations with `observePair` and submit a matching
`recordPreview`. An operator must explicitly approve the pair's digest. A lost
process, failed observation, or supervisor cancellation closes the capability;
the owner releases its source hold. An already recorded preview remains a
historical record and cannot by itself restore a lost reservation.

Once both observational owners are retained, the source and destination are
linked: loss or release of either closes both capabilities. An in-flight
destination check fails when the link is revoked. This link does not attest the
destination VM, establish exclusive daemon custody, or authorize execution.
The local `TURNLINK_TEST_BROKER_DESTINATION_REVOKE=1` integration uses the
real broker and OpenCode plugin capability bridge: revoking the adapter closes
the source port and aborts a pending destination-supervisor check. Its source
reservation and destination process are test doubles, so it does not prove a
real native hold or VM teardown.
The separate opt-in `TURNLINK_TEST_REAL_BROKER_DESTINATION_REVOKE=1` mode uses
the actual broker, a sealed plugin, a native source idle reservation and a
confined native destination process with existing pinned local images. Adapter
revocation closes both retained owners; the test verifies removal of its two
temporary containers. The link is wired by the test and both containers use a
shared daemon, so this is not a production CLI or exclusive-VM proof.
The opt-in CLI test can reuse an existing destination bundle via
`TURNLINK_TEST_EXISTING_DESTINATION_BUNDLE`. In its
`TURNLINK_TEST_CLI_BROKER_REVOKE=1` mode, the CLI-owned source and destination
produce an observational pair and approved preview; broker adapter revocation
closes the source hold and the destination fixture container is observed gone.
The test uses a shared daemon and does not authorize movement. One earlier
preview recording returned HTTP 500 without a classified cause; subsequent
runs succeeded, so this result does not resolve that intermittent failure.

This is an experiment, not destination attestation: it uses a shared Docker
daemon and a runner supplied in the private fixture configuration. Its observer
refuses external plugins and MCP servers. An optional host-injected shim can
mediate the separately sealed Turnlink plugin without enabling the external
loader; other plugin and MCP executable graphs remain unmeasured. Pair
comparison is `unverified` and `executionEligible` is false.
The owner refuses a broker grant bearing this pair until a live verifier is
proved. The record never authorizes native prepare, task release, or migration.

`observeComponents` compares hash-only snapshots of the observed agent, model,
permissions, hooks, tools, and instructions while both holds remain live. Its
statuses describe identical or different serialized observations, not semantic
equivalence: most paths and other location-dependent inputs are not normalized.
One separate candidate compares ordered local instruction files after resolving
each real path beneath its selected project root and mapping it to a relative
path. External paths, unavailable paths and an empty file set have no candidate.
It does not account for generated, remote, or plugin-provided instructions.
The model fingerprint does not cover the complete provider or model runtime.
MCP and complete plugin provenance are explicitly unattested. Missing component
fingerprints remain unavailable, and none of these statuses permits execution.

The hosted shim exposes a session-scoped context channel. Prompt admission and
movement are disabled. The supervisor records storage intent durably before a
write; a lost response or supervisor crash is uncertain and must not be
replayed. Even a confirmed write fences later writes because an acknowledgement
from the sealed child has not yet been implemented. This conservative limit is
not a complete storage recovery protocol.

The source/destination integration fixture for this experiment was retired with
automatic transfer. Its historical results did not authorize a transition or
establish VM takeover.
