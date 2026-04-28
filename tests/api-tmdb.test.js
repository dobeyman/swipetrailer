import { test } from 'node:test';
import assert from 'node:assert';
import { createTmdbClient } from '../public/js/api/tmdb.js';

function makeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const matched = responses.find((r) => url.includes(r.match));
    if (!matched) throw new Error(`No mock for ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => matched.body,
    };
  };
  fn.calls = calls;
  return fn;
}

test('loadGenres calls both movie and tv genre lists once', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/tmdb/genre/movie/list', body: { genres: [{ id: 28, name: 'Action' }] } },
    { match: '/api/tmdb/genre/tv/list', body: { genres: [{ id: 18, name: 'Drame' }] } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const map = await client.loadGenres();
  assert.strictEqual(map.get('movie:28'), 'Action');
  assert.strictEqual(map.get('tv:18'), 'Drame');
  assert.strictEqual(fetchImpl.calls.length, 2);

  // Second call uses cache
  await client.loadGenres();
  assert.strictEqual(fetchImpl.calls.length, 2);
});

test('fetchTrending picks endpoint based on filter', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/tmdb/trending/all/week', body: { results: [], total_pages: 1 } },
    { match: '/api/tmdb/trending/movie/week', body: { results: [], total_pages: 1 } },
    { match: '/api/tmdb/trending/tv/week', body: { results: [], total_pages: 1 } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  await client.fetchTrending(1, 'all');
  await client.fetchTrending(1, 'movie');
  await client.fetchTrending(1, 'tv');
  assert.match(fetchImpl.calls[0], /\/trending\/all\/week/);
  assert.match(fetchImpl.calls[1], /\/trending\/movie\/week/);
  assert.match(fetchImpl.calls[2], /\/trending\/tv\/week/);
});

test('fetchTrending normalizes items', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/trending/all/week',
      body: {
        results: [
          {
            id: 100,
            media_type: 'movie',
            title: 'Dune',
            overview: 'Synopsis',
            release_date: '2021-09-15',
            genre_ids: [28],
            vote_average: 8.0,
            poster_path: '/p.jpg',
            backdrop_path: '/b.jpg',
          },
          {
            id: 200,
            media_type: 'tv',
            name: 'Foundation',
            overview: 'Synopsis tv',
            first_air_date: '2021-09-24',
            genre_ids: [18],
            vote_average: 7.5,
            poster_path: '/p2.jpg',
            backdrop_path: '/b2.jpg',
          },
        ],
        total_pages: 5,
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const { items, totalPages } = await client.fetchTrending(1, 'all');
  assert.strictEqual(totalPages, 5);
  assert.strictEqual(items[0].id, 'movie-100');
  assert.strictEqual(items[0].mediaType, 'movie');
  assert.strictEqual(items[0].title, 'Dune');
  assert.strictEqual(items[0].year, 2021);
  assert.strictEqual(items[1].id, 'tv-200');
  assert.strictEqual(items[1].title, 'Foundation');
});

test('fetchTrailerKey returns first FR trailer', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/movie/100/videos',
      body: {
        results: [
          { iso_639_1: 'en', type: 'Trailer', site: 'YouTube', key: 'EN1', official: true },
          { iso_639_1: 'fr', type: 'Trailer', site: 'YouTube', key: 'FR1', official: true },
          { iso_639_1: 'fr', type: 'Teaser', site: 'YouTube', key: 'FR2', official: false },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('movie', 100);
  assert.strictEqual(key, 'FR1');
});

test('fetchTrailerKey falls back to EN if no FR', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/tv/200/videos',
      body: {
        results: [
          { iso_639_1: 'es', type: 'Trailer', site: 'YouTube', key: 'ES1' },
          { iso_639_1: 'en', type: 'Trailer', site: 'YouTube', key: 'EN1', official: true },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('tv', 200);
  assert.strictEqual(key, 'EN1');
});

test('fetchTrailerKey returns null when no YouTube trailer', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/movie/300/videos',
      body: {
        results: [
          { iso_639_1: 'fr', type: 'Trailer', site: 'Vimeo', key: 'XX' },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('movie', 300);
  assert.strictEqual(key, null);
});
