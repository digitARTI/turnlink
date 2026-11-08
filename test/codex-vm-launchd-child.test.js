import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';

test('characterizes a launchd user-domain child attempting Mach check-in',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_LAUNCHD_USER_PROBE !== '1', timeout: 60000 }, async t => {
    const uid = process.getuid(), label = `org.turnlink.fd-probe-${randomUUID().replaceAll('-', '')}`;
    const domain = `gui/${uid}`, target = `${domain}/${label}`, root = privateTemp('/private/tmp/tl-launchd-probe-');
    const plist = join(root, 'job.plist'), launcher = join(root, 'launcher.cjs'), log = join(root, 'events.log');
    const bridge = join(root, 'bridge'), probe = join(root, 'probe'); let registered = false, safeToRemove = false; const pids = new Set();
    const run = (command, args, timeout = 15000) => spawnSync(command, args, { encoding: 'utf8', timeout });
    const must = (command, args) => { const out = run(command, args); assert.equal(out.status, 0, out.stderr || out.stdout); return out.stdout; };
    t.after(async () => {
      if (registered) {
        const current = (run('/bin/launchctl', ['print', target]).stdout || '').match(/\bpid = ([1-9][0-9]*)/);
        if (current) pids.add(Number(current[1]));
        if (existsSync(log)) { const child = readFileSync(log, 'utf8').match(/CHILD ([1-9][0-9]*)/); if (child) pids.add(Number(child[1])); }
        const result = run('/bin/launchctl', ['bootout', target]);
        if (result.status !== 0) { t.diagnostic(`retained fixture ${root}: bootout failed`); return; }
        for (let i = 0; i < 100; i++) { if (run('/bin/launchctl', ['print', target]).status !== 0) { safeToRemove = true; break; } await delay(100); }
      } else safeToRemove = true;
      if (safeToRemove) {
        for (let i = 0; i < 100 && pids.size; i++) {
          for (const pid of [...pids]) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') pids.delete(pid); else throw error; } }
          if (pids.size) await delay(100);
        }
        if (pids.size) safeToRemove = false;
      }
      if (safeToRemove) rmSync(root, { recursive: true, force: true });
      else t.diagnostic(`retained fixture ${root}: process or service termination unverified`);
    });
    const before = run('/bin/launchctl', ['print', target]); assert.notEqual(before.status, 0, 'random label already exists');
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=0',
      '-DTURNLINK_BRIDGE_LAUNCHD_TEST=1', '-DTURNLINK_BROKER_LEASE_USER_DOMAIN_TEST=1', `-DTURNLINK_BRIDGE_EXPECTED_UID=${uid}`,
      define('TURNLINK_BRIDGE_SERVICE_NAME', label), define('TURNLINK_BRIDGE_CLIENT_IDENTIFIER', 'org.turnlink.vmfixture.client'),
      define('TURNLINK_BRIDGE_CLIENT_TEAM', 'ABCDE12345'), define('TURNLINK_BROKER_LEASE_SERVICE', label),
      define('TURNLINK_BROKER_LEASE_IDENTIFIER', 'org.turnlink.bridge.fixture'), define('TURNLINK_BROKER_LEASE_TEAM', 'ABCDE12345')];
    must('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/protected-broker-bridge.m'), '-o', bridge]);
    must('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-client.m'),
      resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', probe]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.bridge.fixture', bridge]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.vmfixture.client', probe]);
    const script = `const fs=require('node:fs'),{spawn}=require('node:child_process');
const p=spawn(${JSON.stringify(bridge)},[],{stdio:['ignore','ignore','pipe','pipe']});
fs.appendFileSync(${JSON.stringify(log)},'CHILD '+p.pid+'\\n'); p.stderr.on('data',c=>fs.appendFileSync(${JSON.stringify(log)},'ERR '+c)); let b='';
p.stdio[3].setEncoding('utf8');p.stdio[3].on('data',c=>{b+=c;for(;;){let n=b.indexOf('\\n');if(n<0)break;let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.type==='subscribe'){fs.appendFileSync(${JSON.stringify(log)},'SUBSCRIBE\\n');p.stdio[3].write(JSON.stringify({type:'refused',id:m.id})+'\\n')}}});
p.stdio[3].on('error',()=>{});const t=setInterval(()=>p.stdio[3].write(JSON.stringify({type:'heartbeat',id:'00000000-0000-0000-0000-000000000000'})+'\\n'),1000);p.on('exit',(code,sig)=>{fs.appendFileSync(${JSON.stringify(log)},'EXIT '+code+' '+sig+'\\n');clearInterval(t);process.exit(1)});
process.on('SIGTERM',()=>{p.kill('SIGTERM');process.exit(0)});`;
    writeFileSync(launcher, script, { mode: 0o600 });
    const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    writeFileSync(plist, `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(launcher)}</string></array><key>RunAtLoad</key><true/><key>MachServices</key><dict><key>${label}</key><true/></dict></dict></plist>`, { mode: 0o600 });
    must('/usr/bin/plutil', ['-lint', plist]);
    must('/bin/launchctl', ['bootstrap', domain, plist]); registered = true;
    for (let i = 0; i < 100 && (!existsSync(log) || !readFileSync(log, 'utf8').includes('CHILD ')); i++) await delay(100);
    assert.ok(existsSync(log), 'temporary launchd job did not start');
    const serviceState = run('/bin/launchctl', ['print', target]);
    const jobPID = (serviceState.stdout || '').match(/\bpid = ([1-9][0-9]*)/); if (jobPID) pids.add(Number(jobPID[1]));
    const childPID = readFileSync(log, 'utf8').match(/CHILD ([1-9][0-9]*)/); if (childPID) pids.add(Number(childPID[1]));
    t.diagnostic(`fixture launchd: ${(serviceState.stdout || '').split('\n').filter(line => /state =|pid =|endpoints|MachServices|service name/.test(line)).join('; ')}`);
    const response = run('/bin/launchctl', ['asuser', String(uid), probe, 'hold']);
    assert.equal(response.status, 3, response.stderr || response.stdout);
    const events = readFileSync(log, 'utf8');
    // A refusal is expected either way; only receipt at the inherited fd
    // establishes that this OS allowed child check-in. Report, do not infer it.
    t.diagnostic(`child-check-in-request-delivered=${events.includes('SUBSCRIBE')}`);
  });

