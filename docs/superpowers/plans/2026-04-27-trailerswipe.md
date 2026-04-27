# TrailerSwipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TrailerSwipe — a TikTok-style PWA for movie/TV trailers with Overseerr/Jellyseerr integration, fully self-hostable via Docker.

**Architecture:** Single Node Express server serves static frontend AND proxies TMDB + Seerr API calls (admin-configured via env vars). Frontend is vanilla JS (ES modules) + vanilla CSS, zero build step. Card-based virtualized feed with YouTube iframe API and `scroll-snap-type: y mandatory`.

**Tech Stack:**
- Backend: Node 20+, Express, no build step
- Frontend: Vanilla ES modules, vanilla CSS, YouTube iframe API
- Tests: `node --test` (built-in), `jsdom` (dev dep, for DOM-touching tests)
- Deployment: Docker + docker-compose
- No bundler, no transpiler, no runtime dep beyond Express

**Reference:** [`docs/superpowers/specs/2026-04-27-trailerswipe-design.md`](../specs/2026-04-27-trailerswipe-design.md)

---

## Final file structure

```
trailerswipe/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
├── .dockerignore
├── README.md
├── LICENSE
├── package.json
├── package-lock.json
├── server.js
├── server.test.js
│
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── icons/
│   │   ├── icon-192.svg
│   │   └── icon-512.svg
│   ├── css/
│   │   ├── tokens.css
│   │   ├── reset.css
│   │   ├── layout.css
│   │   ├── cards.css
│   │   ├── settings.css
│   │   └── animations.css
│   └── js/
│       ├── app.js
│       ├── feed.js
│       ├── card.js
│       ├── youtube.js
│       ├── settings.js
│       ├── toast.js
│       ├── i18n.js
│       ├── store.js
│       ├── locales/
│       │   └── fr.json
│       └── api/
│           ├── tmdb.js
│           └── seerr.js
│
└── tests/
    ├── store.test.js
    ├── i18n.test.js
    ├── api-tmdb.test.js
    ├── api-seerr.test.js
    └── card.test.js
```

---

## Phase A — Backend proxy server

Phase A produces a working API + static-file server that you can `curl` end-to-end. Each task ends with a commit.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `.env.example`

- [ ] **Step 1.1: Create `package.json`**

```json
{
  "name": "trailerswipe",
  "version": "0.1.0",
  "description": "TikTok-style PWA for movie and TV trailers with Overseerr/Jellyseerr integration",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --env-file=.env --watch server.js",
    "test": "node --test --test-reporter=spec tests/ server.test.js"
  },
  "engines": {
    "node": ">=20.6.0"
  },
  "dependencies": {
    "express": "^4.21.2"
  },
  "devDependencies": {
    "jsdom": "^24.1.3"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/jenre/trailerswipe"
  }
}
```

- [ ] **Step 1.2: Create `.gitignore`**

```gitignore
node_modules/
.env
.DS_Store
*.log
coverage/
```

- [ ] **Step 1.3: Create `.dockerignore`**

```gitignore
node_modules
.git
.env
docs
*.md
.gitignore
.dockerignore
tests
*.test.js
```

- [ ] **Step 1.4: Create `.env.example`**

```env
# TMDB API key — get one at https://www.themoviedb.org/settings/api
TMDB_API_KEY=

# Seerr (Overseerr or Jellyseerr) integration — leave empty for trailer-only mode
SEERR_TYPE=overseerr
SEERR_URL=
SEERR_API_KEY=

# Server config
PORT=3000
```

- [ ] **Step 1.5: Run `npm install`**

```bash
npm install
```

Expected: Creates `node_modules/` and `package-lock.json`. No errors.

- [ ] **Step 1.6: Commit**

```bash
git add package.json package-lock.json .gitignore .dockerignore .env.example
git commit -m "chore: project scaffold (package.json, gitignore, env example)"
```

---

### Task 2: TMDB proxy endpoint

**Files:**
- Create: `server.js`
- Create: `server.test.js`

- [ ] **Step 2.1: Write the failing test for TMDB forwarding**

Create `server.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from './server.js';

let app;
let server;
let baseUrl;
let originalFetch;

before(async () => {
  process.env.TMDB_API_KEY = 'fake-tmdb-key';
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  originalFetch = global.fetch;
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/tmdb/* forwards to api.themoviedb.org with api_key injected', async () => {
  let capturedUrl;
  global.fetch = async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await fetch(`${baseUrl}/api/tmdb/trending/all/week?language=fr-FR`);
  assert.strictEqual(res.status, 200);
  assert.match(capturedUrl, /^https:\/\/api\.themoviedb\.org\/3\/trending\/all\/week/);
  assert.match(capturedUrl, /api_key=fake-tmdb-key/);
  assert.match(capturedUrl, /language=fr-FR/);
});

test('GET /api/tmdb/* returns 503 when TMDB_API_KEY is missing', async () => {
  const oldKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = '';
  // Recreate app to pick up new env
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl}/api/tmdb/trending/all/week`);
  assert.strictEqual(res.status, 503);
  process.env.TMDB_API_KEY = oldKey;
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL with "Cannot find module './server.js'" or similar.

- [ ] **Step 2.3: Create minimal `server.js`**

```javascript
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
```

> **Note:** The bottom `if` block ensures `server.js` only runs the listener when invoked directly (e.g. `node server.js`), not when imported by tests. The `Response` constructor is global since Node 18.

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npm test
```

Expected: 2 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(server): TMDB proxy endpoint with api_key injection"
```

---

### Task 3: Seerr proxy endpoint

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

- [ ] **Step 3.1: Write failing test for Seerr forwarding**

Append to `server.test.js`:

```javascript
test('POST /api/seerr/api/v1/request forwards to SEERR_URL with X-Api-Key', async () => {
  process.env.SEERR_URL = 'http://overseerr.test';
  process.env.SEERR_API_KEY = 'fake-seerr-key';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  let capturedUrl, capturedHeaders, capturedBody, capturedMethod;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = opts.body;
    capturedMethod = opts.method;
    return new Response(JSON.stringify({ id: 42 }), { status: 201 });
  };

  const res = await fetch(`${baseUrl}/api/seerr/api/v1/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', mediaId: 100 }),
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(capturedMethod, 'POST');
  assert.strictEqual(capturedUrl, 'http://overseerr.test/api/v1/request');
  assert.strictEqual(capturedHeaders['x-api-key'], 'fake-seerr-key');
  assert.match(capturedBody, /"mediaType":"movie"/);
});

test('GET /api/seerr/* returns 503 when SEERR_URL or SEERR_API_KEY is missing', async () => {
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl}/api/seerr/api/v1/movie/123`);
  assert.strictEqual(res.status, 503);
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test
```

Expected: 2 new tests fail (404 response, route doesn't exist).

- [ ] **Step 3.3: Add Seerr proxy to `server.js`**

Insert before `return app;`:

```javascript
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
```

> **Note:** `express.raw` is used so we can pass the body byte-for-byte to upstream Seerr (avoids JSON re-stringification quirks).

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npm test
```

Expected: All 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(server): Seerr proxy endpoint with X-Api-Key injection"
```

---

### Task 4: Health endpoint

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

- [ ] **Step 4.1: Write failing test**

Append to `server.test.js`:

```javascript
test('GET /api/health reflects env var presence', async () => {
  process.env.TMDB_API_KEY = 'present';
  process.env.SEERR_URL = 'http://x';
  process.env.SEERR_API_KEY = 'y';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl}/api/health`);
  const json = await res.json();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(json, { tmdb: true, seerr: true, seerrType: 'overseerr' });
});

