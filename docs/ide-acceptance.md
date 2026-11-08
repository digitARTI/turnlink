# Isolated IDE acceptance plan

Local profile paths and host names in the historical observations are
anonymized.

The opt-in physical Windows fixtures use `TURNLINK_TEST_WINDOWS_SSH_TARGET`
(`user@host`), `TURNLINK_TEST_WINDOWS_SSH_KEY` (an absolute private-key path),
and `TURNLINK_TEST_WINDOWS_TEMP` (an absolute Windows temporary directory with
forward slashes). Configure all three locally for a real run; the fixture uses
a uniquely named temporary directory and cleans it up.

Gate 7 remains open. This began as a preparation plan and read-only inventory on
2026-10-23. Subsequent isolated UI attempts are recorded below; they did not
complete acceptance. Real editor profiles and accounts remain unchanged.
Existing live v2 transport evidence in [remote-wake-proof.md](remote-wake-proof.md)
does not establish the current control-plane role/task/alert UI acceptance.
Worktree movement remains disabled pending gate 2; use one existing fixture cwd.

## Stopped actual Mac UI attempt

A subsequently authorized isolated Mac attempt was stopped by the user after
repeated automation failures. Automated IDE acceptance has not succeeded; this
does not make manual verification unavailable. The user explicitly prefers the
already open session, or will open a clean session when a specific test requires
one. Do not launch another editor instance automatically. Five attempts were made: one spawn failed
with `ENOENT` for `Contents/MacOS/Electron`; four launches of the actual
`Contents/MacOS/Code` reached the private editor UI but failed to complete
onboarding/workspace-trust/command-palette/composer automation. The latest failure
was a 30-second timeout locating `.quick-input-widget input`. No baseline turn,
role/task/alert UI flow or provider compatibility was proved. All runs recorded
zero local model requests, and the fixture broker had not yet been started.

The copied official extension's native runtime actually reports
`codex-cli 0.162.0-alpha.17.2`; this differs from both the standalone CLI and
Desktop app. The new failed Electron experiment was removed after preserving its
diagnostics; it is not a runnable acceptance path. Each started run closed its owned application;
post-stop process inspection found no surviving editor/native process whose
arguments referenced any owned fixture root. Concise failure evidence is retained
at `/tmp/turnlink-ide-acceptance-failure.json`, with private screenshot/UI/editor
diagnostics in the listed roots. No real profile/account state was copied, no
real provider keys/messages were used, and no global configuration was changed.

## Verification in the user's open session

Use the existing session for supported live channel checks. First record its
client/native version, conversation identity, cwd, model and permission settings,
then inspect adapter connectivity without changing those settings. Prepare a
dedicated synthetic test channel and present the exact test actions before
running the role, existing-cwd task and delivery checks in the phase table below.
Correlate the user's visible result with broker/native receipts. Preserve existing
instructions, approvals and unrelated work; do not reset or restart this session.

Client-specific screens remain separate evidence: observing a result in the
Codex app does not establish the VS Code extension's UI. If a fresh session or
the VS Code view is required, ask the user to open it and provide the exact
configuration and steps. Reconnect tests that require restarting the editor also
use this manual handoff. Automation failures remain recorded as failed attempts,
and manual outcomes remain pending until actually observed.

