// Effetti sonori del LED. Suonano SOLO sulla pagina /schermo: l'anteprima in Control Room resta muta.
// L'audio esce dalla sorgente web come quello di un contributo video: il tecnico ne regola il volume nel suo mixer.
export function createSounds({ enabled = true, volume = 1 } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const off = { load: async () => {}, play: () => {}, stopAll: () => {}, unlock: () => {}, state: () => 'spento (&audio=0)' };
  if (!enabled || !AC) return enabled ? { ...off, state: () => 'non supportato da questo browser' } : off;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ctx.destination);
  const buffers = {};
  const live = new Set();

  async function load(map) {
    await Promise.all(Object.entries(map || {}).map(async ([name, url]) => {
      if (!url || buffers[name]) return;
      try {
        const r = await fetch(/^(data:|https?:|\/)/.test(url) ? url : '/' + url);
        buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* suono mancante: si va avanti in silenzio */ }
    }));
  }

  /** Suona `name` tra `at` secondi; se `stopAt` è dato, sfuma e si ferma a quel punto. Se il browser blocca l'audio non suona (niente suoni in ritardo). */
  function play(name, { at = 0, stopAt = null, gain = 1 } = {}) {
    const b = buffers[name];
    if (!b || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = b;
    g.gain.value = gain;
    src.connect(g).connect(master);
    const t0 = ctx.currentTime + Math.max(0, at);
    src.start(t0);
    if (stopAt != null) {
      const t1 = ctx.currentTime + stopAt;
      g.gain.setValueAtTime(gain, Math.max(t0, t1 - 0.12));
      g.gain.linearRampToValueAtTime(0, t1);
      src.stop(t1 + 0.05);
    }
    const item = { src, g };
    live.add(item);
    src.onended = () => live.delete(item);
  }

  /** Ferma tutto con una sfumatura breve (cambio scena). */
  function stopAll(fade = 0.25) {
    const now = ctx.currentTime;
    for (const { src, g } of live) {
      try { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + fade); src.stop(now + fade + 0.05); } catch { /* già fermo */ }
    }
    live.clear();
  }

  const unlock = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
  const state = () => (ctx.state === 'running' ? 'attivo' : 'BLOCCATO dal browser: premi un tasto o clicca la pagina');
  return { load, play, stopAll, unlock, state };
}
