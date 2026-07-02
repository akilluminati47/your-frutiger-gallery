// GET /api/gh/login — kick off the GitHub OAuth dance. public_repo is the
// narrowest scope that can fork a public repo and commit to the user's fork.
export function onRequestGet({ request, env }){
  if (!env.GH_CLIENT_ID) return new Response("GitHub OAuth is not configured on this deployment.", { status: 501 });
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", env.GH_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/api/gh/callback`);
  auth.searchParams.set("scope", "public_repo");
  auth.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      // short-lived state cookie closes the CSRF hole in the callback
      "set-cookie": `gh_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}
