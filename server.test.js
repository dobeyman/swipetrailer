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

test('GET /api/seerr/* returns 403 for endpoints not in allowlist', async () => {
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
  // Admin endpoints must be blocked
  const blocked = await Promise.all([
    originalFetch(`${baseUrl}/api/seerr/api/v1/settings/main`),
    originalFetch(`${baseUrl}/api/seerr/api/v1/user`),
  ]);
  for (const r of blocked) assert.strictEqual(r.status, 403);

  // Allowed endpoints must pass through (will 502 since overseerr.test is not real)
  const allowed = await Promise.all([
    originalFetch(`${baseUrl}/api/seerr/api/v1/movie/123`),
    originalFetch(`${baseUrl}/api/seerr/api/v1/tv/456`),
  ]);
  for (const r of allowed) assert.notStrictEqual(r.status, 403);
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

test('POST /api/auth/plex/pin returns pinId and authUrl', async () => {
  process.env.PLEX_CLIENT_ID = 'test-client-id';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  global.fetch = async (url, opts) => {
    assert.match(url, /plex\.tv\/api\/v2\/pins/);
    assert.strictEqual(opts.headers['X-Plex-Client-Identifier'], 'test-client-id');
    return new Response(JSON.stringify({ id: 42, code: 'ABCD1234' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };

  const res = await originalFetch(`${baseUrl}/api/auth/plex/pin`, { method: 'POST' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.pinId, 42);
  assert.match(body.authUrl, /app\.plex\.tv\/auth/);
  assert.match(body.authUrl, /ABCD1234/);
  assert.match(body.authUrl, /test-client-id/);
});

test('GET /api/auth/plex/callback returns pending when authToken is null', async () => {
  process.env.SEERR_URL = 'http://overseerr.test';
  process.env.SEERR_API_KEY = 'fake-key';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  global.fetch = async (url) => {
    assert.match(url, /plex\.tv\/api\/v2\/pins\/123/);
    return new Response(JSON.stringify({ id: 123, code: 'X', authToken: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const res = await originalFetch(`${baseUrl}/api/auth/plex/callback?pinId=123`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.pending, true);
});

test('GET /api/auth/plex/callback returns session and user when auth complete', async () => {
  let callCount = 0;
  global.fetch = async (url) => {
    callCount++;
    if (url.includes('plex.tv')) {
      return new Response(JSON.stringify({ id: 123, authToken: 'plex-token-xyz' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/auth/plex')) {
      return new Response(JSON.stringify({ id: 1, displayName: 'Alice' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'connect.sid=s%3Aabc123; Path=/; HttpOnly',
        },
      });
    }
    if (url.includes('/auth/me')) {
      return new Response(JSON.stringify({ id: 1, displayName: 'Alice', avatar: null }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = await originalFetch(`${baseUrl}/api/auth/plex/callback?pinId=123`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.session, 's%3Aabc123');
  assert.strictEqual(body.user.name, 'Alice');
  assert.strictEqual(callCount, 3);
});

test('GET /api/auth/plex/callback returns 400 for non-numeric pinId', async () => {
  const res = await originalFetch(`${baseUrl}/api/auth/plex/callback?pinId=../evil`);
  assert.strictEqual(res.status, 400);
});

test('Seerr proxy uses Cookie header when X-Seerr-Session is present', async () => {
  process.env.SEERR_URL = 'http://overseerr.test';
  process.env.SEERR_API_KEY = 'admin-key';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  let capturedHeaders;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return new Response(JSON.stringify({ id: 1 }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  };

  const res = await originalFetch(`${baseUrl}/api/seerr/api/v1/request`, {
    method: 'POST',
    headers: {
      'X-Seerr-Session': 's%3Avalidsession12345',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mediaType: 'movie', mediaId: 1 }),
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(capturedHeaders['Cookie'], 'connect.sid=s%3Avalidsession12345');
  assert.ok(!capturedHeaders['X-Api-Key'], 'admin key must not be sent when session present');
});

test('Seerr proxy uses X-Api-Key when no session header', async () => {
  let capturedHeaders;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return new Response(JSON.stringify({ id: 2 }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  };

  const res = await originalFetch(`${baseUrl}/api/seerr/api/v1/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', mediaId: 1 }),
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(capturedHeaders['X-Api-Key'], 'admin-key');
  assert.ok(!capturedHeaders['Cookie']);
});

test('GET /api/seerr/api/v1/auth/me is allowed', async () => {
  global.fetch = async () => new Response(JSON.stringify({ id: 1, displayName: 'Alice' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  const res = await originalFetch(`${baseUrl}/api/seerr/api/v1/auth/me`, {
    headers: { 'X-Seerr-Session': 's%3Avalidsession12345' },
  });
  assert.strictEqual(res.status, 200);
});
