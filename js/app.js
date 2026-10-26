import * as api from './api.js';
import { library, onLibrary, store } from './store.js';
import { Player } from './player.js';
import { LyricsView } from './lyrics.js';
import { resolverStatus } from './youtube.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const icon = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isPhone = () => matchMedia('(max-width:760px)').matches;
const COUNTRY_NAMES = { in: 'India', us: 'US', gb: 'UK', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', jp: 'Japan', br: 'Brazil', mx: 'Mexico', es: 'Spain', it: 'Italy', kr: 'Korea', id: 'Indonesia', ph: 'Philippines', ng: 'Nigeria', za: 'South Africa', ae: 'UAE', pk: 'Pakistan', np: 'Nepal', bd: 'Bangladesh', lk: 'Sri Lanka', sg: 'Singapore', my: 'Malaysia' };
const cname = () => COUNTRY_NAMES[api.country()] || api.country().toUpperCase();

const player = new Player($('#audio'));
window.__bm = { player, api }; // handy for debugging in the console

// ---------------- toast ----------------
let toastT;
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.hidden = false; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200);
}
player.addEventListener('toast', (e) => toast(e.detail));

// ---------------- image fade-in ----------------
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.removeAttribute('data-loading'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') { e.target.removeAttribute('data-loading'); e.target.style.visibility = 'hidden'; } }, true);
const img = (url, size, alt = '') => url ? `<img src="${esc(api.art(url, size))}" ${size >= 200 ? `srcset="${esc(api.art(url, size * 2))} 2x"` : ''} alt="${esc(alt)}" loading="lazy" decoding="async" data-loading>` : '';

// ---------------- list registry (event delegation) ----------------
let lists = {}; let listN = 0;
const reg = (tracks) => { const k = 'l' + (++listN); lists[k] = tracks; return k; };
const eqBars = '<span class="eq"><i></i><i></i><i></i></span>';
function trackRow(t, i, key, opts = {}) {
  const lead = opts.index ? `<span class="idx">${i + 1}</span>` : `<span class="art">${img(t.artwork, 100)}${eqBars}</span>`;
  return `<div class="trow" role="button" tabindex="0" data-list="${key}" data-i="${i}" data-id="${esc(t.id)}" aria-label="${esc(t.title + ', ' + t.artist)}">
    ${lead}<span class="tm"><div class="t">${esc(t.title)}${t.explicit ? '<span class="explicit" title="Explicit">E</span>' : ''}</div><div class="s">${esc(opts.sub ? opts.sub(t) : t.artist)}</div></span>
    <button class="more" data-more aria-label="More options for ${esc(t.title)}">${icon('more')}</button></div>`;
}
const trackList = (tracks, opts = {}) => { const k = reg(tracks); return `<div class="list">${tracks.map((t, i) => trackRow(t, i, k, opts)).join('')}</div>`; };
const trackShelf = (tracks) => { const k = reg(tracks); return `<div class="shelf tracks">${tracks.map((t, i) => trackRow(t, i, k)).join('')}</div>`; };
function songCards(tracks) {
  const k = reg(tracks);
  return `<div class="shelf">${tracks.map((t, i) => `<div class="card" role="button" tabindex="0" data-list="${k}" data-i="${i}" aria-label="Play ${esc(t.title)}">
    <div class="art">${img(t.artwork, 300)}<span class="play-platter">${icon('play')}</span></div><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)}</div></div>`).join('')}</div>`;
}
const songsN = (n) => `${n} ${+n === 1 ? 'song' : 'songs'}`;
// Artists of a song chart (iTunes has no artist photos, so the song's artwork stands in).
function topArtistsFrom(songs, max = 16) {
  const seen = new Set(); const out = [];
  for (const t of songs) {
    const name = (t.artist || '').split(/,| & | feat\.? | ft\.? /i)[0].trim(); const k = name.toLowerCase();
    if (!name || seen.has(k)) continue; seen.add(k);
    const id = t.artistId && t.artistId.length > 3 ? t.artistId : 'it:';
    out.push({ id, name, artwork: t.artwork, href: `#/artist/${esc(id)}?name=${encodeURIComponent(name)}` });
    if (out.length >= max) break;
  }
  return out;
}
const albumCard = (a) => `<a class="card" href="#/album/${esc(a.id)}"><div class="art">${img(a.artwork, 300)}</div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.artist || a.year || '')}</div></a>`;
const albumShelf = (as) => `<div class="shelf">${as.map(albumCard).join('')}</div>`;
const artistCard = (a, href) => `<a class="card circle" href="${href || '#/artist/' + esc(a.id)}"><div class="art">${img(a.artwork, 300)}</div><div class="t">${esc(a.name)}</div></a>`;
const artistShelf = (as) => `<div class="shelf circles">${as.map((a) => artistCard(a, a.href)).join('')}</div>`;
const skel = (kind = 'cards') => kind === 'list' ? `<div class="list">${'<div class="trow"><span class="art skeleton"></span><span class="tm"><div class="t skeleton" style="width:60%;height:12px;border-radius:4px"></div></span></div>'.repeat(6)}</div>`
  : `<div class="shelf">${'<div class="card"><div class="art skeleton"></div><div class="t skeleton" style="height:10px;width:70%;border-radius:4px"></div></div>'.repeat(6)}</div>`;
const section = (id, title, sub = '', link = '') => `<section class="section" id="${id}"><div class="section-head"><h2>${title}${link ? icon('chev-right') : ''}</h2>${sub ? `<span class="note">${sub}</span>` : ''}</div><div class="sbody">${skel()}</div></section>`;
async function fill(view, id, fn, kind) {
  const el = $('#' + id + ' .sbody', view); if (!el) return;
  if (kind) el.innerHTML = skel(kind);
  try {
    const html = await fn();
    if (!el.isConnected) return;
    if (html === null) { el.closest('.section').remove(); return; }
    el.innerHTML = html;
  } catch (e) {
    if (!el.isConnected) return;
    el.innerHTML = `<p class="err">Couldn’t load this (${esc(e.message)}).<button data-retry>Try again</button></p>`;
    el.querySelector('[data-retry]').onclick = () => fill(view, id, fn, kind);
  }
}

