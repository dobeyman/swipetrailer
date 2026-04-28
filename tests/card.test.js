import { test, before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let createCard;
let createI18n;

before(async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  // jsdom requires its own CustomEvent / Event constructors when dispatching
  // events on its elements; Node's globals create incompatible instances.
  global.CustomEvent = dom.window.CustomEvent;
  global.Event = dom.window.Event;
  // Node 22+ makes global.navigator a read-only getter; skip overriding it.
  // jsdom code paths used by createCard only need window/document.
  ({ createCard } = await import('../public/js/card.js'));
  ({ createI18n } = await import('../public/js/i18n.js'));
});

function makeI18nStub() {
  return { t: (key, p) => (p ? `${key}:${JSON.stringify(p)}` : key) };
}

const sampleItem = {
  id: 'movie-100',
  tmdbId: 100,
  mediaType: 'movie',
  title: 'Dune',
  overview: 'Description du film',
  genreIds: [28, 12],
  rating: 8.0,
  year: 2021,
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  trailerKey: 'ABCDE',
  seerrStatus: null,
  releaseDates: null,
};

test('createCard renders title, year, mediaType badge', () => {
  const i18n = makeI18nStub();
  const el = createCard({
    item: sampleItem,
    i18n,
    genreMap: new Map([['movie:28', 'Action']]),
    seerrEnabled: true,
  });
  assert.match(el.querySelector('.card__title').textContent, /Dune/);
  assert.match(el.querySelector('.card__year').textContent, /2021/);
  // i18n stub echoes the key, so we match against the key suffix
  assert.match(el.querySelector('.card__media-type').textContent, /movie/);
});

test('createCard hides "Je veux" if seerrEnabled is false', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: false,
  });
  assert.strictEqual(el.querySelector('.card__btn-want'), null);
});

test('createCard shows "Disponible" badge when seerrStatus >= 5', () => {
  const item = { ...sampleItem, seerrStatus: 5 };
  const el = createCard({
    item,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
  });
  const badge = el.querySelector('.card__availability-badge');
  assert.ok(badge);
  assert.match(badge.textContent, /available/);
});

test('createCard shows "Demandé" state when item.id in requestedIds', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
    requestedIds: new Set(['movie-100']),
  });
  const btn = el.querySelector('.card__btn-want');
  assert.match(btn.textContent, /requested/);
  assert.ok(btn.disabled);
});

test('createCard emits card:request event on want button click', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
  });
  let received;
  el.addEventListener('card:request', (e) => { received = e.detail; });
  el.querySelector('.card__btn-want').click();
  assert.strictEqual(received.id, 'movie-100');
});
