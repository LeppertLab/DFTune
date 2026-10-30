// Builds the webview + harness and serves the repo at http://localhost:5173/test/harness/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';

const root = process.cwd();
const port = Number(process.env.PORT ?? 5173);

await esbuild.build({
  entryPoints: ['test/harness/harness.ts'],
  outfile: 'dist/harness.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
});
await import('../../esbuild.mjs');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`Harness at http://localhost:${port}/test/harness/`));
