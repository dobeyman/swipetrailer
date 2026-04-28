let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPromptEvent = e;
});

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function createSettings({ container, store, i18n, onFilterChange }) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.hidden = true;

  function render() {
    const state = store.getState();
    const installable = !!installPromptEvent || isIOS();
    overlay.innerHTML = `
      <div class="settings-panel" role="dialog" aria-label="${i18n.t('settings.title')}">
        <div class="settings-panel__header">
          <h2>${i18n.t('settings.title')}</h2>
          <button class="settings-panel__close" aria-label="${i18n.t('settings.close')}">✕</button>
        </div>
        <div class="settings-panel__body">
          <section class="settings-section">
            <label class="settings-label">${i18n.t('settings.filter')}</label>
            <div class="settings-segmented" data-name="filter">
              <button class="${state.preferences.filter === 'all' ? 'is-active' : ''}" data-value="all">${i18n.t('settings.filter.all')}</button>
              <button class="${state.preferences.filter === 'movie' ? 'is-active' : ''}" data-value="movie">${i18n.t('settings.filter.movie')}</button>
              <button class="${state.preferences.filter === 'tv' ? 'is-active' : ''}" data-value="tv">${i18n.t('settings.filter.tv')}</button>
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">${i18n.t('settings.watchlist')}</label>
            <button class="settings-row-btn" data-action="watchlist-view">
              ${i18n.t('settings.watchlist_view')}
              <span class="settings-row-btn__count">${state.watchlist.length}</span>
            </button>
            <button class="settings-row-btn settings-row-btn--danger" data-action="watchlist-clear">
              ${i18n.t('settings.watchlist_clear')}
            </button>
          </section>

          ${
            !isStandalone()
              ? `
          <section class="settings-section">
            <button class="settings-row-btn settings-row-btn--primary"
                    data-action="install"
                    ${installable ? '' : 'disabled'}
                    title="${installable ? '' : i18n.t('settings.install_unsupported')}">
              ${i18n.t('settings.install')}
            </button>
            <p class="settings-hint" id="install-hint" hidden>${i18n.t('settings.install_ios_help')}</p>
          </section>
          `
              : ''
          }
        </div>
      </div>
    `;

    overlay.querySelector('.settings-panel__close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('[data-name="filter"]').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      const value = btn.dataset.value;
      store.dispatch({ type: 'SET_FILTER', value });
      onFilterChange?.(value);
      render();
    });

    overlay.querySelector('[data-action="watchlist-view"]')?.addEventListener('click', showWatchlistModal);
    overlay.querySelector('[data-action="watchlist-clear"]')?.addEventListener('click', () => {
      if (confirm(i18n.t('settings.watchlist_clear_confirm'))) {
        store.dispatch({ type: 'CLEAR_WATCHLIST' });
        render();
      }
    });

    const installBtn = overlay.querySelector('[data-action="install"]');
    if (installBtn) installBtn.addEventListener('click', triggerInstall);
  }

  async function triggerInstall() {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      installPromptEvent = null;
      return;
    }
    if (isIOS()) {
      const hint = overlay.querySelector('#install-hint');
      if (hint) hint.hidden = false;
    }
  }

  function showWatchlistModal() {
    const list = store.getState().watchlist;
    const modal = document.createElement('div');
    modal.className = 'watchlist-modal';
    if (list.length === 0) {
      modal.innerHTML = `
        <div class="watchlist-modal__panel">
          <p>${i18n.t('settings.watchlist_empty')}</p>
          <button class="watchlist-modal__close">${i18n.t('settings.close')}</button>
        </div>`;
    } else {
      modal.innerHTML = `
        <div class="watchlist-modal__panel">
          <h3>${i18n.t('settings.watchlist')}</h3>
          <ul class="watchlist-modal__list">
            ${list
              .map(
                (i) => `
              <li>
                ${i.posterPath ? `<img src="https://image.tmdb.org/t/p/w92${i.posterPath}" alt="" loading="lazy">` : ''}
                <span>${i.title}</span>
              </li>`
              )
              .join('')}
          </ul>
          <button class="watchlist-modal__close">${i18n.t('settings.close')}</button>
        </div>`;
    }
    modal.querySelector('.watchlist-modal__close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    container.appendChild(modal);
  }

  function open() {
    render();
    overlay.hidden = false;
    container.appendChild(overlay);
  }

  function close() {
    overlay.hidden = true;
    overlay.remove();
  }

  function toggle() {
    if (overlay.hidden) open();
    else close();
  }

  function isOpen() { return !overlay.hidden; }

  return { open, close, toggle, isOpen };
}
