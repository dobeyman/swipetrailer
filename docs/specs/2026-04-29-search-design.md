# TrailerSwipe — Search Feature Design

**Date:** 2026-04-29
**Status:** Approved

---

## Goal

Add a 🔍 icon next to the existing ⚙️ button (top-right). Tapping it opens a full-screen search overlay with autocomplete powered by TMDB `/search/multi`. Selecting a result inserts the film/series at the top of the feed and scrolls to it.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `public/js/search.js` | Search overlay module — UI, debounce, results, selection |
| `public/css/search.css` | Styles for the overlay, input, and result rows |

### Modified files

| File | Change |
|------|--------|
| `public/js/api/tmdb.js` | Add `fetchSearch(query)` method |
| `public/js/feed.js` | Add `prependItem(rawItem)` + `PREPEND_FEED` store action |
| `public/js/app.js` | Create 🔍 button, instantiate `createSearch(...)`, wire `search:select` event |
| `public/js/store.js` | Add `PREPEND_FEED` reducer case |

**No backend changes.** The existing Express wildcard `/api/tmdb/*` already routes `/api/tmdb/search/multi`.

---

## Data Flow

```
User types in search field
  → debounce 300ms (cancel previous timer on each keystroke)
  → if query.length < 2: show trending suggestions (top 5 from store)
  → else: tmdb.fetchSearch(query) → normalize → render result rows

User taps a result
  → overlay closes immediately
  → toast "Chargement…" shown
  → document dispatches CustomEvent('search:select', { detail: rawItem })
  → app.js calls feed.prependItem(rawItem)
    → enrichItems([rawItem]) [trailer key + Seerr status + release dates]
    → store.dispatch({ type: 'PREPEND_FEED', items: [enriched] })
    → updateWindow(0)
    → scrollTo(0)
  → toast dismissed
```

---

## Components

### `createSearch({ tmdb, store, i18n })`

**Exports:** `{ open, close }`

**DOM structure:**
```
.search-overlay              ← fixed inset-0, z-index above feed
  .search-overlay__backdrop  ← dark blur background
  .search-overlay__panel
    .search-overlay__header
      input.search-overlay__input
      button.search-overlay__close  ← ✕
    .search-overlay__results
      .search-result-row × N
        .search-result-row__poster  ← img or placeholder
        .search-result-row__info
          .search-result-row__title
          .search-result-row__meta  ← "Film · 2024" or "Série · 2024"
```

**Behaviors:**
- `open()`: append to body, focus input, fade in (CSS animation)
- `close()`: fade out, remove from DOM
- Tap backdrop → close
- Escape key → close
- Tap ✕ → close
- Input ≥ 2 chars + 300ms debounce → `tmdb.fetchSearch(query)` → render rows
- Input < 2 chars → show trending suggestions (top 5 items from `store.getState().feed`)
- Tap result row → dispatch `CustomEvent('search:select', { detail: item })` on document, then close

**Race condition guard:** each `fetchSearch` call is tagged with the query string at dispatch time; results whose query doesn't match the current input value are discarded on arrival.

---

### `tmdb.fetchSearch(query)`

```js
async function fetchSearch(query) {
  const url = `${TMDB_PROXY}/search/multi?query=${encodeURIComponent(query)}&language=fr-FR&page=1`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const json = await res.json();
  return (json.results || [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .filter(r => r.poster_path)
    .slice(0, 8)
    .map(r => normalizeTmdbItem(r, r.media_type));
}
```

Returns max 8 items. Filters out persons and items without a poster.

---

### `feed.prependItem(rawItem)`

```js
async function prependItem(rawItem) {
  // Deduplicate: if already in feed, scroll to existing card
  const existing = store.getState().feed.find(i => i.id === rawItem.id);
  if (existing) {
    const idx = store.getState().feed.indexOf(existing);
    scrollTo(idx);
    return;
  }
  const [enriched] = await enrichItems([rawItem]);
  // enriched may be undefined if no trailer found — insert anyway
  const item = enriched ?? { ...rawItem, trailerKey: null, seerrStatus: null, releaseDates: null };
  store.dispatch({ type: 'PREPEND_FEED', items: [item] });
  updateWindow(0);
  scrollTo(0);
}
```

---

### Store — `PREPEND_FEED`

```js
case 'PREPEND_FEED':
  return { ...state, feed: [...action.items, ...state.feed] };
```

---

### `app.js` wiring

```js
const searchBtn = document.createElement('button');
searchBtn.className = 'search-btn';
searchBtn.setAttribute('aria-label', 'Rechercher');
searchBtn.innerHTML = '🔍';
document.body.appendChild(searchBtn);

const search = createSearch({ tmdb, store, i18n });
searchBtn.addEventListener('click', () => search.open());
document.addEventListener('search:select', async (e) => {
  toast(i18n.t('search.loading'));
  await feed.prependItem(e.detail);
});
```

---

## UI / CSS

The 🔍 button mirrors the existing `.settings-btn` style. The search overlay uses the same design tokens as the settings panel (`--bg-elevated`, `--text`, `--radius-md`, etc.).

**Overlay animation:** fade in + slide down (240ms ease-out), same as existing toast animation pattern.

**Result row:** 48px tall, poster thumbnail (32×48px, `object-fit: cover`, rounded corners), title + meta. Tap state: brief highlight (`--bg-elevated` → slightly lighter).

**Input:** full-width, rounded pill, autofocus on open. No submit button — selection is always via tap on a result row.

---

## Error Handling

| Scenario | Behavior |
|----------|---------|
| `fetchSearch` network error | Show "Aucun résultat" inside the overlay (no toast) |
| `enrichItems` slow / fails | Item inserted with `trailerKey: null`; card shows poster without video |
| Result already in feed | Skip insert, scroll to existing card, close overlay |
| Result is type "person" | Filtered out in `fetchSearch` |
| Result has no poster | Filtered out in `fetchSearch` |
| Query < 2 chars | Show top 5 trending from store, no API call |

---

## Testing

- `tests/api-tmdb.test.js` — add `fetchSearch` tests: returns normalized items, filters persons, filters no-poster, max 8 results
- `tests/search.test.js` — debounce behavior, race condition guard (stale response discarded), deduplication logic in `prependItem`
- `tests/store.test.js` — add `PREPEND_FEED` reducer test

---

## Out of Scope

- Search history (localStorage) — not in this iteration
- Filter by genre within search results
- Keyboard navigation (↑↓) in result list
- i18n EN (FR only, consistent with rest of app)
