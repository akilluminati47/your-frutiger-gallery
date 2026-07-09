// Keeps a deployment's shared thumbnail store (/api/thumb) warm on a schedule.
//
// Run by .github/workflows/thumbs-cron.yml once a day. For each world it:
//   1. GETs /api/thumb?url= to read the current crop (if any) + an upload token,
//   2. tries a fresh microlink capture FROM THE RUNNER'S IP,
//   3. PUTs the fresh crop if that worked; otherwise re-PUTs the existing bytes
//      so a good crop never silently expires on a low-traffic day.
//
// Best-effort: if the runner's IP is microlink-429'd and there's no existing
// crop, that world is simply skipped (a real visitor will fill it). Needs one
// env var, SITE_URL (e.g. https://akilluminati47.pages.dev); no secrets — the
// upload token is issued by the site itself.
//
// Node 18+ (global fetch). Usage: SITE_URL=https://… node tools/capture-thumbs.mjs

const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '');
if (!SITE){ console.log('SITE_URL not set — nothing to do.'); process.exit(0); }

const SHOT_W = 1600, SHOT_H = 900;
const withProto = u => /^https?:\/\//i.test(u) ? u : 'https://' + u;
const microlinkURL = url => {
  // Daily-rotating target key (matches the /api/thumb 24h TTL): microlink caches
  // its render per URL, so a bare URL would let a since-fixed page — e.g. the
  // template back when it leaked the owner's config — sit in microlink's cache
  // and get re-uploaded here as "fresh" every night. One key per day caps that
  // at 24h and costs no extra quota (the site ignores the unknown param).
  const full = withProto(url);
  const target = `${full}${full.includes('?') ? '&' : '?'}fgday=${Math.floor(Date.now() / 864e5)}`;
  return `https://api.microlink.io/?url=${encodeURIComponent(target)}&screenshot=true&embed=screenshot.url`
    + `&viewport.width=${SHOT_W}&viewport.height=${SHOT_H}&viewport.deviceScaleFactor=1`
    + `&waitUntil=networkidle0&waitForTimeout=2500&meta=false`;
};

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
  // current crop + upload token (+ which provider captured it, for a re-touch)
  let token = null, existing = null, existingType = 'image/png', existingProv = 'microlink';
  try {
    const g = await fetch(`${SITE}/api/thumb?url=${encodeURIComponent(url)}`);
    token = g.headers.get('x-thumb-ask');
    if (g.ok){
      existing = Buffer.from(await g.arrayBuffer());
      existingType = g.headers.get('content-type') || existingType;
      existingProv = g.headers.get('x-thumb-prov') || existingProv;
    }
  } catch {}
  if (!token){ return 'no-store'; }   // KV not bound on this deployment

  // fresh microlink capture from the runner's IP
  let fresh = null, freshType = 'image/png';
  try {
    const m = await fetch(microlinkURL(url));
    if (m.ok){
      const ct = m.headers.get('content-type') || '';
      if (ct.startsWith('image/')){ const b = Buffer.from(await m.arrayBuffer()); if (b.length > 1500){ fresh = b; freshType = ct; } }
    }
  } catch {}

  const body = fresh || existing;
  const type = fresh ? freshType : existingType;
  // a fresh capture is always microlink's; a re-touch keeps the crop's own
  // provider tag so the two-slot store never mislabels (or parks) it
  const prov = fresh ? 'microlink' : existingProv;
  if (!body) return 'skip';           // 429 and nothing to keep alive
  try {
    const p = await fetch(`${SITE}/api/thumb?url=${encodeURIComponent(url)}&t=${encodeURIComponent(token)}&prov=${encodeURIComponent(prov)}`,
                          { method:'PUT', body, headers:{ 'content-type': type } });
    if (!p.ok) return 'put-' + p.status;
  } catch { return 'put-error'; }
  return fresh ? 'fresh' : 'kept';
}

const list = await worlds();
if (!list.length){ console.log('No worlds resolved from', SITE); process.exit(0); }
console.log(`Warming ${list.length} thumbnails on ${SITE}`);
const tally = {};
for (const url of list){
  const r = await warmOne(url);
  tally[r] = (tally[r] || 0) + 1;
  console.log(`  ${r.padEnd(9)} ${url}`);
  await new Promise(res => setTimeout(res, 1500));   // gentle on microlink's burst limit
}
console.log('Done:', JSON.stringify(tally));