// ---------------- router ----------------
const routes = {};
const route = (name, fn) => { routes[name] = fn; };
let navToken = 0;
async function render() {
  const raw = location.hash.slice(2) || 'home';
  const [pathPart, qs] = raw.split('?');
  const [name, ...rest] = pathPart.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const params = new URLSearchParams(qs || '');
  const tok = ++navToken;
  const view = $('#view');
  lists = {};
  const tab = { home: 'home', browse: 'browse', genre: 'browse', dzplaylist: 'browse', radio: 'radio', library: 'library', liked: 'liked', recent: 'recent', playlist: 'library', search: 'search', settings: 'settings' }[name] || '';
  $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab || (tab === 'liked' || tab === 'recent' || tab === 'settings') && a.dataset.tab === 'library' && a.closest('.tabs')));
  $$('.side-playlists a').forEach((a) => a.classList.toggle('active', name === 'playlist' && a.dataset.pid === arg));
  movePill();
  const fn = routes[name] || routes.home;
  view.classList.remove('enter'); void view.offsetWidth; if (!reduceMotion.matches) view.classList.add('enter');
  window.scrollTo(0, 0);
  try { await fn(view, arg, params, () => tok === navToken); } catch (e) { console.error(e); view.innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`; }
  if (name !== 'search') $('#main').focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);
const head = (title, sub = '', right = '') => `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</header>`;
const backBtn = () => `<button class="back" data-back>${icon('back')}Back</button>`;

// ---------------- views ----------------
route('home', (v) => {
  const recent = library.recent();
  v.innerHTML = head('Home', `Top charts for ${esc(cname())} · updated live`) +
    section('h-picks', 'Top Picks') + (recent.length ? `<section class="section"><div class="section-head"><h2>Recently Played</h2><a class="link" href="#/recent">See All</a></div>${songCards(recent.slice(0, 12))}</section>` : '') +
    section('h-songs', `Top Songs · ${esc(cname())}`) + section('h-albums', 'Top Albums') + section('h-global', 'Global Hits', 'Deezer chart') + section('h-artists', 'Popular Artists');
  fill(v, 'h-picks', async () => {
    const t = (await api.topSongs(null, 50)).slice(0, 8); const k = reg(t);
    return `<div class="shelf hero">${t.map((s, i) => `<div class="card hero-card" role="button" tabindex="0" data-list="${k}" data-i="${i}" aria-label="Play ${esc(s.title)}">
      <div class="eyebrow">#${i + 1} in ${esc(cname())}${s.genre ? ' · ' + esc(s.genre) : ''}</div><div class="ht">${esc(s.title)}</div>
      <div class="art">${img(s.artwork, 600)}<div class="cap"><b>${esc(s.artist)}</b>${esc(s.album || '')}</div><span class="play-platter">${icon('play')}</span></div></div>`).join('')}</div>`;
  });
  fill(v, 'h-songs', async () => trackShelf((await api.topSongs(null, 50)).slice(8, 40)));
  fill(v, 'h-albums', async () => albumShelf(await api.topAlbums(null, 24)));
  const chart = api.deezerChart();
  chart.catch(() => {});
  // Deezer-only shelves: hidden (not an error) on networks where Deezer doesn't answer.
  fill(v, 'h-global', async () => { try { const t = (await chart).tracks; return t.length ? trackShelf(t.slice(0, 24)) : null; } catch { return null; } });
  // Popular Artists: Deezer's chart (with photos), else the artists of this country's top songs.
  fill(v, 'h-artists', async () => {
    let as = []; try { as = (await chart).artists; } catch { /* Deezer unavailable */ }
    if (!as.length) as = topArtistsFrom(await api.topSongs(null, 50).catch(() => []));
    return as.length ? artistShelf(as) : null;
  });
});

route('browse', (v) => {
  v.innerHTML = head('Browse') + section('b-new', 'New & Popular Albums') +
    `<section class="section"><div class="section-head"><h2>Browse by Genre</h2></div><div class="bricks">${api.GENRES.map((g) => `<a class="brick" href="#/genre/${g.id}" style="--c1:${g.c1};--c2:${g.c2}">${esc(g.name)}</a>`).join('')}</div></section>` +
    section('b-pl', 'Editorial Playlists', 'from Deezer');
  fill(v, 'b-new', async () => albumShelf(await api.topAlbums(null, 30)));
  fill(v, 'b-pl', async () => {
    let pl; try { pl = (await api.deezerChart()).playlists; } catch { return null; } // hidden where Deezer has no catalog
    if (!pl.length) return null;
    return `<div class="shelf">${pl.map((p) => `<a class="card" href="#/dzplaylist/${p.id}"><div class="art">${img(p.picture_xl || p.picture_big, 300)}</div><div class="t">${esc(p.title)}</div><div class="s">${songsN(p.nb_tracks)}</div></a>`).join('')}</div>`;
  });
});

route('genre', async (v, id) => {
  const g = api.GENRES.find((x) => String(x.id) === id) || { name: 'Genre' };
  v.innerHTML = backBtn() + head(g.name, `Top songs in ${esc(cname())}`, `<div class="coll-actions" style="display:flex;gap:10px"><button class="pill" id="g-play">${icon('play')}Play</button><button class="pill ghost" id="g-shuf">${icon('shuffle')}Shuffle</button></div>`) +
    section('g-songs', 'Top Songs') + section('g-albums', 'Top Albums');
  let songs = [];
  $('#g-play', v).onclick = () => songs.length && player.playList(songs, 0, { shuffle: false });
  $('#g-shuf', v).onclick = () => songs.length && player.playList(songs, (Math.random() * songs.length) | 0, { shuffle: true });
  fill(v, 'g-songs', async () => { songs = await api.topSongs(id, 50); return songs.length ? `<div class="cols2">${trackList(songs, { sub: (t) => t.artist })}</div>` : '<p class="err">No chart for this genre in your region.</p>'; }, 'list');
  fill(v, 'g-albums', async () => { const a = await api.topAlbums(id, 24); return a.length ? albumShelf(a) : null; });
});

route('dzplaylist', async (v, id) => {
  v.innerHTML = backBtn() + '<div class="sbody">' + skel('list') + '</div>';
  let p; try { p = await api.deezerPlaylist(id); } catch (e) { v.innerHTML = backBtn() + `<div class="empty"><h3>Playlist unavailable</h3><p>${esc(e.message)}</p></div>`; return; }
  collection(v, { title: p.title, by: p.artist, meta: `${songsN(p.tracks.length)} · Playlist`, artwork: p.artwork, tracks: p.tracks });
});

function collection(v, c) {
  const k = reg(c.tracks);
  v.innerHTML = backBtn() + `<div class="coll ${c.round ? 'artist' : ''}"><div class="art">${img(c.artwork, 600)}</div><div>
    <h1>${esc(c.title)}</h1>${c.by ? `<div class="by">${c.byHref ? `<a href="${c.byHref}">${esc(c.by)}</a>` : esc(c.by)}</div>` : ''}<div class="meta">${esc(c.meta || '')}</div>
    <div class="actions"><button class="pill" data-playall="${k}">${icon('play')}Play</button><button class="pill ghost" data-shuffleall="${k}">${icon('shuffle')}Shuffle</button>${c.extra || ''}</div></div></div>
    <section class="section">${c.tracks.length ? trackList(c.tracks, { index: c.index, sub: c.sub }).replace(/data-list="l\d+"/g, `data-list="${k}"`) : '<div class="empty"><h3>No songs yet</h3><p>Use ⋯ → Add to Playlist on any song.</p></div>'}</section>${c.after || ''}`;
}

route('album', async (v, id) => {
  v.innerHTML = backBtn() + skel('list');
  let a; try { a = await api.album(id); } catch (e) { v.innerHTML = backBtn() + `<div class="empty"><h3>Album unavailable</h3><p>${esc(e.message)}</p><p><button class="pill" onclick="location.reload()">Try Again</button></p></div>`; return; }
  collection(v, { title: a.title, by: a.artist, byHref: a.artistId ? `#/artist/${a.artistId}?name=${encodeURIComponent(a.artist)}` : '', meta: [a.genre, a.year, a.count && `${songsN(a.count)}`].filter(Boolean).join(' · '), artwork: a.artwork, tracks: a.tracks, index: true, sub: (t) => fmt(t.duration) });
});

