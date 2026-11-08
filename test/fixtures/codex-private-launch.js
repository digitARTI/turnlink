import { createInterface } from 'node:readline';
import { Socket } from 'node:net';

const send = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
const index = process.argv.indexOf('--native-continuity-control-fd');
let privateStream;
if (index >= 0) {
  privateStream = new Socket({ fd: Number(process.argv[index + 1]), readable: true, writable: true });
  privateStream.on('error', () => {});
  privateStream.on('end', () => send({ method: 'fixture/private-closed' }));
}
send({ method: 'fixture/launch', params: { privateDescriptor: index >= 0 ? process.argv[index + 1] : null,
  nativeFlagLeaked: process.env.AGENT_CHANNEL_CODEX_NATIVE_CONTROL !== undefined,
  adapterTokenLeaked: process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE !== undefined,
  brokerTokenLeaked: process.env.AGENT_CHANNEL_TOKEN !== undefined,
  ...(process.env.TURNLINK_DESTINATION_LEAK_CHECK === '1' ? { destinationFileLeaked: process.env.AGENT_CHANNEL_CODEX_DESTINATION_FILE !== undefined,
    sourceFileLeaked: process.env.AGENT_CHANNEL_CODEX_SOURCE_FILE !== undefined,
    containedRecoveryFileLeaked: process.env.AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE !== undefined } : {}) } });
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.method === 'fixture/bad-private-reply') privateStream?.write('{"id":123,"result":"PRIVATE_FRAME_MUST_NOT_REACH_EDITOR"}\n');
  send({ id: frame.id, result: {} });
});
