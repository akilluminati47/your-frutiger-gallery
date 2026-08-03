// Cloudflare Pages Function — GET /api/shot?url=<target>&w=&h=&fresh=
//
// A server-side capture proxy with an edge cache. Two problems it solves:
//
//   1. Quota. In the browser, EVERY visitor fires a fresh microlink capture for
//      every slab, so microlink's free 50/day is gone in ~3 page loads and the
//      gallery falls back to worse providers. Here the capture runs once and the
//      image is cached at the Cloudflare edge for a day, so all visitors SHARE
//      it — ~one microlink call per site per day instead of one per page load.
//
//   2. CORS. The browser can't read a mShots/thum.io image via fetch (no CORS
//      headers), which is why those never decoded client-side. A server-side
//      fetch has no such limit, so the fallback chain actually works here.
//
// Chain: microlink (sharp crops) first, then thum.io only as a deep last resort
// — with the cache in front, microlink almost always wins, so thum.io's crop
// effectively never shows. Every response carries x-fg-provider so you can see
// which one answered. On total failure a 502 lets the gallery show its backdrop.

const MIN_IMAGE_BYTES = 1500;   // smaller than this = an error/placeholder, not a real shot

function clampInt(v, lo, hi, dflt){
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
function withProtocol(u){ return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

// Every provider caches its render PER EXACT TARGET URL, so the only reliable
// way to ask for a new picture is to ask about a slightly different URL. That
// key is shared by both providers here (and matches /thumbs' own buster), so a
// world renders ONCE per bucket no matter who asks:
//   · ordinary request → the UTC day bucket: at most 24h stale, which is the
//     cycle the KV store, the cron and the gallery all already assume;
//   · forced request (?fresh=<key>) → the caller's own key: /thumbs' Fetch
//     sends a nonce (a genuinely new render — what Fetch means), the nightly
//     cron sends the day bucket so it shares the day's render instead of
//     doubling it.
// The site ignores the unknown param, so it costs nothing and changes nothing.
const dayBucket = () => 'd' + Math.floor(Date.now() / 864e5);
function keyedTarget(full, fresh){
  return `${full}${full.includes('?') ? '&' : '?'}fgshot=${encodeURIComponent(fresh || dayBucket())}`;
}

function providerURL(provider, target, w, h, fresh){
  const full = keyedTarget(withProtocol(target), fresh);
  const enc  = encodeURIComponent(full);
  switch (provider){
    case 'microlink':
      return `https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`
           + `&viewport.width=${w}&viewport.height=${h}&viewport.deviceScaleFactor=1`
           + `&waitUntil=networkidle0&waitForTimeout=2500&meta=false`;
    case 'thumio':
      // maxAge is thum.io's OWN per-URL cache window, and it is NOT a refresh
      // knob: measured against a live clock page, `maxAge/0` replays the same
      // byte-identical render minutes later, exactly like `maxAge/86400`. That
      // is what let a held-to-thumio world serve a render from WEEKS ago while
      // every timestamp downstream said "captured today" — the nightly cron
      // faithfully re-uploaded thum.io's frozen picture under a fresh ts. The
      // keyed target above is the real fix (a new URL is the only thing that
      // gets a new render); maxAge stays low so it can only ever help.
      return `https://image.thum.io/get/width/${w}/crop/${h}/viewportWidth/${w}/viewportHeight/${h}`
           + `/wait/18/maxAge/0/png/noanimate/${full}`;
  }
}

async function tryCapture(provider, target, w, h, fresh){
  try {
    const res = await fetch(providerURL(provider, target, w, h, fresh), { redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < MIN_IMAGE_BYTES) return null;   // reject tiny placeholders
    return { buf, type };
  } catch { return null; }
}

export async function onRequestGet({ request, waitUntil }){
  const u = new URL(request.url);
  const target = u.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  const w = clampInt(u.searchParams.get('w'), 320, 1600, 1280);
  const h = clampInt(u.searchParams.get('h'), 180, 1000, 720);
  const fresh = u.searchParams.get('fresh') || '';   // present → bypass + refresh the cache

  const pinned = u.searchParams.get('prov') === 'thumio';
  const cache = caches.default;
  // Cache key is the normalised target+size only (no fresh key), so a forced
  // refresh overwrites the entry every visitor then reads. The thum.io PIN gets
  // its own key family: a pinned request wants SPECIFICALLY thum.io's render
  // (held worlds refresh through it), and must never be answered with a
  // day-pinned microlink entry sitting under the shared key.
  // The DAY BUCKET rides the key too. Without it a day-rotated render (see
  // keyedTarget) still had to wait out the previous day's edge entry — up to a
  // second 24h of staleness stacked on top of the first. Now the edge entry
  // rotates with the render it holds, so "one fresh render per world per day"
  // is true end to end.
  const cacheKey = new Request(`https://fg-shot.cache/${encodeURIComponent(target)}?w=${w}&h=${h}&b=${dayBucket()}${pinned ? '&prov=thumio' : ''}`);

  if (!fresh){
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  // ?prov=thumio pins the chain to thum.io alone — the /thumbs Swap pill wants
  // SPECIFICALLY the other provider's render, not whichever answers first (and
  // the browser can't fetch thum.io itself: its hotlink guard 403s cross-origin
  // fetch() while a server-side request sails through).
  const chain = pinned ? ['thumio'] : ['microlink', 'thumio'];
  for (const provider of chain){
    const shot = await tryCapture(provider, target, w, h, fresh);
    if (!shot) continue;
    // A microlink (good) crop pins for a day; a thum.io FALLBACK pins only
    // briefly, so once microlink's daily quota resets the next capture upgrades
    // the cache to the sharp crop instead of staying stuck on thum.io for 24h.
    // A PINNED thum.io render is the deliberate ask (held worlds) — it keeps
    // the full day under its own key, one render per world per day.
    const maxAge = (provider === 'microlink' || pinned) ? 86400 : 1200;
    const resp = new Response(shot.buf, {
      headers: {
        'content-type': shot.type,
        'cache-control': `public, max-age=${maxAge}`,
        'access-control-allow-origin': '*',
        'x-fg-provider': provider,
      },
    });
    waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }
  return new Response('capture failed', { status: 502 });
}
