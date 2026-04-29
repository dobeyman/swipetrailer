# Mixed Feed Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single trending source in the feed with a multi-source pool (trending + top-rated + current releases) so content varies between sessions.

**Architecture:** A new `fetchMixed(page, filter)` function in `tmdb.js` fetches multiple TMDB endpoints in parallel, merges and deduplicates the results, and returns `{ items, totalPages }` — the same shape as `fetchTrending`. `feed.js` replaces its two `fetchTrending` calls with `fetchMixed` and gains deduplication on append. The Express wildcard proxy (`/api/tmdb/*`) already forwards any TMDB path, so no server changes are needed.

**Tech Stack:** Node.js 22, vanilla ES modules, `node:test` for tests, TMDB REST API v3.

---

### Task 1: Add `fetchMixed` to `tmdb.js`

**Files:**
- Modify: `public/js/api/tmdb.js`
- Test: `tests/api-tmdb.test.js`

Context: `tmdb.js` exports `createTmdbClient({ fetch: fetchImpl })`. The existing `fetchTrending(page, filter)` and `normalizeTmdbItem(raw, fallbackMediaType)` are already defined inside the factory. `fetchMixed` will be added alongside them and reuse both.

Sources per filter value:
- `'all'`    → fetchTrending(all) + movie/top_rated + movie/now_playing + tv/top_rated + tv/on_the_air
- `'movie'`  → fetchTrending(movie) + movie/top_rated + movie/now_playing
- `'tv'`     → fetchTrending(tv) + tv/top_rated + tv/on_the_air

- [ ] **Step 1: Write the 4 failing tests**

Append to `tests/api-tmdb.test.js`:

```js
test('fetchMixed merges results from all sources for filter=all', async () => {
  const fetchImpl = makeFetch([
    { match: '/trending/all/week',  body: { results: [{ id: 1, media_type: 'movie', title: 'A', release_date: '2021-01-01', genre_ids: [], vote_average: 7, poster_path: '/a.jpg', backdrop_path: null, overview: '' }], total_pages: 3 } },
    { match: '/movie/top_rated',    body: { results: [{ id: 2, title: 'B', release_date: '2020-01-01', genre_ids: [], vote_average: 8, poster_path: '/b.jpg', backdrop_path: null, overview: '' }], total_pages: 5 } },
    { match: '/movie/now_playing',  body: { results: [{ id: 3, title: 'C', release_date: '2024-01-01', genre_ids: [], vote_average: 7, poster_path: '/c.jpg', backdrop_path: null, overview: '' }], total_pages: 2 } },
    { match: '/tv/top_rated',       body: { results: [{ id: 4, name: 'D', first_air_date: '2020-01-01', genre_ids: [], vote_average: 8, poster_path: '/d.jpg', backdrop_path: null, overview: '' }], total_pages: 4 } },
    { match: '/tv/on_the_air',      body: { results: [{ id: 5, name: 'E', first_air_date: '2024-01-01', genre_ids: [], vote_average: 7, poster_path: '/e.jpg', backdrop_path: null, overview: '' }], total_pages: 3 } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const { items, totalPages } = await client.fetchMixed(1, 'all');
  assert.strictEqual(items.length, 5);
  assert.strictEqual(totalPages, 5); // max across sources
});

test('fetchMixed deduplicates items that appear in multiple sources', async () => {
  const shared = { id: 1, media_type: 'movie', title: 'Hit', release_date: '2024-01-01', genre_ids: [], vote_average: 8, poster_path: '/h.jpg', backdrop_path: null, overview: '' };
  const fetchImpl = makeFetch([
    { match: '/trending/movie/week', body: { results: [shared], total_pages: 1 } },
    { match: '/movie/top_rated',     body: { results: [shared], total_pages: 1 } },
    { match: '/movie/now_playing',   body: { results: [shared], total_pages: 1 } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const { items } = await client.fetchMixed(1, 'movie');
  assert.strictEqual(items.length, 1);
});

test('fetchMixed with filter=movie fetches only the 3 movie sources', async () => {
  const fetchImpl = makeFetch([
    { match: '/trending/movie/week', body: { results: [], total_pages: 1 } },
    { match: '/movie/top_rated',     body: { results: [], total_pages: 1 } },
    { match: '/movie/now_playing',   body: { results: [], total_pages: 1 } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  await client.fetchMixed(1, 'movie');
  assert.strictEqual(fetchImpl.calls.length, 3);
  assert.ok(fetchImpl.calls.every((url) => !url.includes('/tv/')));
});

test('fetchMixed ignores a failing source and returns results from the rest', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/tv/on_the_air')) throw new Error('network error');
    if (url.includes('/trending/tv/week')) return { ok: true, status: 200, json: async () => ({ results: [{ id: 10, name: 'Good Show', first_air_date: '2021-01-01', genre_ids: [], vote_average: 7, poster_path: '/g.jpg', backdrop_path: null, overview: '' }], total_pages: 2 }) };
    return { ok: true, status: 200, json: async () => ({ results: [], total_pages: 1 }) };
  };
  const client = createTmdbClient({ fetch: fetchImpl });
  const { items } = await client.fetchMixed(1, 'tv');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, 'tv-10');
});
```

- [ ] **Step 2: Run the tests — verify they fail with "client.fetchMixed is not a function"**

```bash
node --test --test-reporter=spec tests/api-tmdb.test.js 2>&1 | grep -E 'fetchMixed|fail|FAIL'
```

Expected: 4 failures mentioning `fetchMixed is not a function`.

