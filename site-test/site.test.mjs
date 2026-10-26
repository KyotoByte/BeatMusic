import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const SITE = new URL('../site/', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(SITE, p), 'utf8');

test('deployable files exist', () => {
  for (const f of ['index.html', '404.html', '.nojekyll', 'README.md', 'LICENSE.txt', 'manifest.webmanifest', 'sw.js', 'css/app.css',
    'js/app.js', 'js/api.js', 'js/player.js', 'js/lyrics.js', 'js/youtube.js', 'js/store.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'])
    assert.ok(fs.existsSync(path.join(SITE, f)), f);
});
test('all local references are relative and resolve (works under /BeatMusic/)', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /<title>BeatMusic<\/title>/);
  const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  for (const r of refs) { assert.ok(!r.startsWith('/'), 'absolute path ' + r); assert.ok(fs.existsSync(path.join(SITE, r)), 'missing ' + r); }
});
test('branding rules', () => {
  const all = ['index.html', 'css/app.css', 'js/app.js', 'README.md'].map(read).join('\n');
  assert.ok(!/Apple Music/i.test(all), 'no "Apple Music" name');
  assert.ok(!/SF Pro|San Francisco/i.test(all), 'no Apple fonts');
  const ui = read('index.html') + read('404.html') + read('js/app.js') + read('js/player.js') + read('js/lyrics.js') + read('manifest.webmanifest');
  assert.ok(!/BitChord|Better fork|kushagrasinghx/i.test(ui), 'no upstream credit in the site UI (credit lives in the GitHub README)');
  assert.ok(read('index.html').includes('href="LICENSE.txt"'), 'sidebar keeps a Licence link');
  assert.ok(read('js/app.js').includes('href="LICENSE.txt"'), 'Settings keeps a Licence link');
  assert.ok(ui.includes('https://github.com/KyotoByte'));
});
test('LRC parsing', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.navigator ??= { language: 'en-IN' };
  const { parseLRC } = await import('../site/js/lyrics.js');
  const l = parseLRC('[offset:+500]\n[00:10.50]Hello\n[00:12.00][01:02.25]Twice\n[00:15.00]\n[00:16.00]\n[00:20.1]End');
  assert.deepEqual(l.map((x) => x.text), ['Hello', 'Twice', '', 'End', 'Twice']);
  assert.equal(l[0].t, 10);
  assert.equal(l.at(-1).t, 61.75);
});