test('GET /api/health when TMDB missing', async () => {
  process.env.TMDB_API_KEY = '';
  process.env.SEERR_URL = '';
  process.env.SEERR_API_KEY = '';
  await new Promise((resolve) => server.close(resolve));
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  const res = await fetch(`${baseUrl}/api/health`);
  const json = await res.json();
  assert.deepStrictEqual(json, { tmdb: false, seerr: false, seerrType: 'overseerr' });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npm test
```

Expected: 2 new tests fail (404).

- [ ] **Step 4.3: Add `/api/health` to `server.js`**

Insert before the TMDB route:

```javascript
  app.get('/api/health', (req, res) => {
    res.json({
      tmdb: Boolean(process.env.TMDB_API_KEY),
      seerr: Boolean(process.env.SEERR_URL && process.env.SEERR_API_KEY),
      seerrType: process.env.SEERR_TYPE || 'overseerr',
    });
  });
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
npm test
```

Expected: All 6 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(server): /api/health endpoint reports config state"
```

---

### Task 5: Static file serving

**Files:**
- Modify: `server.js`
- Create: `public/index.html` (placeholder, will be expanded later)

- [ ] **Step 5.1: Create placeholder `public/index.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>TrailerSwipe</title>
</head>
<body>
<p>TrailerSwipe — bootstrap pending</p>
</body>
</html>
```

- [ ] **Step 5.2: Add static middleware to `server.js`**

Insert at the start of `createApp` (before any route):

```javascript
  app.use(express.static('public', {
    maxAge: '1h',
    etag: true,
    setHeaders: (res, path) => {
      if (path.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
```

> **Note:** `sw.js` must not be cached aggressively, otherwise users won't pick up Service Worker updates.

- [ ] **Step 5.3: Manual test — start the server**

```bash
TMDB_API_KEY=fake npm start &
sleep 1
curl -s http://localhost:3000/ | head -c 100
curl -s http://localhost:3000/api/health
kill %1
```

Expected:
- First curl returns the placeholder HTML
- Second curl returns `{"tmdb":true,"seerr":false,"seerrType":"overseerr"}`

- [ ] **Step 5.4: Commit**

```bash
git add server.js public/index.html
git commit -m "feat(server): serve static files from public/"
```

---

### Task 6: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 6.1: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

- [ ] **Step 6.2: Create `docker-compose.yml`**

```yaml
services:
  trailerswipe:
    build: .
    image: trailerswipe:latest
    container_name: trailerswipe
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 6.3: Manual test — build and run**

```bash
docker compose build
echo -e "TMDB_API_KEY=fake\nSEERR_TYPE=overseerr\nSEERR_URL=\nSEERR_API_KEY=\nPORT=3000" > .env
docker compose up -d
sleep 3
curl -s http://localhost:3000/api/health
docker compose down
```

Expected: health endpoint responds with `{"tmdb":true,"seerr":false,"seerrType":"overseerr"}`.

- [ ] **Step 6.4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat(docker): Dockerfile + docker-compose"
```

---

## Phase B — Frontend foundations

Phase B builds the static shell, design tokens, and pure-JS modules that don't require browser APIs.

---

### Task 7: HTML shell

**Files:**
- Modify: `public/index.html`

- [ ] **Step 7.1: Replace `public/index.html` with full shell**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
<meta name="theme-color" content="#0a0a0a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="TrailerSwipe" />
<meta name="description" content="Découvre les bandes-annonces de films et séries en swipe vertical" />
<title>TrailerSwipe</title>
<link rel="manifest" href="/manifest.json" />
<link rel="icon" type="image/svg+xml" href="/icons/icon-192.svg" />
<link rel="apple-touch-icon" href="/icons/icon-192.svg" />
<link rel="preconnect" href="https://api.fontshare.com" />
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/css/tokens.css" />
<link rel="stylesheet" href="/css/reset.css" />
<link rel="stylesheet" href="/css/animations.css" />
<link rel="stylesheet" href="/css/layout.css" />
<link rel="stylesheet" href="/css/cards.css" />
<link rel="stylesheet" href="/css/settings.css" />
</head>
<body>
<main id="app" aria-live="polite">
  <div id="boot-skeleton" class="boot-skeleton">
    <div class="shimmer"></div>
  </div>
</main>
<div id="toast-container" aria-live="polite" aria-atomic="true"></div>
<script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 7.2: Commit**

```bash
git add public/index.html
git commit -m "feat(frontend): full HTML shell with PWA meta tags"
```

---

### Task 8: Design tokens & reset CSS

**Files:**
- Create: `public/css/tokens.css`
- Create: `public/css/reset.css`

- [ ] **Step 8.1: Create `public/css/tokens.css`**

```css
:root {
  /* Couleurs */
  --bg: #0a0a0a;
  --bg-elevated: #141414;
  --bg-subtle: rgba(255, 255, 255, 0.04);
  --text: #f5f5f5;
  --text-secondary: rgba(245, 245, 245, 0.7);
  --text-muted: rgba(245, 245, 245, 0.45);
  --border: rgba(255, 255, 255, 0.08);
  --accent: #e50914;
  --accent-hover: #f6121d;
  --success: #46d369;
  --warning: #f5a623;
  --danger: #e50914;
  --info: #4a9eff;

  /* Gradient overlay (top→bottom) */
  --overlay-gradient: linear-gradient(
    to bottom,
    transparent 0%,
    transparent 40%,
    rgba(0, 0, 0, 0.6) 75%,
    rgba(0, 0, 0, 0.95) 100%
  );

  /* Typo */
  --font-sans: 'Satoshi', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Espacements */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;
  --space-2xl: 64px;

  /* Rayons */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-pill: 999px;

  /* Élévations */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.7);

  /* Transitions */
  --t-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
  --t-medium: 240ms cubic-bezier(0.4, 0, 0.2, 1);
  --t-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);

  /* Layout */
  --action-bar-height: 88px;
  --safe-bottom: env(safe-area-inset-bottom, 0);
  --safe-top: env(safe-area-inset-top, 0);
}
```

- [ ] **Step 8.2: Create `public/css/reset.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  overflow: hidden;
}

body {
  overscroll-behavior: none;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin: 0;
  -webkit-tap-highlight-color: transparent;
}

input, select, textarea {
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
}

a {
  color: inherit;
  text-decoration: none;
}

img, video, iframe, svg {
  display: block;
  max-width: 100%;
}

[hidden] {
  display: none !important;
}
```

- [ ] **Step 8.3: Commit**

```bash
git add public/css/tokens.css public/css/reset.css
git commit -m "feat(frontend): design tokens + base reset"
```

---

### Task 9: Animations & layout CSS

**Files:**
- Create: `public/css/animations.css`
- Create: `public/css/layout.css`

- [ ] **Step 9.1: Create `public/css/animations.css`**

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes fade-in {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}

@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes slide-out-right {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}

@keyframes slide-in-bottom {
  from { transform: translateY(120%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slide-out-bottom {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(120%); opacity: 0; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.shimmer {
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 0%,
    rgba(255, 255, 255, 0.06) 50%,
    var(--bg-elevated) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s linear infinite;
  width: 100%;
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 9.2: Create `public/css/layout.css`**

```css
#app {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg);
}

.boot-skeleton {
  width: 100%;
  height: 100%;
  background: var(--bg);
}

#toast-container {
  position: fixed;
  bottom: calc(var(--space-md) + var(--safe-bottom));
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  pointer-events: none;
  width: min(420px, calc(100vw - var(--space-lg)));
}

.toast {
  pointer-events: auto;
  background: var(--bg-elevated);
  color: var(--text);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-weight: 500;
  animation: slide-in-bottom var(--t-medium) ease-out;
  border-left: 3px solid var(--info);
}

.toast.toast--success { border-left-color: var(--success); }
.toast.toast--error { border-left-color: var(--danger); }
.toast.toast--warning { border-left-color: var(--warning); }
.toast.is-leaving {
  animation: slide-out-bottom var(--t-medium) ease-in forwards;
}

.error-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-xl);
  gap: var(--space-md);
  background: var(--bg);
  z-index: 100;
}

.error-screen__title {
  font-size: 1.4rem;
  font-weight: 700;
}

.error-screen__detail {
  color: var(--text-secondary);
  max-width: 480px;
}

.error-screen__action {
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background: var(--accent);
  border-radius: var(--radius-pill);
  font-weight: 600;
}
```

- [ ] **Step 9.3: Commit**

```bash
git add public/css/animations.css public/css/layout.css
git commit -m "feat(frontend): animations + layout CSS"
```

---

### Task 10: PWA manifest + icons

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.svg`
- Create: `public/icons/icon-512.svg`

- [ ] **Step 10.1: Create `public/manifest.json`**

```json
{
  "name": "TrailerSwipe",
  "short_name": "TrailerSwipe",
  "description": "Découvre les bandes-annonces de films et séries en swipe vertical",
  "start_url": "/",
  "display": "fullscreen",
  "orientation": "portrait",
  "theme_color": "#0a0a0a",
  "background_color": "#0a0a0a",
  "lang": "fr",
  "icons": [
    {
      "src": "/icons/icon-192.svg",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.svg",
      "sizes": "512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 10.2: Create `public/icons/icon-192.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="42" fill="#0a0a0a"/>
  <g transform="translate(96 96)">
    <circle r="56" fill="#e50914"/>
    <path d="M -18 -28 L 28 0 L -18 28 Z" fill="#ffffff"/>
  </g>
</svg>
```

- [ ] **Step 10.3: Create `public/icons/icon-512.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#0a0a0a"/>
  <g transform="translate(256 256)">
    <circle r="148" fill="#e50914"/>
    <path d="M -48 -76 L 76 0 L -48 76 Z" fill="#ffffff"/>
  </g>
</svg>
```

- [ ] **Step 10.4: Commit**

```bash
git add public/manifest.json public/icons/
git commit -m "feat(pwa): manifest + SVG icons"
```

---

### Task 11: i18n module

**Files:**
- Create: `public/js/i18n.js`
- Create: `public/js/locales/fr.json`
- Create: `tests/i18n.test.js`

- [ ] **Step 11.1: Write failing test**

Create `tests/i18n.test.js`:

```javascript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createI18n } from '../public/js/i18n.js';

const fakeFetch = (locale) => async () => ({
  ok: true,
  json: async () => ({
    'feed.empty': 'Aucune bande-annonce',
    'toast.requested': 'Demandé : {title}',
    'nested.key.deep': 'profond',
  }),
});

test('returns the key when locale not loaded', () => {
  const i18n = createI18n();
  assert.strictEqual(i18n.t('feed.empty'), 'feed.empty');
});

test('returns the translation when loaded', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('feed.empty'), 'Aucune bande-annonce');
});

test('interpolates parameters', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('toast.requested', { title: 'Dune' }), 'Demandé : Dune');
});

test('returns the key when translation is missing', async () => {
  const i18n = createI18n({ fetch: fakeFetch() });
  await i18n.loadLocale('fr');
  assert.strictEqual(i18n.t('does.not.exist'), 'does.not.exist');
});
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
npm test
```

Expected: 4 tests fail (cannot find module).

- [ ] **Step 11.3: Create `public/js/i18n.js`**

```javascript
export function createI18n({ fetch: fetchImpl = globalThis.fetch } = {}) {
  let strings = {};

  async function loadLocale(locale) {
    const res = await fetchImpl(`/js/locales/${locale}.json`);
    if (!res.ok) {
      console.error(`i18n: failed to load locale ${locale}`);
      return;
    }
    strings = await res.json();
  }

  function t(key, params) {
    const raw = strings[key];
    if (raw === undefined) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    );
  }

  return { loadLocale, t };
}
```

- [ ] **Step 11.4: Create `public/js/locales/fr.json`**

```json
{
  "feed.empty": "Aucune bande-annonce disponible 🎬",
  "feed.error": "Connexion perdue, réessaie",
  "feed.retry": "Réessayer",
  "feed.loading_more_failed": "Impossible de charger plus de trailers",
  "feed.read_only_banner": "Mode lecture seule (Seerr non configuré)",
  "feed.offline_banner": "Hors ligne",

  "boot.error.tmdb_missing.title": "Configuration manquante",
  "boot.error.tmdb_missing.detail": "L'administrateur doit définir TMDB_API_KEY dans .env",
  "boot.error.tmdb_missing.retry": "Réessayer",

  "card.want": "Je veux",
  "card.requested": "Demandé !",
  "card.already_requested": "Déjà demandé",
  "card.available": "Disponible",
  "card.processing": "En cours",
  "card.partial": "Partiel",
  "card.watchlist_add": "Ajouter à la watchlist",
  "card.watchlist_remove": "Retirer de la watchlist",
  "card.show_dates": "Dates de sortie",
  "card.show_synopsis": "Synopsis",
  "card.tap_to_play": "Tap pour démarrer",
  "card.unavailable": "Trailer indisponible",
  "card.skip_next": "Card suivante",
  "card.media_type.movie": "🎬 Film",
  "card.media_type.tv": "📺 Série",

  "dates.theatrical": "Cinéma",
  "dates.digital": "Numérique",
  "dates.physical": "Physique",
  "dates.first_air": "Première diffusion",
  "dates.last_air": "Dernier épisode",
  "dates.next_episode": "Prochain épisode",
  "dates.empty": "Aucune date disponible",
  "dates.close": "Fermer",

  "toast.requested": "{title} demandé !",
  "toast.already_requested": "{title} déjà demandé",
  "toast.seerr_unreachable": "Impossible de contacter Seerr",
  "toast.seerr_auth_error": "Erreur d'authentification (contacter l'admin)",
  "toast.available_already": "Déjà dans ta médiathèque",

  "settings.title": "Paramètres",
  "settings.filter": "Type de contenu",
  "settings.filter.all": "Tous",
  "settings.filter.movie": "Films",
  "settings.filter.tv": "Séries",
  "settings.language": "Langue",
  "settings.watchlist": "Ma watchlist",
  "settings.watchlist_view": "Voir ma watchlist",
  "settings.watchlist_clear": "Vider la watchlist",
  "settings.watchlist_clear_confirm": "Vider toute la watchlist ?",
  "settings.watchlist_empty": "Watchlist vide",
  "settings.install": "Installer l'app",
  "settings.install_ios_help": "Tap [icône Share], puis 'Sur l'écran d'accueil'",
  "settings.install_unsupported": "Ton navigateur ne supporte pas l'installation",
  "settings.close": "Fermer",

  "shortcut.help": "Raccourcis : Espace=play/pause, ↑↓=navigate, M=mute, R=demander, S=settings"
}
```

- [ ] **Step 11.5: Run test to verify it passes**

```bash
npm test
```

Expected: All 4 i18n tests pass.

- [ ] **Step 11.6: Commit**

```bash
git add public/js/i18n.js public/js/locales/fr.json tests/i18n.test.js
git commit -m "feat(i18n): create i18n module + French locale"
```

---

### Task 12: store module

**Files:**
- Create: `public/js/store.js`
- Create: `tests/store.test.js`

- [ ] **Step 12.1: Write failing test**

Create `tests/store.test.js`:

```javascript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createStore, reducer, initialState } from '../public/js/store.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}

test('initial state has empty feed and sets', () => {
  assert.strictEqual(initialState.feed.length, 0);
  assert.strictEqual(initialState.requestedIds.size, 0);
  assert.strictEqual(initialState.watchlistIds.size, 0);
  assert.strictEqual(initialState.currentIndex, 0);
});

test('SET_FEED replaces feed', () => {
  const next = reducer(initialState, { type: 'SET_FEED', items: [{ id: 1 }, { id: 2 }] });
  assert.strictEqual(next.feed.length, 2);
  assert.strictEqual(next.feed[0].id, 1);
});

test('APPEND_FEED appends', () => {
  const s1 = reducer(initialState, { type: 'SET_FEED', items: [{ id: 1 }] });
  const s2 = reducer(s1, { type: 'APPEND_FEED', items: [{ id: 2 }, { id: 3 }] });
  assert.strictEqual(s2.feed.length, 3);
  assert.strictEqual(s2.feed[2].id, 3);
});

test('ADD_REQUESTED adds to set', () => {
  const next = reducer(initialState, { type: 'ADD_REQUESTED', id: 'movie-42' });
  assert.ok(next.requestedIds.has('movie-42'));
});

test('TOGGLE_WATCHLIST adds then removes', () => {
  const s1 = reducer(initialState, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  assert.strictEqual(s1.watchlistIds.size, 1);
  assert.ok(s1.watchlist[0].id === 'movie-7');
  const s2 = reducer(s1, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  assert.strictEqual(s2.watchlistIds.size, 0);
  assert.strictEqual(s2.watchlist.length, 0);
});

test('SET_INDEX updates currentIndex', () => {
  const next = reducer(initialState, { type: 'SET_INDEX', index: 5 });
  assert.strictEqual(next.currentIndex, 5);
});

test('SET_FILTER updates preferences', () => {
  const next = reducer(initialState, { type: 'SET_FILTER', value: 'movie' });
  assert.strictEqual(next.preferences.filter, 'movie');
});

test('CLEAR_WATCHLIST empties watchlist', () => {
  const s1 = reducer(initialState, { type: 'TOGGLE_WATCHLIST', item: { id: 'movie-7', mediaType: 'movie' } });
  const s2 = reducer(s1, { type: 'CLEAR_WATCHLIST' });
  assert.strictEqual(s2.watchlistIds.size, 0);
  assert.strictEqual(s2.watchlist.length, 0);
});

test('createStore subscribes and dispatches', () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage });
  let calls = 0;
  store.subscribe(() => { calls++; });
  store.dispatch({ type: 'SET_INDEX', index: 3 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(store.getState().currentIndex, 3);
});

test('createStore persists requestedIds and watchlist to storage', () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage });
  store.dispatch({ type: 'ADD_REQUESTED', id: 'movie-1' });
  store.dispatch({ type: 'TOGGLE_WATCHLIST', item: { id: 'movie-2', mediaType: 'movie' } });
  assert.deepStrictEqual(JSON.parse(storage.getItem('ts.requestedIds')), ['movie-1']);
  const wl = JSON.parse(storage.getItem('ts.watchlist'));
  assert.strictEqual(wl.length, 1);
  assert.strictEqual(wl[0].id, 'movie-2');
});

test('createStore hydrates from storage', () => {
  const storage = new MemoryStorage();
  storage.setItem('ts.requestedIds', JSON.stringify(['movie-99']));
  storage.setItem('ts.watchlist', JSON.stringify([{ id: 'tv-7', mediaType: 'tv' }]));
  storage.setItem('ts.preferences', JSON.stringify({ filter: 'tv', locale: 'fr' }));
  const store = createStore({ storage });
  store.hydrate();
  const s = store.getState();
  assert.ok(s.requestedIds.has('movie-99'));
  assert.strictEqual(s.watchlist.length, 1);
  assert.strictEqual(s.preferences.filter, 'tv');
});
```

- [ ] **Step 12.2: Run test to verify it fails**

```bash
npm test
```

Expected: tests fail (cannot find module).

- [ ] **Step 12.3: Create `public/js/store.js`**

```javascript
export const initialState = Object.freeze({
  feed: [],
  requestedIds: new Set(),
  watchlistIds: new Set(),
  watchlist: [], // [{ id, mediaType, title, posterPath }]
  currentIndex: 0,
  preferences: { filter: 'all', locale: 'fr' },
  health: null, // { tmdb, seerr, seerrType }
  isMutedGlobally: true,
});

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_FEED':
      return { ...state, feed: [...action.items] };
    case 'APPEND_FEED':
      return { ...state, feed: [...state.feed, ...action.items] };
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
```

- [ ] **Step 12.4: Run test to verify it passes**

```bash
npm test
```

Expected: All store tests pass.

- [ ] **Step 12.5: Commit**

```bash
git add public/js/store.js tests/store.test.js
git commit -m "feat(store): mini-Redux store with localStorage persistence"
```

---

### Task 13: toast module

**Files:**
- Create: `public/js/toast.js`

> **Note:** This module touches the DOM, so we test it manually after Task 20 wiring. Pure-DOM modules with no logic don't earn unit tests in this v1.

- [ ] **Step 13.1: Create `public/js/toast.js`**

```javascript
const CONTAINER_ID = 'toast-container';

export function toast(message, { variant = 'info', duration = 3000 } = {}) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.warn('toast: container not found, message:', message);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast toast--${variant}`;
  el.textContent = message;
  el.setAttribute('role', 'status');
  container.appendChild(el);

  const dismiss = () => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  const timer = setTimeout(dismiss, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
```

- [ ] **Step 13.2: Commit**

```bash
git add public/js/toast.js
git commit -m "feat(toast): notification helper"
```

---

## Phase C — API clients

---

### Task 14: TMDB client

**Files:**
- Create: `public/js/api/tmdb.js`
- Create: `tests/api-tmdb.test.js`

- [ ] **Step 14.1: Write failing test**

Create `tests/api-tmdb.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { createTmdbClient } from '../public/js/api/tmdb.js';

function makeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const matched = responses.find((r) => url.includes(r.match));
    if (!matched) throw new Error(`No mock for ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => matched.body,
    };
  };
  fn.calls = calls;
  return fn;
}

