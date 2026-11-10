// SPDX-License-Identifier: Apache-2.0
// The single list of files that make up the published site. Used to stage the GitHub Pages
// artifact, to keep the service worker's offline list honest, and by the tests.
//   node scripts/site.mjs build [outDir] [version]   stage the site (default: _site, "dev")
//   node scripts/site.mjs sync-sw                     rewrite the FILES list inside sw.js
import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TOP = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'LICENSE', 'NOTICE', 'assets'];
const GAMES = {VAGRANT_STARS: ['index.html', 'style.css', 'README.md', 'NOTICE.md', 'js', 'vendor']};

async function walk(path) {
  const entries = await readdir(join(root, path), {withFileTypes: true}).catch(() => null);
  if (!entries) return [path];
  const out = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) out.push(...(e.isDirectory() ? await walk(`${path}/${e.name}`) : [`${path}/${e.name}`]));
  return out;
}
/** Every published file, as sorted site-relative paths. */
export async function siteFiles() {
  const out = [];
  for (const item of TOP) out.push(...await walk(item));
  for (const [game, items] of Object.entries(GAMES)) for (const item of items) out.push(...await walk(`${game}/${item}`));
  return out.sort();
}
/** URLs the service worker precaches: every file except itself, plus the directory entry points. */
export async function precacheList() {
  const files = (await siteFiles()).filter(f => f !== 'sw.js' && f !== '.nojekyll');
  return ['./', ...Object.keys(GAMES).map(g => `./${g}/`), ...files.map(f => `./${f}`)];
}
const FILES_PATTERN = /const FILES = \[[^\]]*\];/;
export const swFilesLine = list => `const FILES = [${list.map(f => `'${f}'`).join(', ')}];`;

async function build(out = '_site', version = 'dev') {
  const target = resolve(root, out);
  if (target === root || !target.startsWith(root)) throw new Error('output must be a directory inside the repository');
  await rm(target, {recursive: true, force: true});
  for (const file of await siteFiles()) { await mkdir(dirname(join(target, file)), {recursive: true}); await cp(join(root, file), join(target, file)); }
  const sw = await readFile(join(target, 'sw.js'), 'utf8');
  if (!sw.includes("const VERSION = 'dev';")) throw new Error('sw.js has no VERSION marker');
  await writeFile(join(target, 'sw.js'), sw.replace("const VERSION = 'dev';", `const VERSION = '${version.replace(/[^\w.-]/g, '')}';`));
  console.log(`staged ${(await siteFiles()).length} files in ${out} (version ${version})`);
}
async function syncSw() {
  const path = join(root, 'sw.js'), sw = await readFile(path, 'utf8');
  if (!FILES_PATTERN.test(sw)) throw new Error('sw.js has no FILES list');
  await writeFile(path, sw.replace(FILES_PATTERN, swFilesLine(await precacheList())));
  console.log('sw.js FILES list updated');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  await (command === 'build' ? build(...args) : command === 'sync-sw' ? syncSw() : Promise.reject(new Error('usage: site.mjs build [outDir] [version] | sync-sw')));
}
