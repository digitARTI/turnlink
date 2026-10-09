// Real Windows executable/stdio and tunneled socket test; no model is invoked.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChannelClient } from '../src/client.js';

const root = process.argv[2] || 'C:\\ProgramData\\agent-channel';
const launcherConfig = JSON.parse(readFileSync(join(root, 'bin', 'launcher.json'), 'utf8'));
const temp = join(root, 'bin', `fixture with spaces ${randomUUID()}`);
mkdirSync(temp);
copyFileSync(join(root, 'bin', 'agent-channel-codex.exe'), join(temp, 'launcher.exe'));
writeFileSync(join(temp, 'launcher.json'), JSON.stringify({ ...launcherConfig, codex: launcherConfig.node }));
const fixture = join(temp, 'fixture with spaces.cjs');
writeFileSync(fixture, `const readline = require('node:readline');
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
const m=JSON.parse(line);
if(m.method==='initialize') send({id:m.id,result:{}});
if(m.method==='thread/start') send({id:m.id,result:{thread:{id:m.params.threadId}}});
if(m.method==='turn/start') { send({id:m.id,result:{turn:{id:'test-turn'}}}); send({method:'turn/started',params:{threadId:m.params.threadId,turn:{id:'test-turn'}}}); send({method:'fixture/received',params:{method:m.method,...m.params}}); }
if(m.method==='turn/steer') { send({id:m.id,result:{turnId:'test-turn'}}); send({method:'fixture/received',params:{method:m.method,...m.params}}); }
});`);
process.env.AGENT_CHANNEL_URL = launcherConfig.url;
process.env.AGENT_CHANNEL_TOKEN_FILE = launcherConfig.tokenFile;
const channel = new ChannelClient();
const id = `windows-fixture-${randomUUID()}`;
const senderId = `${id}-sender`;
const child = spawn(join(temp, 'launcher.exe'), [fixture, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
const messages = [];
let errors = '';
child.stderr.on('data', b => { errors += b.toString(); });
createInterface({ input: child.stdout }).on('line', line => messages.push(JSON.parse(line)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(25); }
  throw new Error(`Windows protocol condition timed out: ${errors}`);
}
const send = m => child.stdin.write(`${JSON.stringify(m)}\n`);
const registration = sessionId => ({ harness: 'codex', sessionId, channel: 'development', name: sessionId, role: 'protocol fixture, no model', project: { name: 'agent-channel', root } });
try {
  send({ id: 1, method: 'initialize', params: {} });
  await until(() => messages.some(m => m.id === 1));
  send({ id: 2, method: 'thread/start', params: { threadId: id } });
  await until(() => messages.some(m => m.id === 2));
  await channel.request('join', registration(id));
  await channel.request('join', registration(senderId));
  await delay(150);
  await channel.request('send', { agentId: `codex:${senderId}`, to: `codex:${id}`, text: 'Windows idle wake protocol proof', messageId: `${id}-wake` });
  await until(() => messages.filter(m => m.method === 'fixture/received').length === 1);
  if (messages.find(m => m.method === 'fixture/received').params.method !== 'turn/start') throw new Error('Idle session was not started');
  await channel.request('send', { agentId: `codex:${senderId}`, to: `codex:${id}`, text: 'Windows busy steering protocol proof', messageId: `${id}-steer` });
  await until(() => messages.filter(m => m.method === 'fixture/received').length === 2);
  if (messages.filter(m => m.method === 'fixture/received')[1].params.method !== 'turn/steer') throw new Error('Busy session was not steered');
  console.log('PASS: native Windows launcher, paths with spaces, real SSH/WebSocket delivery, idle turn/start and busy turn/steer (fixture; no model).');
} finally {
  for (const sessionId of [id, senderId]) await channel.request('leave', { agentId: `codex:${sessionId}` }).catch(() => {});
  channel.close();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
  await delay(200);
  rmSync(temp, { recursive: true, force: true });
}