test('loadGenres calls both movie and tv genre lists once', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/tmdb/genre/movie/list', body: { genres: [{ id: 28, name: 'Action' }] } },
    { match: '/api/tmdb/genre/tv/list', body: { genres: [{ id: 18, name: 'Drame' }] } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const map = await client.loadGenres();
  assert.strictEqual(map.get('movie:28'), 'Action');
  assert.strictEqual(map.get('tv:18'), 'Drame');
  assert.strictEqual(fetchImpl.calls.length, 2);

  // Second call uses cache
  await client.loadGenres();
  assert.strictEqual(fetchImpl.calls.length, 2);
});

test('fetchTrending picks endpoint based on filter', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/tmdb/trending/all/week', body: { results: [], total_pages: 1 } },
    { match: '/api/tmdb/trending/movie/week', body: { results: [], total_pages: 1 } },
    { match: '/api/tmdb/trending/tv/week', body: { results: [], total_pages: 1 } },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  await client.fetchTrending(1, 'all');
  await client.fetchTrending(1, 'movie');
  await client.fetchTrending(1, 'tv');
  assert.match(fetchImpl.calls[0], /\/trending\/all\/week/);
  assert.match(fetchImpl.calls[1], /\/trending\/movie\/week/);
  assert.match(fetchImpl.calls[2], /\/trending\/tv\/week/);
});

test('fetchTrending normalizes items', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/trending/all/week',
      body: {
        results: [
          {
            id: 100,
            media_type: 'movie',
            title: 'Dune',
            overview: 'Synopsis',
            release_date: '2021-09-15',
            genre_ids: [28],
            vote_average: 8.0,
            poster_path: '/p.jpg',
            backdrop_path: '/b.jpg',
          },
          {
            id: 200,
            media_type: 'tv',
            name: 'Foundation',
            overview: 'Synopsis tv',
            first_air_date: '2021-09-24',
            genre_ids: [18],
            vote_average: 7.5,
            poster_path: '/p2.jpg',
            backdrop_path: '/b2.jpg',
          },
        ],
        total_pages: 5,
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const { items, totalPages } = await client.fetchTrending(1, 'all');
  assert.strictEqual(totalPages, 5);
  assert.strictEqual(items[0].id, 'movie-100');
  assert.strictEqual(items[0].mediaType, 'movie');
  assert.strictEqual(items[0].title, 'Dune');
  assert.strictEqual(items[0].year, 2021);
  assert.strictEqual(items[1].id, 'tv-200');
  assert.strictEqual(items[1].title, 'Foundation');
});

