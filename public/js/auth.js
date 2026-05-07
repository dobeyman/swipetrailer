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

// Called on startup when the page loaded because of the forwardUrl redirect.
// Notifies the original PWA tab via BroadcastChannel, then closes this tab.
export function handlePlexAuthReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get('plex_auth') !== '1') return;
  history.replaceState({}, '', location.pathname);
  try { new BroadcastChannel('plex-auth').postMessage('return'); } catch { /* unsupported */ }
  // Close this tab — works when it was opened via window.open()
  try { window.close(); } catch { /* browser blocked it, user closes manually */ }
}

export async function startPlexLogin() {
  // Open a blank tab NOW, inside the user-gesture stack, before any await.
  // If we open after await the browser loses gesture context and may
  // navigate the current tab instead of opening a new one.
  const popup = window.open('about:blank', '_blank');

  let pinId, authUrl;
  try {
    const res = await fetch('/api/auth/plex/pin', { method: 'POST' });
    if (!res.ok) throw new Error('pin_request_failed');
    ({ pinId, authUrl } = await res.json());
  } catch (err) {
    if (popup && !popup.closed) popup.close();
    throw err;
  }

  const returnUrl = `${window.location.origin}/?plex_auth=1`;
  const authUrlWithReturn = `${authUrl}&forwardUrl=${encodeURIComponent(returnUrl)}`;
  if (popup) {
    popup.location.href = authUrlWithReturn;
  } else {
    // Popup blocked — navigate current tab (last resort)
    window.location.href = authUrlWithReturn;
  }

  return new Promise((resolve, reject) => {
    let elapsed = 0;
    let settled = false;
    const INTERVAL = 2000;
    const MAX = 5 * 60 * 1000;

    let bc = null;
    try {
      bc = new BroadcastChannel('plex-auth');
      bc.onmessage = () => {
        // Plex may not have committed the token yet when the redirect fires.
        // Poll at 500ms for up to 10s before falling back to the 2s interval.
        let n = 0;
        const fast = setInterval(async () => {
          n++;
          await checkPin();
          if (n >= 20 || settled) clearInterval(fast);
        }, 500);
      };
    } catch { /* unsupported — fallback to polling */ }

    async function checkPin() {
      if (settled) return;
      try {
        const r = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.pending) return;
        settled = true;
        clearInterval(timer);
        cleanup();
        if (popup && !popup.closed) popup.close();
        if (data.error) { reject(new Error(data.error)); return; }
        saveSession(data.session, data.user);
        resolve(data.user);
      } catch { /* network hiccup */ }
    }

    function onVisibility() {
      if (!document.hidden) checkPin();
    }

    function cleanup() {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', checkPin);
      if (bc) { bc.close(); bc = null; }
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', checkPin);

    const timer = setInterval(async () => {
      elapsed += INTERVAL;
      if (elapsed > MAX) {
        settled = true;
        clearInterval(timer);
        cleanup();
        if (popup && !popup.closed) popup.close();
        reject(new Error('auth_timeout'));
        return;
      }
      await checkPin();
    }, INTERVAL);
  });
}
