// Local persistence: liked songs, recently played, playlists, settings.
const P = 'bm:';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
  del(k) { try { localStorage.removeItem(P + k); } catch {} },
};
const subs = new Set();
export const onLibrary = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

// Keep only what we need to show / replay a track.
export const slim = (t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, artwork: t.artwork, duration: t.duration,
  preview: t.preview, explicit: !!t.explicit, artistId: t.artistId, albumId: t.albumId });

export const library = {
  liked: () => store.get('liked', []),
  isLiked: (id) => store.get('liked', []).some((t) => t.id === id),
  toggleLike(t) {
    let l = this.liked(); const on = l.some((x) => x.id === t.id);
    l = on ? l.filter((x) => x.id !== t.id) : [slim(t), ...l];
    store.set('liked', l); emit(); return !on;
  },
  recent: () => store.get('recent', []),
  addRecent(t) {
    const l = [slim(t), ...this.recent().filter((x) => x.id !== t.id)].slice(0, 60);
    store.set('recent', l); emit();
  },
  clearRecent() { store.set('recent', []); emit(); },
  playlists: () => store.get('playlists', []),
  playlist(id) { return this.playlists().find((p) => p.id === id); },
  createPlaylist(name, tracks = []) {
    const p = { id: 'pl' + Date.now().toString(36), name: name || 'New Playlist', tracks: tracks.map(slim), created: Date.now() };
    store.set('playlists', [...this.playlists(), p]); emit(); return p;
  },
  renamePlaylist(id, name) { store.set('playlists', this.playlists().map((p) => p.id === id ? { ...p, name } : p)); emit(); },
  deletePlaylist(id) { store.set('playlists', this.playlists().filter((p) => p.id !== id)); emit(); },
  addToPlaylist(id, t) {
    store.set('playlists', this.playlists().map((p) => p.id === id ? { ...p, tracks: [...p.tracks.filter((x) => x.id !== t.id), slim(t)] } : p)); emit();
  },
  removeFromPlaylist(id, idx) {
    store.set('playlists', this.playlists().map((p) => p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== idx) } : p)); emit();
  },
  clearAll() { ['liked', 'recent', 'playlists', 'ytmap'].forEach((k) => store.del(k)); emit(); },
};