Read-only inspection for this chat found no Turnlink/channel tools in the
available tool inventory and no matching MCP server in the selected user config
or project config layers. No settings were changed. A reviewed MCP connection
would be needed before channel tool checks here; opening another editor is not
itself a prerequisite for that connection. Codex documents shared user/project
MCP configuration and the app's MCP settings in its
[official setup guide](https://learn.chatgpt.com/docs/extend/mcp).
Installed-runtime support and actual loaded tools must still be observed.

Keep an existing real session's model, instructions and permissions intact.
Adding host-scoped MCP tools alone does not install the native proxy/receiver,
authorize adapter operations or prove idle wakes/task execution. Those checks
require an actual enrolled receiver and the compatible native integration;
never substitute the MCP process or a synthetic peer for that evidence.

## Current environment installation (2026-10-24)

The user rejected the private-profile handoff and explicitly authorized installation
in the current test environment, including changes needed for testing. The old
manual opening instructions are superseded; do not launch another VS Code instance.

Installed state is at `/Users/example/.local/share/turnlink-development`.
The current-source broker runs at `ws://127.0.0.1:47325`, with control effects
and existing-cwd Codex task dispatch enabled; managed worktree movement is disabled.
User Codex configuration now includes `mcp_servers.agent_channel`. The VS Code
user setting `chatgpt.cliExecutable` points to the installed Node 24 wrapper,
which uses the existing extension's actual native binary and matching companion.
Existing model/provider/permission/hook settings and normal HOME are preserved.
The configuration transaction journal and original file backups are in that state
directory. No editor was launched or reloaded automatically.

Actual verification passed: authenticated broker control-storage request, all eight
MCP tools listed through real stdio, and installed-wrapper native app-server
initialization with `codex-cli 0.162.0-alpha.17.2` using the normal Codex home.
No model prompt, channel membership or peer message was sent. Existing-window
activation, real session binding and visible role/task/delivery acceptance remain
pending. Reload the existing window and resume this conversation to load the
configuration; a second editor window is unnecessary.

## Available artifacts

| Host | Editor | Native tools | Codex extension metadata |
| --- | --- | --- | --- |
| Mac | VS Code 1.143.1 arm64 | Codex CLI 0.161.0; OpenCode 2.1.3 | `openai.chatgpt` 26.1007.21434, darwin-arm64; bundled `bin/macos-aarch64/codex` and code-mode companion |
| `example-windows-host` | VS Code 1.142.0, `C:\Program Files\Microsoft VS Code\Code.exe` | Node 24.18.0; OpenCode on PATH; no Codex on SSH account PATH | `C:\Users\example\.vscode\extensions\openai.chatgpt-26.1007.21434-win32-x64`; bundled `bin/windows-x86_64/codex.exe` |

The SSH account is `adminmatto`, which has no matching installed Codex/OpenCode
extension in its own extension directory. The historical deployment belongs to
`Administrator`; inspecting only the SSH profile would miss its runtime. These
checks read extension package metadata and executable paths, not profile settings,
accounts, credentials, sessions or real instructions. No OpenCode VS Code
extension was found in either inventoried profile. The Mac Codex extension requires
VS Code `^1.96.2`; its manifest exposes restricted, application-scoped
`chatgpt.cliExecutable`. Source inspection confirms it resolves `CODEX_HOME` and
otherwise uses its bundled native executable.

## Preparation helper

`deploy/ide-acceptance-plan.js` exports `planIDEAcceptance(input, inheritedEnv)`.
It returns plain data: exact editor executable/argv, replacement environment,
private settings, prerequisites and evidence phases. It does not read files,
write directories, copy extensions, start a service, connect to a model or launch
a process. It accepts Mac/Windows paths; Windows requires native `.exe` editor,
Codex and proxy artifacts. Root/artifact overlap, relative paths, control
characters and unknown options refuse. Filesystem existence, symlinks, ACLs,
runtime signatures and network reachability remain preparation checks, not claims
of this lexical validator. `launchAuthorized: false` always remains in its output.

Example input for Mac (substitute reviewed absolute artifact paths):

```js
import { planIDEAcceptance } from './deploy/ide-acceptance-plan.js';
const plan = planIDEAcceptance({
  platform: 'darwin', root: '/private/tmp/turnlink-ide-UNIQUE',
  editor: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  extension: '/reviewed/openai.chatgpt-26.1007.21434-darwin-arm64',
  native: '/reviewed/runtime/codex',
  proxy: '/reviewed/turnlink/src/codex-proxy.js',
}, { PATH: '/reviewed/node/bin:/usr/bin:/bin' });
console.log(JSON.stringify(plan, null, 2)); // Does not launch anything.
```

Create the root exclusively with private permissions, reject symlink/existing
state, then create `editor/User`, `extensions`, `project`, `home`, `codex`,
`sqlite`, `temp` and the environment's other private state paths. Apply the
repository's private directory/ACL checks. Write only the returned settings to
`editor/User/settings.json`; copy only the reviewed extension package into
`extensions`. Keep workspace trust enabled and review trust only for the synthetic
fixture project. Never copy auth/config/profile/history/skill state. Do not use
the repository's real cwd as the fixture workspace. Keep real profiles and running
editor windows untouched.

VS Code's separate `--user-data-dir` selects independent state and environment;
`--extensions-dir` selects the extension root. Portable Mode can override both,
so refuse a portable installation/data directory. `--sync off` and
`--skip-add-to-recently-opened` avoid account sync and recent-workspace additions.
Using a new profile alone is insufficient because normal editor instances can
inherit the running instance's environment. These are documented
[VS Code CLI behaviors](https://code.visualstudio.com/docs/configure/command-line).

The replacement environment omits inherited keys, authentication agents, proxies,
Node injection, VS Code IPC and Portable mode. It pins private `HOME`,
`USERPROFILE`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, XDG/AppData and temporary paths.
Codex documents `CODEX_HOME` for IDE config/auth/log/session state and requires it
to exist; SQLite state has a separate override. See the
[Codex environment reference](https://learn.chatgpt.com/docs/config-file/environment-variables).
This is state isolation, not an OS/network sandbox. Disabling editor telemetry
and updates is not proof that the extension makes no ancillary network calls.
Do not launch where such calls would violate the acceptance constraints.

On Windows, reuse the reviewed native launcher design in
[external-host-design.md](external-host-design.md), with private fixture
`launcher.json` and token files. Stage a matching complete Codex runtime and
`codex-code-mode-host.exe`; preserve the extension/runtime version pairing.
No PowerShell/JS shebang path or command-plus-arguments string can replace the
native executable. Preparation must not invoke the existing global installer,
cutover helper or Administrator settings. A visible interactive desktop under
the intended test account is a separate prerequisite; SSH process startup alone
cannot prove UI presentation.

## Model, broker and UI harness

Use the existing local Responses SSE fixture in
`test/codex-worktree-gate.test.js` as the protocol starting point: bind only
`127.0.0.1`, select `model_provider="fixture"`, `wire_api="responses"`, a bounded
local `base_url` and a synthetic `TURNLINK_FIXTURE_KEY`. The provider must have
no real authentication helper, credential fallback or remote URL. Codex's
[custom provider documentation](https://developers.openai.com/codex/config-advanced/)
describes provider endpoints and authentication configuration. Native CLI fixture
success does not prove the official extension permits this provider without a
login. Stop if it requires a real account or rejects the fixture; do not sign in.
Matching the new extension's bundled runtime is another required compatibility
check; the inventoried standalone CLI version is not evidence of that version.

Start a separate loopback broker on an ephemeral port and private storage after
launch authorization. Enroll only a fixture adapter credential. Add only fixture
MCP config, broker URL and token-file paths to its private Codex config/environment.
Reuse the protocol fixture's deterministic join/volunteer/claim/report/review
responses, with all task commands generated in this private broker. Add bounded
hold/release controls for busy and approval phases and record request counts,
session/turn/action/evidence IDs, cwd/model/permission metadata and synthetic
instruction markers. Do not log full HTTP prompts, real transcripts or keys.
Use fixture global/project `AGENTS.md` markers and conservative native permissions;
do not import real instructions or automatically answer an approval.

A human can perform the checks in the existing editor or an explicitly requested
clean session. The isolated Electron automation above failed and must not be
relaunched as a substitute for this workflow. Avoid exposing a remote debugging listener
on non-loopback interfaces. Wait for extension activation, fixture provider
availability, MCP consent and completed native turns with separate bounded
deadlines; collect owned-process diagnostics on timeout. Do not treat timeouts
or absent controls as a successful negative test.

| Phase | Required actual UI and correlated native evidence |
| --- | --- |
| Baseline | Official Codex view opens in the fixture workspace; synthetic turn completes; same session/cwd, model, instructions and permission state before/after peer idle wake and busy delivery. |
| Role | Explicit volunteer and appointment/acceptance; supplemental role is visible in that existing native conversation; master state correlates with native admission and instruction markers remain. |
| Task | `requiresWorktree:false`; explicit claim, native result/evidence, report and master acceptance; task execution/result is visible in the same conversation with cwd/permissions unchanged. |
| Alert | Open a metadata-only fixture incident; actual dashboard Notifications/Health views reflect it without a Codex model request. Codex has no claimed passive native toast integration. OS desktop delivery is a separate gate. |
| Approvals | Hold a known synthetic native permission request; peer delivery waits, request contents remain intact, and only the test operator's explicit approval/refusal proceeds. No auto-approval configuration. |
| Reconnect | Restart only owned fixture transport/editor as required; preserve fixture session ID and instruction/permission metadata; correlate receipts and prove no duplicate native effects. |

For OpenCode, the existing `test/opencode-tui-service.test.js` already supplies
a real standalone CLI/PTTY/local-provider path and counts passive toast calls
without a model wake. This is TUI acceptance, not a discovered VS Code extension.
The separate native OpenCode effort owns new upstream/runtime changes; this
plan does not select an unreviewed editor plugin, install one or claim IDE parity.

Save only synthetic screenshots and bounded metadata to the fixture evidence
directory, inventory owned PIDs, close only those processes, then remove only
the exact fixture root after all are stopped. Record Mac and Windows separately.
Until those UI observations exist, the plan's four unit tests establish manifest
validation only. They do not close gate 7 or authorize GUI/model/OS operations.

## Runnable manual fixture (no editor launch)

`deploy/ide-acceptance-fixture.js` starts only a local Responses SSE mock and an
isolated real broker. It never launches an editor/native executable, writes real
profiles, copies accounts, or reads provider keys. Everything is synthetic and
uses a fresh `turnlink-ide-manual-*` directory. It does not prove hosted-model
autonomy. The model mock is deterministic, accepts at most 100 requests, and the
servers stop automatically after 30 minutes. Movement, native OS notifications,
dashboard server and approval answering are not enabled by this runner.

Start in one terminal, using a supported Node and reviewed absolute paths:

```sh
node deploy/ide-acceptance-fixture.js start \
  /Users/example/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex \
  /path/to/turnlink/src/codex-proxy.js
```

This only opens two loopback listeners. It prints `root`, the private fixture
project path and status URL; leave that terminal running. Copy the exact printed
root into the commands below. No editor should open as a result. A separate
optional final argument selects an existing parent directory; the runner always
creates a fresh child and never adopts an existing fixture root.

Review these generated artifacts before agreeing to session actions:

- `environment.json`: replacement fixture environment, with private home, Codex,
  SQLite, XDG/AppData/temp paths and fixture broker/adapter token-file paths.
  The fixture model key is the literal synthetic value `fixture-only`.
- `codex/config.toml`: loopback fixture provider, `read-only` sandbox,
  `on-request` approvals and fixture-only Turnlink MCP definition.
- `editor/User/settings.json`: private suggested `chatgpt.cliExecutable` and
  update/telemetry/trust settings. The runner does not apply it to an editor.
- `project/AGENTS.md` and `codex/AGENTS.md`: synthetic instruction markers.
  No real instructions, auth files or history are imported.

Use an existing session only if it already uses this exact private fixture
environment/config/provider/broker and fixture project. Do not switch the user's
real conversation to this model or replace its instructions, permissions or MCP
settings. In an ordinary already-open real session, read-only inspection of the
visible client/native version, cwd/model/permission UI and current adapter
connectivity is possible; the synthetic model/role/task/wake checks require a
user-opened clean, fixture-configured session. A new tab alone does not isolate
an existing process's inherited environment. The user should manually open a
private editor context with separate user-data/extensions paths and the reviewed
replacement environment, or use an already compatible private context. Nothing
in this runner creates that context. No automatic relaunch is authorized.

Before the first typed prompt, agree which exact phases below will run and which
UI the user is observing. Confirm the native version, fixture provider and cwd;
record initial model, instruction sources and approval/sandbox settings. Stop if
account sign-in, a real provider, permission broadening or unsupported config is
required. MCP consent is an explicit user decision for this known local fixture;
the runner never answers it.

```sh
node deploy/ide-acceptance-fixture.js status /EXACT/PRINTED/ROOT
```

Status is read-only. It reports bounded phase/request counts, instruction-marker
presence, participant/assignment/task/native-admission/evidence IDs and pending
manual UI evidence. It never returns HTTP prompts, transcripts or credential
values, and reading status does not trigger a model request. HTTP controls require
a private bearer token plus JSON POST; GET, cross-origin and unauthenticated
control requests refuse. Prefer the CLI, which reads the private control token
without printing it.

Broker-derived status is coalesced for up to 500 milliseconds, so wait for a
changed phase rather than assuming an immediate read is current. The proxy's
normal role-notice maintenance interval is 30 seconds; allow up to 45 seconds for
an admitted offer and do not resend appointments while waiting. Pending notices
disappear from the pending page after acceptance; `acceptedNoticeIDs` records
the bounded notice IDs from durable acceptance events for correlation.

| Agreed phase | Manual action and expected evidence |
| --- | --- |
| Baseline | Type `TURNLINK_MANUAL_BASELINE` in the fixture conversation. Expect `TURNLINK_MANUAL_BASELINE_OK`, one local request, and both instruction-marker flags true in status. Record actual visible UI and unchanged cwd/model/permissions. |
| Join | Type `TURNLINK_MANUAL_JOIN`. Review the actual native MCP tool call/consent. Status must show exactly one connected fixture Codex participant. This is synthetic tool output until native execution and broker state confirm it. |
| Volunteer | Type `TURNLINK_MANUAL_VOLUNTEER`. The native MCP call volunteers only that fixture participant. |
| Role offer | Run `node deploy/ide-acceptance-fixture.js phase ROOT appoint` only when the offer is agreed: this explicitly schedules a supplemental role notice in the fixture conversation. Record the visible offer and native notice receipt. The CLI prints the exact `TURNLINK_MANUAL_ACCEPT:UUID` prompt; type it to explicitly accept. Status must show the matching active assignment. |
| Existing-cwd task | Run `node deploy/ide-acceptance-fixture.js phase ROOT task`. Type its printed `TURNLINK_MANUAL_CLAIM:UUID` prompt. The task requires no worktree or file changes. Observe the native task turn/result and automatic artifact/report notice. When status shows `review` with stopped/evidence IDs, type `TURNLINK_MANUAL_REVIEW:TASK_UUID` to make the explicit synthetic master review. Status must then show `completed`; record visible turns and unchanged cwd/permissions. |
| Passive incident metadata | Record `modelRequests`, then run `node deploy/ide-acceptance-fixture.js phase ROOT incident`. Re-read status: incident ID is present and request count stays unchanged. This is durable incident/no-wake evidence, not actual dashboard/desktop/IDE alert presentation. Those UI observations remain separate. |
| Peer idle wake | Only after the user confirms the fixture conversation is idle, run `node deploy/ide-acceptance-fixture.js phase ROOT wake`. This explicitly joins a synthetic sender and sends one peer message to the sole fixture native receiver. Record its message UUID, visible same-conversation `TURNLINK_MANUAL_WAKE_OK`, and unchanged metadata. The runner refuses a second wake; it never guesses whether a busy/blocked session is safe. |

`appoint`, `task`, `incident` and `wake` are explicit fixture mutations, never
automatic polling. There is no arbitrary actor/command endpoint. Busy steering,
permission-blocker UI, reconnect and actual alert rendering require separately
agreed manual steps; this initial runner does not certify them.

Close only the user-opened fixture session/editor when finished, preserving real
sessions. Stop the fixture with Ctrl-C in its terminal, or from another terminal:

```sh
node deploy/ide-acceptance-fixture.js stop /EXACT/PRINTED/ROOT
```

Wait for the runner terminal to exit. Preserve only agreed synthetic screenshots
and the bounded status report if needed, then explicitly clean the exact stopped
root:

```sh
node deploy/ide-acceptance-fixture.js cleanup /EXACT/PRINTED/ROOT
```

Cleanup validates the private marker, recorded root/inode/device, stopped server
state and runner exit. It refuses unknown roots, missing paths, symlinks and live
fixtures and never kills processes. It cannot close or inspect the manually
opened editor; the user must close that fixture context first. Interrupted or
crashed runners without a durable stopped marker refuse cleanup rather than
guessing. Manual UI acceptance remains pending until the user's observations and
the native/broker IDs are correlated.

### Verified non-GUI fixture contract

The ten runner/manifest cases passed, including a real CLI subprocess lifecycle,
real loopback broker/model HTTP, bounded status/privacy, control authentication
and cross-origin refusals, fresh-root and cleanup refusal, and the generated MCP
credential allowlist. MCP receives only the host URL/token-file/credential-dir;
the adapter credential stays in the proxy's own private environment.

The actual bundled `codex-cli 0.162.0-alpha.17.2` also passed this opt-in non-GUI
test using the generated config, source proxy and real native MCP tooling:

```sh
TURNLINK_CODEX_MANUAL_FIXTURE_INTEGRATION=1 \
TURNLINK_CODEX_EXECUTABLE=/Users/example/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex \
node --test test/ide-acceptance-native.test.js
```

Its 35.8-second run proved baseline, join, voluntary eligibility, admitted role
offer, explicit acceptance, task claim, adapter-bound native result/artifact/stop,
report and explicit master review reaching `completed`. It asserted one unchanged
thread, cwd, model, approval policy and read-only sandbox. Only the generated
known local MCP server's empty consent request was explicitly accepted by the
test operator; no real session/provider or editor was used. This validates the
fixture protocol/config before manual handoff, not IDE rendering, hosted-model
autonomy, permission-blocker UI, busy delivery, reconnect or OS alerts.
