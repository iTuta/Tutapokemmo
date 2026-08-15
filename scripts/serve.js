const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || 4173;
// Pass 0.0.0.0 as the second argument when testing from a phone on the LAN.
const host = process.argv[3] || process.env.SERVE_HOST || '127.0.0.1';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);

  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    const resolvedPath = !statError && stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(resolvedPath, (readError, data) => {
      if (readError) {
        res.writeHead(404).end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentTypes[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`);
});
