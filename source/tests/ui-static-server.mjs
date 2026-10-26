import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist/client');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname), target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root)) { response.writeHead(403); response.end('forbidden'); return; }
    const body = await readFile(target);
    response.setHeader('Content-Type', contentTypes[path.extname(target)] || 'application/octet-stream');
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
}).listen(4178, '0.0.0.0', () => console.log('UI regression server listening on 4178'));
