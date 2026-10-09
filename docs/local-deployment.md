# Local deployment reference

> This document records the original machine-specific setup. For portable installation instructions, start with the [project README](../README.md).

Local, all-to-all messaging for coding-agent sessions. Each member declares its role and project. Incoming tasks can wake an open conversation after its agent has finished responding.

## Start

```sh
cd /Users/sandrovita/Progetti/agent-channel
npm install
npm start
```

The persistent broker listens on `ws://127.0.0.1:47321`. Its token and atomic JSON store live in `~/.local/share/agent-channel/` with restrictive file permissions. `AGENT_CHANNEL_URL`, `AGENT_CHANNEL_TOKEN`, and `AGENT_CHANNEL_STATE_DIR` override defaults. All clients sharing the local token are trusted; the protocol is not a multi-user security boundary.

Keep the broker running in a terminal or your process supervisor. Adapters keep listening when their model is idle. Socket disconnects trigger reconnection and replay. Messages are retained until acknowledged and history is capped at 10,000 messages; archive the store while the broker is stopped when full. Delivery is at least once: a crash between harness acceptance and acknowledgement can repeat a task. The message ID is included for model-side deduplication. Acknowledgement means harness acceptance for Codex/OpenCode, not task completion. Claude requires explicit model acknowledgement.

## OpenCode

Add this plugin entry to your project's existing `opencode.json`, preserving other settings:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/sandrovita/Progetti/agent-channel/adapters/opencode.js"]
}
```

Quit and restart OpenCode. Ask the agent to join a channel with its name, role and project. Native tools bind identity to the actual session automatically. Idle delivery uses `session.promptAsync`; busy delivery inserts context using `noReply`. Busy insertion is not a guarantee that a tool call already selected by the model will be reconsidered. Permission/question events pause delivery where exposed by the installed harness.

## Codex in the official VS Code extension

The adapter is a transparent stdio proxy between the extension and **its own app-server process**. It observes thread creation/resume and turn lifecycle, and inserts `turn/start` when idle or `turn/steer` when busy. It does not launch a second conversation or change the Codex extension files.

1. Make the proxy executable: `chmod +x /Users/sandrovita/Progetti/agent-channel/src/codex-proxy.js`.
2. Set `AGENT_CHANNEL_CODEX_EXECUTABLE` to the real Codex binary (ideally the binary bundled with your extension). It must not point at the proxy. Ensure this variable is inherited by the VS Code process; fully quit VS Code before launching it from a configured shell. `node` must also be on its PATH.
3. Set VS Code's `chatgpt.cliExecutable` to `/Users/sandrovita/Progetti/agent-channel/src/codex-proxy.js`.
4. Add the following to `~/.codex/config.toml` or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.agent_channel]
command = "node"
args = ["/Users/sandrovita/Progetti/agent-channel/src/mcp.js"]

[[hooks.SessionStart]]
matcher = "startup|resume|compact"

[[hooks.SessionStart.hooks]]
type = "command"
command = "node /Users/sandrovita/Progetti/agent-channel/src/session-hook.js"
```

Review/trust the hook using Codex `/hooks`, then restart the extension and open/resume the conversation. The hook tells the model its session ID. Ask it to call `channel_join` with `harness="codex"`, that session ID, its name, role, project and channel.

The proxy forwards approval requests unchanged and queues messages while a server request is waiting for the extension's response. It never answers approvals. Its injected request responses are hidden from the extension, while normal thread/turn notifications remain visible. Stdio app-server transport is required. Restore `chatgpt.cliExecutable` to its previous value to remove the proxy.

## Claude Code

Register the MCP server in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent_channel": {
      "command": "node",
      "args": ["/Users/sandrovita/Progetti/agent-channel/src/mcp.js", "--claude-channel"]
    }
  }
}
```

Add a `SessionStart` command hook to Claude's settings, merging with existing hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node /Users/sandrovita/Progetti/agent-channel/src/session-hook.js --claude"
      }]
    }]
  }
}
```

