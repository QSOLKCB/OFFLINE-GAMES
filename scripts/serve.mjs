// SPDX-License-Identifier: Apache-2.0
// Zero-dependency static server for local play: `npm start`, then open the printed address.
// Browsers do not load ES modules from file://, so the games need any plain HTTP server.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8'};

export function createStaticServer(directory = root) {
  return createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = normalize(join(directory, path));
      if (file !== directory && !file.startsWith(directory + sep)) throw Object.assign(new Error('forbidden'), {code: 403});
      if ((await stat(file)).isDirectory()) {
        if (!path.endsWith('/')) { response.writeHead(301, {Location: path + '/'}); return response.end(); }
        file = join(file, 'index.html');
      }
      const body = await readFile(file);
      response.writeHead(200, {'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 403 ? 403 : 404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end(error.code === 403 ? 'Forbidden' : 'Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createStaticServer().listen(port, '127.0.0.1', () => console.log(`OFFLINE GAMES at http://127.0.0.1:${port}/`));
}
