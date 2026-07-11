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
// gallery serves — same key as ever) and, when the world has been captured by
// BOTH providers, the other provider's crop PARKED under alt:<url>. A PUT whose
// prov differs from the active crop's parks the old one instead of erasing it,
// and PUT ?swap=1 exchanges the two — the /thumbs Swap pill rides on that.
//
// A world can also be HELD to thum.io: prov:<url> (no TTL — it outlives every
// 24h crop cycle) records the owner's deliberate choice, made on /thumbs via a
// hold=1 Fetch or a Swap that lands on thum.io. While held:
//   · a GET miss answers x-thumb-prov-want: thumio, so the refreshing client
//     captures through the pinned quota-free proxy route instead of microlink;
//   · a microlink PUT can't demote the held active crop — it parks as alt;
//   · held thum.io crops keep the full 24h TTL (unheld thum.io fallbacks get
//     a short one so a later microlink capture can reclaim the slot).
// Swapping back to microlink (or a hold=1 microlink Fetch) deletes the key.
const objKey  = url => 'thumb:' + url;
const altKey  = url => 'alt:' + url;
const prefKey = url => 'prov:' + url;
const provOf = m => m?.prov || 'microlink';   // legacy crops predate the tag; only microlink wins were ever uploaded
const slotNow = () => Math.floor(Date.now() / (DAY_S * 1000));   // rotating 24h bucket

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

  // ── serve a stored crop, or invite the client to capture one ──
  if (request.method === 'GET'){
    if (store){
      const { value, metadata } = await store.getWithMetadata(objKey(target), { type: 'arrayBuffer' });
      if (value){
        const ageS = Math.max(0, (Date.now() - (metadata?.ts || 0)) / 1000);
        // Cache for MINUTES, not the whole TTL: an uploaded/refreshed crop should
        // reach the gallery quickly, and re-reading KV costs nothing (it never
        // touches microlink — the store existing is what protects the IP quota).
        // stale-while-revalidate keeps it instant while the fresh copy loads.
        return new Response(value, {
          headers: {
            'content-type': metadata?.contentType || 'image/png',
            'cache-control': 'public, max-age=300, stale-while-revalidate=600',
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'x-thumb-ask, x-thumb-age, x-thumb-prov',
            // still hand out a token so a forced refresh (hold-R) can overwrite
            'x-thumb-ask': await token(secret, target, slotNow()),
            'x-thumb-age': Math.floor(ageS).toString(),
            'x-thumb-prov': provOf(metadata),
          },
        });
      }
    }
    // miss / expired / no store → invite a capture (client PUTs it back),
    // naming the world's held provider so the refresh honours the owner's pick
    const want = store ? await store.get(prefKey(target)) : null;
    const h = {
      'x-thumb-ask': await token(secret, target, slotNow()),
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-thumb-ask, x-thumb-prov-want',
      'cache-control': 'no-store',
    };
    if (want) h['x-thumb-prov-want'] = want;
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
      const [act, alt] = await Promise.all([
        store.getWithMetadata(objKey(target), { type: 'arrayBuffer' }),
        store.getWithMetadata(altKey(target), { type: 'arrayBuffer' }),
      ]);
      const hdrs = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (!alt?.value) return new Response(JSON.stringify({ swapped: false }), { status: 404, headers: hdrs });
      await store.put(objKey(target), alt.value, { expirationTtl: DAY_S, metadata: alt.metadata });
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
    // hold=1 marks a DELIBERATE /thumbs fetch: the world's future auto-refresh
    // follows this provider (thum.io pins the hold, microlink releases it).
    // Gallery auto-uploads never send it, so they can't re-pin anything.
    const hold = !!u.searchParams.get('hold');
    if (hold){
      if (prov === 'thumio') await store.put(prefKey(target), 'thumio');
      else await store.delete(prefKey(target));
    }
    const pref = hold ? (prov === 'thumio' ? 'thumio' : null)
                      : await store.get(prefKey(target));

    const cur = await store.getWithMetadata(objKey(target), { type: 'arrayBuffer' });
    if (cur?.value && provOf(cur.metadata) !== prov){
      // a held world's active crop can't be demoted by the other provider —
      // the newcomer parks as alt (Swap can still bounce to it any time)
      if (pref && provOf(cur.metadata) === pref){
        await store.put(altKey(target), buf, {
          expirationTtl: DAY_S, metadata: { contentType: type, ts: Date.now(), prov },
        });
        return new Response('parked', { status: 200, headers: { 'access-control-allow-origin': '*' } });
      }
      // otherwise park the OLD crop, so the world keeps one per provider (≤2)
      await store.put(altKey(target), cur.value, { expirationTtl: DAY_S, metadata: cur.metadata });
    }

    // unheld thum.io fallbacks expire early: they self-heal an empty slot NOW,
    // and hand it to the next microlink capture in hours instead of a day
    const ttl = (prov === 'thumio' && pref !== 'thumio') ? 21600 : DAY_S;
    await store.put(objKey(target), buf, {
      expirationTtl: ttl,                                   // auto-refresh cycle
      metadata: { contentType: type, ts: Date.now(), prov },
    });
    return new Response('stored', { status: 200, headers: { 'access-control-allow-origin': '*' } });
  }

  return new Response('method not allowed', { status: 405 });
}
