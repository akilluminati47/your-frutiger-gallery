// Cloudflare Pages Function that OWNS the /owner.config.json route.
//
// Why this exists: a Pages Function takes precedence over a static asset of the
// same path, so this guarantees the TEMPLATE can never serve a stray or
// edge-pinned owner.config.json as a plain file — a leak that once made the
// template site (frutiger-gallery.pages.dev) wear the owner's face at runtime.
//
// Behaviour mirrors /api/owner-config exactly: return the OWNER_CONFIG secret
// when it is set, otherwise 404. config.js resolves /api/owner-config FIRST and
// breaks on the first success, so an owner deploy (which has the secret) never
// reaches this route — it only ever answers forks/templates, which have no
// secret and so get a clean 404 and boot the pure template.
export function onRequestGet({ env }) {
  if (!env.OWNER_CONFIG) return new Response("not configured", { status: 404 });
  return new Response(env.OWNER_CONFIG, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
