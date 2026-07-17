# Your Frutiger Gallery

[![Live](https://img.shields.io/badge/build-live-brightgreen)](https://frutiger-gallery.pages.dev)
[![Use this template](https://img.shields.io/badge/template-use%20this-blue)](https://github.com/akilluminati47/your-frutiger-gallery/generate)
[![three.js](https://img.shields.io/badge/three.js-r180-049EF4)](https://threejs.org)
[![Cloudflare Pages](https://img.shields.io/badge/hosted%20on-Cloudflare%20Pages-F38020)](https://pages.cloudflare.com)

A walk-through, first-person 3D gallery in the Frutiger Aero style. Every panel is a
fresh screenshot of a site, hung on glass walls over a grassy Bliss landscape, with
drifting bubbles, a volumetric sky, and a dynamic sun flare. An end wall can even wake
its world as a **live, browsable page** standing right in the hall. At the end of the
hall stands a glass console where you design your own gallery, fork this repository,
and deploy it, all without leaving the world.

**Walk it now: [frutiger-gallery.pages.dev](https://frutiger-gallery.pages.dev)**

## Contents

- [Your gallery in three steps](#your-gallery-in-three-steps)
- [Features](#features)
- [The gallery console](#the-gallery-console)
- [Configuration](#configuration)
- [Controls](#controls)
- [Local development](#local-development)
- [Host sign-ups from your own gallery](#host-sign-ups-from-your-own-gallery)
- [Rendering notes](#rendering-notes)
- [Credits](#credits)

## Your gallery in three steps

No tooling, no build step, nothing to install. You need a GitHub account and a free
Cloudflare account; the console handles the rest.

1. **Walk in.** Open the [live gallery](https://frutiger-gallery.pages.dev) and head
   down the hall to the glass console on the back wall.
2. **Design.** Set your handle, title, and splash lines; hang your worlds; tune
   bubbles, clouds, and sound. Changes preview live, and every draft survives in
   `localStorage`.
3. **Publish.** *Create my gallery* forks this repository under your account with
   your whole design committed inside, then hands you off to Cloudflare Pages:
   connect the fork, accept the defaults, deploy. Every push to `main` redeploys.

*Optional — sharper, shared previews.* Bind a **free** Workers KV namespace as
`THUMBS` (three clicks, no card) so your visitors collectively keep a shared
high-res thumbnail cache warm instead of each re-capturing. See
[Shared thumbnail cache](#shared-thumbnail-cache-optional-recommended).

Prefer files over the console?
[Use this template](https://github.com/akilluminati47/your-frutiger-gallery/generate)
or [fork the repo](https://github.com/akilluminati47/your-frutiger-gallery/fork),
edit [`config.js`](config.js) or commit an `owner.config.json`, and connect the repo
to a Pages project (no build command, no output directory).

## Features

| | |
|---|---|
| No build step | Plain `index.html` + `styles.css` + `gallery.js` + `config.js`. Serve the folder statically and it runs. |
| One hall, every device | Every panel is the same wide 16:9 slab on phones, laptops, and ultra-wides alike. Captures render a desktop-laid-out screenful and stretch edge-to-edge, so a gallery looks like itself wherever it's opened. |
| Self-scaling hall | Add or remove works freely: frames auto-arrange two per row and the glass floor, walls, and legs lengthen to fit. The end walls are independent slots that can hang a world each (00 west, 000 east) or stand as bare glass, and an odd count is always caught by a free end wall; no lonely half-rows. |
| Live end walls | An end-wall slot with `live: true` wakes its world as a real interactive page on the Aero-Pad, a white hardware slab: engage view mode and browse it right there in the hall. The floor reflection is the same page painted twice — one browsing context, so even a fast animation stays frame-locked with its mirror. |
| Directional live sound | The hall streams placement to each live page (`postMessage {type:'fg-audio', gain, pan}` at ~10 Hz): volume falls with distance, ducks behind your head, pans to the slab's ear, and follows the console volume slider. A hung page opts in by loading [`live-audio.js`](live-audio.js) early (or handling the message itself); pause silences it with everything else. |
| In-world sign-ups | The back-wall console designs, forks, and hands off deployment: a complete registration pipeline inside the 3D scene. |
| Fork-safe template | The repository ships anonymous. An owner's real branding lives in a Cloudflare secret or a committed `owner.config.json`, never in the template. |
| Full input support | Keyboard + mouse, gamepad, and touch are auto-detected, with an adaptive on-screen hint. |

## The gallery console

The corridor ends at a glass backwall carrying the **GALLERY CONSOLE**, painted on an
extra-large rounded canvas slab. Aim with your view (an Aero cursor rides the slab),
press with click or `E`, and type directly into the highlighted field. Fields are real
text editors: click places the caret, drag or double-click selects, and `Ctrl+C` /
`Ctrl+X` / `Ctrl+V` / `Ctrl+A` copy, cut, paste, and select. Movement keys pause
while you type.

| Tab | What it does | Preview |
|---|---|---|
| identity | Handle, gallery title, browser-tab title, splash and pause lines | Live, on the real splash |
| worlds | Static west/east end-wall slots (own strings, toggled on/off without losing them, plus a **live** toggle that wakes the hung world as an interactive screen) above a paged plaque + URL editor with add/remove, and a wall-balance hint | On your deployed gallery |
| atmosphere | Bubble count/size/speed, cloud sliders, volume, shuffle and new-tab toggles | Bubbles and volume live |
| publish | The three-step pipeline above, plus an optional privacy step | |

<details>
<summary><strong>The publish pipeline, step by step</strong></summary>

| Step | Default | Notes |
|---|---|---|
| 1. Name it | Forks as the template's name | A plain console field: type the repository name straight into it. |
| 2. GitHub | Connect, then one click | *Create my gallery* forks this repo under your account (custom name honored) and commits your whole design into the fork as `owner.config.json`. |
| 3. Cloudflare | Guided hand-off | Opens the Pages new-project flow; connect the fork, accept the defaults, deploy. |
| 4. Privacy (optional) | Copy buttons | The same design as a paste-ready `OWNER_CONFIG` secret, for owners who want their links out of the repo entirely. |

Every draft persists in `localStorage`, so the sign-in round-trip never loses a
design. On a deployment with no sign-in configured, the publish tab offers fork-page
deep links plus the copy buttons instead: the pipeline still works with zero setup.

</details>

## Configuration

Everything lives in [`config.js`](config.js). The template boots with neutral values;
an owner's real settings arrive through the handshake below.

<details>
<summary><strong>Key reference</strong></summary>

| Key | Type | Purpose |
|---|---|---|
| `creator` | string | The handle on the entrance button |
| `title` | string | Big title on the entry card and floating in the world |
| `tabTitle` | string | Browser-tab / bookmark text; `""` keeps the baked-in default |
| `subtitle`, `loadingNote`, `readyNote` | string | Splash lines; `""` removes a line and the card re-balances itself (`{n}` = world count) |
| `pause` | object | Pause-card texts: `title`, `note`, `resume` |
| `bubbles` | object | `count` (0 disables, phones run about two-thirds), `size`, `speed` multipliers |
| `clouds` | object | `cover` 0..1 puffy coverage, `cirrus` 0..1 streak amount |
| `projects` | array | `{ name, url }` per panel; pairs fill the hall front to back, and an odd LAST entry rides a free end wall automatically (far wall first while the console is off, else the entrance) |
| `walls` | object | Independent end-wall slots, `west`/`east` each `{ on, name, url, live }`: west hangs world 00 on the far wall (console off only), east world 000 on the sun-lit entrance. `on: true` builds that glass pane + rail even with an empty slot; `on: false` keeps the strings but builds nothing. `live: true` wakes the hung world as a real interactive page on its slab instead of a swoop-away link (and drags the wall toggle on with it — an interactive screen needs its pane) |
| `console` | object | `enabled: false` removes the sign-ups wall; `sourceRepo` is the template it forks |
| `shuffleOrder` | bool | Shuffle the hall on every load |
| `openInNewTab` | bool | Open chosen worlds in a new tab instead of the same-tab swoop |
| `screenshotProvider` | string | Direct fallback used only if the `/api/shot` edge-cache proxy is unreachable — `microlink`, `mshots`, or `thumio`. Normally every capture goes through the proxy (server-side microlink → thum.io, cached a day at the edge so the free quota is shared across visitors). |
| `postFX` | bool | HDR bloom, filmic grade, dynamic resolution; `false` is the low-end kill switch |
| `movement` | object | Walk feel: `accel`, `friction`, `maxSpeed`, look sensitivities |
| `volume` | number | Master volume for the SFX, 0..1 |

</details>

<details>
<summary><strong>The owner handshake</strong></summary>

The template never wears an owner's face. On load the gallery tries, in order:

1. `/api/owner-config`, a Pages Function that answers with the `OWNER_CONFIG` secret
   set in the Cloudflare dashboard (404 when unset).
2. `/owner.config.json`, a real file: committed by the console's sign-up flow, or kept
   locally for development (the template gitignores it).
3. Neither found: the clean template stands.

Whatever JSON it finds deep-merges over `CONFIG` before the world boots, so an owner
writes only the keys that differ. [`owner.config.txt`](owner.config.txt) is a
fill-in-the-blanks worksheet whose `_` lines are ignored notes; the whole file pastes
directly into an `OWNER_CONFIG` secret.

</details>

## Controls

| Input | Move | Look | Visit / press | View mode | Pause |
|---|---|---|---|---|---|
| Keyboard + mouse | `WASD` / arrows | Mouse | `E` / click | `Ctrl` | `Esc` |
| Gamepad | Left stick | Right stick | `A` | `R3` | `Start` |
| Touch | Left-thumb stick | Drag | Tap | Eye button | Pause button |

You can only trigger the panel or console control you are actually looking at and
within range of. **View mode** is how you browse a live end wall: the `view?` pill
(or `Ctrl`, `R3`, the glowing eye on touch) freezes walking and looking and hands
your pointer to the page on the slab; the same press — or a click off the slab —
releases everything and you walk again. Holding `Ctrl` reloads a live page that has
trapped the pointer, and `Esc` always pauses, no matter what.

## Local development

```sh
# static gallery only
python -m http.server 4173

# gallery + sign-up functions
npx wrangler pages dev .
```

A local `owner.config.json` next to `index.html` (gitignored) previews an owner
configuration during development. Appending `?console` to any URL renders the
identical console as a flat overlay with direct mouse input, for machines without
pointer lock and for quick UI work.

## Host sign-ups from your own gallery

Your deployed gallery carries the same console this one does, and its publish tab
works out of the box: fork-page deep links plus copy buttons, zero setup. This
section is only for owners who want their console to offer visitors the fully
connected one-click flow (sign in with GitHub, fork with the design committed
inside). One GitHub OAuth App and two variables on your Pages project unlock it.

<details>
<summary><strong>Setup, once</strong></summary>

| Variable | Type | Purpose |
|---|---|---|
| `GH_CLIENT_ID` | Plain text | OAuth App client id |
| `GH_CLIENT_SECRET` | Secret | OAuth App client secret |
| `TEMPLATE_REPO` | Plain text, optional | `owner/repo` to fork; defaults to this repository |
| `OWNER_CONFIG` | Secret, optional | This deployment's own branding JSON |

1. Create the OAuth App at [github.com/settings/developers](https://github.com/settings/developers):
   homepage `https://your-domain.pages.dev`, callback
   `https://your-domain.pages.dev/api/gh/callback`. Leave device flow off.
2. Add the variables above in the Pages project settings, then retry the deployment
   (environment variables apply to new builds only).
3. The console's publish tab switches from deep links to the connected flow on its own.

</details>

<details>
<summary><strong>Sign-up API</strong></summary>

Pages Functions under [`functions/api/`](functions/api/):

| Endpoint | Method | Role |
|---|---|---|
| `/api/gh/login` | GET | Starts the OAuth dance, `public_repo` scope, CSRF state cookie |
| `/api/gh/callback` | GET | Exchanges the code; the token lands in an `HttpOnly` cookie (8 h), never in page JS |
| `/api/gh/me` | GET | `200 {login}` connected, `401` not signed in, `501` OAuth unconfigured |
| `/api/gh/fork` | POST | Forks the template, optional `{name}` for the custom-name toggle, waits for the fork to materialize |
| `/api/gh/commit` | POST | Writes `owner.config.json` into the fork; refuses any repo the connected account does not own |
| `/api/owner-config` | GET | Serves the `OWNER_CONFIG` secret to the handshake above |
| `/api/shot` | GET | Server-side capture proxy with a day-long edge cache — the fallback when a visitor's own IP can't reach microlink |
| `/api/thumb` | GET/PUT | The shared thumbnail store (below) — serves a stored crop, or invites the client to capture and upload one |

### Shared thumbnail cache (optional)

Microlink's free tier is **50/day per IP**, so every visitor captures a world
from their **own** browser. Bind a **Workers KV namespace** and the gallery
caches crops at the edge: one visitor captures once, everyone else gets the
stored crop. KV's 24 h TTL auto-expires each crop — the next returning guest
re-captures it. You don't need to do anything; your thumbnails appear fresh
each day on their own.

Forks without KV work fine — every visitor captures live, nothing breaks.

Each world can use **microlink** or **thum.io** individually, swapped from the
[`/thumbs`](#dashboard---thumbs) dashboard (or the pause menu's Thumbnails
button). The choice sticks per world across refreshes.

**Locking a world's provider.** Some pages only ever come out right on one of
them. Add a `thumbLock` line to that world in your owner config — on any project
or wall slot, `"thumio"` or `"microlink"`:

```jsonc
{ "name": "YouTube", "url": "https://youtube.com/@you", "thumbLock": "thumio" }
```

That pin is your standing pick, so it **outranks everything else** — every path
follows it without anything having to agree first: a visitor's auto-refresh
captures through it, the daily cron can't replace it (its crop parks as the
spare instead), and `/thumbs` greys that world's **⇄ Swap** pill out with an
*"owner config locked"* note. Leave the line out and the world stays swappable
exactly as before. Worlds already holding the other provider's crop change over
on their next refresh — press **Fetch** once to do it immediately.

KV is on the **free** Workers plan (no card, unlike R2) and a set of ~15–80 KB
crops is a rounding error against its limits. To enable it on a deployment:

1. Create a KV namespace (e.g. `frutiger-thumbs`) — Dashboard → Storage & Databases → **KV** → *Create*.
2. Pages project → Settings → Functions → **KV namespace bindings**: add `THUMBS` → that namespace.
3. Pages project → Settings → Environment variables: add secret **`THUMB_SIGN`** = any long random string (signs the upload invites so only crops this site invited can be stored).

Then redeploy. Seed it in one go by visiting your own gallery once from a
**fresh-quota IP** (your phone on cellular, say): your browser captures every
world at full res and uploads them, and from then on all visitors are served
those crops.

**Dashboard — [`/thumbs`](https://akilluminati47.pages.dev/thumbs).** A flat
Frutiger-Aero control panel that lists every world with its cached crop and its
age — reachable from the in-gallery **pause menu** (Thumbnails button), and it
carries the hall's glowing circle cursor + console click/hover SFX with mouse,
gamepad, and touch support. **Click any crop to expand it XXL; click again to
shrink** and keep browsing. Per world you can **Fetch** (capture from the browser you're on — open
it on cellular to seed the sharp crops) or **Save** the cached one; tick the
checkboxes for bulk fetch/download. It reads the live store via
`GET /api/thumb?list`. There is deliberately **no upload button** — the store
fills only from real captures (the gallery's own microlink grabs and the Fetch
button), so a visitor can't push arbitrary images into it. The gallery never
downgrades a sharp crop to a thum.io fallback on refresh — a weak fallback only
fills a slot that has nothing.

**Daily keep-warm (optional).** [`.github/workflows/thumbs-cron.yml`](.github/workflows/thumbs-cron.yml)
runs [`tools/capture-thumbs.mjs`](tools/capture-thumbs.mjs) once a day and
refreshes **both** of each world's crops: it reads that world's pinned provider
(a `thumbLock`, else a thum.io hold, else microlink), captures **that** one as
the shown crop, and captures the **other** one into the spare slot so ⇄ Swap
stays instant instead of quietly expiring. If a capture fails it re-touches the
stored crop so a good one never silently expires. This costs no extra microlink
quota — exactly one of the two is microlink, so it stays at one microlink
capture per world from the runner's IP (which has real quota, unlike
Cloudflare's shared one), and the thum.io side rides your own `/api/shot`
proxy for free. A world you pin **after** its crop was taken changes over on
the next nightly run. Opt in by setting an Actions **repository variable**
`SITE_URL` to your Pages URL; without it the job no-ops. Also runnable on
demand from the Actions tab.

</details>

## Rendering notes

<details>
<summary><strong>How the frame is drawn</strong></summary>

Rendering runs through a full HDR pipeline: MSAA into a half-float target,
Unreal-style bloom, ACES filmic tonemapping, then a film grade (vignette, animated
grain, a saturation lift; no chromatic aberration, so bubbles and edges stay crisp).
The sky is a domain-warped FBM cloudscape with silver linings and a rare-cirrus
layer; sun-lit dust motes drift up the corridor. A dynamic-resolution governor
watches frame time and trades internal resolution for a locked frame rate, from iGPU
laptops to phones. Loading cutscenes draw on a small strip plane that maps one-to-one
to its screen pixels, so the barber-pole bar stays sharp at a fixed upload cost.
The glass floor is a true planar reflector — blue-tinted, blurred, moving in real
parallax — and a live end wall lays its page into every mirror the cheap way: its
WebGL panel wears the page's fetched thumbnail behind the live iframe, so floor and
side glass bounce that one static capture for free while the face stays the real,
interactive page. Every mirror in the hall hangs off one visitor-owned notched
switch on the pause menu (saved in `localStorage`): off, each pane swaps to a flat
frosted tint and skips its mirror-camera pass entirely — the GPU keeps only the
single forward render. The live slab itself is the
Aero-Pad, an extruded body: a rim rising flush to the page in front, a rounded
shoulder sweeping onto a flat inset panel behind. The sun's lens flare — warm
glare plus ghost train — is pure DOM: fixed-size radial gradients repainted each
frame on a full-viewport overlay (`#sunglow`) *above* the panel layer, so the
flare sweeps over an interactive slab instead of being clipped by it. Only its
opacity ever moves, and every input to it is continuous — how directly you face
the sun, each ghost's own screen distance from it, a time-eased occlusion ray at
the slabs — so the glare breathes in and out instead of popping.

</details>

## Credits

[akilluminati47](https://github.com/akilluminati47) | Frutiger Aero Gallery. Built with [three.js](https://threejs.org).
Screenshots by [thum.io](https://www.thum.io) and [microlink](https://microlink.io).
Sound effects from Microsoft Windows 7 (© Microsoft Corporation).
