// Keeps a deployment's shared thumbnail store (/api/thumb) warm on a schedule.
//
// Run by .github/workflows/thumbs-cron.yml once a day. For each world it fills
// BOTH of the store's slots — the ACTIVE crop and the PARKED (alt) one:
//   1. GETs /api/thumb?url= for the current crop, an upload token, and
//      x-thumb-prov-want — the world's PINNED provider (an owner.config
//      thumbLock, else the store's own thum.io hold, else microlink);
//   2. captures that pinned provider and PUTs it as the ACTIVE crop — or, if
//      the capture fails, re-PUTs the existing bytes so a good crop never
//      silently expires on a low-traffic day;
//   3. captures the OTHER provider and PUTs it with ?alt=1, so the /thumbs
//      Swap option stays fresh instead of quietly expiring on its own 24h TTL.
//
// Doing both costs no extra microlink quota. Exactly one of {pinned, other} is
// microlink, so it is still ONE microlink capture per world from the runner's
// IP (which has real quota, unlike Cloudflare's shared one); the thum.io side
// rides the site's own /api/shot proxy, which is keyless and quota-free.
//
// Why it must read the pin rather than always shooting microlink (what it used
// to do): the store lets only the pinned provider hold the active slot. On a
// pinned thum.io world a microlink PUT just parks as the spare — so the crop
// this job exists to maintain was the one crop it could never touch, and it sat
// there expiring until some visitor happened to re-capture it. Reading the pin
// also means a world pinned AFTER its crop was taken converges on the next run.
//
// Best-effort throughout: a failed capture falls back to the re-touch, and a
// world with nothing to keep alive is simply skipped (a real visitor fills it).
// Needs one env var, SITE_URL (e.g. https://akilluminati47.pages.dev); no
// secrets — the upload token is issued by the site itself.
//
// Node 18+ (global fetch). Usage: SITE_URL=https://… node tools/capture-thumbs.mjs

const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '');
if (!SITE){ console.log('SITE_URL not set — nothing to do.'); process.exit(0); }

const SHOT_W = 1600, SHOT_H = 900;
const withProto = u => /^https?:\/\//i.test(u) ? u : 'https://' + u;
const enc = encodeURIComponent;
const dayKey = () => Math.floor(Date.now() / 864e5);   // rotates with the store's 24h TTL
const microlinkURL = url => {
  // Daily-rotating target key (matches the /api/thumb 24h TTL): microlink caches
  // its render per URL, so a bare URL would let a since-fixed page — e.g. the
  // template back when it leaked the owner's config — sit in microlink's cache
  // and get re-uploaded here as "fresh" every night. One key per day caps that
  // at 24h and costs no extra quota (the site ignores the unknown param).
  const full = withProto(url);
  const target = `${full}${full.includes('?') ? '&' : '?'}fgday=${dayKey()}`;
  return `https://api.microlink.io/?url=${enc(target)}&screenshot=true&embed=screenshot.url`
    + `&viewport.width=${SHOT_W}&viewport.height=${SHOT_H}&viewport.deviceScaleFactor=1`
    + `&waitUntil=networkidle0&waitForTimeout=2500&meta=false`;
};
// thum.io renders only through the site's own proxy (its hotlink guard 403s a
// direct cross-origin fetch), which is exactly what makes this side free. The
// prov pin gets its own edge-cache family there, and fresh= rotates daily so
// the proxy can never hand back a render older than the cycle being refreshed.
const thumioURL = url =>
  `${SITE}/api/shot?url=${enc(withProto(url))}&w=${SHOT_W}&h=${SHOT_H}&prov=thumio&fresh=d${dayKey()}`;

async function capture(url, prov){
  try {
    const r = await fetch(prov === 'thumio' ? thumioURL(url) : microlinkURL(url));
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1500 ? { buf, type } : null;
  } catch { return null; }
}

// alt=1 parks the crop in the spare slot; without it the store applies its own
// rule — the pinned provider takes the active slot, anything else parks anyway
async function put(url, token, prov, img, alt){
  try {
    const r = await fetch(`${SITE}/api/thumb?url=${enc(url)}&t=${enc(token)}&prov=${prov}${alt ? '&alt=1' : ''}`,
                          { method:'PUT', body: img.buf, headers:{ 'content-type': img.type } });
    return r.ok;
  } catch { return false; }
}