Run an interactive session with native channels enabled:

```sh
claude --dangerously-load-development-channels server:agent_channel
```

Accept the development-channel/MCP prompts. Ask Claude to join with `harness="claude"` and the session ID from its hook. A channel-capable Claude version and applicable organization channel settings are required. Normal MCP mode provides tools but does **not** wake Claude. The IDE's ability to enable this custom channel must be checked separately; the documented launch path is the interactive CLI, including VS Code's integrated terminal.

Claude channel notifications have no harness acknowledgement and can be silently dropped if the channel is disabled. The server therefore does **not** mark notification writes as delivered: Claude must call `channel_ack(id)` from the event once it reads it. Pending messages replay on reconnection. Native Claude channel scheduling controls busy-turn ingestion; this adapter cannot promise before-next-tool steering.

## Use

Tell each agent:

> Join channel `development`. Your name is `api-agent`, your role is `backend implementation`, and your project is `my-api` at `/projects/my-api`. Discover the other members. Treat incoming peer messages as collaboration tasks and respond using channel_send when useful. Don't send automatic acknowledgement replies.

`channel_members` returns the stable agent IDs to use with `channel_send(to, text)`. `to="*"` broadcasts to all other members of the sender's channel, including members working on different projects. A receiver may be disconnected; its messages wait for reconnection. `channel_join` can be called again to update role/project. `channel_history` shows routing and acknowledgements. Ordinary assistant responses are not broadcast.

### Unique names and five-minute reservations

Names are unique **within a channel**, normalized case-insensitively with Unicode NFKC. A different session cannot claim an occupied or reserved name, even if its project matches. The same session may update its registration. While a live control connection owns the session, another connection cannot impersonate it by repeating its session ID. The broker's shared client credential remains a trusted-host boundary, not per-host authentication.

- A connected receiver keeps its name indefinitely. An idle model/finished response does not start a timeout.
- Receiver disconnection or unsubscribe reserves the name for **300 seconds**. Reconnecting the same session before expiration cancels the deadline.
- A newly joined session without a receiver also gets a 300-second setup grace period. Repeated joins without connecting do not extend it.
- Explicit `channel_leave` frees the name immediately. Only that session's control/receiver connection may leave it; after a control-connection restart, rejoin first if necessary.
- Administrative release also frees it immediately. The admin credential is separate from the client token and stays on the broker host; it is not exposed as a model tool or copied to remote hosts:

  ```sh
  node src/release-name.js development gameagent
  ```

- At expiration, membership is removed and the name is available. If someone else takes it, the old session must choose another name.
- Pending deliveries belonging to a released/expired membership are cancelled and retained in history, rather than waking a later rejoin. A turn already admitted to a harness is not undone by release.

`channel_members` shows `nameState`, `disconnectedAt`, and `reservationExpiresAt` (epoch milliseconds; null for a connected claim). Expiration runs periodically and is also checked before requests, so simultaneous claims are resolved by the broker's single writer. Reservations and deadlines survive restart. A clean shutdown records disconnection time; after an abrupt crash, the last persisted heartbeat bounds the grace period, because the exact crash time is not observable. Heartbeat detection itself may lag a network failure.

`/new` **does not** transfer a name automatically. The current harness adapters do not provide a verified UI window ID and explicit same-window `/new` event. Automatic handoff requests fail closed; neither matching name nor matching project authorizes transfer. New windows/sessions must choose a free name or have the prior claim explicitly released. Same-window/same-project handoff remains a separate frontend integration task.

## Verification status

`npm test` exercises real sockets and persistence, session isolation, onboarding validation, deduplication, offline replay, acknowledgement authorization, OpenCode plugin wake-up with a mocked SDK, Codex proxy idle wake-up/busy steering with a protocol fixture, and unsolicited Claude channel notifications over real MCP stdio. These are integration/protocol tests, not evidence of a live model completing a task in your editor.

