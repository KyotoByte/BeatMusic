# BeatMusic Web

A static music website by [KyotoByte](https://github.com/KyotoByte): Home, Browse, Radio, Library and Search,
a Liquid Glass interface, full Now Playing screen, queue, and time-synced lyrics. Better fork of
[BitChord](https://github.com/kushagrasinghx/BitChord). Licensed GPL-3.0 (see `LICENSE.txt`).

No build step, no server, no API keys. Plain HTML/CSS/ES modules, all paths relative, so it works from
`https://kyotobyte.github.io/BeatMusic/`.

## Deploy on GitHub Pages (free)

Option A, branch: put the contents of this `site/` folder in a `docs/` folder on `main` (or at the root of a
`gh-pages` branch), then in the repo go to Settings → Pages → Build and deployment → Source "Deploy from a
branch" and pick that branch and folder.

Option B, Actions: keep it in `site/` and add `.github/workflows/pages.yml` that uses
`actions/upload-pages-artifact` with `path: site` followed by `actions/deploy-pages`, then set Settings → Pages
→ Source to "GitHub Actions".

Keep `.nojekyll` (stops Jekyll from touching files) and `404.html` (sends unknown paths back to the app).
Routes use `#/…`, so deep links work without any server rules.

## Where things come from (all called straight from the browser)

| What | Source | How |
|---|---|---|
| Search, albums, artists, Deezer charts, editorial playlists, artist mixes | Deezer public API | JSONP (it sends no CORS header) |
| Regional top songs / albums, genre charts, album lookups | iTunes RSS + Lookup | CORS |
| Full songs | YouTube IFrame Player API (official embed) | video id found through public Piped instances (CORS); several instances are tried with timeouts and the one that answers is remembered |
| Fallback audio | 30-second previews from Deezer/iTunes | shown with a "Preview" label |
| Lyrics | LRCLIB (`/api/get`, `/api/search`) | CORS; synced LRC when available, plain text otherwise |

## Honest limits

- Public Piped instances come and go. If none answers, songs fall back to 30-second previews (labelled).
  The instance list is in `js/youtube.js`; add new ones there.
- Some videos have embedding turned off by their owner (YouTube error 101/150). The player then tries the next
  candidate video, and finally the preview.
- On phones, browsers usually pause an embedded YouTube player when the screen locks or the tab goes to the
  background. Lock-screen controls (Media Session) are set, but background play isn't guaranteed on the web.
- Radio stations are built from Deezer's public artist mix + similar artists, or a regional genre chart, shuffled.
  It is not a personal recommendation algorithm.
- Library (likes, playlists, history) is stored in this browser only (localStorage).
- YouTube's terms expect the player to be visible: the video is in Now Playing behind the Video button.

## Files

`index.html`, `css/app.css`, `js/app.js` (views, router, UI), `js/player.js` (YouTube + preview engine, queue,
Media Session), `js/youtube.js` (video id finder), `js/lyrics.js` (LRCLIB + synced lyrics view), `js/api.js`
(Deezer/iTunes), `js/store.js` (localStorage), `sw.js` (offline shell), `manifest.webmanifest`, `icons/`,
`404.html`, `.nojekyll`, `LICENSE.txt`.

Keyboard: Space/K play-pause, J/L ±10 s, Shift+←/→ previous/next, / search, Esc closes Now Playing.
