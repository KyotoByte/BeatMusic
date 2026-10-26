// Lyrics from LRCLIB (https://lrclib.net, free, CORS enabled). Synced (LRC) when available, plain otherwise.
import { fetchJSON } from './api.js';

const memo = new Map();
const clean = (s) => (s || '').replace(/\s*[\(\[](feat|ft|with|from|remaster|remastered|live|explicit|clean)[^\)\]]*[\)\]]/gi, '')
  .replace(/\s+-\s+(remaster(ed)?|live|radio edit|single version|mono|stereo).*$/i, '').trim();
const firstArtist = (a) => (a || '').split(/,|&| x | feat\.? | ft\.? /i)[0].trim();

export function parseLRC(text) {
  const out = []; let offset = 0;
  for (const raw of (text || '').split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw); if (off) { offset = +off[1] / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const m of tags) out.push({ t: Math.max(0, +m[1] * 60 + parseFloat(m[2].replace(':', '.')) - offset), text: words });
  }
  out.sort((a, b) => a.t - b.t);
  // Collapse runs of empty lines into one instrumental gap marker.
  return out.filter((l, i) => l.text || (i > 0 && out[i - 1].text));
}

function pick(list, t) {
  if (!Array.isArray(list) || !list.length) return null;
  const scored = list.map((r) => {
    let s = r.syncedLyrics ? 5 : r.plainLyrics ? 1 : 0;
    if (t.duration && r.duration) { const d = Math.abs(r.duration - t.duration); s += d <= 2 ? 4 : d <= 6 ? 2 : d <= 15 ? 0 : -6; }
    if ((r.artistName || '').toLowerCase().includes(firstArtist(t.artist).toLowerCase())) s += 2;
    return { r, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].s > 0 ? scored[0].r : null;
}

export async function getLyrics(t) {
  if (memo.has(t.id)) return memo.get(t.id);
  const p = (async () => {
    const title = clean(t.title), artist = firstArtist(t.artist);
    const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
    let rec = null;
    const attempts = [
      () => fetchJSON('https://lrclib.net/api/get?' + qs({ track_name: t.title, artist_name: t.artist, album_name: t.album, duration: t.duration || '' }), 8000),
      () => fetchJSON('https://lrclib.net/api/get?' + qs({ track_name: title, artist_name: artist }), 8000),
    ];
    for (const a of attempts) { try { rec = await a(); if (rec && (rec.syncedLyrics || rec.plainLyrics || rec.instrumental)) break; rec = null; } catch { /* 404 → next */ } }
    if (!rec || !rec.syncedLyrics) {
      try {
        const list = await fetchJSON('https://lrclib.net/api/search?' + qs({ track_name: title, artist_name: artist }), 9000);
        const best = pick(list, t); if (best && (!rec || best.syncedLyrics)) rec = best;
      } catch { /* none */ }
    }
    if (!rec) return { none: true };
    if (rec.instrumental) return { instrumental: true };
    const synced = rec.syncedLyrics ? parseLRC(rec.syncedLyrics) : null;
    return { synced: synced && synced.length ? synced : null, plain: rec.plainLyrics || null, source: 'LRCLIB' };
  })();
  memo.set(t.id, p);
  p.catch(() => memo.delete(t.id));
  return p;
}

// ---------- Apple-style lyrics view ----------
export class LyricsView {
  constructor(host, player) {
    this.host = host; this.player = player; this.lines = null; this.active = -1; this.userScrollUntil = 0; this.trackId = null;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    player.addEventListener('time', () => this.sync());
    player.addEventListener('track', () => this.load());
    player.addEventListener('source', () => { if (this.player.mode && this.mode !== this.player.mode) { this.mode = this.player.mode; this.load(true); } });
  }
  visible() { return !!this.host.offsetParent || this.host.getClientRects().length > 0; }
  async load(force) {
    const t = this.player.current; if (!t) { this.msg('Nothing playing'); return; }
    if (!force && this.trackId === t.id) return;
    this.trackId = t.id; this.mode = this.player.mode; this.lines = null; this.active = -1;
    this.msg('Loading lyrics…', '', true);
    let data;
    try { data = await getLyrics(t); } catch { data = { error: true }; }
    if (this.trackId !== t.id) return;
    if (data.error) return this.msg('Couldn’t load lyrics', 'Check your connection and try again.');
    if (data.instrumental) return this.msg('Instrumental', 'Enjoy the music ♪');
    if (data.none || (!data.synced && !data.plain)) return this.msg('No lyrics', 'LRCLIB doesn’t have lyrics for this song yet.');
    const box = document.createElement('div'); box.className = 'lyrics';
    const preview = this.player.mode === 'preview';
    if (data.synced && preview) data = { ...data, plain: data.synced.map((x) => x.text).join('\n'), synced: null, previewNote: true };
    if (data.synced) {
      this.lines = data.synced;
      data.synced.forEach((l, i) => {
        const b = document.createElement('button'); b.className = 'lyric' + (l.text ? '' : ' gap'); b.type = 'button';
        b.textContent = l.text || '• • •'; b.dataset.i = i; b.style.setProperty('--b', '2.5px');
        box.appendChild(b);
      });
      box.addEventListener('click', (e) => { const b = e.target.closest('.lyric'); if (b) { this.userScrollUntil = 0; this.player.seek(this.lines[+b.dataset.i].t + 0.01); this.player.play(); } });
    } else {
      box.classList.add('plain');
      data.plain.split(/\n/).forEach((l) => { const p = document.createElement('p'); p.className = 'lyric'; p.textContent = l || '\u00a0'; box.appendChild(p); });
      box.style.paddingTop = '24px';
    }
    const src = document.createElement('p'); src.className = 'lyrics-src';
    src.textContent = data.previewNote ? 'Playing a 30-second preview, so lyrics aren’t synced · from LRCLIB'
      : (data.synced ? 'Synced lyrics' : 'Lyrics (not time-synced)') + ' · from LRCLIB';
    box.appendChild(src);
    const stop = () => { this.userScrollUntil = performance.now() + 3500; };
    box.addEventListener('wheel', stop, { passive: true }); box.addEventListener('touchmove', stop, { passive: true });
    this.host.replaceChildren(box); this.box = box;
    this.sync(true);
  }
  msg(title, sub = '', loading) {
    this.lines = null; this.box = null;
    const d = document.createElement('div'); d.className = 'lyrics-msg';
    d.innerHTML = `<div>${loading ? '' : ''}<span></span><small></small></div>`;
    d.querySelector('span').textContent = title; d.querySelector('small').textContent = sub;
    this.host.replaceChildren(d);
  }
  sync(force) {
    if (!this.lines || !this.box) return;
    const t = this.player.time() + 0.15; const L = this.lines;
    let lo = 0, hi = L.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
    if (idx === this.active && !force) return;
    const kids = this.box.children; const prev = this.active; this.active = idx;
    const from = Math.max(0, Math.min(prev, idx) - 8), to = Math.min(L.length - 1, Math.max(prev, idx) + 8);
    for (let i = (force ? 0 : from); i <= (force ? L.length - 1 : to); i++) {
      const el = kids[i]; if (!el) continue;
      const d = Math.abs(i - idx);
      el.classList.toggle('active', i === idx); el.classList.toggle('past', i < idx);
      el.style.setProperty('--b', i === idx ? '0px' : Math.min(0.6 + d * 0.55, 3.2).toFixed(2) + 'px');
    }
    if (performance.now() < this.userScrollUntil || !this.visible()) return;
    const el = kids[Math.max(idx, 0)]; if (!el) return;
    const top = el.offsetTop - this.box.clientHeight * 0.3;
    this.box.scrollTo({ top, behavior: this.reduce.matches || force ? 'auto' : 'smooth' });
  }
}
