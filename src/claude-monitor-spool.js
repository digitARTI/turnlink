import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './config.js';
import { atomicWrite, privateDirectory, readPrivate } from './storage.js';

const messageId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function claudeMonitorDirectory(root, sessionId) {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9:._-]{1,128}$/.test(sessionId)) throw new Error('Invalid Claude session identity');
  return join(root, 'claude-monitor', digest(sessionId));
}
export function createClaudeMonitorSpool(root, sessionId) {
  const directory = claudeMonitorDirectory(root, sessionId);
  privateDirectory(directory);
  const path = id => { if (!messageId.test(id)) throw new Error('Invalid message ID'); return join(directory, `${id}.json`); };
  return {
    directory,
    heartbeat(id) { atomicWrite(join(directory, 'monitor.heartbeat'), JSON.stringify({ id, pid: process.pid, time: Date.now() })); },
    monitorStatus() {
      try {
        const value = JSON.parse(readPrivate(join(directory, 'monitor.heartbeat'), 1024));
        if (typeof value.id !== 'string' || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isSafeInteger(value.time) || value.time > Date.now() || Date.now() - value.time >= 15000) return 'inactive';
        try {
          const stop = JSON.parse(readPrivate(join(directory, 'monitor.stop'), 1024));
          if (stop.id === value.id) return 'inactive';
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { process.kill(value.pid, 0); return 'active'; }
        catch (error) { if (error.code === 'EPERM') return 'active'; if (error.code === 'ESRCH') return 'inactive'; throw error; }
      } catch (error) { if (error.code === 'ENOENT') return 'inactive'; throw error; }
    },
    stopHeartbeat(id) {
      try {
        const value = JSON.parse(readPrivate(join(directory, 'monitor.heartbeat'), 1024));
        if (value.id === id) unlinkSync(join(directory, 'monitor.heartbeat'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    requestStop() {
      try {
        const value = JSON.parse(readPrivate(join(directory, 'monitor.heartbeat'), 1024));
        if (typeof value.id !== 'string') throw new Error('Invalid monitor heartbeat');
        atomicWrite(join(directory, 'monitor.stop'), JSON.stringify({ id: value.id }));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    consumeStop(id) {
      try {
        const value = JSON.parse(readPrivate(join(directory, 'monitor.stop'), 1024));
        if (value.id !== id) return false;
        unlinkSync(join(directory, 'monitor.stop')); return true;
      } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    },
    put(message) {
      const value = { version: 1, id: message.id, channel: message.channel, from: message.from, text: message.text, createdAt: message.createdAt };
      atomicWrite(path(value.id), JSON.stringify(value));
    },
    remove(id) { try { unlinkSync(path(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
    clear() {
      for (const name of readdirSync(directory)) if (name.endsWith('.json') && messageId.test(name.slice(0, -5))) {
        try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
    read() {
      const entries = readdirSync(directory).filter(name => name.endsWith('.json') && messageId.test(name.slice(0, -5))).sort();
      if (entries.length > 128) throw new Error('Monitor message limit exceeded');
      return entries.flatMap(name => {
        try {
          const value = JSON.parse(readPrivate(join(directory, name), 65536));
          if (value.version !== 1 || value.id !== name.slice(0, -5) || typeof value.text !== 'string' || typeof value.from?.agentId !== 'string') throw new Error('Invalid monitor message');
          return [value];
        } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      });
    },
  };
}
