// Shared bits for the GitHub sign-up pipeline (files starting with _ are not
// routed). The console on the back wall drives these endpoints:
//   login → callback  (OAuth, token lands in an HttpOnly cookie)
//   me                (who is connected)
//   fork              (fork the template repo, optionally under a custom name)
//   commit            (write the visitor's design into their fork)
// Setup (once, on the Pages project that hosts this site):
//   GH_CLIENT_ID / GH_CLIENT_SECRET  ← a GitHub OAuth App, callback URL
//                                      https://<your-domain>/api/gh/callback
//   TEMPLATE_REPO (optional)         ← "owner/repo" to fork; defaults below
export const DEFAULT_TEMPLATE = "akilluminati47/your-frutiger-gallery";

export const GH_API = "https://api.github.com";
export const UA = { "user-agent": "frutiger-gallery-console" };

export function cookie(req, name){
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function json(data, status = 200, headers = {}){
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function token(req){ return cookie(req, "gh_token"); }

export async function gh(tok, path, init = {}){
  return fetch(GH_API + path, {
    ...init,
    headers: {
      ...UA,
      accept: "application/vnd.github+json",
      authorization: `Bearer ${tok}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

// base64 for unicode payloads (the config can hold any characters)
export function b64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
