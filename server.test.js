import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from './server.js';

let app;
let server;
let baseUrl;
let originalFetch;

before(async () => {
  process.env.TMDB_API_KEY = 'fake-tmdb-key';
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  originalFetch = global.fetch;
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/tmdb/* forwards to api.themoviedb.org with api_key injected', async () => {
  let capturedUrl;
  global.fetch = async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await originalFetch(`${baseUrl}/api/tmdb/trending/all/week?language=fr-FR`);
  assert.strictEqual(res.status, 200);
  assert.match(capturedUrl, /^https:\/\/api\.themoviedb\.org\/3\/trending\/all\/week/);
  assert.match(capturedUrl, /api_key=fake-tmdb-key/);
  assert.match(capturedUrl, /language=fr-FR/);
});

test('GET /api/tmdb/* returns 503 when TMDB_API_KEY is missing', async () => {
  const oldKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = '';
  // Recreate app to pick up new env
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await originalFetch(`${baseUrl}/api/tmdb/trending/all/week`);
  assert.strictEqual(res.status, 503);
  process.env.TMDB_API_KEY = oldKey;
});

test('POST /api/seerr/api/v1/request forwards to SEERR_URL with X-Api-Key', async () => {
  process.env.SEERR_URL = 'http://overseerr.test';
  process.env.SEERR_API_KEY = 'fake-seerr-key';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  let capturedUrl, capturedHeaders, capturedBody, capturedMethod;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = opts.body;
    capturedMethod = opts.method;
    return new Response(JSON.stringify({ id: 42 }), { status: 201 });
  };

  const res = await originalFetch(`${baseUrl}/api/seerr/api/v1/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', mediaId: 100 }),
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(capturedMethod, 'POST');
  assert.strictEqual(capturedUrl, 'http://overseerr.test/api/v1/request');
  assert.strictEqual(capturedHeaders['X-Api-Key'], 'fake-seerr-key');
  assert.match(capturedBody.toString(), /"mediaType":"movie"/);
});

test('GET /api/seerr/* returns 503 when SEERR_URL or SEERR_API_KEY is missing', async () => {
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await originalFetch(`${baseUrl}/api/seerr/api/v1/movie/123`);
  assert.strictEqual(res.status, 503);
});

test('GET /api/health reflects env var presence', async () => {
  process.env.TMDB_API_KEY = 'present';
  process.env.SEERR_URL = 'http://x';
  process.env.SEERR_API_KEY = 'y';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await originalFetch(`${baseUrl}/api/health`);
  const json = await res.json();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(json, { tmdb: true, seerr: true, seerrType: 'overseerr' });
});

test('GET /api/health when TMDB missing', async () => {
  process.env.TMDB_API_KEY = '';
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await originalFetch(`${baseUrl}/api/health`);
  const json = await res.json();
  assert.deepStrictEqual(json, { tmdb: false, seerr: false, seerrType: 'overseerr' });
});
