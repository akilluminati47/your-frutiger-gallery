// Cloudflare Pages Function that OWNS the /owner.config.json route.
//
// Why this exists: a Pages Function takes precedence over a static asset of the
// same path, so this guarantees the TEMPLATE can never serve a stray or
// edge-pinned owner.config.json as a plain file — a leak that once made the
// template site (frutiger-gallery.pages.dev) wear the owner's face at runtime.
//
// Resolution order on this route: the OWNER_CONFIG secret when set, else the
// deployment's own static owner.config.json (an owner may COMMIT the file
// instead of keeping a secret — the Function must not eat it), else 404.
// Serving the asset through the Function still defeats the old edge-pinning
// leak: the Function runs before Cloudflare's static cache, so only a file
// genuinely inside the CURRENT deployment can ever answer — the template repo
// tracks no owner.config.json, so templates/forks keep getting a clean 404
// and boot pure.
export async function onRequestGet({ request, env }) {
  if (env.OWNER_CONFIG)
    return new Response(env.OWNER_CONFIG, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  const asset = await env.ASSETS.fetch(request);
  if (asset.ok)
    return new Response(asset.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  return new Response("not configured", { status: 404 });
}
