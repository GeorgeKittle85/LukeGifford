#!/usr/bin/env node
// Builds dist/kittle-skies.html: the whole game (code, styles, Leaflet and the
// offline world map) in ONE file you can double-click and play from disk.
// Browsers block ES modules on file:// URLs, so this bundles them with esbuild.
//
//   npm install && npm run build:offline

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');
// Inline scripts must not contain a literal closing script tag.
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

const bundle = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'inline',
});
const appJs = bundle.outputFiles[0].text;

const html = await read('index.html');
const styles = (await Promise.all([
  'vendor/leaflet/leaflet.css', 'css/base.css', 'css/layout.css', 'css/components.css', 'css/map.css',
].map(read))).join('\n');
const leaflet = await read('vendor/leaflet/leaflet.js');
const bootCheck = await read('src/boot-check.js');
const icon = `data:image/svg+xml;base64,${Buffer.from(await read('assets/icons/icon.svg')).toString('base64')}`;

let out = html
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" type="image/svg+xml">`)
  .replace('</head>', () => `  <style>\n${styles}\n  </style>\n</head>`)
  .replace('<script src="src/boot-check.js"></script>', () => `<script>window.KS_SINGLE_FILE = true;</script>\n  <script>${safeScript(bootCheck)}</script>`)
  .replace('<script src="vendor/leaflet/leaflet.js"></script>', () => `<script>${safeScript(leaflet)}</script>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>${safeScript(appJs)}</script>`);

for (const leftover of ['src/main.js', 'vendor/leaflet/leaflet.js', 'css/base.css']) {
  if (out.includes(leftover)) throw new Error(`Build failed to inline ${leftover}`);
}

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/kittle-skies.html'), out);
console.log(`Built dist/kittle-skies.html (${(out.length / 1024 / 1024).toFixed(2)} MB). Double-click it to play offline.`);
