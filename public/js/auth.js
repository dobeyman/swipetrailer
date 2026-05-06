const STORAGE_KEY = 'ts.auth';
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

export async function startPlexLogin() {
  const res = await fetch('/api/auth/plex/pin', { method: 'POST' });
  if (!res.ok) throw new Error('pin_request_failed');
  const { pinId, authUrl } = await res.json();

  const popup = window.open(authUrl, '_blank', 'noopener');

  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const INTERVAL = 2000;
    const MAX = 5 * 60 * 1000;

    const timer = setInterval(async () => {
      elapsed += INTERVAL;
      if (elapsed > MAX) {
        clearInterval(timer);
        if (popup && !popup.closed) popup.close();
        reject(new Error('auth_timeout'));
        return;
      }
      try {
        const r = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.pending) return;
        clearInterval(timer);
        if (data.error) { reject(new Error(data.error)); return; }
        saveSession(data.session, data.user);
        resolve(data.user);
      } catch { /* network hiccup, keep polling */ }
    }, INTERVAL);
  });
}
