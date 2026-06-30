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
  //   name → the plaque mounted on the panel (revealed when the world loads)
  //   url  → where the "visit?" swoop takes you (and what gets screenshotted)
  //
  // Order reads in PAIRS from the entrance to the back of the hall — each row is
  // [left wall, right wall], front row first:
  //   row 0 (front): index 0 = your LEFT,  index 1 = your RIGHT
  //   row 1        : index 2 = LEFT,        index 3 = RIGHT  … and so on.
  // The hall, glass floor/walls and surrounding hills all auto-scale to this count.
  // With shuffleOrder off, the LAST row is gaze-triggered (walk to the end and look
  // to reveal it); the rest auto-load as you approach.
  projects: [
    { name: "DemonBot",      url: "https://demonbot.win/" },               // front · left
    { name: "guns.lol",      url: "https://guns.lol/akilluminati47" },     // front · right
    { name: "Dots",          url: "https://playdots.app/" },               // row2  · left
    { name: "Peanut Run",    url: "https://peanut-run.pages.dev/" },       // row2  · right
    { name: "Saucer Patrol", url: "https://saucer-patrol.pages.dev/" },    // row3  · left
    { name: "GOW Casino",    url: "https://gow-casino.pages.dev/" },       // row3  · right
    { name: "MIC FX",        url: "https://mic-fx.pages.dev/" },           // row4  · left
    { name: "DW Gallery",    url: "https://dw-gallery.pages.dev/" },       // row4  · right
    { name: "YouTube",       url: "https://youtube.com/@akilluminati47" }, // back  · left  (gaze)
    { name: "Twitch",        url: "https://twitch.tv/akilluminati47" },    // back  · right (gaze)
  ],

  // Shuffle the gallery order on every page load. Set false to keep the
  // fixed order written above.
  shuffleOrder: false,

  // Open the chosen domain in a new tab instead of swooping the same tab.
  openInNewTab: false,

  // Live-screenshot provider used to paint each frame.
  //   "thumio"    – image.thum.io  (fast, honours width/height, good CORS)
  //   "mshots"    – WordPress mShots (free, can be slow on first hit)
  //   "microlink" – api.microlink.io (clean, rate-limited on free tier)
  screenshotProvider: "thumio",

  // Feel of the first-person walk.
  movement: {
    accel: 43, friction: 8, maxSpeed: 6.4, mouseSensitivity: 1.0,
    padLook: 2.6, touchLook: 0.0045,
  },

  // Master volume for the synthesised SFX / ambient pad (0–1).
  volume: 0.6,
};
