// ════════════════════════════════════════════════════════════════════
//  EDIT THIS FILE — drop your domains here and the gallery builds itself.
// ════════════════════════════════════════════════════════════════════
export const CONFIG = {
  // ── OWNER BREADCRUMB ───────────────────────────────────────────────
  // Your handle / artist name. This is the ONE value a new owner changes
  // after cloning (a future sign-up Worker can write it too). It becomes the
  // label on the entrance button.
  creator: "akilluminati47",

  // Big title shown on the entry card and floating in the world.
  title: "DIGITAL REALM",
  subtitle: "choose a world to enter",

  // Your works. Add or remove as many as you like — frames auto-arrange into
  // the gallery corridor and the glass floor + walls lengthen to fit.
  //   name → the plaque mounted on the panel
  //   url  → where the "visit?" swoop takes you (and what gets screenshotted)
  projects: [
    { name: "guns.lol",      url: "https://guns.lol/akilluminati47" },
    { name: "DemonBot",      url: "https://demonbot.win" },
    { name: "Dots",          url: "https://playdots.app" },
    { name: "Peanut Run",    url: "https://peanut-run.pages.dev" },
    { name: "Saucer Patrol", url: "https://saucer-patrol.pages.dev" },
    { name: "GOW Casino",    url: "https://gow-casino.pages.dev" },
  ],

  // Open the chosen domain in a new tab instead of swooping the same tab.
  openInNewTab: false,

  // Live-screenshot provider used to paint each frame at the VISITOR'S
  // own display resolution + aspect ratio.
  //   "thumio"    – image.thum.io  (fast, honours width/height, good CORS)
  //   "mshots"    – WordPress mShots (free, can be slow on first hit)
  //   "microlink" – api.microlink.io (clean, rate-limited on free tier)
  screenshotProvider: "thumio",

  // Feel of the first-person walk. Higher accel = snappier; higher
  // friction = stops sooner. Defaults are tuned for a calm, smooth glide.
  //   padLook   – gamepad right-stick look speed (radians/sec)
  //   touchLook – touch-drag look sensitivity (radians per screen pixel)
  movement: {
    accel: 43, friction: 8, maxSpeed: 6.4, mouseSensitivity: 1.0,   // walk speed +33%
    padLook: 2.6, touchLook: 0.0045,
  },

  // Master volume for the synthesised SFX / ambient pad (0–1).
  volume: 0.6,
};
