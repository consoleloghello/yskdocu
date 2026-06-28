import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8081;
const mime = {
  '.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'application/javascript;charset=utf-8',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'
};

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${ts}] ${level} ${msg}\n`);
}

http.createServer((req, res) => {
  try {
    let urlPath = req.url === '/' ? 'index.html' : req.url.replace(/\?.*/, '');
    let p = path.join(root, decodeURIComponent(urlPath));
    if (!p.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); log('WARN', `403 ${req.url}`); return; }
    const ext = path.extname(p).toLowerCase();
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); log('WARN', `404 ${req.url}`); return; }
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
      log('INFO', `200 ${req.url}`);
    });
  } catch (e) {
    res.writeHead(400); res.end('Bad Request');
    log('ERROR', `400 ${req.url} — ${e.message}`);
  }
}).listen(port, () => console.log('Server at http://127.0.0.1:' + port));

