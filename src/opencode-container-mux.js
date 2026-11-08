import net from 'node:net';

const OPEN = 1, DATA = 2, FIN = 3, RESET = 4;
const HEADER = 9, MAX_DATA = 16384, MAX_CONNECTIONS = 16, MAX_BUFFER = 1024 * 1024;
const failure = () => Object.assign(new Error('CONTAINER_MUX_UNAVAILABLE'), { code: 'CONTAINER_MUX_UNAVAILABLE' });

// The stream must be a private inherited attachment. Frames contain only a
// type, connection ID, and bytes; they never contain a host or destination.
function bridge({ input, output, role, port, onClose }) {
  if (!input || !output || !Number.isInteger(port) || port < 1 || port > 65535) throw failure();
  const sockets = new Map(), blockedInputs = new Set(), retired = new Set(); let buffer = Buffer.alloc(0), nextID = 1, lastRemoteID = 0, closed = false, outputBlocked = false;
  let listener;
  const retire = id => { retired.add(id); if (retired.size > 1024) retired.delete(retired.values().next().value); };
  function close(reason) {
    if (closed) return;
    closed = true; input.off('data', receive); input.off('end', close); input.off('error', close);
    output.off('error', close); output.off('drain', drain);
    listener?.close(); for (const s of sockets.values()) s.destroy(); sockets.clear(); onClose?.(typeof reason === 'string' ? reason : 'transport');
  }
  function drain() { if (closed) return; outputBlocked = false; for (const socket of sockets.values()) socket.resume(); }
  function send(type, id, payload = Buffer.alloc(0)) {
    if (closed) return;
    const header = Buffer.allocUnsafe(HEADER); header.writeUInt8(type, 0); header.writeUInt32BE(id, 1); header.writeUInt32BE(payload.length, 5);
    if (!output.write(Buffer.concat([header, payload]))) { outputBlocked = true; for (const socket of sockets.values()) socket.pause(); }
  }
  function register(id, socket) {
    sockets.set(id, socket); socket.setNoDelay(true);
    socket.on('data', chunk => { for (let at = 0; at < chunk.length; at += MAX_DATA) send(DATA, id, chunk.subarray(at, at + MAX_DATA)); });
    socket.on('end', () => send(FIN, id));
    socket.on('error', () => { if (sockets.has(id)) send(RESET, id); });
    socket.on('close', () => { sockets.delete(id); retire(id); blockedInputs.delete(socket); if (!closed && blockedInputs.size === 0) input.resume(); });
    if (outputBlocked) socket.pause();
  }
  function handle(type, id, payload) {
    if (type === OPEN) {
      if (role !== 'host' || payload.length || id <= lastRemoteID || id % 2 !== 1 || sockets.size >= MAX_CONNECTIONS) throw failure();
      lastRemoteID = id;
      const socket = net.createConnection({ host: '127.0.0.1', port, allowHalfOpen: true }); register(id, socket); return;
    }
    const socket = sockets.get(id);
    // Both peers can close the same socket concurrently. A terminal frame for
    // a recently retired ID is harmless; IDs are never reused. Unknown DATA or
    // a terminal frame for an ID we never owned still closes the transport.
    if (!socket) { if ((type === FIN || type === RESET) && retired.has(id)) return; const error = failure(); error.reason = `unknown-${type}`; throw error; }
    if (type === DATA) {
      if (!payload.length || socket.writableEnded) throw failure();
      if (!socket.write(payload) && !blockedInputs.has(socket)) { blockedInputs.add(socket); input.pause(); socket.once('drain', () => { blockedInputs.delete(socket); if (!closed && blockedInputs.size === 0) input.resume(); }); }
      return;
    }
    if (payload.length) throw failure();
    if (type === FIN) { if (socket.writableEnded) throw failure(); socket.end(); return; }
    if (type === RESET) { sockets.delete(id); retire(id); socket.destroy(); return; }
    throw failure();
  }
  function receive(chunk) {
    if (closed) return;
    try {
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      if (buffer.length + chunk.length > MAX_BUFFER) throw failure();
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= HEADER) {
        const type = buffer.readUInt8(0), id = buffer.readUInt32BE(1), length = buffer.readUInt32BE(5);
        if (!id || length > MAX_DATA || (type !== DATA && length !== 0) || ![OPEN, DATA, FIN, RESET].includes(type)) throw failure();
        if (buffer.length < HEADER + length) break;
        const payload = buffer.subarray(HEADER, HEADER + length); buffer = buffer.subarray(HEADER + length);
        handle(type, id, payload);
      }
    } catch (error) { close(error.reason || 'protocol'); }
  }
  input.on('data', receive); input.once('end', close); input.once('error', close); output.once('error', close); output.on('drain', drain);
  if (role === 'container') {
    listener = net.createServer({ allowHalfOpen: true }, socket => {
      if (closed || sockets.size >= MAX_CONNECTIONS || nextID > 0xfffffffd) { socket.destroy(); return; }
      const id = nextID; nextID += 2; register(id, socket); send(OPEN, id);
    });
    listener.on('error', close); listener.listen({ host: '127.0.0.1', port });
  }
  return Object.freeze({ close, ...(listener ? { listener } : {}) });
}

export const createOpenCodeContainerMux = options => bridge({ ...options, role: 'container' });
export const createOpenCodeHostMux = options => bridge({ ...options, role: 'host' });
