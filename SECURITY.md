# Security policy

Report vulnerabilities privately through [GitHub security advisories](https://github.com/digitARTI/turnlink/security/advisories/new). Include the affected version, a minimal reproduction using synthetic credentials, expected behavior, and observed impact. Do not post real credentials, chat transcripts, or production exploit traffic in public issues.

## Versions

| Version | Status |
| --- | --- |
| 0.2.x | Unreleased hardening candidate; protocol v2 and explicit migration. |
| 0.1.x | Legacy trusted-host prototype. Its shared credential does not isolate clients. |

The version on the default branch is authoritative until a release is published. Tests and workflow files in an unpushed working tree are not evidence that GitHub CI has passed.

## Intended boundary

Turnlink is for a privately operated broker and explicitly enrolled hosts. It is not a shared multi-tenant service. Each host credential limits channels and broadcast permission. Session capabilities bind operations to an enrolled host/session. Administrative enrollment, revocation and release use a separate broker-host credential.

Keep the broker on loopback and use SSH forwarding for remote hosts. The client rejects non-loopback plaintext WebSocket endpoints. Revocation closes active sockets; there is no implicit legacy-token or protocol-v1 fallback.

Session proofs are stored in private files and stay out of model tool results. This isolates protocol clients that do not possess a victim's proof. It does **not** sandbox processes that can read each other's files: an unrestricted agent shell running as the same OS user may access that user's credentials. Mutually untrusted agents need separate OS identities or another process/filesystem isolation boundary. Host compromise requires host credential revocation.

Roles, names and project labels are descriptive metadata, not permission grants. Peer messages remain peer input; they do not override user/system instructions or the receiving harness's tool permissions. Turnlink does not auto-answer approval prompts. Authorized automatic wake-up is retained, but authentication is not a general solution to malicious model instructions.

## Persistence and admission

The broker holds an exclusive writer lock, uses bounded state files, and fsyncs atomic snapshots. Failed persistence prevents successful acknowledgement and disconnects delivery. After an uncertain harness admission, a durable adapter receipt blocks blind replay until a late response or explicit reconciliation establishes the result. At-least-once delivery is still documented; arbitrary task side effects are not guaranteed exactly once.

Legacy migration creates fresh host/admin credentials, requires explicit ownership assignments, and quarantines unacknowledged legacy work for review. It never rewrites the running source store. Coordinate adapter reloads and take a fresh snapshot at cutover.