route('artist', async (v, id, params) => {
  v.innerHTML = backBtn() + skel('list');
  let a; try { a = await api.artist(id, params.get('name')); } catch (e) { v.innerHTML = backBtn() + `<div class="empty"><h3>Artist unavailable</h3><p>${esc(e.message)}</p><p><button class="pill" onclick="location.reload()">Try Again</button></p></div>`; return; }
  const albums = a.albums;
  collection(v, { title: a.name, round: true, meta: a.fans ? `${a.fans.toLocaleString()} fans` : 'Artist', artwork: a.artwork, tracks: a.top.slice(0, 10),
    extra: `<button class="pill ghost" data-station-artist="${esc(a.id)}" data-name="${esc(a.name)}">${icon('radio')}Station</button>`,
    after: (albums.length ? `<section class="section"><div class="section-head"><h2>Albums</h2></div>${albumShelf(albums)}</section>` : '') +
      (a.related.length ? `<section class="section"><div class="section-head"><h2>Similar Artists</h2></div>${artistShelf(a.related)}</section>` : '') });
  v.querySelector('.coll+.section')?.insertAdjacentHTML('afterbegin', '<div class="section-head"><h2>Top Songs</h2></div>');
});

route('radio', (v) => {
  const seeds = [...library.liked(), ...library.recent()];
  const artists = [...new Map(seeds.filter((t) => t.artist).map((t) => [t.artist.toLowerCase(), t])).values()].slice(0, 10);
  const seed = seeds[0];
  v.innerHTML = head('Radio') + `<div class="station-hero"><svg class="waves" viewBox="0 0 24 24"><use href="#i-radio"/></svg>
    <h2>Your Station</h2><p>${seed ? `Songs like <b>${esc(seed.artist)}</b> and the artists you play, mixed with similar artists.` : `Start with what’s hot in ${esc(cname())} — like or play songs and this station follows your taste.`}</p>
    <div><button class="pill" id="r-mine">${icon('play')}Play Your Station</button></div></div>` +
    (artists.length ? `<section class="section"><div class="section-head"><h2>From Your Library</h2><span class="note">Artist stations</span></div><div class="shelf circles">${artists.map((t) => `<button class="card circle" data-station-name="${esc(t.artist)}"><div class="art">${img(t.artwork, 300)}</div><div class="t">${esc(t.artist)}</div></button>`).join('')}</div></section>` : '') +
    section('r-art', 'Artist Stations', 'popular right now') +
    `<section class="section"><div class="section-head"><h2>Genre Stations</h2><span class="note">${esc(cname())} charts, shuffled</span></div><div class="bricks">${api.GENRES.slice(0, 12).map((g) => `<button class="brick" data-station-genre="${g.id}" data-name="${esc(g.name)}" style="--c1:${g.c1};--c2:${g.c2}">${esc(g.name)} Radio</button>`).join('')}</div></section>
    <p class="note-box">How stations work: an artist station mixes that artist’s public “artist mix” from Deezer with top songs of similar artists; a genre station is today’s genre chart for your region, shuffled. It isn’t a personal recommendation algorithm.</p>`;
  $('#r-mine', v).onclick = async () => {
    if (seed) return startStation({ name: seed.artist });
    toast('Starting radio…'); const t = await api.topSongs(null, 50); player.playList(api.shuffleUnique(t), 0, { shuffle: false });
  };
  fill(v, 'r-art', async () => {
    try { return `<div class="shelf circles">${(await api.deezerChart()).artists.map((a) => `<button class="card circle" data-station-artist="${esc(a.id)}" data-name="${esc(a.name)}"><div class="art">${img(a.artwork, 300)}</div><div class="t">${esc(a.name)} Radio</div></button>`).join('')}</div>`; } catch {
      const seen = new Set(); const top = (await api.topSongs(null, 50)).filter((t) => t.artist && !seen.has(t.artist) && seen.add(t.artist)).slice(0, 12);
      return `<div class="shelf circles">${top.map((t) => `<button class="card circle" data-station-name="${esc(t.artist)}"><div class="art">${img(t.artwork, 300)}</div><div class="t">${esc(t.artist)} Radio</div></button>`).join('')}</div>`;
    }
  });
});
async function startStation({ name, id, genre, label }) {
  toast(`Starting ${label || name} Radio…`);
  try {
    const tracks = genre ? await api.genreStation(genre) : await api.artistStation(name, id);
    if (!tracks.length) throw new Error('empty');
    player.playList(tracks, 0, { shuffle: false });
  } catch { toast('Couldn’t build that station right now'); }
}

