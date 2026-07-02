import { cookie, UA } from "./_gh.js";

// GET /api/gh/callback — GitHub sends the visitor back here; swap the code
// for a token and park it in an HttpOnly cookie (the browser JS never sees
// it). Then land back in the gallery — the console picks the session up.
export async function onRequestGet({ request, env }){
  if (!env.GH_CLIENT_ID || !env.GH_CLIENT_SECRET)
    return new Response("GitHub OAuth is not configured on this deployment.", { status: 501 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== cookie(request, "gh_state"))
    return new Response("OAuth state mismatch — walk back to the console and try again.", { status: 400 });

  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { ...UA, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/gh/callback`,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token)
    return new Response(`GitHub did not hand back a token (${j.error || "unknown error"}).`, { status: 502 });

  const headers = new Headers({ location: "/?connected=1" });
  headers.append("set-cookie", `gh_token=${j.access_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
  headers.append("set-cookie", `gh_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}
