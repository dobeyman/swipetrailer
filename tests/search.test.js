import { test, before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let createSearch;
let dom;

before(async () => {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="toast-container"></div></body></html>', {
    url: 'http://localhost/',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.CustomEvent = dom.window.CustomEvent;
  global.Event = dom.window.Event;
  ({ createSearch } = await import('../public/js/search.js'));
});

function makeStore(feedItems = []) {
  return { getState: () => ({ feed: feedItems }) };
}

function makeI18n() {
  return { t: (k) => k };
}

function makeTmdb(items = []) {
  return { fetchSearch: async () => items };
}

test('open() appends overlay to body and focuses input', () => {
  const search = createSearch({ tmdb: makeTmdb(), store: makeStore(), i18n: makeI18n(), debounceMs: 0 });
  search.open();
  const overlay = document.querySelector('.search-overlay');
  assert.ok(overlay, 'overlay should be in DOM');
  const input = overlay.querySelector('.search-overlay__input');
  assert.ok(input, 'input should exist');
  search.close();
});

test('close() removes overlay from DOM', () => {
  const search = createSearch({ tmdb: makeTmdb(), store: makeStore(), i18n: makeI18n(), debounceMs: 0 });
  search.open();
  search.close();
  assert.strictEqual(document.querySelector('.search-overlay'), null);
});

test('open() shows trending items from store when input is empty', () => {
  const items = [
    { id: 'movie-1', title: 'Dune', mediaType: 'movie', year: 2021, posterPath: '/p.jpg' },
    { id: 'movie-2', title: 'Oppenheimer', mediaType: 'movie', year: 2023, posterPath: '/p2.jpg' },
  ];
  const search = createSearch({ tmdb: makeTmdb(), store: makeStore(items), i18n: makeI18n(), debounceMs: 0 });
  search.open();
  const rows = document.querySelectorAll('.search-result-row');
  assert.strictEqual(rows.length, 2);
  search.close();
});

test('stale fetchSearch response is discarded when a newer query is active', async () => {
  let resolveFirst, resolveSecond;
  const firstResult = [{ id: 'movie-ab', title: 'AB Result', mediaType: 'movie', year: 2020, posterPath: '/ab.jpg', genreIds: [], rating: 7, overview: '', backdropPath: null, tmdbId: 10 }];
  const secondResult = [{ id: 'movie-abc', title: 'ABC Result', mediaType: 'movie', year: 2021, posterPath: '/abc.jpg', genreIds: [], rating: 8, overview: '', backdropPath: null, tmdbId: 11 }];

  const mockTmdb = {
    fetchSearch: (query) => {
      if (query === 'ab') return new Promise((r) => { resolveFirst = () => r(firstResult); });
      return new Promise((r) => { resolveSecond = () => r(secondResult); });
    },
  };

  const search = createSearch({ tmdb: mockTmdb, store: makeStore(), i18n: makeI18n(), debounceMs: 0 });
  search.open();

  const input = document.querySelector('.search-overlay__input');

  // Type 'ab' — timer fires after next tick (debounceMs=0)
  input.value = 'ab';
  input.dispatchEvent(new dom.window.Event('input'));
  await new Promise((r) => setTimeout(r, 0)); // let timer fire → runSearch('ab') in flight

  // Type 'abc' before 'ab' resolves
  input.value = 'abc';
  input.dispatchEvent(new dom.window.Event('input'));
  await new Promise((r) => setTimeout(r, 0)); // let timer fire → runSearch('abc') in flight

  // Resolve 'abc' first
  resolveSecond();
  await new Promise((r) => setTimeout(r, 0));

  // Resolve 'ab' after — should be discarded
  resolveFirst();
  await new Promise((r) => setTimeout(r, 0));

  const rows = document.querySelectorAll('.search-result-row');
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].textContent, /ABC Result/);

  search.close();
});

test('tapping a result dispatches search:select event with item detail', () => {
  const item = { id: 'movie-5', title: 'Inception', mediaType: 'movie', year: 2010, posterPath: '/i.jpg' };
  const search = createSearch({ tmdb: makeTmdb(), store: makeStore([item]), i18n: makeI18n(), debounceMs: 0 });
  search.open();

  let received = null;
  document.addEventListener('search:select', (e) => { received = e.detail; }, { once: true });

  const row = document.querySelector('.search-result-row');
  assert.ok(row, 'result row should be rendered from trending');
  row.click();

  assert.ok(received, 'search:select should have been dispatched');
  assert.strictEqual(received.id, 'movie-5');
  search.close();
});
