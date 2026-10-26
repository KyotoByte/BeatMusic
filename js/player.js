// Playback engine: full tracks through the official YouTube IFrame Player API; if no playable
// YouTube video can be found (or every candidate refuses embedding), the 30-second preview from
// Deezer/iTunes plays instead and the UI labels it "Preview".
import { resolveYouTube } from './youtube.js';
import { library, store, slim } from './store.js';
import { art } from './api.js';

let ytApi = null;
function loadYT() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { ytApi = null; reject(new Error('YouTube player unavailable')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!window.YT?.Player) { ytApi = null; reject(new Error('YouTube player timeout')); } }, 12000);
  });
  return ytApi;
}

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio; this.yt = null; this.ytReady = null;
    this.queue = []; this.index = -1; this.order = null;
    this.mode = null;            // 'yt' | 'preview' | null
    this.status = 'idle';        // idle | loading | playing | paused | error
    this.shuffle = store.get('shuffle', false); this.repeat = store.get('repeat', 'off');
    this.volume = store.get('volume', 100);
    this.cands = []; this.candIdx = 0; this.token = 0; this.videoId = null; this.lastErr = null;
    this.audio.volume = this.volume / 100;
    this.audio.addEventListener('playing', () => this.mode === 'preview' && this.setStatus('playing'));
    this.audio.addEventListener('pause', () => this.mode === 'preview' && !this.audio.ended && this.setStatus('paused'));
    this.audio.addEventListener('ended', () => this.mode === 'preview' && this.ended());
    this.audio.addEventListener('error', () => { if (this.mode === 'preview' && this.audio.src) { this.setStatus('error'); this.toast('This song can’t be played here'); } });
    this.audio.addEventListener('loadedmetadata', () => this.emit('time'));
    this.tick = this.tick.bind(this); this._tickOn = false;
    this.mediaSession();
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  toast(m) { this.emit('toast', m); }
  get current() { return this.queue[this.index] || null; }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('state'); } if (s === 'playing') this.startTick(); }

  // ---------- queue ----------
  playList(tracks, start = 0, opts = {}) {
    if (!tracks?.length) return;
    this.queue = tracks.map(slim); this.index = Math.max(0, Math.min(start, tracks.length - 1));
    if (opts.shuffle !== undefined) { this.shuffle = opts.shuffle; store.set('shuffle', this.shuffle); }
    if (this.shuffle) this.shuffleRest();
    this.emit('queue'); this.load();
  }
  shuffleRest() {
    const cur = this.queue[this.index]; const rest = this.queue.filter((_, i) => i !== this.index);
    for (let i = rest.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = this.queue.slice(); this.queue = cur ? [cur, ...rest] : rest; this.index = cur ? 0 : -1;
  }
  toggleShuffle() {
    this.shuffle = !this.shuffle; store.set('shuffle', this.shuffle);
    if (this.shuffle) this.shuffleRest();
    else if (this.order) { const cur = this.current; this.queue = this.order.filter((t) => this.queue.some((q) => q.id === t.id)); this.index = Math.max(0, this.queue.findIndex((t) => t.id === cur?.id)); this.order = null; }
    this.emit('queue'); this.emit('state');
  }
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; store.set('repeat', this.repeat); this.emit('state'); }
  playNext(t) { if (this.index < 0) return this.playList([t]); this.queue.splice(this.index + 1, 0, slim(t)); this.emit('queue'); this.toast('Playing next'); }
  addToQueue(t) { if (this.index < 0) return this.playList([t]); this.queue.push(slim(t)); this.emit('queue'); this.toast('Added to queue'); }
  removeAt(i) {
    if (i === this.index || i < 0 || i >= this.queue.length) return;
    this.queue.splice(i, 1); if (i < this.index) this.index--; this.emit('queue');
  }
  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length) return;
    const [t] = this.queue.splice(from, 1); this.queue.splice(to, 0, t);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.emit('queue');
  }
  jump(i) { if (i >= 0 && i < this.queue.length) { this.index = i; this.emit('queue'); this.load(); } }
  next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === 'all' || !auto) this.index = 0;
    else { this.pause(); this.seek(0); return; }
    this.emit('queue'); this.load();
  }
  prev() {
    if (this.time() > 3 || this.index <= 0) { this.seek(0); this.play(); return; }
    this.index--; this.emit('queue'); this.load();
  }
  ended() {
    if (this.repeat === 'one') { this.seek(0); this.play(); return; }
    this.next(true);
  }

  // ---------- loading ----------
  async load() {
    const t = this.current; if (!t) return;
    const tok = ++this.token;
    this.stopEngines(); this.mode = null; this.videoId = null; this.cands = []; this.candIdx = 0;
    this.setStatus('loading'); this.emit('track'); this.updateMetadata();
    library.addRecent(t);
    let ids = [];
    try { ids = await resolveYouTube(t); } catch (e) { this.lastErr = e.message; }
    if (tok !== this.token) return;
    if (ids.length) {
      try { await this.ensureYT(); } catch (e) { ids = []; this.lastErr = e.message; }
    }
    if (tok !== this.token) return;
    this.cands = ids;
    if (ids.length) this.tryCandidate(tok); else this.playPreview(tok, 'No full-length source found');
  }
  tryCandidate(tok) {
    if (tok !== this.token) return;
    const id = this.cands[this.candIdx];
    if (!id) return this.playPreview(tok, 'Full song isn’t embeddable');
    this.mode = 'yt'; this.videoId = id; this.emit('source');
    this.yt.loadVideoById({ videoId: id, startSeconds: 0 });
    this.startTick();
    this.yt.setVolume(this.volume); this.yt.unMute?.();
  }
  playPreview(tok, why) {
    if (tok !== this.token) return;
    const t = this.current;
    if (!t?.preview) { this.mode = null; this.setStatus('error'); this.emit('source'); this.toast(why + ' and no preview exists'); return; }
    this.mode = 'preview'; this.emit('source');
    this.audio.src = t.preview; this.audio.currentTime = 0;
    this.audio.play().catch(() => this.setStatus('paused'));
  }
  ensureYT() {
    if (this.ytReady) return this.ytReady;
    this.ytReady = loadYT().then((YT) => new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error('YouTube player timeout')), 12000);
      this.yt = new YT.Player('yt-host', {
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0, origin: location.origin },
        events: {
          onReady: () => { clearTimeout(tm); this.yt.setVolume(this.volume); resolve(this.yt); },
          onStateChange: (e) => this.onYTState(e.data),
          onError: (e) => this.onYTError(e.data),
        },
      });
    })).catch((e) => { this.ytReady = null; throw e; });
    return this.ytReady;
  }
  // The IFrame API sometimes drops a state event (seen on desktop: video playing, status stuck on "loading"),
  // which made pause/seek look dead. While loading, read the real state from the player itself.
  syncYTState() {
    if (this.mode !== 'yt' || this.status !== 'loading' || !this.yt?.getPlayerState) return;
    let s; try { s = this.yt.getPlayerState(); } catch { return; }
    if (s === 1) this.setStatus('playing'); else if (s === 2) this.setStatus('paused');
  }
  onYTState(s) {
    if (this.mode !== 'yt') return;
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (s === 1) this.setStatus('playing');
    else if (s === 2) this.setStatus('paused');
    else if (s === 3) this.setStatus('loading');
    else if (s === 0) this.ended();
    else if (s === 5 || s === -1) { if (this.status === 'loading' && s === 5) this.setStatus('paused'); }
    this.emit('time');
  }
  onYTError(code) {
    if (this.mode !== 'yt') return;
    // 2 bad id, 5 html5 error, 100 removed/private, 101/150 embedding disabled by the owner
    this.lastErr = 'YouTube error ' + code; this.candIdx++;
    this.tryCandidate(this.token);
  }
  stopEngines() {
    try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch {}
    try { this.yt?.stopVideo?.(); } catch {}
  }

  // ---------- transport ----------
  play() {
    if (this.index < 0) return;
    if (this.mode === 'yt') this.yt?.playVideo();
    else if (this.mode === 'preview') this.audio.play().catch(() => {});
    else if (this.status === 'error') this.load();
  }
  pause() { if (this.mode === 'yt') this.yt?.pauseVideo(); else if (this.mode === 'preview') this.audio.pause(); }
  toggle() {
    this.syncYTState();
    if (this.status === 'playing' || (this.status === 'loading' && this.mode)) this.pause(); else this.play();
  }
  time() {
    if (this.mode === 'yt') return this.yt?.getCurrentTime?.() || 0;
    if (this.mode === 'preview') return this.audio.currentTime || 0;
    return 0;
  }
  duration() {
    if (this.mode === 'yt') return this.yt?.getDuration?.() || this.current?.duration || 0;
    if (this.mode === 'preview') return isFinite(this.audio.duration) ? this.audio.duration : 30;
    return this.current?.duration || 0;
  }
  seek(s) {
    s = Math.max(0, s);
    if (this.mode === 'yt') this.yt?.seekTo(s, true);
    else if (this.mode === 'preview') this.audio.currentTime = Math.min(s, this.duration() - 0.1);
    this.emit('time');
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, v)); store.set('volume', this.volume);
    this.audio.volume = this.volume / 100; try { this.yt?.setVolume(this.volume); } catch {}
  }
  startTick() { if (!this._tickOn) { this._tickOn = true; this._last = 0; requestAnimationFrame(this.tick); } }
  tick(now) {
    if (this.status !== 'playing' && this.status !== 'loading') { this._tickOn = false; this.emit('time'); return; }
    if (now - this._last > (document.hidden ? 1000 : 120)) { this._last = now; this.syncYTState(); this.emit('time'); this.positionState(); }
    requestAnimationFrame(this.tick);
  }

  // ---------- lock screen / hardware keys ----------
  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession; const h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    h('play', () => this.play()); h('pause', () => this.pause());
    h('previoustrack', () => this.prev()); h('nexttrack', () => this.next());
    h('seekto', (d) => this.seek(d.seekTime)); h('seekbackward', (d) => this.seek(this.time() - (d.seekOffset || 10)));
    h('seekforward', (d) => this.seek(this.time() + (d.seekOffset || 10)));
    this.addEventListener('state', () => { ms.playbackState = this.status === 'playing' ? 'playing' : this.status === 'paused' ? 'paused' : 'none'; });
  }
  updateMetadata() {
    const t = this.current; if (!t || !('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '',
      artwork: [256, 512].map((s) => ({ src: art(t.artwork, s), sizes: `${s}x${s}`, type: 'image/jpeg' })) });
  }
  positionState() {
    try { const d = this.duration(); if (d > 0 && navigator.mediaSession?.setPositionState) navigator.mediaSession.setPositionState({ duration: d, position: Math.min(this.time(), d), playbackRate: 1 }); } catch {}
  }
}
