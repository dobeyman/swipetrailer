const SEERR_PROXY = '/api/seerr/api/v1';

export class AlreadyRequestedError extends Error {
  constructor() { super('already_requested'); this.name = 'AlreadyRequestedError'; }
}
export class UnauthorizedError extends Error {
  constructor() { super('seerr_unauthorized'); this.name = 'UnauthorizedError'; }
}
export class UnreachableError extends Error {
  constructor() { super('seerr_unreachable'); this.name = 'UnreachableError'; }
}
export class NotConfiguredError extends Error {
  constructor() { super('seerr_not_configured'); this.name = 'NotConfiguredError'; }
}

export function createSeerrClient({ fetch: fetchImpl = globalThis.fetch, enabled = false } = {}) {
  async function requestMedia({ mediaType, mediaId, seasons }) {
    if (!enabled) throw new NotConfiguredError();
    let resolvedSeasons = seasons;
    if (mediaType === 'tv' && !resolvedSeasons?.length) {
      try {
        const r = await fetchImpl(`${SEERR_PROXY}/tv/${mediaId}`);
        if (r.ok) {
          const d = await r.json();
          resolvedSeasons = d?.seasons?.map((s) => s.seasonNumber).filter((n) => n > 0) ?? null;
        }
      } catch { /* fall through */ }
    }
    const body = { mediaType, mediaId };
    if (mediaType === 'tv' && resolvedSeasons?.length) body.seasons = resolvedSeasons;
    let res;
    try {
      res = await fetchImpl(`${SEERR_PROXY}/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new UnreachableError();
    }
    if (res.status === 201 || res.status === 200) return await res.json();
    if (res.status === 409) throw new AlreadyRequestedError();
    if (res.status === 401 || res.status === 403) throw new UnauthorizedError();
    throw new UnreachableError();
  }

  async function fetchMediaDetails(mediaType, tmdbId) {
    if (!enabled) return null;
    let res;
    try {
      res = await fetchImpl(`${SEERR_PROXY}/${mediaType}/${tmdbId}`);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  }

  return { requestMedia, fetchMediaDetails };
}
