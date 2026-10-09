import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateDir, token, adminToken, identity, url, digest, matches, validateCredential } from './config.js';
import { acquireStore, readPrivate, atomicWrite } from './storage.js';
import { parseRequest, validateState, Security, MAX_FRAME_BYTES, MAX_RESPONSE_BYTES } from './protocol.js';

export const NAME_RESERVATION_MS = 300000;
const nameKey = value => value.normalize('NFKC').toLowerCase();
const fresh = () => ({ version: 3, agents: {}, bindings: {}, messages: [] });
export function createBroker({ port = 47321, secret = token(true), adminSecret = adminToken(true), hosts,
  directory = stateDir, now = Date.now, sweepIntervalMs = 1000, write = atomicWrite,
  limits = {} } = {}) {
  validateCredential(secret); validateCredential(adminSecret);
  if (secret === adminSecret) throw new Error('Host and administrator credentials must differ');
  const budget = { connections: 64, hostConnections: 16, sessionsPerHost: 64, channelMembers: 32,
    pendingPerSession: 128, deliveryWindow: 4, history: 10000, storeBytes: 64 * 1024 * 1024, ...limits };
  let fault = null, closing = false, server, heartbeat, expiryTimer, closePromise;
  const subscriptions = new Map();
  const deliveries = new Map();
  const controls = new Map();
  const buckets = new Map();
  const fail = error => {
    fault = error;
    for (const socket of server?.clients || []) socket.terminate();
  };
  const unlock = acquireStore(directory, fail);
  const file = join(directory, 'store.json'), securityFile = join(directory, 'security.json');
  let store, security;
  try {
    try { store = validateState(JSON.parse(readPrivate(file))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('State is invalid or legacy; use explicit v2 migration before starting'); store = fresh(); }
    try { security = Security.parse(JSON.parse(readPrivate(securityFile))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Invalid security registry');
      const initial = hosts || [{ hostId: 'local', credential: secret, channels: ['*'], broadcast: true }];
      security = { version: 1, hosts: {} };
      for (const h of initial) security.hosts[h.hostId] = { hostId: h.hostId, tokenHash: digest(validateCredential(h.credential)),
        channels: h.channels, broadcast: h.broadcast, revoked: false };
      security = Security.parse(security);
    }
    const hashes = new Set();
    for (const [key, host] of Object.entries(security.hosts)) {
    if (key !== host.hostId || ['unassigned', 'historical', 'operator'].includes(host.hostId) || matches(adminSecret, host.tokenHash)) throw new Error('Invalid host registry binding');
      if (hashes.has(host.tokenHash)) throw new Error('Host credentials must be unique'); hashes.add(host.tokenHash);
    }
  } catch (error) { unlock(); throw error; }
  const persist = () => {
    if (fault || closing) throw new Error('Broker persistence unavailable');
    try {
      const encoded = JSON.stringify(store);
      if (Buffer.byteLength(encoded) > budget.storeBytes) throw new Error('Store byte limit reached');
      write(file, encoded);
    } catch (error) { fail(error); throw new Error('Broker persistence unavailable'); }
  };
  const saveSecurity = () => {
    try { write(securityFile, JSON.stringify(security)); }
    catch (error) { fail(error); throw new Error('Broker persistence unavailable'); }
  };
  const consume = (key, rate, burst, amount = 1) => {
    const time = now(), old = buckets.get(key) || { time, tokens: burst };
    const available = Math.min(burst, old.tokens + Math.max(0, time - old.time) * rate / 1000);
    if (available < amount) throw new Error('Rate limit exceeded');
    buckets.set(key, { time, tokens: available - amount });
  };
  const scope = (principal, channel) => principal.admin || (!security.hosts[principal.hostId]?.revoked &&
    (security.hosts[principal.hostId]?.channels.includes('*') || security.hosts[principal.hostId]?.channels.includes(channel)));
  const validPrincipal = principal => principal.admin || (security.hosts[principal.hostId] &&
    !security.hosts[principal.hostId].revoked && security.hosts[principal.hostId].tokenHash === principal.tokenHash);
  const send = (socket, body) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const encoded = JSON.stringify({ v: 2, ...body });
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES || socket.bufferedAmount > MAX_FRAME_BYTES * 4) {
      socket.close(1008, 'Response/backpressure limit'); return;
    }
    socket.send(encoded, error => { if (error) socket.terminate(); });
  };
  const connected = id => subscriptions.get(id)?.readyState === WebSocket.OPEN;
  const reserve = a => {
    if (a.reservationExpiresAt == null) { a.disconnectedAt = now(); a.reservationExpiresAt = now() + NAME_RESERVATION_MS; }
  };
  const remove = (id, reason) => {
    for (const m of store.messages) if (m.recipients.includes(id) && !m.delivered.includes(id)) m.cancelled[id] = reason;
    delete store.agents[id];
    return () => {
      const receivers = new Set([subscriptions.get(id), ...(controls.get(id) || [])]);
      for (const socket of receivers) if (socket) send(socket, { event: 'membership_removed', agentId: id, reason });
      controls.delete(id);
      deliveries.delete(id);
    };
  };
  const sweep = () => {
    if (closing || fault) return;
    const effects = [];
    for (const a of Object.values(store.agents)) if (!connected(a.agentId) && a.reservationExpiresAt != null && a.reservationExpiresAt <= now()) effects.push(remove(a.agentId, 'reservation_expired'));
    if (effects.length) { persist(); effects.forEach(fn => fn()); }
  };
  for (const a of Object.values(store.agents)) if (a.reservationExpiresAt == null) {
    a.disconnectedAt = Math.min(now(), a.lastSeenAt ?? now()); a.reservationExpiresAt = a.disconnectedAt + NAME_RESERVATION_MS;
  }
  const claims = new Set();
  for (const a of Object.values(store.agents)) {
    if (a.reservationExpiresAt <= now()) { remove(a.agentId, 'reservation_expired'); continue; }
    const key = JSON.stringify([a.channel, nameKey(a.name)]);
    if (claims.has(key)) { unlock(); throw new Error('Duplicate stored channel names require explicit recovery'); }
    claims.add(key);
  }
  const binding = (principal, id, proof, create = false) => {
    if (principal.admin) throw new Error('Host credential required for agent operations');
    let b = store.bindings[id];
    if (!b && create) {
      if (Object.keys(store.bindings).length >= 8192) throw new Error('Session binding archive full');
      b = store.bindings[id] = { hostId: principal.hostId, proofHash: digest(proof), revoked: false };
    }
    if (!b || b.hostId !== principal.hostId) throw new Error('Session ownership denied');
    if (b.revoked) throw new Error('Session capability revoked');
    if (b.proofHash === null && create) b.proofHash = digest(proof); // Explicitly adopted legacy session.
    if (!matches(proof, b.proofHash)) throw new Error('Session ownership denied');
    return b;
  };
  const sessionBudget = (principal, id) => {
    const active = new Set(Object.values(store.agents).filter(a => a.hostId === principal.hostId).map(a => a.agentId));
    for (const subscribed of subscriptions.keys()) if (store.bindings[subscribed]?.hostId === principal.hostId) active.add(subscribed);
    if (!active.has(id) && active.size >= budget.sessionsPerHost) throw new Error('Host session limit reached');
  };
  const member = (principal, id, proof, channel) => {
    binding(principal, id, proof);
    const a = store.agents[id];
    if (!a) throw new Error('Join before communicating');
    if (!scope(principal, a.channel) || (channel && a.channel !== channel)) throw new Error('Channel access denied');
    return a;
  };
  const page = (array, limit = 30, offset = 0) => {
    const out = []; let bytes = 0;
    for (const value of array.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(value));
      if (bytes + size > MAX_RESPONSE_BYTES - 4096) break;
      out.push(value); bytes += size;
    }
    return out;
  };
  const list = channel => Object.values(store.agents).filter(a => a.channel === channel).map(a => ({ ...a,
    connected: connected(a.agentId), nameState: connected(a.agentId) ? 'claimed' : 'reserved' }));
  const deliver = id => {
    const socket = subscriptions.get(id), a = store.agents[id];
    if (!socket || !a || !validPrincipal(socket.principal) || socket.principal.hostId !== a.hostId || !scope(socket.principal, a.channel)) return;
    if (!deliveries.has(id)) deliveries.set(id, new Set());
    const outstanding = deliveries.get(id);
    for (const m of store.messages) {
      if (outstanding.size >= budget.deliveryWindow) break;
      if (m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id] && !outstanding.has(m.id)) {
        outstanding.add(m.id); send(socket, { event: 'message', message: m });
      }
    }
  };
  server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false,
    verifyClient: ({ req }, done) => {
      try {
        consume('handshakes', 20, 40);
        if (closing || fault || req.headers.origin || server.clients.size >= budget.connections) return done(false, 401);
        const value = req.headers.authorization;
        if (typeof value !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(value)) return done(false, 401);
        const credential = value.slice(7);
        let principal;
        if (matches(credential, digest(adminSecret))) principal = { admin: true, hostId: 'operator' };
        else {
          const h = Object.values(security.hosts).find(h => !h.revoked && matches(credential, h.tokenHash));
          if (h) principal = { admin: false, hostId: h.hostId, tokenHash: h.tokenHash };
        }
        if (!principal || [...server.clients].filter(s => s.principal?.hostId === principal.hostId).length >= budget.hostConnections) return done(false, 401);
        req.principal = principal; done(true);
      } catch { done(false, 429); }
    },
  });
  server.on('error', () => { fault = new Error('Broker listener failure'); if (!closing) void close(); });
  server.on('listening', () => { try { saveSecurity(); persist(); } catch { void close(); } });
  server.on('connection', (socket, req) => {
    socket.principal = req.principal; socket.alive = true; socket.invalid = 0;
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => {
      if (closing || fault) return;
      socket.alive = true; let changed = false;
      for (const [id, s] of subscriptions) if (s === socket && store.agents[id]) { store.agents[id].lastSeenAt = now(); changed = true; }
      if (changed) { try { persist(); } catch { /* fail() already disconnected receivers */ } }
    });
    socket.on('message', raw => {
      let request;
      try {
        if (closing || fault || !validPrincipal(socket.principal)) throw new Error('Broker unavailable or credential revoked');
        consume(`requests:${socket.principal.hostId}`, 20, 40);
        request = parseRequest(raw.toString()); sweep();
        const p = request.params, principal = socket.principal; let result;
        switch (request.method) {
          case 'hello': result = { protocol: 2, hostId: principal.hostId, admin: principal.admin }; break;
          case 'join': {
            if (!scope(principal, p.channel)) throw new Error('Channel access denied');
            const id = identity(p.harness, p.sessionId);
            const conflict = Object.values(store.agents).find(a => a.agentId !== id && a.channel === p.channel && nameKey(a.name) === nameKey(p.name));
            if (conflict) throw new Error('Name already claimed or reserved in channel');
            if (!store.agents[id] && list(p.channel).length >= budget.channelMembers) throw new Error('Channel member limit reached');
            sessionBudget(principal, id);
            binding(principal, id, p.proof, true);
            const prior = store.agents[id]; let effect;
            if (prior && prior.channel !== p.channel) effect = remove(id, 'channel_changed');
            const a = { agentId: id, hostId: principal.hostId, harness: p.harness, sessionId: p.sessionId,
              channel: p.channel, name: p.name, role: p.role, project: p.project };
            if (connected(id)) { a.lastSeenAt = now(); a.disconnectedAt = null; a.reservationExpiresAt = null; }
            else if (prior) Object.assign(a, { lastSeenAt: prior.lastSeenAt, disconnectedAt: prior.disconnectedAt, reservationExpiresAt: prior.reservationExpiresAt });
            else reserve(a);
            store.agents[id] = a; persist(); effect?.();
            if (!controls.has(id)) controls.set(id, new Set()); controls.get(id).add(socket);
            for (const peer of list(p.channel)) { const receiver = subscriptions.get(peer.agentId); if (receiver) send(receiver, { event: 'presence', agent: a }); }
            result = { agent: a, members: page(list(p.channel)) }; break;
          }
          case 'subscribe': {
            const known = store.bindings[p.agentId];
            if (known && (known.hostId !== principal.hostId || known.revoked ||
                (known.proofHash !== null && !matches(p.proof, known.proofHash)))) throw new Error('Session ownership denied');
            const prior = subscriptions.get(p.agentId);
            if (prior && prior !== socket && prior.readyState === WebSocket.OPEN) throw new Error('Session already has a receiver');
            const a = store.agents[p.agentId];
            if (a && !scope(principal, a.channel)) throw new Error('Channel access denied');
            sessionBudget(principal, p.agentId);
            binding(principal, p.agentId, p.proof, true);
            if (a) { a.lastSeenAt = now(); a.disconnectedAt = null; a.reservationExpiresAt = null; }
            persist();
            if (subscriptions.get(p.agentId) !== socket) deliveries.delete(p.agentId);
            subscriptions.set(p.agentId, socket);
            result = { subscribed: true, registered: !!a }; break;
          }
          case 'resume': {
            binding(principal, p.agentId, p.proof);
            const a = store.agents[p.agentId];
            if (a && !scope(principal, a.channel)) throw new Error('Channel access denied');
            if (a) { if (!controls.has(p.agentId)) controls.set(p.agentId, new Set()); controls.get(p.agentId).add(socket); }
            result = { registered: !!a }; break;
          }
          case 'unsubscribe': {
            binding(principal, p.agentId, p.proof);
            if (subscriptions.get(p.agentId) === socket) { subscriptions.delete(p.agentId); deliveries.delete(p.agentId); if (store.agents[p.agentId]) { reserve(store.agents[p.agentId]); persist(); } }
            result = { unsubscribed: true }; break;
          }
          case 'members': case 'history': {
            let a;
            if (!principal.admin) a = member(principal, p.agentId, p.proof, p.channel);
            if (!scope(principal, p.channel)) throw new Error('Channel access denied');
            const values = request.method === 'members' ? list(p.channel) : store.messages.filter(m => m.channel === p.channel &&
              (principal.admin || m.from.agentId === a.agentId || m.recipients.includes(a.agentId))).slice().reverse();
            result = page(values, p.limit, p.offset); break;
          }
          case 'send': {
            const a = member(principal, p.agentId, p.proof);
            const existing = store.messages.find(m => m.messageId === p.messageId && m.from.agentId === a.agentId);
            if (existing) {
              if (existing.text !== p.text || existing.to !== p.to || existing.channel !== a.channel) throw new Error('Idempotency key reused with different payload');
              result = existing; break;
            }
            if (p.to === '*' && !security.hosts[principal.hostId].broadcast) throw new Error('Broadcast permission denied');
            const recipients = list(a.channel).filter(peer => peer.agentId !== a.agentId && (p.to === '*' || p.to === peer.agentId)).map(peer => peer.agentId);
            if (!recipients.length) throw new Error('No recipient in this channel');
            if (recipients.some(id => store.messages.filter(m => m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id]).length >= budget.pendingPerSession)) throw new Error('Recipient queue limit reached');
            if (store.messages.length >= budget.history) throw new Error('Message store full');
            consume(`wake:${principal.hostId}`, 10, 32, recipients.length);
            const m = { id: randomUUID(), messageId: p.messageId, to: p.to, channel: a.channel, from: { ...a }, text: p.text,
              createdAt: new Date(now()).toISOString(), recipients, delivered: [], cancelled: {} };
            if (Buffer.byteLength(JSON.stringify(store)) + Buffer.byteLength(JSON.stringify(m)) + 1 > budget.storeBytes) throw new Error('Store byte limit reached');
            store.messages.push(m); persist(); recipients.forEach(deliver); result = m; break;
          }
          case 'ack': {
            member(principal, p.agentId, p.proof);
            if (subscriptions.get(p.agentId) !== socket) throw new Error('Only the session receiver can acknowledge');
            const m = store.messages.find(m => m.id === p.id && m.recipients.includes(p.agentId));
            if (!m) throw new Error('Unknown message');
            if (m.cancelled[p.agentId]) throw new Error('Message cancelled when membership was released');
            if (!m.delivered.includes(p.agentId)) { m.delivered.push(p.agentId); persist(); }
            deliveries.get(p.agentId)?.delete(p.id); deliver(p.agentId);
            result = { delivered: true }; break;
          }
          case 'leave': {
            binding(principal, p.agentId, p.proof);
            const effect = remove(p.agentId, 'explicit_leave'); persist(); effect(); result = { left: true }; break;
          }
          case 'release': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            const a = Object.values(store.agents).find(a => a.channel === p.channel && nameKey(a.name) === nameKey(p.name));
            if (!a) throw new Error('Name is not claimed');
            const effect = remove(a.agentId, 'authorized_release'); persist(); effect(); result = { released: true, agentId: a.agentId }; break;
          }
          case 'enroll': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            if (['unassigned', 'historical', 'operator'].includes(p.hostId) || p.credential === adminSecret) throw new Error('Invalid host enrollment');
            if (Object.keys(security.hosts).length >= 64 && !security.hosts[p.hostId]) throw new Error('Host limit reached');
            if (Object.values(security.hosts).some(h => h.hostId !== p.hostId && matches(p.credential, h.tokenHash))) throw new Error('Host credentials must be unique');
            for (const id of p.adopt || []) {
              const b = store.bindings[id];
              if (!b || b.proofHash !== null || !['unassigned', p.hostId].includes(b.hostId)) throw new Error('Only explicitly migrated unclaimed sessions can be adopted');
            }
            security.hosts[p.hostId] = { hostId: p.hostId, tokenHash: digest(p.credential), channels: p.channels, broadcast: p.broadcast, revoked: false };
            saveSecurity();
            for (const id of p.adopt || []) { store.bindings[id].hostId = p.hostId; if (store.agents[id]) store.agents[id].hostId = p.hostId; }
            persist();
            for (const s of server.clients) if (!s.principal.admin && s.principal.hostId === p.hostId) s.close(1008, 'Credential rotated');
            result = { enrolled: true, hostId: p.hostId }; break;
          }
          case 'revoke': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            if (!Object.hasOwn(security.hosts, p.hostId)) throw new Error('Unknown host');
            security.hosts[p.hostId].revoked = true; saveSecurity();
            for (const s of server.clients) if (!s.principal.admin && s.principal.hostId === p.hostId) s.close(1008, 'Credential revoked');
            result = { revoked: true, hostId: p.hostId }; break;
          }
          case 'revoke_session': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            const b = store.bindings[p.agentId]; if (!b) throw new Error('Unknown session');
            b.revoked = true;
            const effect = remove(p.agentId, 'session_revoked'); persist(); effect();
            subscriptions.delete(p.agentId);
            result = { revoked: true, agentId: p.agentId }; break;
          }
          case 'handoff': throw new Error('Automatic handoff requires a verified window/project event');
        }
        send(socket, { id: request.id, result });
        if (request.method === 'subscribe') deliver(p.agentId);
      } catch (error) {
        const invalid = ['ZodError', 'ProtocolError'].includes(error.name) || error instanceof SyntaxError;
        send(socket, { id: request?.id ?? error.requestId ?? null, error: invalid ? 'Invalid request schema or protocol version' : String(error.message).slice(0, 512) });
        if (invalid && ++socket.invalid >= 3) socket.close(1008, 'Invalid protocol');
      }
    });
    socket.on('close', () => {
      for (const [id, sockets] of controls) { sockets.delete(socket); if (!sockets.size) controls.delete(id); }
      let changed = false;
      for (const [id, s] of subscriptions) if (s === socket) { subscriptions.delete(id); deliveries.delete(id); if (store.agents[id]) { reserve(store.agents[id]); changed = true; } }
      if (changed && !closing && !fault) { try { persist(); } catch { /* fail closed */ } }
    });
  });
  heartbeat = setInterval(() => {
    for (const s of server.clients) { if (!validPrincipal(s.principal) || !s.alive) s.terminate(); else { s.alive = false; s.ping(); } }
  }, 15000); heartbeat.unref();
  expiryTimer = setInterval(() => { try { sweep(); } catch { /* persistence fault already isolated */ } }, sweepIntervalMs); expiryTimer.unref();
  function close() {
    if (closePromise) return closePromise;
    clearInterval(heartbeat); clearInterval(expiryTimer);
    if (!fault) { for (const id of subscriptions.keys()) if (store.agents[id]) reserve(store.agents[id]); try { persist(); } catch { /* preserve last durable snapshot */ } }
    closing = true;
    for (const s of server.clients) s.terminate();
    closePromise = new Promise(resolve => server.close(() => { unlock(); resolve(); })); return closePromise;
  }
  return { server, get store() { return store; }, get security() { return security; }, get fault() { return fault; }, sweep, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const address = new URL(url);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'ws:') throw new Error('Broker must use ws://127.0.0.1');
  const broker = createBroker({ port: Number(address.port) });
  broker.server.on('listening', () => { if (!broker.fault) console.error(`Turnlink protocol v2 listening on ${url}`); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await broker.close(); process.exit(0); });
}
