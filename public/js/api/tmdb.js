const TMDB_PROXY = '/api/tmdb';

export function createTmdbClient({ fetch: fetchImpl = globalThis.fetch } = {}) {
  let genreMap = null;

  async function loadGenres() {
    if (genreMap) return genreMap;
    const [m, t] = await Promise.all([
      fetchImpl(`${TMDB_PROXY}/genre/movie/list?language=fr-FR`).then((r) => r.json()),
      fetchImpl(`${TMDB_PROXY}/genre/tv/list?language=fr-FR`).then((r) => r.json()),
    ]);
    const map = new Map();
    (m.genres || []).forEach((g) => map.set(`movie:${g.id}`, g.name));
    (t.genres || []).forEach((g) => map.set(`tv:${g.id}`, g.name));
    genreMap = map;
    return map;
  }

  function endpointForFilter(filter) {
    if (filter === 'movie') return 'trending/movie/week';
    if (filter === 'tv') return 'trending/tv/week';
    return 'trending/all/week';
  }

  function normalizeTmdbItem(raw, fallbackMediaType) {
    const mediaType = raw.media_type || fallbackMediaType;
    const isTv = mediaType === 'tv';
    const title = isTv ? raw.name : raw.title;
    const date = isTv ? raw.first_air_date : raw.release_date;
    const year = date ? Number(date.slice(0, 4)) : null;
    return {
      id: `${mediaType}-${raw.id}`,
      tmdbId: raw.id,
      mediaType,
      title,
      overview: raw.overview || '',
      genreIds: raw.genre_ids || [],
      originalLanguage: raw.original_language || null,
      rating: raw.vote_average || 0,
      year,
      posterPath: raw.poster_path,
      backdropPath: raw.backdrop_path,
      trailerKey: null,        // filled by fetchTrailerKey
      seerrStatus: null,       // filled by Seerr enrichment
      releaseDates: null,      // filled by Seerr enrichment
    };
  }

  async function fetchTrending(page, filter) {
    const url = `${TMDB_PROXY}/${endpointForFilter(filter)}?page=${page}&language=fr-FR`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
    const json = await res.json();
    const fallback = filter === 'tv' ? 'tv' : filter === 'movie' ? 'movie' : null;
    const items = (json.results || []).map((r) => normalizeTmdbItem(r, fallback));
    return { items, totalPages: json.total_pages || 1 };
  }

  async function fetchEndpoint(path, mediaType, page) {
    const url = `${TMDB_PROXY}/${path}?page=${page}&language=fr-FR`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
    const json = await res.json();
    const items = (json.results || []).map((r) => normalizeTmdbItem(r, mediaType));
    return { items, totalPages: json.total_pages || 1 };
  }

  function sourcesForFilter(filter) {
    const sources = [(page) => fetchTrending(page, filter)];
    if (filter !== 'tv') {
      sources.push((page) => fetchEndpoint('movie/top_rated', 'movie', page));
      sources.push((page) => fetchEndpoint('movie/now_playing', 'movie', page));
    }
    if (filter !== 'movie') {
      sources.push((page) => fetchEndpoint('tv/top_rated', 'tv', page));
      sources.push((page) => fetchEndpoint('tv/on_the_air', 'tv', page));
    }
    return sources;
  }

  async function fetchMixed(page, filter) {
    const sources = sourcesForFilter(filter);
    const results = await Promise.allSettled(sources.map((fn) => fn(page)));
    const fulfilled = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    if (fulfilled.length === 0) throw new Error('All TMDB sources failed');
    const seen = new Set();
    const items = [];
    for (const result of fulfilled) {
      for (const item of result.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
    }
    const totalPages = Math.max(...fulfilled.map((r) => r.totalPages));
    return { items, totalPages };
  }

  async function fetchReleaseDates(tmdbId) {
    const url = `${TMDB_PROXY}/movie/${tmdbId}/release_dates`;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return await res.json();
  }

  async function fetchTrailerKey(mediaType, tmdbId) {
    const url = `${TMDB_PROXY}/${mediaType}/${tmdbId}/videos?language=fr-FR&include_video_language=fr,en,null`;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = await res.json();
    const youtubeOnly = (json.results || []).filter((v) => v.site === 'YouTube');
    const trailers = youtubeOnly.filter((v) => v.type === 'Trailer');
    const teasers = youtubeOnly.filter((v) => v.type === 'Teaser');
    const candidates = [...trailers, ...teasers];
    const fr = candidates.find((v) => v.iso_639_1 === 'fr');
    if (fr) return fr.key;
    const en = candidates.find((v) => v.iso_639_1 === 'en');
    if (en) return en.key;
    return candidates[0]?.key || null;
  }

  async function fetchSearch(query) {
    const url = `${TMDB_PROXY}/search/multi?query=${encodeURIComponent(query)}&language=fr-FR&page=1`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
    const json = await res.json();
    return (json.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .filter((r) => r.poster_path)
      .slice(0, 8)
      .map((r) => normalizeTmdbItem(r, r.media_type));
  }

  async function fetchDiscoverEndpoint(endpoint, mediaType, page, genreIds, language) {
    const params = new URLSearchParams({ page, language: 'fr-FR' });
    if (genreIds.length > 0) params.set('with_genres', genreIds.join('|'));
    if (language) params.set('with_original_language', language);
    const url = `${TMDB_PROXY}/${endpoint}?${params}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB discover failed: ${res.status}`);
    const json = await res.json();
    const items = (json.results || []).map((r) => normalizeTmdbItem(r, mediaType));
    return { items, totalPages: json.total_pages || 1 };
  }

  async function fetchDiscover(page, filter, genreIds, languages) {
    const langs = languages.length > 0 ? languages : [null];
    const endpoints = [];
    if (filter !== 'tv')  endpoints.push({ path: 'discover/movie', mediaType: 'movie' });
    if (filter !== 'movie') endpoints.push({ path: 'discover/tv', mediaType: 'tv' });

    const requests = endpoints.flatMap(({ path, mediaType }) =>
      langs.map((lang) => fetchDiscoverEndpoint(path, mediaType, page, genreIds, lang))
    );

    const results = await Promise.allSettled(requests);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (fulfilled.length === 0) throw new Error('All TMDB discover sources failed');

    const seen = new Set();
    const items = [];
    for (const result of fulfilled) {
      for (const item of result.items) {
        if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
      }
    }
    const totalPages = Math.max(...fulfilled.map((r) => r.totalPages));
    return { items, totalPages };
  }

  async function fetchById(mediaType, tmdbId) {
    const url = `${TMDB_PROXY}/${mediaType}/${tmdbId}?language=fr-FR`;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const raw = await res.json();
    return normalizeTmdbItem(raw, mediaType);
  }

  return { loadGenres, fetchTrending, fetchTrailerKey, fetchReleaseDates, fetchSearch, fetchMixed, fetchDiscover, fetchById };
}
