// ════════════════════════════════════════════════════════════════════
//  EDIT THIS FILE — drop your domains here and the gallery builds itself.
// ════════════════════════════════════════════════════════════════════
export const CONFIG = {
  // Big title shown on the entry card and floating in the world.
  title: "DIGITAL REALM",
  subtitle: "choose a world to enter",

  // Your projects. Add as many as you like — frames auto-arrange into a
  // gallery corridor. `name` is the floating label, `url` is where the
  // "visit?" swoop takes you (and what gets screenshotted).
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
  // friction = stops sooner. Defaults are tuned for a calm glide.
  movement: { accel: 34, friction: 7.5, maxSpeed: 5.2, mouseSensitivity: 1.0 },

  // Master volume for the synthesised SFX / ambient pad (0–1).
  volume: 0.6,
};
