# Reviewable operator-attention supervisors

`deploy/render-attention-supervisor.js` renders a user-scoped launchd plist,
systemd unit or Task Scheduler XML document. It writes only standard output.
It never installs files, registers jobs, starts a process, changes OS settings,
reads a token, or submits a notification. Installation and startup commands below
are separate operator actions and can start real native attention delivery.

Use an existing private [attention configuration](operator-attention.md), with
an operator credential in its separate token file and a separate private journal
directory. Keep the configuration, token, rendering input and journal private:
owner-only directories (0700) and files (0600) on Unix; owner, Administrators and
SYSTEM-only ACLs on Windows. Keep the Node executable and reviewed source tree
outside peer-writable locations. The renderer validates the input and target
path syntax; it cannot verify the target machine's filesystem permissions,
credentials, desktop session, native notifier, or broker availability.

A private rendering input contains paths, not credentials:

```json
{
  "platform": "darwin",
  "nodeExecutable": "/actual/Node runtime/node",
  "attentionScript": "/actual/turnlink/src/operator-attention.js",
  "configFile": "/private/turnlink/attention-config.json",
  "startAtLogin": false
}
```

Set `platform` to `darwin`, `linux` or `win32`. Windows additionally requires the
actual interactive user's `userSID`. Paths must be absolute literals. Windows
paths containing percent variables are refused rather than allowing Task
Scheduler environment expansion. Unix argument dollar/percent characters, quotes and
backslashes are escaped for the supervisor's own parser; no shell is invoked.
Linux executable paths preserve literal dollars and escape percent specifiers;
systemd rejects executable paths containing quotes or backslashes, or ending in
a slash, so the renderer refuses those paths before producing a unit.
Unexpected fields, including credentials, are refused without echoing values.

Before installing, run the existing foreground `status` command against the
configuration and inspect its private journal. Initialize a new journal through
an explicitly authorized foreground run, not by fabricating a journal file.
An absent journal is expected before that first run. Preserve it through
supervisor changes and restarts. The renderer does not initialize credentials
or a journal.

All artifacts disable automatic process restart. The daemon already handles
transient broker outages; an admission, storage or journal failure should remain
visible for operator inspection. Login startup defaults off. Enabling it is a
separate rendering choice plus the platform's explicit installation/enabling
step. Only the fixed native attention text is used; none of these artifacts
includes collaboration text, notification IDs, credential values or model
instructions.

## macOS launchd

Render and inspect a private plist; substitute reviewed absolute paths:

```sh
umask 077
node /actual/turnlink/deploy/render-attention-supervisor.js /private/turnlink/service.json > /private/turnlink/io.turnlink.operator-attention.plist
plutil -lint /private/turnlink/io.turnlink.operator-attention.plist
```

