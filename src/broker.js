import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateDir, token, adminToken, identity, url } from './config.js';

const text = (value, name, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
};
export const NAME_RESERVATION_MS = 5 * 60 * 1000;
const nameKey = value => value.normalize('NFKC').toLowerCase();
export function createBroker({ port = 47321, secret = token(true), adminSecret = adminToken(true), directory = stateDir,
  now = Date.now, sweepIntervalMs = 1000 } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'store.json');
  let store;
  try { store = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; store = { agents: {}, messages: [] }; }
  if (store.version !== 2) {
    try { copyFileSync(file, join(directory, 'store.pre-name-policy.json'), constants.COPYFILE_EXCL); }
    catch (e) { if (!['ENOENT', 'EEXIST'].includes(e.code)) throw e; }
  }
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(store), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const subscriptions = new Map();
  const controllers = new Map();
  let closing = false;
  const connected = agentId => subscriptions.get(agentId)?.readyState === WebSocket.OPEN;
  const reserve = agent => {
    if (agent.reservationExpiresAt == null) {
      agent.disconnectedAt = now();
      agent.reservationExpiresAt = agent.disconnectedAt + NAME_RESERVATION_MS;
    }
  };
  const remove = (agentId, reason) => {
    const agent = store.agents[agentId];
    const receiver = subscriptions.get(agentId);
    if (receiver?.readyState === WebSocket.OPEN) receiver.send(JSON.stringify({ event: 'membership_removed', agentId, reason }));
    // The raw receiver may remain available for an explicit future join, but
    // it has no channel membership and must never replay the retired claim's work.
    for (const message of store.messages) {
      if (message.recipients.includes(agentId) && !message.delivered.includes(agentId)) {
        message.cancelled ??= {};
        message.cancelled[agentId] = reason;
      }
    }
    delete store.agents[agentId];
    controllers.delete(agentId);
    return agent;
  };
  const sweep = () => {
    let changed = false;
    for (const agent of Object.values(store.agents)) {
      if (!connected(agent.agentId) && agent.reservationExpiresAt != null && agent.reservationExpiresAt <= now()) {
        remove(agent.agentId, 'reservation_expired');
        changed = true;
      }
    }
    if (changed) save();
  };
  // Restore reservations without extending persisted deadlines on each restart.
  // For an abrupt crash, the last persisted heartbeat bounds the grace period.
  for (const agent of Object.values(store.agents)) {
    if (agent.reservationExpiresAt == null) {
      agent.disconnectedAt = Math.min(now(), agent.lastSeenAt ?? now());
      agent.reservationExpiresAt = agent.disconnectedAt + NAME_RESERVATION_MS;
    }
  }
  sweep();
  const claims = new Set();
  for (const agent of Object.values(store.agents)) {
    const key = JSON.stringify([agent.channel, nameKey(agent.name)]);
    if (claims.has(key)) throw new Error('Legacy duplicate channel names: explicitly release conflicting registrations before starting');
    claims.add(key);
  }
  store.version = 2;
  save();
  const server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 65536,
    verifyClient: ({ req }, done) => done(!req.headers.origin && req.headers.authorization === `Bearer ${secret}`, 401),
  });
  const send = (socket, data) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
  const deliver = agentId => {
    const socket = subscriptions.get(agentId);
    if (!socket || !store.agents[agentId]) return;
    for (const message of store.messages) {
      if (message.recipients.includes(agentId) && !message.delivered.includes(agentId) && !message.cancelled?.[agentId]) send(socket, { event: 'message', message });
    }
  };
  const members = channel => Object.values(store.agents).filter(a => a.channel === channel).map(a => ({ ...a,
    connected: connected(a.agentId), nameState: connected(a.agentId) ? 'claimed' : 'reserved',
  }));
  server.on('connection', socket => {
    socket.alive = true;
    socket.on('pong', () => {
      if (closing) return;
      socket.alive = true;
      let changed = false;
      for (const [id, receiver] of subscriptions) {
        if (receiver === socket && store.agents[id]) { store.agents[id].lastSeenAt = now(); changed = true; }
      }
      if (changed) save();
    });
    socket.on('message', raw => {
      if (closing) return;
      let request;
      try {
        request = JSON.parse(raw.toString());
        const p = request.params || {};
        sweep();
        let result;
        switch (request.method) {
          case 'join': {
            const harness = text(p.harness, 'harness');
            const sessionId = text(p.sessionId, 'sessionId');
            const agentId = identity(harness, sessionId);
            const agent = { agentId, harness, sessionId, name: text(p.name, 'name'), role: text(p.role, 'role'),
              project: { name: text(p.project?.name, 'project.name'), root: text(p.project?.root, 'project.root', 2000) },
              channel: text(p.channel, 'channel') };
            const conflict = Object.values(store.agents).find(a => a.agentId !== agentId && a.channel === agent.channel && nameKey(a.name) === nameKey(agent.name));
            if (conflict) throw new Error(`Name already claimed or reserved in channel: ${agent.name}`);
            const prior = store.agents[agentId];
            const controller = controllers.get(agentId);
            if (controller?.readyState === WebSocket.OPEN && controller !== socket && subscriptions.get(agentId) !== socket) {
              throw new Error('Session is already owned by another connection');
            }
            if (connected(agentId)) {
              agent.lastSeenAt = now();
              agent.disconnectedAt = null;
              agent.reservationExpiresAt = null;
            } else if (prior) {
              agent.lastSeenAt = prior.lastSeenAt;
              agent.disconnectedAt = prior.disconnectedAt;
              agent.reservationExpiresAt = prior.reservationExpiresAt;
            } else reserve(agent);
            store.agents[agentId] = agent;
            controllers.set(agentId, socket);
            save();
            for (const member of members(agent.channel)) {
              const receiver = subscriptions.get(member.agentId);
              if (receiver) send(receiver, { event: 'presence', agent });
            }
            result = { agent, members: members(agent.channel) };
            break;
          }
          case 'subscribe': {
            const agentId = text(p.agentId, 'agentId', 1000);
            const prior = subscriptions.get(agentId);
            if (prior && prior !== socket) throw new Error('Session already has a receiver');
            subscriptions.set(agentId, socket);
            const agent = store.agents[agentId];
            if (agent) {
              agent.lastSeenAt = now();
              agent.disconnectedAt = null;
              agent.reservationExpiresAt = null;
              save();
            }
            result = { subscribed: true, registered: !!agent };
            break;
          }
          case 'members': result = members(text(p.channel, 'channel')); break;
          case 'unsubscribe': {
            if (subscriptions.get(p.agentId) === socket) {
              subscriptions.delete(p.agentId);
              if (store.agents[p.agentId]) { reserve(store.agents[p.agentId]); save(); }
            }
            result = { unsubscribed: true };
            break;
          }
          case 'send': {
            const sender = store.agents[p.agentId];
            if (!sender) throw new Error('Join before sending');
            const recipients = members(sender.channel).filter(a => a.agentId !== sender.agentId && (p.to === '*' || p.to === a.agentId)).map(a => a.agentId);
            if (!recipients.length) throw new Error('No recipient in this channel');
            const content = text(p.text, 'text', 16000);
            const key = text(p.messageId, 'messageId');
            const existing = store.messages.find(m => m.messageId === key && m.from.agentId === sender.agentId);
            if (existing) { result = existing; break; }
            if (store.messages.length >= 10000) throw new Error('Message store full; archive history before sending');
            const message = { id: randomUUID(), messageId: key, channel: sender.channel, from: { ...sender },
              text: content, createdAt: new Date(now()).toISOString(), recipients, delivered: [], cancelled: {} };
            store.messages.push(message);
            save();
            recipients.forEach(deliver);
            result = message;
            break;
          }
          case 'ack': {
            if (subscriptions.get(p.agentId) !== socket) throw new Error('Only the session receiver can acknowledge');
            const message = store.messages.find(m => m.id === p.id && m.recipients.includes(p.agentId));
            if (!message) throw new Error('Unknown message');
            if (message.cancelled?.[p.agentId]) throw new Error('Message cancelled when membership was released');
            if (!message.delivered.includes(p.agentId)) { message.delivered.push(p.agentId); save(); }
            result = { delivered: true };
            break;
          }
          case 'history': result = store.messages.filter(m => m.channel === text(p.channel, 'channel')).slice(-Math.min(100, Math.max(1, Number(p.limit) || 30))); break;
          case 'leave': {
            if (store.agents[p.agentId] && controllers.get(p.agentId) !== socket && subscriptions.get(p.agentId) !== socket) {
              throw new Error('Only the owning session can leave; rejoin after a control-connection restart');
            }
            remove(p.agentId, 'explicit_leave'); save(); result = { left: true }; break;
          }
          case 'release': {
            if (typeof p.adminToken !== 'string' || p.adminToken !== adminSecret) throw new Error('Administrative authorization required');
            const channel = text(p.channel, 'channel');
            const name = text(p.name, 'name');
            const agent = Object.values(store.agents).find(a => a.channel === channel && nameKey(a.name) === nameKey(name));
            if (!agent) throw new Error('Name is not claimed');
            remove(agent.agentId, 'authorized_release');
            save(); result = { released: true, agentId: agent.agentId }; break;
          }
          case 'handoff': throw new Error('Automatic handoff requires a verified window/project event; this harness integration does not provide one');
          default: throw new Error('Unknown method');
        }
        send(socket, { id: request.id, result });
        if (request.method === 'subscribe') deliver(p.agentId);
      } catch (error) { send(socket, { id: request?.id, error: error.message }); }
    });
    socket.on('close', () => {
      for (const [id, controller] of controllers) if (controller === socket) controllers.delete(id);
      let changed = false;
      for (const [id, receiver] of subscriptions) if (receiver === socket) {
        subscriptions.delete(id);
        if (store.agents[id]) { reserve(store.agents[id]); changed = true; }
      }
      if (changed && !closing) save();
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      if (!socket.alive) socket.terminate();
      else { socket.alive = false; socket.ping(); }
    }
  }, 15000);
  heartbeat.unref();
  const expiryTimer = setInterval(sweep, sweepIntervalMs);
  expiryTimer.unref();
  return { server, store, sweep, close: () => {
    closing = true;
    clearInterval(heartbeat); clearInterval(expiryTimer);
    for (const id of subscriptions.keys()) if (store.agents[id]) reserve(store.agents[id]);
    save();
    for (const s of server.clients) s.terminate();
    return new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const address = new URL(url);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'ws:') throw new Error('Broker must use ws://127.0.0.1');
  const broker = createBroker({ port: Number(address.port) });
  broker.server.on('listening', () => console.error(`Agent channel listening on ${url}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await broker.close(); process.exit(0); });
}
