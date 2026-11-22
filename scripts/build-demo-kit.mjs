#!/usr/bin/env node
/**
 * Build the demo kit runtime (lib/demo-kit/core) into
 * public/vendor/interactive/demo-kit@1/demo-kit.js.
 *
 * Demo scenes are interactive scenes whose HTML is a fixed shell: a
 * `<script type="application/json" id="demo-spec">` block and one script tag
 * loading this file (docs/fork-plan/PLAN.md, section C3). The bundle carries
 * three and gsap, so the sandboxed iframe needs nothing else.
 *
 * The output is a gitignored build artifact (public/vendor/interactive),
 * produced by `dev` and `build` after sync-interactive-assets, like
 * build-standalone-player.mjs. Rerun `node scripts/build-demo-kit.mjs` after
 * editing lib/demo-kit.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/vendor/interactive/demo-kit@1');

const result = await build({
  entryPoints: [path.join(root, 'lib/demo-kit/core/index.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
  logLevel: 'warning',
});
const text = result.outputFiles[0].text;
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'demo-kit.js'), text);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(`[demo-kit] demo-kit.js: ${kib(Buffer.byteLength(text))} (gzip ${kib(gzipSync(text).length)})`);