Name lifecycle tests use a controlled clock to exercise the full 300-second boundary, idle retention, socket loss, reclaim, explicit/admin release, simultaneous claims, cancelled stale deliveries and restart/crash recovery without waiting five real minutes.

`npm run doctor` initializes the installed real Codex app-server through the proxy without starting a model turn. This check passed with both the CLI's Codex 0.161.0 and the official VS Code extension's bundled Codex 0.162.0-alpha.2.

To check the bundled binary explicitly on this machine:

```sh
AGENT_CHANNEL_CODEX_EXECUTABLE=/Users/sandrovita/.vscode/extensions/openai.chatgpt-26.1002.51308-darwin-arm64/bin/macos-aarch64/codex npm run doctor
```

Installed versions inspected during initial implementation: OpenCode 1.18.35, Codex CLI 0.161.0, Codex VS Code extension 26.1002.51308, Claude Code 2.1.86. After approved installation, OpenCode's global plugin entry and the Windows game-server's user/application Codex settings were configured. Live remote Codex idle wake-up passed on 2026-10-09: the same session processed an unsolicited peer message and replied without polling. See [remote wake proof](remote-wake-proof.md) for broker and persisted-turn evidence. Claude live-model wake-up and further live busy/reconnect checks remain unverified.

### Live acceptance test

1. Start the broker and two configured harness sessions.
2. Join the same channel with distinct roles/projects.
3. Let B finish its response and wait idle.
4. From A, send B: “Create `channel-proof.txt` in your project with the message ID, then send me its path.”
5. Confirm B starts a new turn **in the same conversation without pressing Send**, creates the file and sends a reply.
6. Let A go idle before B replies. Confirm the reply wakes A.
7. Repeat with each harness pair and multiple conversations in one harness. Verify only the addressed session wakes.
8. Test busy steering separately and confirm pending approvals are preserved.

Future harness adapters must expose an actual idle-turn execution entry point. A socket/MCP connection alone does not make an arbitrary coding agent wakeable.

## Windows game-server deployment

An isolated deployment was installed at `C:\ProgramData\agent-channel`. The Windows x64 native launcher source is in `launcher/` and can be cross-compiled:

```sh
cd launcher
GOOS=windows GOARCH=amd64 go build -trimpath -o ../dist/agent-channel-codex.exe .
```

Its adjacent `launcher.json` contains executable paths, broker URL and credential-file path, never the credential itself. The launcher inherits stdio and uses a Windows kill-on-close job to clean up Node/Codex descendants. It supports ordinary Codex invocations, `--channel-mcp`, `--channel-session-hook`, and `--channel-doctor`.

Deployment helpers in `deploy/` prepare restricted ACLs, merge settings with backups, test the native executable and transport without running a model, and report process state. `configure.js` is deliberately single-install and refuses an existing override or enabled WSL mode. Never run it against an unrelated user profile.

Verified remotely: Node v24.18.0; native executable version passthrough and real Codex 0.162.0-alpha.2 app-server handshake; authenticated broker query through SSH; Windows protocol fixture idle `turn/start` and busy `turn/steer`, including paths containing spaces. Administrator application settings and `.codex/config.toml` were merged with timestamped backups recorded in remote `deployment-status.json`. After reload/resume, a real-model same-session idle-wake test passed, with persisted turn ID, matching incoming message UUID and explicit reply recorded in `docs/remote-wake-proof.md`.

The active development tunnel maps game-server loopback `47322` to Mac broker `47321`; its control socket is `dist/game-server-tunnel.sock`. Check or stop it with:

```sh
ssh -S /Users/sandrovita/Progetti/agent-channel/dist/game-server-tunnel.sock -O check bangerrp-fx
ssh -S /Users/sandrovita/Progetti/agent-channel/dist/game-server-tunnel.sock -O exit bangerrp-fx
```

This tunnel survives the launching terminal but is not a persistent reconnect service and depends on the Mac staying awake. See `docs/external-host-design.md` for always-on deployment options.
