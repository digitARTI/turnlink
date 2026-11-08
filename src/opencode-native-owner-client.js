import { close, read, write } from 'node:fs';
import { Duplex } from 'node:stream';
import { OpenCodeNativeMovement } from './opencode-native-movement.js';

// Only call from the native owner's startup path, with the supervisor's
// inherited descriptor. The supervisor permits pre-grant methods only.
export function connectOpenCodeNativeOwner({ fd, sessionID, source, pluginID }) {
  if (!Number.isSafeInteger(fd) || fd < 5) throw new Error('NATIVE_OWNER_TRANSPORT_UNAVAILABLE');
  let reading = false;
  const stream = new Duplex({
    read() {
      if (reading) return;
      reading = true; const buffer = Buffer.alloc(16384);
      read(fd, buffer, 0, buffer.length, null, (error, count) => {
        reading = false;
        if (error) { this.destroy(error); return; }
        this.push(count ? buffer.subarray(0, count) : null);
      });
    },
    write(chunk, _encoding, callback) {
      let offset = 0;
      const next = () => write(fd, chunk, offset, chunk.length - offset, null, (error, count) => {
        if (error || !count) return callback(error || new Error('NATIVE_OWNER_TRANSPORT_UNAVAILABLE'));
        offset += count; if (offset < chunk.length) next(); else callback();
      });
      next();
    },
    destroy(error, callback) { close(fd, closeError => callback(error || closeError)); },
  });
  return new OpenCodeNativeMovement({ stream, sessionID, source, pluginID });
}
