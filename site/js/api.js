// Public music metadata from the browser (no keys, no server):
//  - iTunes Search / Lookup / RSS charts: CORS enabled (Access-Control-Allow-Origin: *)
//  - Deezer API: no CORS header, but supports JSONP (output=jsonp&callback=)
//  - LRCLIB: CORS enabled (lyrics, see lyrics.js)
//  - Piped (open-source YouTube front-end) public instances: CORS enabled, used only to find a YouTube video id
import { store } from './store.js';

export function detectCountry() {
  const langs = navigator.languages || [navigator.language || 'en-US'];
  for (const l of langs) { const m = /-([A-Za-z]{2})$/.exec(l); if (m) return m[1].toLowerCase(); }
  return 'us';
}
export const country = () => store.get('country', null) || detectCountry();
export const setCountry = (c) => { store.set('country', c); memo.clear(); };

const memo = new Map();
const TTL = 10 * 60 * 1000;
function cached(key, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.p;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { t: Date.now(), p });
  return p;
}

export async function fetchJSON(url, timeout = 9000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}

// Deezer's JSONP endpoint is fast on most networks but on some (seen on Indian mobile networks) the request
// just hangs for ~20 s. So: short timeouts, and after a network failure we skip Deezer for a few minutes
// instead of making every screen wait on it again. A late answer after a timeout lands on a no-op.
let jp = 0;
let dzBadUntil = 0;
export const deezerReachable = () => Date.now() >= dzBadUntil;
export function jsonp(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!deezerReachable()) { reject(new Error('Deezer unreachable')); return; }
    const cb = `__bm_jsonp_${++jp}_${Date.now().toString(36)}`;
    const s = document.createElement('script');
    let settled = false;
    const done = () => { settled = true; clearTimeout(tm); window[cb] = () => {}; setTimeout(() => { delete window[cb]; }, 60000); s.remove(); };
    const netFail = (msg) => { if (settled) return; done(); dzBadUntil = Date.now() + 5 * 60 * 1000; reject(new Error(msg)); };
    const tm = setTimeout(() => netFail('Deezer timed out'), timeout);
    window[cb] = (d) => { if (settled) return; done(); dzBadUntil = 0; if (d && d.error) reject(new Error(d.error.message || 'API error')); else resolve(d); };
    s.onerror = () => netFail('Deezer unreachable');
    s.referrerPolicy = 'no-referrer';
    s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}
const dz = (path, timeout) => cached('dz' + path, () => jsonp('https://api.deezer.com' + path, timeout));
const it = (url, timeout) => cached(url, () => fetchJSON(url, timeout));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- artwork ----------
export function art(url, size = 300) {
  if (!url) return '';
  if (url.includes('mzstatic.com')) return url.replace(/\/[^/]*\d+x\d+[^/]*\.(jpg|png|webp)$/i, `/${size}x${size}bb.jpg`);
  if (url.includes('dzcdn.net')) return url.replace(/\/\d+x\d+-/, `/${size}x${size}-`);
  return url;
}

// ---------- normalisers ----------
const idFromHref = (h) => (/\/id?(\d+)(?:\?|$)/.exec(h || '') || /\/(\d+)(?:\?|$)/.exec(h || '') || [])[1];
export function fromItunes(r) {
  return { id: 'it:' + r.trackId, title: r.trackName, artist: r.artistName, album: r.collectionName, artwork: r.artworkUrl100,
    duration: Math.round((r.trackTimeMillis || 0) / 1000), preview: r.previewUrl, explicit: r.trackExplicitness === 'explicit',
    artistId: r.artistId ? 'it:' + r.artistId : null, albumId: r.collectionId ? 'it:' + r.collectionId : null, genre: r.primaryGenreName };
}
export function fromDeezer(r) {
  return { id: 'dz:' + r.id, title: r.title, artist: r.artist?.name, album: r.album?.title,
    artwork: r.album?.cover_xl || r.album?.cover_big || r.album?.cover_medium || r.artist?.picture_xl,
    duration: r.duration || 0, preview: r.preview, explicit: !!r.explicit_lyrics,
    artistId: r.artist?.id ? 'dz:' + r.artist.id : null, albumId: r.album?.id ? 'dz:' + r.album.id : null };
}
function fromRss(e) {
  const enc = (Array.isArray(e.link) ? e.link : [e.link]).find((l) => l?.attributes?.rel === 'enclosure');
  const imgs = e['im:image'] || [];
  return { id: 'it:' + e.id.attributes['im:id'], title: e['im:name'].label, artist: e['im:artist']?.label,
    album: e['im:collection']?.['im:name']?.label, artwork: imgs[imgs.length - 1]?.label, duration: 0,
    preview: enc?.attributes?.href, explicit: false,
    artistId: idFromHref(e['im:artist']?.attributes?.href) ? 'it:' + idFromHref(e['im:artist'].attributes.href) : null,
    albumId: idFromHref(e['im:collection']?.link?.attributes?.href) ? 'it:' + idFromHref(e['im:collection'].link.attributes.href) : null,
    genre: e.category?.attributes?.label };
}
function albumFromRss(e) {
  const imgs = e['im:image'] || [];
  return { id: 'it:' + e.id.attributes['im:id'], title: e['im:name'].label, artist: e['im:artist']?.label, artwork: imgs[imgs.length - 1]?.label,
    genre: e.category?.attributes?.label, year: (e['im:releaseDate']?.label || '').slice(0, 4) };
}
const albumFromItunes = (r) => ({ id: 'it:' + r.collectionId, title: r.collectionName, artist: r.artistName, artwork: r.artworkUrl100,
  year: (r.releaseDate || '').slice(0, 4), genre: r.primaryGenreName, count: r.trackCount, artistId: r.artistId ? 'it:' + r.artistId : null });
