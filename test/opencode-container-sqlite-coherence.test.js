import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('Docker Desktop SQLite WAL visibility across the host/container boundary',
  { skip: process.env.OPENCODE_DOCKER_SQLITE_TEST !== '1', timeout: 30000 }, async t => {
    const directory = mkdtempSync('/private/tmp/turnlink-sqlite-coherence-'), file = join(directory, 'fixture.sqlite');
    const db = new DatabaseSync(file); let docker;
    t.after(() => { db.close(); docker?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
    const hostMode = db.prepare('PRAGMA journal_mode=WAL').get();
    db.exec("CREATE TABLE probe(value TEXT NOT NULL); INSERT INTO probe VALUES ('before');");
    const metadata = () => { const stat = statSync(file, { bigint: true }); const wal = `${file}-wal`;
      return { device: String(stat.dev), inode: String(stat.ino), walBytes: existsSync(wal) ? statSync(wal).size : 0 }; };
    const before = metadata();
    const script = `import {Database} from 'bun:sqlite'; import {statSync,existsSync} from 'node:fs';
      const file='/db/fixture.sqlite',db=new Database(file);const mode=db.query('PRAGMA journal_mode').get();
      const stat=statSync(file,{bigint:true});db.query("UPDATE probe SET value='after'").run();
      const wal=file+'-wal';console.log(JSON.stringify({mode,device:String(stat.dev),inode:String(stat.ino),walBytes:existsSync(wal)?statSync(wal).size:0,value:db.query('SELECT value FROM probe').get().value}));
      process.stdin.once('data',()=>{db.close();process.exit(0)});process.stdin.resume();`;
    docker = spawn('/opt/homebrew/bin/docker', ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--mount', `type=bind,src=${directory},dst=/db`, '-i', 'turnlink-opencode-runtime-test:node24-bun142', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = ''; docker.stdout.on('data', data => { output += data; }); docker.stderr.on('data', data => { errors += data; });
    for (let i = 0; i < 100 && !output.includes('\n'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    const container = JSON.parse(output.trim()), hostLive = db.prepare('SELECT value FROM probe').get().value, live = metadata();
    docker.stdin.end('close'); const [code] = await once(docker, 'close'); assert.equal(code, 0, errors);
    const host = db.prepare('SELECT value FROM probe').get().value, after = metadata();
    t.diagnostic(`host mode=${JSON.stringify(hostMode)} before=${JSON.stringify(before)} live=${JSON.stringify(live)} after=${JSON.stringify(after)}; container=${JSON.stringify(container)}; hostLive=${hostLive}; hostAfter=${host}`);
    assert.equal(container.value, 'after');
    assert.equal(hostLive, 'after', 'host must see the container commit while both SQLite connections remain open');
    assert.equal(host, 'after');
  });

test('Docker Desktop SQLite rejects a container writer while the host holds the write lock',
  { skip: process.env.OPENCODE_DOCKER_SQLITE_TEST !== '1', timeout: 30000 }, async t => {
    const directory = mkdtempSync('/private/tmp/turnlink-sqlite-lock-'), file = join(directory, 'fixture.sqlite');
    const db = new DatabaseSync(file); let docker;
    t.after(() => { try { db.exec('ROLLBACK'); } catch {} db.close(); docker?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT NOT NULL); INSERT INTO probe VALUES ('before'); BEGIN IMMEDIATE; UPDATE probe SET value='host';");
    assert.equal(db.isTransaction, true);
    const script = `import {Database} from 'bun:sqlite';const db=new Database('/db/fixture.sqlite');db.exec('PRAGMA busy_timeout=500');
      try{db.query("UPDATE probe SET value='container'").run();console.log('unexpected-write')}catch(e){console.log('blocked:'+e.code)}db.close();`;
    docker = spawn('/opt/homebrew/bin/docker', ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--mount', `type=bind,src=${directory},dst=/db`, 'turnlink-opencode-runtime-test:node24-bun142', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; docker.stdout.on('data', data => { output += data; }); docker.stderr.on('data', data => { errors += data; });
    const [code] = await once(docker, 'close'); assert.equal(code, 0, errors);
    assert.equal(db.isTransaction, true);
    assert.match(output.trim(), /^blocked:SQLITE_BUSY/, 'container writer must not bypass the live host write lock');
    assert.equal(db.prepare('SELECT value FROM probe').get().value, 'host');
  });
