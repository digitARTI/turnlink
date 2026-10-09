# Protocol v2 hardening and migration

Status: unreleased candidate. The v2 broker is staged alongside v0.1 for coordinated reload and wake verification. Private vulnerability reporting is enabled on GitHub. Published GitHub CI passed on Linux/macOS/Windows with Node22/24, including secret scanning.

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

## Verification

The current suite has 53 cases. Earlier staged Windows verification passed 46 cases plus the affected recovery/native checks; subsequent published CI passed the complete current suite on supported platforms. Windows cases skip on other platforms. Real-model v2 cutover remains separate from fixture/CI results.

## Recorded live cutover staging

The active fleet has a separately supervised v2 broker on workstation loopback `47323` and game-server SSH-forwarded loopback `47324`. v0.1 remains on `47321`/`47322` for coordination/rollback until the live wake proof passes. Fresh credentials are bound to `workstation` and `gameserver`; the remote hello verified protocol2/hostId=gameserver/admin=false. Mac plugin options and Windows launcher/MCP configuration are journaled. Manual reload/resume of the same conversations is required; no game/client/FXServer/bridge lifecycle restart is part of this adapter transition.