test('fetchTrailerKey returns first FR trailer', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/movie/100/videos',
      body: {
        results: [
          { iso_639_1: 'en', type: 'Trailer', site: 'YouTube', key: 'EN1', official: true },
          { iso_639_1: 'fr', type: 'Trailer', site: 'YouTube', key: 'FR1', official: true },
          { iso_639_1: 'fr', type: 'Teaser', site: 'YouTube', key: 'FR2', official: false },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('movie', 100);
  assert.strictEqual(key, 'FR1');
});

test('fetchTrailerKey falls back to EN if no FR', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/tv/200/videos',
      body: {
        results: [
          { iso_639_1: 'es', type: 'Trailer', site: 'YouTube', key: 'ES1' },
          { iso_639_1: 'en', type: 'Trailer', site: 'YouTube', key: 'EN1', official: true },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('tv', 200);
  assert.strictEqual(key, 'EN1');
});

test('fetchTrailerKey returns null when no YouTube trailer', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/tmdb/movie/300/videos',
      body: {
        results: [
          { iso_639_1: 'fr', type: 'Trailer', site: 'Vimeo', key: 'XX' },
        ],
      },
    },
  ]);
  const client = createTmdbClient({ fetch: fetchImpl });
  const key = await client.fetchTrailerKey('movie', 300);
  assert.strictEqual(key, null);
});
```

- [ ] **Step 14.2: Run test to verify it fails**

```bash
npm test
```

Expected: 6 new tests fail.

- [ ] **Step 14.3: Create `public/js/api/tmdb.js`**

```javascript
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

  return { loadGenres, fetchTrending, fetchTrailerKey };
}
```

- [ ] **Step 14.4: Run test to verify it passes**

```bash
npm test
```

Expected: All TMDB tests pass.

- [ ] **Step 14.5: Commit**

```bash
git add public/js/api/tmdb.js tests/api-tmdb.test.js
git commit -m "feat(api): TMDB client with genre map, trending, trailer key resolution"
```

---

### Task 15: Seerr client

**Files:**
- Create: `public/js/api/seerr.js`
- Create: `tests/api-seerr.test.js`

- [ ] **Step 15.1: Write failing test**

Create `tests/api-seerr.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSeerrClient,
  AlreadyRequestedError,
  UnauthorizedError,
  UnreachableError,
  NotConfiguredError,
} from '../public/js/api/seerr.js';

function makeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const matched = responses.find((r) => url.includes(r.match));
    if (!matched) throw new Error(`No mock for ${url}`);
    if (matched.throw) throw matched.throw;
    return {
      ok: matched.status >= 200 && matched.status < 300,
      status: matched.status,
      json: async () => matched.body,
      text: async () => JSON.stringify(matched.body),
    };
  };
  fn.calls = calls;
  return fn;
}

test('requestMedia POSTs the right body and returns parsed JSON on 201', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 201, body: { id: 7 } },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.requestMedia({ mediaType: 'movie', mediaId: 100 });
  assert.deepStrictEqual(out, { id: 7 });
  assert.strictEqual(fetchImpl.calls[0].opts.method, 'POST');
  assert.match(fetchImpl.calls[0].opts.body, /"mediaType":"movie"/);
  assert.match(fetchImpl.calls[0].opts.body, /"mediaId":100/);
});

test('requestMedia throws AlreadyRequestedError on 409', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 409, body: { message: 'exists' } },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    AlreadyRequestedError
  );
});

test('requestMedia throws UnauthorizedError on 401/403', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 401, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    UnauthorizedError
  );
});

test('requestMedia throws UnreachableError on 5xx', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/request', status: 503, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    UnreachableError
  );
});

test('requestMedia throws NotConfiguredError when disabled', async () => {
  const fetchImpl = makeFetch([]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: false });
  await assert.rejects(
    () => client.requestMedia({ mediaType: 'movie', mediaId: 100 }),
    NotConfiguredError
  );
});

test('fetchMediaDetails returns null on 404 or error', async () => {
  const fetchImpl = makeFetch([
    { match: '/api/seerr/api/v1/movie/999', status: 404, body: {} },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.fetchMediaDetails('movie', 999);
  assert.strictEqual(out, null);
});

test('fetchMediaDetails returns parsed JSON on 200', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/api/seerr/api/v1/movie/100',
      status: 200,
      body: {
        id: 100,
        mediaInfo: { status: 5 },
        releaseDates: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: '2026-03-15' }] }] },
      },
    },
  ]);
  const client = createSeerrClient({ fetch: fetchImpl, enabled: true });
  const out = await client.fetchMediaDetails('movie', 100);
  assert.strictEqual(out.mediaInfo.status, 5);
  assert.ok(out.releaseDates);
});

test('fetchMediaDetails returns null when disabled', async () => {
  const client = createSeerrClient({ fetch: () => {}, enabled: false });
  const out = await client.fetchMediaDetails('movie', 100);
  assert.strictEqual(out, null);
});
```

- [ ] **Step 15.2: Run test to verify it fails**

```bash
npm test
```

Expected: 8 new tests fail.

- [ ] **Step 15.3: Create `public/js/api/seerr.js`**

```javascript
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
    const body = { mediaType, mediaId };
    if (mediaType === 'tv' && seasons) body.seasons = seasons;
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
```

- [ ] **Step 15.4: Run test to verify it passes**

```bash
npm test
```

Expected: All Seerr tests pass.

- [ ] **Step 15.5: Commit**

```bash
git add public/js/api/seerr.js tests/api-seerr.test.js
git commit -m "feat(api): Seerr client with typed errors"
```

---

## Phase D — UI components

These modules touch the DOM. Some get a focused unit test (card rendering); others (feed virtualization, youtube player, settings) are tested manually after Task 20 wiring.

---

### Task 16: youtube player module

**Files:**
- Create: `public/js/youtube.js`

- [ ] **Step 16.1: Create `public/js/youtube.js`**

```javascript
let apiReadyPromise = null;

function loadYouTubeApi() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('youtube_api_load_failed'));
    document.head.appendChild(tag);
    const existing = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existing) existing();
      resolve(window.YT);
    };
    setTimeout(() => reject(new Error('youtube_api_timeout')), 10_000);
  });
  return apiReadyPromise;
}

export async function mountPlayer(containerEl, videoKey, { onReady, onError, autoplay = false } = {}) {
  const YT = await loadYouTubeApi();
  return new Promise((resolve) => {
    const player = new YT.Player(containerEl, {
      videoId: videoKey,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: autoplay ? 1 : 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        fs: 0,
        iv_load_policy: 3,
        mute: 1,
      },
      events: {
        onReady: () => {
          onReady?.(player);
          resolve(player);
        },
        onError: (e) => onError?.(e),
        onStateChange: (e) => {
          // 0=ended → loop to start
          if (e.data === 0) player.seekTo(0);
        },
      },
    });
  });
}

export function unmountPlayer(player) {
  try {
    player?.destroy?.();
  } catch { /* no-op */ }
}

export function play(player) {
  try { player?.playVideo?.(); } catch { /* no-op */ }
}

export function pause(player) {
  try { player?.pauseVideo?.(); } catch { /* no-op */ }
}

export function setMuted(player, muted) {
  try {
    if (muted) player?.mute?.();
    else player?.unMute?.();
  } catch { /* no-op */ }
}
```

- [ ] **Step 16.2: Commit**

```bash
git add public/js/youtube.js
git commit -m "feat(youtube): iframe API lifecycle helpers"
```

---

### Task 17: card module + CSS

**Files:**
- Create: `public/js/card.js`
- Create: `public/css/cards.css`
- Create: `tests/card.test.js`

- [ ] **Step 17.1: Write failing test**

Create `tests/card.test.js`:

```javascript
import { test, before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let createCard;
let createI18n;

before(async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  ({ createCard } = await import('../public/js/card.js'));
  ({ createI18n } = await import('../public/js/i18n.js'));
});

function makeI18nStub() {
  return { t: (key, p) => (p ? `${key}:${JSON.stringify(p)}` : key) };
}

const sampleItem = {
  id: 'movie-100',
  tmdbId: 100,
  mediaType: 'movie',
  title: 'Dune',
  overview: 'Description du film',
  genreIds: [28, 12],
  rating: 8.0,
  year: 2021,
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  trailerKey: 'ABCDE',
  seerrStatus: null,
  releaseDates: null,
};

test('createCard renders title, year, mediaType badge', () => {
  const i18n = makeI18nStub();
  const el = createCard({
    item: sampleItem,
    i18n,
    genreMap: new Map([['movie:28', 'Action']]),
    seerrEnabled: true,
  });
  assert.match(el.querySelector('.card__title').textContent, /Dune/);
  assert.match(el.querySelector('.card__year').textContent, /2021/);
  assert.match(el.querySelector('.card__media-type').textContent, /Film/);
});

test('createCard hides "Je veux" if seerrEnabled is false', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: false,
  });
  assert.strictEqual(el.querySelector('.card__btn-want'), null);
});

test('createCard shows "Disponible" badge when seerrStatus >= 5', () => {
  const item = { ...sampleItem, seerrStatus: 5 };
  const el = createCard({
    item,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
  });
  const badge = el.querySelector('.card__availability-badge');
  assert.ok(badge);
  assert.match(badge.textContent, /available/);
});

test('createCard shows "Demandé" state when item.id in requestedIds', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
    requestedIds: new Set(['movie-100']),
  });
  const btn = el.querySelector('.card__btn-want');
  assert.match(btn.textContent, /requested/);
  assert.ok(btn.disabled);
});

