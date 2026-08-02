import esbuild from 'esbuild';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';
await esbuild.build({
  entryPoints: ['client-src/vessel-solana.js'],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  outfile: 'public/vessel-solana.js',
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  plugins: [NodeModulesPolyfillPlugin(), NodeGlobalsPolyfillPlugin({ buffer: true, process: true })],
  logLevel: 'error', legalComments: 'none',
});
const s = (await import('node:fs')).statSync('public/vessel-solana.js');
console.log('BUNDLE OK ✅', (s.size/1024).toFixed(0), 'KB');