route('library', (v) => {
  const pls = library.playlists(); const liked = library.liked(); const recent = library.recent();
  v.innerHTML = head('Library', '', `<button class="pill ghost" id="new-pl">${icon('plus')}New Playlist</button>`) +
    `<div class="group" style="max-width:640px">
      <a class="row" href="#/liked"><span style="display:flex;gap:12px;align-items:center"><span style="color:var(--accent)">${icon('heart-fill')}</span>Liked Songs</span><span class="sub" style="color:var(--text-2)">${liked.length}</span></a>
      <a class="row" href="#/recent"><span style="display:flex;gap:12px;align-items:center"><span style="color:var(--accent)">${icon('queue')}</span>Recently Played</span><span style="color:var(--text-2)">${recent.length}</span></a>
      <a class="row" href="#/settings"><span style="display:flex;gap:12px;align-items:center"><span style="color:var(--accent)">${icon('gear')}</span>Settings</span>${icon('chev-right')}</a></div>` +
    `<section class="section"><div class="section-head"><h2>Playlists</h2></div>${pls.length ? `<div class="shelf">${pls.map((p) => `<a class="card" href="#/playlist/${p.id}"><div class="art">${p.tracks[0] ? img(p.tracks[0].artwork, 300) : `<div style="display:grid;place-items:center;height:100%;color:var(--accent)">${icon('queue')}</div>`}</div><div class="t">${esc(p.name)}</div><div class="s">${songsN(p.tracks.length)}</div></a>`).join('')}</div>` : '<p class="err">No playlists yet. Create one, then add songs with ⋯ → Add to Playlist.</p>'}</section>` +
    (recent.length ? `<section class="section"><div class="section-head"><h2>Recently Played</h2></div>${songCards(recent.slice(0, 15))}</section>` : '') +
    (liked.length ? `<section class="section"><div class="section-head"><h2>Liked Songs</h2></div>${trackShelf(liked.slice(0, 24))}</section>` : '') +
    (!liked.length && !recent.length ? '<div class="empty"><h3>Your library is empty</h3><p>Tap ♥ on a song in Now Playing to like it. Songs you play show up here too.</p></div>' : '');
  $('#new-pl', v).onclick = newPlaylist;
});
function newPlaylist(track) {
  const name = prompt('Playlist name', 'My Playlist'); if (!name) return null;
  const p = library.createPlaylist(name.trim().slice(0, 80), track && track.id ? [track] : []);
  toast(track && track.id ? `Added to “${p.name}”` : `Created “${p.name}”`);
  if (location.hash.startsWith('#/library')) render();
  return p;
}
route('liked', (v) => { const l = library.liked(); collection(v, { title: 'Liked Songs', meta: `${songsN(l.length)}`, artwork: l[0]?.artwork, tracks: l }); });
route('recent', (v) => { const l = library.recent(); collection(v, { title: 'Recently Played', meta: `${songsN(l.length)}`, artwork: l[0]?.artwork, tracks: l, extra: l.length ? '<button class="pill ghost" id="clr-recent">Clear</button>' : '' }); const c = $('#clr-recent', v); if (c) c.onclick = () => { library.clearRecent(); render(); }; });
route('playlist', (v, id) => {
  const p = library.playlist(id); if (!p) { v.innerHTML = backBtn() + '<div class="empty"><h3>Playlist not found</h3></div>'; return; }
  collection(v, { title: p.name, meta: `${songsN(p.tracks.length)} · Playlist`, artwork: p.tracks[0]?.artwork, tracks: p.tracks,
    extra: `<button class="pill ghost" id="pl-ren">Rename</button><button class="pill ghost" id="pl-del">Delete</button>` });
  $$('.trow', v).forEach((r) => { r.dataset.playlist = id; });
  $('#pl-ren', v).onclick = () => { const n = prompt('Rename playlist', p.name); if (n) { library.renamePlaylist(id, n.trim().slice(0, 80)); render(); } };
  $('#pl-del', v).onclick = () => { if (confirm(`Delete “${p.name}”?`)) { library.deletePlaylist(id); location.hash = '#/library'; } };
});

