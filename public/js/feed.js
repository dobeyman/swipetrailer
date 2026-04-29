import { createCard } from './card.js';
import { mountPlayer, unmountPlayer, play, pause, setMuted } from './youtube.js';
import { toast } from './toast.js';

const WINDOW_RADIUS = 2; // keep [i-2, i-1, i, i+1, i+2] in DOM
const LOAD_AHEAD = 8;    // start fetching next page when this many cards remain

export function shouldLoadMore(currentIdx, feedLength, isLoading) {
  if (isLoading) return false;
  return currentIdx >= feedLength - LOAD_AHEAD;
}

export function createFeed({ container, store, tmdb, seerr, i18n, genreMap, seerrEnabled }) {
  const feedEl = document.createElement('div');
  feedEl.className = 'feed';
  container.replaceChildren(feedEl);

  const players = new Map(); // itemId -> YT.Player instance
  const pendingMounts = new Set(); // itemId currently being mounted
  const cardEls = new Map(); // itemId -> HTMLElement
  let hasStarted = false;
  let currentPage = 1;
  let totalPages = 1;
  let isLoadingPage = false;

  let observerDebounceTimer = null;
  const pendingEntries = new Map(); // itemId -> latest IntersectionObserverEntry
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) pendingEntries.set(e.target.dataset.itemId, e);
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(() => {
        onIntersection([...pendingEntries.values()]);
        pendingEntries.clear();
      }, 150);
    },
    { root: feedEl, threshold: 0.8 }
  );

  function onIntersection(entries) {
    // Pick the most-visible intersecting card to avoid committing the wrong index
    // when two cards briefly exceed the threshold simultaneously during a swipe.
    let bestEntry = null;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
        if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
          bestEntry = entry;
        }
      }
    }

    // Pause everything that isn't the winner
    for (const entry of entries) {
      if (bestEntry?.target === entry.target) continue;
      const player = players.get(entry.target.dataset.itemId);
      if (player) pause(player);
    }

    if (bestEntry) {
      const id = bestEntry.target.dataset.itemId;
      const idx = store.getState().feed.findIndex((i) => i.id === id);
      if (idx >= 0) {
        store.dispatch({ type: 'SET_INDEX', index: idx });
        updateWindow(idx);
        loadMoreIfNeeded(idx);
      }
      const player = players.get(id);
      if (player && hasStarted) {
        play(player);
        if (!isIOS()) setMuted(player, false);
      }
    }
  }

  function updateWindow(centerIdx) {
    const feed = store.getState().feed;
    const minIdx = Math.max(0, centerIdx - WINDOW_RADIUS);
    const maxIdx = Math.min(feed.length - 1, centerIdx + WINDOW_RADIUS);
    const liveIds = new Set();
    for (let i = minIdx; i <= maxIdx; i++) liveIds.add(feed[i].id);

    // Unmount players outside window; only remove DOM nodes for tail cards
    // (never remove head cards — that shifts scrollTop mid-animation and breaks snap)
    for (const [id, el] of cardEls) {
      if (!liveIds.has(id)) {
        const p = players.get(id);
        if (p) { unmountPlayer(p); players.delete(id); }
        const itemIdx = feed.findIndex((i) => i.id === id);
        if (itemIdx > maxIdx) {
          observer.unobserve(el);
          el.remove();
          cardEls.delete(id);
        }
      }
    }

    // Mount cards inside window if missing
    for (let i = minIdx; i <= maxIdx; i++) {
      const item = feed[i];
      if (cardEls.has(item.id)) continue;
      const el = renderCard(item);
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
    const videoEl = el.querySelector('.card__video');
    if (!videoEl) return;
    pendingMounts.add(item.id);
    // Mount into a child div, not .card__video itself. YT.Player *replaces* its
    // target element, which would destroy .card__video's aspect-ratio flex-child
    // styles and cause the iframe to fill the full card height (black bars).
    const target = document.createElement('div');
    videoEl.appendChild(target);
    const cover = el.querySelector('.card__video-cover');
    try {
      const player = await mountPlayer(target, item.trailerKey, {
        autoplay: false,
        onError: () => {},
        onStateChange: (e) => {
          if (e.data === 1) {
            if (cover) cover.classList.add('is-hidden');
            // Video is now playing (muted play succeeded) — safe to unmute.
            if (hasStarted && !isIOS()) setMuted(player, false);
          }
        },
      });
      if (!cardEls.has(item.id)) {
        unmountPlayer(player);
        return;
      }
      players.set(item.id, player);

      // Cover tap: direct user gesture — mark started so subsequent cards auto-play
      if (cover) {
        cover.addEventListener('click', () => {
          hasStarted = true;
          play(player);
          if (!isIOS()) setMuted(player, false);
          cover.classList.add('is-hidden');
        }, { once: true });
      }

      // Auto-play if this is the currently visible card and user has started
      const currentItem = store.getState().feed[store.getState().currentIndex];
      if (currentItem?.id === item.id && hasStarted) {
        play(player);
        if (!isIOS()) setMuted(player, false);
      }
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
    if (!shouldLoadMore(currentIdx, feed.length, isLoadingPage)) return;
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const nextPage = currentPage >= totalPages ? 1 : currentPage + 1;
      const { items, totalPages: tp } = await tmdb.fetchTrending(nextPage, filter);
      const enriched = await enrichItems(items);
      store.dispatch({ type: 'APPEND_FEED', items: enriched });
      currentPage = nextPage;
      totalPages = tp;
      updateWindow(store.getState().currentIndex);
    } catch (e) {
      console.error('feed: pagination failed', e);
      toast(i18n.t('feed.loading_more_failed'), { variant: 'error' });
    } finally {
      isLoadingPage = false;
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function enrichItems(items) {
    const enrichOne = async (item) => {
      const [trailerKey, details, releaseDates] = await Promise.all([
        tmdb.fetchTrailerKey(item.mediaType, item.tmdbId).catch(() => null),
        seerrEnabled
          ? seerr.fetchMediaDetails(item.mediaType, item.tmdbId).catch(() => null)
          : Promise.resolve(null),
        item.mediaType === 'movie'
          ? tmdb.fetchReleaseDates(item.tmdbId).catch(() => null)
          : Promise.resolve(null),
      ]);
      const seerrStatus = details?.mediaInfo?.status ?? null;
      return {
        ...item,
        trailerKey,
        seerrStatus,
        releaseDates: item.mediaType === 'movie' ? releaseDates : null,
        firstAirDate: details?.firstAirDate ?? null,
        lastAirDate: details?.lastAirDate ?? null,
        nextEpisodeToAir: details?.nextEpisodeToAir ?? null,
        seasons: details?.seasons?.map((s) => s.seasonNumber).filter((n) => n > 0) ?? null,
      };
    };
    const enriched = await Promise.all(items.map(enrichOne));
    return shuffle(enriched.filter((i) => i.trailerKey));
  }

  async function init() {
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const results = await Promise.all(
        [1, 2, 3].map((p) => tmdb.fetchTrending(p, filter).catch(() => null))
      );
      const allItems = results.flatMap((r) => r?.items ?? []);
      const seen = new Set();
      const unique = allItems.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const tp = Math.max(...results.filter(Boolean).map((r) => r.totalPages));
      const enriched = await enrichItems(unique);
      currentPage = 3;
      totalPages = tp;
      store.dispatch({ type: 'SET_FEED', items: enriched });
      if (enriched.length === 0) {
        showEmptyState();
        return;
      }
      updateWindow(0);
      showStartGate();
    } catch (e) {
      console.error('feed: init failed', e);
      showErrorState();
    } finally {
      isLoadingPage = false;
    }
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function showStartGate() {
    if (isIOS()) {
      // iOS: muted autoplay works without user gesture — skip the gate
      hasStarted = true;
      const item = store.getState().feed[store.getState().currentIndex];
      if (item) {
        const p = players.get(item.id);
        if (p) play(p);
      }
      return;
    }

    const gate = document.createElement('div');
    gate.className = 'start-gate';
    gate.innerHTML = `<button class="start-gate__btn">▶ ${i18n.t('feed.start')}</button>`;
    gate.addEventListener('click', () => {
      hasStarted = true;
      gate.remove();
      const item = store.getState().feed[store.getState().currentIndex];
      if (!item) return;
      const p = players.get(item.id);
      if (p) {
        play(p);
        setMuted(p, false); // user gesture context → Chrome delegates allow="autoplay"
      }
    }, { once: true });
    document.body.appendChild(gate);
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
    if (!hasStarted) return;
    const idx = store.getState().currentIndex;
    const item = store.getState().feed[idx];
    if (!item) return;
    const p = players.get(item.id);
    if (p) {
      play(p);
      if (!isIOS()) setMuted(p, false);
    }
  }

  function scrollTo(index) {
    const feed = store.getState().feed;
    const item = feed[index];
    if (!item) return;
    const el = cardEls.get(item.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function prependItem(rawItem) {
    const feed = store.getState().feed;
    const existingIdx = feed.findIndex((i) => i.id === rawItem.id);
    if (existingIdx >= 0) {
      scrollTo(existingIdx);
      return;
    }
    const enriched = await enrichItems([rawItem]);
    const item = enriched[0] ?? {
      ...rawItem,
      trailerKey: null,
      seerrStatus: null,
      releaseDates: null,
      firstAirDate: null,
      lastAirDate: null,
      nextEpisodeToAir: null,
      seasons: null,
    };
    store.dispatch({ type: 'PREPEND_FEED', items: [item] });
    store.dispatch({ type: 'SET_INDEX', index: 0 });
    updateWindow(0);
    scrollTo(0);
  }

  return { init, reset, setMutedAll, pauseAll, resumeCurrent, scrollTo, prependItem };
}