test('createCard emits card:request event on want button click', () => {
  const el = createCard({
    item: sampleItem,
    i18n: makeI18nStub(),
    genreMap: new Map(),
    seerrEnabled: true,
  });
  let received;
  el.addEventListener('card:request', (e) => { received = e.detail; });
  el.querySelector('.card__btn-want').click();
  assert.strictEqual(received.id, 'movie-100');
});
```

- [ ] **Step 17.2: Run test to verify it fails**

```bash
npm test
```

Expected: 5 new tests fail.

- [ ] **Step 17.3: Create `public/js/card.js`**

```javascript
export function createCard({ item, i18n, genreMap, seerrEnabled, requestedIds = new Set(), watchlistIds = new Set() }) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.itemId = item.id;
  el.dataset.mediaType = item.mediaType;

  const isRequested = requestedIds.has(item.id);
  const isInWatchlist = watchlistIds.has(item.id);
  const isAvailable = item.seerrStatus !== null && item.seerrStatus >= 5;
  const isProcessing = item.seerrStatus === 3 || item.seerrStatus === 4;
  const isPartial = item.seerrStatus === 2;
  const showWantButton = seerrEnabled && !isAvailable;

  const genreNames = (item.genreIds || [])
    .map((id) => genreMap.get(`${item.mediaType}:${id}`))
    .filter(Boolean)
    .slice(0, 3);

  const backdropUrl = item.backdropPath
    ? `https://image.tmdb.org/t/p/w1280${item.backdropPath}`
    : null;

  el.innerHTML = `
    <div class="card__video-wrapper">
      <div class="card__video" data-trailer-key="${item.trailerKey || ''}"></div>
      ${backdropUrl ? `<div class="card__backdrop" style="background-image: url('${backdropUrl}')"></div>` : ''}
      <div class="card__gradient"></div>
    </div>
    <div class="card__overlay">
      <div class="card__top-row">
        <span class="card__media-type">${i18n.t(`card.media_type.${item.mediaType}`)}</span>
        ${isAvailable ? `<span class="card__availability-badge card__availability-badge--available">${i18n.t('card.available')}</span>` : ''}
        ${isProcessing ? `<span class="card__availability-badge card__availability-badge--processing">${i18n.t('card.processing')}</span>` : ''}
        ${isPartial ? `<span class="card__availability-badge card__availability-badge--partial">${i18n.t('card.partial')}</span>` : ''}
      </div>
      <h2 class="card__title">${escapeHtml(item.title)}</h2>
      <div class="card__meta">
        <span class="card__year">${item.year || ''}</span>
        ${item.rating ? `<span class="card__rating">⭐ ${item.rating.toFixed(1)}</span>` : ''}
        ${genreNames.length ? `<span class="card__genres">${genreNames.join(' · ')}</span>` : ''}
      </div>
      <p class="card__synopsis" data-expanded="false">${escapeHtml(item.overview)}</p>
      <div class="card__action-bar">
        ${showWantButton ? `
          <button class="card__btn card__btn-want ${isRequested ? 'is-requested' : ''}" ${isRequested ? 'disabled' : ''} aria-label="${i18n.t('card.want')}">
            <span class="card__btn-icon">${isRequested ? '✅' : '❤️'}</span>
            <span class="card__btn-label">${i18n.t(isRequested ? 'card.requested' : 'card.want')}</span>
          </button>
        ` : ''}
        <button class="card__btn card__btn-watchlist ${isInWatchlist ? 'is-active' : ''}" aria-label="${i18n.t(isInWatchlist ? 'card.watchlist_remove' : 'card.watchlist_add')}">
          <span class="card__btn-icon">🔖</span>
        </button>
        <button class="card__btn card__btn-dates" aria-label="${i18n.t('card.show_dates')}">
          <span class="card__btn-icon">📅</span>
        </button>
        <button class="card__btn card__btn-synopsis" aria-label="${i18n.t('card.show_synopsis')}">
          <span class="card__btn-icon">💬</span>
        </button>
      </div>
    </div>
  `;

  // Wire events
  el.querySelector('.card__btn-want')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:request', {
      detail: { id: item.id, mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title },
      bubbles: true,
    }));
  });
  el.querySelector('.card__btn-watchlist')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:watchlist', {
      detail: { id: item.id, mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title, posterPath: item.posterPath },
      bubbles: true,
    }));
  });
  el.querySelector('.card__btn-dates')?.addEventListener('click', () => {
    el.dispatchEvent(new CustomEvent('card:show-dates', { detail: { item }, bubbles: true }));
  });
  el.querySelector('.card__btn-synopsis')?.addEventListener('click', () => {
    const synopsis = el.querySelector('.card__synopsis');
    const expanded = synopsis.dataset.expanded === 'true';
    synopsis.dataset.expanded = String(!expanded);
  });

  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
```

- [ ] **Step 17.4: Create `public/css/cards.css`**

```css
.feed {
  width: 100%;
  height: 100%;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.feed::-webkit-scrollbar { display: none; }

.card {
  position: relative;
  width: 100%;
  height: 100dvh;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  overflow: hidden;
  background: var(--bg);
  animation: fade-in var(--t-medium) ease-out;
}

.card__video-wrapper {
  position: absolute;
  inset: 0;
}
.card__video,
.card__video iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
.card__backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  z-index: -1;
  filter: brightness(0.7);
}
.card__gradient {
  position: absolute;
  inset: 0;
  background: var(--overlay-gradient);
  pointer-events: none;
}

.card__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: var(--space-lg);
  padding-bottom: calc(var(--action-bar-height) + var(--space-lg) + var(--safe-bottom));
  pointer-events: none;
}
.card__overlay > * { pointer-events: auto; }

.card__top-row {
  position: absolute;
  top: calc(var(--space-lg) + var(--safe-top));
  left: var(--space-lg);
  right: var(--space-lg);
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.card__media-type,
.card__availability-badge {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.card__availability-badge--available {
  background: rgba(70, 211, 105, 0.18);
  color: var(--success);
  border-color: rgba(70, 211, 105, 0.3);
}
.card__availability-badge--processing {
  background: rgba(245, 166, 35, 0.18);
  color: var(--warning);
  border-color: rgba(245, 166, 35, 0.3);
}
.card__availability-badge--partial {
  background: rgba(74, 158, 255, 0.18);
  color: var(--info);
  border-color: rgba(74, 158, 255, 0.3);
}

.card__title {
  font-size: clamp(1.6rem, 5vw, 2.2rem);
  font-weight: 900;
  line-height: 1.1;
  margin: 0 0 var(--space-sm) 0;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
}

.card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: 0.92rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
  font-weight: 500;
}
.card__rating { color: #ffd166; }

.card__synopsis {
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--text);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: -webkit-line-clamp var(--t-medium);
}
.card__synopsis[data-expanded="true"] {
  -webkit-line-clamp: unset;
  display: block;
}

.card__action-bar {
  position: absolute;
  bottom: calc(var(--space-md) + var(--safe-bottom));
  left: var(--space-md);
  right: var(--space-md);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
  height: var(--action-bar-height);
  padding: 0 var(--space-sm);
}

.card__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  height: 56px;
  padding: 0 var(--space-md);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text);
  transition: transform var(--t-fast), background var(--t-fast);
}
.card__btn:active { transform: scale(0.94); }

.card__btn-want {
  background: var(--accent);
  border-color: transparent;
  flex: 1;
  font-size: 1rem;
  font-weight: 700;
}
.card__btn-want:hover { background: var(--accent-hover); }
.card__btn-want.is-requested {
  background: var(--success);
  color: #0a3d18;
}
.card__btn-want:disabled {
  opacity: 0.85;
  cursor: default;
}
.card__btn-want.is-pulsing { animation: pulse 200ms ease-out; }

.card__btn-watchlist.is-active {
  background: rgba(245, 166, 35, 0.22);
  border-color: rgba(245, 166, 35, 0.4);
  color: var(--warning);
}

.card__btn-icon {
  font-size: 1.2rem;
  line-height: 1;
}
.card__btn-watchlist,
.card__btn-dates,
.card__btn-synopsis {
  width: 56px;
  padding: 0;
}

.card__skeleton {
  position: absolute;
  inset: 0;
  background: var(--bg-elevated);
  z-index: 5;
}

/* Tap-to-play overlay (iOS autoplay fallback) */
.card__tap-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 6;
  background: rgba(0, 0, 0, 0.4);
  font-size: 1.1rem;
  font-weight: 600;
}

/* Dates popup */
.dates-popup {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: var(--space-lg);
}
.dates-popup__panel {
  width: min(420px, 100%);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  border: 1px solid var(--border);
  animation: fade-in var(--t-medium) ease-out;
}
.dates-popup__title {
  font-size: 1.2rem;
  font-weight: 700;
  margin: 0 0 var(--space-md) 0;
}
.dates-popup__row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.95rem;
}
.dates-popup__row:last-child { border-bottom: none; }
.dates-popup__label { color: var(--text-secondary); font-weight: 500; }
.dates-popup__value { font-weight: 600; }
.dates-popup__close {
  margin-top: var(--space-md);
  width: 100%;
  padding: var(--space-md);
  background: var(--accent);
  border-radius: var(--radius-pill);
  font-weight: 600;
}

/* Mute toggle, top right */
.mute-btn {
  position: fixed;
  top: calc(var(--space-md) + var(--safe-top));
  right: calc(var(--space-md) + var(--space-2xl));
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  font-size: 1.1rem;
}

/* Settings entry button */
.settings-btn {
  position: fixed;
  top: calc(var(--space-md) + var(--safe-top));
  right: var(--space-md);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  font-size: 1.2rem;
}
```

- [ ] **Step 17.5: Run test to verify card tests pass**

```bash
npm test
```

Expected: All 5 card tests pass.

- [ ] **Step 17.6: Commit**

```bash
git add public/js/card.js public/css/cards.css tests/card.test.js
git commit -m "feat(card): card render module + cards.css"
```

---

### Task 18: feed module (virtualization + scroll snap)

**Files:**
- Create: `public/js/feed.js`

> **Note:** Feed virtualization is heavily DOM-coupled and timing-sensitive. We test it manually after Task 20 wiring rather than with a brittle JSDOM mock of IntersectionObserver.

- [ ] **Step 18.1: Create `public/js/feed.js`**

```javascript
import { createCard } from './card.js';
import { mountPlayer, unmountPlayer, play, pause, setMuted } from './youtube.js';
import { toast } from './toast.js';

const WINDOW_RADIUS = 2; // keep [i-2, i-1, i, i+1, i+2] in DOM