// ---------- search ----------
let searchTimer, lastQ = '';
route('search', (v, _a, params) => {
  const q = params.get('q') || '';
  v.innerHTML = (isPhone() ? head('Search') : '<div style="height:24px"></div>') + `<div class="search-bar"><label class="search-field">${icon('search')}<input id="q" type="search" enterkeyhint="search" placeholder="Artists, songs, albums" autocomplete="off" aria-label="Search" value="${esc(q)}"></label></div><div id="sres"></div>`;
  const input = $('#q', v);
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setQ(input.value), 380); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); setQ(input.value); input.blur(); } });
  if (!isPhone() || q) setTimeout(() => input.focus({ preventScroll: true }), 50);
  doSearch(q);
});
function setQ(q) {
  const h = '#/search' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '');
  history.replaceState(null, '', h); $('#side-search').value = q; doSearch(q.trim());
}
async function doSearch(q) {
  const box = $('#sres'); if (!box) return;
  lastQ = q;
  if (!q) {
    const rec = store.get('searches', []);
    box.innerHTML = (rec.length ? `<section class="section"><div class="section-head"><h2>Recent Searches</h2><button class="link" id="clr-s">Clear</button></div><div class="chips">${rec.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></section>` : '') +
      `<section class="section"><div class="section-head"><h2>Browse Categories</h2></div><div class="bricks">${api.GENRES.map((g) => `<a class="brick" href="#/genre/${g.id}" style="--c1:${g.c1};--c2:${g.c2}">${esc(g.name)}</a>`).join('')}</div></section>`;
    $$('[data-q]', box).forEach((b) => b.onclick = () => { $('#q').value = b.dataset.q; setQ(b.dataset.q); });
    const c = $('#clr-s', box); if (c) c.onclick = () => { store.set('searches', []); doSearch(''); };
    return;
  }
  box.innerHTML = `<section class="section">${skel('list')}</section>`;
  let r;
  try { r = await api.search(q); } catch (e) {
    if (lastQ !== q || !box.isConnected) return;
    box.innerHTML = `<div class="empty"><h3>Search isn’t reachable</h3><p>${esc(e.message)}</p><p><button class="pill" id="s-retry">Try Again</button></p></div>`;
    $('#s-retry', box).onclick = () => doSearch(q); return;
  }
  if (lastQ !== q || !box.isConnected) return;
  store.set('searches', [q, ...store.get('searches', []).filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 8));
  lists = {};
  if (!r.tracks.length && !r.albums.length && !r.artists.length) { box.innerHTML = `<div class="empty"><h3>No Results</h3><p>Nothing found for “${esc(q)}”. Try a different spelling.</p></div>`; return; }
  const topArtist = r.topArtist; const k = reg(r.tracks);
  const top = [];
  if (topArtist) top.push(`<a class="top-card circle" href="#/artist/${esc(topArtist.id)}"><div class="art">${img(topArtist.artwork, 200)}</div><div style="min-width:0"><div class="t">${esc(topArtist.name)}</div><div class="s">Artist</div></div></a>`);
  r.tracks.slice(0, topArtist ? 2 : 3).forEach((t, i) => top.push(`<div class="top-card" role="button" tabindex="0" data-list="${k}" data-i="${i}"><div class="art">${img(t.artwork, 200)}</div><div style="min-width:0"><div class="t">${esc(t.title)}</div><div class="s">Song · ${esc(t.artist)}</div></div></div>`));
  box.innerHTML = `<section class="section"><div class="section-head"><h2>Top Results</h2></div><div class="top-results">${top.join('')}</div></section>` +
    (r.tracks.length ? `<section class="section"><div class="section-head"><h2>Songs</h2></div><div class="cols2">${r.tracks.map((t, i) => trackRow(t, i, k)).join('')}</div></section>` : '') +
    (r.albums.length ? `<section class="section"><div class="section-head"><h2>Albums</h2></div>${albumShelf(r.albums)}</section>` : '') +
    (r.artists.length ? `<section class="section"><div class="section-head"><h2>Artists</h2></div>${artistShelf(r.artists)}</section>` : '');
}
$('#side-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = e.target.value.trim(); location.hash = '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''); } });
$('#side-search').addEventListener('input', (e) => { if (location.hash.startsWith('#/search')) { const i = $('#q'); if (i) { i.value = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => setQ(e.target.value), 380); } } });

