const STORAGE_KEY = 'ts.auth';
const PENDING_KEY = 'ts.plex-pending';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function saveSession(session, user) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      session,
      user,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }));
  } catch { /* storage full */ }
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!parsed.session || !parsed.user) return null;
    return { session: parsed.session, user: parsed.user };
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export async function checkSession() {
  const stored = getSession();
  if (!stored) return null;
  try {
    const res = await fetch('/api/seerr/api/v1/auth/me', {
      headers: { 'X-Seerr-Session': stored.session },
    });
    if (res.status === 401 || res.status === 403) {
      clearSession();
      return null;
    }
    return stored;
  } catch {
    return stored; // offline — trust stored session
  }
}

// Redirect the current tab to Plex auth.
// Stores {pinId, cardId} in sessionStorage so handlePlexAuthReturn()
// can finish the flow when the app reloads on return.
export async function startPlexLogin({ cardId = null } = {}) {
  const res = await fetch('/api/auth/plex/pin', { method: 'POST' });
  if (!res.ok) throw new Error('pin_request_failed');
  const { pinId, authUrl } = await res.json();

  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ pinId, cardId }));
  } catch { /* ignore */ }

  const returnUrl = `${window.location.origin}/?plex_auth=1`;
  window.location.href = `${authUrl}&forwardUrl=${encodeURIComponent(returnUrl)}`;

  // Page navigates away — this promise never settles
  return new Promise(() => {});
}

// Called at app startup. If the URL has ?plex_auth=1, we're returning from
// a Plex redirect. Poll the server until the token is committed, save the
// session, and return {cardId} so the app can restore context.
export async function handlePlexAuthReturn() {
  if (new URLSearchParams(location.search).get('plex_auth') !== '1') return null;
  history.replaceState({}, '', location.pathname);

  let pinId = null, cardId = null;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (raw) ({ pinId, cardId } = JSON.parse(raw));
  } catch { /* ignore */ }

  if (!pinId) return null;

  // Plex may redirect before fully committing the token — retry for up to 6s
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
      if (r.ok) {
        const data = await r.json();
        if (!data.pending && !data.error) {
          saveSession(data.session, data.user);
          return { user: data.user, cardId };
        }
        if (data.error) break;
      }
    } catch { /* network hiccup */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return null;
}
