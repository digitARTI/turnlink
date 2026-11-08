import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCodexVMProvision } from '../src/codex-vm-provision-dry-run.js';

const proposal = { role: '_turnlinkvm', group: '_turnlinkvm', uid: 480, gid: 480, label: 'org.turnlink.vm-proof' };
const absent = () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; };
function runner({ collision = false, failSearch = false, service = 'absent', signers = 0 } = {}) {
  return (cmd, args) => {
    if (cmd === '/usr/bin/dscl') {
      if (failSearch && args[0] === '/Search') return { status: 1, stdout: '' };
      return { status: 0, stdout: collision ? '_other 480\n' : '_other 300\nnobody -2\n' };
    }
    if (cmd === '/bin/launchctl') return service === 'absent' ? { status: 113, stderr: `Could not find service "${proposal.label}" in domain for system` } :
      service === 'occupied' ? { status: 0 } : { status: 1, stderr: 'permission denied' };
    if (cmd === '/usr/bin/security') return { status: 0, stdout: `${signers} valid identities found\n` };
    if (cmd === '/usr/bin/codesign') return { status: 0 };
    throw new Error(`unexpected command ${cmd}`);
  };
}
test('dry-run reports read-only preflight and never declares installation ready', () => {
  const report = inspectCodexVMProvision(proposal, { run: runner(), stat: absent });
  assert.equal(report.dryRun, true); assert.equal(report.readyToInstall, false);
  for (const name of ['localUsers', 'searchUsers', 'localGroups', 'searchGroups', 'service', 'serviceRoot', 'plist']) assert.equal(report.checks[name], 'absent');
  assert.equal(report.checks.signingIdentities, 'none'); assert.ok(report.blockers.length >= 4);
});
test('collisions, denied lookups and existing paths never appear absent', () => {
  const collision = inspectCodexVMProvision(proposal, { run: runner({ collision: true, service: 'occupied' }), stat: () => ({}) });
  assert.equal(collision.checks.localUsers, 'occupied'); assert.equal(collision.checks.searchGroups, 'occupied');
  assert.equal(collision.checks.service, 'occupied'); assert.equal(collision.checks.serviceRoot, 'occupied');
  const unknown = inspectCodexVMProvision(proposal, { run: runner({ failSearch: true, service: 'error' }), stat: () => { throw new Error('denied'); } });
  assert.equal(unknown.checks.searchUsers, 'unknown'); assert.equal(unknown.checks.service, 'unknown'); assert.equal(unknown.checks.plist, 'unknown');
  assert.equal(unknown.readyToInstall, false);
});
test('rejects unsafe proposal values and never treats a signature as approved', () => {
  assert.throws(() => inspectCodexVMProvision({ ...proposal, label: 'x;touch /tmp/no' }, { run: runner(), stat: absent }));
  assert.throws(() => inspectCodexVMProvision({ ...proposal, uid: 501 }, { run: runner(), stat: absent }));
  const report = inspectCodexVMProvision({ ...proposal, supervisor: '/tmp/review-only' }, { run: runner({ signers: 1 }), stat: absent });
  assert.equal(report.checks.supervisorSignature, 'valid-unverified-identity'); assert.equal(report.checks.signingIdentities, 'available-unverified');
  assert.equal(report.readyToInstall, false);
});

