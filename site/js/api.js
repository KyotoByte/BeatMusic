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

let jp = 0;
export function jsonp(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const cb = `__bm_jsonp_${++jp}_${Date.now().toString(36)}`;
    const s = document.createElement('script');
    const done = () => { clearTimeout(tm); delete window[cb]; s.remove(); };
    const tm = setTimeout(() => { done(); reject(new Error('timeout')); }, timeout);
    window[cb] = (d) => { done(); if (d && d.error) reject(new Error(d.error.message || 'API error')); else resolve(d); };
    s.onerror = () => { done(); reject(new Error('network')); };
    s.referrerPolicy = 'no-referrer';
    s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}
const dz = (path) => cached('dz' + path, () => jsonp('https://api.deezer.com' + path));
const it = (url) => cached(url, () => fetchJSON(url));

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
export async function search(q) {
  q = q.trim(); if (!q) return { tracks: [], albums: [], artists: [] };
  const e = encodeURIComponent(q);
  const [tr, al, ar] = await Promise.allSettled([
    dz(`/search?q=${e}&limit=30`), dz(`/search/album?q=${e}&limit=14`), dz(`/search/artist?q=${e}&limit=10`)]);
  let tracks = tr.status === 'fulfilled' ? relevance((tr.value.data || []), q).map(fromDeezer) : null;
  let albums = al.status === 'fulfilled' ? (al.value.data || []).map(albumFromDeezer) : null;
  const artists = ar.status === 'fulfilled' ? (ar.value.data || []).map(artistFromDeezer) : [];
  // Fallback to iTunes if Deezer is unreachable (blocked network, outage).
  if (!tracks || !albums) {
    const c = country();
    const [s, a] = await Promise.allSettled([
      it(`https://itunes.apple.com/search?term=${e}&entity=song&limit=30&country=${c}`),
      it(`https://itunes.apple.com/search?term=${e}&entity=album&limit=14&country=${c}`)]);
    if (!tracks) tracks = s.status === 'fulfilled' ? s.value.results.map(fromItunes) : [];
    if (!albums) albums = a.status === 'fulfilled' ? a.value.results.map(albumFromItunes) : [];
    if (s.status === 'rejected' && tr.status === 'rejected') throw new Error('Search is unreachable right now');
  }
  return { tracks, albums, artists };
}
// Deezer's order for a mixed "song + artist" query can put an unknown upload first; keep its order but
// move results that contain every query word up, and break ties by Deezer popularity (rank).
function relevance(list, q) {
  const words = q.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
  const hay = (r) => `${r.title} ${r.artist?.name} ${r.album?.title}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const tier = (r) => { const h = hay(r); const hit = words.filter((w) => h.includes(w)).length / (words.length || 1);
    const t = (r.title || '').toLowerCase(), a = (r.artist?.name || '').toLowerCase();
    const clean = words.some((w) => a.includes(w)) && !words.every((w) => t.includes(w) && !a.includes(w)) ? 1 : 0;
    return hit + clean * 0.5; };
  return list.map((r, i) => ({ r, i, s: tier(r), k: r.rank || 0 }))
    .sort((x, y) => (y.s - x.s) || (y.k - x.k)).map((x) => x.r);
}
export async function suggest(q) {
  const d = await dz(`/search?q=${encodeURIComponent(q)}&limit=6`);
  return (d.data || []).map(fromDeezer);
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
  if (!id || id.startsWith('it:')) {
    let name = nameHint;
    if (!name && id) { const d = await it(`https://itunes.apple.com/lookup?id=${id.slice(3)}`); name = d.results?.[0]?.artistName; }
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
  let id = artistDzId;
  if (!id) { const a = await deezerArtistByName(artistName); if (!a) throw new Error('Artist not found'); id = a.id; }
  const n = id.replace('dz:', '');
  const [mix, rel] = await Promise.all([dz(`/artist/${n}/radio?limit=40`).catch(() => ({ data: [] })), dz(`/artist/${n}/related?limit=6`).catch(() => ({ data: [] }))]);
  let tracks = (mix.data || []).map(fromDeezer);
  const relTops = await Promise.allSettled((rel.data || []).slice(0, 4).map((r) => dz(`/artist/${r.id}/top?limit=3`)));
  relTops.forEach((r) => { if (r.status === 'fulfilled') tracks.push(...(r.value.data || []).map(fromDeezer)); });
  return shuffleUnique(tracks);
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
