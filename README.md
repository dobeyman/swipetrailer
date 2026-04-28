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
