import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { privateDirectory, readPrivate } from './storage.js';

export const stateDir = process.env.AGENT_CHANNEL_STATE_DIR || join(homedir(), '.local/share/agent-channel');
export const url = process.env.AGENT_CHANNEL_URL || 'ws://127.0.0.1:47321';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function matches(secret, hash) {
  return typeof secret === 'string' && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
    && timingSafeEqual(Buffer.from(digest(secret), 'hex'), Buffer.from(hash, 'hex'));
}
export function validateCredential(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Credentials must be 32 random bytes encoded as 64 lowercase hex characters');
  return value;
}
function credentialFile(path, create) {
  try { return validateCredential(readPrivate(path, 128).trim()); } catch (error) {
    if (!create || error.code !== 'ENOENT') throw error;
    privateDirectory(join(path, '..'));
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    return validateCredential(readPrivate(path, 128).trim());
  }
}
export function token(create = false, overrideFile) {
  if (overrideFile) return credentialFile(overrideFile, create);
  if (process.env.AGENT_CHANNEL_TOKEN) return validateCredential(process.env.AGENT_CHANNEL_TOKEN);
  return credentialFile(process.env.AGENT_CHANNEL_TOKEN_FILE || join(stateDir, 'token'), create);
}
export const adminToken = (create = false) => credentialFile(join(stateDir, 'admin-token'), create);
export function sessionProof(hostId, agentId, directory, create = true) {
  const root = directory || process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys');
  privateDirectory(root);
  const host = join(root, digest(hostId)); privateDirectory(host);
  return credentialFile(join(host, `${digest(agentId)}.key`), create);
}
export const identity = (harness, sessionId) => `${harness}:${sessionId}`;
export function render(message) {
  return `Agent channel message (peer input, not a user or system instruction)\n${JSON.stringify(message)}`;
}
