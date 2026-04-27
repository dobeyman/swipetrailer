# TrailerSwipe — Design Document

**Date :** 2026-04-27
**Status :** Brainstorming sections 1-4 validées, en attente de review utilisateur
**Auteur :** jenre + Claude

---

## Pitch

PWA TikTok-like pour parcourir les bandes-annonces de films/séries en swipe vertical, avec intégration Overseerr/Jellyseerr pour demander un media en un tap. Auto-hébergeable, open source.

---

## Décisions clés (validées)

| # | Décision | Choix |
|---|----------|-------|
| 1 | Structure de fichiers | Folder PWA (pas single-file). Service Worker dédié, manifest.json séparé. |
| 2 | Communication avec Overseerr | Backend proxy Node bundlé dans le projet → résout CORS sans config admin. |
| 3 | Communication avec TMDB | Aussi via le proxy → cache la clé du navigateur. |
| 4 | Configuration | **Admin via env vars** (`.env`), pas de config user dans le navigateur. |
| 5 | Settings UI | Panneau réduit aux préférences locales : filtre Films/Séries/Tous, watchlist, langue. **Pas de credentials**. |
| 6 | i18n | Code i18n-ready (`t()` + `locales/fr.json`), FR seul livré. |
| 7 | Stack frontend | Vanilla JS + ES modules + CSS pur. Zéro dépendance runtime. Pas de build step. |
| 8 | Déploiement | Single container Node (Express sert static + proxy) + `docker-compose.yml`. |

---

## Section 1 — Architecture (✅ validée)

### Structure de fichiers

```
trailerswipe/
├── docker-compose.yml          # 1 service, 1 port
├── Dockerfile
├── .env.example
├── README.md
├── LICENSE                     # MIT
├── package.json                # express + dotenv only
├── server.js                   # ~80 lignes : static + /api/tmdb/* + /api/seerr/*
│
└── public/
    ├── index.html
    ├── manifest.json
    ├── sw.js
    ├── icons/
    │   ├── icon-192.svg
    │   └── icon-512.svg
    │
    ├── css/
    │   ├── tokens.css          # couleurs, fonts, espacements (design system)
    │   ├── reset.css
    │   ├── layout.css
    │   ├── cards.css
    │   ├── settings.css
    │   └── animations.css
    │
    └── js/
        ├── app.js              # bootstrap + routing onboarding/feed/settings
        ├── feed.js             # virtualisation + scroll snap + IntersectionObserver
        ├── card.js             # render d'une card
        ├── youtube.js          # lifecycle iframe API
        ├── settings.js         # panel settings (filtre, langue, watchlist)
        ├── toast.js
        ├── i18n.js
        ├── store.js            # état global (config user, requested set, watchlist)
        ├── locales/fr.json
        └── api/
            ├── tmdb.js         # appelle /api/tmdb/*
            └── seerr.js        # appelle /api/seerr/*
```

### Variables d'environnement

```env
# .env.example
TMDB_API_KEY=
SEERR_TYPE=overseerr           # ou jellyseerr
SEERR_URL=
SEERR_API_KEY=
PORT=3000                      # par défaut
```

### Flux runtime

```
[Browser]
   │
   ├─ /                            ──> Express static
   ├─ /api/tmdb/trending/all/week  ──> Express + clé TMDB ──> api.themoviedb.org
   └─ /api/seerr/api/v1/request    ──> Express + headers Seerr ──> Overseerr
```

### Déploiement utilisateur final

```bash
git clone trailerswipe && cd trailerswipe
cp .env.example .env             # remplir clés
docker compose up -d
# → app accessible sur :3000
```

### Modes dégradés

- `TMDB_API_KEY` manquante → le proxy démarre quand même (sinon impossible de servir l'écran d'erreur statique). `/api/tmdb/*` répond 503. `/api/health` renvoie `{ tmdb: false }` → le front affiche un écran d'erreur fullscreen "⚠️ Configuration manquante — `TMDB_API_KEY` à définir dans `.env`"
- `SEERR_*` manquantes → app en **mode trailer-browser only**, bouton "Je veux" caché. `/api/health` renvoie `{ seerr: false }`. Bannière discrète "Mode lecture seule".
- Service Worker en échec → app marche, pas de cache offline

---

## Section 2 — Composants & responsabilités (✅ validée)

### Backend

