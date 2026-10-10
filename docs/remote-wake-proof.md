# Live remote idle-wake proof

## Original v0.1 Codex proof

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

## V2 fleet cutover and OpenCode idle wake

Verified 2026-10-09 (UTC), after the runtime repair and adapter reloads. Native v2 membership showed all three original identities connected with claimed names:

| Name | Agent ID | Enrolled host |
| --- | --- | --- |
| channel-builder | `opencode:ses_ee253d5d1ffeAl2nyMw3qIQ7Sm` | workstation |
| banger-bridge | `opencode:ses_efebaa009ffe4g5Rsq4DZdrVMF` | workstation |
| gameagent | `codex:01a106b0-4fee-7573-9f4d-00b486584757` | gameserver |

The v2 workstation broker is loopback `47323`; the game-server uses forwarded loopback `47324`. Membership and replies below came from v2, not the retained legacy broker.

### OpenCode correlation

Sender: channel-builder. Recipient: banger-bridge in its original session. Nonce: `bridge-idle-v2-20261009T235831Z`.

| UTC timestamp | Source | Evidence |
| --- | --- | --- |
| 23:58:11.184 | Read-only OpenCode message metadata | Prior assistant message `msg_1231a4b80001B4fEKOqAGfJv3R` completed with `finish=stop`. |
| 23:58:36.583 | V2 broker send result | Nonce request `24f9da6c-201c-428f-a7ca-a86c1d802239` sent directly to the original bridge session. |
| 23:58:36.659 | Read-only OpenCode message metadata | New user input `msg_1231aba720010hb3P94RsLHKV3`; its text part independently matches the exact broker message UUID. |
| 23:58:38.228 | Read-only OpenCode message metadata | Assistant `msg_1231ac093001zJ0P0acR6VJ1I6` began with that input as its parent. |
| 23:58:42.367 | V2 broker reply | ACK `5c5ca766-00f0-4216-9f51-aea611030869` contains the exact nonce and reports unsolicited new-turn delivery after the prior final. |
| 23:58:48.328 | Read-only OpenCode message metadata | Final assistant message `msg_1231adbe3001SL4AOtAPUM7oTa` completed with `finish=stop`. |

The only tool part in the nonce response was a completed `channel_send`; there was no history poll. Evidence was queried read-only from OpenCode's local database, selecting message IDs, timestamps, roles, parent IDs, completion status, matching-message presence and tool names rather than dumping transcript bodies. This verifies an actual v2 OpenCode idle wake in the preserved conversation.

### Codex v2 scope and remaining checkpoint

V2 message `9c5837e4-412a-4149-a62d-71bda0b056d7` was sent at 23:52:09.817, appears in the original persisted Codex session at 23:52:10.482, and received matching ACK `c866c5bb-3822-495b-930a-4bac9d902850` at 23:52:17.371. The agent explicitly reported automatic delivery during an already-active goal turn, without polling. This proves v2 delivery/processing in the existing session, not idle turn-start.

After `READY_IDLE`, independent Codex lifecycle evidence showed automatic goal continuations: `task_complete` at 23:58:04.964 followed by `task_started` at 23:58:04.982, then another completion/start pair at 23:58:17.898/23:58:17.922. The new turns were therefore not a clean nonce-triggered idle test. The agent reports that its supported goal pause requires an explicit user request; peer coordination cannot authorize it. Preserve the checkpoint and obtain that request before the final Codex v2 idle-wake check. No goal was cancelled/reset and no game, desktop or service lifecycle action formed part of these tests.
