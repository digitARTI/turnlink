import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

// A fixture-only SDK transport over the private socket inherited from the
// test controller. It provides no process ownership or cleanup proof.
const fd = Number(process.argv[2]);
assert.ok(Number.isSafeInteger(fd) && fd > 2);
const socket = new Socket({ fd, readable: true, writable: true });
const buffer = new ReadBuffer();
const transport = {
  async start() {
    socket.on('data', chunk => {
      try {
        buffer.append(chunk);
        for (let message; (message = buffer.readMessage()) !== null;) transport.onmessage?.(message);
      } catch (error) { transport.onerror?.(error); }
    });
    socket.on('error', error => transport.onerror?.(error));
    socket.on('close', () => transport.onclose?.());
  },
  async send(message) {
    await new Promise((resolve, reject) => socket.write(serializeMessage(message), error => error ? reject(error) : resolve()));
  },
  async close() { socket.destroy(); },
};
const client = new Client({ name: 'launchd-fixture-client', version: '1' });
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, 'fixture_echo');
  assert.equal((await client.callTool({ name: 'fixture_echo', arguments: {} })).content[0].text, 'fixture result');
  const delegated = await client.callTool({ name: 'fixture_delegate', arguments: {} });
  if (process.env.TURNLINK_EXPECT_DELEGATION_DENIED === '1') {
    assert.equal(delegated.isError, true);
    assert.equal(delegated.content[0].text, 'delegation failed');
    console.log('MCP fixture delegation denied');
  } else {
    assert.equal(delegated.content[0].text, 'fixture delegated');
  }
  console.log('MCP SDK initialization, discovery and tool calls passed');
} finally {
  await client.close();
}