const albumFromDeezer = (r) => ({ id: 'dz:' + r.id, title: r.title, artist: r.artist?.name, artwork: r.cover_xl || r.cover_big || r.cover_medium,
  year: (r.release_date || '').slice(0, 4), genre: r.genres?.data?.[0]?.name, count: r.nb_tracks, artistId: r.artist?.id ? 'dz:' + r.artist.id : null });
const artistFromDeezer = (r) => ({ id: 'dz:' + r.id, name: r.name, artwork: r.picture_xl || r.picture_big || r.picture_medium, fans: r.nb_fan });

// ---------- charts ----------
const entries = (d) => { const e = d?.feed?.entry; return !e ? [] : Array.isArray(e) ? e : [e]; };
export async function topSongs(genre, limit = 50) {
  const g = genre ? `/genre=${genre}` : '';
  const d = await it(`https://itunes.apple.com/${country()}/rss/topsongs/limit=${limit}${g}/json`);
  return entries(d).map(fromRss);
}
export async function topAlbums(genre, limit = 30) {
  const g = genre ? `/genre=${genre}` : '';
  const d = await it(`https://itunes.apple.com/${country()}/rss/topalbums/limit=${limit}${g}/json`);
  return entries(d).map(albumFromRss);
}
export async function deezerChart() {
  const d = await dz('/chart/0?limit=30');
  return { tracks: (d.tracks?.data || []).map(fromDeezer), albums: (d.albums?.data || []).map(albumFromDeezer),
    artists: (d.artists?.data || []).map(artistFromDeezer), playlists: d.playlists?.data || [] };
}

