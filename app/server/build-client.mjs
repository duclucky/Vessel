import esbuild from 'esbuild';
import fs from 'node:fs';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';

// The Clay erasure-coding WASM (clay-codes) loads via `new URL("./clay.wasm", import.meta.url)`.
// In an IIFE bundle import.meta.url is invalid. Serve the wasm from our own origin and redirect
// import.meta.url to it. The fallback path (arrayBuffer) covers wrong MIME on static hosts.
fs.copyFileSync('node_modules/@shelby-protocol/clay-codes/dist/clay.wasm', 'public/clay.wasm');

const sharedBuildOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': 'globalThis.__vesselBase',
  },
  banner: {
    js: 'globalThis.__vesselBase = (typeof location !== "undefined" ? location.origin + "/" : "file:///");',
  },
  plugins: [
    NodeModulesPolyfillPlugin(),
    NodeGlobalsPolyfillPlugin({ buffer: true, process: true }),
  ],
  logLevel: 'error',
  legalComments: 'none',
};

await Promise.all([
  esbuild.build({
    ...sharedBuildOptions,
    entryPoints: ['client-src/vessel-solana.js'],
    outfile: 'public/vessel-solana.js',
  }),
  esbuild.build({
    ...sharedBuildOptions,
    entryPoints: ['client-src/vessel-wallets.js'],
    outfile: 'public/vessel-wallets.js',
  }),
]);

// Some upstream SDK error strings contain spaces before physical newlines. They are
// harmless at runtime but make committed browser artifacts fail `git diff --check`.
for (const file of ['public/vessel-solana.js', 'public/vessel-wallets.js']) {
  const generated = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, generated.replace(/[ \t]+$/gm, ''));
}

const bundleSizes = ['vessel-solana.js', 'vessel-wallets.js']
  .map((file) => `${file} ${(fs.statSync(`public/${file}`).size / 1024).toFixed(0)} KB`)
  .join('; ');
const claySize = (fs.statSync('public/clay.wasm').size / 1024).toFixed(0);
console.log(`BUNDLE OK: ${bundleSizes}; clay.wasm ${claySize} KB`);
