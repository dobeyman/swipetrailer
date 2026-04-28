export function createCard({ item, i18n, genreMap, seerrEnabled, requestedIds = new Set(), watchlistIds = new Set() }) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.itemId = item.id;
  el.dataset.mediaType = item.mediaType;

  const isRequested = requestedIds.has(item.id);
  const isInWatchlist = watchlistIds.has(item.id);
  const isAvailable = item.seerrStatus !== null && item.seerrStatus >= 5;
  const isProcessing = item.seerrStatus === 3 || item.seerrStatus === 4;
  const isPartial = item.seerrStatus === 2;
  const showWantButton = seerrEnabled && !isAvailable;

  const genreNames = (item.genreIds || [])
    .map((id) => genreMap.get(`${item.mediaType}:${id}`))
    .filter(Boolean)
    .slice(0, 3);

  const safeBackdrop = isSafeTmdbPath(item.backdropPath);
  const backdropUrl = safeBackdrop
    ? `https://image.tmdb.org/t/p/w1280${safeBackdrop}`
    : null;
  const safeTrailerKey = isSafeYoutubeKey(item.trailerKey) ? item.trailerKey : '';

  el.innerHTML = `
    <div class="card__video-wrapper">
      <div class="card__video" data-trailer-key="${safeTrailerKey}"></div>
      ${backdropUrl ? `<div class="card__backdrop" style="background-image: url('${backdropUrl}')"></div>` : ''}
      <div class="card__gradient"></div>
    </div>
    <div class="card__overlay">
      <div class="card__top-row">
        <span class="card__media-type">${i18n.t(`card.media_type.${item.mediaType}`)}</span>
        ${isAvailable ? `<span class="card__availability-badge card__availability-badge--available">${i18n.t('card.available')}</span>` : ''}
        ${isProcessing ? `<span class="card__availability-badge card__availability-badge--processing">${i18n.t('card.processing')}</span>` : ''}
        ${isPartial ? `<span class="card__availability-badge card__availability-badge--partial">${i18n.t('card.partial')}</span>` : ''}
      </div>
      <h2 class="card__title">${escapeHtml(item.title)}</h2>
      <div class="card__meta">
        <span class="card__year">${item.year || ''}</span>
        ${item.rating ? `<span class="card__rating">⭐ ${item.rating.toFixed(1)}</span>` : ''}
        ${genreNames.length ? `<span class="card__genres">${genreNames.join(' · ')}</span>` : ''}
      </div>
      <p class="card__synopsis" data-expanded="false">${escapeHtml(item.overview)}</p>
      <div class="card__action-bar">
        ${showWantButton ? `
          <button class="card__btn card__btn-want ${isRequested ? 'is-requested' : ''}" ${isRequested ? 'disabled' : ''} aria-label="${i18n.t('card.want')}">
            <span class="card__btn-icon">${isRequested ? '✅' : '❤️'}</span>
            <span class="card__btn-label">${i18n.t(isRequested ? 'card.requested' : 'card.want')}</span>
          </button>
        ` : ''}
        <button class="card__btn card__btn-watchlist ${isInWatchlist ? 'is-active' : ''}" aria-label="${i18n.t(isInWatchlist ? 'card.watchlist_remove' : 'card.watchlist_add')}">
          <span class="card__btn-icon">🔖</span>
        </button>
        <button class="card__btn card__btn-dates" aria-label="${i18n.t('card.show_dates')}">
          <span class="card__btn-icon">📅</span>
        </button>
        <button class="card__btn card__btn-synopsis" aria-label="${i18n.t('card.show_synopsis')}">
          <span class="card__btn-icon">💬</span>
        </button>
      </div>
    </div>
  `;

  // Wire events
  el.querySelector('.card__btn-want')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:request', {
      detail: { id: item.id, mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title },
      bubbles: true,
    }));
  });
  el.querySelector('.card__btn-watchlist')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:watchlist', {
      detail: { id: item.id, mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title, posterPath: item.posterPath },
      bubbles: true,
    }));
  });
  el.querySelector('.card__btn-dates')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:show-dates', { detail: { item }, bubbles: true }));
  });
  el.querySelector('.card__btn-synopsis')?.addEventListener('click', () => {
    const synopsis = el.querySelector('.card__synopsis');
    const expanded = synopsis.dataset.expanded === 'true';
    synopsis.dataset.expanded = String(!expanded);
  });

  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function isSafeTmdbPath(p) {
  if (!p || typeof p !== 'string') return null;
  return /^\/[\w./-]+\.(jpg|jpeg|png|webp)$/i.test(p) ? p : null;
}

function isSafeYoutubeKey(k) {
  return typeof k === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(k);
}

export { isSafeTmdbPath, isSafeYoutubeKey };