export function createFeed({ container, store, tmdb, seerr, i18n, genreMap, seerrEnabled }) {
  const feedEl = document.createElement('div');
  feedEl.className = 'feed';
  container.replaceChildren(feedEl);

  const players = new Map(); // itemId -> YT.Player instance
  const cardEls = new Map(); // itemId -> HTMLElement
  let currentPage = 1;
  let totalPages = 1;
  let isLoadingPage = false;

  let observerDebounceTimer = null;
  const observer = new IntersectionObserver(
    (entries) => {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(() => onIntersection(entries), 150);
    },
    { root: feedEl, threshold: 0.8 }
  );

  function onIntersection(entries) {
    for (const entry of entries) {
      const id = entry.target.dataset.itemId;
      const player = players.get(id);
      if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
        const idx = store.getState().feed.findIndex((i) => i.id === id);
        if (idx >= 0) {
          store.dispatch({ type: 'SET_INDEX', index: idx });
          updateWindow(idx);
          loadMoreIfNeeded(idx);
        }
        if (player) {
          play(player);
          setMuted(player, store.getState().isMutedGlobally);
        }
      } else {
        if (player) {
          pause(player);
          setMuted(player, true);
        }
      }
    }
  }

  function updateWindow(centerIdx) {
    const feed = store.getState().feed;
    const minIdx = Math.max(0, centerIdx - WINDOW_RADIUS);
    const maxIdx = Math.min(feed.length - 1, centerIdx + WINDOW_RADIUS);
    const liveIds = new Set();
    for (let i = minIdx; i <= maxIdx; i++) liveIds.add(feed[i].id);

    // Unmount cards outside window
    for (const [id, el] of cardEls) {
      if (!liveIds.has(id)) {
        const p = players.get(id);
        if (p) { unmountPlayer(p); players.delete(id); }
        observer.unobserve(el);
        el.remove();
        cardEls.delete(id);
      }
    }

    // Mount cards inside window if missing
    for (let i = minIdx; i <= maxIdx; i++) {
      const item = feed[i];
      if (cardEls.has(item.id)) continue;
      const el = renderCard(item);
      // Position-correct insertion: find the next existing card with greater index
      let nextEl = null;
      for (let j = i + 1; j <= maxIdx; j++) {
        const found = cardEls.get(feed[j]?.id);
        if (found) { nextEl = found; break; }
      }
      feedEl.insertBefore(el, nextEl);
      cardEls.set(item.id, el);
      observer.observe(el);
      attachPlayerIfReady(item, el);
    }
  }

  async function attachPlayerIfReady(item, el) {
    if (!item.trailerKey) return;
    const target = el.querySelector('.card__video');
    if (!target) return;
    try {
      const player = await mountPlayer(target, item.trailerKey, {
        autoplay: false,
        onError: () => {
          toast(i18n.t('card.unavailable'), { variant: 'warning' });
        },
      });
      players.set(item.id, player);
    } catch (e) {
      console.error('feed: mount player failed', e);
    }
  }

  function renderCard(item) {
    return createCard({
      item,
      i18n,
      genreMap,
      seerrEnabled,
      requestedIds: store.getState().requestedIds,
      watchlistIds: store.getState().watchlistIds,
    });
  }

  async function loadMoreIfNeeded(currentIdx) {
    const feed = store.getState().feed;
    if (currentIdx < feed.length - 3) return;
    if (isLoadingPage) return;
    if (currentPage >= totalPages) return;
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const { items, totalPages: tp } = await tmdb.fetchTrending(currentPage + 1, filter);
      const enriched = await enrichItems(items);
      store.dispatch({ type: 'APPEND_FEED', items: enriched });
      currentPage += 1;
      totalPages = tp;
      updateWindow(store.getState().currentIndex);
    } catch (e) {
      console.error('feed: pagination failed', e);
      toast(i18n.t('feed.loading_more_failed'), { variant: 'error' });
    } finally {
      isLoadingPage = false;
    }
  }

  async function enrichItems(items) {
    const enrichOne = async (item) => {
      const [trailerKey, details] = await Promise.all([
        tmdb.fetchTrailerKey(item.mediaType, item.tmdbId).catch(() => null),
        seerrEnabled
          ? seerr.fetchMediaDetails(item.mediaType, item.tmdbId).catch(() => null)
          : Promise.resolve(null),
      ]);
      const seerrStatus = details?.mediaInfo?.status ?? null;
      return {
        ...item,
        trailerKey,
        seerrStatus,
        releaseDates: details?.releaseDates ?? null,
        firstAirDate: details?.firstAirDate ?? null,
        lastAirDate: details?.lastAirDate ?? null,
        nextEpisodeToAir: details?.nextEpisodeToAir ?? null,
      };
    };
    const enriched = await Promise.all(items.map(enrichOne));
    return enriched.filter((i) => i.trailerKey); // drop items without trailers
  }

  async function init() {
    isLoadingPage = true;
    try {
      const filter = store.getState().preferences.filter;
      const { items, totalPages: tp } = await tmdb.fetchTrending(1, filter);
      const enriched = await enrichItems(items);
      currentPage = 1;
      totalPages = tp;
      store.dispatch({ type: 'SET_FEED', items: enriched });
      if (enriched.length === 0) {
        showEmptyState();
        return;
      }
      updateWindow(0);
      // Start auto-play on first card after a tick
      setTimeout(() => {
        const firstId = enriched[0].id;
        const p = players.get(firstId);
        if (p) {
          play(p);
          setMuted(p, store.getState().isMutedGlobally);
        }
      }, 200);
    } catch (e) {
      console.error('feed: init failed', e);
      showErrorState();
    } finally {
      isLoadingPage = false;
    }
  }

  function showEmptyState() {
    feedEl.innerHTML = `
      <div class="error-screen">
        <div class="error-screen__title">${i18n.t('feed.empty')}</div>
        <button class="error-screen__action" onclick="location.reload()">${i18n.t('feed.retry')}</button>
      </div>
    `;
  }

  function showErrorState() {
    feedEl.innerHTML = `
      <div class="error-screen">
        <div class="error-screen__title">${i18n.t('feed.error')}</div>
        <button class="error-screen__action" onclick="location.reload()">${i18n.t('feed.retry')}</button>
      </div>
    `;
  }

  function reset() {
    for (const [id, p] of players) unmountPlayer(p);
    players.clear();
    cardEls.clear();
    feedEl.innerHTML = '';
    currentPage = 1;
    totalPages = 1;
    isLoadingPage = false;
  }

  function setMutedAll(muted) {
    for (const p of players.values()) setMuted(p, muted);
  }

  function pauseAll() {
    for (const p of players.values()) pause(p);
  }

  function resumeCurrent() {
    const idx = store.getState().currentIndex;
    const item = store.getState().feed[idx];
    if (!item) return;
    const p = players.get(item.id);
    if (p) {
      play(p);
      setMuted(p, store.getState().isMutedGlobally);
    }
  }

  function scrollTo(index) {
    const feed = store.getState().feed;
    const item = feed[index];
    if (!item) return;
    const el = cardEls.get(item.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { init, reset, setMutedAll, pauseAll, resumeCurrent, scrollTo };
}
```

- [ ] **Step 18.2: Commit**

```bash
git add public/js/feed.js
git commit -m "feat(feed): virtualized feed with intersection observer + pagination"
```

---

### Task 19: settings module + CSS

**Files:**
- Create: `public/js/settings.js`
- Create: `public/css/settings.css`

- [ ] **Step 19.1: Create `public/js/settings.js`**

```javascript
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPromptEvent = e;
});

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function createSettings({ container, store, i18n, onFilterChange }) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.hidden = true;

  function render() {
    const state = store.getState();
    const installable = !!installPromptEvent || isIOS();
    overlay.innerHTML = `
      <div class="settings-panel" role="dialog" aria-label="${i18n.t('settings.title')}">
        <div class="settings-panel__header">
          <h2>${i18n.t('settings.title')}</h2>
          <button class="settings-panel__close" aria-label="${i18n.t('settings.close')}">✕</button>
        </div>
        <div class="settings-panel__body">
          <section class="settings-section">
            <label class="settings-label">${i18n.t('settings.filter')}</label>
            <div class="settings-segmented" data-name="filter">
              <button class="${state.preferences.filter === 'all' ? 'is-active' : ''}" data-value="all">${i18n.t('settings.filter.all')}</button>
              <button class="${state.preferences.filter === 'movie' ? 'is-active' : ''}" data-value="movie">${i18n.t('settings.filter.movie')}</button>
              <button class="${state.preferences.filter === 'tv' ? 'is-active' : ''}" data-value="tv">${i18n.t('settings.filter.tv')}</button>
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">${i18n.t('settings.watchlist')}</label>
            <button class="settings-row-btn" data-action="watchlist-view">
              ${i18n.t('settings.watchlist_view')}
              <span class="settings-row-btn__count">${state.watchlist.length}</span>
            </button>
            <button class="settings-row-btn settings-row-btn--danger" data-action="watchlist-clear">
              ${i18n.t('settings.watchlist_clear')}
            </button>
          </section>

          ${
            !isStandalone()
              ? `
          <section class="settings-section">
            <button class="settings-row-btn settings-row-btn--primary"
                    data-action="install"
                    ${installable ? '' : 'disabled'}
                    title="${installable ? '' : i18n.t('settings.install_unsupported')}">
              ${i18n.t('settings.install')}
            </button>
            <p class="settings-hint" id="install-hint" hidden>${i18n.t('settings.install_ios_help')}</p>
          </section>
          `
              : ''
          }
        </div>
      </div>
    `;

    overlay.querySelector('.settings-panel__close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('[data-name="filter"]').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      const value = btn.dataset.value;
      store.dispatch({ type: 'SET_FILTER', value });
      onFilterChange?.(value);
      render();
    });

    overlay.querySelector('[data-action="watchlist-view"]')?.addEventListener('click', showWatchlistModal);
    overlay.querySelector('[data-action="watchlist-clear"]')?.addEventListener('click', () => {
      if (confirm(i18n.t('settings.watchlist_clear_confirm'))) {
        store.dispatch({ type: 'CLEAR_WATCHLIST' });
        render();
      }
    });

    const installBtn = overlay.querySelector('[data-action="install"]');
    if (installBtn) installBtn.addEventListener('click', triggerInstall);
  }

  async function triggerInstall() {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      installPromptEvent = null;
      return;
    }
    if (isIOS()) {
      const hint = overlay.querySelector('#install-hint');
      if (hint) hint.hidden = false;
    }
  }

  function showWatchlistModal() {
    const list = store.getState().watchlist;
    const modal = document.createElement('div');
    modal.className = 'watchlist-modal';
    if (list.length === 0) {
      modal.innerHTML = `
        <div class="watchlist-modal__panel">
          <p>${i18n.t('settings.watchlist_empty')}</p>
          <button class="watchlist-modal__close">${i18n.t('settings.close')}</button>
        </div>`;
    } else {
      modal.innerHTML = `
        <div class="watchlist-modal__panel">
          <h3>${i18n.t('settings.watchlist')}</h3>
          <ul class="watchlist-modal__list">
            ${list
              .map(
                (i) => `
              <li>
                ${i.posterPath ? `<img src="https://image.tmdb.org/t/p/w92${i.posterPath}" alt="" loading="lazy">` : ''}
                <span>${i.title}</span>
              </li>`
              )
              .join('')}
          </ul>
          <button class="watchlist-modal__close">${i18n.t('settings.close')}</button>
        </div>`;
    }
    modal.querySelector('.watchlist-modal__close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    container.appendChild(modal);
  }

  function open() {
    render();
    overlay.hidden = false;
    container.appendChild(overlay);
  }

  function close() {
    overlay.hidden = true;
    overlay.remove();
  }

  function toggle() {
    if (overlay.hidden) open();
    else close();
  }

  function isOpen() { return !overlay.hidden; }

  return { open, close, toggle, isOpen };
}
```

- [ ] **Step 19.2: Create `public/css/settings.css`**

```css
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  justify-content: flex-end;
}

