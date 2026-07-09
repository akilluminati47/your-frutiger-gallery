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
| `screenshotProvider` | string | `microlink`, `mshots`, or `thumio`; failures fall through in that order by default |
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
parallax — and a live end wall lays its page into that mirror by painting the face
iframe's own pixels a second time (`-webkit-box-reflect`, evenly dimmed), riding the
slab's white bounce: one browsing context rendered twice, so the reflection can never
fall out of step with the page. The live slab itself is the
Aero-Pad, an extruded body: a rim rising flush to the page in front, a rounded
shoulder sweeping onto a flat inset panel behind.

</details>

## Credits

Frutiger Aero gallery. Built with [three.js](https://threejs.org).
Screenshots by [thum.io](https://www.thum.io), [mShots](https://developer.wordpress.com/docs/site-previews/), and [microlink](https://microlink.io).
Sound effects from Microsoft Windows 7 (© Microsoft Corporation), drawn from the
default and Garden sound schemes: the logon, balloon, notify, print-complete,
pop-up-blocked, UAC, information-bar, and speech-disambiguation sounds in `sfx/`.
