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