// ---------- search ----------
// iTunes Search (CORS, answers fast from everywhere we tested, incl. Indian mobile networks) is the primary
// source for songs and albums. Deezer is secondary: it supplies artist pictures when it answers quickly,
// and songs/albums only if iTunes itself fails.
const fold = (x) => (x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const qwords = (q) => fold(q).split(/\s+/).filter(Boolean);
export async function search(q) {
  q = q.trim(); if (!q) return { tracks: [], albums: [], artists: [] };
  const e = encodeURIComponent(q); const c = country();
  const dzArtists = dz(`/search/artist?q=${e}&limit=10`, 4000).then((d) => (d.data || []).map(artistFromDeezer));
  dzArtists.catch(() => {});
  const [s, a] = await Promise.allSettled([
    it(`https://itunes.apple.com/search?term=${e}&media=music&entity=song&limit=40&country=${c}`, 8000),
    it(`https://itunes.apple.com/search?term=${e}&media=music&entity=album&limit=14&country=${c}`, 8000)]);
  let tracks = s.status === 'fulfilled' ? relevance((s.value.results || []).filter((r) => r.kind === 'song').map(fromItunes), q) : null;
  let albums = a.status === 'fulfilled' ? (a.value.results || []).map(albumFromItunes) : null;
  if (!tracks || !albums) {
    const [tr, al] = await Promise.allSettled([dz(`/search?q=${e}&limit=30`), dz(`/search/album?q=${e}&limit=14`)]);
    if (!tracks) tracks = tr.status === 'fulfilled' ? relevance((tr.value.data || []).map(fromDeezer), q) : null;
    if (!albums) albums = al.status === 'fulfilled' ? (al.value.data || []).map(albumFromDeezer) : [];
    if (!tracks) throw new Error('Couldn’t reach the music catalog. Check your connection and try again.');
  }
  // Artists: Deezer's (with photos) if it answers within a short grace, else the artists of the songs found.
  let artists = await Promise.race([dzArtists, sleep(1500).then(() => null)]).catch(() => null);
  if (!artists || !artists.length) artists = artistsFromTracks(tracks);
  const w = qwords(q);
  const named = (n) => { const f = fold(n); return f && w.length && (f === w.join(' ') || f.split(/\s+/).every((x) => w.includes(x))); };
  artists = artists.map((x, i) => ({ x, i, m: named(x.name) ? 1 : 0 })).sort((p1, p2) => (p2.m - p1.m) || (p1.i - p2.i)).map((o) => o.x);
  return { tracks, albums, artists, topArtist: artists.find((x) => named(x.name)) || null };
}
function artistsFromTracks(tracks) {
  const seen = new Map();
  for (const t of tracks) {
    const name = (t.artist || '').split(/,| & | feat\.? | ft\.? /i)[0].trim();
    if (!name || !t.artistId || seen.has(name.toLowerCase())) continue;
    seen.set(name.toLowerCase(), { id: t.artistId, name, artwork: t.artwork, fans: 0 });
  }
  return [...seen.values()].slice(0, 10);
}
// Keep the source's order, but move results that contain every query word up.
function relevance(list, q) {
  const words = qwords(q);
  const tier = (t) => { const h = fold(`${t.title} ${t.artist} ${t.album}`); const hit = words.filter((w) => h.includes(w)).length / (words.length || 1);
    const a = fold(t.artist), ti = fold(t.title);
    const clean = words.some((w) => a.includes(w)) && !words.every((w) => ti.includes(w) && !a.includes(w)) ? 1 : 0;
    return hit + clean * 0.5; };
  return list.map((t, i) => ({ t, i, s: tier(t) })).sort((x, y) => (y.s - x.s) || (x.i - y.i)).map((x) => x.t);
}
export async function suggest(q) {
  const d = await it(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=6&country=${country()}`, 6000);
  return (d.results || []).map(fromItunes);
}

// ---------- albums / artists ----------
export async function album(id) {
  if (id.startsWith('dz:')) {
    const a = await dz('/album/' + id.slice(3));
    const al = albumFromDeezer(a);
    const tracks = (a.tracks?.data || []).map((t) => fromDeezer({ ...t, album: { id: a.id, title: a.title, cover_xl: a.cover_xl, cover_big: a.cover_big } }));
    return { ...al, tracks, label: a.label };
  }
  const d = await it(`https://itunes.apple.com/lookup?id=${id.slice(3)}&entity=song&country=${country()}`);
  const head = d.results.find((r) => r.wrapperType === 'collection');
  if (!head) throw new Error('Album not found');
  return { ...albumFromItunes(head), tracks: d.results.filter((r) => r.wrapperType === 'track').map(fromItunes) };
}
export async function deezerArtistByName(name) {
  const d = await dz(`/search/artist?q=${encodeURIComponent(name)}&limit=1`);
  const a = d.data?.[0]; return a ? artistFromDeezer(a) : null;
}
export async function artist(id, nameHint) {
  const itId = id && id.startsWith('it:') ? id.slice(3) : null;
  try {
    if (!id || itId) {
      let name = nameHint;
      if (!name && itId) { const d = await it(`https://itunes.apple.com/lookup?id=${itId}`); name = d.results?.[0]?.artistName; }
      const a = name && await deezerArtistByName(name);
      if (!a) throw new Error('Artist not found');
      id = a.id;
    }
    const n = id.slice(3);
    const [a, top, albums, related] = await Promise.all([dz('/artist/' + n), dz(`/artist/${n}/top?limit=20`),
      dz(`/artist/${n}/albums?limit=40`), dz(`/artist/${n}/related?limit=16`).catch(() => ({ data: [] }))]);
    return { ...artistFromDeezer(a), top: (top.data || []).map(fromDeezer),
      albums: (albums.data || []).map((x) => albumFromDeezer({ ...x, artist: { id: a.id, name: a.name } })),
      related: (related.data || []).map(artistFromDeezer) };
  } catch (err) {
    if (!itId) throw err;
    return itunesArtist(itId);
  }
}
// Artist page from iTunes alone (when Deezer is unreachable).
async function itunesArtist(n) {
  const c = country();
  const [s, a] = await Promise.all([it(`https://itunes.apple.com/lookup?id=${n}&entity=song&limit=25&country=${c}`),
    it(`https://itunes.apple.com/lookup?id=${n}&entity=album&limit=40&country=${c}`).catch(() => ({ results: [] }))]);
  const head = s.results.find((r) => r.wrapperType === 'artist');
  if (!head) throw new Error('Artist not found');
  const top = s.results.filter((r) => r.wrapperType === 'track').map(fromItunes);
  return { id: 'it:' + n, name: head.artistName, artwork: top[0]?.artwork, fans: 0, top,
    albums: a.results.filter((r) => r.wrapperType === 'collection').map(albumFromItunes), related: [] };
}
export async function deezerPlaylist(id) {
  const p = await dz(`/playlist/${id}`);
  return { id: 'dzp:' + id, title: p.title, artist: p.creator?.name || 'Deezer', artwork: p.picture_xl || p.picture_big,
    description: p.description, tracks: (p.tracks?.data || []).map(fromDeezer) };
}

// ---------- radio ----------
// Honest description: a station is a list built from Deezer's public "artist mix" and similar-artist data
// (or a genre chart), not a personal recommendation algorithm.
export async function artistStation(artistName, artistDzId) {
  try {
    let id = artistDzId && artistDzId.startsWith('dz:') ? artistDzId : null;
    if (!id) { const a = await deezerArtistByName(artistName); if (!a) throw new Error('Artist not found'); id = a.id; }
    const n = id.replace('dz:', '');
    const [mix, rel] = await Promise.all([dz(`/artist/${n}/radio?limit=40`).catch(() => ({ data: [] })), dz(`/artist/${n}/related?limit=6`).catch(() => ({ data: [] }))]);
    let tracks = (mix.data || []).map(fromDeezer);
    const relTops = await Promise.allSettled((rel.data || []).slice(0, 4).map((r) => dz(`/artist/${r.id}/top?limit=3`)));
    relTops.forEach((r) => { if (r.status === 'fulfilled') tracks.push(...(r.value.data || []).map(fromDeezer)); });
    if (!tracks.length) throw new Error('empty');
    return shuffleUnique(tracks);
  } catch (err) {
    if (!artistName) throw err;
    // Deezer unreachable: the artist's own songs from iTunes.
    const d = await it(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=song&attribute=artistTerm&limit=40&country=${country()}`);
    return shuffleUnique((d.results || []).map(fromItunes));
  }
}
export async function genreStation(genreId) {
  const t = await topSongs(genreId, 50);
  return shuffleUnique(t);
}
export function shuffleUnique(list) {
  const seen = new Set(); const out = [];
  for (const t of list) { const k = (t.title + '|' + t.artist).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const GENRES = [
  { id: 14, name: 'Pop', c1: '#ff5f8f', c2: '#b0136a' }, { id: 18, name: 'Hip-Hop / Rap', c1: '#f7971e', c2: '#b8410b' },
  { id: 1263, name: 'Bollywood', c1: '#ff9a3c', c2: '#c3125a' }, { id: 1262, name: 'Indian', c1: '#e8b13a', c2: '#9b3f0a' },
  { id: 17, name: 'Dance', c1: '#5b86e5', c2: '#36d1dc' }, { id: 15, name: 'R&B / Soul', c1: '#8e44ad', c2: '#3b1e6d' },
  { id: 21, name: 'Rock', c1: '#434343', c2: '#b31217' }, { id: 20, name: 'Alternative', c1: '#11998e', c2: '#2c5364' },
  { id: 7, name: 'Electronic', c1: '#00c6ff', c2: '#3a1c71' }, { id: 51, name: 'K-Pop', c1: '#fc5c7d', c2: '#6a82fb' },
  { id: 12, name: 'Latin', c1: '#f12711', c2: '#f5af19' }, { id: 6, name: 'Country', c1: '#c79081', c2: '#6b3e26' },
  { id: 11, name: 'Jazz', c1: '#355c7d', c2: '#c06c84' }, { id: 5, name: 'Classical', c1: '#757f9a', c2: '#2c3e50' },
  { id: 24, name: 'Reggae', c1: '#0f9b0f', c2: '#c7a600' }, { id: 1153, name: 'Metal', c1: '#232526', c2: '#7a0b0b' },
];
