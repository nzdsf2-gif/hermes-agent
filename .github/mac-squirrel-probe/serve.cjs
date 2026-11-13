// Loopback Squirrel.Mac server: /feed/<name> answers the default-server JSON naming /zip/<name>.zip.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const [dir, log] = process.argv.slice(2);
const record = (fields) => fs.appendFileSync(log, `${JSON.stringify({ t: new Date().toISOString(), ...fields })}\n`);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const feed = url.pathname.match(/^\/feed\/([a-z0-9]+)$/);
  if (feed) {
    const body = JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}/zip/${feed[1]}.zip`,
      name: '9.9.9', notes: '', pub_date: '2026-11-13T00:00:00Z',
    });
    record({ method: req.method, path: url.pathname, status: 200 });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  const zip = url.pathname.match(/^\/zip\/([a-z0-9]+\.zip)$/);
  if (zip) {
    const file = path.join(dir, zip[1]);
    const size = fs.statSync(file).size;
    let sent = 0;
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': size });
    const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => { sent += chunk.length; });
    res.on('close', () => record({ method: req.method, path: url.pathname, size, sent, finished: res.writableFinished }));
    stream.pipe(res);
    return;
  }
  record({ method: req.method, path: url.pathname, status: 404 });
  res.writeHead(404);
  res.end();
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(dir, 'port'), String(server.address().port)));
