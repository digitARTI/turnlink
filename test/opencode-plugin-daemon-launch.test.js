import test from 'node:test';
import assert from 'node:assert/strict';
import { launchOpenCodeSealedPlugin, inspectOpenCodeDaemonLaunch } from '../src/opencode-plugin-daemon-launch.js';

test('daemon launcher rejects invalid endpoints and forged capabilities', () => {
  const base = { docker: '/opt/homebrew/bin/docker', name: 'turnlink-plugin-test-00000000-0000-4000-8000-000000000001',
    image: `sha256:${'a'.repeat(64)}`, sessionID: 'ses_test', directory: '/synthetic' };
  for (const endpoint of ['tcp://127.0.0.1:2375', 'unix:///no/such/socket', 'unix:///tmp?x=1'])
    assert.throws(() => launchOpenCodeSealedPlugin({ ...base, endpoint }), /PLUGIN_DAEMON_LAUNCH_UNAVAILABLE/);
  assert.throws(() => inspectOpenCodeDaemonLaunch({ child: {} }, {}), /PLUGIN_DAEMON_LAUNCH_UNAVAILABLE/);
});
