import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile), docker = '/opt/homebrew/bin/docker';

test('SQLite in a Docker volume fences another container and recovers after SIGKILL',
  { skip: process.env.OPENCODE_DOCKER_SQLITE_TEST !== '1', timeout: 30000 }, async t => {
    const id = randomUUID(), volume = `turnlink-sqlite-${id}`, owner = `turnlink-sqlite-owner-${id}`;
    const image = 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    const command = args => exec(docker, args, { encoding: 'utf8', timeout: 12000 });
    await command(['volume', 'create', '--label', `org.turnlink.test=${id}`, volume]);
    let child;
    t.after(async () => {
      child?.stdin.destroy(); child?.kill('SIGKILL');
      try { await command(['rm', '--force', owner]); } catch {}
      await command(['volume', 'rm', volume]);
    });
    const flags = ['run', '--rm', '--network=none', '--read-only', '--user=0:0', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--mount', `type=volume,src=${volume},dst=/db`, image];
    const hold = `import {Database} from 'bun:sqlite';import {statSync} from 'node:fs';const db=new Database('/db/probe.sqlite',{create:true});
      db.exec('PRAGMA journal_mode=WAL');db.exec('CREATE TABLE probe(value TEXT NOT NULL)');db.exec("INSERT INTO probe VALUES ('base')");
      db.exec('BEGIN IMMEDIATE');db.exec("UPDATE probe SET value='uncommitted'");
      const s=statSync('/db/probe.sqlite',{bigint:true});console.log('READY:'+db.inTransaction+':'+s.dev+':'+s.ino+':'+db.query('PRAGMA journal_mode').get().journal_mode);setInterval(()=>{if(!db.inTransaction)process.exit(6)},1000);process.stdin.resume();`;
    child = spawn(docker, [...flags.slice(0, 1), '--name', owner, '-i', ...flags.slice(1), '-e', hold], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
    const exit = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    for (let i = 0; i < 100 && !output.includes('\n'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(output, /READY:true/, errors);
    assert.equal((await command(['inspect', '--format', '{{.State.Running}}', owner])).stdout.trim(), 'true');
    const writer = `import {Database} from 'bun:sqlite';import {statSync} from 'node:fs';const s=statSync('/db/probe.sqlite',{bigint:true});const db=new Database('/db/probe.sqlite');db.exec('PRAGMA busy_timeout=500');
      try{db.query("UPDATE probe SET value='second'").run();console.log('write-ok:'+s.dev+':'+s.ino+':'+db.query('PRAGMA journal_mode').get().journal_mode)}catch(e){console.log('blocked:'+e.code+':'+s.dev+':'+s.ino)}db.close();`;
    const blocked = await command([...flags, '-e', writer]); assert.match(blocked.stdout.trim(), /^blocked:SQLITE_BUSY/, `holder=${output}; writer=${blocked.stdout}`);
    await command(['kill', '--signal', 'KILL', owner]); await exit;
    const resumed = await command([...flags, '-e', writer]); assert.match(resumed.stdout.trim(), /^write-ok:/);
    const read = await command([...flags, '-e', `import {Database} from 'bun:sqlite';const db=new Database('/db/probe.sqlite');console.log(db.query('SELECT value FROM probe').get().value);db.close()`]);
    assert.equal(read.stdout.trim(), 'second');
  });
