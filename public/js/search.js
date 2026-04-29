const TMDB_IMG = 'https://image.tmdb.org/t/p/w92';

export function createSearch({ tmdb, store, i18n, debounceMs = 300 }) {
  let overlayEl = null;
  let debounceTimer = null;
  let activeQuery = '';

  function open() {
    if (overlayEl) return;
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('.search-overlay__input').focus();
    overlayEl.querySelector('.search-overlay__input').addEventListener('input', onInput);
    overlayEl.querySelector('.search-overlay__close').addEventListener('click', close);
    overlayEl.querySelector('.search-overlay__backdrop').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);
    renderTrending();
  }

  function close() {
    if (!overlayEl) return;
    clearTimeout(debounceTimer);
    activeQuery = '';
    document.removeEventListener('keydown', onKeydown);
    overlayEl.remove();
    overlayEl = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function onInput(e) {
    const query = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (query.length < 2) {
      activeQuery = '';
      renderTrending();
      return;
    }
    debounceTimer = setTimeout(() => runSearch(query), debounceMs);
  }

  async function runSearch(query) {
    activeQuery = query;
    renderLoading();
    try {
      const items = await tmdb.fetchSearch(query);
      if (activeQuery !== query) return;
      renderResults(items, query);
    } catch {
      if (activeQuery !== query) return;
      renderEmpty();
    }
  }

  function renderTrending() {
    const items = store.getState().feed.slice(0, 5);
    renderResults(items, null);
  }

  function renderResults(items, query) {
    if (!overlayEl) return;
    const list = overlayEl.querySelector('.search-overlay__results');
    list.innerHTML = '';
    if (items.length === 0) {
      renderEmpty();
      return;
    }
    const label = document.createElement('div');
    label.className = 'search-overlay__label';
    label.textContent = query ? i18n.t('search.results') : i18n.t('search.trending');
    list.appendChild(label);
    for (const item of items) list.appendChild(buildResultRow(item));
  }

  function renderLoading() {
    if (!overlayEl) return;
    const list = overlayEl.querySelector('.search-overlay__results');
    list.innerHTML = `<div class="search-overlay__empty">${escHtml(i18n.t('search.loading'))}</div>`;
  }

  function renderEmpty() {
    if (!overlayEl) return;
    const list = overlayEl.querySelector('.search-overlay__results');
    list.innerHTML = `<div class="search-overlay__empty">${escHtml(i18n.t('search.no_results'))}</div>`;
  }

  function buildResultRow(item) {
    const row = document.createElement('div');
    row.className = 'search-result-row';
    const posterSrc = item.posterPath ? `${TMDB_IMG}${item.posterPath}` : null;
    row.innerHTML = `
      <div class="search-result-row__poster">
        ${posterSrc ? `<img src="${escHtml(posterSrc)}" alt="" loading="lazy" />` : ''}
      </div>
      <div class="search-result-row__info">
        <div class="search-result-row__title">${escHtml(item.title)}</div>
        <div class="search-result-row__meta">${escHtml(i18n.t(`card.media_type.${item.mediaType}`))}${item.year ? ` · ${escHtml(String(item.year))}` : ''}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('search:select', { detail: item }));
      close();
    });
    return row;
  }

  function buildOverlay() {
    const el = document.createElement('div');
    el.className = 'search-overlay';
    el.innerHTML = `
      <div class="search-overlay__backdrop"></div>
      <div class="search-overlay__panel">
        <div class="search-overlay__header">
          <input class="search-overlay__input" type="search"
            placeholder="${escHtml(i18n.t('search.placeholder'))}"
            autocomplete="off" autocorrect="off" spellcheck="false" />
          <button class="search-overlay__close" aria-label="${escHtml(i18n.t('search.close'))}">✕</button>
        </div>
        <div class="search-overlay__results"></div>
      </div>
    `;
    return el;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { open, close };
}
