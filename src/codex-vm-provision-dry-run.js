#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// This utility never creates users, changes files, invokes sudo or installs a
// service. A successful preflight is not authorization to provision or proof
// that the proposed supervisor can safely execute effects.
const invalid = () => new Error('CODEX_VM_DRY_RUN_UNAVAILABLE');
const call = (program, args, input) => spawnSync(program, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, input,
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' } });
const isAbsent = (path, stat) => {
  try { stat(path); return 'occupied'; }
  catch (error) { return error.code === 'ENOENT' ? 'absent' : 'unknown'; }
};
function directoryListing(result, name, id) {
  if (result?.status !== 0 || result.error || typeof result.stdout !== 'string') return 'unknown';
  // macOS also lists negative system IDs (for example nobody=-2).
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(line => line.match(/^(\S+)\s+(-?\d+)\s*$/));
  if (!rows.length || rows.some(row => !row)) return 'unknown';
  return rows.some(row => row[1] === name || Number(row[2]) === id) ? 'occupied' : 'absent';
}

export function inspectCodexVMProvision({ role, group, uid, gid, label, supervisor, client, team, clientIdentifier, supervisorIdentifier, broker, brokerIdentifier }, { run = call, stat = lstatSync } = {}) {
  if (!/^_[a-z][a-z0-9_]{0,24}$/.test(role || '') || !/^_[a-z][a-z0-9_]{0,24}$/.test(group || '') ||
      !Number.isSafeInteger(uid) || uid < 450 || uid > 499 || !Number.isSafeInteger(gid) || gid < 1 || gid > 2147483647 ||
      !/^org\.turnlink\.[a-z0-9-]{1,48}$/.test(label || '') || (supervisor !== undefined && !isAbsolute(supervisor)) ||
      (client !== undefined && !isAbsolute(client)) || (broker !== undefined && !isAbsolute(broker))) throw invalid();
  const review = [client, team, clientIdentifier, supervisorIdentifier];
  if (review.some(value => value !== undefined) && (!supervisor || review.some(value => !value) ||
      !/^[A-Z0-9]{10}$/.test(team) || !/^[A-Za-z0-9.-]{1,200}$/.test(clientIdentifier) ||
      !/^[A-Za-z0-9.-]{1,200}$/.test(supervisorIdentifier))) throw invalid();
  if ((broker !== undefined || brokerIdentifier !== undefined) && (!client || !broker || !brokerIdentifier ||
      !/^[A-Za-z0-9.-]{1,200}$/.test(brokerIdentifier))) throw invalid();
  const lists = [['localUsers', '.', '/Users', 'UniqueID', role, uid], ['searchUsers', '/Search', '/Users', 'UniqueID', role, uid],
    ['localGroups', '.', '/Groups', 'PrimaryGroupID', group, gid], ['searchGroups', '/Search', '/Groups', 'PrimaryGroupID', group, gid]];
  const checks = {};
  for (const [key, node, record, attribute, name, id] of lists) checks[key] = directoryListing(run('/usr/bin/dscl', [node, '-list', record, attribute]), name, id);
  const service = run('/bin/launchctl', ['print', `system/${label}`]);
  checks.service = service?.status === 0 ? 'occupied' : service?.status === 113 &&
    `${service.stdout || ''}\n${service.stderr || ''}`.includes(`Could not find service "${label}"`) ? 'absent' : 'unknown';
  checks.serviceRoot = isAbsent('/private/var/turnlink-vm-proof', stat);
  checks.plist = isAbsent(`/Library/LaunchDaemons/${label}.plist`, stat);
  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  const count = identities?.status === 0 && typeof identities.stdout === 'string' ? identities.stdout.match(/\b(\d+) valid identities found\b/) : null;
  checks.signingIdentities = count ? (Number(count[1]) > 0 ? 'available-unverified' : 'none') : 'unknown';
  if (supervisor) {
    const verification = run('/usr/bin/codesign', ['--verify', '--strict', supervisor]);
    checks.supervisorSignature = verification?.status === 0 && !verification.error ? 'valid-unverified-identity' : 'invalid-or-unknown';
  } else checks.supervisorSignature = 'not-provided';
  if (client) {
    const requirement = identifier => `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${team}"`;
    const signed = [['client', client, clientIdentifier], ['supervisor', supervisor, supervisorIdentifier],
      ...(broker ? [['broker', broker, brokerIdentifier]] : [])];
    for (const [key, path, identifier] of signed) {
      const verified = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement(identifier)}`, path]);
      checks[`${key}Requirement`] = verified?.status === 0 && !verified.error ? 'matched' : 'not-matched-or-unknown';
      const detail = run('/usr/bin/codesign', ['--display', '--verbose=4', path]);
      const output = `${detail?.stdout || ''}\n${detail?.stderr || ''}`;
      checks[`${key}HardenedRuntime`] = detail?.status === 0 && /flags=0x[0-9a-f]+\([^)]*\bruntime\b/i.test(output) ? 'present' : 'absent-or-unknown';
    }
    const entitlements = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', supervisor]);
    const xml = entitlements?.status === 0 && typeof entitlements.stdout === 'string' ? entitlements.stdout : '';
    const entitlement = xml ? run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], xml) : null;
    let virtualization = false;
    try { virtualization = entitlement?.status === 0 && JSON.parse(entitlement.stdout)?.['com.apple.security.virtualization'] === true; } catch { /* unknown */ }
    checks.supervisorVirtualizationEntitlement = virtualization ? 'present' : 'absent-or-unknown';
    if (broker) {
      const signedEntitlements = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', broker]);
      const plist = signedEntitlements?.status === 0 && typeof signedEntitlements.stdout === 'string' ? signedEntitlements.stdout : '';
      const converted = plist ? run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], plist) : null;
      let parsed; try { if (converted?.status === 0) parsed = JSON.parse(converted.stdout); } catch { /* unknown */ }
      checks.brokerJITEntitlement = parsed?.['com.apple.security.cs.allow-jit'] === true ? 'present' : 'absent-or-unknown';
      checks.brokerUnsignedMemoryEntitlement = parsed ? (parsed['com.apple.security.cs.allow-unsigned-executable-memory'] === true ? 'present-review-required' : 'absent') : 'unknown';
      checks.brokerUnsafeEntitlements = parsed ? (['com.apple.security.get-task-allow', 'com.apple.security.cs.allow-dyld-environment-variables',
        'com.apple.security.cs.disable-library-validation', 'com.apple.security.cs.disable-executable-page-protection'].some(key => parsed[key] === true) ? 'present' : 'absent') : 'unknown';
    } else checks.brokerRequirement = checks.brokerHardenedRuntime = checks.brokerJITEntitlement = checks.brokerUnsignedMemoryEntitlement = checks.brokerUnsafeEntitlements = 'not-provided';
  } else {
    checks.clientRequirement = checks.supervisorRequirement = checks.clientHardenedRuntime = checks.supervisorHardenedRuntime = checks.supervisorVirtualizationEntitlement = checks.brokerRequirement = checks.brokerHardenedRuntime = checks.brokerJITEntitlement = checks.brokerUnsignedMemoryEntitlement = checks.brokerUnsafeEntitlements = 'not-provided';
  }
  return { dryRun: true, role, group, uid, gid, label,
    ...(client ? { identityReview: { client, supervisor, team, clientIdentifier, supervisorIdentifier, ...(broker ? { broker, brokerIdentifier } : {}) } } : {}), checks, readyToInstall: false,
    blockers: ['The supervisor is review-only: VM control, effect dispatch and recovery are not implemented for production.',
      'The actual service and client signatures, their identity requirements and entitlement must be reviewed.',
      'Two-UID access, existing Desktop writers, inherited descriptors and crash recovery remain unverified.',
      'Directory ancestors, ACLs, effective authorization and concurrency must be independently verified immediately before provisioning.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 10 || args.length > 24 || args.length % 2 !== 0) throw invalid();
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]; if (!['--role', '--group', '--uid', '--gid', '--label', '--supervisor', '--client', '--team', '--client-identifier', '--supervisor-identifier', '--broker', '--broker-identifier'].includes(key) || values[key] !== undefined) throw invalid();
      values[key] = args[i + 1];
    }
    if (!/^[0-9]+$/.test(values['--uid'] || '') || !/^[0-9]+$/.test(values['--gid'] || '')) throw invalid();
    const result = inspectCodexVMProvision({ role: values['--role'], group: values['--group'], uid: Number(values['--uid']),
      gid: Number(values['--gid']), label: values['--label'], supervisor: values['--supervisor'], client: values['--client'],
      team: values['--team'], clientIdentifier: values['--client-identifier'], supervisorIdentifier: values['--supervisor-identifier'],
      broker: values['--broker'], brokerIdentifier: values['--broker-identifier'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch { console.error('Turnlink: VM provisioning dry-run unavailable'); process.exitCode = 1; }
}
