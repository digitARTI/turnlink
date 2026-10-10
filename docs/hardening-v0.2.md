# Protocol v2 hardening and migration

Status: v0.2 live fleet cutover and same-conversation OpenCode/Codex idle wakes verified. The legacy broker remains available for rollback. Private vulnerability reporting is enabled on GitHub. Published GitHub CI passed on Linux/macOS/Windows with Node22/24, including secret scanning.

## Ownership and trust

An HTTP bearer credential identifies an enrolled host or the separate operator principal. `security.json` stores credential hashes, channel scopes, broadcast permission and revocation. Each session operation carries a private 32-byte proof bound to that host and actual harness/session ID. The proxy and MCP tool process share their private proof directory; model tool results never contain the proof.

The broker checks sender/receiver ownership, acknowledgements, leave and resume. Discovery requires membership in the queried channel. Direct-message history is visible only to its participants; broadcast history is visible to its recipients. Operators can inspect channels administratively.

Roles, names and project labels are descriptive metadata. They do not grant permissions. This is a privately operated broker, not a multi-user SaaS or filesystem sandbox. Processes that can read another process's key files cross the capability boundary. See [SECURITY.md](../SECURITY.md).

## Enrollment and revocation

On the broker host, using its state directory and loopback endpoint:

```sh
node src/host-admin.js enroll gameserver --channel development --out /private/new-gameserver.token --broadcast
node src/host-admin.js revoke gameserver
node src/host-admin.js revoke-session codex:<actual-session-id>
node src/release-name.js development api-agent
```

Enrollment writes a fresh credential to a new private file and prints only its location. Provision it out of band. Re-enrollment rotates the credential and closes the host's old sockets. Session revocation invalidates one capability without disabling the host's other sessions. The operator credential remains local; it is not a model tool or a remote client credential.

## Adapter setup

Use `AGENT_CHANNEL_TOKEN_FILE` for the host credential. `AGENT_CHANNEL_CREDENTIAL_DIR` selects the session-proof/admission-receipt directory. URLs cannot contain credentials or query parameters; remote plaintext WebSockets are rejected. Keep the endpoint loopback or SSH-forwarded.

