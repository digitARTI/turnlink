# External hosts: BangerRP development-channel proposal

Status: user-approved development deployment installed; live remote idle-wake proof passed. See `remote-wake-proof.md` for exact session, turn and message evidence.

## Inputs

Local source: `BangerRP-migration/docs/fivem-mcp.md`, section 5. The legacy relay is a JSONL store on REBORN, exposed on loopback HTTP port 8902 through SSH reverse forwarding to the game-server. It supports POST, cursor-based GET, and MCP `channel_post` / `channel_read`. Storage acceptance does not wake an idle model.

Peer evidence from `banger-bridge` in the development channel:

- Report `b85cd0d6-640f-4fad-8c3d-72d8eb7b1bfc`: remote agent runs in the official Codex VS Code extension on Windows; live Codex process is native Windows, not an observed WSL process.
- Report `aac0317c-8b2f-478d-9cea-5cbc6e1c533e`: active extension 26.930.61225, with 26.1002.51308 also installed; bundled binary reports Codex 0.162.0-alpha.2. Both manifests expose `chatgpt.cliExecutable`, application scope, restricted, string/null. Launcher uses direct stdio pipes, not an ordinary shell invocation.

These are peer-reported read-only observations, not a live wake-up proof. The launch override makes integration plausible; it does not establish conversation resumption, one process per conversation, or UI synchronization. The current proxy supports multiple thread identities in one app-server process.

## Development topology

```text
Mac: broker ws://127.0.0.1:47321
    |
    | separate SSH reverse forward, Mac initiates through bangerrp-fx
    v
game-server: ws://127.0.0.1:47322
    |
    v
Windows native launcher -> Node stdio proxy -> bundled codex.exe
    ^                                         |
    | official VS Code extension              | existing thread/turn APIs
    +-----------------------------------------+
```

Proposed tunnel command (not run):

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:47322:127.0.0.1:47321 bangerrp-fx
```

Provision channel credentials out of band, independently of legacy telemetry credentials. Do not use token query parameters. The current broker uses one shared trust token; per-host authorization is a prerequisite for treating external hosts as distinct trust domains.

Mac sleep/disconnection makes this topology unavailable until connectivity returns. An always-on deployment can use a standalone broker on game-server or REBORN. Keep it separate from the bridge's interactive desktop process and revise forwarding accordingly. Broker persistence cannot make a sleeping recipient execute a model turn.

## Windows launcher

`chatgpt.cliExecutable` replaces the executable path; it cannot contain a command plus arguments. A Unix-shebang JavaScript file is not a directly executable Windows binary. Prefer a small native `.exe` launcher that invokes Node with the proxy script and all original arguments.

Required launcher contract:

- Preserve argument boundaries and ordering, including paths with spaces.
- Pass app-server and non-app-server invocations through correctly.
- Keep stdout/stdin exclusively for Codex protocol; diagnostics go to stderr.
- Preserve exit status and stop the child processes on termination.
- Resolve Node, proxy, and real Codex paths from explicit local configuration.
- Prevent recursion if the configured real executable points back at the launcher.
- Retain the bundled binary and extension files unchanged.

Set the override at user/application scope. If the effective configuration switches to WSL, use a Linux adapter inside WSL instead of this Windows launcher. Reconfirm effective mode at installation.

## Protocol evolution

Proposed fields, not implemented yet:

- Host identity and adapter capabilities: `idleWake`, `activeSteer`, `modelReceipt`, supported harness/API versions.
- Per-host credentials bound to permitted agent identities and channel membership.
- Explicit lifecycle stages: stored/accepted, harness-admitted, turn-started (where observable), model-processed, task-result.
- Correlate acknowledgements to message ID, session ID, and turn ID where exposed.

The current store uses UUIDs and atomic JSON snapshots, not the legacy relay's monotonic JSONL IDs. Current Codex/OpenCode acknowledgements represent API acceptance, not processing/completion. Claude channel writes are unacknowledged by its harness; the model explicitly calls `channel_ack` after reading an event. Capability reporting must reflect those differences.

## Transitional legacy gateway

Keep agent-channel canonical. Translate legacy sender/recipient aliases to explicit channel agent IDs, preserving subject, status, reply references, and hashes. Map the legacy cursor ID to the new UUID/messageId. Persist mapping and cursors before acknowledging translation.

Gateway requirements:

- Mark source/origin and maintain a stable mapping to prevent re-importing mirrored messages.
- Suppress self-echoes and duplicate delivery on restart; restrict broadcast translation.
- Keep `reply_to` correlated through an explicit ID mapping.
- Preserve input-ownership request/grant/release messages for game and desktop operations.
- Keep relay GET as a compatibility mirror during transition.
- Never equate legacy HTTP 200 with model delivery or advertise a polling-only endpoint as wake-capable.

A gateway is optional for the direct wake-up proof. It cannot replace the game-server's harness adapter.

## Remaining acceptance gates

1. Gameagent confirms effective harness configuration and preferred onboarding path (legacy request 105 is pending).
2. Test the Windows launcher with a protocol fixture, including spaces in paths, args, exit status and child cleanup.
3. Initialize the real bundled app-server through the launcher without starting a model turn.
4. Record existing conversation thread ID; configure override and resume after a controlled extension restart; verify the ID is unchanged.
5. Register remote role/project/host and send a task after its agent has finished responding.
6. Observe a new turn in that exact thread without pressing Send; obtain a model receipt/result and verify local idle wake-up on reply.
7. Verify busy steering, multiple-thread isolation, pending approvals, SSH reconnect/replay, and extension UI synchronization.

Deployment update: Windows native Go launcher, isolated Node installation, protected credential file, direct SSH reverse forward, and Administrator VS Code/Codex settings were installed after the user's explicit "ok proceed". Real Windows stdio/SSH fixture tests and bundled app-server initialization passed. Subsequently gameagent resumed its existing conversation, joined the channel, and processed an unsolicited idle-wake message without polling. Persisted Codex turn events and broker request/reply history are correlated in `remote-wake-proof.md`. Further live busy/reconnect/approval checks and always-on deployment remain separate work.
