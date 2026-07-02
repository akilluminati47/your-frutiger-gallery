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

  // ── ENTRY-CARD LINES ───────────────────────────────────────────────
  // Set ANY of these to "" to remove that line from the splash entirely.
  //   subtitle    → under the title
  //   loadingNote → fine print while the world builds
  //   readyNote   → replaces loadingNote when everything is loaded;
  //                 {n} becomes the number of worlds
  subtitle:    "choose a world to enter",
  loadingNote: "Loading the world…",
  readyNote:   "{n} worlds ready",

  // ── PAUSE MENU ─────────────────────────────────────────────────────
  // Texts on the pause card. title/note accept "" to remove that line.
  pause: { title: "Paused", note: "Take a breath.", resume: "Resume" },

  // ── ATMOSPHERE ─────────────────────────────────────────────────────
  // bubbles: count = how many drift around the platform (0 disables;
  //          phones run ~2/3 of it), size/speed = multipliers on the
  //          stock feel (1.0 = as shipped).
  bubbles: { count: 44, size: 1.0, speed: 1.0 },
  // clouds: cover  = puffy-cloud coverage, 0 (clear sky) … 1 (max — the
  //                  stock amount).
  //         cirrus = the thin stretched horizontal streaks, 0 (none) …
  //                  1 (max — the old stock amount). Deliberately rare
  //                  by default so they read as an occasional accent.
  clouds: { cover: 1.0, cirrus: 0.35 },

  // Your works. Add or remove as many as you like — frames auto-arrange into
  // the gallery corridor and the glass floor + walls lengthen to fit.
  //   name → the plaque mounted on the panel (revealed when the world loads)
  //   url  → where the "visit?" swoop takes you (and what gets screenshotted)
  //
  // Order reads in PAIRS from the entrance to the back of the hall, front row first.
  // You spawn facing INTO the hall (+z), and for a +z-facing viewer "right" is -x,
  // so the EVEN indices (0,2,4,…) sit on your RIGHT wall and the ODD ones on your
  // LEFT (see the `side` breadcrumb in gallery.js buildGallery):
  //   row 0 (front): index 0 = your RIGHT, index 1 = your LEFT
  //   row 1        : index 2 = RIGHT,       index 3 = LEFT  … and so on.
  // The hall, glass floor/walls and surrounding hills all auto-scale to this count.
  // With shuffleOrder off, the LAST row is gaze-triggered (walk to the end and look
  // to reveal it); the rest auto-load as you approach.
  projects: [
    { name: "YouTube",       url: "https://youtube.com/@akilluminati47" }, // front · right
    { name: "Twitch",        url: "https://twitch.tv/akilluminati47" },    // front · left
    { name: "Demon Bot",     url: "https://demonbot.win/" },               // row2  · right
    { name: "guns.lol",      url: "https://guns.lol/akilluminati47" },     // row2  · left
    { name: "Dots",          url: "https://playdots.app/" },               // row3  · right
    { name: "Peanut Run",    url: "https://peanut-run.pages.dev/" },       // row3  · left
    { name: "Saucer Patrol", url: "https://saucer-patrol.pages.dev/" },    // row4  · right
    { name: "GoW Casino",    url: "https://gow-casino.pages.dev/" },       // row4  · left
    { name: "MIC FX",        url: "https://mic-fx.pages.dev/" },           // row5  · right
    { name: "DW Gallery",    url: "https://dw-gallery.pages.dev/" },       // row5  · left
    { name: "GitHub Repo",   url: "https://github.com/akilluminati47/frutiger-gallery" }, // back · right (gaze)
    { name: "Donate",        url: "https://streamelements.com/akilluminati47" },          // back · left  (gaze)
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

  // Next-gen post-processing (HDR bloom, filmic grade, dynamic resolution).
  // Leave true for the full look; set false only if a very old GPU struggles.
  postFX: true,

  // Feel of the first-person walk.
  movement: {
    accel: 43, friction: 8, maxSpeed: 6.4, mouseSensitivity: 1.0,
    padLook: 2.6, touchLook: 0.0045,
  },

  // Master volume for the synthesised SFX / ambient pad (0–1).
  volume: 0.6,
};

// ════════════════════════════════════════════════════════════════════
//  OWNER HANDSHAKE — a fork of this repo never wears the owner's face.
//  Everything above is the TEMPLATE every clone boots with. When the
//  site is served from one of the owner's own domains below, the
//  gallery fetches `settings` (a JSON file with the same shape as
//  CONFIG) and deep-merges it over the template BEFORE anything reads
//  it. Any other host fails the hostname handshake and stays a pure
//  template — so the owner's branding, links and tweaks can live in
//  that JSON (or a Worker behind it) instead of in the repo.
// ════════════════════════════════════════════════════════════════════
export const OWNER = {
  hosts: ["frutiger-gallery.pages.dev"],   // the owner's Cloudflare deployment(s)
  settings: "/owner.config.json",          // where the owner's real config lives
};
function mergeDeep(dst, src){
  for (const k of Object.keys(src)){
    const v = src[k];
    if (v && typeof v === "object" && !Array.isArray(v) &&
        dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])) mergeDeep(dst[k], v);
    else dst[k] = v;
  }
}
if (OWNER.hosts.includes(location.hostname)){
  try {
    // top-level await: gallery.js imports CONFIG, so the module graph waits
    // for the merge — the world never boots half-templated
    const res = await fetch(OWNER.settings, { cache: "no-store" });
    if (res.ok) mergeDeep(CONFIG, await res.json());
  } catch { /* offline / file missing → the template above stands */ }
}
