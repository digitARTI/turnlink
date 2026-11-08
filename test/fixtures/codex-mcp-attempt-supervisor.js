import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { WorktreeTransition } from '../../src/control/contracts.js';
import { attachCodexMcpAttemptOwner } from '../../src/codex-mcp-attempt-owner.js';

// Same-UID fixture only. The production system supervisor must authenticate
// the executable, select the UID and own the other end of this descriptor.
export function launchAttemptSupervisorFixture({ executable, cwd, home, codexHome, sqliteHome, tmp, directory, owner, grant: input, effectID, resourceID, kind }) {
  if (![executable, cwd, home, codexHome, sqliteHome, tmp, directory].every(isAbsolute)) throw new Error('ATTEMPT_FIXTURE_UNAVAILABLE');
  const grant = WorktreeTransition.parse(input), scope = createHash('sha256').update(JSON.stringify(grant)).digest('hex');
  const child = spawn(executable, ['--native-continuity-control-fd', '3'], { cwd, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], env: {
    PATH: '/usr/bin:/bin', HOME: home, CODEX_HOME: codexHome, CODEX_SQLITE_HOME: sqliteHome, TMPDIR: tmp,
    TURNLINK_FIXTURE_KEY: 'local-fixture-only', TURNLINK_EXPERIMENTAL_MCP_OWNER_FD: '4', TURNLINK_EXPERIMENTAL_MCP_SCOPE: scope,
  } });
  try {
    const recorder = attachCodexMcpAttemptOwner({ stream: child.stdio[4], directory, owner, grant, effectID, resourceID, kind });
    return { child, recorder };
  } catch (error) { child.kill('SIGKILL'); throw error; }
}
