import { gh, json, token } from "./_gh.js";

// GET /api/gh/me — who is connected? The console calls this at boot:
//   200 {login}  connected · 401 not signed in · 501 OAuth not configured
export async function onRequestGet({ request, env }){
  if (!env.GH_CLIENT_ID) return json({ error: "oauth-not-configured" }, 501);
  const tok = token(request);
  if (!tok) return json({ error: "not-connected" }, 401);
  const r = await gh(tok, "/user");
  if (!r.ok) return json({ error: "token-expired" }, 401);
  const u = await r.json();
  return json({ login: u.login, avatar: u.avatar_url });
}
