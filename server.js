import express from 'express';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function createApp() {
  const app = express();

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