test('a launchd user-domain main process checks in the same temporary Mach service',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_LAUNCHD_USER_PROBE !== '1', timeout: 60000 }, async t => {
    const uid = process.getuid(), label = `org.turnlink.fd-control-${randomUUID().replaceAll('-', '')}`;
    const domain = `gui/${uid}`, target = `${domain}/${label}`, root = privateTemp('/private/tmp/tl-launchd-control-');
    const plist = join(root, 'job.plist'), log = join(root, 'events.log'), service = join(root, 'service'), probe = join(root, 'probe');
    let registered = false;
    const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
    const must = (command, args) => { const out = run(command, args); assert.equal(out.status, 0, out.stderr || out.stdout); return out.stdout; };
    t.after(async () => {
      if (registered) { const current = (run('/bin/launchctl', ['print', target]).stdout || '').match(/\bpid = ([1-9][0-9]*)/);
        const pid = current && Number(current[1]);
        const result = run('/bin/launchctl', ['bootout', target]); if (result.status !== 0) { t.diagnostic(`retained fixture ${root}: bootout failed`); return; }
        for (let i = 0; i < 100 && run('/bin/launchctl', ['print', target]).status === 0; i++) await delay(100);
        if (run('/bin/launchctl', ['print', target]).status === 0) { t.diagnostic(`retained fixture ${root}: service termination unverified`); return; }
        if (pid) { let alive = true; for (let i = 0; i < 100 && alive; i++) { try { process.kill(pid, 0); await delay(100); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; } }
          if (alive) { t.diagnostic(`retained fixture ${root}: process termination unverified`); return; } } }
      rmSync(root, { recursive: true, force: true });
    });
    assert.notEqual(run('/bin/launchctl', ['print', target]).status, 0);
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=0',
      '-DTURNLINK_BROKER_LEASE_USER_DOMAIN_TEST=1', define('TURNLINK_BRIDGE_SERVICE_NAME', label), define('TURNLINK_FIXTURE_LOG', log),
      define('TURNLINK_BROKER_LEASE_SERVICE', label), define('TURNLINK_BROKER_LEASE_IDENTIFIER', 'org.turnlink.bridge.fixture'),
      define('TURNLINK_BROKER_LEASE_TEAM', 'ABCDE12345')];
    must('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/launchd-direct.m'), '-o', service]);
    must('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-client.m'), resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', probe]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.bridge.fixture', service]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.vmfixture.client', probe]);
    writeFileSync(plist, `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${service}</string></array><key>MachServices</key><dict><key>${label}</key><true/></dict></dict></plist>`, { mode: 0o600 });
    must('/usr/bin/plutil', ['-lint', plist]); must('/bin/launchctl', ['bootstrap', domain, plist]); registered = true;
    const response = run('/bin/launchctl', ['asuser', String(uid), probe, 'hold']); assert.equal(response.status, 3, response.stderr || response.stdout);
    assert.ok(existsSync(log)); assert.match(readFileSync(log, 'utf8'), /SUBSCRIBE/);
  });
