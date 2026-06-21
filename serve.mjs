import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');
const port = 8081;
const mime = {
  '.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'application/javascript;charset=utf-8',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'
};

http.createServer((req, res) => {
  let urlPath = req.url === '/' ? 'index.html' : req.url.replace(/\?.*/, '');
  let p = path.join(root, decodeURIComponent(urlPath));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(p).toLowerCase();
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('Server at http://127.0.0.1:' + port));