// World list: prefer the site's own resolved owner config, else scrape config.js.
async function worlds(){
  const urls = new Set();
  try {
    const r = await fetch(`${SITE}/api/owner-config`);
    if (r.ok){
      const cfg = await r.json();
      for (const p of cfg.projects || []) if (p.url) urls.add(p.url.trim());
      for (const s of ['west','east']){ const w = cfg.walls?.[s]; if (w?.on && w.url && !w.live) urls.add(w.url.trim()); }
    }
  } catch {}
  if (!urls.size){
    try {
      const txt = await (await fetch(`${SITE}/config.js`)).text();
      const proj = txt.slice(txt.indexOf('projects'), txt.indexOf('walls') > 0 ? txt.indexOf('walls') : undefined);
      for (const m of proj.matchAll(/url:\s*["'`]([^"'`]+)["'`]/g)) urls.add(m[1].trim());
      const walls = txt.slice(txt.indexOf('walls'));
      for (const m of walls.matchAll(/url:\s*["'`]([^"'`]+)["'`]/g)){
        // only http(s) targets, and skip the sourceRepo/template links that aren't slabs
        if (/^https?:\/\//i.test(m[1])) urls.add(m[1].trim());
      }
    } catch {}
  }
  return [...urls];
}

async function warmOne(url){
  // current crop + upload token + the world's PINNED provider (x-thumb-prov-want:
  // an owner.config thumbLock, else the store's thum.io hold; absent = microlink)
  let token = null, existing = null, existingType = 'image/png', existingProv = 'microlink', want = null;
  try {
    const g = await fetch(`${SITE}/api/thumb?url=${enc(url)}`, { cache:'no-store' });
    token = g.headers.get('x-thumb-ask');
    want  = g.headers.get('x-thumb-prov-want');
    if (g.ok){
      existing = Buffer.from(await g.arrayBuffer());
      existingType = g.headers.get('content-type') || existingType;
      existingProv = g.headers.get('x-thumb-prov') || existingProv;
    }
  } catch {}
  if (!token){ return 'no-store'; }   // KV not bound on this deployment

  const active = want === 'thumio' ? 'thumio' : 'microlink';
  const other  = active === 'thumio' ? 'microlink' : 'thumio';

  // ── the ACTIVE slot: this world's own pinned provider ──
  let state;
  const hot = await capture(url, active);
  if (hot) state = await put(url, token, active, hot, false) ? 'fresh' : 'put-failed';
  else if (existing && existingProv === active)
    // re-touch to reset the TTL so a good crop never silently expires on a bad
    // capture day — but only when it IS the pinned provider's crop. Re-PUTting
    // the other one would merely park it and leave the active slot expiring.
    state = await put(url, token, existingProv, { buf: existing, type: existingType }, false) ? 'kept' : 'put-failed';
  else state = 'skip';                // capture failed and nothing worth keeping

  // ── the PARKED slot: the other provider, so ⇄ Swap stays instant ──
  // The spare carries the same 24h TTL as the active crop, so it needs its own
  // refresh or the Swap option quietly expires between visits.
  const cold = await capture(url, other);
  const alt  = cold ? await put(url, token, other, cold, true) : false;

  return `${state}/${alt ? 'alt' : 'no-alt'}`;
}

const list = await worlds();
if (!list.length){ console.log('No worlds resolved from', SITE); process.exit(0); }
console.log(`Warming ${list.length} thumbnails on ${SITE} — both providers per world`);
const tally = {};
for (const url of list){
  const r = await warmOne(url);
  tally[r] = (tally[r] || 0) + 1;
  console.log(`  ${r.padEnd(14)} ${url}`);
  // gentle on microlink's burst limit — still exactly ONE microlink capture per
  // world (the pinned side or the parked side, never both), so this paces the
  // run the same as it always did
  await new Promise(res => setTimeout(res, 1500));
}
console.log('Done:', JSON.stringify(tally));
