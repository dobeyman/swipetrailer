import { test } from 'node:test';
import assert from 'node:assert';

// shouldLoadMore is a pure helper extracted from feed.js.
// shouldLoadMore(currentIdx, feedLength, isLoading) → boolean
let shouldLoadMore;

// Minimal DOM stubs so feed.js (and its imports) can be loaded in Node.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

({ shouldLoadMore } = await import('../public/js/feed.js'));

test('shouldLoadMore does not trigger when far from end', () => {
  assert.strictEqual(shouldLoadMore(5, 20, false), false);
});

test('shouldLoadMore triggers at LOAD_AHEAD cards from end', () => {
  // With LOAD_AHEAD=8 and 20 items, threshold is index 12 (20-8=12)
  assert.strictEqual(shouldLoadMore(12, 20, false), true);
});

test('shouldLoadMore does not trigger when already loading', () => {
  assert.strictEqual(shouldLoadMore(18, 20, true), false);
});

test('shouldLoadMore triggers at the very last card', () => {
  assert.strictEqual(shouldLoadMore(19, 20, false), true);
});

const { createStore } = await import('../public/js/store.js');

// jsdom does not implement scrollIntoView — stub it so prependItem tests don't throw.
if (dom.window.HTMLElement && !dom.window.HTMLElement.prototype.scrollIntoView) {
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
}

function makeMockStore(initialItems = []) {
  const store = createStore({ storage: null });
  if (initialItems.length) store.dispatch({ type: 'SET_FEED', items: initialItems });
  const dispatched = [];
  const orig = store.dispatch.bind(store);
  store.dispatch = (action) => { dispatched.push(action); orig(action); };
  store._dispatched = dispatched;
  return store;
}

function makeMockTmdb(trailerKey = 'KEY') {
  return {
    fetchTrailerKey: async () => trailerKey,
    fetchReleaseDates: async () => null,
  };
}

function makeContainer() {
  return document.createElement('div');
}

const { createFeed } = await import('../public/js/feed.js');

test('prependItem: scrolls to existing item, does not dispatch PREPEND_FEED', async () => {
  const existing = { id: 'movie-1', tmdbId: 1, mediaType: 'movie', title: 'A', year: 2020, genreIds: [], rating: 7, posterPath: '/a.jpg', backdropPath: null, trailerKey: null, seerrStatus: null, releaseDates: null, overview: '' };
  const store = makeMockStore([existing]);
  const feed = createFeed({
    container: makeContainer(),
    store,
    tmdb: makeMockTmdb(),
    seerr: null,
    i18n: { t: (k) => k },
    genreMap: new Map(),
    seerrEnabled: false,
  });

  await feed.prependItem(existing);

  assert.ok(!store._dispatched.some((a) => a.type === 'PREPEND_FEED'));
});

test('prependItem: dispatches PREPEND_FEED and SET_INDEX for new item', async () => {
  const store = makeMockStore([]);
  const feed = createFeed({
    container: makeContainer(),
    store,
    tmdb: makeMockTmdb('TRAILER_KEY'),
    seerr: null,
    i18n: { t: (k) => k },
    genreMap: new Map(),
    seerrEnabled: false,
  });

  const rawItem = { id: 'movie-2', tmdbId: 2, mediaType: 'movie', title: 'B', year: 2022, genreIds: [], rating: 8, posterPath: '/b.jpg', backdropPath: null, trailerKey: null, seerrStatus: null, releaseDates: null, overview: '' };
  await feed.prependItem(rawItem);

  const prepend = store._dispatched.find((a) => a.type === 'PREPEND_FEED');
  assert.ok(prepend, 'PREPEND_FEED should be dispatched');
  assert.strictEqual(prepend.items[0].id, 'movie-2');
  assert.strictEqual(prepend.items[0].trailerKey, 'TRAILER_KEY');

  const setIndex = store._dispatched.find((a) => a.type === 'SET_INDEX');
  assert.ok(setIndex, 'SET_INDEX should be dispatched');
  assert.strictEqual(setIndex.index, 0);
});

