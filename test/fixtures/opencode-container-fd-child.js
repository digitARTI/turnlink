import { createReadStream, createWriteStream } from 'node:fs';

const input = createReadStream('', { fd: 3, autoClose: true });
const output = createWriteStream('', { fd: 3, autoClose: false });
input.on('error', () => {}); output.on('error', () => {});
process.stdout.write(`${JSON.stringify({ url: 'http://127.0.0.1:12345' })}\n`);
input.once('data', data => { output.write(Buffer.from(`reply:${data.toString()}`), () => { output.destroy(); input.destroy(); }); });
