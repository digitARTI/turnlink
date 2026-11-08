# Standalone operator attention

`node src/operator-attention.js run /absolute/private/config.json` starts an
explicit background-capable foreground service. Run it under a supervisor only
after reviewing deployment. Nothing installs a service, edits launchctl/systemd,
changes global settings, or enables native work automatically.

Create the configuration yourself in a private directory, with mode 0600:

```json
{
  "version": 1,
  "url": "ws://127.0.0.1:47321",
  "tokenFile": "/absolute/private/admin-token",
  "channel": "dev",
  "directory": "/absolute/private/attention-journal",
  "intervalMs": 15000,
  "nativeTimeoutMs": 10000,
  "maxRecords": 8192
}
```

The token file must already contain an operator credential; the daemon never
creates credentials. The journal directory is private, separate from the broker
writer directory. Configuration, journal and credential files fail closed on
insecure permissions. An optional absolute `nativeExecutable` selects an
operator-owned private executable for local integration/testing; it receives
the same fixed platform arguments. Never point it at a peer-controlled program.

The service reads pending operator notifications, storage pressure and adapter
health without requiring a master. It never acknowledges notifications, sends
model prompts, executes recovery, or changes tasks. Native notification text is
always the same: inspect the private operator inbox. Collaboration text, paths,
entity IDs, native error output and credentials are never passed to the native
notification process or printed. Journal rows contain only class, hashes,
timestamp and submission classification.

