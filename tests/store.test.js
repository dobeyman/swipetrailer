import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createStore, reducer, initialState } from '../public/js/store.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}

test('initial state has empty feed and sets', () => {
  assert.strictEqual(initialState.feed.length, 0);
  assert.strictEqual(initialState.requestedIds.size, 0);
  assert.strictEqual(initialState.watchlistIds.size, 0);
  assert.strictEqual(initialState.currentIndex, 0);
});

test('SET_FEED replaces feed', () => {
  const next = reducer(initialState, { type: 'SET_FEED', items: [{ id: 1 }, { id: 2 }] });
  assert.strictEqual(next.feed.length, 2);
  assert.strictEqual(next.feed[0].id, 1);
});

test('APPEND_FEED appends', () => {
  const s1 = reducer(initialState, { type: 'SET_FEED', items: [{ id: 1 }] });
  const s2 = reducer(s1, { type: 'APPEND_FEED', items: [{ id: 2 }, { id: 3 }] });
  assert.strictEqual(s2.feed.length, 3);
  assert.strictEqual(s2.feed[2].id, 3);
});

test('ADD_REQUESTED adds to set', () => {
  const next = reducer(initialState, { type: 'ADD_REQUESTED', id: 'movie-42' });
  assert.ok(next.requestedIds.has('movie-42'));
});

test('TOGGLE_WATCHLIST adds then removes', () => {
  const s1 = reducer(initialState, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  assert.strictEqual(s1.watchlistIds.size, 1);
  assert.ok(s1.watchlist[0].id === 'movie-7');
  const s2 = reducer(s1, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  assert.strictEqual(s2.watchlistIds.size, 0);
  assert.strictEqual(s2.watchlist.length, 0);
});

test('SET_INDEX updates currentIndex', () => {
  const next = reducer(initialState, { type: 'SET_INDEX', index: 5 });
  assert.strictEqual(next.currentIndex, 5);
});

test('SET_FILTER updates preferences', () => {
  const next = reducer(initialState, { type: 'SET_FILTER', value: 'movie' });
  assert.strictEqual(next.preferences.filter, 'movie');
});

test('CLEAR_WATCHLIST empties watchlist', () => {
  const s1 = reducer(initialState, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  const s2 = reducer(s1, { type: 'CLEAR_WATCHLIST' });
  assert.strictEqual(s2.watchlistIds.size, 0);
  assert.strictEqual(s2.watchlist.length, 0);
});

test('createStore subscribes and dispatches', () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage });
  let calls = 0;
  store.subscribe(() => { calls++; });
  store.dispatch({ type: 'SET_INDEX', index: 3 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(store.getState().currentIndex, 3);
});

test('createStore persists requestedIds and watchlist to storage', () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage });
  store.dispatch({ type: 'ADD_REQUESTED', id: 'movie-1' });
  store.dispatch({ type: 'TOGGLE_WATCHLIST', item: { id: 'movie-2', mediaType: 'movie' } });
  assert.deepStrictEqual(JSON.parse(storage.getItem('ts.requestedIds')), ['movie-1']);
  const wl = JSON.parse(storage.getItem('ts.watchlist'));
  assert.strictEqual(wl.length, 1);
  assert.strictEqual(wl[0].id, 'movie-2');
});

test('createStore hydrates from storage', () => {
  const storage = new MemoryStorage();
  storage.setItem('ts.requestedIds', JSON.stringify(['movie-99']));
  storage.setItem('ts.watchlist', JSON.stringify([{ id: 'tv-7', mediaType: 'tv' }]));
  storage.setItem('ts.preferences', JSON.stringify({ filter: 'tv', locale: 'fr' }));
  const store = createStore({ storage });
  store.hydrate();
  const s = store.getState();
  assert.ok(s.requestedIds.has('movie-99'));
  assert.strictEqual(s.watchlist.length, 1);
  assert.strictEqual(s.preferences.filter, 'tv');
});

test('PREPEND_FEED prepends items to existing feed', () => {
  const s1 = reducer(initialState, { type: 'SET_FEED', items: [{ id: 'movie-2' }] });
  const s2 = reducer(s1, { type: 'PREPEND_FEED', items: [{ id: 'movie-1' }] });
  assert.strictEqual(s2.feed.length, 2);
  assert.strictEqual(s2.feed[0].id, 'movie-1');
  assert.strictEqual(s2.feed[1].id, 'movie-2');
});
