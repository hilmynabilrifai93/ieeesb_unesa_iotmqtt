import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distMode = process.argv.includes('--dist');
const root = distMode ? path.join(project, 'dist') : project;
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = http.request({ hostname: '127.0.0.1', port: 3000, path: req.url, method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(503); res.end('Login API unavailable'); });
    req.pipe(proxy); return;
  }
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const developmentVendor = !distMode && relative === 'vendor/mqtt.esm.js';
    const filename = developmentVendor
      ? path.join(project, 'node_modules/mqtt/dist/mqtt.esm.js')
      : path.resolve(root, relative);
    const inside = developmentVendor ? '' : path.relative(root, filename);
    const allowed = relative === 'index.html'
      || relative === 'favicon.svg'
      || relative === 'vendor/mqtt.esm.js'
      || relative.startsWith('src/')
      || relative.startsWith('assets/');
    if (!allowed || (!developmentVendor && (inside.startsWith('..') || path.isAbsolute(inside)))) { res.writeHead(404); res.end('Not found'); return; }
    if (!(await stat(filename)).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', (error) => { console.error(`Preview gagal: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Lab IoT tersedia di http://localhost:${port}`));
