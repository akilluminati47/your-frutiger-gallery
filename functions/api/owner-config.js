// Cloudflare Pages Function — answers GET /api/owner-config with the
// OWNER_CONFIG secret (a JSON string, same shape as CONFIG in config.js).
// Set it in the Pages dashboard: Settings → Environment variables →
// add secret OWNER_CONFIG for Production (and Preview if you want).
// Forks without the secret get a 404 and boot the pure template.
export function onRequestGet({ env }) {
  if (!env.OWNER_CONFIG) return new Response("not configured", { status: 404 });
  return new Response(env.OWNER_CONFIG, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
