import { createI18n } from './i18n.js';
import { createStore } from './store.js';
import { createTmdbClient } from './api/tmdb.js';
import {
  createSeerrClient,
  AlreadyRequestedError,
  UnauthorizedError,
  NotConfiguredError,
} from './api/seerr.js';
import { createFeed } from './feed.js';
import { createSettings } from './settings.js';
import { createSearch } from './search.js';
import { createFilters } from './filters.js';
import { toast } from './toast.js';
import {
  checkSession,
  clearSession,
  getSession,
  startPlexLogin,
} from './auth.js';

const appEl = document.getElementById('app');

async function main() {
  const i18n = createI18n();
  await i18n.loadLocale('fr');

  const store = createStore({ storage: window.localStorage });
  store.hydrate();

  // Health check
  let health;
  try {
    const res = await fetch('/api/health');
    health = await res.json();
  } catch {
    health = { tmdb: false, seerr: false, seerrType: 'overseerr' };
  }
  store.dispatch({ type: 'SET_HEALTH', health });

  const authSession = await checkSession();
  let currentUser = authSession?.user ?? null;

  if (!health.tmdb) {
    renderTmdbErrorScreen(i18n);
    return;
  }

  const tmdb = createTmdbClient();
  const seerr = createSeerrClient({ enabled: health.seerr, getSession });
  const seerrEnabled = health.seerr;

  // Top-right buttons
  const searchBtn = document.createElement('button');
  searchBtn.className = 'search-btn';
  searchBtn.setAttribute('aria-label', i18n.t('search.placeholder'));
  searchBtn.innerHTML = '🔍';
  document.body.appendChild(searchBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'settings-btn';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = '⚙️';
  document.body.appendChild(settingsBtn);

  const filtersBtn = document.createElement('button');
  filtersBtn.className = 'filters-btn';
  filtersBtn.setAttribute('aria-label', 'Filtres');
  document.body.appendChild(filtersBtn);

  function updateFiltersBadge() {
    const { genres = [], languages = [] } = store.getState().preferences;
    const count = genres.length + languages.length;
    filtersBtn.innerHTML = count > 0
      ? `🎬 <span class="filters-btn__badge">${count}</span>`
      : '🎬 Filtres';
  }
  updateFiltersBadge();

  const authBtn = document.createElement('button');
  authBtn.className = 'auth-btn';
  document.body.appendChild(authBtn);

  function safeText(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  function isSafeUrl(url) {
    try { return new URL(url).protocol === 'https:'; } catch { return false; }
  }

  function renderAuthButton(user) {
    currentUser = user;
    authBtn.innerHTML = '';
    if (!user) {
      authBtn.className = 'auth-btn';
      authBtn.textContent = i18n.t('auth.login');
      authBtn.onclick = handleLogin;
    } else {
      authBtn.className = 'auth-btn';
      const icon = user.avatar && isSafeUrl(user.avatar)
        ? `<img class="auth-btn__avatar" src="${safeText(user.avatar)}" alt="" />`
        : `<span class="auth-btn__initials">${safeText((user.name?.[0] ?? '?').toUpperCase())}</span>`;
      authBtn.innerHTML = `${icon}<span class="auth-btn__name">${safeText(user.name)}</span>`;
      authBtn.title = user.name ?? '';
      authBtn.onclick = () => showLogoutPanel(user);
    }
  }

  function showLogoutPanel(user) {
    const existing = document.querySelector('.logout-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'logout-panel';
    panel.innerHTML = `
      <div class="logout-panel__name">${safeText(user.name)}</div>
      <button class="logout-panel__btn">${safeText(i18n.t('auth.logout'))}</button>
    `;
    panel.querySelector('.logout-panel__btn').addEventListener('click', () => {
      clearSession();
      panel.remove();
      renderAuthButton(null);
      feed.reset();
      feed.init();
      toast(i18n.t('auth.logout_success'), { variant: 'success' });
    });
    document.body.appendChild(panel);
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== authBtn) panel.remove();
      }, { once: true });
    }, 0);
  }

  let loginInProgress = false;
  async function handleLogin() {
    if (loginInProgress) return;
    loginInProgress = true;
    try {
      const user = await startPlexLogin();
      renderAuthButton(user);
      toast(i18n.t('auth.login_success', { name: user.name }), { variant: 'success' });
      feed.refreshCardAuth();
    } catch (err) {
      if (err.message === 'auth_timeout') {
        toast(i18n.t('auth.login_timeout'), { variant: 'error' });
      } else {
        toast(i18n.t('auth.login_error'), { variant: 'error' });
      }
    } finally {
      loginInProgress = false;
    }
  }

  renderAuthButton(currentUser);

  // Read-only banner if Seerr disabled
  if (!seerrEnabled) {
    const banner = document.createElement('div');
    banner.className = 'read-only-banner';
    banner.textContent = i18n.t('feed.read_only_banner');
    document.body.appendChild(banner);
  }

  // Genre map
  let genreMap = new Map();
  try {
    genreMap = await tmdb.loadGenres();
  } catch (e) {
    console.error('app: loadGenres failed', e);
  }

  // Feed
  const feed = createFeed({
    container: appEl,
    store,
    tmdb,
    seerr,
    i18n,
    genreMap,
    seerrEnabled,
    getIsLoggedIn: () => currentUser !== null,
  });
  feed.init();

  // Filters
  const filters = createFilters({
    container: document.body,
    store,
    tmdb,
    i18n,
    onFiltersChange: () => {
      updateFiltersBadge();
      feed.resetFeed();
    },
  });

  filtersBtn.addEventListener('click', () => filters.open());

  store.subscribe(() => updateFiltersBadge());

  // Settings
  const settings = createSettings({
    container: document.body,
    store,
    i18n,
    onFilterChange: () => {
      feed.reset();
      feed.init();
    },
  });

  // Search
  const search = createSearch({ tmdb, store, i18n });
  searchBtn.addEventListener('click', () => search.open());

  document.addEventListener('search:select', (e) => {
    feed.prependItem(e.detail);
  });

  settingsBtn.addEventListener('click', () => settings.toggle());

  // Handle card events bubbling up
  appEl.addEventListener('card:request', async (e) => {
    const { id, mediaType, tmdbId, title, seasons } = e.detail;
    const card = appEl.querySelector(`.card[data-item-id="${id}"]`);
    const btn = card?.querySelector('.card__btn-want');
    if (btn) {
      btn.classList.add('is-pulsing');
      btn.disabled = true;
    }
    if (navigator.vibrate) navigator.vibrate(50);
    try {
      await seerr.requestMedia({ mediaType, mediaId: tmdbId, seasons });
      store.dispatch({ type: 'ADD_REQUESTED', id });
      toast(i18n.t('toast.requested', { title }), { variant: 'success' });
      if (btn) {
        btn.classList.add('is-requested');
        btn.querySelector('.card__btn-icon').textContent = '✅';
        btn.querySelector('.card__btn-label').textContent = i18n.t('card.requested');
      }
    } catch (err) {
      if (err instanceof AlreadyRequestedError) {
        store.dispatch({ type: 'ADD_REQUESTED', id });
        toast(i18n.t('toast.already_requested', { title }), { variant: 'warning' });
        if (btn) {
          btn.classList.add('is-requested');
          btn.querySelector('.card__btn-icon').textContent = '✅';
          btn.querySelector('.card__btn-label').textContent = i18n.t('card.already_requested');
        }
      } else if (err instanceof UnauthorizedError) {
        clearSession();
        renderAuthButton(null);
        toast(i18n.t('auth.session_expired'), { variant: 'error' });
        if (btn) btn.disabled = false;
      } else if (err instanceof NotConfiguredError) {
        toast(i18n.t('feed.read_only_banner'), { variant: 'warning' });
        if (btn) btn.disabled = false;
      } else {
        toast(i18n.t('toast.seerr_unreachable'), { variant: 'error' });
        if (btn) btn.disabled = false;
      }
    } finally {
      btn?.classList.remove('is-pulsing');
    }
  });

  appEl.addEventListener('card:watchlist', (e) => {
    store.dispatch({ type: 'TOGGLE_WATCHLIST', item: e.detail });
    const card = appEl.querySelector(`.card[data-item-id="${e.detail.id}"]`);
    const btn = card?.querySelector('.card__btn-watchlist');
    if (btn) {
      const isActive = store.getState().watchlistIds.has(e.detail.id);
      btn.classList.toggle('is-active', isActive);
    }
  });

  appEl.addEventListener('card:login-request', () => {
    handleLogin();
  });

  appEl.addEventListener('card:show-dates', (e) => {
    showDatesPopup(e.detail.item, i18n);
  });

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) feed.pauseAll();
    else feed.resumeCurrent();
  });

  // Online/offline banner
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.textContent = i18n.t('feed.offline_banner');
  offlineBanner.hidden = navigator.onLine;
  document.body.appendChild(offlineBanner);
  window.addEventListener('online', () => { offlineBanner.hidden = true; });
  window.addEventListener('offline', () => { offlineBanner.hidden = false; });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        feed.resumeCurrent();
        break;
      case 'ArrowDown':
        e.preventDefault();
        feed.scrollTo(store.getState().currentIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        feed.scrollTo(Math.max(0, store.getState().currentIndex - 1));
        break;
      case 'r':
      case 'R': {
        const idx = store.getState().currentIndex;
        const item = store.getState().feed[idx];
        if (item && seerrEnabled) {
          const card = appEl.querySelector(`.card[data-item-id="${item.id}"]`);
          card?.querySelector('.card__btn-want')?.click();
        }
        break;
      }
      case '/':
        e.preventDefault();
        search.open();
        break;
      case 's':
      case 'S':
        settings.toggle();
        break;
      case 'Escape':
        if (settings.isOpen()) settings.close();
        break;
    }
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }
}

