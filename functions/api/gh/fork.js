import { DEFAULT_TEMPLATE, gh, json, token } from "./_gh.js";

// POST /api/gh/fork {name?} — fork the template repo into the visitor's
// account. GitHub's fork API takes an optional custom name, which is exactly
// the console's "custom name" toggle; with no name it forks as-is. Forking is
// async on GitHub's side, so we poll briefly until the new repo answers —
// the commit endpoint right after needs it to exist.
export async function onRequestPost({ request, env }){
  const tok = token(request);
  if (!tok) return json({ error: "connect GitHub first" }, 401);
  const src = env.TEMPLATE_REPO || DEFAULT_TEMPLATE;
  let body = {};
  try { body = await request.json(); } catch {}
  const payload = { default_branch_only: true };
  if (body.name && typeof body.name === "string") payload.name = body.name.slice(0, 100);

  const r = await gh(tok, `/repos/${src}/forks`, { method: "POST", body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 202 && !r.ok)
    return json({ error: j.message || `GitHub refused the fork (${r.status})` }, 502);

  // wait (max ~9 s) for the fork to materialise
  for (let i = 0; i < 6; i++){
    const check = await gh(tok, `/repos/${j.full_name}`);
    if (check.ok) break;
    await new Promise(res => setTimeout(res, 1500));
  }
  return json({ repo: j.full_name, url: j.html_url });
}