test('refreshCardAuth: replaces login button with want button when auth state changes', async () => {
  const container = makeContainer();
  const store = makeMockStore([]);
  let isLoggedIn = false;
  const feed = createFeed({
    container,
    store,
    tmdb: makeMockTmdb(null), // null trailer key → enrichItems falls back to raw shape
    seerr: { fetchMediaDetails: async () => null },
    i18n: { t: (k) => k },
    genreMap: new Map(),
    seerrEnabled: true,
    getIsLoggedIn: () => isLoggedIn,
  });

  const rawItem = { id: 'auth-refresh-1', tmdbId: 99, mediaType: 'movie', title: 'AuthTest', year: 2024, genreIds: [], rating: 8, posterPath: null, backdropPath: null, trailerKey: null, seerrStatus: null, releaseDates: null, overview: '' };
  await feed.prependItem(rawItem);

  assert.ok(container.querySelector('.card__btn-login'), 'login button should exist before refreshCardAuth');
  assert.ok(!container.querySelector('.card__btn-want'), 'want button should not exist before refreshCardAuth');

  isLoggedIn = true;
  feed.refreshCardAuth();

  assert.ok(!container.querySelector('.card__btn-login'), 'login button should be removed after refreshCardAuth');
  assert.ok(container.querySelector('.card__btn-want'), 'want button should appear after refreshCardAuth');
});

test('prependItem: inserts item even when enrichItems finds no trailer', async () => {
  const store = makeMockStore([]);
  const feed = createFeed({
    container: makeContainer(),
    store,
    tmdb: makeMockTmdb(null), // no trailer
    seerr: null,
    i18n: { t: (k) => k },
    genreMap: new Map(),
    seerrEnabled: false,
  });

  const rawItem = { id: 'movie-3', tmdbId: 3, mediaType: 'movie', title: 'C', year: 2023, genreIds: [], rating: 7, posterPath: '/c.jpg', backdropPath: null, trailerKey: null, seerrStatus: null, releaseDates: null, overview: '' };
  await feed.prependItem(rawItem);

  const prepend = store._dispatched.find((a) => a.type === 'PREPEND_FEED');
  assert.ok(prepend, 'PREPEND_FEED should be dispatched even without trailer');
  assert.strictEqual(prepend.items[0].trailerKey, null);
});

test('resetFeed clears the feed and triggers a reload', async () => {
  const store = makeMockStore([{ id: 'movie-1', mediaType: 'movie', title: 'Old' }]);
  const tmdb = makeMockTmdb('KEY1');
  tmdb.fetchMixed = async () => ({ items: [{ id: 'movie-2', mediaType: 'movie', title: 'New', genreIds: [], rating: 7, year: 2024, posterPath: '/p.jpg', backdropPath: null, overview: '' }], totalPages: 1 });
  tmdb.fetchDiscover = async () => ({ items: [], totalPages: 1 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const feed = createFeed({ container, store, tmdb, seerr: null, i18n: { t: (k) => k }, genreMap: new Map(), seerrEnabled: false });
  await feed.resetFeed();
  const setFeedAction = store._dispatched.find((a) => a.type === 'SET_FEED' && a.items.length === 0);
  assert.ok(setFeedAction, 'resetFeed should dispatch SET_FEED with empty items');
});

test('resetFeed triggers a fetch after clearing', async () => {
  const store = makeMockStore([]);
  let fetchCalled = false;
  const tmdb = makeMockTmdb('KEY2');
  tmdb.fetchMixed = async () => { fetchCalled = true; return { items: [], totalPages: 1 }; };
  tmdb.fetchDiscover = async () => { fetchCalled = true; return { items: [], totalPages: 1 }; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const feed = createFeed({ container, store, tmdb, seerr: null, i18n: { t: (k) => k }, genreMap: new Map(), seerrEnabled: false });
  await feed.resetFeed();
  assert.ok(fetchCalled, 'resetFeed should trigger a fetch (fetchMixed or fetchDiscover)');
});