function renderTmdbErrorScreen(i18n) {
  appEl.innerHTML = `
    <div class="error-screen">
      <div class="error-screen__title">${i18n.t('boot.error.tmdb_missing.title')}</div>
      <div class="error-screen__detail">${i18n.t('boot.error.tmdb_missing.detail')}</div>
      <button class="error-screen__action" onclick="location.reload()">${i18n.t('boot.error.tmdb_missing.retry')}</button>
    </div>
  `;
}

function showDatesPopup(item, i18n) {
  const popup = document.createElement('div');
  popup.className = 'dates-popup';
  const lines = buildDateLines(item, i18n);
  popup.innerHTML = `
    <div class="dates-popup__panel">
      <h3 class="dates-popup__title">${i18n.t('card.show_dates')}</h3>
      ${lines.length ? lines.map((l) => `
        <div class="dates-popup__row">
          <span class="dates-popup__label">${l.label}</span>
          <span class="dates-popup__value">${l.value}</span>
        </div>
      `).join('') : `<p class="dates-popup__row">${i18n.t('dates.empty')}</p>`}
      <button class="dates-popup__close">${i18n.t('dates.close')}</button>
    </div>
  `;
  popup.querySelector('.dates-popup__close').addEventListener('click', () => popup.remove());
  popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
  document.body.appendChild(popup);
}

