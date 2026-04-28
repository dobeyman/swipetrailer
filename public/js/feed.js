import { createCard } from './card.js';
import { mountPlayer, unmountPlayer, play, pause, setMuted } from './youtube.js';
import { toast } from './toast.js';

const WINDOW_RADIUS = 2; // keep [i-2, i-1, i, i+1, i+2] in DOM

export function createFeed({ container, store, tmdb, seerr, i18n, genreMap, seerrEnabled }) {
  const feedEl = document.createElement('div');
  feedEl.className = 'feed';
  container.replaceChildren(feedEl);

  const players = new Map(); // itemId -> YT.Player instance
  const pendingMounts = new Set(); // itemId currently being mounted
  const cardEls = new Map(); // itemId -> HTMLElement
  let currentPage = 1;
  let totalPages = 1;
  let isLoadingPage = false;

  let observerDebounceTimer = null;
  const observer = new IntersectionObserver(
    (entries) => {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(() => onIntersection(entries), 150);
    },
    { root: feedEl, threshold: 0.8 }
  );

  function onIntersection(entries) {
    for (const entry of entries) {
      const id = entry.target.dataset.itemId;
      const player = players.get(id);
      if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
        const idx = store.getState().feed.findIndex((i) => i.id === id);
        if (idx >= 0) {
          store.dispatch({ type: 'SET_INDEX', index: idx });
          updateWindow(idx);
          loadMoreIfNeeded(idx);
        }
        if (player) {
          play(player);
          setMuted(player, store.getState().isMutedGlobally);
        }
      } else {
        if (player) {
          pause(player);
          setMuted(player, true);
        }
      }
    }
  }

  function updateWindow(centerIdx) {
    const feed = store.getState().feed;
    const minIdx = Math.max(0, centerIdx - WINDOW_RADIUS);
    const maxIdx = Math.min(feed.length - 1, centerIdx + WINDOW_RADIUS);
    const liveIds = new Set();
    for (let i = minIdx; i <= maxIdx; i++) liveIds.add(feed[i].id);

    // Unmount cards outside window
    for (const [id, el] of cardEls) {
      if (!liveIds.has(id)) {
        const p = players.get(id);
        if (p) { unmountPlayer(p); players.delete(id); }
        observer.unobserve(el);
        el.remove();
        cardEls.delete(id);
      }
    }

    // Mount cards inside window if missing
    for (let i = minIdx; i <= maxIdx; i++) {
      const item = feed[i];
      if (cardEls.has(item.id)) continue;
      const el = renderCard(item);
      // Position-correct insertion: find the next existing card with greater index
      let nextEl = null;
      for (let j = i + 1; j <= maxIdx; j++) {
        const found = cardEls.get(feed[j]?.id);
        if (found) { nextEl = found; break; }
      }
      feedEl.insertBefore(el, nextEl);
      cardEls.set(item.id, el);
      observer.observe(el);
      attachPlayerIfReady(item, el);
    }
  }

  async function attachPlayerIfReady(item, el) {
    if (!item.trailerKey) return;
    if (players.has(item.id) || pendingMounts.has(item.id)) return;
    const target = el.querySelector('.card__video');
    if (!target) return;
    pendingMounts.add(item.id);
    try {
      const player = await mountPlayer(target, item.trailerKey, {
        autoplay: false,
        onError: () => {
          toast(i18n.t('card.unavailable'), { variant: 'warning' });
        },
      });
      // Card may have been unmounted while we were awaiting
      if (!cardEls.has(item.id)) {
        unmountPlayer(player);
        return;
      }
      players.set(item.id, player);
    } catch (e) {
      console.error('feed: mount player failed', e);
    } finally {
      pendingMounts.delete(item.id);
    }
  }

  function renderCard(item) {
    return createCard({
      item,
      i18n,
      genreMap,
      seerrEnabled,
      requestedIds: store.getState().requestedIds,
      watchlistIds: store.getState().watchlistIds,
    });
  }

  async function loadMoreIfNeeded(currentIdx) {
    const feed = store.getState().feed;
    if (currentIdx < feed.length - 3) return;
    if (isLoadingPage) return;
    if (currentPage >= totalPages) return;
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const { items, totalPages: tp } = await tmdb.fetchTrending(currentPage + 1, filter);
      const enriched = await enrichItems(items);
      store.dispatch({ type: 'APPEND_FEED', items: enriched });
      currentPage += 1;
      totalPages = tp;
      updateWindow(store.getState().currentIndex);
    } catch (e) {
      console.error('feed: pagination failed', e);
      toast(i18n.t('feed.loading_more_failed'), { variant: 'error' });
    } finally {
      isLoadingPage = false;
    }
  }

  async function enrichItems(items) {
    const enrichOne = async (item) => {
      const [trailerKey, details] = await Promise.all([
        tmdb.fetchTrailerKey(item.mediaType, item.tmdbId).catch(() => null),
        seerrEnabled
          ? seerr.fetchMediaDetails(item.mediaType, item.tmdbId).catch(() => null)
          : Promise.resolve(null),
      ]);
      const seerrStatus = details?.mediaInfo?.status ?? null;
      return {
        ...item,
        trailerKey,
        seerrStatus,
        releaseDates: details?.releaseDates ?? null,
        firstAirDate: details?.firstAirDate ?? null,
        lastAirDate: details?.lastAirDate ?? null,
        nextEpisodeToAir: details?.nextEpisodeToAir ?? null,
      };
    };
    const enriched = await Promise.all(items.map(enrichOne));
    return enriched.filter((i) => i.trailerKey); // drop items without trailers
  }

  async function init() {
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const { items, totalPages: tp } = await tmdb.fetchTrending(1, filter);
      const enriched = await enrichItems(items);
      currentPage = 1;
      totalPages = tp;
      store.dispatch({ type: 'SET_FEED', items: enriched });
      if (enriched.length === 0) {
        showEmptyState();
        return;
      }
      updateWindow(0);
      // Start auto-play on first card after a tick
      setTimeout(() => {
        const firstId = enriched[0].id;
        const p = players.get(firstId);
        if (p) {
          play(p);
          setMuted(p, store.getState().isMutedGlobally);
        }
      }, 200);
    } catch (e) {
      console.error('feed: init failed', e);
      showErrorState();
    } finally {
      isLoadingPage = false;
    }
  }

  function showEmptyState() {
    feedEl.innerHTML = `
      <div class="error-screen">
        <div class="error-screen__title">${i18n.t('feed.empty')}</div>
        <button class="error-screen__action" onclick="location.reload()">${i18n.t('feed.retry')}</button>
      </div>
    `;
  }

  function showErrorState() {
    feedEl.innerHTML = `
      <div class="error-screen">
        <div class="error-screen__title">${i18n.t('feed.error')}</div>
        <button class="error-screen__action" onclick="location.reload()">${i18n.t('feed.retry')}</button>
      </div>
    `;
  }

  function reset() {
    for (const p of players.values()) unmountPlayer(p);
    players.clear();
    pendingMounts.clear();
    cardEls.clear();
    feedEl.innerHTML = '';
    currentPage = 1;
    totalPages = 1;
    isLoadingPage = false;
  }

  function setMutedAll(muted) {
    for (const p of players.values()) setMuted(p, muted);
  }

  function pauseAll() {
    for (const p of players.values()) pause(p);
  }

  function resumeCurrent() {
    const idx = store.getState().currentIndex;
    const item = store.getState().feed[idx];
    if (!item) return;
    const p = players.get(item.id);
    if (p) {
      play(p);
      setMuted(p, store.getState().isMutedGlobally);
    }
  }

  function scrollTo(index) {
    const feed = store.getState().feed;
    const item = feed[index];
    if (!item) return;
    const el = cardEls.get(item.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { init, reset, setMutedAll, pauseAll, resumeCurrent, scrollTo };
}