.settings-panel {
  width: min(420px, 100%);
  height: 100%;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border);
  animation: slide-in-right var(--t-medium) ease-out;
  display: flex;
  flex-direction: column;
}

.settings-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border);
  padding-top: calc(var(--space-lg) + var(--safe-top));
}
.settings-panel__header h2 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
}
.settings-panel__close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.settings-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.settings-label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.settings-segmented {
  display: flex;
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  padding: 4px;
  gap: 4px;
}
.settings-segmented button {
  flex: 1;
  padding: var(--space-sm);
  border-radius: calc(var(--radius-md) - 4px);
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 0.92rem;
  transition: all var(--t-fast);
}
.settings-segmented button.is-active {
  background: var(--text);
  color: var(--bg);
}

.settings-row-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-md);
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  font-weight: 500;
  text-align: left;
}
.settings-row-btn__count {
  background: var(--accent);
  color: white;
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  font-size: 0.8rem;
  font-weight: 700;
}
.settings-row-btn--danger { color: var(--danger); }
.settings-row-btn--primary {
  background: var(--accent);
  color: white;
  font-weight: 700;
  justify-content: center;
}
.settings-row-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

/* Watchlist modal */
.watchlist-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}
.watchlist-modal__panel {
  width: min(420px, 100%);
  max-height: 70vh;
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  border: 1px solid var(--border);
  overflow-y: auto;
  animation: fade-in var(--t-medium);
}
.watchlist-modal__panel h3 { margin-top: 0; }
.watchlist-modal__list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-md) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.watchlist-modal__list li {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm);
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
}
.watchlist-modal__list img {
  width: 46px;
  height: auto;
  border-radius: 4px;
}
.watchlist-modal__close {
  width: 100%;
  padding: var(--space-md);
  background: var(--accent);
  border-radius: var(--radius-pill);
  font-weight: 600;
}
```

- [ ] **Step 19.3: Commit**

```bash
git add public/js/settings.js public/css/settings.css
git commit -m "feat(settings): settings panel + watchlist modal + install button"
```

---

## Phase E — Bootstrap, PWA, polish

---

### Task 20: app.js bootstrap

**Files:**
- Create: `public/js/app.js`

- [ ] **Step 20.1: Create `public/js/app.js`**

```javascript
import { createI18n } from './i18n.js';
import { createStore } from './store.js';
import { createTmdbClient } from './api/tmdb.js';
import {
  createSeerrClient,
  AlreadyRequestedError,
  UnauthorizedError,
  NotConfiguredError,
} from './api/seerr.js';
import { createFeed } from './feed.js';
import { createSettings } from './settings.js';
import { toast } from './toast.js';

const appEl = document.getElementById('app');

async function main() {
  const i18n = createI18n();
  await i18n.loadLocale('fr');

  const store = createStore({ storage: window.localStorage });
  store.hydrate();

  // Health check
  let health;
  try {
    const res = await fetch('/api/health');
    health = await res.json();
  } catch {
    health = { tmdb: false, seerr: false, seerrType: 'overseerr' };
  }
  store.dispatch({ type: 'SET_HEALTH', health });

  if (!health.tmdb) {
    renderTmdbErrorScreen(i18n);
    return;
  }

  const tmdb = createTmdbClient();
  const seerr = createSeerrClient({ enabled: health.seerr });
  const seerrEnabled = health.seerr;

  // Top-right buttons
  const muteBtn = document.createElement('button');
  muteBtn.className = 'mute-btn';
  muteBtn.setAttribute('aria-label', 'Toggle mute');
  muteBtn.innerHTML = '🔇';
  document.body.appendChild(muteBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'settings-btn';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = '⚙️';
  document.body.appendChild(settingsBtn);

  // Read-only banner if Seerr disabled
  if (!seerrEnabled) {
    const banner = document.createElement('div');
    banner.className = 'read-only-banner';
    banner.textContent = i18n.t('feed.read_only_banner');
    document.body.appendChild(banner);
  }

  // Genre map
  let genreMap = new Map();
  try {
    genreMap = await tmdb.loadGenres();
  } catch (e) {
    console.error('app: loadGenres failed', e);
  }

  // Feed
  const feed = createFeed({
    container: appEl,
    store,
    tmdb,
    seerr,
    i18n,
    genreMap,
    seerrEnabled,
  });
  feed.init();

  // Settings
  const settings = createSettings({
    container: document.body,
    store,
    i18n,
    onFilterChange: () => {
      feed.reset();
      feed.init();
    },
  });

  settingsBtn.addEventListener('click', () => settings.toggle());

  muteBtn.addEventListener('click', () => {
    const next = !store.getState().isMutedGlobally;
    store.dispatch({ type: 'SET_MUTED', value: next });
    muteBtn.innerHTML = next ? '🔇' : '🔊';
    feed.setMutedAll(next);
  });

  // Handle card events bubbling up
  appEl.addEventListener('card:request', async (e) => {
    const { id, mediaType, tmdbId, title } = e.detail;
    const card = appEl.querySelector(`.card[data-item-id="${id}"]`);
    const btn = card?.querySelector('.card__btn-want');
    if (btn) {
      btn.classList.add('is-pulsing');
      btn.disabled = true;
    }
    if (navigator.vibrate) navigator.vibrate(50);
    try {
      await seerr.requestMedia({ mediaType, mediaId: tmdbId });
      store.dispatch({ type: 'ADD_REQUESTED', id });
      toast(i18n.t('toast.requested', { title }), { variant: 'success' });
      if (btn) {
        btn.classList.add('is-requested');
        btn.querySelector('.card__btn-icon').textContent = '✅';
        btn.querySelector('.card__btn-label').textContent = i18n.t('card.requested');
      }
    } catch (err) {
      if (err instanceof AlreadyRequestedError) {
        store.dispatch({ type: 'ADD_REQUESTED', id });
        toast(i18n.t('toast.already_requested', { title }), { variant: 'warning' });
        if (btn) {
          btn.classList.add('is-requested');
          btn.querySelector('.card__btn-icon').textContent = '✅';
          btn.querySelector('.card__btn-label').textContent = i18n.t('card.already_requested');
        }
      } else if (err instanceof UnauthorizedError) {
        toast(i18n.t('toast.seerr_auth_error'), { variant: 'error' });
        if (btn) btn.disabled = false;
      } else if (err instanceof NotConfiguredError) {
        toast(i18n.t('feed.read_only_banner'), { variant: 'warning' });
        if (btn) btn.disabled = false;
      } else {
        toast(i18n.t('toast.seerr_unreachable'), { variant: 'error' });
        if (btn) btn.disabled = false;
      }
    } finally {
      btn?.classList.remove('is-pulsing');
    }
  });

  appEl.addEventListener('card:watchlist', (e) => {
    store.dispatch({ type: 'TOGGLE_WATCHLIST', item: e.detail });
    const card = appEl.querySelector(`.card[data-item-id="${e.detail.id}"]`);
    const btn = card?.querySelector('.card__btn-watchlist');
    if (btn) {
      const isActive = store.getState().watchlistIds.has(e.detail.id);
      btn.classList.toggle('is-active', isActive);
    }
  });

  appEl.addEventListener('card:show-dates', (e) => {
    showDatesPopup(e.detail.item, i18n);
  });

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) feed.pauseAll();
    else feed.resumeCurrent();
  });

  // Online/offline banner
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.textContent = i18n.t('feed.offline_banner');
  offlineBanner.hidden = navigator.onLine;
  document.body.appendChild(offlineBanner);
  window.addEventListener('online', () => { offlineBanner.hidden = true; });
  window.addEventListener('offline', () => { offlineBanner.hidden = false; });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        feed.resumeCurrent();
        break;
      case 'ArrowDown':
        e.preventDefault();
        feed.scrollTo(store.getState().currentIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        feed.scrollTo(Math.max(0, store.getState().currentIndex - 1));
        break;
      case 'm':
      case 'M':
        muteBtn.click();
        break;
      case 'r':
      case 'R': {
        const idx = store.getState().currentIndex;
        const item = store.getState().feed[idx];
        if (item && seerrEnabled) {
          const card = appEl.querySelector(`.card[data-item-id="${item.id}"]`);
          card?.querySelector('.card__btn-want')?.click();
        }
        break;
      }
      case 's':
      case 'S':
        settings.toggle();
        break;
      case 'Escape':
        if (settings.isOpen()) settings.close();
        break;
    }
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }
}

function renderTmdbErrorScreen(i18n) {
  appEl.innerHTML = `
    <div class="error-screen">
      <div class="error-screen__title">${i18n.t('boot.error.tmdb_missing.title')}</div>
      <div class="error-screen__detail">${i18n.t('boot.error.tmdb_missing.detail')}</div>
      <button class="error-screen__action" onclick="location.reload()">${i18n.t('boot.error.tmdb_missing.retry')}</button>
    </div>
  `;
}

function showDatesPopup(item, i18n) {
  const popup = document.createElement('div');
  popup.className = 'dates-popup';
  const lines = buildDateLines(item, i18n);
  popup.innerHTML = `
    <div class="dates-popup__panel">
      <h3 class="dates-popup__title">${i18n.t('card.show_dates')}</h3>
      ${lines.length ? lines.map((l) => `
        <div class="dates-popup__row">
          <span class="dates-popup__label">${l.label}</span>
          <span class="dates-popup__value">${l.value}</span>
        </div>
      `).join('') : `<p class="dates-popup__row">${i18n.t('dates.empty')}</p>`}
      <button class="dates-popup__close">${i18n.t('dates.close')}</button>
    </div>
  `;
  popup.querySelector('.dates-popup__close').addEventListener('click', () => popup.remove());
  popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
  document.body.appendChild(popup);
}

function buildDateLines(item, i18n) {
  const lines = [];
  const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : null;

  if (item.mediaType === 'movie' && item.releaseDates?.results) {
    const fr = item.releaseDates.results.find((r) => r.iso_3166_1 === 'FR');
    const us = item.releaseDates.results.find((r) => r.iso_3166_1 === 'US');
    const region = fr || us || item.releaseDates.results[0];
    if (region) {
      const byType = (t) => region.release_dates.find((r) => r.type === t);
      const labels = { 3: 'dates.theatrical', 4: 'dates.digital', 5: 'dates.physical' };
      for (const [type, key] of Object.entries(labels)) {
        const r = byType(Number(type));
        if (r?.release_date) {
          lines.push({ label: i18n.t(key), value: fmt(r.release_date) });
        }
      }
    }
  } else if (item.mediaType === 'tv') {
    if (item.firstAirDate) lines.push({ label: i18n.t('dates.first_air'), value: fmt(item.firstAirDate) });
    if (item.lastAirDate) lines.push({ label: i18n.t('dates.last_air'), value: fmt(item.lastAirDate) });
    if (item.nextEpisodeToAir?.airDate) {
      lines.push({ label: i18n.t('dates.next_episode'), value: fmt(item.nextEpisodeToAir.airDate) });
    }
  }
  return lines;
}