function buildDateLines(item, i18n) {
  const lines = [];
  const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : null;

  if (item.mediaType === 'movie' && item.releaseDates?.results) {
    const fr = item.releaseDates.results.find((r) => r.iso_3166_1 === 'FR');
    const us = item.releaseDates.results.find((r) => r.iso_3166_1 === 'US');
    const region = fr || us || item.releaseDates.results[0];
    if (region) {
      const byType = (t) => region.release_dates.find((r) => r.type === t);
      const labels = { 3: 'dates.theatrical', 4: 'dates.digital', 5: 'dates.physical' };
      for (const [type, key] of Object.entries(labels)) {
        const r = byType(Number(type));
        if (r?.release_date) {
          lines.push({ label: i18n.t(key), value: fmt(r.release_date) });
        }
      }
    }
  } else if (item.mediaType === 'tv') {
    if (item.firstAirDate) lines.push({ label: i18n.t('dates.first_air'), value: fmt(item.firstAirDate) });
    if (item.lastAirDate) lines.push({ label: i18n.t('dates.last_air'), value: fmt(item.lastAirDate) });
    if (item.nextEpisodeToAir?.airDate) {
      lines.push({ label: i18n.t('dates.next_episode'), value: fmt(item.nextEpisodeToAir.airDate) });
    }
  }
  return lines;
}

main().catch((e) => console.error('app: fatal', e));
