// Run only inside the network-isolated owner container. This stream forwards
// to its own loopback and never accepts a host or address from the peer.
const net = require('node:net');
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535 || process.argv.length !== 3) process.exit(1);
const target = net.createConnection({ host: '127.0.0.1', port });
const fail = () => { target.destroy(); process.stdin.destroy(); process.exitCode = 1; };
target.on('error', fail); process.stdin.on('error', fail); process.stdout.on('error', fail);
target.once('connect', () => { process.stdin.pipe(target); target.pipe(process.stdout); });
target.once('close', () => process.stdin.destroy());
