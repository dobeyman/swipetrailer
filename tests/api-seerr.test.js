import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSeerrClient,
  AlreadyRequestedError,
  UnauthorizedError,
  UnreachableError,
  NotConfiguredError,
} from '../public/js/api/seerr.js';

function makeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const matched = responses.find((r) => url.includes(r.match));
    if (!matched) throw new Error(`No mock for ${url}`);
    if (matched.throw) throw matched.throw;
    return {
      ok: matched.status >= 200 && matched.status < 300,
      status: matched.status,
      json: async () => matched.body,
      text: async () => JSON.stringify(matched.body),
    };
  };
  fn.calls = calls;
  return fn;
}

test('requestMedia POSTs the right body and returns parsed JSON on 201', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 201, body: { id: 7 } },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.requestMedia({ mediaType: 'movie', mediaId: 100 });
  assert.deepStrictEqual(out, { id: 7 });
  assert.strictEqual(fetchImpl.calls[0].opts.method, 'POST');
  assert.match(fetchImpl.calls[0].opts.body, /"mediaType":"movie"/);
  assert.match(fetchImpl.calls[0].opts.body, /"mediaId":100/);
});

test('requestMedia throws AlreadyRequestedError on 409', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 409, body: { message: 'exists' } },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    AlreadyRequestedError
  );
});

test('requestMedia throws UnauthorizedError on 401/403', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 401, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    UnauthorizedError
  );
});

test('requestMedia throws UnreachableError on 5xx', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 503, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    UnreachableError
  );
});

test('requestMedia throws NotConfiguredError when disabled', async () => {
  const fetchImpl = makeFetch([]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: false });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    NotConfiguredError
  );
});

test('fetchMediaDetails returns null on 404 or error', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/movie/999', status: 404, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.fetchMediaDetails('movie', 999);
  assert.strictEqual(out, null);
});

test('fetchMediaDetails returns parsed JSON on 200', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/seerr/api/v1/movie/100',
      status: 200,
      body: {
        id: 100,
        mediaInfo: { status: 5 },
        releaseDates: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: '2026-03-15' }] }] },
      },
    },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.fetchMediaDetails('movie', 100);
  assert.strictEqual(out.mediaInfo.status, 5);
  assert.ok(out.releaseDates);
});

test('fetchMediaDetails returns null when disabled', async () => {
  const client = createSeerrClient({ fetch: () => {}, enabled: false });
  const out = await client.fetchMediaDetails('movie', 100);
  assert.strictEqual(out, null);
});
