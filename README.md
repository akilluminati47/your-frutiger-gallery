# Digital Realm — Frutiger Aero 3D Gallery

A walk-through, first-person 3D gallery in the Frutiger Aero style. Each work is a
live screenshot of a site, hung on glass walls along a floating glass corridor over
a grassy "Bliss" landscape, with drifting bubbles, volumetric sky, and a dynamic sun
lens flare. Keyboard + mouse, gamepad, and touch are all supported and auto-detected.

Rendering runs through a full HDR post pipeline: MSAA into a half-float target,
Unreal-style bloom, ACES filmic tonemapping, then a film grade (corner chromatic
aberration, vignette, animated grain). The sky is a domain-warped FBM cloudscape
with silver linings and a rare-cirrus layer; sun-lit dust motes drift up the
corridor past crisp, bare panels. A dynamic-resolution governor watches
the frame time and trades internal resolution for a locked frame rate, so it stays
smooth from an iGPU laptop to a phone (`postFX: false` in `config.js` is the
kill-switch back to plain forward rendering).

Built with [three.js](https://threejs.org) (loaded from a CDN). **No build step** —
it's plain `index.html` + `styles.css` + `gallery.js` + `config.js`. Open the file or
serve the folder statically.

---

## Customize everything in `config.js`

You only ever edit [`config.js`](config.js). Nothing else needs touching.

### 1. The entrance button — your name (`creator`)

```js
creator: "your-name",
```

This single **breadcrumb** is the only thing a new owner changes after cloning. It
becomes the label on the entrance button (e.g. **akilluminati47**). Change the string,
and the button updates. (A future sign-up Worker can write this one field to mint a
gallery per user.)

### 2. The works — names + hyperlinks (`projects`)

```js
projects: [
  { name: "YouTube", url: "https://www.youtube.com/" },
  { name: "Twitch",  url: "https://www.twitch.tv/" },
  // …add as many as you like (an even number keeps both walls balanced)
],
```

* `name` → the plaque mounted on that panel.
* `url`  → where the **visit?** swoop takes you, and the page that gets screenshotted
  onto the panel. `https://` is added automatically if you omit it.

**Add or remove works freely.** Frames auto-arrange two-per-row down the corridor,
and **the glass floor and side walls lengthen automatically to fit** — the platform
depth is derived from the number of works:

```
rows   = ceil(projects.length / 2)
endZ   = START_Z + (rows - 1) * DZ          // last row's depth
floor/walls span  = endZ + 14               // floor + both walls scale to this
```

So 4 works gives a short hall; 20 works gives a long one — no manual resizing. The
legs, reflections, and grass keep up on their own.

### 3. Title + entry-card lines

```js
title:       "DIGITAL REALM",
subtitle:    "choose a world to enter",
loadingNote: "Loading the world…",
readyNote:   "{n} worlds ready",      // {n} = number of worlds
```

`title` is the big `<h1>`. The other three are the smaller splash lines — set any
of them to `""` to remove that line entirely and make the entry card fully yours.

### 4. Pause menu

```js
pause: { title: "Paused", note: "Take a breath.", resume: "Resume" },
```

The pause-card texts. `title` and `note` also accept `""` to drop that line.

### 5. Atmosphere — bubbles + clouds

```js
bubbles: { count: 44, size: 1.0, speed: 1.0 },
clouds:  { cover: 1.0, cirrus: 0.35 },
```

* `bubbles.count` — how many drift around the platform (`0` disables them; phones
  automatically run ~⅔ of it). `size` / `speed` are multipliers on the stock feel.
* `clouds.cover` — puffy-cloud coverage, `0` (clear sky) … `1` (max — the stock sky).
* `clouds.cirrus` — the thin stretched horizontal streaks, `0` (none) … `1` (max —
  the old stock amount). Low values make them genuinely *rarer* (only the strongest
  streaks survive), not just fainter; they're deliberately an occasional accent by
  default.

### 6. Other knobs

```js
openInNewTab: false,          // true = open the work in a new tab instead of same-tab swoop
screenshotProvider: "thumio", // "thumio" | "mshots" | "microlink"
movement: {
  accel: 43, friction: 8, maxSpeed: 6.4, mouseSensitivity: 1.0,
  padLook: 2.6,            // gamepad right-stick look speed (rad/sec)
  touchLook: 0.0045,       // touch-drag look sensitivity (rad/pixel)
},
volume: 0.6,               // master volume for the synthesised SFX (0–1)
```

Each panel is captured at the **visitor's own viewport aspect ratio** and given a few
seconds to fully load, so renders aren't stretched or half-painted. If a provider hands
back an odd ratio anyway, the panel "contain"-fits the image so it's never distorted.

---

## Controls (auto-detected — the on-screen hint adapts)

| Input | Move | Look | Visit | Pause |
|-------|------|------|-------|-------|
| **Keyboard + mouse** | WASD / arrows | mouse | `E` / click | `Esc` |
| **Gamepad** | left stick | right stick | `A` | `Start` |
| **Touch** | left-thumb stick | drag | tap / Visit button | Pause button |

You can only trigger the panel you're **looking at** and within range — you can't back
into one and click a panel that's now behind you.

---

## Fork-safe by design — your settings live in a Cloudflare secret, not the repo

The repo is a **pure template**: no personal links, no branding, nothing to scrub
before forking. Your real settings live in a **Cloudflare secret** that only your
deployment can read. On load the gallery tries, in order:

1. **`/api/owner-config`** — a tiny Pages Function
   ([`functions/api/owner-config.js`](functions/api/owner-config.js)) that answers
   with the `OWNER_CONFIG` secret set in your Cloudflare dashboard. No secret →
   404 → next step.
2. **`/owner.config.json`** — a gitignored local file, handy while previewing on
   your own machine.
3. **Neither found** → the clean template defaults in `config.js` stand.

Whatever JSON it finds is deep-merged over `CONFIG` **before** the world boots, so
you only write the keys that differ from the template. A fork has no secret and no
local file, so it always boots the clean template — it can't accidentally wear
your face, and your links never appear in the repo.

### Set it up (one time, ~2 minutes)

1. Open [`owner.config.txt`](owner.config.txt) — it's a fill-in-the-blanks copy of
   the settings, with notes inline. Put in your name, title and links.
2. In the Cloudflare dashboard: **Workers & Pages → your Pages project →
   Settings → Environment variables → Add**. Name it `OWNER_CONFIG`, set the type
   to **Secret**, environment **Production**, and paste the whole edited file as
   the value.
3. Redeploy (or push any commit). Done — your live site wears your settings, the
   repo stays anonymous.

The lines starting with `_` in `owner.config.txt` are just notes — they're valid
JSON and get ignored, so you can paste the file exactly as-is.

---

## Run / deploy

This gallery is meant to be **forked and made your own** — not run from this repo as-is,
and not by pointing people at the unedited original.

1. **Fork** this repository to your own GitHub account.
2. **Deploy your fork to Cloudflare Pages**: create a Pages project, connect your
   forked repo, and accept the defaults — **no build command, no output
   directory**, it's already static. Every push to `main` redeploys.
3. **Make it yours** with the `OWNER_CONFIG` secret (see the section above) — your
   name and links stay out of the repo. Prefer keeping it simple? You can instead
   just edit `creator` and `projects` in [`config.js`](config.js) and commit; the
   secret path is only there so your personal info never lands in git.

> Don't ship the unedited gallery — fork it so the worlds, the entrance name, and the
> link-preview card are all yours.

**Local preview (optional, while editing):** serve the folder with any static server,
e.g. `python -m http.server 4173`, then open `http://localhost:4173`. A server avoids
module/CORS quirks you'd hit opening `index.html` straight off disk. This is just for
checking your edits before you push — the real home is your deployed fork.

---

## Credits

Frutiger Aero gallery · three.js · screenshots via thum.io / mShots / microlink.
