import express from 'express';
import { randomUUID } from 'node:crypto';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.static('public', {
    maxAge: '1h',
    etag: true,
    setHeaders: (res, path) => {
      if (path.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  app.get('/api/health', (req, res) => {
    res.json({
      tmdb: Boolean(process.env.TMDB_API_KEY),
      seerr: Boolean(process.env.SEERR_URL && process.env.SEERR_API_KEY),
      seerrType: process.env.SEERR_TYPE || 'overseerr',
    });
  });

  const PLEX_API = 'https://plex.tv/api/v2';
  const plexClientId = process.env.PLEX_CLIENT_ID || (() => {
    const id = randomUUID();
    console.log(JSON.stringify({ level: 'info', msg: `PLEX_CLIENT_ID not set — using ${id}. Add to .env to persist.` }));
    return id;
  })();
  const plexHeaders = {
    'X-Plex-Client-Identifier': plexClientId,
    'X-Plex-Product': 'TrailerSwipe',
    Accept: 'application/json',
  };

  app.post('/api/auth/plex/pin', async (req, res) => {
    try {
      const r = await fetch(`${PLEX_API}/pins?strong=true`, {
        method: 'POST',
        headers: plexHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return res.status(502).json({ error: 'plex_pin_failed' });
      const { id: pinId, code } = await r.json();
      const authUrl =
        `https://app.plex.tv/auth#?clientID=${encodeURIComponent(plexClientId)}` +
        `&code=${encodeURIComponent(code)}` +
        `&context%5Bdevice%5D%5Bproduct%5D=TrailerSwipe`;
      res.json({ pinId, authUrl });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', src: 'plex-pin', msg: err.message }));
      res.status(502).json({ error: 'plex_unreachable' });
    }
  });

  app.get('/api/auth/plex/callback', async (req, res) => {
    const { pinId } = req.query;
    if (!pinId || !/^\d+$/.test(String(pinId))) {
      return res.status(400).json({ error: 'invalid_pin_id' });
    }
    if (!process.env.SEERR_URL || !process.env.SEERR_API_KEY) {
      return res.status(503).json({ error: 'seerr_not_configured' });
    }
    try {
      const pinRes = await fetch(`${PLEX_API}/pins/${pinId}`, {
        headers: plexHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      if (!pinRes.ok) return res.status(502).json({ error: 'plex_pin_check_failed' });
      const pin = await pinRes.json();
      if (!pin.authToken) return res.json({ pending: true });

      const seerrBase = process.env.SEERR_URL.replace(/\/$/, '');

      const authRes = await fetch(`${seerrBase}/api/v1/auth/plex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ authToken: pin.authToken }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!authRes.ok) return res.status(502).json({ error: 'seerr_auth_failed' });

      const setCookie = authRes.headers.get('set-cookie') || '';
      const match = setCookie.match(/connect\.sid=([^;]+)/);
      if (!match) return res.status(502).json({ error: 'seerr_no_session' });
      const session = match[1];

      const meRes = await fetch(`${seerrBase}/api/v1/auth/me`, {
        headers: { Cookie: `connect.sid=${session}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!meRes.ok) return res.status(502).json({ error: 'seerr_me_failed' });
      const me = await meRes.json();

      res.json({
        session,
        user: {
          name: me.displayName || me.username || me.email || 'Utilisateur',
          avatar: me.avatar || null,
        },
      });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', src: 'plex-callback', msg: err.message }));
      res.status(502).json({ error: 'auth_failed' });
    }
  });

  // Only the three endpoints the client actually needs — everything else is blocked.
  const SEERR_ALLOWED = [
    { method: 'POST', pattern: /^api\/v1\/request$/ },
    { method: 'GET',  pattern: /^api\/v1\/movie\/\d+$/ },
    { method: 'GET',  pattern: /^api\/v1\/tv\/\d+$/ },
  ];

  app.use('/api/seerr', express.raw({ type: '*/*', limit: '256kb' }));
  app.all('/api/seerr/*', async (req, res) => {
    if (!process.env.SEERR_URL || !process.env.SEERR_API_KEY) {
      return res.status(503).json({ error: 'seerr_not_configured' });
    }
    const t0 = Date.now();
    let seerrPath = '?';
    try {
      seerrPath = req.url.replace(/^\/api\/seerr\//, '');
      if (seerrPath.includes('..') || seerrPath.startsWith('/') || seerrPath.includes('@')) {
        return res.status(400).json({ error: 'invalid_path' });
      }
      const allowed = SEERR_ALLOWED.some(
        (r) => r.method === req.method && r.pattern.test(seerrPath)
      );
      if (!allowed) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const base = new URL(process.env.SEERR_URL.replace(/\/$/, '') + '/');
      const url = new URL(seerrPath, base);
      if (url.origin !== base.origin) {
        return res.status(400).json({ error: 'invalid_path' });
      }
      const fetchOpts = {
        method: req.method,
        headers: {
          'X-Api-Key': process.env.SEERR_API_KEY,
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Accept-Language': 'fr-FR',
        },
        signal: AbortSignal.timeout(10_000),
      };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOpts.body = req.body;
      }
      const upstream = await fetch(url.toString(), fetchOpts);
      const ms = Date.now() - t0;
      const body = await upstream.text();
      if (!upstream.ok) {
        console.warn(JSON.stringify({ level: 'warn', src: 'seerr', method: req.method, path: seerrPath, status: upstream.status, ms, body: body.slice(0, 200) }));
      }
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('content-type', ct);
      res.send(body);
    } catch (err) {
      const ms = Date.now() - t0;
      console.error(JSON.stringify({ level: 'error', src: 'seerr', method: req.method, path: seerrPath, msg: err.message, ms }));
      res.status(502).json({ error: 'seerr_upstream_failed' });
    }
  });

  app.get('/api/tmdb/*', async (req, res) => {
    if (!process.env.TMDB_API_KEY) {
      return res.status(503).json({ error: 'TMDB_API_KEY not configured' });
    }
    try {
      const tmdbPath = req.url.replace(/^\/api\/tmdb\//, '');
      const url = new URL(`${TMDB_BASE}/${tmdbPath}`);
      url.searchParams.set('api_key', process.env.TMDB_API_KEY);
      const upstream = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30_000),
      });
      const body = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('content-type', ct);
      res.send(body);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', src: 'tmdb', msg: err.message }));
      res.status(502).json({ error: 'tmdb_upstream_failed' });
    }
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', msg: `trailerswipe listening on :${port}` }));
  });
}
