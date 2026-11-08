import { EventEmitter } from 'node:events';

// Node IPC framing for an already spawned child. Process isolation and
// authentication are responsibilities of the caller; this wrapper only
// provides bounded messages and fail-closed lifecycle semantics.
export function createOpenCodePluginProcessPort(channel) {
  if (typeof channel?.send !== 'function' || typeof channel?.on !== 'function' || typeof channel?.disconnect !== 'function' || !channel.connected)
    throw new Error('PLUGIN_PROCESS_PORT_UNAVAILABLE');
  const port = new EventEmitter(); let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    channel.off('message', message); channel.off('disconnect', close); channel.off('exit', close); channel.off('error', close);
    if (channel.connected) try { channel.disconnect(); } catch {}
    port.emit('close');
  };
  const bounded = value => { try { return Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024; } catch { return false; } };
  const message = value => { if (closed) return; if (!bounded(value)) return close(); port.emit('message', value); };
  channel.on('message', message); channel.on('disconnect', close); channel.on('exit', close); channel.on('error', close);
  port.postMessage = value => {
    if (closed || !channel.connected || !bounded(value)) { close(); throw new Error('PLUGIN_PROCESS_PORT_UNAVAILABLE'); }
    try { channel.send(value, error => { if (error) close(); }); } catch { close(); throw new Error('PLUGIN_PROCESS_PORT_UNAVAILABLE'); }
  };
  port.close = close; return port;
}
