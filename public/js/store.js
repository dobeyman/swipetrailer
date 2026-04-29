export const initialState = Object.freeze({
  feed: [],
  requestedIds: new Set(),
  watchlistIds: new Set(),
  watchlist: [], // [{ id, mediaType, title, posterPath }]
  currentIndex: 0,
  preferences: { filter: 'all', locale: 'fr' },
  health: null, // { tmdb, seerr, seerrType }
  isMutedGlobally: false,
});

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_FEED':
      return { ...state, feed: [...action.items] };
    case 'APPEND_FEED':
      return { ...state, feed: [...state.feed, ...action.items] };
    case 'PREPEND_FEED':
      return { ...state, feed: [...action.items, ...state.feed] };
    case 'ENRICH_ITEM': {
      const feed = state.feed.map((i) =>
        i.id === action.id ? { ...i, ...action.patch } : i
      );
      return { ...state, feed };
    }
    case 'ADD_REQUESTED': {
      const requestedIds = new Set(state.requestedIds);
      requestedIds.add(action.id);
      return { ...state, requestedIds };
    }
    case 'TOGGLE_WATCHLIST': {
      const watchlistIds = new Set(state.watchlistIds);
      let watchlist = state.watchlist;
      if (watchlistIds.has(action.item.id)) {
        watchlistIds.delete(action.item.id);
        watchlist = watchlist.filter((i) => i.id !== action.item.id);
      } else {
        watchlistIds.add(action.item.id);
        watchlist = [...watchlist, action.item];
      }
      return { ...state, watchlistIds, watchlist };
    }
    case 'CLEAR_WATCHLIST':
      return { ...state, watchlistIds: new Set(), watchlist: [] };
    case 'SET_INDEX':
      return { ...state, currentIndex: action.index };
    case 'SET_FILTER':
      return {
        ...state,
        preferences: { ...state.preferences, filter: action.value },
      };
    case 'SET_LOCALE':
      return {
        ...state,
        preferences: { ...state.preferences, locale: action.value },
      };
    case 'SET_HEALTH':
      return { ...state, health: action.health };
    case 'SET_MUTED':
      return { ...state, isMutedGlobally: action.value };
    default:
      return state;
  }
}

const PERSISTED_KEYS = {
  'ts.requestedIds': (s) => Array.from(s.requestedIds),
  'ts.watchlist': (s) => s.watchlist,
  'ts.preferences': (s) => s.preferences,
  'ts.lastIndex': (s) => s.currentIndex,
};

export function createStore({ storage = globalThis.localStorage } = {}) {
  let state = initialState;
  const listeners = new Set();

  function getState() { return state; }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function persist() {
    if (!storage) return;
    for (const [key, picker] of Object.entries(PERSISTED_KEYS)) {
      try {
        storage.setItem(key, JSON.stringify(picker(state)));
      } catch (e) { /* localStorage full or disabled */ }
    }
  }

  function dispatch(action) {
    state = reducer(state, action);
    persist();
    listeners.forEach((fn) => fn(state, action));
  }

  function hydrate() {
    if (!storage) return;
    try {
      const ids = storage.getItem('ts.requestedIds');
      if (ids) state = { ...state, requestedIds: new Set(JSON.parse(ids)) };
      const wl = storage.getItem('ts.watchlist');
      if (wl) {
        const list = JSON.parse(wl);
        state = {
          ...state,
          watchlist: list,
          watchlistIds: new Set(list.map((i) => i.id)),
        };
      }
      const prefs = storage.getItem('ts.preferences');
      if (prefs) state = { ...state, preferences: { ...state.preferences, ...JSON.parse(prefs) } };
      const idx = storage.getItem('ts.lastIndex');
      if (idx) state = { ...state, currentIndex: Number(idx) };
    } catch (e) { /* corrupt storage, fall back to defaults */ }
  }

  return { getState, subscribe, dispatch, hydrate };
}
