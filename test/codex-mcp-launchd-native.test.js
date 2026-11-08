import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

// This is an ownership-boundary experiment, not an MCP cleanup verifier.
for (const sandboxed of [false, true]) {
  test(`launchd MCP fixture ${sandboxed ? 'denies' : 'allows'} a separately delegated job`, {
    skip: process.platform !== 'darwin' || process.env.TURNLINK_CODEX_MCP_LAUNCHD_PROBE !== '1', timeout: 45000,
  }, async () => {
    const { stdout } = await promisify(execFile)('python3', ['test/fixtures/codex-launchd-mcp-probe.py'], {
      timeout: 30000, maxBuffer: 64 * 1024,
      env: { ...process.env, TURNLINK_EXPECT_DELEGATION_DENIED: sandboxed ? '1' : '0' },
    });
    assert.match(stdout, /MCP SDK initialization, discovery and tool calls passed/);
    assert.match(stdout, /socket peer matched fixture owner and distinct coalition/);
    assert.match(stdout, sandboxed ? /MCP fixture delegation denied/ : /delegated MCP work survived in a separate coalition/);
    assert.match(stdout, /fixture processes still visible: 0/);
  });
}