// ---------- settings ----------
route('settings', (v) => {
  const cur = api.country();
  v.innerHTML = head('Settings') + `<div class="settings">
    <h3 class="side-head" style="margin-left:4px">Music</h3><div class="group">
      <label class="row"><span>Region<small>Which country’s charts Home and Browse show</small></span><select id="cc">${Object.entries(COUNTRY_NAMES).map(([c, n]) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${n}</option>`).join('')}${COUNTRY_NAMES[cur] ? '' : `<option selected value="${cur}">${cur.toUpperCase()}</option>`}</select></label>
      <div class="row"><span>Full songs<small>Played through the official YouTube embedded player. If a song can’t be embedded, a 30-second preview plays and is labelled “Preview”.</small></span></div>
      <div class="row"><span>Lyrics<small>Time-synced lyrics from LRCLIB (community database)</small></span></div>
      <div class="row"><span>Song info &amp; charts<small>Deezer and iTunes public catalogues</small></span></div>
      <div class="row"><span>Video finder<small id="inst">${esc(resolverStatus.instance ? new URL(resolverStatus.instance).host : 'not used yet')}</small></span></div>
    </div>
    <h3 class="side-head" style="margin-left:4px">Library</h3><div class="group">
      <div class="row"><span>Stored on this device only<small>Liked songs, playlists and history live in this browser. Clearing site data removes them.</small></span></div>
      <div class="row"><span>Clear all library data</span><button class="link" id="wipe">Clear</button></div>
    </div>
    <h3 class="side-head" style="margin-left:4px">About</h3><div class="group">
      <div class="row"><span>BeatMusic Web<small>Version 1.0</small></span></div>
      <div class="row"><span>Developer</span><a href="https://github.com/KyotoByte" target="_blank" rel="noopener">KyotoByte</a></div>
      <div class="row"><span>Licence</span><a href="LICENSE.txt" target="_blank" rel="noopener">GPL-3.0</a></div>
    </div></div>`;
  $('#cc', v).onchange = (e) => { api.setCountry(e.target.value); toast('Region updated'); };
  $('#wipe', v).onclick = () => { if (confirm('Remove liked songs, playlists and history from this browser?')) { library.clearAll(); toast('Library cleared'); } };
});

// ---------------- global click delegation ----------------
document.addEventListener('click', (e) => {
  const back = e.target.closest('[data-back]'); if (back) { history.length > 1 ? history.back() : (location.hash = '#/home'); return; }
  const more = e.target.closest('[data-more]');
  if (more) { e.stopPropagation(); const row = more.closest('[data-list]'); const t = lists[row.dataset.list]?.[+row.dataset.i]; if (t) trackMenu(t, more, { playlist: row.dataset.playlist, index: +row.dataset.i }); return; }
  const pa = e.target.closest('[data-playall]'); if (pa) { const l = lists[pa.dataset.playall]; if (l?.length) player.playList(l, 0, { shuffle: false }); return; }
  const sa = e.target.closest('[data-shuffleall]'); if (sa) { const l = lists[sa.dataset.shuffleall]; if (l?.length) player.playList(l, (Math.random() * l.length) | 0, { shuffle: true }); return; }
  const st = e.target.closest('[data-station-artist]'); if (st) { startStation({ id: st.dataset.stationArtist, name: st.dataset.name }); return; }
  const sn = e.target.closest('[data-station-name]'); if (sn) { startStation({ name: sn.dataset.stationName }); return; }
  const sg = e.target.closest('[data-station-genre]'); if (sg) { startStation({ genre: sg.dataset.stationGenre, label: sg.dataset.name }); return; }
  const row = e.target.closest('[data-list][data-i]');
  if (row && !e.target.closest('a,button:not([data-list])')) { const l = lists[row.dataset.list]; if (l) player.playList(l, +row.dataset.i, { shuffle: false }); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-list]')) { e.preventDefault(); e.target.click(); }
});

// ---------------- menus ----------------
let menuReturn = null;
function showMenu(anchor, items) {
  const m = $('#menu'); const scrim = $('#menu-scrim');
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.head ? `<div class="mh">${esc(it.head)}</div>` : `<button role="menuitem" data-mi="${i}">${esc(it.label)}${it.icon ? icon(it.icon) : ''}</button>`).join('');
  m.hidden = false; scrim.hidden = false; menuReturn = anchor;
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = Math.min(window.innerWidth - mw - 12, Math.max(12, r.right - mw)); let y = r.bottom + 6;
  if (y + mh > window.innerHeight - 12) y = Math.max(12, r.top - mh - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.style.setProperty('--ox', (r.left + r.width / 2 - x) + 'px'); m.style.setProperty('--oy', (y > r.top ? 0 : mh) + 'px');
  m.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; const it = items[+b.dataset.mi]; closeMenu(); it.action?.(); };
  m.querySelector('button')?.focus();
}
function closeMenu() { $('#menu').hidden = true; $('#menu-scrim').hidden = true; menuReturn?.focus?.({ preventScroll: true }); menuReturn = null; }
$('#menu-scrim').addEventListener('click', closeMenu);
$('#menu').addEventListener('keydown', (e) => {
  const bs = $$('#menu button'); const i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
  if (e.key === 'Escape') closeMenu();
});
function trackMenu(t, anchor, ctx = {}) {
  const liked = library.isLiked(t.id);
  const items = [
    { label: 'Play Next', icon: 'next', action: () => player.playNext(t) },
    { label: 'Add to Queue', icon: 'queue', action: () => player.addToQueue(t) },
    { label: liked ? 'Remove from Liked' : 'Like', icon: liked ? 'heart-fill' : 'heart', action: () => { const on = library.toggleLike(t); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); syncLike(); } },
    { label: 'Add to Playlist…', icon: 'plus', action: () => playlistMenu(t, anchor) }, '-',
    { label: 'Start Station', icon: 'radio', action: () => startStation({ name: t.artist, id: t.artistId?.startsWith('dz:') ? t.artistId : null }) },
  ];
  if (t.artistId || t.artist) items.push({ label: 'Go to Artist', icon: 'chev-right', action: () => { closeNP(); location.hash = `#/artist/${t.artistId || 'it:'}?name=${encodeURIComponent(t.artist)}`; } });
  if (t.albumId) items.push({ label: 'Go to Album', icon: 'chev-right', action: () => { closeNP(); location.hash = '#/album/' + t.albumId; } });
  if (ctx.playlist) items.push('-', { label: 'Remove from Playlist', icon: 'close', action: () => { library.removeFromPlaylist(ctx.playlist, ctx.index); render(); } });
  showMenu(anchor, items);
}
function playlistMenu(t, anchor) {
  const pls = library.playlists();
  showMenu(anchor, [{ head: 'Add to Playlist' }, { label: 'New Playlist…', icon: 'plus', action: () => newPlaylist(t) },
    ...(pls.length ? ['-'] : []), ...pls.map((p) => ({ label: p.name, action: () => { library.addToPlaylist(p.id, t); toast(`Added to “${p.name}”`); } }))]);
}
function renderSidePlaylists() {
  $('#side-playlists').innerHTML = library.playlists().map((p) => `<a href="#/playlist/${p.id}" data-pid="${p.id}">${icon('queue')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span></a>`).join('');
}
onLibrary(renderSidePlaylists); renderSidePlaylists();

