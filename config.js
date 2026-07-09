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
  // END WALLS: the `walls` slots below can hang one more world on each end of
  // the hall — INDEPENDENT strings, never drawn from this list. An ODD count
  // here never leaves a lonely half-row: the LAST entry becomes a wildcard and
  // rides a free end wall automatically (west first while the console is off,
  // else the entrance), so the side walls stay in pairs. If BOTH end walls
  // already hold worlds there's no free wall to take it — the odd one is then
  // blocked (left out of the hall, kept here) rather than stranded alone.
  projects: [
    { name: "Wikipedia",     url: "https://www.wikipedia.org/" },  // front · right
    { name: "YouTube",       url: "https://www.youtube.com/" },    // front · left
    { name: "Reddit",        url: "https://www.reddit.com/" },     // row2 · right
    { name: "Google",        url: "https://www.google.com/" },     // row2 · left
    { name: "Twitch",        url: "https://www.twitch.tv/" },      // row3 · right
    { name: "Facebook",      url: "https://www.facebook.com/" },   // row3 · left
    { name: "GitHub Repo", url: "https://github.com/akilluminati47/your-frutiger-gallery" }, // back · right (gaze — this template, Aero Wall Console included)
    { name: "Donate", url: "https://streamelements.com/akilluminati47/" },                   // back · left  (gaze — designer donation portal)
  ],

  // ── END-WALL WORLDS (00 / 000) ─────────────────────────────────────
  // The hall's end walls are INDEPENDENT slots with their own strings —
  // they never take from the projects list above:
  //   west → the FAR wall at the end of the hall, slot 00, revealed by
  //          gaze like the last row. The console lives on this wall, so a
  //          west world only hangs while console.enabled is false (the
  //          strings keep, untouched, meanwhile).
  //   east → the sun-lit ENTRANCE wall (the sun rises behind spawn), slot
  //          000, loading on the front row's beat.
  // on: true builds that wall's glass pane + rail even with an empty slot
  // (an empty toggled wall is just glass); on: false keeps the strings but
  // builds nothing — unless the odd-count wildcard needs the wall: an ODD
  // projects count sends its LAST entry to a free end wall automatically
  // (west first, console off; else east), building that pane if it must — or,
  // if both end walls are already taken, blocks that odd world instead.
  //
  // live: true → the hung world doesn't swoop the browser away: walk up,
  // press E, and the slab WAKES as the real page — a fully interactive
  // in-world screen (your pointer works on the slab, the site's own cursor
  // and all; click outside it or Esc to step back into the hall). Works
  // with any URL that allows iframe embedding, hosted in any repo — the
  // world does NOT need to live inside this one. A west live screen waits
  // while the console is on (the console owns that wall).
  // The west slot ships HARDCODED to the template's own home — the calling
  // card. The console seeds every design from these strings, and new designs
  // default the builder OFF, so a published fork hangs a "Build a Gallery"
  // panel on its far wall pointing back here — the loop that grows the place.
  // Owners who keep the builder ON park this under the console instead (the
  // strings survive); owners who want it gone just clear them in the console.
  walls: {
    west: { on: true, name: "Build a Gallery", url: "https://frutiger-gallery.pages.dev/", live: false },
    east: { on: true, name: "Designer", url: "https://akilluminati47.pages.dev/", live: false },
  },

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
  openInNewTab: false,

  // Live-screenshot provider used to paint each frame.
  //   "thumio"    – image.thum.io  (fast, honours width/height, good CORS)
  //   "mshots"    – WordPress mShots (free, can be slow on first hit)
  //   "microlink" – api.microlink.io (clean, rate-limited on free tier)
  screenshotProvider: "microlink",

  // Next-gen post-processing (HDR bloom, filmic grade, dynamic resolution).
  // Leave true for the full look; set false only if a very old GPU struggles.
  postFX: true,

  // Feel of the first-person walk.
  movement: {
    accel: 69, friction: 10, maxSpeed: 13, mouseSensitivity: 0.75,
    padLook: 4.2, touchLook: 0.0047,
  },

  // Master volume for the SFX (0–1).
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
const bust = Date.now().toString(36); // cache:"no-store" only bypasses the
// browser's cache — Cloudflare's edge once pinned a stale owner.config.json
// for a week (s-maxage=604800), so the fetch key must be one no shared
// cache has ever seen
for (const url of OWNER.settings){
  try {
    // top-level await: gallery.js imports CONFIG, so the module graph waits
    // for the merge — the world never boots half-templated
    const res = await fetch(`${url}?t=${bust}`, { cache: "no-store" });
    if (res.ok){ mergeDeep(CONFIG, await res.json()); break; }
  } catch { /* offline / no secret / file missing → try next, else template stands */ }
}