**`server.js`** — Express app
- Sert `public/` en static avec `Cache-Control` agressif sur assets versionnés
- `GET /api/tmdb/*` → forward vers `api.themoviedb.org/3/*`, ajoute `api_key` query param. Timeout 30s.
- `ALL /api/seerr/*` → forward vers `${SEERR_URL}/*`, injecte header `X-Api-Key`. Timeout 10s.
- `GET /api/health` → `{ tmdb: bool, seerr: bool }` (lit env vars uniquement, pas d'appel externe)
- Logs JSON line-by-line sur stdout

### Frontend

**`store.js`** — Source de vérité
- `state` : `{ config, feed, requestedIds: Set, watchlistIds: Set, currentIndex }`
- API : `getState()`, `subscribe(fn)`, `dispatch(action)`
- Mini-Redux maison (EventTarget). Persistance localStorage sur les actions concernées.

**`api/tmdb.js`** — Client TMDB
- `loadGenres()` → fetch `/genre/movie/list` et `/genre/tv/list` **une seule fois** au boot. Renvoie `Map<id, name>`. Évite N+1 appels.
- `fetchTrending(page, mediaTypeFilter)` → choisit l'endpoint selon le filtre :
  - `'all'` → `GET /trending/all/week`
  - `'movie'` → `GET /trending/movie/week`
  - `'tv'` → `GET /trending/tv/week`
- `fetchTrailerKey(mediaType, id)` → string YouTube key ou `null`. Préférence FR > EN > autre.
- Items normalisés depuis la réponse `/trending` (qui contient déjà overview, genre_ids, vote_average, year). Pas besoin d'appeler `/movie/{id}` ou `/tv/{id}` en plus.
- Filtre auto les items sans trailer YouTube (après `fetchTrailerKey`)
- Cache mémoire (Map) sur trailer keys déjà résolus

**`api/seerr.js`** — Client Seerr
- `requestMedia({ mediaType, mediaId })` → POST `/api/seerr/api/v1/request`
- `fetchMediaDetails(mediaType, id)` → GET `/api/seerr/api/v1/${mediaType}/${id}` → renvoie un objet riche contenant à la fois :
  - `mediaInfo.status` (pour détection "Disponible")
  - `releaseDates` (films) : array de `{ type, releaseDate, certification, iso_3166_1 }` — types : 1=Premiere, 2=Theatrical limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV
  - `firstAirDate` + `seasons[].airDate` + `nextEpisodeToAir` (séries)
  - Métadonnées enrichies en `fr-FR` si demandé
  - **Une seule requête couvre 2 besoins** : badge "Disponible" + popup dates de sortie
- Erreurs typées : `AlreadyRequestedError`, `UnreachableError`, `UnauthorizedError`, `NotConfiguredError`

**`youtube.js`** — Lifecycle des players
- `mountPlayer(containerEl, videoKey, { onReady })` → instance Player
- `unmountPlayer(instance)` → destroy iframe + retire listeners
- `play / pause / setMuted`
- État global `isMutedGlobally` partagé entre tous les players

**`feed.js`** — Cœur de l'app
- `<div class="feed">` avec `scroll-snap-type: y mandatory`
- Max 5 cards en DOM (window glissant `[i-2, i-1, i, i+1, i+2]`)
- IntersectionObserver (threshold 0.8) → play card visible, pause les autres
- Pré-fetch metadata items i+1, i+2, i+3
- Page TMDB suivante quand `currentIndex >= feed.length - 3`
- Mémorise `currentIndex` à l'ouverture de Settings, restore au retour

**`card.js`** — Render d'une card
- `createCard(item)` → DOM element complet
- Slots : video container, overlay textuel, action bar
- **Action bar** (5 boutons, fixed bottom) :
  - ❤️ "Je veux" (CTA principal, rouge Netflix)
  - 🔖 Watchlist (toggle, jaune si actif)
  - 📅 Dates de sortie (ouvre popup, voir ci-dessous)
  - 💬 Synopsis (toggle expanded/truncated)
  - ⭐ rating affiché en chip (pas un bouton, juste display)
- **Popup "Dates de sortie"** (sur tap 📅) :
  - Films : tableau des `releaseDates`, filtré sur région FR puis fallback US, regroupé par type (Cinéma, Numérique, Physique). Format date : `DD/MM/YYYY`.
  - Séries : `firstAirDate`, `lastAirDate`, et si `nextEpisodeToAir` → "Prochain épisode : DD/MM"
  - Si aucune date dispo → message "Aucune date disponible"
  - Bouton "✕" pour fermer
- Events émis : `card:request`, `card:watchlist`, `card:expand-synopsis`, `card:show-dates`

**`settings.js`** — Panel ⚙️
- Slide-from-right
- Contrôles :
  - Segmented "Films / Séries / Tous"
  - Toggle langue (i18n-ready)
  - Bouton "Voir ma watchlist" → ouvre une modale liste (poster + titre, tap = jump à la card dans le feed si encore en mémoire, sinon ouvre TMDB)
  - Bouton "Vider la watchlist" (avec confirmation)
  - Bouton "Installer l'app" (visible seulement si installable et pas déjà installé)
- Pas de credentials. Pas de Test Connection.
- Persistance localStorage debounced 300ms

**`toast.js`** — Notifications
- `toast(message, { variant, duration })`
- Stack au bas de l'écran

**`i18n.js`** — Traductions
- `loadLocale('fr')` au boot
- `t('key', { interpolation })`
- Si clé manquante → renvoie la clé (debug visible)

**`app.js`** — Bootstrap & routing
- Charge i18n, hydrate store, query `/api/health`
- Décide entre onboarding-error / feed normal / feed sans Seerr
- Branche keyboard shortcuts (Space/Up/Down/R/S)
- Enregistre le Service Worker

### Graphe de dépendances

```
app.js
  ├─> store.js
  ├─> i18n.js
  ├─> feed.js
  │     ├─> card.js
  │     ├─> youtube.js
  │     ├─> api/tmdb.js
  │     └─> api/seerr.js
  └─> settings.js
        └─> store.js

toast.js  ← invoqué depuis feed.js, settings.js, api/seerr.js
```

Aucune dépendance circulaire. Chaque module testable en isolation.

---

## Section 3 — Flux de données détaillés (✅ validée)

### A) Boot sequence

1. `index.html` charge → register SW → import `app.js`
2. `app.js` boot :
   - `i18n.loadLocale('fr')`
   - `store.hydrate()` : lit localStorage (préférences, watchlist, requestedIds)
   - `GET /api/health` → décide du mode :
     - `tmdb=true, seerr=true` → mode normal
     - `tmdb=true, seerr=false` → mode "browser only" (cache bouton "Je veux")
     - `tmdb=false` → écran d'erreur admin
3. `feed.init()` :
   - Skeleton shimmer fullscreen affiché immédiatement
   - Parallèle : `tmdb.loadGenres()` + `tmdb.fetchTrending(page=1, filter)`
   - Pour chaque item du trending : `fetchTrailerKey(item)` + (si Seerr) `seerr.fetchMediaDetails(item)` en parallèle
   - Filtre : retire items sans trailer YouTube
   - Stop dès qu'on a 5 items valides → `store.setFeed`
   - `feed.render()` monte les 5 cards
   - Card 0 visible → IntersectionObserver → autoplay muted

> **Skeleton à 2 niveaux** : (a) skeleton fullscreen au tout premier boot pendant le `fetchTrending` initial, (b) skeleton dans une card individuelle si elle apparaît dans le viewport avant que ses metadata (trailer key + mediaInfo Seerr) soient résolus.

### B) Scroll & virtualisation

User scroll ↓ → snap sur card N+1 → IntersectionObserver fire :
- Card N : pause + setMuted(true) (sécurité audio)
- Card N+1 : play + applique `isMutedGlobally`
- `dispatch({ type: 'SET_INDEX', index: N+1 })`
- Si `N+1 >= feed.length - 3` : `fetchTrending(page+1)` → append
- Window glissant :
  - Card N-3 : `unmountPlayer` + remove DOM
  - Card N+3 : `createCard` + `mountPlayer` (autoplay=false)
- Pré-fetch détails item N+2, N+3

Idée clé : iframes YouTube des cards N+1 et N+2 déjà montées (paused) → pas de blanc au snap.

### C) "Je veux" — request flow

User tap "Je veux" sur card N :
- `navigator.vibrate(50)` + animation pulse 200ms
- État optimiste : bouton "loading"
- `seerr.requestMedia({ mediaType, mediaId })`

Réponses :
- **201 Created** : `dispatch ADD_REQUESTED`, persiste localStorage, bouton → ✅ "Demandé !", toast succès
- **409 Conflict** (déjà demandé) : `dispatch ADD_REQUESTED`, bouton → "Déjà demandé"
- **401/403** : toast "Erreur auth Seerr (config admin)", bouton revient
- **5xx / timeout** : toast "Impossible de contacter Seerr", bouton revient

### D) Enrichissement Seerr (statut + dates de sortie)

Pour chaque item du feed (parallèle de `fetchTrailerKey`) :
- `seerr.fetchMediaDetails(mediaType, id)` (si Seerr configuré) → **un seul appel** :

  **Bloc 1 : Statut Disponibilité**
  - `mediaInfo.status >= 5` (AVAILABLE) → badge "Disponible" (vert), bouton "Je veux" caché
  - `mediaInfo.status === 3 || 4` (PROCESSING / PENDING) → badge "En cours"
  - `mediaInfo.status === 2` (PARTIALLY_AVAILABLE, séries) → badge "Partiel"
  - status absent / 404 → bouton "Je veux" normal
  - Erreur réseau → fallback bouton "Je veux" (silencieux)

  **Bloc 2 : Dates de sortie (films)**
  - `releaseDates` filtré FR > US > première dispo
  - Triés par type (Cinéma 3, Numérique 4, Physique 5)
  - Stockés sur l'item dans le store, affichés dans la popup au tap 📅

  **Bloc 2bis : Dates (séries)**
  - `firstAirDate`, `lastAirDate`, `nextEpisodeToAir.airDate` si disponible
  - Affichés dans la popup au tap 📅

L'objet item dans le store agrège : `{ tmdb, trailerKey, seerrStatus, dates }`.

### E) Settings change → propagation

User change filtre Films/Séries/Tous :
- `dispatch SET_FILTER` + persiste localStorage
- `feed.reset()` : unmount tous les players, vide DOM, reset index
- `feed.init()` avec nouveau filtre
- User reprend sur card 0 du nouveau filtre

### F) Persistance localStorage

| Clé | Contenu | Quand |
|---|---|---|
| `ts.preferences` | `{ filter, locale }` | Change Settings |
| `ts.requestedIds` | `string[]` | Succès `requestMedia` |
| `ts.watchlistIds` | `string[]` | Toggle bookmark |
| `ts.lastIndex` | `number` | `SET_INDEX` debounced 1s |

Aucune clé API, aucun credential côté navigateur.

---

## Section 4 — États d'erreur, vides, edge cases (✅ validée)

### États au boot

| Condition | Comportement |
|---|---|
| `TMDB_API_KEY` manquante (serveur) | Écran fullscreen "⚠️ Configuration manquante — `TMDB_API_KEY` à définir dans `.env`" |
| `SEERR_*` manquant | Mode browser-only : feed normal, bouton "Je veux" caché. Bannière discrète "Mode lecture seule" |
| TMDB API down | Skeleton → après 8s, "Connexion perdue" + "Réessayer" |
| Premier feed = 0 trailer | "Aucune bande-annonce disponible 🎬" + "Réessayer" |

### États runtime

| Condition | Comportement |
|---|---|
| Pagination échoue | Toast "Impossible de charger plus de trailers" + retry auto au prochain scroll |
| Trailer YouTube indisponible | onError → skip auto à la card suivante après 3s, toast discret |
| Seerr 401/403 sur "Je veux" | Toast "Erreur d'authentification (contacter l'admin)" |
| Seerr 5xx / timeout | Toast "Impossible de contacter Seerr", bouton revient |
| Network offline | Bannière haut écran "Hors ligne" + retry auto online |
| Service Worker fail | Silencieux. Pas de cache offline |
| localStorage indispo | Fallback en mémoire (Map) |

### Edge cases performance & UX

| Cas | Solution |
|---|---|
| Scroll très rapide | IntersectionObserver debounced 150ms côté play/pause |
| Tab out navigateur | `visibilitychange` → pause tous les players, resume au retour |
| iOS 100vh bug | `100dvh` avec fallback `100vh` |
| iOS autoplay restriction | Première card : tente autoplay, si bloqué → overlay "Tap pour démarrer" |
| Trailer non-FR | Préférence : trailer FR > EN > autre |
| User clear localStorage | Re-hydrate avec valeurs par défaut |
| YouTube API jamais chargée | Timeout 10s → "Le service YouTube est inaccessible" |

### États visuels d'une card

```
[Loading]   → skeleton shimmer
[Ready]     → poster/backdrop, video pas encore lancée
[Playing]   → video joue
[Paused]    → overlay play visible
[Error]     → message + bouton "Card suivante"
```

### Boutons "Je veux" — états

```
[default]    → "❤️ Je veux" (rouge Netflix)
[loading]    → spinner inline + désactivé
[requested]  → "✅ Demandé" (vert, désactivé permanent)
[available]  → "📀 Disponible" (gris, désactivé, tap → toast info)
[error]      → flash rouge → revient à [default] après 1s + toast
```

### PWA install — bouton dans Settings uniquement

Pas de banner, pas de prompt automatique. Bouton "Installer l'app" dans le panneau Settings :
- Détecte `display-mode: standalone` / `navigator.standalone` → bouton masqué (déjà installé)
- Chrome/Edge/Android avec `beforeinstallprompt` capturé → tap = `prompt()` natif
- iOS Safari → tap = tutoriel inline ("Tap l'icône Share → Sur l'écran d'accueil")
- Navigateur non-supporté → bouton désactivé + tooltip

### Keyboard shortcuts

| Touche | Action |
|---|---|
| `Space` | Play/pause card courante |
| `↑` / `↓` | Naviguer carte précédente/suivante |
| `M` | Toggle mute global |
| `R` | "Je veux" |
| `S` | Toggle Settings |
| `Escape` | Ferme Settings |

### Tests minimum (pour TDD)

- `store.js` — actions, dispatch, persistance
- `api/tmdb.js` — normalisation, filtre items sans trailer (mock fetch)
- `api/seerr.js` — typage erreurs (mock fetch)
- `i18n.js` — interpolation, clé manquante
- `server.js` — forward TMDB ajoute api_key, forward Seerr ajoute X-Api-Key, gestion env vars manquants, `/api/health` retourne le bon état

Modules très visuels (feed, card, youtube, settings) → tests manuels + smoke E2E plus tard si besoin.

---

## Considérations sécurité

**Le projet n'embarque pas d'authentification utilisateur.** TrailerSwipe est conçu pour être self-hosted, et la sécurité est déléguée à l'infrastructure d'hébergement.

**Risque principal :** si l'instance est exposée publiquement sans auth, n'importe quel visiteur peut envoyer des requêtes à Overseerr via le proxy (avec la clé admin Seerr). Conséquences possibles : pollution de la file de requests Seerr, abus de l'API TMDB.

**Recommandations dans le README :**
- Déployer derrière un reverse proxy avec authentification (Authelia, basic auth Traefik, Cloudflare Access, etc.)
- Ou exposer uniquement sur réseau local / VPN (Tailscale, Wireguard)
- Ne **jamais** committer le fichier `.env` (déjà dans `.gitignore` par défaut)

**Pas dans le scope v1 :**
- Auth intégrée (basic auth optionnelle, OAuth, magic link) — peut être ajouté plus tard si la communauté demande

**Côté code :**
- Le proxy fait du strict forwarding (pas d'eval, pas d'interpolation de chemin user-controlled)
- Headers Seerr (`X-Api-Key`) injectés côté serveur, jamais visibles côté navigateur
- Pas de cookies, pas de session — le proxy est stateless

---

## README — structure attendue

Le `README.md` doit contenir, dans l'ordre :

1. **Hero** : titre, tagline, GIF/screenshot
2. **Features** : 5-7 bullets visuels
3. **Quickstart** :
   ```bash
   git clone https://github.com/<user>/trailerswipe
   cd trailerswipe
   cp .env.example .env  # éditer les clés
   docker compose up -d
   ```
4. **Configuration** : tableau des variables d'environnement avec description et requis/optionnel
5. **Obtenir une clé TMDB** : lien vers `https://www.themoviedb.org/settings/api`
6. **Obtenir une clé Overseerr/Jellyseerr** : Settings → General → API Key
7. **Sécurité** : avertissement self-hosted (cf. section précédente)
8. **Dev local** :
   ```bash
   npm install
   npm run dev   # node --watch server.js
   npm test
   ```
9. **Roadmap** : i18n EN, watchlist sync, etc.
10. **Contributing** : link vers CONTRIBUTING.md (court, vibes)
11. **License** : MIT
12. **Credits** : TMDB, Overseerr, Jellyseerr, YouTube
