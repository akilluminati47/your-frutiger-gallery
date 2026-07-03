import { DEFAULT_TEMPLATE, b64, gh, json, token } from "./_gh.js";

// POST /api/gh/commit {repo, config} — write the visitor's design into THEIR
// fork as owner.config.json. The gallery's runtime fetch chain picks that
// file up on their deployment, so the fork is fully "theirs" the moment
// Cloudflare builds it — no secret paste, no hand-edited JSON.
// Guard: only commits to a repo owned by the connected account, and NEVER to
// the template itself. Ownership alone isn't enough — the template's own
// maintainer, signed in under the account that owns it, satisfies
// `startsWith(me.login + '/')` trivially against the template's own name (see
// fork.js for how that name can arrive here even off a fork call). Belt and
// suspenders: reject that exact repo outright, independent of how it got here.
export async function onRequestPost({ request, env }){
  const tok = token(request);
  if (!tok) return json({ error: "connect GitHub first" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad payload" }, 400); }
  const { repo, config } = body || {};
  if (!repo || typeof repo !== "string" || !config || typeof config !== "object")
    return json({ error: "bad payload" }, 400);

  const src = env.TEMPLATE_REPO || DEFAULT_TEMPLATE;
  if (repo.toLowerCase() === src.toLowerCase())
    return json({ error: "refusing to write onto the template itself" }, 403);

  const me = await (await gh(tok, "/user")).json();
  if (!repo.startsWith(`${me.login}/`))
    return json({ error: "that repo is not yours" }, 403);

  const path = `/repos/${repo}/contents/owner.config.json`;
  // fork may still be materialising — retry the read briefly
  let sha;
  for (let i = 0; i < 6; i++){
    const r = await gh(tok, path);
    if (r.ok){ sha = (await r.json()).sha; break; }
    if (r.status === 404){
      const repoCheck = await gh(tok, `/repos/${repo}`);
      if (repoCheck.ok) break;                       // repo exists, file just absent
    }
    await new Promise(res => setTimeout(res, 1500));
  }

  const put = await gh(tok, path, {
    method: "PUT",
    body: JSON.stringify({
      message: "design from the gallery console ✦",
      content: b64(JSON.stringify(config, null, 2) + "\n"),
      ...(sha ? { sha } : {}),
    }),
  });
  const pj = await put.json().catch(() => ({}));
  if (!put.ok) return json({ error: pj.message || `commit failed (${put.status})` }, 502);
  return json({ ok: true, commit: pj.commit?.sha });
}
