import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.pdf':'application/pdf', '.xml':'application/xml', '.txt':'text/plain' };
const server = http.createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (path.split('/').some(part => part.startsWith('.')) || !/\.(html|css|js|svg|png|pdf|xml|txt)$/.test(path) || path.startsWith('/workers/')) {
      response.writeHead(404).end('Not found'); return;
    }
    const filename = resolve(root, `.${path}`);
    if (!filename.startsWith(root + '/')) { response.writeHead(403).end(); return; }
    const body = await readFile(filename);
    response.writeHead(200, { 'Content-Type':mime[extname(filename)], 'Cache-Control':'no-store' }).end(body);
  } catch {
    response.writeHead(404, { 'Content-Type':'text/html' }).end(await readFile(resolve(root, '404.html')));
  }
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173/'));
