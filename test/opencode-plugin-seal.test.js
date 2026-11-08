import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('unsupported Node version refuses the experimental seal', t => {
  const node = process.env.TURNLINK_UNSUPPORTED_NODE;
  if (!node) { t.skip('set TURNLINK_UNSUPPORTED_NODE to an unsupported Node executable'); return; }
  const result = spawnSync(node, ['--import', resolve('native/opencode/plugin-seal-guard.mjs'), '--input-type=module', '-e', 'process.exit(0)'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0);
});

test('restricted plugin runtime rejects uncovered execution and file access',
  { skip: !process.env.TURNLINK_PLUGIN_SEALED_IMAGE, timeout: 60000 }, () => {
    const probe = `const r={};
const deny=async(k,fn)=>{try{await fn();r[k]=false}catch{r[k]=true}};
const noExecution=async(k,fn)=>{globalThis.__sealEscape=0;try{await fn()}catch{}r[k]=globalThis.__sealEscape===0};
await deny('dynamic',async()=>{const x='data:text/javascript,export default 1';await import(x)});
await deny('external',async()=>{const x='file:///code/package.json';await import(x)});
await deny('eval',()=>eval('1+1'));
await deny('function',()=>Function('return 1')());
await deny('builtinVm',()=>process.getBuiltinModule('node:vm'));
await deny('builtinModule',()=>process.getBuiltinModule('node:module'));
await deny('directVm',()=>import('node:vm'));
const m=await import('node:module');
await deny('createRequire',()=>m.createRequire('/sealed/plugin.mjs')('node:vm'));
await deny('moduleLoad',()=>m.default._load('node:vm'));
await noExecution('resolverMutation',()=>{const M=m.default,o=M._resolveFilename;M._resolveFilename=function(s,...a){return s==='crypto'?'node:vm':o.call(this,s,...a)};M._load('crypto').runInThisContext('globalThis.__sealEscape=1')});
await noExecution('directCompile',()=>{const M=m.default,x=new M('/sealed/plugin.mjs');x._compile('globalThis.__sealEscape=1','/sealed/plugin.mjs')});
await noExecution('loadMutation',()=>{const M=m.default;M._load=()=>{globalThis.__sealEscape=1};M._load('crypto')});
await noExecution('prototypeMutation',()=>{const M=m.default;M.prototype._compile=()=>{globalThis.__sealEscape=1};new M('/sealed/plugin.mjs')._compile('','/sealed/plugin.mjs')});
await noExecution('extensionMutation',()=>{const M=m.default;M._extensions['.js']=()=>{globalThis.__sealEscape=1};M._extensions['.js']()});
await noExecution('cacheMutation',()=>{const M=m.default;M._cache['/sealed/poison']={exports:{run:()=>{globalThis.__sealEscape=1}}};M._cache['/sealed/poison'].exports.run()});
await deny('newHook',()=>m.registerHooks({resolve(s,c,n){return {url:'node:vm',shortCircuit:true}}}));
await deny('newAsyncHook',()=>m.register('data:text/javascript,export{}'));
await deny('binding',()=>process.binding('contextify'));
await deny('linkedBinding',()=>process._linkedBinding('contextify'));
await deny('debugProcess',()=>process._debugProcess(process.pid));
await deny('signalSelf',()=>process.kill(process.pid,'SIGUSR1'));
await deny('lowLevelSignal',()=>process._kill(process.pid,10));
await deny('child',async()=>{const c=await import('node:child_process');c.execFileSync('/bin/true')});
await deny('externalRead',async()=>{const fs=await import('node:fs');fs.readFileSync('/etc/passwd')});
await deny('write',async()=>{const fs=await import('node:fs');fs.writeFileSync('/sealed/attack','x')});
try{process.dlopen({exports:{}},'/sealed/nonexistent.node');r.addon=false}catch(e){r.addon=['ERR_ACCESS_DENIED','ERR_DLOPEN_DISABLED'].includes(e?.code) && !process.permission.has('addon')}
r.wasm=typeof globalThis.WebAssembly==='undefined';
console.log(JSON.stringify(r));if(Object.values(r).some(v=>!v))process.exitCode=1;`;
    const result = execFileSync('/opt/homebrew/bin/docker', ['run', '--rm', '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '-e', 'NODE_NO_WARNINGS=1', '--entrypoint', '/usr/local/bin/turnlink-node', process.env.TURNLINK_PLUGIN_SEALED_IMAGE,
      '--permission', '--allow-fs-read=/sealed', '--disallow-code-generation-from-strings', '--import', '/sealed/guard.mjs', '--input-type=module', '-e', probe],
    { encoding: 'utf8', timeout: 30000 });
    const observed = JSON.parse(result); assert.equal(Object.keys(observed).length, 27); assert.ok(Object.values(observed).every(Boolean));
  });
