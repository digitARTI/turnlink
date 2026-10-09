// Extract only identifiers/timestamps for one known channel test; never dump chat logs.
import { readdirSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const sessionId = process.argv[2];
const messageId = process.argv[3];
const when = Date.parse(process.argv[4]);
if (!sessionId || !messageId || !Number.isFinite(when)) throw new Error('Usage: wake-evidence sessionId messageUUID createdAt');
const root = 'C:\\Users\\Administrator\\.codex\\sessions';
function search(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...search(path));
    else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}
const found = search(root);
const evidence = [];
for (const path of found) {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const prefixTime = Date.parse(line.slice(0, 250).match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1]);
    if (!Number.isFinite(prefixTime) || prefixTime < when - 5000 || prefixTime > when + 60000 || line.length > 2000000) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const payload = event.payload || {};
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time) || time < when - 5000 || time > when + 60000) continue;
    if (event.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(payload.type)) {
      evidence.push({ timestamp: event.timestamp, type: payload.type, turnId: payload.turn_id || null });
    } else if (event.type === 'turn_context') {
      evidence.push({ timestamp: event.timestamp, type: 'turn_context', turnId: payload.turn_id || null });
    } else if ((event.type === 'event_msg' && payload.type === 'user_message') || (event.type === 'response_item' && payload.role === 'user')) {
      if (JSON.stringify(payload).includes(messageId)) evidence.push({ timestamp: event.timestamp, type: 'channel_test_input', matchedMessageId: messageId });
    }
  }
}
console.log(JSON.stringify({ sessionId, matchingSessionFiles: found.length, evidence }, null, 2));
