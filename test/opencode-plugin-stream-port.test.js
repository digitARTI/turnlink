import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createOpenCodePluginStreamPort } from '../src/opencode-plugin-stream-port.js';

test('stream port accepts fragmented frames and closes on an oversized frame', async () => {
  const input = new PassThrough(), output = new PassThrough(), port = createOpenCodePluginStreamPort({ input, output });
  const payload = Buffer.from(JSON.stringify({ sample: 'synthetic' })), header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
  const received = once(port, 'message'); input.write(header.subarray(0, 2)); input.write(Buffer.concat([header.subarray(2), payload]));
  assert.deepEqual((await received)[0], { sample: 'synthetic' });
  const closed = once(port, 'close'), bad = Buffer.alloc(4); bad.writeUInt32BE(1024 * 1024 + 1); input.write(bad); await closed;
  assert.throws(() => port.postMessage({}), /PLUGIN_STREAM_UNAVAILABLE/);
});

test('stream port emits length-prefixed JSON', async () => {
  const input = new PassThrough(), output = new PassThrough(), port = createOpenCodePluginStreamPort({ input, output });
  const data = once(output, 'data'); port.postMessage({ n: 1 }); const [frame] = await data;
  assert.equal(frame.readUInt32BE(0), frame.length - 4); assert.deepEqual(JSON.parse(frame.subarray(4)), { n: 1 }); port.close();
});
