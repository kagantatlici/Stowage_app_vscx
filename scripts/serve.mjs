import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const port = process.env.PORT ? Number(process.env.PORT) : 5173;

const mime = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.mjs': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  let filePath = path.join(root, urlPath);

  // Default to index.html for root or directories
  if (urlPath === '/' || urlPath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!path.extname(filePath)) {
    filePath += '.html';
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = mime[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});