OpenCode accepts explicit plugin options:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["file:///absolute/path/turnlink/adapters/opencode.js", {
    "url": "ws://127.0.0.1:47321",
    "tokenFile": "/private/workstation.token",
    "credentialDirectory": "/private/turnlink-session-keys"
  }]]
}
```

Quit and restart OpenCode to load changed code/options. Codex MCP can use `CODEX_THREAD_ID`/a trusted explicit binding, or the opt-in `--codex-stdio` mode when launched by the official Codex harness. The live probe found no environment ID but did find matching outer `threadId`/`sessionId` and `x-codex-turn-metadata`. In that mode each call is bound from coherent OUTER metadata, not model arguments; missing/mismatched metadata fails closed. It supports multiple isolated sessions in one MCP process. Configure launcher MCP args as `["--channel-mcp", "--codex-stdio"]`, or direct Node args as `["/absolute/path/turnlink/src/mcp.js", "--codex-stdio"]`. This relies on the configured private local stdio/OS trust boundary, not a new cryptographic signature. A model cannot choose the first identity.

For a new Claude conversation, the launcher supplies a matching real session ID:

```sh
node src/launch-claude.js --dangerously-load-development-channels server:agent_channel
```

For Claude resume, use its real existing ID through the normal resume mechanism and `AGENT_CHANNEL_SESSION_ID`. Do not fabricate it. No protocol-v1/shared-token fallback is enabled.

## Admission receipts

Adapters persist message-ID/fingerprint receipts before requesting a turn. States are `inflight`, `uncertain`, `accepted` and `not_admitted`.

- Acceptance is persisted before acknowledgement.
- Timeout/lost response remains uncertain, including after restart. It is not blindly retried.
- Late Codex responses are consumed inside the proxy and reconcile the receipt without leaking internal RPC IDs into VS Code.
- Accepted receipts deduplicate replay. Exactly-once arbitrary task effects are not promised.
- OpenCode preserves its observed agent, model and tool restrictions. Unknown mode stays queued; legacy and v2 permission/question events remain blocking.
- Claude still requires explicit model acknowledgement.

Inspect a receipt, then resolve it only with actual harness evidence:

```sh
node src/admissions.js <hostId> <agentId>
node src/admissions.js <hostId> <agentId> <message-uuid> --accepted
node src/admissions.js <hostId> <agentId> <message-uuid> --not-admitted
```

Use the adapter's credential directory. Receipts contain IDs, fingerprints and states, not message bodies. `--not-admitted` permits retry and must not be used when admission may already have happened. Runtime diagnostics log classifications rather than provider errors/prompts/credentials.

## Resource and filesystem safeguards

Defaults: 64 connections total, 16 per host, 64 active sessions per host, 32 channel members, 128 pending messages per recipient, four outstanding pushes per recipient, 10,000 history entries, 8,192 retained bindings, and 64 MiB of state. Text is limited to 12,000 UTF-8 bytes, frames to 64 KiB, and query pages by bytes. Host request/wake budgets and connection-attempt budgets are separate.

The broker holds an exclusive writer lock before reading or modifying state. Atomic snapshots use exclusive temporary files and fsync. Failed persistence prevents successful acknowledgement and isolates delivery. Private files reject symlinks/oversized contents and validate Unix ownership/mode or Windows ACLs. Existing broad ACLs fail closed; newly created private Windows directories receive restricted ACLs. Concurrent atomic replacement is retried with fresh descriptor identity checks.

Retention is bounded, not automatically compacted. Admission ledgers stop rather than discard deduplication evidence when full. Reconcile corresponding broker history before archiving.

## Coordinated migration

1. Pause/finish work and preserve actual session IDs. Keep the old broker/config/credentials available for rollback.
2. Take a fresh private snapshot at cutover; do not reuse a rehearsal snapshot while live work continues.
3. Stage a new empty directory with explicit ownership:

   ```sh
   node src/migrate-v2.js /private/legacy-store.json /private/turnlink-v2-state \
     opencode:<session-a>=workstation \
     opencode:<session-b>=workstation \
     codex:<remote-session>=gameserver
   ```

4. Review `migration.json`. The source is untouched. Fresh host/operator keys replace the shared legacy key. Retired historical identities are protected; undelivered legacy work is quarantined for review rather than blindly replayed.
5. Provision keys and update each adapter. Point both the Windows launcher root and MCP tools at the staged v0.2 installation. Keep the old launcher for rollback.
6. Start v2 using the new state directory and workstation token file. Reconnect within the five-minute name reservation, or prepare a fresh coordinated snapshot; do not silently extend claims.
7. Reload adapters and resume the same conversations. Check binding/connectivity, then verify a small real idle-wake task/reply and unchanged approval behavior.

Store version is 3; wire protocol version is 2. Legacy/malformed state is never silently overwritten. Automatic `/new` handoff remains disabled without verified same-window/project signals.

## Installer recovery

Windows helpers use `private/config-journal.json` and private backups. The journal is durable before user files change. Partial failure triggers rollback; recovery refuses to overwrite later user edits:

```sh
node deploy/rollback.js C:\ProgramData\turnlink-v0.2\private\config-journal.json
```

Review profile/root paths first. The resolver discovers installed official extension versions or accepts an explicit absolute `--codex` path. Native launch checks recursion by file identity, filters stale credential environment variables, preserves args/exit status, hides console children, and uses a kill-on-close job.

The Windows installer and cutover helper require a complete official runtime, including `codex-code-mode-host.exe`. They copy and hash-verify the entire runtime into a content-addressed `bin/runtime-<sha256>` directory, and place the same version's code-mode companion beside the launcher. `launcher.json` points to the copied `codex.exe`, so VS Code extension cleanup cannot remove the executable underneath an active adapter. Repeated preparation verifies existing files; a damaged runtime or different launcher companion fails before configuration changes. Runtime upgrades must be coordinated with a reload and backup rather than mixing companion versions.

For an already-installed adapter, `deploy/repair-codex-runtime.ps1` is a one-time repair: it discovers the newest complete official extension, stages its runtime, and saves the previous launcher configuration as `private/launcher-before-runtime-repair.json`. Inspect existing runtime/companion/backup files before rerunning; it refuses replacement. After repair, reload the VS Code window and resume the same conversation. `--version` and `--channel-doctor` check passthrough/app-server startup; a harmless real Codex tool call is still required to verify code-mode host startup.

## Verification

The current suite has 56 cases, including runtime staging/extension-cleanup regression fixtures. Published CI passed the 56-case suite on supported platforms for runtime-fix commit `2c94fac`, including the Windows native checks. Windows cases skip on other platforms. The live same-conversation OpenCode/Codex wake results are independently recorded rather than inferred from fixture/CI results.

## Recorded live cutover

The active fleet uses a separately supervised v2 broker on workstation loopback `47323` and game-server SSH-forwarded loopback `47324`. v0.1 remains on `47321`/`47322` for rollback; legacy retirement has not been performed. Fresh credentials are bound to `workstation` and `gameserver`; the remote hello verified protocol2/hostId=gameserver/admin=false. Mac plugin options and Windows launcher/MCP configuration are journaled. Manual reload/resume of the same conversations was completed; no game/client/FXServer/bridge lifecycle restart formed part of this adapter transition.

After coordinated reload/resume, all three original sessions were independently confirmed connected on v2 with claimed names and correct host ownership. The repaired Codex runtime passed an actual user-reported tool call and a live same-session v2 request/reply. The resumed bridge OpenCode session passed a nonce-only idle wake correlated with read-only harness message metadata. After an explicit user-authorized pause of Codex's automatic goal dispatch, its nonce request independently correlated with a new turn start, exact persisted input, ACK and turn completion in the original conversation. See [the v2 evidence](remote-wake-proof.md#v2-fleet-cutover-and-opencode-idle-wake). The preserved Codex goal remains user-paused until a user resume request.
