import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createI18n } from '../public/js/i18n.js';

const fakeFetch = (locale) => async () => ({
  ok: true,
  json: async () => ({
    'feed.empty': 'Aucune bande-annonce',
    'toast.requested': 'Demandé : {title}',
    'nested.key.deep': 'profond',
  }),
});

test('returns the key when locale not loaded', () => {
  const i18n = createI18n();
  assert.strictEqual(i18n.t('feed.empty'), 'feed.empty');
});

test('returns the translation when loaded', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('feed.empty'), 'Aucune bande-annonce');
});

test('interpolates parameters', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('toast.requested', { title: 'Dune' }), 'Demandé : Dune');
});

test('returns the key when translation is missing', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('does.not.exist'), 'does.not.exist');
});