// ---------------- mini player ----------------
const mini = $('#mini');
function updateMini() {
  const t = player.current;
  if (!t) { mini.hidden = true; return; }
  if (mini.hidden) { mini.hidden = false; mini.classList.remove('in'); void mini.offsetWidth; mini.classList.add('in'); }
  $('#mini-title').textContent = t.title; $('#mini-sub').textContent = t.artist;
  const a = $('#mini-art'); const src = api.art(t.artwork, 120); if (a.getAttribute('src') !== src) a.src = src;
}
function playIcons() {
  const playing = player.status === 'playing' || (player.status === 'loading' && player.mode);
  for (const id of ['#mini-play', '#np-play']) { const b = $(id); b.innerHTML = icon(playing ? 'pause' : 'play'); b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  document.body.classList.toggle('playing-now', player.status === 'playing');
  $('#np').classList.toggle('is-playing', player.status === 'playing' || player.status === 'loading');
  $$('.trow').forEach((r) => { const on = r.dataset.id === player.current?.id; r.classList.toggle('playing', on); r.classList.toggle('paused', on && player.status !== 'playing'); });
  const sh = $('#np-shuffle'); sh.setAttribute('aria-pressed', player.shuffle);
  const rp = $('#np-repeat'); rp.setAttribute('aria-pressed', player.repeat !== 'off'); rp.classList.toggle('rep-one', player.repeat === 'one'); rp.setAttribute('aria-label', 'Repeat: ' + player.repeat);
}
$('#mini-play').onclick = () => player.toggle(); $('#mini-next').onclick = () => player.next(); $('#mini-prev').onclick = () => player.prev();
$('#mini-open').onclick = () => openNP();
$('#mini-lyrics').onclick = () => openNP('lyrics'); $('#mini-queue').onclick = () => openNP('queue');

// ---------------- Now Playing ----------------
const np = $('#np'); const seek = $('#np-seek'); let seeking = false; let npMode = 'art';
const lyricsView = new LyricsView($('#lyrics-panel'), player);
function openNP(mode) {
  if (!player.current) return;
  if (!np.classList.contains('open')) {
    np.classList.add('open'); np.removeAttribute('inert'); np.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    history.pushState({ np: 1 }, '', location.hash);
  }
  setMode(mode || (isPhone() ? 'art' : (npMode === 'queue' ? 'queue' : 'lyrics')));
  setTimeout(() => $('#np-play').focus({ preventScroll: true }), 50);
}
function closeNP(fromPop) {
  if (!np.classList.contains('open')) return;
  np.classList.remove('open'); np.setAttribute('inert', ''); np.setAttribute('aria-hidden', 'true');
  np.classList.add('closing'); setTimeout(() => np.classList.remove('closing'), 650);
  np.style.transform = '';
  document.documentElement.style.overflow = '';
  if (!fromPop && history.state?.np) history.back();
  $('#mini-open').focus({ preventScroll: true });
}
window.addEventListener('popstate', () => { if (np.classList.contains('open')) closeNP(true); });
$('#np-close').onclick = () => closeNP();
function setMode(m) {
  // phone: art | lyrics | queue. desktop: right panel lyrics | queue
  if (!isPhone() && m === 'art') m = 'lyrics';
  npMode = m;
  np.classList.toggle('mode-lyrics', m === 'lyrics'); np.classList.toggle('mode-queue', m === 'queue');
  $('#lyrics-panel').hidden = m === 'queue'; $('#queue-panel').hidden = m !== 'queue';
  $('#np-tab-lyrics').setAttribute('aria-pressed', m === 'lyrics'); $('#np-tab-queue').setAttribute('aria-pressed', m === 'queue');
  if (m === 'lyrics') { lyricsView.load(); requestAnimationFrame(() => lyricsView.sync(true)); }
  if (m === 'queue') renderQueue();
}
$('#np-tab-lyrics').onclick = () => setMode(npMode === 'lyrics' ? 'art' : 'lyrics');
$('#np-tab-queue').onclick = () => setMode(npMode === 'queue' ? (isPhone() ? 'art' : 'lyrics') : 'queue');
$('#np-tab-video').onclick = () => {
  if (player.mode !== 'yt') { toast(player.mode === 'preview' ? 'Video isn’t available for previews' : 'No video for this song'); return; }
  const on = !np.classList.contains('show-video'); np.classList.toggle('show-video', on); $('#np-tab-video').setAttribute('aria-pressed', on);
  if (on && isPhone()) setMode('art');
};
$('#np-play').onclick = () => player.toggle(); $('#np-next').onclick = () => player.next(); $('#np-prev').onclick = () => player.prev();
$('#np-shuffle').onclick = () => player.toggleShuffle(); $('#np-repeat').onclick = () => player.cycleRepeat();
$('#np-like').onclick = () => { const t = player.current; if (!t) return; const on = library.toggleLike(t); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); syncLike(); };
$('#np-more').onclick = (e) => player.current && trackMenu(player.current, e.currentTarget);
$('#np-artist').onclick = () => { const t = player.current; if (!t) return; closeNP(); location.hash = `#/artist/${t.artistId || 'it:'}?name=${encodeURIComponent(t.artist)}`; };
const vol = $('#np-volume'); vol.value = player.volume; vol.style.setProperty('--p', player.volume + '%');
vol.oninput = () => { player.setVolume(+vol.value); vol.style.setProperty('--p', vol.value + '%'); };
seek.addEventListener('input', () => { seeking = true; const d = player.duration(); seek.style.setProperty('--p', seek.value / 10 + '%'); $('#np-cur').textContent = fmt(seek.value / 1000 * d); });
seek.addEventListener('change', () => { player.seek(seek.value / 1000 * player.duration()); seeking = false; });
function syncLike() { const t = player.current; const on = !!t && library.isLiked(t.id); const b = $('#np-like'); b.setAttribute('aria-pressed', on); b.innerHTML = icon(on ? 'heart-fill' : 'heart'); b.setAttribute('aria-label', on ? 'Unlike' : 'Like'); }
function updateTime() {
  const t = player.time(), d = player.duration(); const p = d ? Math.min(1, t / d) : 0;
  $('#mini-bar').style.transform = `scaleX(${p})`;
  if (!seeking) { seek.value = Math.round(p * 1000); seek.style.setProperty('--p', p * 100 + '%'); $('#np-cur').textContent = fmt(t); }
  $('#np-rem').textContent = '-' + fmt(Math.max(0, d - t));
}
function updateSource() {
  const pv = player.mode === 'preview';
  $('#np-badge').hidden = !pv; $('#mini-badge').hidden = !pv;
  $('#np-src').textContent = player.status === 'loading' && !player.mode ? 'Finding song…' : pv ? '30-second preview' : player.mode === 'yt' ? 'Full song · YouTube' : player.status === 'error' ? 'Unavailable' : '';
  if (player.mode !== 'yt') { np.classList.remove('show-video'); $('#np-tab-video').setAttribute('aria-pressed', false); }
}
function updateNP() {
  const t = player.current; if (!t) return;
  $('#np-title').textContent = t.title; $('#np-artist').textContent = t.artist;
  const big = api.art(t.artwork, 1000);
  const a = $('#np-art'); if (a.getAttribute('src') !== big) { a.src = big; a.alt = `${t.album || t.title} artwork`; $('#np-bgimg').src = api.art(t.artwork, 200); paletteFrom(api.art(t.artwork, 100)); }
  syncLike(); updateSource(); updateTime();
  document.title = `${t.title} · ${t.artist} — BeatMusic`;
}
function paletteFrom(url) {
  const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
  im.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 12; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0, 12, 12); const d = x.getImageData(0, 0, 12, 12).data;
      const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
      const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
      const avg = (arr) => arr.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => Math.round(v / arr.length));
      const sorted = px.slice().sort((p, q) => sat(q) - sat(p));
      const c1 = avg(sorted.slice(0, 20)), c2 = avg(px.slice(0, 72)), c3 = avg(px.slice(72));
      const css = (c, k) => `rgb(${c.map((v) => Math.min(255, Math.round(v * k))).join(',')})`;
      const bg = $('.np-bg'); bg.style.setProperty('--c1', css(c1, 1)); bg.style.setProperty('--c2', css(c2, .9)); bg.style.setProperty('--c3', css(c3, .8));
      bg.style.background = css(avg(px), .55);
    } catch { /* tainted canvas: keep defaults */ }
  };
  im.src = url;
}
// drag down to dismiss (phone)
(() => {
  let y0 = null, dy = 0;
  const start = (e) => { if (!isPhone() || e.target.closest('input,button:not(.np-grabber),.lyrics,.queue,.np-video')) return; y0 = e.clientY; dy = 0; np.style.transition = 'none'; };
  np.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); np.style.transform = `translateY(${dy}px)`; });
  window.addEventListener('pointerup', () => { if (y0 == null) return; y0 = null; np.style.transition = ''; if (dy > 120) closeNP(); else np.style.transform = ''; });
})();

