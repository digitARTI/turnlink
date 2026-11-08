#!/usr/bin/env node
import { z } from 'zod';
import { posix, win32, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivate } from '../src/storage.js';

const pathText = z.string().min(1).max(4096).refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const Input = z.strictObject({ platform: z.enum(['darwin', 'linux', 'win32']), nodeExecutable: pathText,
  attentionScript: pathText, configFile: pathText, startAtLogin: z.boolean().default(false),
  userSID: z.string().regex(/^S-1-\d+(?:-\d+){2,14}$/).optional() }).superRefine((value, context) => {
  const windows = value.platform === 'win32';
  for (const key of ['nodeExecutable', 'attentionScript', 'configFile']) {
    const path = value[key];
    if (!(windows ? /^[a-z]:[\\/]/i.test(path) && win32.isAbsolute(path) && !/["%*?<>|]/.test(path) : posix.isAbsolute(path)))
      context.addIssue({ code: 'custom', path: [key], message: 'An explicit absolute literal path is required' });
  }
  // systemd validates the executable before argument expansion; quoting cannot
  // make quotes/backslashes legal there, and dollars are already literal.
  if (value.platform === 'linux' && (/["'\\]/.test(value.nodeExecutable) || value.nodeExecutable.endsWith('/')))
    context.addIssue({ code: 'custom', path: ['nodeExecutable'], message: 'The systemd executable path must not contain quotes or backslashes or end in a slash' });
  if (windows !== !!value.userSID) context.addIssue({ code: 'custom', path: ['userSID'], message: 'Only Windows requires an explicit interactive user SID' });
});
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const systemdArgument = (value, executable = false) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => executable ? '$' : '$$') + '"';
const windowsArgument = value => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';

// Rendering only: this module never contacts a supervisor, executes a target, installs a file, or reads a token.
export function renderAttentionSupervisor(input) {
  const value = Input.parse(input), args = [value.nodeExecutable, value.attentionScript, 'run', value.configFile];
  if (value.platform === 'darwin') return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.turnlink.operator-attention</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><${value.startAtLogin}/>
<key>KeepAlive</key><false/>
<key>Umask</key><integer>63</integer>
<key>ExitTimeOut</key><integer>35</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;
  if (value.platform === 'linux') return `[Unit]
Description=Turnlink operator attention (current user)

[Service]
Type=exec
ExecStart=${args.map((arg, index) => systemdArgument(arg, index === 0)).join(' ')}
Restart=no
UMask=0077
NoNewPrivileges=yes
TimeoutStopSec=35
KillMode=control-group
StandardOutput=journal
StandardError=journal
${value.startAtLogin ? '\n[Install]\nWantedBy=default.target\n' : ''}`;
  const trigger = value.startAtLogin ? `<LogonTrigger><Enabled>true</Enabled><UserId>${xml(value.userSID)}</UserId></LogonTrigger>` : '';
  return `<?xml version="1.0"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Turnlink operator attention; inspect private journal before restarting.</Description></RegistrationInfo>
<Triggers>${trigger}</Triggers>
<Principals><Principal id="Operator"><UserId>${xml(value.userSID)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><WakeToRun>false</WakeToRun><Enabled>${value.startAtLogin}</Enabled><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
<Actions Context="Operator"><Exec><Command>${xml(value.nodeExecutable)}</Command><Arguments>${xml(args.slice(1).map(windowsArgument).join(' '))}</Arguments></Exec></Actions>
</Task>
`;
}
function main() {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || !isAbsolute(file) || extra.length) throw new Error('ATTENTION_SUPERVISOR_USAGE');
  process.stdout.write(renderAttentionSupervisor(JSON.parse(readPrivate(file, 16384))));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch { console.error('Turnlink attention supervisor generation refused; inspect the private input and explicit target paths.'); process.exitCode = 1; }
}
