# Your Frutiger Gallery

[![Live](https://img.shields.io/badge/build-live-brightgreen)](https://frutiger-gallery.pages.dev)
[![Use this template](https://img.shields.io/badge/template-use%20this-blue)](https://github.com/akilluminati47/your-frutiger-gallery/generate)
[![three.js](https://img.shields.io/badge/three.js-r180-049EF4)](https://threejs.org)
[![Cloudflare Pages](https://img.shields.io/badge/hosted%20on-Cloudflare%20Pages-F38020)](https://pages.cloudflare.com)

A walk-through, first-person 3D gallery in the Frutiger Aero style. Every panel is a
live screenshot of a site, hung on glass walls over a grassy Bliss landscape, with
drifting bubbles, a volumetric sky, and a dynamic sun flare. At the end of the hall
stands the **Aero Sign-Ups wall**: a glass console where any visitor designs their own
gallery, forks this repository, and deploys it, all without leaving the world.

**Walk it now: [frutiger-gallery.pages.dev](https://frutiger-gallery.pages.dev)**

## Contents

- [Features](#features)
- [The Aero Sign-Ups wall](#the-aero-sign-ups-wall)
- [Get your own gallery](#get-your-own-gallery)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Sign-up API](#sign-up-api)
- [Controls](#controls)
- [Local development](#local-development)
- [Rendering notes](#rendering-notes)
- [Credits](#credits)

## Features

| | |
|---|---|
| No build step | Plain `index.html` + `styles.css` + `gallery.js` + `config.js`. Serve the folder statically and it runs. |
| Live panels | Each work is captured at the visitor's own viewport aspect, so phones see phone layouts and desktops see desktop layouts. |
| Self-scaling hall | Add or remove works freely: frames auto-arrange two per row and the glass floor, walls, and legs lengthen to fit. The end walls are independent slots that can hang a world each (00 west, 000 east) or stand as bare glass, and an odd count is always caught by a free end wall; no lonely half-rows. |
| In-world sign-ups | The back-wall console designs, forks, and hands off deployment: a complete registration pipeline inside the 3D scene. |
| Fork-safe template | The repository ships anonymous. An owner's real branding lives in a Cloudflare secret or a committed `owner.config.json`, never in the template. |
| Full input support | Keyboard + mouse, gamepad, and touch are auto-detected, with an adaptive on-screen hint. |

## The Aero Sign-Ups wall

The corridor ends at a glass backwall carrying the **GALLERY CONSOLE**, painted on an
extra-large rounded canvas slab. Aim with your view (an Aero cursor rides the slab),
press with click or `E`, and type directly into the highlighted field. Fields are real
text editors: click places the caret, drag or double-click selects, and `Ctrl+C` /
`Ctrl+X` / `Ctrl+V` / `Ctrl+A` copy, cut, paste, and select. Movement keys pause
while you type.

| Tab | What it does | Preview |
|---|---|---|
| identity | Handle, gallery title, browser-tab title, splash and pause lines | Live, on the real splash |
| worlds | Static west/east end-wall slots (own strings, toggled on/off without losing them) above a paged plaque + URL editor with add/remove, and a wall-balance hint | On your deployed gallery |
| atmosphere | Bubble count/size/speed, cloud sliders, volume, shuffle and new-tab toggles | Bubbles and volume live |
| publish | The sign-up pipeline, described below | |

### The pipeline

| Step | Default | Notes |
|---|---|---|
| 1. Name it | Forks as the template's name | A plain console field: type the repository name straight into it. |
| 2. GitHub | Connect, then one click | *Create my gallery* forks this repo under your account (custom name honored) and commits your whole design into the fork as `owner.config.json`. |
| 3. Cloudflare | Guided hand-off | Opens the Pages new-project flow; connect the fork, accept the defaults, deploy. |
| 4. Privacy (optional) | Copy buttons | The same design as a paste-ready `OWNER_CONFIG` secret, for owners who want their links out of the repo entirely. |

Every draft persists in `localStorage`, so the OAuth round-trip never loses a design.
If the deployment has no OAuth configured, the publish tab degrades gracefully to
fork-page deep links plus the copy buttons: the pipeline still works with zero setup.

Appending `?console` to the URL renders the identical console as a flat overlay with
direct mouse input, for machines without pointer lock and for debugging.

## Get your own gallery

| Route | How | Best for |
|---|---|---|
| In-world | Walk to the back wall of the [live gallery](https://frutiger-gallery.pages.dev), design, publish | Everyone |
| Template | [Use this template](https://github.com/akilluminati47/your-frutiger-gallery/generate), pick a name, then edit `config.js` or commit an `owner.config.json` | Developers |
| Fork | [Fork the repo](https://github.com/akilluminati47/your-frutiger-gallery/fork), same editing options | Developers |

Then deploy on Cloudflare Pages: create a Pages project, connect the repo, accept the
defaults (no build command, no output directory). Every push to `main` redeploys.

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
| `walls` | object | Independent end-wall slots, `west`/`east` each `{ on, name, url }`: west hangs world 00 on the far wall (console off only), east world 000 on the sun-lit entrance. `on: true` builds that glass pane + rail even with an empty slot; `on: false` keeps the strings but builds nothing |
| `console` | object | `enabled: false` removes the sign-ups wall; `sourceRepo` is the template it forks |
| `shuffleOrder` | bool | Shuffle the hall on every load |
| `openInNewTab` | bool | Open chosen worlds in a new tab instead of the same-tab swoop |
| `screenshotProvider` | string | `thumio`, `mshots`, or `microlink`; failures fall through the whole list |
| `postFX` | bool | HDR bloom, filmic grade, dynamic resolution; `false` is the low-end kill switch |
| `movement` | object | Walk feel: `accel`, `friction`, `maxSpeed`, look sensitivities |
| `volume` | number | Master volume for the SFX, 0..1 |

</details>

### The owner handshake

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

## Deployment

The static gallery needs nothing beyond a Pages project. The connected sign-up flow
needs one GitHub OAuth App and two environment variables on the Pages project.

| Variable | Type | Purpose |
|---|---|---|
| `GH_CLIENT_ID` | Plain text | OAuth App client id |
| `GH_CLIENT_SECRET` | Secret | OAuth App client secret |
| `TEMPLATE_REPO` | Plain text, optional | `owner/repo` to fork; defaults to this repository |
| `OWNER_CONFIG` | Secret, optional | This deployment's own branding JSON |

Setup, once:

1. Create the OAuth App at [github.com/settings/developers](https://github.com/settings/developers):
   homepage `https://your-domain.pages.dev`, callback
   `https://your-domain.pages.dev/api/gh/callback`. Leave device flow off.
2. Add the variables above in the Pages project settings, then retry the deployment
   (environment variables apply to new builds only).
3. The console's publish tab switches from deep links to the connected flow on its own.

## Sign-up API

Pages Functions under [`functions/api/`](functions/api/):

| Endpoint | Method | Role |
|---|---|---|
| `/api/gh/login` | GET | Starts the OAuth dance, `public_repo` scope, CSRF state cookie |
| `/api/gh/callback` | GET | Exchanges the code; the token lands in an `HttpOnly` cookie (8 h), never in page JS |
| `/api/gh/me` | GET | `200 {login}` connected, `401` not signed in, `501` OAuth unconfigured |
| `/api/gh/fork` | POST | Forks the template, optional `{name}` for the custom-name toggle, waits for the fork to materialize |
| `/api/gh/commit` | POST | Writes `owner.config.json` into the fork; refuses any repo the connected account does not own |
| `/api/owner-config` | GET | Serves the `OWNER_CONFIG` secret to the handshake above |

## Controls

| Input | Move | Look | Visit / press | Pause |
|---|---|---|---|---|
| Keyboard + mouse | `WASD` / arrows | Mouse | `E` / click | `Esc` |
| Gamepad | Left stick | Right stick | `A` | `Start` |
| Touch | Left-thumb stick | Drag | Tap | Pause button |

You can only trigger the panel or console control you are actually looking at and
within range of.

## Local development

```sh
# static gallery only
python -m http.server 4173

# gallery + sign-up functions
npx wrangler pages dev .
```

A local `owner.config.json` next to `index.html` (gitignored) previews an owner
configuration during development. `http://localhost:4173/?console` gives the flat
console overlay for quick UI work.

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

</details>

## Credits

Frutiger Aero gallery. Built with [three.js](https://threejs.org).
Screenshots by [thum.io](https://www.thum.io), [mShots](https://developer.wordpress.com/docs/site-previews/), and [microlink](https://microlink.io).
Sound effects from Microsoft Windows 7 (© Microsoft Corporation): the logon,
balloon, notify, print-complete, pop-up-blocked, UAC, and information-bar sounds
in `sfx/`.
