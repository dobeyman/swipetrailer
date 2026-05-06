# Plex Authentication & Per-User Overseerr Requests

**Date:** 2026-05-06  
**Status:** Approved

## Goal

Allow friends and family to log in with their Plex account so that media requests made in TrailerSwipe are attributed to the correct user in Overseerr, rather than always appearing as the admin.

Unauthenticated users can still browse trailers in read-only mode.

## Context

- All Plex users are already imported into Overseerr.
- The current app uses a single admin API key for all Overseerr requests.
- Overseerr supports Plex OAuth natively via `POST /api/v1/auth/plex`.

## Architecture

### Flow

```
Client → POST /api/auth/plex/pin
  Backend calls plex.tv → returns { pinId, authUrl }

Client opens authUrl in new tab (plex.tv login)

Client polls GET /api/auth/plex/callback?pinId=<id> every 2s (max 5 min)
  Backend polls plex.tv for authToken
  When authToken received:
    Backend POST {SEERR_URL}/api/v1/auth/plex { authToken }
    Overseerr returns Set-Cookie: connect.sid=<value> + user data
    Backend extracts session value
    Backend GET {SEERR_URL}/api/v1/auth/me with cookie → name, avatar
    Backend returns { session, user: { name, avatar } }

Client stores { session, user, expiresAt } in localStorage (30-day TTL)

Subsequent Seerr requests include X-Seerr-Session: <session>
  Proxy forwards as Cookie: connect.sid=<session> to Overseerr (no admin API key)
```

### Unauthenticated users

Proxy falls back to admin API key. The request button is replaced by a "Log in to request" button that opens the Plex auth flow. Browsing and trailer playback are unaffected.

## Backend (`server.js`)

### New environment variable

`PLEX_CLIENT_ID` — a stable UUID identifying TrailerSwipe to Plex. Not a secret. If not set in `.env`, the server auto-generates one on startup and logs it so it can be persisted.

### New routes

**`POST /api/auth/plex/pin`**
- Calls `https://plex.tv/api/v2/pins?strong=true` with `X-Plex-Client-Identifier: {PLEX_CLIENT_ID}` and `X-Plex-Product: TrailerSwipe`
- Returns `{ pinId, authUrl }` where authUrl = `https://app.plex.tv/auth#?clientID=<id>&code=<code>&context[device][product]=TrailerSwipe`

**`GET /api/auth/plex/callback?pinId=<id>`**
- Calls `https://plex.tv/api/v2/pins/<id>` to check for `authToken`
- If not yet authenticated: returns `{ pending: true }`
- If authenticated:
  - `POST {SEERR_URL}/api/v1/auth/plex { authToken }` → extracts `connect.sid` from Set-Cookie
  - `GET {SEERR_URL}/api/v1/auth/me` with `Cookie: connect.sid=<value>` → name, avatar
  - Returns `{ session, user: { name, avatar } }`
- Timeout/error: returns `{ error: 'auth_failed' }`

### Modified Seerr proxy

- If request includes `X-Seerr-Session` header: forward `Cookie: connect.sid=<value>` to Overseerr, omit admin `X-Api-Key`
- Otherwise: existing behavior with admin API key

### Extended allowlist

Add `GET /api/v1/auth/me` to the Seerr proxy allowlist so the client can validate its session on startup.

## Frontend

### New module: `public/js/auth.js`

- `startPlexLogin()` — calls `/api/auth/plex/pin`, opens authUrl in new tab, polls `/api/auth/plex/callback` every 2s for up to 5 minutes; resolves with `{ session, user }` or rejects on timeout
- `saveSession(session, user)` — writes `{ session, user, expiresAt }` to localStorage (expiresAt = now + 30 days)
- `getSession()` — reads localStorage, returns null if missing or expired
- `clearSession()` — removes from localStorage
- `checkSession()` — reads localStorage, calls `/api/seerr/api/v1/auth/me` to verify session is still valid; clears and returns null if invalid

### Modified `public/js/api/seerr.js`

- All fetch calls include `X-Seerr-Session: <value>` header when a session exists, read via `auth.getSession()` at call time

### Modified `public/js/app.js`

- On startup: calls `checkSession()` to determine `isLoggedIn` and current `user`
- Passes `isLoggedIn` and `onLoginRequest` callback to feed/cards
- Renders the auth button in the top bar

### UI

**Top bar (unauthenticated):** "🔑 Se connecter" button alongside 🔍 and ⚙️

**Top bar (authenticated):** User avatar + name; click opens a small panel with "Se déconnecter"

**Card — unauthenticated:** Request button replaced by "🔑 Se connecter pour demander" which triggers `startPlexLogin()`

**Card — authenticated:** Existing request button behavior unchanged

## Error handling

- Plex auth timeout (5 min): toast "Connexion expirée, réessaie"
- Overseerr rejects session (401): auto-logout + toast "Session expirée, reconnecte-toi"
- Plex unreachable: toast "Impossible de contacter Plex"

## Session lifecycle

- Stored in localStorage with 30-day TTL
- Validated against Overseerr on every app startup via `/api/v1/auth/me`
- Cleared on explicit logout or on 401 from Overseerr