// ---------------- queue panel ----------------
function renderQueue() {
  const p = $('#queue-panel'); if (p.hidden) return;
  const q = player.queue, cur = player.index; const k = reg(q);
  const upNext = q.map((t, i) => ({ t, i })).filter((x) => x.i > cur);
  const row = ({ t, i }) => `<div class="trow" draggable="true" data-qi="${i}" data-list="${k}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(t.title)}">
    <span class="art">${img(t.artwork, 100)}</span><span class="tm"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)}</div></span>
    <span class="q-actions"><button data-qup="${i}" aria-label="Move up">${icon('up')}</button><button data-qrm="${i}" aria-label="Remove from Up Next">${icon('close')}</button><span class="grip" aria-hidden="true" style="display:grid;place-items:center;width:30px;color:rgba(255,255,255,.5)">${icon('grip')}</span></span></div>`;
  p.innerHTML = `<div class="queue"><h3>Playing Next <button id="q-clear">${upNext.length ? 'Clear' : ''}</button></h3>
    ${upNext.length ? upNext.map(row).join('') : '<p style="color:rgba(255,255,255,.55);padding:6px">Nothing queued. Use ⋯ → Play Next on any song.</p>'}
    ${cur > 0 ? `<h3 style="margin-top:22px">History</h3>${q.slice(Math.max(0, cur - 10), cur).map((t, j) => ({ t, i: Math.max(0, cur - 10) + j })).reverse().map((x) => row(x).replace('draggable="true"', '').replace(/<span class="q-actions">[\s\S]*?<\/span><\/span><\/div>$/, '</div>')).join('')}` : ''}</div>`;
  const clr = $('#q-clear', p); if (clr) clr.onclick = () => { player.queue.splice(cur + 1); player.emit('queue'); };
}
$('#queue-panel').addEventListener('click', (e) => {
  const up = e.target.closest('[data-qup]'); if (up) { e.stopPropagation(); const i = +up.dataset.qup; player.move(i, Math.max(player.index + 1, i - 1)); return; }
  const rm = e.target.closest('[data-qrm]'); if (rm) { e.stopPropagation(); player.removeAt(+rm.dataset.qrm); return; }
  const r = e.target.closest('[data-qi],[data-i]'); if (r) { e.stopPropagation(); player.jump(+(r.dataset.qi ?? r.dataset.i)); }
}, true);
(() => { // drag & drop reorder (desktop)
  const p = $('#queue-panel'); let from = null;
  p.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-qi]'); if (!r) return; from = +r.dataset.qi; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  p.addEventListener('dragover', (e) => { const r = e.target.closest('[data-qi]'); if (from == null || !r) return; e.preventDefault(); $$('.drop-before', p).forEach((x) => x.classList.remove('drop-before')); r.classList.add('drop-before'); });
  p.addEventListener('drop', (e) => { const r = e.target.closest('[data-qi]'); if (from == null || !r) return; e.preventDefault(); let to = +r.dataset.qi; if (from < to) to--; player.move(from, Math.max(player.index + 1, to)); from = null; });
  p.addEventListener('dragend', () => { from = null; $$('.dragging,.drop-before', p).forEach((x) => x.classList.remove('dragging', 'drop-before')); });
})();

// ---------------- player events ----------------
player.addEventListener('track', () => { updateMini(); updateNP(); playIcons(); });
player.addEventListener('state', () => { playIcons(); updateSource(); });
player.addEventListener('source', updateSource);
player.addEventListener('time', updateTime);
player.addEventListener('queue', () => { renderQueue(); playIcons(); });
onLibrary(syncLike);

// ---------------- tab bar: shrink on scroll + sliding pill ----------------
function movePill() {
  const pill = $('#tab-pill'); const a = $('.tabs a.active');
  if (!a) { pill.style.width = '0px'; return; }
  pill.style.width = (a.offsetWidth - 4) + 'px'; pill.style.transform = `translateX(${a.offsetLeft + 2}px)`;
}
window.addEventListener('resize', movePill);
let lastY = 0, ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY; const tb = $('#tabbar');
    if (y > lastY + 6 && y > 60) { tb.classList.add('compact'); $('#app').classList.add('compact'); }
    else if (y < lastY - 6 || y < 30) { tb.classList.remove('compact'); $('#app').classList.remove('compact'); }
    lastY = y; ticking = false;
  });
}, { passive: true });

// ---------------- glass: specular highlight follows the pointer ----------------
let gl = null;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const g = e.target.closest?.('.glass'); if (!g) return;
  if (gl) return; gl = requestAnimationFrame(() => {
    gl = null; const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%'); g.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  });
}, { passive: true });
// Lens/refraction on the floating glass where the browser supports SVG filters in backdrop-filter (Chromium).
if (navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)) && !matchMedia('(prefers-reduced-transparency: reduce)').matches) document.documentElement.classList.add('lg-refract');

// ---------------- keyboard ----------------
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) { if (e.key === 'Escape') e.target.blur?.(); return; }
  if (e.key === 'Escape') { if (!$('#menu').hidden) closeMenu(); else closeNP(); return; }
  if (e.key === ' ' && !e.target.closest('button,a,[role=button]')) { e.preventDefault(); player.toggle(); }
  else if (e.key === 'k') player.toggle();
  else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
  else if (e.key === 'l') player.seek(player.time() + 10);
  else if (e.key === 'j') player.seek(player.time() - 10);
  else if (e.key === '/') { e.preventDefault(); if (isPhone()) location.hash = '#/search'; else $('#side-search').focus(); }
});

// ---------------- boot ----------------
render();
// Load the YouTube player early so the first tap starts the full song sooner.
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => player.warmUp());
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // When an updated worker takes over a page that an older one was serving, reload once so the new files run.
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}
