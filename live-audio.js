/* ════════════════════════════════════════════════════════════════
   live-audio.js — directional sound for a page hung on a live wall

   The gallery embeds live walls as cross-origin iframes, and no web
   API lets the embedder touch a cross-origin page's audio. So the
   hall streams PLACEMENT instead: postMessage {type:'fg-audio',
   gain, pan} at ~10 Hz — gain falls with distance and ducks behind
   the visitor's head, pan follows which ear the slab hangs off, and
   the hall's own volume slider rides along. This file is the
   receiving half. Drop it in EARLY (a <script> in <head>, before any
   audio code runs) and the page's sound follows the visitor around
   the hall; standalone (not framed) it does nothing at all.

     <script src="live-audio.js"></script>

   What it catches, in order of fidelity:
   • the page's own WebAudio — AudioNode.connect is patched so any
     node aimed at ctx.destination is rerouted through a gain→pan
     tap instead (gain AND pan apply)
   • <audio>/<video> whose media the page may legally process
     (same-origin, blob/data, or crossorigin-attributed) — adopted
     into the same tap via createMediaElementSource (gain AND pan)
   • any other media element — plain volume ducking (gain only;
     never routed through WebAudio, where non-CORS media would go
     silent instead of quiet)
   ════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  if (window.top === window) return;   // standalone — the hall isn't out there

  let want = { gain: 1, pan: 0 };      // last placement heard (unity until told)
  const taps = new Map();              // AudioContext → { g: GainNode, p: StereoPanner|null }
  const ducked = new Set();            // media elements we could only volume-duck
  const wired = new WeakSet();         // media elements already adopted either way
  let mediaCtx = null;                 // lazy shared context for adopted media

  const RAW_CONNECT = AudioNode.prototype.connect;

  // one gain→pan pair per context, sitting just before the speakers; every
  // tap node is wired with RAW_CONNECT so the patch below can never recurse
  function tapFor(ctx){
    let t = taps.get(ctx);
    if (t) return t;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    g.gain.value = want.gain;
    if (p){ p.pan.value = want.pan; RAW_CONNECT.call(g, p); RAW_CONNECT.call(p, ctx.destination); }
    else RAW_CONNECT.call(g, ctx.destination);
    t = { g, p };
    taps.set(ctx, t);
    return t;
  }

  // the page's own WebAudio: anything it aims at the speakers detours through
  // the tap. Offline renders pass through untouched — placement is a live-
  // playback affair, and ducking a render would bake the hall into a file.
  AudioNode.prototype.connect = function(dest, ...rest){
    if (dest instanceof AudioDestinationNode &&
        !(window.OfflineAudioContext && dest.context instanceof OfflineAudioContext)){
      return RAW_CONNECT.call(this, tapFor(dest.context).g);
    }
    return RAW_CONNECT.call(this, dest, ...rest);
  };

  // media the page may process gets the full gain+pan graph; media it may NOT
  // (cross-origin src, no CORS opt-in) would play SILENCE through WebAudio,
  // so that falls back to el.volume — quiet beats gone
  function mayProcess(el){
    if (el.crossOrigin != null) return true;
    const s = el.currentSrc || el.src || '';
    if (!s || s.startsWith('blob:') || s.startsWith('data:')) return true;
    try { return new URL(s, location.href).origin === location.origin; } catch { return false; }
  }
  function adopt(el){
    if (wired.has(el)) return;
    wired.add(el);
    if (mayProcess(el)){
      try {
        mediaCtx = mediaCtx || new (window.AudioContext || window.webkitAudioContext)();
        RAW_CONNECT.call(mediaCtx.createMediaElementSource(el), tapFor(mediaCtx).g);
        if (mediaCtx.state === 'suspended') mediaCtx.resume().catch(() => {});
        return;
      } catch { /* already sourced elsewhere — duck it instead */ }
    }
    ducked.add(el);
    el.volume = want.gain;
  }
  // catch elements as they start (capture phase sees every play in the doc),
  // plus whatever is already sounding when this file loads late
  addEventListener('play', e => { if (e.target instanceof HTMLMediaElement) adopt(e.target); }, true);
  addEventListener('DOMContentLoaded', () => {
    for (const el of document.querySelectorAll('audio, video')) if (!el.paused) adopt(el);
  });

  // the placement stream: smooth every hop (~10 Hz) over ~90 ms so walking
  // reads as a glide, not a zipper. Any embedder may send this — the worst a
  // stranger can do is turn the page it already embeds down, so no origin gate.
  addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'fg-audio' || !isFinite(d.gain) || !isFinite(d.pan)) return;
    want = {
      gain: Math.min(Math.max(+d.gain, 0), 1),
      pan:  Math.min(Math.max(+d.pan, -1), 1),
    };
    for (const [ctx, t] of taps){
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      t.g.gain.setTargetAtTime(want.gain, t0, 0.09);
      if (t.p) t.p.pan.setTargetAtTime(want.pan, t0, 0.09);
    }
    for (const el of ducked) el.volume = want.gain;
  });
})();
