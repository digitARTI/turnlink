import { EventEmitter } from 'node:events';

const ports = new WeakMap();
export const isOpenCodePluginStreamPortOpen = (port, child) => {
  const entry = ports.get(port); return !!entry && entry.open() && (!child || entry.child === child);
};

// Length-prefixed JSON over a preconnected duplex transport. The caller must
// establish process identity and isolation; framing alone does neither.
export function createOpenCodePluginStreamPort({ input, output, child }) {
  if (!input?.on || !output?.write || (child && (child.stdout !== input || child.stdin !== output))) throw new Error('PLUGIN_STREAM_UNAVAILABLE');
  const port = new EventEmitter(), max = 1024 * 1024; let closed = false, buffer = Buffer.alloc(0);
  ports.set(port, { child, open: () => !closed });
  const close = () => {
    if (closed) return; closed = true; input.off('data', data); input.off('end', close); input.off('close', close); input.off('error', close); output.off('close', close); output.off('error', close);
    input.destroy(); output.destroy(); port.emit('close');
  };
  const data = chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > max * 2) return close();
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0); if (!length || length > max) return close();
      if (buffer.length < length + 4) return;
      const frame = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
      try { port.emit('message', JSON.parse(frame.toString('utf8'))); } catch { close(); return; }
      if (closed) return;
    }
  };
  input.on('data', data); input.on('end', close); input.on('close', close); input.on('error', close); output.on('close', close); output.on('error', close);
  port.postMessage = value => {
    if (closed) throw new Error('PLUGIN_STREAM_UNAVAILABLE');
    let frame; try { frame = Buffer.from(JSON.stringify(value)); } catch { close(); throw new Error('PLUGIN_STREAM_UNAVAILABLE'); }
    if (!frame.length || frame.length > max || output.writableLength + frame.length > max * 4) { close(); throw new Error('PLUGIN_STREAM_UNAVAILABLE'); }
    const length = Buffer.allocUnsafe(4); length.writeUInt32BE(frame.length); output.write(Buffer.concat([length, frame]));
  };
  port.close = close; return port;
}
