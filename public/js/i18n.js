export function createI18n({ fetch: fetchImpl = globalThis.fetch } = {}) {
  let strings = {};

  async function loadLocale(locale) {
    const res = await fetchImpl(`/js/locales/${locale}.json`);
    if (!res.ok) {
      console.error(`i18n: failed to load locale ${locale}`);
      return;
    }
    strings = await res.json();
  }

  function t(key, params) {
    const raw = strings[key];
    if (raw === undefined) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    );
  }

  return { loadLocale, t };
}
