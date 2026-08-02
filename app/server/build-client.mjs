import esbuild from 'esbuild';
import fs from 'node:fs';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';

// The Clay erasure-coding WASM (clay-codes) loads via `new URL("./clay.wasm", import.meta.url)`.
// In an IIFE bundle import.meta.url is invalid → "Invalid URL". Serve the wasm from our own origin
// and redirect import.meta.url to it. Fallback path (arrayBuffer) covers wrong MIME on static hosts.
fs.copyFileSync('node_modules/@shelby-protocol/clay-codes/dist/clay.wasm', 'public/clay.wasm');

await esbuild.build({
  entryPoints: ['client-src/vessel-solana.js'],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  outfile: 'public/vessel-solana.js',
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'import.meta.url': 'globalThis.__vesselBase' },
  banner: { js: 'globalThis.__vesselBase = (typeof location !== "undefined" ? location.origin + "/" : "file:///");' },
  plugins: [NodeModulesPolyfillPlugin(), NodeGlobalsPolyfillPlugin({ buffer: true, process: true })],
  logLevel: 'error', legalComments: 'none',
});
const s = fs.statSync('public/vessel-solana.js');
console.log('BUNDLE OK ✅', (s.size/1024).toFixed(0), 'KB; clay.wasm', (fs.statSync('public/clay.wasm').size/1024).toFixed(0), 'KB');
