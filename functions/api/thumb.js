// Shared, self-populating thumbnail cache — R2-backed (binding: env.THUMBS).
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
//   GET /api/thumb?url=<target>
//     • a fresh (<24h) stored crop  → 200 image, Cache-Control tuned to expire
//       exactly when the crop goes stale (so a browser re-pings only then).
//     • missing / stale             → 404 + X-Thumb-Ask: <token>, inviting the
//       client to capture <target> from its own IP and PUT it back.
//   PUT /api/thumb?url=<target>&t=<token>
//     • stores the posted image as the fresh shared copy (token + image + size
//       validated). 24h later the first returning guest refreshes it.
//
// No R2 bound (e.g. a fork that hasn't set it up) → GET always 404, PUT no-ops:
// the client just captures live each visit, exactly as before. Nothing breaks.

const DAY_S   = 86400;
const MAX_BYTES = 3_000_000;        // 3 MB cap per stored crop
const te = new TextEncoder();

const objKey = url => 'thumb:' + url;
const slotNow = () => Math.floor(Date.now() / (DAY_S * 1000));   // rotating 24h bucket

async function token(secret, url, slot){
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(`${url}|${slot}`));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function onRequest({ request, env }){
  const store  = env.THUMBS;                          // R2 bucket binding (optional)
  const secret = env.THUMB_SIGN || 'fg-thumb-dev';    // HMAC secret for upload invites
  const u = new URL(request.url);
  const target = u.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  // ── serve a stored crop, or invite the client to capture one ──
  if (request.method === 'GET'){
    if (store){
      const obj = await store.get(objKey(target));
      if (obj){
        const ageS = (Date.now() - obj.uploaded.getTime()) / 1000;
        if (ageS < DAY_S){
          const remain = Math.max(60, Math.floor(DAY_S - ageS));   // cache until it goes stale
          return new Response(obj.body, {
            headers: {
              'content-type': obj.httpMetadata?.contentType || 'image/png',
              'cache-control': `public, max-age=${remain}`,
              'access-control-allow-origin': '*',
              'access-control-expose-headers': 'x-thumb-ask',
              // still hand out a token so a forced refresh (hold-R) can overwrite
              'x-thumb-ask': await token(secret, target, slotNow()),
              'x-thumb-age': Math.floor(ageS).toString(),
            },
          });
        }
      }
    }
    // missing / stale / no store → invite a capture (client PUTs it back)
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
    if (!store) return new Response('no store', { status: 202 });   // fork without R2 → accept-and-drop
    const tok = u.searchParams.get('t') || '';
    // valid for the current or previous 24h slot (tolerates the boundary)
    const ok = tok === await token(secret, target, slotNow())
            || tok === await token(secret, target, slotNow() - 1);
    if (!ok) return new Response('bad token', { status: 403 });

    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return new Response('not an image', { status: 415 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 1500 || buf.byteLength > MAX_BYTES)
      return new Response('bad size', { status: 413 });

    await store.put(objKey(target), buf, { httpMetadata: { contentType: type } });
    return new Response('stored', { status: 200, headers: { 'access-control-allow-origin': '*' } });
  }

  return new Response('method not allowed', { status: 405 });
}
