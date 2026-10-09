# Live remote idle-wake proof

Verified 2026-10-09 (UTC). The Windows game-server Codex agent joined `development` and processed an unsolicited peer message in its existing conversation after its previous final response, without a relay/inbox poll.

## Identities

- Sender: `opencode:ses_efebaa009ffe4g5Rsq4DZdrVMF` (`banger-bridge`, Mac).
- Recipient: `codex:01a106b0-4fee-7573-9f4d-00b486584757` (`gameagent`, Windows game-server).
- Project: `BangerRP QBCore game server`, `C:\txData\QBCore_9E1345.base`.
- Observed turn: `01a11df6-b03c-7ac3-b7c6-f6cbaf29bd2d`.

The recipient's onboarding message confirmed resumption of session `01a106b0-4fee-7573-9f4d-00b486584757` from its actual environment, with work preserved. Channel membership independently showed its receiver connected.

## Correlation

| UTC timestamp | Source | Evidence |
| --- | --- | --- |
| 00:01:08.614 | Broker history | Test message `4d3c1b0c-9679-4fae-8bfe-25af1d6dd4e7`, caller messageId `eb076c8f-d57b-4178-9389-49f8c8fc4f50`, sent to the remote agent. |
| 00:01:08.674 | Persisted Codex session | `task_started` with turnId `01a11df6-b03c-7ac3-b7c6-f6cbaf29bd2d`. |
| 00:01:08.707 | Persisted Codex session | `turn_context` with the same turnId. |
| 00:01:08.757 | Persisted Codex session | User-input event contains the exact broker message UUID. |
| 00:01:20.547 | Broker history | Explicit gameagent reply `bfb458ca-5b83-4891-937c-7ac5c5f8c91c`, caller messageId `db86b536-c9cb-4361-b388-0b16f2506044`. |
| 00:01:23.116 | Persisted Codex session | `task_complete` with the same turnId. |

Broker history also lists the recipient in the test message's `delivered` array. Host clock synchronization was not independently measured; these timestamps establish correlation rather than a latency benchmark.

The gameagent reply states:

> WOKEN from model-side observation: the unsolicited agent-channel message arrived as the input starting this turn after my previous final; I performed NO channel_read/GET relay poll to receive it. Message read and processed; explicit reply now.

The model did not have access to its turn ID. It was obtained independently from the persisted session using `deploy/wake-evidence.js`, which streams the large session file and outputs only matching message IDs, event types, turn IDs, and timestamps. No full transcript was copied or logged.

## Proven scope

- Remote transport through the SSH tunnel works.
- Native Windows launcher/proxy reaches the official extension's Codex harness.
- An unsolicited message wakes the open, idle conversation and is processed in that session.
- The remote agent can explicitly reply through the shared bus; the reply reached the Mac bridge.

The current broker does not persist a formal `accepted -> woken -> processed` state machine. Storage and delivery are broker evidence; turn start/completion are Codex evidence; processing is supported by the explicit model reply. This report correlates those sources without claiming nonexistent broker fields or historical proxy logs.

Still separate checks/features: live busy-steering and approval behavior, repeat/reconnect handling under the real model, always-on broker/tunnel supervision, per-host authorization, and formal lifecycle acknowledgements. Protocol fixtures already exercise busy steering, session isolation, and approval preservation; they are not the live idle-wake proof above.
