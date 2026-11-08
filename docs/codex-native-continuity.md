# Installed Codex continuity contract evidence

Local profile paths in this evidence are anonymized.

Measured on macOS arm64, most recently 2026-10-30. These probes establish native primitives and incompatibilities; they do not authorize movement. Production `executionEligible` remains false. Subsequent opt-in private proxy-channel work is documented in the remaining-development ledger.

An MCP plan with `effects.stepPreparation: true` discloses that a later
destination step may invoke native contributors and their providers, including
process, network, credential, filesystem, plugin and shared-cache effects. It
also requires the retained MCP binding, plugin and skill captures. The flag is
an effect disclosure for approval, not permission to dispatch the step. The
host currently refuses to dispatch a plan carrying it because step execution,
write-ahead recovery and fresh authorization are not yet implemented. Control
schema 27 preserves this distinction across restart and export.

## Exact installed runtimes

| Runtime | Executable | Reported version |
| --- | --- | --- |
| Desktop | `/Applications/Codex.app/Contents/Resources/codex` | `codex-cli 0.135.0-alpha.1` |
| Standalone | `/Users/example/.local/bin/codex` | `codex-cli 0.165.0` |
| VS Code extension 26.1007.21434 | `/Users/example/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex` | `codex-cli 0.162.0-alpha.17.2` |

The standalone symlink resolves through the Node installation to the 0.165.0
package launcher (SHA-256
`61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70`);
its packaged native executable SHA-256 is
`a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a`.
Desktop binary SHA-256 is
`c2663b1f51185720f97842e5a966c35b4ce23c7aeaa8654c13e0b6cf2230b878`.
These identify measurements, never confer authority.

## Codex 0.166 daemon compatibility — 2026-10-30

An installed app-server daemon reports `codex-cli 0.166.0`; its executable
SHA-256 is `39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1`.
A read-only process inspection observed it using the ordinary Codex state home;
that observation does not establish ownership of any particular thread.

With plugins disabled in isolated synthetic homes, 0.166 excluded another 0.166
writer until owner process exit. Both mixed orders with the preserved Desktop
0.135 runtime allowed a second writer to resume, change the same thread's cwd
and complete a fixture turn while the first stdio fence saw no foreign turn.
The 0.166 settings probe also retained the tested governance fields and observed
the destination instruction. These are bounded observations, not complete
runtime isolation or authorization to move a production conversation. The first
mixed probe exposed a background plugin-clone cleanup race; it was cleaned up
and the corrected, version-pinned probes all passed. See the execution ledger.

## Deployed Desktop store isolation — 2026-10-30

The incompatible Desktop 0.135 launch path is now a reviewed wrapper that
unconditionally exports
both `CODEX_HOME` and `CODEX_SQLITE_HOME` to the separate Desktop home before
executing the preserved original runtime. It ignores an inherited shared
home overrides. The original binary remains at the non-default path
`codex.turnlink-unisolated-0.135.0-alpha.1` with its measured SHA-256 unchanged,
so rollback is possible but explicitly reopens the gate condition.

`npm run verify:codex-desktop-isolation` checks the installed wrapper against
the repository copy, checks the preserved binary hash, launches the actual 0.135
runtime with a private `HOME` and a synthetic shared-home trap, and verifies that
the trap is untouched during a version invocation while the separate Desktop
home is created. This does not verify the full Desktop app or managed settings.
An app update
that restores the original launch path makes this preflight fail. The official
OpenAI documentation confirms that an explicit `CODEX_HOME` selects the Codex
home used by the runtime.

After isolation, both standalone 0.165.0 probes passed again: destination
instructions were observed, a second compatible writer was refused, and the
writer became available only after owner-process exit. This resolves the
two inherited home overrides. It does not complete the separately staged
Codex destination authority, resource establishment, commit/recovery or receiver
handoff recorded in the native manifest; production `executionEligible` remains
false.

## Separate Windows native acceptance

