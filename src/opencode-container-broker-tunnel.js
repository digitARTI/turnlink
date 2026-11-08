import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createOpenCodeHostMux } from './opencode-container-mux.js';

const unavailable = () => Object.assign(new Error('CONTAINED_BROKER_TUNNEL_UNAVAILABLE'), { code: 'CONTAINED_BROKER_TUNNEL_UNAVAILABLE' });

// The attached stream is private; the container can only reach the one host
// loopback port supplied by its owner. This tunnel conveys no authorization.
export async function createContainedOpenCodeBrokerTunnel({ owner, docker, containerID, daemonID, operationID, brokerPort, containerPort, onClose, muxPath = '/mux.mjs' }) {
  if (!owner?.observe || !isAbsolute(docker) || !/^[a-f0-9]{64}$/.test(containerID || '') || typeof daemonID !== 'string' || !daemonID ||
      typeof operationID !== 'string' || !['/mux.mjs', '/assets/mux.mjs', '/code/src/opencode-container-mux.js'].includes(muxPath) || ![brokerPort, containerPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw unavailable();
  const check = async () => {
    const state = await owner.observe();
    if (!state.running || state.containerID !== containerID || state.daemonID !== daemonID || state.operationID !== operationID) throw unavailable();
  };
  await check();
  const program = `import { createOpenCodeContainerMux } from ${JSON.stringify(muxPath)}; const m=createOpenCodeContainerMux({input:process.stdin,output:process.stdout,port:${containerPort},onClose:reason=>{process.stderr.write('CLOSED:'+reason+'\\n');process.stdin.destroy();process.stdout.destroy();process.exitCode=1}}); m.listener.once('listening',()=>process.stderr.write('READY\\n'));`;
  const child = spawn(docker, ['exec', '-i', containerID, '/usr/local/bin/turnlink-bun', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); child.stdout.on('error', () => {});
  let closed = false, notified = false;
  const close = () => { if (closed) return; closed = true; mux.close(); child.stdin.destroy(); child.stdout.destroy(); child.kill(); };
  const failed = reason => { if (closed) return; if (!notified) { notified = true; onClose?.(reason); } close(); };
  const mux = createOpenCodeHostMux({ input: child.stdout, output: child.stdin, port: brokerPort, onClose: failed });
  const exited = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', () => resolve({ code: null, signal: null })); });
  try {
    await new Promise((resolve, reject) => {
      let data = '', done = false;
      const finish = error => { if (done) return; done = true; clearTimeout(timer); child.stderr.off('data', receive); error ? reject(error) : resolve(); };
      const receive = chunk => { data += chunk; if (data.length > 128) return finish(unavailable()); if (data.includes('\n')) finish(data === 'READY\n' ? undefined : unavailable()); };
      const timer = setTimeout(() => finish(unavailable()), 10000);
      child.stderr.on('data', receive); void exited.then(() => finish(unavailable()));
    });
    if (closed) throw unavailable(); await check(); if (closed) throw unavailable();
    return Object.freeze({ close, exited, containerPort });
  } catch (error) { close(); throw error; }
}
