import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shelbyWriteGate } from '../src/lib/shelby-write-gate.js';

const server = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('write gate returns one stable paused response and no error when enabled', () => {
  assert.equal(shelbyWriteGate(true), null);
  assert.deepEqual(shelbyWriteGate(false), {
    status: 503,
    body: {
      error: 'Shelby testnet writes are temporarily paused',
      code: 'shelby_writes_paused',
    },
  });
  assert.equal(Object.isFrozen(shelbyWriteGate(false).body), true);
});

test('every paid registration and multipart write route checks the gate first', () => {
  const routes = [
    ["app.post('/api/shelby/register'", "app.post('/api/shelby/uploads'"],
    ["app.post('/api/shelby/uploads'", 'app.put('],
    ["'/api/shelby/uploads/:uploadId/parts/:partIdx'", "app.post('/api/shelby/uploads/:uploadId/complete'"],
    ["app.post('/api/shelby/uploads/:uploadId/complete'", '// ---- Delete'],
  ];
  for (const [startMarker, endMarker] of routes) {
    const start = server.indexOf(startMarker);
    const end = server.indexOf(endMarker, start + startMarker.length);
    const route = server.slice(start, end);
    const gate = route.indexOf('if (!requireShelbyWrites(res)) return;');
    const upstream = Math.min(
      ...['validatePaidUploadBody', 'shelbyGateway.start', 'shelbyGateway.uploadPart', 'shelbyGateway.complete']
        .map((marker) => route.indexOf(marker))
        .filter((position) => position >= 0),
    );
    assert.equal(start >= 0 && gate >= 0 && gate < upstream, true, startMarker);
  }
});

test('browser config exposes only the boolean write gate', () => {
  const start = server.indexOf("app.get('/api/config'");
  const end = server.indexOf('// ---- Five-minute', start);
  const route = server.slice(start, end);
  assert.match(route, /shelbyWritesEnabled:\s*config\.shelbyWritesEnabled/);
  assert.doesNotMatch(route, /shelbyApiKey:\s*config\.shelbyApiKey/);
});
