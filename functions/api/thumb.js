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
const objKey = url => 'thumb:' + url;
const altKey = url => 'alt:' + url;
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
    return new Response(JSON.stringify({ bound: true, thumbs: out }), {
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
    // miss / expired / no store → invite a capture (client PUTs it back)
    return new Response('capture', {
      status: 404,
      headers: {
        'x-thumb-ask': await token(secret, target, slotNow()),
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'x-thumb-ask',
        'cache-control': 'no-store',
      },
    });
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
    // client to capture the other provider's crop itself instead.
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
      return new Response(JSON.stringify({ swapped: true, active: provOf(alt.metadata) }), { headers: hdrs });
    }

    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return new Response('not an image', { status: 415 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 1500 || buf.byteLength > MAX_BYTES)
      return new Response('bad size', { status: 413 });

    // which provider rendered this crop — the two-slot store is keyed on it
    const prov = u.searchParams.get('prov') === 'thumio' ? 'thumio' : 'microlink';
    // a DIFFERENT provider's crop is sitting active → park it instead of erasing
    // it, so the world keeps one crop per provider (up to 2) and Swap can bounce
    const cur = await store.getWithMetadata(objKey(target), { type: 'arrayBuffer' });
    if (cur?.value && provOf(cur.metadata) !== prov)
      await store.put(altKey(target), cur.value, { expirationTtl: DAY_S, metadata: cur.metadata });

    await store.put(objKey(target), buf, {
      expirationTtl: DAY_S,                                 // auto-refresh cycle
      metadata: { contentType: type, ts: Date.now(), prov },
    });
    return new Response('stored', { status: 200, headers: { 'access-control-allow-origin': '*' } });
  }

  return new Response('method not allowed', { status: 405 });
}
