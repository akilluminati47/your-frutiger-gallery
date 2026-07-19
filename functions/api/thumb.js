// Shared, self-populating thumbnail cache — Workers KV-backed (binding: env.THUMBS).
//
// The idea: microlink's free tier is 50/day PER IP, and a Cloudflare Function
// egresses from a shared, always-429'd IP — so the SERVER can't capture. But a
// GUEST'S browser can, from their own fresh-quota IP. So each guest captures the
// crops their visit needs, then UPLOADS them here; every later visitor is served
// the stored copy and never touches microlink. One gallery's guests collectively
// keep its previews fresh, ≤50 captures/day spread across their IPs, and the
// owner can force a refresh from their own IP any time (hold-R). Each fork gets
// its own store the same way.
//
// KV's own 24h TTL IS the refresh cycle: a stored crop auto-expires after a day,
// so the first returning guest past that finds a miss and re-captures. KV is on
// the free Workers plan (no card, unlike R2), plenty for a set of small crops.
//
//   GET /api/thumb?url=<target>
//     • a stored crop (KV TTL keeps it <24h) → 200 image, Cache-Control tuned to
//       expire when the crop does (so a browser re-pings only then).
//     • miss / expired                        → 404 + X-Thumb-Ask: <token>,
//       inviting the client to capture <target> from its own IP and PUT it back.
//   PUT /api/thumb?url=<target>&t=<token>
//     • stores the posted image as the shared copy (token + image + size
//       validated), with a 24h TTL. The next guest past expiry refreshes it.
//
// No KV bound (e.g. a fork that hasn't set it up) → GET always 404, PUT no-ops:
// the client just captures live each visit, exactly as before. Nothing breaks.

const DAY_S   = 86400;
const MAX_BYTES = 3_000_000;        // 3 MB cap per stored crop (KV allows up to 25 MB)
const te = new TextEncoder();

// Up to TWO crops live per world: the ACTIVE one under thumb:<url> (what the
// gallery serves — same key as ever) and the other provider's crop PARKED
// under alt:<url>. PUT ?alt=1 writes the parked slot directly (never touching
// the active crop), and PUT ?swap=1 exchanges the two — the /thumbs Swap pill
// rides on that. Clients now capture BOTH providers per fetch (the preferred
// one for the active slot, the other straight into alt), so a Swap is a pure
// server-side exchange with the option already sitting there.
//
// The /thumbs toggle OWNS the active slot. A world held to thum.io carries
// prov:<url> (no TTL — it outlives every 24h crop cycle), written on /thumbs
// via a hold=1 Fetch or a Swap that lands on thum.io; no key = microlink, the
// default. Above BOTH sits owner.config.json's thumbLock (see ownerLocks): a
// world pinned there ignores the hold entirely — that is what keeps a visitor's
// auto-refresh, a /thumbs Fetch and the cron all on one provider without any of
// them having to agree first. A PUT from the NON-preferred provider can never take the active
// slot — it parks as alt — so gallery visitors' auto-captures can't bump what
// the owner picked, even when the active crop has expired. Sole exception: an
// UNHELD world with an EMPTY slot takes a thum.io fallback (short TTL) — a
// weak crop now beats a blank slab, and microlink reclaims the slot in hours.
//   · a GET miss answers x-thumb-prov-want: thumio for held worlds, so the
//     refreshing client captures through the pinned quota-free proxy route;
//   · every GET reports x-thumb-alt (the parked crop's provider) so clients
//     backfill the missing side of the pair in the background.
// Swapping back to microlink (or a hold=1 microlink Fetch) deletes the key.
// ── owner-config provider locks (thumbLock) ───────────────────────────────
// A world may be pinned to one capture provider in owner.config.json. That is
// the owner's STANDING pick, so it outranks the store's own prov:<url> hold
// everywhere the hold is consulted — GET's x-thumb-prov-want and PUT's
// active-slot guard. Resolving it HERE is what puts every path on one
// provider: a visitor's auto-refresh reads the want header, the cron and the
// gallery both PUT through the same guard, and /thumbs greys its Swap out. No
// client has to agree, and no hold has to be converged first.
// Read from the same places, in the same order, as the site itself: the
// OWNER_CONFIG secret when set, else the deployment's own committed
// owner.config.json. A fork/template tracks no such file and sets no secret →
// no locks → the store's hold stands alone, exactly as before.
// Cached per isolate: the file is a static asset of THIS deployment, so it
// cannot change under us without a new deployment.
const withProto = u => /^https?:\/\//i.test(u) ? u : 'https://' + u;
const LOCKS_TTL_MS = 60_000;
let _locks = null, _locksAt = 0;
async function ownerLocks(env, request){
  if (_locks && Date.now() - _locksAt < LOCKS_TTL_MS) return _locks;
  const m = new Map();
  try {
    let raw = env.OWNER_CONFIG;
    if (!raw && env.ASSETS){
      const r = await env.ASSETS.fetch(new URL('/owner.config.json', request.url));
      if (r.ok) raw = await r.text();
    }
    if (raw){
      const cfg = JSON.parse(raw);
      const add = w => {
        const l = w?.thumbLock;
        const url = typeof w?.url === 'string' ? w.url.trim() : '';
        if (!url || (l !== 'thumio' && l !== 'microlink')) return;
        m.set(url, l); m.set(withProto(url), l);   // clients key on either form
      };
      (cfg.projects || []).forEach(add);
      for (const s of ['west', 'east']) add(cfg.walls?.[s]);
    }
  } catch { /* no config / unreadable / bad json → no locks, hold stands alone */ }
  _locks = m; _locksAt = Date.now();
  return m;
}