The `ProgramArguments` array contains the exact executable, script, `run` and
configuration path. `KeepAlive` is false. `RunAtLoad` follows `startAtLogin`, so
its default does not launch when loaded. The job uses umask 077, a 35-second
stop deadline, and discards stdout/stderr rather than creating an unbounded
log file. Inspect `launchctl print` and the private journal for status.
These keys follow [Apple's launchd job guidance](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

After separate operator review, install and explicitly start in the logged-in
user's GUI domain, without `sudo`:

```sh
install -d -m 700 "$HOME/Library/LaunchAgents"
install -m 600 /private/turnlink/io.turnlink.operator-attention.plist "$HOME/Library/LaunchAgents/io.turnlink.operator-attention.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.turnlink.operator-attention.plist"
launchctl kickstart "gui/$(id -u)/io.turnlink.operator-attention"
launchctl print "gui/$(id -u)/io.turnlink.operator-attention"
```

Stop/unload before replacing the plist or removing it:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.turnlink.operator-attention.plist"
rm "$HOME/Library/LaunchAgents/io.turnlink.operator-attention.plist"
```

For login startup, render with `startAtLogin: true` before installing. That
artifact also starts when bootstrapped. No job is bootstrapped by the renderer.
Actual desktop authorization and visible banner delivery remain OS acceptance
steps.

## Linux systemd user unit

Render with `platform: "linux"` and inspect the generated unit:

```sh
umask 077
node /actual/turnlink/deploy/render-attention-supervisor.js /private/turnlink/service.json > /private/turnlink/turnlink-operator-attention.service
systemd-analyze --user verify /private/turnlink/turnlink-operator-attention.service
```

The unit uses `Type=exec` (systemd 240 or newer), so a failed executable start
is visible to the manager. It invokes Node directly, uses umask 0077 and `NoNewPrivileges=yes`, and
sets `Restart=no`. Shutdown sends SIGTERM to the process group, with a 35-second
stop deadline. Fixed metadata status lines go to the user's journal; inspect
that journal according to local retention/privacy policy. Literal dollar signs
and percent specifiers are escaped according to
[systemd's command-line rules](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Command%20lines).

Install and start only as the intended desktop user:

```sh
install -d -m 700 "$HOME/.config/systemd/user"
install -m 600 /private/turnlink/turnlink-operator-attention.service "$HOME/.config/systemd/user/turnlink-operator-attention.service"
systemctl --user daemon-reload
systemctl --user start turnlink-operator-attention.service
systemctl --user status --no-pager turnlink-operator-attention.service
```

A manual-only artifact has no `[Install]` target. To opt into login startup,
render with `startAtLogin: true`, replace the reviewed unit while stopped,
reload, then explicitly run `systemctl --user enable
turnlink-operator-attention.service`. Do not enable lingering or install a root
service merely to make notifications appear. `notify-send` and the desktop
session's notification bus must already work for this user.

Stop and remove the user unit; disable it first if previously enabled:

```sh
systemctl --user stop turnlink-operator-attention.service
systemctl --user disable turnlink-operator-attention.service
rm "$HOME/.config/systemd/user/turnlink-operator-attention.service"
systemctl --user daemon-reload
```

No Linux manager registration or desktop banner acceptance is claimed by
artifact-generation tests.

The opt-in native parser regression runs with
`TURNLINK_SYSTEMD_VERIFY=1 node --test test/attention-supervisor.test.js` on Linux
with `systemd-analyze` installed. It checks manual and login-start units against
a real executable path containing spaces, literal dollars and percent signs.
It caught doubled dollars in the executable path before the renderer fix; the
same native test passes afterward. The executable is parsed separately from
its arguments in [systemd 252's native parser](https://github.com/systemd/systemd/blob/v252/src/core/load-fragment.c#L862).
This is parsing and executable-path validation, not manager startup or desktop
notification delivery.

## Windows Task Scheduler

Use the interactive desktop user's SID and exact Node executable. In Windows
PowerShell 5.1, write UTF-8 without a BOM for the JSON input; ordinary `>`
redirection otherwise uses a different encoding. First create or verify a
private folder through the repository's existing storage helper, from the
reviewed repository directory:

```powershell
node --input-type=module -e "import {privateDirectory} from './src/storage.js'; privateDirectory(process.argv[1]);" 'C:\private-turnlink'
$serviceSpec = @{
  platform = 'win32'
  nodeExecutable = (Get-Command node.exe).Source
  attentionScript = 'C:\reviewed-turnlink\src\operator-attention.js'
  configFile = 'C:\private-turnlink\attention-config.json'
  userSID = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  startAtLogin = $false
}
$manifestPath = 'C:\private-turnlink\service.json'
$taskXmlPath = 'C:\private-turnlink\attention-task.xml'
[IO.File]::WriteAllText($manifestPath, ($serviceSpec | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$taskDefinitionXml = & node 'C:\reviewed-turnlink\deploy\render-attention-supervisor.js' $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'Supervisor rendering refused' }
[IO.File]::WriteAllText($taskXmlPath, ($taskDefinitionXml -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
```

Windows XML omits an encoding declaration so the same document can be read
from its UTF-8 file and passed as a Unicode BSTR to Task Scheduler.
The task uses `InteractiveToken`, `LeastPrivilege`, `IgnoreNew`, no network-only
or idle-only condition, no wake-from-sleep request and no automatic restart. It
has no execution-time limit because it is a foreground daemon. The default
artifact is disabled and has no triggers. These settings follow Microsoft's
[Task Scheduler XML schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema).

After separate review, register without `-Force`, so an existing task is not
overwritten. Registration of the default artifact does not start it:

```powershell
Register-ScheduledTask -TaskName 'Turnlink Operator Attention' -Xml ([IO.File]::ReadAllText($taskXmlPath))
Get-ScheduledTask -TaskName 'Turnlink Operator Attention'
Enable-ScheduledTask -TaskName 'Turnlink Operator Attention'
Start-ScheduledTask -TaskName 'Turnlink Operator Attention'
Get-ScheduledTaskInfo -TaskName 'Turnlink Operator Attention'
```

To opt into login startup, render with `startAtLogin = $true` before the
operator registers the task. That artifact is enabled and has a logon trigger
for exactly the supplied SID; it still does not run during rendering. The
separate [Windows toast identity setup](operator-attention.md) remains necessary
for actual native delivery. Task XML registration does not create a Start-menu
shortcut or authorize notification-center access.

Stop, disable and remove only the reviewed task:

```powershell
Stop-ScheduledTask -TaskName 'Turnlink Operator Attention'
Disable-ScheduledTask -TaskName 'Turnlink Operator Attention'
Unregister-ScheduledTask -TaskName 'Turnlink Operator Attention' -Confirm:$false
```

Windows task termination can bypass graceful Node signal handlers. Retain the
private journal and wait for the dead writer's 60-second lease to become stale
before restarting after a forced stop. Do not delete an active lock. These
lifecycle commands never delete credentials, configuration or native uncertainty.

## Acceptance boundary

The macOS plist is parsed by the native `plutil` tool. Generated Windows XML can
be loaded into an in-memory `Schedule.Service.NewTask` definition to validate
its native schema and recover exact action/principal settings; that native Windows test passed and never
registers or runs a task. Generation tests verify literal argument escaping,
manual-only defaults, explicit login startup and rejection of unexpected or
unsafe inputs. Rendering does not prove that any supervisor has been installed,
that a desktop session will launch it, or that a real native toast is visible.

A disposable Debian 12 Linux container with Node 24.22.1 and systemd 252.39
passed all 22 attention, supervisor and history-service cases, including the
native parser test. Its external network was disconnected before testing and
no host filesystem was mounted. This is separate from the Mac and Windows runs.
