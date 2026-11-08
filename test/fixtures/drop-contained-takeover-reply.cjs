// Loaded only into the CLI process by the opt-in integration test. The broker
// has already persisted the rotation before this response reaches send().
const WebSocket = require('ws');
const original = WebSocket.prototype.send;
let dropped = false;
WebSocket.prototype.send = function (data, ...args) {
  if (!dropped) try {
    const frame = JSON.parse(String(data));
    if (frame.result?.transferred === true && typeof frame.result.transitionID === 'string') {
      dropped = true; process.stderr.write('TEST_TAKEOVER_REPLY_DROPPED\n'); return;
    }
  } catch {}
  return original.call(this, data, ...args);
};