const objKey  = url => 'thumb:' + url;
const altKey  = url => 'alt:' + url;
const prefKey = url => 'prov:' + url;
const provOf = m => m?.prov || 'microlink';   // legacy crops predate the tag; only microlink wins were ever uploaded
const slotNow = () => Math.floor(Date.now() / (DAY_S * 1000));   // rotating 24h bucket

// which provider's crop is PARKED in the alt slot (null = empty) — a metadata
// list read, so checking never pulls the image bytes. Exact-name check because
// one url can be a prefix of another (alt:a.com vs alt:a.com/b).
async function altProvOf(store, target){
  const page = await store.list({ prefix: altKey(target), limit: 1 });
  const k = page.keys?.[0];
  return (k && k.name === altKey(target)) ? provOf(k.metadata) : null;
}

async function token(secret, url, slot){
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(`${url}|${slot}`));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function onRequest({ request, env }){
  const store  = env.THUMBS;                          // KV namespace binding (optional)
  const secret = env.THUMB_SIGN || 'fg-thumb-dev';    // HMAC secret for upload invites
  const u = new URL(request.url);

  // ── list what's stored (for the /thumbs dashboard) ──
  if (request.method === 'GET' && u.searchParams.has('list')){
    if (!store) return Response.json({ bound: false, thumbs: [] });
    const out = [];
    let cursor;
    do {
      const page = await store.list({ prefix: 'thumb:', cursor });
      for (const k of page.keys){
        out.push({
          url: k.name.slice(6),                       // strip 'thumb:'
          ts: k.metadata?.ts || null,
          contentType: k.metadata?.contentType || null,
          prov: provOf(k.metadata),                   // which provider captured the ACTIVE crop
          expiration: k.expiration || null,
        });
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    // held worlds (prov:<url> keys, TTL-less) — the dashboard shows the hold
    // even when the crop itself has cycled out
    const held = [];
    let c2;
    do {
      const page = await store.list({ prefix: 'prov:', cursor: c2 });
      for (const k of page.keys) held.push(k.name.slice(5));
      c2 = page.list_complete ? null : page.cursor;
    } while (c2);
    return new Response(JSON.stringify({ bound: true, thumbs: out, held }), {
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    });
  }

  const target = u.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  // ── serve the PARKED (alt / Swap) crop's own bytes ──
  // The active GET only reports the parked provider in x-thumb-alt, never its
  // image. The keep-warm cron needs the bytes so it can RE-TOUCH the spare (reset
  // its 24h TTL) on a day the "other provider" capture is down — the same failsafe
  // the active slot already gets, so the Swap option never silently expires either.
  // Always hands out an upload token so the caller can re-PUT ?alt=1.
  if (request.method === 'GET' && u.searchParams.get('alt')){
    const h = {
      'x-thumb-ask': await token(secret, target, slotNow()),
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-thumb-ask, x-thumb-prov',
      'cache-control': 'no-store',
    };
    if (store){
      const { value, metadata } = await store.getWithMetadata(altKey(target), { type: 'arrayBuffer' });
      if (value){
        h['content-type'] = metadata?.contentType || 'image/png';
        h['x-thumb-prov'] = provOf(metadata);
        return new Response(value, { headers: h });
      }
    }
    return new Response('no alt', { status: 404, headers: h });
  }

  // ── serve a stored crop, or invite the client to capture one ──
  if (request.method === 'GET'){
    if (store){
      const { value, metadata } = await store.getWithMetadata(objKey(target), { type: 'arrayBuffer' });
      if (value){
        const ageS = Math.max(0, (Date.now() - (metadata?.ts || 0)) / 1000);
        const [held, alt, locks] = await Promise.all([
          store.get(prefKey(target)), altProvOf(store, target), ownerLocks(env, request),
        ]);
        const want = locks.get(target) || held;   // owner.config outranks the store's hold
        // Cache for MINUTES, not the whole TTL: an uploaded/refreshed crop should
        // reach the gallery quickly, and re-reading KV costs nothing (it never
        // touches microlink — the store existing is what protects the IP quota).
        // stale-while-revalidate keeps it instant while the fresh copy loads.
        const h = {
          'content-type': metadata?.contentType || 'image/png',
          'cache-control': 'public, max-age=300, stale-while-revalidate=600',
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'x-thumb-ask, x-thumb-age, x-thumb-prov, x-thumb-ver, x-thumb-prov-want, x-thumb-alt',
          // still hand out a token so a forced refresh (hold-R) can overwrite
          'x-thumb-ask': await token(secret, target, slotNow()),
          'x-thumb-age': Math.floor(ageS).toString(),
          'x-thumb-prov': provOf(metadata),
          // active-slot version — bumps on any write here (fresh capture OR a
          // Swap promoting an older crop), so a running gallery can detect the
          // change by comparing this alone. Legacy crops (no ver) → capture ts.
          'x-thumb-ver': (metadata?.ver || metadata?.ts || 0).toString(),
        };
        // the hold rides every response so even a forced refresh (hold-R, which
        // skips serving the stored crop) still renders on the held provider
        if (want) h['x-thumb-prov-want'] = want;
        // parked-slot state: present = the pair is complete (Swap is instant),
        // absent = the client should backfill the other provider's crop
        if (alt) h['x-thumb-alt'] = alt;
        return new Response(value, { headers: h });
      }
    }
    // miss / expired / no store → invite a capture (client PUTs it back),
    // naming the world's pinned provider so the refresh honours the owner's pick
    const [held, alt] = store
      ? await Promise.all([store.get(prefKey(target)), altProvOf(store, target)])
      : [null, null];
    const want = (await ownerLocks(env, request)).get(target) || held;
    const h = {
      'x-thumb-ask': await token(secret, target, slotNow()),
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-thumb-ask, x-thumb-prov-want, x-thumb-alt',
      'cache-control': 'no-store',
    };
    if (want) h['x-thumb-prov-want'] = want;
    if (alt) h['x-thumb-alt'] = alt;
    return new Response('capture', { status: 404, headers: h });
  }

  // ── accept a guest's own-IP capture as the new shared copy ──
  if (request.method === 'PUT'){
    if (!store) return new Response('no store', { status: 202 });   // fork without KV → accept-and-drop
    const tok = u.searchParams.get('t') || '';
    // valid for the current or previous 24h slot (tolerates the boundary)
    const ok = tok === await token(secret, target, slotNow())
            || tok === await token(secret, target, slotNow() - 1);
    if (!ok) return new Response('bad token', { status: 403 });

    // ── ?swap=1 (no body): exchange the active crop with the parked one ──
    // The /thumbs Swap pill calls this first; a 404 (nothing parked) tells the
    // client to capture the other provider's crop itself instead. A swap is a
    // deliberate owner choice, so the HOLD follows the new active provider:
    // landing on thum.io pins it for every future auto-refresh, landing back
    // on microlink releases it.
    if (u.searchParams.get('swap')){
      const hdrs = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      // a swap rewrites the hold, so a locked world has nothing to exchange —
      // /thumbs already greys its pill out; this closes the direct call
      const swapLock = (await ownerLocks(env, request)).get(target);
      if (swapLock)
        return new Response(JSON.stringify({ swapped: false, locked: swapLock }), { status: 409, headers: hdrs });
      const [act, alt] = await Promise.all([
        store.getWithMetadata(objKey(target), { type: 'arrayBuffer' }),
        store.getWithMetadata(altKey(target), { type: 'arrayBuffer' }),
      ]);
      if (!alt?.value) return new Response(JSON.stringify({ swapped: false }), { status: 404, headers: hdrs });
      // the promoted crop keeps its capture ts but gets a fresh ver (activation
      // stamp) so a running gallery sees the active slot changed even though the
      // crop itself was captured earlier
      await store.put(objKey(target), alt.value, { expirationTtl: DAY_S, metadata: { ...alt.metadata, ver: Date.now() } });
      if (act?.value) await store.put(altKey(target), act.value, { expirationTtl: DAY_S, metadata: act.metadata });
      else await store.delete(altKey(target));
      const active = provOf(alt.metadata);
      if (active === 'thumio') await store.put(prefKey(target), 'thumio');
      else await store.delete(prefKey(target));
      return new Response(JSON.stringify({ swapped: true, active }), { headers: hdrs });
    }

    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return new Response('not an image', { status: 415 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 1500 || buf.byteLength > MAX_BYTES)
      return new Response('bad size', { status: 413 });

    // which provider rendered this crop — the two-slot store is keyed on it
    const prov = u.searchParams.get('prov') === 'thumio' ? 'thumio' : 'microlink';

    // ── ?alt=1: park this crop in the ALT slot, active crop untouched ──
    // Clients capture BOTH providers per fetch; the non-preferred crop arrives
    // through here so a /thumbs Swap always finds a complete parked pair.
    if (u.searchParams.get('alt')){
      await store.put(altKey(target), buf, {
        expirationTtl: DAY_S, metadata: { contentType: type, ts: Date.now(), prov },
      });
      return new Response('parked', { status: 200, headers: { 'access-control-allow-origin': '*' } });
    }

    // hold=1 marks a DELIBERATE /thumbs fetch: the world's future auto-refresh
    // follows this provider (thum.io pins the hold, microlink releases it).
    // Gallery auto-uploads never send it, so they can't re-pin anything.
    // An owner.config thumbLock is the standing pick and simply wins: no hold
    // write can move it, so the store never records a pin that contradicts the
    // config (drop the lock and whatever was held before is what returns).
    const lock = (await ownerLocks(env, request)).get(target) || null;
    const hold = !!u.searchParams.get('hold');
    if (hold && !lock){
      if (prov === 'thumio') await store.put(prefKey(target), 'thumio');
      else await store.delete(prefKey(target));
    }
    // 'thumio' pins the active slot; null = released (microlink, the default)
    const pref = lock ? (lock === 'thumio' ? 'thumio' : null)
               : hold ? (prov === 'thumio' ? 'thumio' : null)
                      : await store.get(prefKey(target));
    // this world's pick: pinned → thum.io, else microlink
    const prefProv = pref || 'microlink';

    const cur = await store.getWithMetadata(objKey(target), { type: 'arrayBuffer' });
    if (prov !== prefProv){
      // the toggle OWNS the active slot: a non-preferred crop can never take
      // it — not on a held world (even when the active crop has expired; this
      // was the hole that let a visitor's microlink bump a thum.io hold), and
      // never over a crop that's already showing. It parks as alt instead.
      // Sole exception: an UNHELD world with an EMPTY slot takes the thum.io
      // fallback (short TTL below) — a weak crop now beats a blank slab.
      if (pref || cur?.value){
        await store.put(altKey(target), buf, {
          expirationTtl: DAY_S, metadata: { contentType: type, ts: Date.now(), prov },
        });
        return new Response('parked', { status: 200, headers: { 'access-control-allow-origin': '*' } });
      }
    } else if (cur?.value && provOf(cur.metadata) !== prov){
      // the preferred provider reclaims its slot from a stale fallback —
      // park the old crop, so the world keeps one per provider (≤2)
      await store.put(altKey(target), cur.value, { expirationTtl: DAY_S, metadata: cur.metadata });
    }

    // unheld thum.io fallbacks expire early: they self-heal an empty slot NOW,
    // and hand it to the next microlink capture in hours instead of a day
    const ttl = (prov === 'thumio' && pref !== 'thumio') ? 21600 : DAY_S;
    const now = Date.now();
    await store.put(objKey(target), buf, {
      expirationTtl: ttl,                                   // auto-refresh cycle
      metadata: { contentType: type, ts: now, ver: now, prov },   // ver bumps the active slot for live re-checks
    });
    return new Response('stored', { status: 200, headers: { 'access-control-allow-origin': '*' } });
  }

  return new Response('method not allowed', { status: 405 });
}