test('dry-run checks exact signed identities, runtime and virtualization entitlement without authorizing install', () => {
  const calls = [];
  const run = (program, args, input) => {
    calls.push({ program, args, input });
    if (program === '/usr/bin/codesign' && args[0] === '--display' && args[1] === '--verbose=4')
      return { status: 0, stderr: 'CodeDirectory flags=0x10000(runtime)' };
    if (program === '/usr/bin/codesign' && args[0] === '--display') return { status: 0, stdout: '<plist>fixture</plist>' };
    if (program === '/usr/bin/plutil') return { status: 0, stdout: '{\"com.apple.security.virtualization\":true}' };
    return runner()(program, args);
  };
  const review = { ...proposal, supervisor: '/tmp/service', client: '/tmp/client', team: 'ABCDE12345',
    clientIdentifier: 'org.turnlink.client', supervisorIdentifier: 'org.turnlink.service' };
  const report = inspectCodexVMProvision(review, { run, stat: absent });
  for (const key of ['clientRequirement', 'supervisorRequirement']) assert.equal(report.checks[key], 'matched');
  for (const key of ['clientHardenedRuntime', 'supervisorHardenedRuntime', 'supervisorVirtualizationEntitlement']) assert.equal(report.checks[key], 'present');
  assert.equal(report.readyToInstall, false);
  assert.deepEqual(report.identityReview, { client: review.client, supervisor: review.supervisor, team: review.team,
    clientIdentifier: review.clientIdentifier, supervisorIdentifier: review.supervisorIdentifier });
  const requirementCalls = calls.filter(call => call.args.some(arg => arg.startsWith('-R=')));
  assert.equal(requirementCalls.length, 2);
  assert.ok(requirementCalls.some(call => call.args.includes('-R=anchor apple generic and identifier "org.turnlink.client" and certificate leaf[subject.OU] = "ABCDE12345"')));
  assert.throws(() => inspectCodexVMProvision({ ...review, clientIdentifier: 'bad" or true' }, { run, stat: absent }));
  assert.throws(() => inspectCodexVMProvision({ ...review, team: undefined }, { run, stat: absent }));
});

test('unmatched identities or missing signature details never pass review checks', () => {
  const run = (program, args) => program === '/usr/bin/codesign' ? { status: 1, stderr: 'not valid' } : runner()(program, args);
  const result = inspectCodexVMProvision({ ...proposal, supervisor: '/tmp/service', client: '/tmp/client', team: 'ABCDE12345',
    clientIdentifier: 'org.turnlink.client', supervisorIdentifier: 'org.turnlink.service' }, { run, stat: absent });
  assert.equal(result.checks.clientRequirement, 'not-matched-or-unknown');
  assert.equal(result.checks.supervisorHardenedRuntime, 'absent-or-unknown');
  assert.equal(result.checks.supervisorVirtualizationEntitlement, 'absent-or-unknown');
  assert.equal(result.readyToInstall, false);
});

test('broker identity and unsafe runtime entitlements are separately reported', () => {
  const run = (program, args, input) => {
    if (program === '/usr/bin/codesign' && args[0] === '--display' && args[1] === '--verbose=4') return { status: 0, stderr: 'flags=0x10000(runtime)' };
    if (program === '/usr/bin/codesign' && args[0] === '--display') return { status: 0, stdout: args.at(-1) === '/tmp/broker' ? 'broker-entitlements' : 'vm-entitlements' };
    if (program === '/usr/bin/plutil') return { status: 0, stdout: input === 'broker-entitlements' ?
      JSON.stringify({ 'com.apple.security.cs.allow-jit': true, 'com.apple.security.cs.allow-unsigned-executable-memory': true,
        'com.apple.security.get-task-allow': true }) : JSON.stringify({ 'com.apple.security.virtualization': true }) };
    return runner()(program, args);
  };
  const result = inspectCodexVMProvision({ ...proposal, supervisor: '/tmp/service', client: '/tmp/client', broker: '/tmp/broker', team: 'ABCDE12345',
    clientIdentifier: 'org.turnlink.client', supervisorIdentifier: 'org.turnlink.service', brokerIdentifier: 'org.turnlink.broker' }, { run, stat: absent });
  assert.equal(result.checks.brokerRequirement, 'matched'); assert.equal(result.checks.brokerHardenedRuntime, 'present');
  assert.equal(result.checks.brokerJITEntitlement, 'present'); assert.equal(result.checks.brokerUnsignedMemoryEntitlement, 'present-review-required');
  assert.equal(result.checks.brokerUnsafeEntitlements, 'present'); assert.equal(result.readyToInstall, false);
});