- [ ] **Step 3: Implement `fetchMixed` in `public/js/api/tmdb.js`**

Inside `createTmdbClient`, add after the `fetchTrending` function (before `fetchReleaseDates`):

```js
  async function fetchEndpoint(path, mediaType, page) {
    const url = `${TMDB_PROXY}/${path}?page=${page}&language=fr-FR`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
    const json = await res.json();
    const items = (json.results || []).map((r) => normalizeTmdbItem(r, mediaType));
    return { items, totalPages: json.total_pages || 1 };
  }

  function sourcesForFilter(filter) {
    const sources = [(page) => fetchTrending(page, filter)];
    if (filter !== 'tv') {
      sources.push((page) => fetchEndpoint('movie/top_rated', 'movie', page));
      sources.push((page) => fetchEndpoint('movie/now_playing', 'movie', page));
    }
    if (filter !== 'movie') {
      sources.push((page) => fetchEndpoint('tv/top_rated', 'tv', page));
      sources.push((page) => fetchEndpoint('tv/on_the_air', 'tv', page));
    }
    return sources;
  }

  async function fetchMixed(page, filter) {
    const sources = sourcesForFilter(filter);
    const results = await Promise.allSettled(sources.map((fn) => fn(page)));
    const fulfilled = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    if (fulfilled.length === 0) throw new Error('All TMDB sources failed');
    const seen = new Set();
    const items = [];
    for (const result of fulfilled) {
      for (const item of result.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
    }
    const totalPages = Math.max(...fulfilled.map((r) => r.totalPages));
    return { items, totalPages };
  }
```

Also add `fetchMixed` to the return object at the bottom of `createTmdbClient`:

```js
  return { loadGenres, fetchTrending, fetchTrailerKey, fetchReleaseDates, fetchSearch, fetchMixed };
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
node --test --test-reporter=spec tests/api-tmdb.test.js 2>&1 | tail -8
```

Expected: all tests pass, including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add public/js/api/tmdb.js tests/api-tmdb.test.js
git commit -m "feat(tmdb): add fetchMixed — multi-source feed pool with dedup"
```

---

### Task 2: Update `feed.js` to use `fetchMixed`

**Files:**
- Modify: `public/js/feed.js` (lines ~185–197 `loadMoreIfNeeded`, lines ~238–265 `init`)

Context: `feed.js` calls `tmdb.fetchTrending` in exactly two places. Both are replaced with `tmdb.fetchMixed`. The init page range changes from `[1, 2, 3]` to `[1, 2]` because each `fetchMixed` call already returns 3–5× more items. Deduplication is added in `loadMoreIfNeeded` to filter items already present in the feed (possible overlap across sources).

- [ ] **Step 1: Run existing tests to confirm baseline**

```bash
npm test 2>&1 | tail -8
```

Expected: 57 tests, 0 failures.

- [ ] **Step 2: Update `init()` in `public/js/feed.js`**

Find the block (around line 238):
```js
    const results = await Promise.all(
      [1, 2, 3].map((p) => tmdb.fetchTrending(p, filter).catch(() => null))
    );
```

Replace with:
```js
    const results = await Promise.all(
      [1, 2].map((p) => tmdb.fetchMixed(p, filter).catch(() => null))
    );
```

Also update `currentPage = 3;` (a few lines below) to `currentPage = 2;`.

- [ ] **Step 3: Update `loadMoreIfNeeded()` in `public/js/feed.js`**

Find the block (around line 185):
```js
      const { items, totalPages: tp } = await tmdb.fetchTrending(nextPage, filter);
      const enriched = await enrichItems(items);
      store.dispatch({ type: 'APPEND_FEED', items: enriched });
```

Replace with:
```js
      const { items, totalPages: tp } = await tmdb.fetchMixed(nextPage, filter);
      const enriched = await enrichItems(items);
      const existingIds = new Set(store.getState().feed.map((i) => i.id));
      const deduped = enriched.filter((i) => !existingIds.has(i.id));
      if (deduped.length) store.dispatch({ type: 'APPEND_FEED', items: deduped });
```

- [ ] **Step 4: Run all tests — verify still 57/57**

```bash
npm test 2>&1 | tail -8
```

Expected: 57 tests, 0 failures. (Existing feed tests mock `tmdb` with only `fetchTrailerKey` and `fetchReleaseDates` — they don't call `init` or `loadMoreIfNeeded`, so no mock update needed.)

- [ ] **Step 5: Commit**

```bash
git add public/js/feed.js
git commit -m "feat(feed): use fetchMixed — multi-source pool, dedup on append"
```

---

### Task 3: Bump SW cache version and rebuild Docker

**Files:**
- Modify: `public/sw.js` (line 1)

Context: `tmdb.js` and `feed.js` are both in `APP_SHELL`. Bumping the VERSION string forces all clients to download the new files on next load.

- [ ] **Step 1: Bump VERSION in `public/sw.js`**

Line 1, change:
```js
const VERSION = 'v12';
```
to:
```js
const VERSION = 'v13';
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "chore(sw): bump to v13 for mixed-feed source update"
```

- [ ] **Step 3: Rebuild and redeploy**

```bash
docker compose up -d --build
```

Expected output ends with `Container trailerswipe Started`.

- [ ] **Step 4: Confirm container is healthy**

```bash
docker ps --filter name=trailerswipe --format "table {{.Names}}\t{{.Status}}"
```

Expected: `trailerswipe   Up X seconds (healthy)`
