const http = require('node:http');
http.createServer((request, response) => {
  if (request.headers.authorization !== `Basic ${Buffer.from(`opencode:${'a'.repeat(43)}`).toString('base64')}`) {
    response.writeHead(401).end(); return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' }).end('isolated-native');
}).listen(31234, '127.0.0.1');
