# Mixed Feed Sources — Design Spec

## Goal

Replace the single trending source with a multi-source pool so the feed always contains a mix of trending content, timeless top-rated films/series, and current releases. The change is transparent to the user; the filter setting (all/movie/tv) continues to work as before.

## Architecture

A new `fetchMixed(page, filter)` function in `tmdb.js` replaces the two `fetchTrending` calls in `feed.js`. It fetches multiple TMDB sources in parallel, merges the results, deduplicates by `id`, and returns `{ items, totalPages }` — the same shape as `fetchTrending`. `feed.js` is unaware of the multi-source logic.

Four new proxy routes are added to `server.js` (trending already exists):
- `GET /api/tmdb/movie/top_rated?page=N` → TMDB `/movie/top_rated`
- `GET /api/tmdb/movie/now_playing?page=N` → TMDB `/movie/now_playing`
- `GET /api/tmdb/tv/top_rated?page=N` → TMDB `/tv/top_rated`
- `GET /api/tmdb/tv/on_the_air?page=N` → TMDB `/tv/on_the_air`

## Sources by Filter

The existing `fetchTrending(page, filter)` is reused as the trending source inside `fetchMixed` — it already handles the filter parameter correctly.

| Filter | Sources |
|--------|---------|
| `all` | fetchTrending(all) + movie/top_rated + tv/top_rated + movie/now_playing + tv/on_the_air |
| `movie` | fetchTrending(movie) + movie/top_rated + movie/now_playing |
| `tv` | fetchTrending(tv) + tv/top_rated + tv/on_the_air |

## fetchMixed Implementation

```js
async function fetchMixed(page, filter) {
  const sources = getSourcesForFilter(filter); // returns array of fetch functions
  const results = await Promise.allSettled(sources.map(fn => fn(page)));
  const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (fulfilled.length === 0) throw new Error('All sources failed');
  const seen = new Set();
  const items = [];
  for (const result of fulfilled) {
    for (const item of result.items) {
      if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
    }
  }
  const totalPages = Math.max(...fulfilled.map(r => r.totalPages));
  return { items, totalPages };
}
```

Each source normalises its response through the existing `normalizeTmdbItem` helper.

## feed.js Changes

- `init()`: fetch pages `[1, 2]` via `fetchMixed` instead of pages `[1, 2, 3]` via `fetchTrending` (each `fetchMixed` call brings 3–6× more items per page).
- `loadMoreIfNeeded()`: call `fetchMixed` instead of `fetchTrending`.
- After enriching, deduplicate against the existing feed before dispatching `APPEND_FEED`:

```js
const existingIds = new Set(store.getState().feed.map(i => i.id));
const deduped = enriched.filter(i => !existingIds.has(i.id));
if (deduped.length) store.dispatch({ type: 'APPEND_FEED', items: deduped });
```

## Error Handling

- Individual source failure: silently ignored via `Promise.allSettled`; remaining sources fill the feed.
- All sources fail on a page: `fetchMixed` throws → `feed.js` catches and shows the existing error toast.

## Files Changed

| File | Change |
|------|--------|
| `server.js` | 4 new proxy routes |
| `public/js/api/tmdb.js` | Add `fetchMixed`, keep `fetchTrending` (used in existing tests) |
| `public/js/feed.js` | Use `fetchMixed`, fetch pages [1,2] at init, dedup on append |
| `tests/api-tmdb.test.js` | 4 new tests for `fetchMixed` |
| `tests/feed.test.js` | Update mock to expose `fetchMixed` instead of `fetchTrending` |

## Tests for fetchMixed

1. Results from multiple sources are merged into one array
2. Duplicate items (same `id` across sources) appear only once
3. Filter `movie` activates exactly 3 movie sources (no TV calls)
4. A failing source is ignored; remaining sources fill the result
