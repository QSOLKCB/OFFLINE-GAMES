// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {root, siteFiles, precacheList, swFilesLine} from '../scripts/site.mjs';

const read = file => readFileSync(join(root, file), 'utf8');

test('the service worker precaches exactly the published site', async () => {
  const sw = read('sw.js'), list = await precacheList();
  assert.ok(sw.includes(swFilesLine(list)), 'sw.js FILES is stale: run `node scripts/site.mjs sync-sw`');
  assert.ok(sw.includes("const VERSION = 'dev';"), 'the version marker the build stamps is present');
  execFileSync(process.execPath, ['--check', join(root, 'sw.js')]); // a worker that fails to parse silently disables offline play
  for (const entry of list) assert.ok(existsSync(join(root, entry.endsWith('/') ? entry + 'index.html' : entry)), entry);
  assert.ok(list.includes('./VAGRANT_STARS/js/app.js') && list.includes('./VAGRANT_STARS/vendor/vanillajs/modules/flight/index.js'));
});

test('published pages only reference files that are published', async () => {
  const files = new Set(await siteFiles());
  const check = (page, dir) => {
    for (const [, ref] of read(page).matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^https?:/.test(ref)) continue;
      let path = join(dir, ref).replaceAll('\\', '/');
      if (path === '.' || ref.endsWith('/')) path = join(path, 'index.html').replaceAll('\\', '/');
      assert.ok(files.has(path), `${page} -> ${ref}`);
    }
  };
  check('index.html', '.'); check('VAGRANT_STARS/index.html', 'VAGRANT_STARS');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './'); for (const icon of manifest.icons) assert.ok(files.has(icon.src));
});

test('every module import resolves to a published file', async () => {
  const files = new Set(await siteFiles());
  for (const file of files) {
    if (!file.endsWith('.js') || file === 'sw.js') continue;
    for (const [, ref] of read(file).matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(files.has(join(file, '..', ref).replaceAll('\\', '/')), `${file} imports ${ref}`);
  }
});

test('game runtime makes no network requests and loads nothing from elsewhere', async () => {
  for (const file of await siteFiles()) {
    if (!/\.(js|html|css)$/.test(file) || file.includes('/vendor/')) continue;
    const text = read(file);
    if (file !== 'sw.js') assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, `${file} talks to the network`);
    for (const [, url] of text.matchAll(/(?:src|href)="(https?:[^"]+)"/g)) assert.match(url, /^https:\/\/github\.com\/QSOLKCB\//, `${file} links only to the project's repositories`);
    assert.doesNotMatch(text, /<script[^>]+src="https?:|@import\s+url\(|<link[^>]+href="https?:/, file);
  }
});

test('the build stages the site and stamps the service worker', async () => {
  const out = '_site_test';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/site.mjs'), 'build', out, 'abc123def456'], {cwd: root});
    for (const file of await siteFiles()) assert.ok(existsSync(join(root, out, file)), file);
    assert.ok(readFileSync(join(root, out, 'sw.js'), 'utf8').includes("const VERSION = 'abc123def456';"));
    assert.ok(!existsSync(join(root, out, 'package.json')) && !existsSync(join(root, out, 'VAGRANT_STARS/tests')), 'tooling and tests are not published');
  } finally { rmSync(join(root, out), {recursive: true, force: true}); }
});
