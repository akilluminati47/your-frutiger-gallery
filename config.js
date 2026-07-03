// ════════════════════════════════════════════════════════════════════
//  EDIT THIS FILE — drop your domains here and the gallery builds itself.
// ════════════════════════════════════════════════════════════════════
export const CONFIG = {
  // ── OWNER BREADCRUMB ───────────────────────────────────────────────
  // Your handle / artist name. This is the ONE value a new owner changes
  // after cloning (a future sign-up Worker can write it too). It becomes the
  // label on the entrance button.
  creator: "your-name",

  // Big title shown on the entry card and floating in the world.
  title: "FRUTIGER GALLERY",

  // Browser-tab title (the text on the tab / bookmark). "" keeps the
  // one baked into index.html.
  tabTitle: "Frutiger Gallery ● 3D Gallery",

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
  //
  // END WALLS: the `walls` toggles below can hang one more world on each end of
  // the hall — those take the FIRST entries of this list (00 = west first, then
  // 000 = east), which is why the wall slots sit at the head. An ODD count never
  // leaves a lonely half-row either way: the spare world is forced onto a free
  // end wall automatically (console off → the far wall, console on → the
  // entrance), so both side walls always stay in balanced pairs.
  projects: [
    // the odd 9th at the head: with the console on (it holds the far 00 wall)
    // the spare world is forced onto the sun-lit entrance wall as 000 — the
    // template designer's own gallery greets you on the way in
    { name: "Designer",      url: "https://akilluminati47.pages.dev/" },   // east wall · 000 (forced odd)
    { name: "Wikipedia",     url: "https://www.wikipedia.org/" },  // front · right
    { name: "YouTube",       url: "https://www.youtube.com/" },    // front · left
    { name: "Reddit",        url: "https://www.reddit.com/" },     // row2 · right
    { name: "Google",        url: "https://www.google.com/" },     // row2 · left
    { name: "Twitch",        url: "https://www.twitch.tv/" },      // row3 · right
    { name: "Facebook",      url: "https://www.facebook.com/" },   // row3 · left
    { name: "Donate", url: "https://streamelements.com/akilluminati47/" },               // back · right (gaze — designer donation portal)
    { name: "Fork Me", url: "https://github.com/akilluminati47/your-frutiger-gallery" }, // back · left  (gaze — this template, Aero Wall Console included)
  ],

  // ── END-WALL WORLDS (00 / 000) ─────────────────────────────────────
  // The hall's end walls can hold a world each, drawn from the FRONT of the
  // projects list above:
  //   west → the FAR wall at the end of the hall, slot 00, revealed by
  //          gaze like the last row. The console lives on this wall, so
  //          west only applies while console.enabled is false.
  //   east → the sun-lit ENTRANCE wall (the sun rises behind spawn), slot
  //          000, loading on the front row's beat. Turning it on also
  //          builds the entrance glass pane + rail.
  // Both on (console off) → list entry 0 goes west, entry 1 goes east.
  // With shuffleOrder on, whichever worlds land in those head slots ride
  // the walls that visit. Odd counts are always covered even with both
  // toggles off — see the note above the projects list.
  walls: { east: true, west: true },

  // ── CREATE-YOUR-OWN CONSOLE ────────────────────────────────────────
  // The glass config console on the hall's back wall: an interactive
  // builder where visitors design their own gallery live, then fork the
  // template and deploy it — the whole sign-up pipeline in-world.
  //   enabled    → false hides the console APP (the glass back wall itself
  //                always builds). The console is scaffolding: designs it
  //                commits default this off on the fork, and the owner can
  //                opt back in with the atmosphere-tab toggle.
  //   sourceRepo → the GitHub template repo the console forks for new owners
  console: {
    enabled: true,
    sourceRepo: "akilluminati47/your-frutiger-gallery",
  },

  // Shuffle the gallery order on every page load. Set false to keep the
  // fixed order written above.
  shuffleOrder: false,

  // Open the chosen domain in a new tab instead of swooping the same tab.
  openInNewTab: true,

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
    accel: 47, friction: 8, maxSpeed: 9, mouseSensitivity: 0.8,
    padLook: 3.6, touchLook: 0.0045,
  },

  // Master volume for the synthesised SFX / ambient pad (0–1).
  volume: 0.3,
};

// ════════════════════════════════════════════════════════════════════
//  OWNER HANDSHAKE — a fork of this repo never wears the owner's face.
//  Everything above is the TEMPLATE every clone boots with. On load the
//  gallery fetches `settings` (JSON, same shape as CONFIG) and deep-
//  merges it over the template BEFORE anything reads it. On Cloudflare
//  Pages that URL is answered by functions/owner.config.json.js, which
//  serves the OWNER_CONFIG secret set in the dashboard — so the owner's
//  branding and links never live in the repo. Forks have no secret, the
//  fetch 404s, and they boot the pure template. For local dev you can
//  drop a real owner.config.json next to index.html (it's gitignored).
// ════════════════════════════════════════════════════════════════════
export const OWNER = {
  settings: ["/api/owner-config",          // Pages Function → OWNER_CONFIG secret
             "/owner.config.json"],        // local-dev fallback (gitignored file)
};
function mergeDeep(dst, src){
  for (const k of Object.keys(src)){
    const v = src[k];
    if (v && typeof v === "object" && !Array.isArray(v) &&
        dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])) mergeDeep(dst[k], v);
    else dst[k] = v;
  }
}
for (const url of OWNER.settings){
  try {
    // top-level await: gallery.js imports CONFIG, so the module graph waits
    // for the merge — the world never boots half-templated
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok){ mergeDeep(CONFIG, await res.json()); break; }
  } catch { /* offline / no secret / file missing → try next, else template stands */ }
}
