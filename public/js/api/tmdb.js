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

  return { loadGenres, fetchTrending, fetchTrailerKey, fetchReleaseDates, fetchSearch };
}