macOS uses `/usr/bin/osascript`; Linux uses `/usr/bin/notify-send` when installed.
Windows uses the system Windows PowerShell WinRT toast API and stops on PowerShell
errors. It requires a registered `Turnlink` AppUserModelID on a Start menu shortcut,
as described in [Microsoft's desktop toast prerequisites](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid).
The explicit setup artifact is `deploy/setup-windows-attention.ps1`. Its default
`Plan` operation is read-only. Run it in Windows PowerShell with explicit existing
paths to the Node executable, attention script and private configuration:

```powershell
$setup = 'C:\reviewed-turnlink\deploy\setup-windows-attention.ps1'
$inputs = @{
  NodeExecutable = (Get-Command node.exe).Source
  AttentionScript = 'C:\reviewed-turnlink\src\operator-attention.js'
  ConfigPath = 'C:\private-turnlink\attention-config.json'
}
& $setup -Operation Plan @inputs
```

Review the output before an operator explicitly runs `Install`. Installation
creates only `Turnlink Operator Inbox.lnk` in the current user's Start-menu
Programs folder. It sets the fixed `Turnlink` AppUserModelID and reopens the
on-disk property store to verify it. The shortcut targets only
`node operator-attention.js status <private-config>`; setup never starts the
daemon, configures startup/services, changes notification settings, or displays
a toast. Repeating setup preserves an exact matching shortcut and refuses to
replace a conflicting existing file.

```powershell
# Explicit operator installation; this command changes the per-user Start menu.
& $setup -Operation Install @inputs
& $setup -Operation Inspect @inputs
```

For isolated acceptance use `Stage -ShortcutPath <private-temp-folder>\fixture.lnk`
and then `Inspect` with the same path. `Stage` refuses both real per-user and common Start-menu
trees; a staged fixture is not a registered notification identity.
The script sets Microsoft's documented
[System.AppUserModel.ID property](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-id)
through `IPropertyStore`, rather than assuming the shortcut filename registers
an identity. No setup operation executes a shortcut or sends a notification.

The three setup tests passed on an actual isolated Windows host with Node
24.18.0 and Windows PowerShell 5.1: read-only planning, COM-backed property
write/read plus idempotence/conflict refusal, and protection against fixture
writes into the real Start menu. Tests created only temporary shortcuts and
removed them afterwards. A combined actual-Windows run also passed all twelve
daemon lifecycle/journal tests with the private compiled executable fixture
(fifteen cases total, zero skipped). Readiness checks use the configured native
and RPC deadlines plus Windows private-path initialization bounds; held native
fixtures use an explicit release gate and their own hard deadline. The `Install`
branch was not executed and no toast was sent. Actual Start-menu registration
and visible notification-center delivery therefore remain separate
operator/platform acceptance steps.

A successful utility exit is recorded
as `submitted`, meaning only that the native command returned success. It does
not prove that an OS banner appeared, that focus/OS policy allowed it, or that a
human saw or acknowledged anything. Actual OS acceptance and Windows behavior
need platform deployment verification. Automated fixtures exercise executable
arguments and process outcomes, not a real desktop notification center.

Before spawning a native command, the service fsyncs a durable `intent`. A
successful exit records `submitted`. An executable that cannot be started
records `not_submitted`. A started failure, signal, timeout, interruption or
missing completion receipt records `uncertain`. Restart converts leftover
intents to uncertainty. These keys are never automatically submitted again,
including `not_submitted` keys: inspect failures explicitly. Uncertainty on one
key does not prevent unrelated new attention from being recorded. There is no
exactly-once OS delivery claim and no automatic conversion to human seen status.

An exclusive journal lock prevents two daemon writers. Delivered SIGINT/SIGTERM
signals abort an in-flight command conservatively, close the broker client and
release the lock. Windows process termination can bypass those handlers; a
forced stop or SIGKILL retains the standard writer lease. Restart refuses until
its 60-second stale interval has elapsed. Crash fixtures advance only a confirmed
dead process's lock age to exercise recovery without waiting that interval.
Never remove a lock while its owner may still be running.

The daemon's native-process fixture is platform-specific: Unix runs a private
Node shebang executable, while Windows compiles a temporary .NET console
executable that records the same fixed notification arguments and returns a
controlled exit classification. This avoids pretending that Windows executes
Unix shebang files. The Windows fixture exercises the daemon with an actual
Windows child process, not the Windows notification center. Forced-stop tests
also do not prove graceful Windows console-signal delivery.

Broker read/transport failures create a durable connectivity attention episode
and submit the same fixed native notification. Repeated offline polls and daemon
restarts preserve that episode without repeat submission, including when its
native outcome is uncertain. Only an authenticated, successful bounded broker
poll clears the episode; a later outage may create a new one. Connectivity
alarms are local observations, not broker incidents or recovery evidence.
Old version-1 journals gain a default empty connectivity condition while retaining
every previous delivery key and converting unfinished intents to uncertainty.

Connection upgrade refusal (HTTP 401/403) or a non-operator authenticated session
submits connectivity attention and prints the fixed `admission_refused` status,
then stops with failure. Inspect credentials, operator permission and broker
admission limits before restarting. HTTP 401 can also indicate a broker admission
limit or fault; it is not proof that a credential is invalid. Transient broker
read/transport failures retry at the configured interval. Exception bodies and
credentials are never printed or included in native notifications. Exact event IDs
remain deduplicated after reconnection and process restart. Each poll reads at
most four inbox pages, storage status and two health pages. Inbox cursors rotate
past already-submitted pending IDs; restarting safely rescans from zero. Health
attention uses complete bounded scans, so a large roster can take multiple
polls. These are observational scans, not an atomic native resource census.
Storage/health state changes create attention episodes; returning to healthy
allows a later recurrence to create a new episode.

The journal is bounded to 8192 records and 3 MiB; a configured lower record limit
can stop it earlier. Reaching a limit stops the service before another native
submission. It never drops old IDs, clears uncertainty or silently rotates a
journal. Disk/write errors also stop delivery. Preserve the journal during
restart; deleting it may cause pending IDs to be submitted again. Reusing it for
another broker URL, channel or credential-file path is refused.

`node src/operator-attention.js status /absolute/private/config.json` returns
bounded counts through a private snapshot read, including while the daemon holds
its writer lock. It does not mutate in-flight intents or write the journal.
`humanAcknowledged` remains false. Operator inbox acknowledgement
is a separate existing action; acknowledgement is not incident resolution.

Reviewable per-user launchd, systemd and Task Scheduler artifacts and explicit
operator lifecycle commands are documented in [operator-attention-supervisors.md](operator-attention-supervisors.md).
