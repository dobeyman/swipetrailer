import express from 'express';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function createApp() {
  const app = express();

  app.get('/api/health', (req, res) => {
    res.json({
      tmdb: Boolean(process.env.TMDB_API_KEY),
      seerr: Boolean(process.env.SEERR_URL && process.env.SEERR_API_KEY),
      seerrType: process.env.SEERR_TYPE || 'overseerr',
    });
  });

  app.use('/api/seerr', express.raw({ type: '*/*', limit: '256kb' }));
  app.all('/api/seerr/*', async (req, res) => {
    if (!process.env.SEERR_URL || !process.env.SEERR_API_KEY) {
      return res.status(503).json({ error: 'seerr_not_configured' });
    }
    try {
      const seerrPath = req.url.replace(/^\/api\/seerr\//, '');
      const url = `${process.env.SEERR_URL.replace(/\/$/, '')}/${seerrPath}`;
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
      const upstream = await fetch(url, fetchOpts);
      const body = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('content-type', ct);
      res.send(body);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', src: 'seerr', msg: err.message }));
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
