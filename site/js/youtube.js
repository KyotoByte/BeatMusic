// Map a track (title + artist + duration) to YouTube video ids, from the browser.
// YouTube's own search needs an API key, so we ask public Piped instances (open-source YouTube front-ends
// whose API sends Access-Control-Allow-Origin: *). Public instances come and go: we try several in parallel
// batches with timeouts, remember the one that answered, and fall back to Invidious instances that advertise CORS.
import { fetchJSON } from './api.js';
import { store } from './store.js';

const PIPED = [
  'https://api.piped.private.coffee', 'https://pipedapi.ducks.party', 'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de', 'https://pipedapi.leptons.xyz', 'https://piped-api.lunar.icu',
  'https://pipedapi.reallyaweso.me', 'https://pipedapi.drgns.space', 'https://pipedapi.nosebs.ru',
  'https://pipedapi.r4fo.com', 'https://api.piped.yt', 'https://pipedapi.orangenet.cc',
];
const BAD = /\b(live|cover|karaoke|instrumental|remix|sped ?up|slowed|reverb|8d|nightcore|lyrics? video|reaction|tutorial|1 hour|loop)\b/i;
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\((feat|ft|with)[^)]*\)|\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

export const resolverStatus = { instance: store.get('piped-good', null), lastError: null };

function pipedItems(d) {
  return (d?.items || []).filter((i) => i.type === 'stream' && i.url).map((i) => ({
    id: new URL(i.url, 'https://x.invalid').searchParams.get('v'), title: i.title, uploader: i.uploaderName || '', duration: i.duration || 0,
  })).filter((i) => i.id);
}
async function pipedSearch(base, q, filter) {
  const d = await fetchJSON(`${base}/search?q=${encodeURIComponent(q)}&filter=${filter}`, 6500);
  if (!d || !Array.isArray(d.items)) throw new Error('bad response');
  return pipedItems(d);
}
async function firstAnswer(bases, q, filter) {
  for (let i = 0; i < bases.length; i += 3) {
    const batch = bases.slice(i, i + 3);
    try {
      return await Promise.any(batch.map((b) => pipedSearch(b, q, filter).then((items) => {
        if (!items.length && filter === 'music_songs') throw new Error('empty');
        return { base: b, items };
      })));
    } catch { /* next batch */ }
  }
  return null;
}
let invList = null;
async function invidiousSearch(q) {
  if (!invList) {
    try {
      const d = await fetchJSON('https://api.invidious.io/instances.json?sort_by=type,users', 6000);
      invList = d.filter(([, m]) => m && m.api && m.cors && m.type === 'https').map(([, m]) => m.uri).slice(0, 6);
    } catch { invList = []; }
  }
  for (const base of invList) {
    try {
      const d = await fetchJSON(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, 6500);
      return d.filter((v) => v.type === 'video').map((v) => ({ id: v.videoId, title: v.title, uploader: v.author || '', duration: v.lengthSeconds || 0 }));
    } catch { /* next */ }
  }
  return [];
}

function rank(items, t, bonus = 0) {
  const tt = norm(t.title), ta = norm(t.artist).split(' ')[0];
  return items.map((i) => {
    const it = norm(i.title), up = norm(i.uploader);
    let s = bonus;
    if (it.includes(tt)) s += 3; else if (tt.split(' ').filter((w) => w.length > 2 && it.includes(w)).length >= 1) s += 1;
    if (ta && (up.includes(ta) || it.includes(ta))) s += 2;
    if (/ topic$/.test(up)) s += 1.5;
    if (/official (music )?video|official audio/.test(it)) s += 0.5;
    if (BAD.test(i.title) && !BAD.test(t.title)) s -= 4;
    if (t.duration && i.duration > 0) { const d = Math.abs(i.duration - t.duration); s += d <= 3 ? 3 : d <= 10 ? 2 : d <= 30 ? 0 : -3; }
    if (i.duration <= 0) s -= 3;
    return { ...i, score: s };
  }).filter((i) => i.score > 0).sort((a, b) => b.score - a.score);
}

export async function resolveYouTube(t) {
  const map = store.get('ytmap', {});
  if (map[t.id]?.length) return map[t.id];
  const q = `${t.artist} ${t.title}`.replace(/\((feat|ft)[^)]*\)/i, '').trim();
  const good = store.get('piped-good', null);
  const bases = good ? [good, ...PIPED.filter((b) => b !== good)] : PIPED;
  let cands = [];
  const songs = await firstAnswer(bases, q, 'music_songs');
  if (songs) {
    store.set('piped-good', songs.base); resolverStatus.instance = songs.base;
    cands = rank(songs.items, t, 1);
    if (cands.length < 3) {
      try { cands = cands.concat(rank(await pipedSearch(songs.base, q, 'videos'), t)); } catch { /* ok */ }
    }
  } else {
    resolverStatus.lastError = 'No public Piped instance answered';
    cands = rank(await invidiousSearch(q), t);
  }
  const ids = [...new Set(cands.map((c) => c.id))].slice(0, 6);
  if (ids.length) {
    const keys = Object.keys(map); if (keys.length > 400) keys.slice(0, 100).forEach((k) => delete map[k]);
    map[t.id] = ids; store.set('ytmap', map);
  }
  return ids;
}
