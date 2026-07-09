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

function providerURL(provider, target, w, h){
  const full = withProtocol(target);
  const enc  = encodeURIComponent(full);
  switch (provider){
    case 'microlink':
      return `https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`
           + `&viewport.width=${w}&viewport.height=${h}&viewport.deviceScaleFactor=1`
           + `&waitUntil=networkidle0&waitForTimeout=2500&meta=false`;
    case 'thumio':
      return `https://image.thum.io/get/width/${w}/crop/${h}/viewportWidth/${w}`
           + `/wait/18/png/noanimate/${full}`;
  }
}

async function tryCapture(provider, target, w, h){
  try {
    const res = await fetch(providerURL(provider, target, w, h), { redirect: 'follow' });
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

  const cache = caches.default;
  // Cache key is the normalised target+size only (no fresh key), so a forced
  // refresh overwrites the entry every visitor then reads.
  const cacheKey = new Request(`https://fg-shot.cache/${encodeURIComponent(target)}?w=${w}&h=${h}`);

  if (!fresh){
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  for (const provider of ['microlink', 'thumio']){
    const shot = await tryCapture(provider, target, w, h);
    if (!shot) continue;
    // A microlink (good) crop pins for a day; a thum.io fallback pins only
    // briefly, so once microlink's daily quota resets the next capture upgrades
    // the cache to the sharp crop instead of staying stuck on thum.io for 24h.
    const maxAge = provider === 'microlink' ? 86400 : 1200;
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