main().catch((e) => console.error('app: fatal', e));
```

- [ ] **Step 20.2: Add small CSS for read-only / offline banners**

Append to `public/css/layout.css`:

```css
.read-only-banner,
.offline-banner {
  position: fixed;
  top: var(--safe-top);
  left: 0;
  right: 0;
  background: rgba(245, 166, 35, 0.85);
  color: #1a0a00;
  padding: 6px var(--space-md);
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  z-index: 60;
}
.offline-banner {
  background: rgba(229, 9, 20, 0.85);
  color: white;
}
```

- [ ] **Step 20.3: Manual smoke test**

```bash
TMDB_API_KEY=<your-real-key> npm run dev
# Open http://localhost:3000 in a browser
# Verify:
# - Feed loads, first card auto-plays muted
# - Scroll snaps to next card, video swap works
# - Tap mute button → audio comes on
# - Tap settings (gear) → panel slides in
# - Settings: change filter → feed reloads
# - If SEERR_URL/KEY set: tap "Je veux" → see "Demandé" + toast
```

- [ ] **Step 20.4: Commit**

```bash
git add public/js/app.js public/css/layout.css
git commit -m "feat(app): bootstrap, event wiring, keyboard shortcuts, dates popup"
```

---

### Task 21: Service worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 21.1: Create `public/sw.js`**

```javascript
const VERSION = 'v1';
const APP_SHELL_CACHE = `trailerswipe-shell-${VERSION}`;
const TMDB_CACHE = `trailerswipe-tmdb-${VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/animations.css',
  '/css/layout.css',
  '/css/cards.css',
  '/css/settings.css',
  '/js/app.js',
  '/js/feed.js',
  '/js/card.js',
  '/js/youtube.js',
  '/js/settings.js',
  '/js/toast.js',
  '/js/i18n.js',
  '/js/store.js',
  '/js/locales/fr.json',
  '/js/api/tmdb.js',
  '/js/api/seerr.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't cache anything outside our origin
  if (url.origin !== self.location.origin) return;

  // Seerr never cached
  if (url.pathname.startsWith('/api/seerr/')) return;

  // TMDB: network-first, cache as fallback (30 min TTL)
  if (url.pathname.startsWith('/api/tmdb/')) {
    event.respondWith(networkFirstWithTtl(event.request, TMDB_CACHE, 30 * 60 * 1000));
    return;
  }

  // App shell: cache-first
  event.respondWith(cacheFirst(event.request, APP_SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok && request.method === 'GET') cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithTtl(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok && request.method === 'GET') {
      const meta = new Response(fresh.clone().body, {
        status: fresh.status,
        headers: appendHeader(fresh.headers, 'sw-cached-at', String(Date.now())),
      });
      cache.put(request, meta);
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get('sw-cached-at') || 0);
      if (Date.now() - cachedAt < ttlMs) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}

function appendHeader(headers, name, value) {
  const out = new Headers();
  for (const [k, v] of headers.entries()) out.set(k, v);
  out.set(name, value);
  return out;
}
```

- [ ] **Step 21.2: Manual test — install + offline reload**

```bash
TMDB_API_KEY=<key> npm run dev
# Open http://localhost:3000 in Chrome DevTools → Application → Service Workers
# Verify SW registered and "activated and is running"
# In Network tab, check "Offline", reload page → app shell loads from cache
```

- [ ] **Step 21.3: Commit**

```bash
git add public/sw.js
git commit -m "feat(pwa): service worker with cache-first shell + network-first TMDB"
```

---

### Task 22: README + LICENSE

**Files:**
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 22.1: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 jenre

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 22.2: Create `README.md`**

```markdown
# TrailerSwipe

PWA façon TikTok pour parcourir les bandes-annonces de films et séries en swipe vertical, avec intégration Overseerr/Jellyseerr pour demander un media en un tap. Auto-hébergeable.

## Features

- Feed vertical fullscreen (scroll snap), un trailer YouTube par card
- Autoplay muted + bouton unmute, lifecycle propre via IntersectionObserver
- Bouton ❤️ "Je veux" → POST direct à Overseerr/Jellyseerr
- Détection de disponibilité ("Disponible", "En cours", "Partiel") via Seerr
- Bouton 📅 affiche les dates de sortie (cinéma, numérique, physique)
- Watchlist locale (localStorage), filtre Films/Séries/Tous
- PWA installable, raccourcis clavier (Espace, ↑↓, M, R, S)
- Zéro dépendance frontend, zéro build step
- French UI, code i18n-ready (locales/fr.json)

## Quickstart

```bash
git clone https://github.com/jenre/trailerswipe
cd trailerswipe
cp .env.example .env       # remplis tes clés
docker compose up -d
# → app sur http://localhost:3000
```

## Configuration (.env)

| Variable | Requis | Description |
|---|---|---|
| `TMDB_API_KEY` | ✅ | Clé API TMDB v3 |
| `SEERR_TYPE` | ⚠️ | `overseerr` ou `jellyseerr` |
| `SEERR_URL` | ⚠️ | URL complète : `http://192.168.1.10:5055` |
| `SEERR_API_KEY` | ⚠️ | API key Seerr |
| `PORT` | non | défaut `3000` |

⚠️ Si `SEERR_*` non remplis, l'app fonctionne en **mode trailer-browser only** (le bouton "Je veux" est masqué).

### Obtenir les clés

- **TMDB** : crée un compte sur [themoviedb.org](https://www.themoviedb.org/), Settings → API → demande une clé v3
- **Overseerr/Jellyseerr** : Settings → General → API Key

## Sécurité

⚠️ TrailerSwipe **n'embarque pas d'authentification utilisateur**. Si tu l'exposes publiquement, n'importe qui peut envoyer des requêtes à ton Overseerr.

Recommandations :
- Déploie derrière un reverse proxy avec auth (Authelia, Traefik basic auth, Cloudflare Access)
- Ou expose uniquement sur réseau local / VPN (Tailscale, Wireguard)
- Ne committe jamais ton `.env`

## Dev local

```bash
npm install
npm run dev    # node --watch + auto-reload de .env
npm test       # tests unitaires (node:test + jsdom)
```

## Roadmap

- [ ] i18n EN
- [ ] Sync watchlist avec Seerr
- [ ] Filter par genre
- [ ] Source "à venir" (upcoming) en plus du trending

## License

MIT — voir [LICENSE](./LICENSE)

## Credits

- [TMDB](https://www.themoviedb.org/) — métadonnées et trailers
- [Overseerr](https://overseerr.dev/) / [Jellyseerr](https://github.com/Fallenbagel/jellyseerr) — gestion des requests
- [Fontshare Satoshi](https://www.fontshare.com/fonts/satoshi) — typographie
```

- [ ] **Step 22.3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: README + MIT license"
```

---

### Task 23: Final smoke test

**No files modified.** This is a manual test pass against the deployed Docker container.

- [ ] **Step 23.1: Build and start the production container**

```bash
docker compose down 2>/dev/null
docker compose up -d --build
sleep 5
curl -s http://localhost:3000/api/health
```

Expected: `{"tmdb":true,...}` (or `{"tmdb":false,...}` if no key set).

- [ ] **Step 23.2: Smoke test checklist** (in browser at `http://localhost:3000/`)

For each, write an `[OK]` / `[FAIL]` next to the bullet:

- [ ] Page loads, no console errors
- [ ] First card displays poster + title + autoplays trailer muted
- [ ] Scroll to card 2 — pause card 1, autoplay card 2
- [ ] Mute button (top right) toggles audio across cards
- [ ] Settings gear opens panel from right; close button works
- [ ] Filter switch (Films / Séries) reloads feed correctly
- [ ] Watchlist 🔖 button toggles state, persists across reload
- [ ] "Voir ma watchlist" modal lists items
- [ ] "Je veux" button (if Seerr configured) sends request, button turns green
- [ ] "Je veux" on already-requested item shows "Déjà demandé"
- [ ] 📅 button opens dates popup with at least one date for a movie
- [ ] 💬 expands/collapses synopsis
- [ ] Keyboard: Space pauses/plays, ↑↓ navigate, M mute, R request, S settings
- [ ] PWA install button shows in Settings (Chrome/Edge)
- [ ] Service Worker registered (DevTools → Application)
- [ ] Offline mode: app shell loads from cache after reload
- [ ] No "user-scalable=no" warning, no a11y violations in Lighthouse

- [ ] **Step 23.3: Commit any final fixes from smoke test**

```bash
# only if you found and fixed issues
git add .
git commit -m "fix: smoke test fixes"
```

---

## Self-Review (post-plan)

This plan was self-reviewed against the spec. Coverage notes:

- ✅ Core concept (vertical swipe feed, fullscreen cards, action bar) → Tasks 17, 18, 20
- ✅ Data source (TMDB trending + videos + genres) → Task 14
- ✅ YouTube embed (iframe API, autoplay muted, lifecycle) → Tasks 16, 18
- ✅ Overseerr/Jellyseerr integration (request, status detection) → Tasks 3, 15, 20
- ✅ Settings panel (filter, watchlist, install) → Task 19
- ✅ UI/UX (dark theme, Satoshi, animations, scroll snap) → Tasks 8, 9, 17
- ✅ PWA (manifest, SW, install) → Tasks 10, 21
- ✅ Performance (virtualization 5 cards, intersection observer, debounce, lazy) → Task 18
- ✅ Empty / error states → Tasks 18, 20
- ✅ File structure (no single-file, folder PWA, Docker bundle) → Tasks 1, 5, 6
- ✅ Admin config via env vars (no client-side credentials) → Tasks 1, 4, 20
- ✅ i18n-ready, FR seul livré → Task 11
- ✅ Vanilla JS + ES modules + CSS, zero build → all
- ✅ Sécurité notes in README → Task 22
- ✅ Tests (node:test) → Tasks 2, 3, 4, 11, 12, 14, 15, 17

No placeholders. Type/method names consistent across tasks (`fetchMediaDetails`, `loadGenres`, `createTmdbClient`, etc.).

---

## Ready to execute

Plan saved at `docs/superpowers/plans/2026-04-27-trailerswipe.md`.

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration
2. **Inline Execution** — execute tasks in this session with checkpoints