The installed Windows extension's static native executable also reports
`codex-cli 0.162.0-alpha.17.2`. On the documented Windows host, with Node 24.18.0,
both actual native probes passed: same-thread cwd/settings and instruction
preservation, then two-process writer exclusion and owner-process-exit release.
The next destination request contained the synthetic destination AGENTS marker;
the second writer was refused, remained refused through the bounded unsubscribe
observation, and resumed after the owned fixture process was killed and closed.
On Windows that is forced process termination, not a POSIX signal-handler test.

This used a fresh ACL-private source/dependency bundle with SHA-256
`7ed3c4301746a2064cb10e55e406a862aea890a321ae4c9a97062f800a32e80b`.
The fixture now sets private USERPROFILE, AppData, SQLite, XDG and temporary
paths as well as HOME/CODEX_HOME, with only required system/PATH inputs and
synthetic provider credentials. Version/schema subprocesses have explicit
deadlines. The same updated fixture passed both standalone Mac probes again.
No VS Code GUI, real account, native user conversation or hosted model was used.
Each native child closure was awaited; the private native temporary directory
was empty before the exact remote fixture root was removed. Full TAP, stderr and
exit evidence remain locally as `/tmp/turnlink-windows-continuity-native.*`;
the Mac repeat is `/tmp/turnlink-codex-continuity-isolation-mac.log`.

Only the same-version Windows pair was measured. This does not establish mixed
Windows runtime exclusion, task/proxy/IDE UI integration, complete effective
authority or production movement eligibility. The matrix below records the
separate macOS measurements.

## Native cwd and identity measurements

`test/codex-native-continuity.test.js` starts actual app-server processes, generates their experimental TypeScript bindings, and uses a loopback Responses/SSE fixture. Every home, native thread, project, instruction and credential is synthetic and private. No user history, provider credential, hosted inference or global configuration is read or changed. Native subprocess stderr is drained; diagnostics contain classifications and versions rather than prompts.

All three runtimes accept `thread/settings/update {threadId,cwd}` without starting inference. The following `thread/resume` retains the exact thread ID, model/provider, read-only sandbox, approval policy, and exposed approval reviewer, active permission profile and disabled-plugin fields. The next local fixture turn retains the synthetic global, project and developer instruction markers. The destination-only instruction marker differs:

| Runtime | Same-thread cwd update | Destination AGENTS marker in next request |
| --- | --- | --- |
| Desktop 0.135 alpha | Yes | **Absent** |
| Standalone 0.165 | Yes | Present |
| VS Code 0.162 alpha | Yes | Present |

This exercises one read-only permission configuration. Named custom profiles, approval interactions, full tool inventory, environment execution and receiver rebinding are not established by this test. A successful update response or path equality alone is insufficient.

