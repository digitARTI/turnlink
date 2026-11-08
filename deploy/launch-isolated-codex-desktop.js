#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { isolatedDesktopLaunch } from '../src/codex-desktop-launch.js';

try {
  if (process.platform !== 'darwin') throw new Error('DESKTOP_LAUNCH_REQUIRES_MACOS');
  const launch = isolatedDesktopLaunch({ home: process.env.HOME, env: process.env, args: process.argv.slice(2) });
  const child = spawn(launch.executable, launch.args, { stdio: 'inherit' });
  child.on('error', () => { console.error('Isolated Desktop launch failed'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
} catch (error) { console.error(`Isolated Desktop launch unavailable: ${error.code || error.message}`); process.exitCode = 1; }
