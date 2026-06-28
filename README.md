# Digital Realm — Frutiger Aero 3D Gallery

A walk-through, first-person 3D gallery in the Frutiger Aero style. Each work is a
live screenshot of a site, hung on glass walls along a floating glass corridor over
a grassy "Bliss" landscape, with drifting bubbles, volumetric sky, and a dynamic sun
lens flare. Keyboard + mouse, gamepad, and touch are all supported and auto-detected.

Built with [three.js](https://threejs.org) (loaded from a CDN). **No build step** —
it's plain `index.html` + `styles.css` + `gallery.js` + `config.js`. Open the file or
serve the folder statically.

---

## Customize everything in `config.js`

You only ever edit [`config.js`](config.js). Nothing else needs touching.

### 1. The entrance button — your name (`creator`)

```js
creator: "akilluminati47",
```

This single **breadcrumb** is the only thing a new owner changes after cloning. It
stamps the entrance button: **"✦ enter akilluminati47's realm ✦"**. Change the string,
and the button updates. (A future sign-up Worker can write this one field to mint a
gallery per user.)

### 2. The works — names + hyperlinks (`projects`)

```js
projects: [
  { name: "guns.lol",   url: "https://guns.lol/akilluminati47" },
  { name: "DemonBot",   url: "https://demonbot.win" },
  // …add as many as you like
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

### 3. Title + subtitle

```js
title: "DIGITAL REALM",
subtitle: "choose a world to enter",
```

Shown on the entry card (and the big title is what the `<h1>` renders).

### 4. Other knobs

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

## Run / deploy

* **Local:** serve the folder with any static server, e.g. `python -m http.server 4173`,
  then open `http://localhost:4173`. (Opening `index.html` directly also works, but a
  server avoids module/CORS quirks.)
* **Cloudflare Pages / any static host:** point it at this repo root. There's no build
  command and no output directory to configure — it's already static.

---

## Credits

Frutiger Aero gallery · three.js · screenshots via thum.io / mShots / microlink.
