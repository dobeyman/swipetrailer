const LANGUAGES = [
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'en', label: '🇬🇧 Anglais' },
  { code: 'ko', label: '🇰🇷 Coréen' },
  { code: 'ja', label: '🇯🇵 Japonais' },
  { code: 'es', label: '🇪🇸 Espagnol' },
  { code: 'de', label: '🇩🇪 Allemand' },
  { code: 'it', label: '🇮🇹 Italien' },
  { code: 'pt', label: '🇵🇹 Portugais' },
  { code: 'zh', label: '🇨🇳 Chinois' },
  { code: 'hi', label: '🇮🇳 Hindi' },
];

export function createFilters({ container, store, tmdb, i18n, onFiltersChange }) {
  let genreList = []; // [{ id, name }] — chargé depuis TMDB

  async function loadGenres() {
    const map = await tmdb.loadGenres();
    const { filter } = store.getState().preferences;
    const seen = new Set();
    const genres = [];
    for (const [key, name] of map.entries()) {
      const [type, idStr] = key.split(':');
      const id = Number(idStr);
      if (filter === 'movie' && type !== 'movie') continue;
      if (filter === 'tv' && type !== 'tv') continue;
      if (!seen.has(id)) {
        seen.add(id);
        genres.push({ id, name });
      }
    }
    genres.sort((a, b) => a.name.localeCompare(b.name));
    genreList = genres;
  }

  function open() {
    loadGenres().then(() => render()).catch(() => {
      genreList = [];
      render();
    });
  }

  function render() {
    const existing = container.querySelector('.filters-overlay');
    if (existing) existing.remove();

    const { genres: activeGenres, languages: activeLangs } = store.getState().preferences;

    const overlay = document.createElement('div');
    overlay.className = 'filters-overlay';

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const hasActive = activeGenres.length > 0 || activeLangs.length > 0;

    overlay.innerHTML = `
      <div class="filters-panel">
        <div class="filters-panel__handle"></div>
        <div class="filters-panel__header">
          <h2 class="filters-panel__title">Filtres</h2>
          <button class="filters-panel__reset" ${hasActive ? '' : 'disabled'} data-action="reset">
            Réinitialiser
          </button>
        </div>
        <div class="filters-panel__body">
          <div class="filters-section">
            <div class="filters-section__label">Genres</div>
            <div class="filters-chips" data-group="genres">
              ${genreList.map((g) => `
                <button class="filters-chip ${activeGenres.includes(g.id) ? 'is-selected' : ''}"
                        data-id="${g.id}">
                  ${escapeHtml(g.name)}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="filters-section">
            <div class="filters-section__label">Langue originale</div>
            <div class="filters-chips" data-group="languages">
              ${LANGUAGES.map((l) => `
                <button class="filters-chip ${activeLangs.includes(l.code) ? 'is-selected' : ''}"
                        data-code="${l.code}">
                  ${l.label}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="filters-panel__footer">
          <button class="filters-apply-btn" data-action="apply">Appliquer</button>
        </div>
      </div>
    `;

    // Toggle genre chips
    overlay.querySelector('[data-group="genres"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.filters-chip');
      if (!chip) return;
      chip.classList.toggle('is-selected');
      updateResetBtn(overlay);
    });

    // Toggle language chips
    overlay.querySelector('[data-group="languages"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.filters-chip');
      if (!chip) return;
      chip.classList.toggle('is-selected');
      updateResetBtn(overlay);
    });

    // Reset
    overlay.querySelector('[data-action="reset"]').addEventListener('click', () => {
      overlay.querySelectorAll('.filters-chip.is-selected').forEach((c) => c.classList.remove('is-selected'));
      updateResetBtn(overlay);
    });

    // Apply
    overlay.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const genres = [...overlay.querySelectorAll('[data-group="genres"] .filters-chip.is-selected')]
        .map((c) => Number(c.dataset.id));
      const languages = [...overlay.querySelectorAll('[data-group="languages"] .filters-chip.is-selected')]
        .map((c) => c.dataset.code);
      store.dispatch({ type: 'SET_GENRE_FILTERS', genres });
      store.dispatch({ type: 'SET_LANGUAGE_FILTERS', languages });
      close();
      onFiltersChange?.();
    });

    container.appendChild(overlay);
  }

  function updateResetBtn(overlay) {
    const hasSelected = overlay.querySelector('.filters-chip.is-selected') !== null;
    const btn = overlay.querySelector('[data-action="reset"]');
    if (btn) btn.disabled = !hasSelected;
  }

  function close() {
    const overlay = container.querySelector('.filters-overlay');
    if (overlay) overlay.remove();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  return { open, close };
}