All three measured runtimes give a fork a distinct `thread.id`, set `forkedFromId` to the source, and return `fork.sessionId === fork.id`. Do not substitute fork identity, ancestry or a presumed shared session root for the exact authenticated thread. The current [App Server guide](https://learn.chatgpt.com/docs/app-server) describes thread loading, subscription lifetime and session identifiers; generated bindings and actual installed responses must also be checked because installed versions differ from the current guide.

## Actual second-process exclusion

Each row starts two real app-server processes sharing only the fixture's private native home. While the first process holds its `CodexAdmissionFence.exclusive`, the second attempts to resume the same exact native thread. “Bypass” means it resumes, changes cwd, and completes a local fixture turn; the first fence's guard still succeeds and its stdout contains no foreign turn notification.

| First owner | Second writer | Observed result |
| --- | --- | --- |
| Standalone 0.165 | Standalone 0.165 | Native active-writer refusal |
| Desktop 0.135 alpha | Desktop 0.135 alpha | **Bypass** |
| Standalone 0.165 | Desktop 0.135 alpha | **Bypass** |
| Desktop 0.135 alpha | Standalone 0.161 (2026-10-23) | **Bypass** |
| VS Code 0.162 alpha | VS Code 0.162 alpha | Native active-writer refusal |
| VS Code 0.162 alpha | Standalone 0.161 (2026-10-23) | Native active-writer refusal |
| VS Code 0.162 alpha | Desktop 0.135 alpha | **Bypass** |

The newer native refusal is JSON-RPC `-32600` with an active-writer classification. After `thread/unsubscribe`, twenty retries separated by 25ms still refused in the measured runs; this establishes a bounded observation, not a promise that unsubscribe never releases. After sending **SIGKILL**, awaiting actual owner process closure, and retrying in the existing second process, resume succeeds and a local fixture turn completes. A prior graceful SIGTERM probe also released ownership. This does not establish crash recovery on other OSes, active-tool cancellation, durable Turnlink hold clearance, or authority to kill a user's process. Only synthetic fixture children are terminated.

The upstream [native writer-lock implementation](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/writer_lock.rs) uses a coordinated per-thread file lock within one Codex home. This is a practical foundation for cooperative native versions. A writer that does not participate can still mutate shared state, as the installed mixed-version probes demonstrate. That source is current upstream, not proof of the source revision inside an installed binary.

## Remaining authenticated transition contract

The generated settings/update parameters provide cwd and native policy settings, but no owner token or expected revision/generation. The existing Turnlink fence covers one stdio connection. Its owned mutation allowlist currently contains turn/start, turn/steer and turn/interrupt; it deliberately does not grant owned settings/update. An observational snapshot hash, executable hash, same cwd, model name or native UUID cannot manufacture the missing authority.

A concrete implementation path requires these boundaries before exposing movement:

1. A supported native writer boundary must reject every competing ingress for the exact thread, including desktop/IDE/CLI and mixed supported versions. It must return an owner generation tied to authenticated acquisition, retain it through the transition, reject stale generations on mutation, and expose release/disconnect/crash behavior. Upgrading only one executable does not satisfy the observed compatibility problem. A private sidecar lock cannot constrain an unmodified competing native client.
2. Native preflight must resolve source and destination instruction sources, effective permissions/approval reviewer/profile provenance, environment and tool authorities without starting unapproved work. `config/read {cwd,includeLayers}` and thread-scoped MCP inventory are useful observations but do not prove the entire effective native execution contract.
3. Turnlink must check an exact approved task-scoped grant, expected source thread/cwd/native owner generation and destination worktree identity, acquire the existing private admission fence, then make only the authorized native mutation. A settings/update path needs an explicit tightly scoped fence extension. A turn/start.cwd path must correlate the exact accepted turn and native lifecycle and cannot use an unapproved “probe” model turn as preflight.
4. Verify destination native state and instruction/permission continuity, rebind the authenticated task receiver, then durably record completion. Any unknown native submission, disconnect, owner loss or partial rebind retains/quarantines the hold for exact reconciliation; restart never guesses completion from paths or model output. Preserve the original thread and native history.

Upstream native changes or a fully supported authenticated single-owner transport are plausible implementations of the first two boundaries. The current installed matrix does not supply them. No new generic “proof” field, forged native capability, movement switch or production owner claim was added. Gates 2/3 remain open for the full native transition and receiver acceptance chain.

## Reproduce explicitly

Default test runs skip both probes. With Node 24 on PATH:

```sh
TURNLINK_CODEX_CONTINUITY_INTEGRATION=1 \
TURNLINK_CODEX_EXECUTABLE=/absolute/path/to/codex \
node --test test/codex-native-continuity.test.js
```

For a mixed pair, additionally set `TURNLINK_CODEX_OTHER_EXECUTABLE=/absolute/path/to/other/codex` and use `--test-name-pattern=cross-process`. Each selected case has a 45-second test deadline, 12-second RPC deadline, 2MiB request bound and 2048 native-frame bound. Children, server connections and private files are cleaned up. New runtime versions are measured without automatically acquiring production authority; the known installed versions pin their observed safe or unsafe behavior explicitly.
