import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';

/* ════════════════════════════════════════════════════════════════
   0 · helpers
   ════════════════════════════════════════════════════════════════ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIO  = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
const dead    = (v, dz=0.14) => Math.abs(v) < dz ? 0 : v;     // analog stick deadzone
const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════════════════════════
   0b · randomise gallery order each page load (CONFIG.shuffleOrder)
        Fisher–Yates, in place, BEFORE anything reads the list (the
        prefetch loop + the corridor layout). Whichever worlds land in
        the final row stay gaze-triggered.
   ════════════════════════════════════════════════════════════════ */
if (CONFIG.shuffleOrder !== false){
  const p = CONFIG.projects;
  for (let i = p.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
}

/* ════════════════════════════════════════════════════════════════
   1 · detect the VISITOR'S display → frame aspect + screenshot size
   ════════════════════════════════════════════════════════════════ */
// ── detect touch FIRST — all geometry + screenshot sizing flows from this ──
const isTouch = matchMedia('(pointer: coarse)').matches
             || (navigator.maxTouchPoints || 0) > 0
             || 'ontouchstart' in window;
const lowPerf = isTouch;

const realDpr = window.devicePixelRatio || 1;
const SW = window.screen.width, SH = window.screen.height;

// Mobile → always portrait screenshots so sites render their phone layout correctly.
// Some Android devices report landscape dimensions even held portrait, so we swap.
const ASPECT = isTouch
  ? Math.min(SW, SH) / Math.max(SW, SH)    // < 1 → tall portrait frames on phones
  : (SW / SH || 16 / 9);

// Capture ONE screenful of the visitor's own device, sized to the panel aspect:
//   • SHOT_W is the render viewport's CSS width, so each site lays out for THIS
//     screen — phones get the mobile layout (big hero/emoji), desktops the desktop
//     layout. Desktop width is clamped so ultra-wide monitors don't trigger a
//     stretched layout.
//   • SHOT_H is derived from ASPECT, so the capture already matches the device
//     panel. We then cover-fit it (see fitPanelToImage) edge-to-edge, centred +
//     top-anchored — no empty bars, no off-centre crop, full content in view.
const SHOT_W = isTouch ? Math.round(Math.min(SW, SH))
                       : clamp(Math.round(SW), 1024, 1600);
const SHOT_H = Math.round(SHOT_W / ASPECT);

function withProtocol(u){ return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

function screenshotURL(provider, url, w, h){
  const full = withProtocol(url);
  const enc  = encodeURIComponent(full);
  // w is both the render viewport width AND the output width, h the matching crop,
  // so the capture lands at the device/panel aspect (one screenful). Every provider
  // gets generous render time so the capture is fully painted (fonts + lazy images).
  switch (provider){
    case 'mshots':
      // mShots renders fresh server-side; vpw/vph pin the viewport so the crop is a
      // single device screen, not a tall slice with empty page below.
      return `https://s.wordpress.com/mshots/v1/${enc}?w=${w}&h=${h}&vpw=${w}&vph=${h}`;
    case 'microlink':
      // networkidle0 + a settle delay → wait until the page is truly quiet (web
      // fonts swapped in, images decoded) instead of grabbing a half-painted frame.
      return `https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`
           + `&viewport.width=${w}&viewport.height=${h}&viewport.deviceScaleFactor=${isTouch ? 2 : 1}`
           + `&waitUntil=networkidle0&waitForTimeout=2500&meta=false`;
    case 'thumio':
    default:
      // width == viewportWidth + crop/height → exactly the visitor's screen at the
      // panel aspect. wait/18 lets slow sites pull webfonts + heavy/lazy assets; png
      // keeps text crisp; maxAge serves a day-old cache so repeat visits stay fast.
      return `https://image.thum.io/get/width/${w}/crop/${h}/viewportWidth/${w}`
           + `/wait/18/maxAge/86400/png/noanimate/${full}`;
  }
}

// Robust capture: try providers in order, first one that actually decodes wins.
// Guards against a single provider rate-limiting, blocking a domain, or returning
// a broken/empty image — the live fetch falls back instead of leaving a blank.
const PROVIDERS = [...new Set([CONFIG.screenshotProvider, 'thumio', 'mshots', 'microlink'])];
function fetchScreenshot(url, onImg, onFail){
  let i = 0;
  const tryNext = async () => {
    if (i >= PROVIDERS.length){ onFail?.(); return; }
    const prov = PROVIDERS[i++];
    try {
      // fetch first so the HTTP status is visible: thum.io answers rate-limits
      // with a 403 that still carries a decodable "error" image, which would
      // sail through a plain <img> onload and paint a blank panel forever.
      const res = await fetch(screenshotURL(prov, url, SHOT_W, SHOT_H), { mode: 'cors' });
      if (!res.ok) return tryNext();
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return tryNext();
      const obj = URL.createObjectURL(blob);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(obj); img.naturalWidth > 1 ? onImg(img) : tryNext(); };
      img.onerror = () => { URL.revokeObjectURL(obj); tryNext(); };
      img.src = obj;
    } catch { tryNext(); } // no CORS / network error → next provider
  };
  tryNext();
}

/* ════════════════════════════════════════════════════════════════
   1b · pre-fetch all screenshots immediately
        We know device/aspect/SHOT_W×SHOT_H right now — fire every
        request before the user even clicks Enter. The bar sequence
        is pure reveal choreography; images queue in the background.
   ════════════════════════════════════════════════════════════════ */
// 'pending' | THREE.Texture | null (null = load failed, still reveal)
const prefetchMap = new Map();

function preFetchScreenshots(){
  // corridor worlds + the end-wall slots — the slots are independent strings
  // that live OUTSIDE projects (see planWalls), so they queue here too. The
  // frames key the cache by their (trimmed) slot url, hence the trim.
  const walls = normWalls(CONFIG.walls);
  const urls = new Set(CONFIG.projects.map(p => p.url));
  for (const s of ['west', 'east'])
    if (walls[s].on && walls[s].url.trim()) urls.add(walls[s].url.trim());
  for (const url of urls){
    prefetchMap.set(url, 'pending');
    fetchScreenshot(url,
      (img) => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = true;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;           // no crop — the panel snaps to this image's aspect on reveal
        renderer.initTexture(tex);        // upload to the GPU NOW (menu idle) — a reveal is a zero-hitch map swap
        prefetchMap.set(url, tex);
      },
      () => prefetchMap.set(url, null)
    );
  }
}
// Fire immediately — renderer + FW are set up synchronously below, and every
// onload callback is async so it sees the fully-initialised module.
preFetchScreenshots();

/* ════════════════════════════════════════════════════════════════
   2 · renderer / scene / camera
   ════════════════════════════════════════════════════════════════ */
let renderer, scene, camera, controls;
// stylised-tall visitor: the slabs hang dead-centred on THIS eye line, so the
// raised eye rides them up the (taller) glass — the wall's largest padding
// lands UNDER the slabs instead of them skimming the floor (see FH / WALL_H)
const eyeHeight = 2.3;

// FX = the full HDR post pipeline (bloom + filmic grade). Kill-switch in config
// for very weak GPUs — when off we fall back to plain forward rendering with
// canvas MSAA, exactly the pre-remix path.
const FX = CONFIG.postFX !== false;

try {
  // with the composer the scene renders into a multisampled HDR target, so the
  // default framebuffer doesn't need its own MSAA — saves a full set of samples
  renderer = new THREE.WebGLRenderer({ antialias: !FX, powerPreference:'high-performance' });
} catch (e){ fatal('Your browser/GPU could not start WebGL.'); throw e; }

const BASE_PR = Math.min(realDpr, lowPerf ? 1.5 : 2);   // fewer fragments on retina phones
renderer.setPixelRatio(BASE_PR);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the casters (panels/walls/legs) and the sun never move, so the shadow map is
// computed ONCE (see boot) instead of re-rendered every frame
renderer.shadowMap.autoUpdate = false;
$('scene').appendChild(renderer.domElement);

// a lost GPU context (driver reset, OS sleep, mobile tab eviction) leaves a frozen
// canvas — surface it instead, and reload for a clean state if the GPU comes back
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  fatal('The graphics device was reset — reloading…');
});
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xd7f1ff, 0.0052);   // gentle haze so the green hills still read at the horizon

camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, eyeHeight, -6);
camera.lookAt(0, eyeHeight, 10);

// reflections for the glossy glass frames / text — the environment map itself is
// built from the real sky dome in section 3 (once skyMat exists), so every env
// reflection in the world shows clouds + sun, never phantom studio lights
const pmrem = new THREE.PMREMGenerator(renderer);

/* ── HDR post pipeline: scene → UnrealBloom (HDR) → ACES/sRGB → filmic grade ──
   The scene is rendered into a half-float, multisampled target (real MSAA inside
   the composer — crisp edges, no FXAA smear). UnrealBloomPass runs on the HDR
   values so only genuinely bright things glow: the sun disk, the lens flare,
   white panel screens. OutputPass then applies ACES + the sRGB transform, and a
   final grade pass adds the subtle film-camera artifacts (vignette, animated
   grain, a touch of saturation) that make real-time output read as
   "engine-rendered" rather than flat rasterisation. */
let composer = null, gradePass = null, bloomPass = null;
// overlay scene for the lens flare — rendered directly to the canvas after the
// composer (see the flare block in section 3 for why it can't live in-scene)
const flareScene = FX ? new THREE.Scene() : null;
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uRes:     { value: new THREE.Vector2(innerWidth * BASE_PR, innerHeight * BASE_PR) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    float gnoise(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // (no chromatic aberration: the RGB split read as "misaligned" red/blue
      // fringes on small high-contrast sprites like the bubbles near the screen
      // edges — the frame stays crisp, the vignette/grain carry the filmic feel)
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // gentle filmic vignette
      col *= 1.0 - smoothstep(0.18, 0.85, r2) * 0.30;
      // slight saturation lift (post-tonemap, so it never clips hues)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 1.07);
      // fine animated grain, scaled down in the shadows so blacks stay clean
      float g = gnoise(vUv * uRes + fract(uTime) * 371.0) - 0.5;
      col += g * 0.016 * (0.35 + 0.65 * luma);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* NaN/Inf scrub between the scene render and bloom. The beveled "visit?"
   TextGeometry can rasterise degenerate slivers whose zero-length normals come
   out of normalize() as NaN, and its razor-sharp clearcoat glints can spike
   past half-float range at close range — either poisons UnrealBloom's mip
   chain, which smears ONE bad pixel into a screen-sized black rectangle for a
   frame (the "black flicker" when circling the text). Scrub the buffer once
   here so every downstream pass (bloom, ACES, grade) only ever sees finite HDR. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // NaN fails every comparison (and rides straight through mix()/clamp(),
      // since NaN*0 is still NaN) — so catch "not >= 0" with real branch
      // assignments. This also zeroes stray negatives.
      bvec3 bad = not(greaterThanEqual(c, vec3(0.0)));
      if (bad.r) c.r = 0.0;
      if (bad.g) c.g = 0.0;
      if (bad.b) c.b = 0.0;
      // cap fireflies/Inf well above the sun disk (~3.4) so genuine HDR keeps
      // its full bloom while a single hot glint can't flash-bomb the mip chain
      gl_FragColor = vec4(min(c, vec3(24.0)), 1.0);
    }`,
};
if (FX){
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType,
    samples: lowPerf ? 2 : 4,          // MSAA inside the composer
  });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(BASE_PR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));   // scrub NaN/Inf before bloom
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight),
    lowPerf ? 0.28 : 0.35,   // strength — a halo, not a smear
    0.4,                     // radius
    1.2);                    // threshold — sits ABOVE the ACES-lifted screen whites
                             // (1.12) and name plaques (1.15) so the gallery reads
                             // crisp, while genuinely HDR pixels (sun disk, silver
                             // linings) still feed the glow
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());          // ACES tonemap + sRGB, exactly once
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
}

/* ── dynamic resolution governor — UE-style stability ─────────────────────────
   Tracks the average frame time and trades internal resolution for a locked
   frame rate: sustained > ~21 ms drops the render scale a step (never below
   0.58), sustained < ~14.5 ms climbs back toward native. The window average
   (not single frames) means one GC hitch or tab-switch spike never triggers it. */
let resScale = 1, perfTime = 0, perfFrames = 0;
function applyResolution(){
  const pr = BASE_PR * resScale;
  renderer.setPixelRatio(pr);
  if (composer) composer.setPixelRatio(pr);
  gradePass?.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr);
  if (moteMat) moteMat.uniforms.uPR.value = pr;
}
function perfGovern(dt){
  perfFrames++; perfTime += dt;
  if (perfTime < 1.4 || perfFrames < 20) return;
  const avg = perfTime / perfFrames;
  perfTime = 0; perfFrames = 0;
  if (avg > 0.021 && resScale > 0.58){       // struggling → shed pixels
    resScale = Math.max(0.58, resScale - 0.14);
    applyResolution();
  } else if (avg < 0.0145 && resScale < 1){  // headroom → climb back up
    resScale = Math.min(1, resScale + 0.07);
    applyResolution();
  }
}

/* ════════════════════════════════════════════════════════════════
   3 · world — layout, premium sky, light, hills, glass corridor
   ════════════════════════════════════════════════════════════════ */
const bubbles = [];
// loading-strip plane shared bits — sized in buildGallery (needs FW/DEV_DEPTH),
// consumed by startFrameLoading
let stripGeo = null, stripZ = 0;
// decorative objects that are SKIPPED inside the mirror passes (they barely show
// in a faint reflection but cost a full extra draw in each of the 3 reflectors)
const noReflect = [];
let galleryStartTime = null;   // seconds-from-load when the visitor entered (set in beginPlay)

// gallery + corridor footprint (everything below is derived from this)
const GROUND_Y = -8;                    // grassy world far beneath the glass
const HALF = 4.7, DZ = 7.2, START_Z = 9;
const FH = 2.64, FW = FH * ASPECT, FRAME_Y = eyeHeight;  // slab faces +10%, still dead-centred on the eye line

/* ── end-wall worlds (00 / 000) + the odd-panel wildcard (0000) ────────────
   The corridor hangs worlds in PAIRS from CONFIG.projects (world 0…N). The
   END walls are INDEPENDENT slots with their own strings — they never take
   from that list: WEST is the far wall at the end of the hall — slot 00,
   the wall the console occupies while it's enabled — and EAST the sun-lit
   entrance wall (the sun sits up & behind spawn) — slot 000. A wall's glass
   pane builds when its toggle is ON, world or no world (an empty toggled
   slot is just glass), and a toggled-OFF slot keeps its strings — it simply
   doesn't build. The west pane also always arrives with the console (the
   console needs its backwall); a west world only hangs while the console is
   off. The one forcing rule: an ODD corridor count. Its LAST entry becomes
   the unannounced 0000 wildcard and rides a free end wall — west first
   (priority: console off and no west world), else east — building that
   wall's pane even when its toggle is off. Both walls already holding
   worlds → the lone world rides the last row. */
const CON_ENABLED = CONFIG.console?.enabled !== false;   // section 5c's app gate — the layout needs it up here
function normWalls(w){
  // one wall slot = { on, name, url }. Legacy boolean toggles (old owner
  // configs / saved drafts) normalise to a toggled empty slot.
  const one = v => (v && typeof v === 'object')
    ? { on: v.on === true, name: String(v.name ?? ''), url: String(v.url ?? '') }
    : { on: v === true, name: '', url: '' };
  return { west: one(w?.west), east: one(w?.east) };
}
function planWalls(count, walls, consoleOn){
  const westWorld = !consoleOn && walls.west.on && !!walls.west.url.trim();
  const eastWorld = walls.east.on && !!walls.east.url.trim();
  let wild = null;                                       // where the odd 0000 wildcard lands
  if (count % 2 === 1){
    if (!consoleOn && !westWorld) wild = 'west';         // far wall first — use it or build it
    else if (!eastWorld)          wild = 'east';         // else the sun-lit entrance
  }                                                      // both taken → lone last row
  return {
    west: westWorld ? 'slot' : wild === 'west' ? 'wild' : null,
    east: eastWorld ? 'slot' : wild === 'east' ? 'wild' : null,
    wild,
    // the glass panes follow the TOGGLES (empty glass is fine), plus the
    // console's own backwall and whichever wall the wildcard forces
    westPane: consoleOn || walls.west.on || wild === 'west',
    eastPane: walls.east.on || wild === 'east',
  };
}
const WALLS = normWalls(CONFIG.walls);
const WALL_PLAN = planWalls(CONFIG.projects.length, WALLS, CON_ENABLED);
const wallSlot  = s => ({ name: WALLS[s].name.trim() || 'World', url: WALLS[s].url.trim() });
const wildWorld = WALL_PLAN.wild ? CONFIG.projects[CONFIG.projects.length - 1] : null;
const wallProjects = {
  east: WALL_PLAN.east === 'slot' ? wallSlot('east') : WALL_PLAN.east === 'wild' ? wildWorld : null,
  west: WALL_PLAN.west === 'slot' ? wallSlot('west') : WALL_PLAN.west === 'wild' ? wildWorld : null,
};
const sideProjects = WALL_PLAN.wild ? CONFIG.projects.slice(0, -1) : CONFIG.projects.slice();
const EAST_ON = WALL_PLAN.eastPane;     // entrance glass pane + rail
const WEST_ON = WALL_PLAN.westPane;     // far/back glass pane + rail (always with the console)
const PANEL_COUNT = sideProjects.length + (wallProjects.east ? 1 : 0) + (wallProjects.west ? 1 : 0);

const ROWS  = Math.ceil(sideProjects.length / 2);
const END_Z = START_Z + (Math.max(ROWS, 1) - 1) * DZ;   // a walls-only hall keeps one row of floor
// ── loading orchestration constants ──────────────────────────────────────
const GAZE_ROWS      = 1;                    // last N rows are gaze-only (not auto)
const GAZE_ROW_START = ROWS - GAZE_ROWS;    // first gaze row index
const INTRO_DUR      = 2.6;                 // intro glide duration (seconds)
const INTRO_START_Y  = 3.3;                 // camera height at the start of the glide-in (~1 m over the raised eye)
const LOAD_DUR       = 1.8;                 // bar pace while a fetch is still in flight (auto frames)
const GAZE_LOAD_DUR  = 2.0;                 // gaze-triggered frames ALWAYS play the bar this long — the
                                            // reveal answers the player's look, so it gets its cutscene
                                            // even when the screenshot is already sitting in the cache

const WALL_X  = HALF + 2.0;             // glass side walls
const FRAME_X = WALL_X - 0.12;          // frames hang pressed flat against the glass walls
// tall glass — no longer derived from the console slab: the pane clears the
// (10%-larger) slab by ~0.6 of reveal so the console stopped sitting tight
// against the rail, and the raised eye line shifts every slab's breathing
// room downward — the largest padding sits under the slabs
const WALL_H  = 5.8;
// every pane-top rail (sides + both end walls) shares one glossy material and
// one corner radius — the corridor's weld math (RAIL_BACK / RAIL_FRONT) and
// the end rails in buildConsole / the front wall all read these
const RAIL_R   = 0.05;
const RAIL_MAT = new THREE.MeshPhysicalMaterial({
  color:0xffffff, roughness:0.08, clearcoat:1, envMapIntensity:1.4,
  iridescence: lowPerf ? 0 : 0.4, iridescenceIOR: 1.3,
});
const PLAT_Z0 = -7, PLAT_Z1 = END_Z + 7;
const DESK_CZ = (PLAT_Z0 + PLAT_Z1) / 2;
const DESK_W  = (WALL_X + 1.0) * 2;
const DESK_D  = PLAT_Z1 - PLAT_Z0;

const SUN_DIR = new THREE.Vector3(-22, 58, -70).normalize();   // sun beams from up & behind you

/* ── premium sky dome: gradient + sun glow + animated FBM clouds ── */
let skyMat;
{
  // CONFIG.clouds → baked into the shader at build time (no per-frame uniform
  // cost): cover 0…1 slides the coverage threshold (1 = the stock sky, and the
  // max), cirrus 0…1 gates how many FBM peaks survive as streaks (1 = the old
  // stock amount, also the max — rarer by default, see config.js).
  const COVER  = clamp(+(CONFIG.clouds?.cover  ?? 1)    || 0, 0, 1);
  const CIRRUS = clamp(+(CONFIG.clouds?.cirrus ?? 0.35) || 0, 0, 1);
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms:{
      uTime:  { value:0 },
      top:    { value:new THREE.Color(0x1f7fe0) },
      mid:    { value:new THREE.Color(0x86c8ff) },
      bottom: { value:new THREE.Color(0xeefaff) },
      sunCol: { value:new THREE.Color(0xfff3d6) },
      sunDir: { value:SUN_DIR.clone() },
    },
    vertexShader:`
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader:`
      varying vec3 vP;
      uniform float uTime;
      uniform vec3 top, mid, bottom, sunCol, sunDir;

      // Dave Hoskins hash — no axis-aligned streaks (the old one drew flat lines)
      float hash(vec2 p){
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        mat2 m = mat2(1.6,1.2,-1.2,1.6);
        for(int i=0;i<${lowPerf ? 3 : 5};i++){ v += a*vnoise(p); p = m*p; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 dir = normalize(vP);
        float h = clamp(dir.y*0.5+0.5, 0.0, 1.0);
        vec3 sky = mix(bottom, mid, smoothstep(0.0,0.5,h));
        sky = mix(sky, top, smoothstep(0.45,1.0,h));

        float sd  = max(dot(dir, normalize(sunDir)), 0.0);

        // atmospheric scattering hugging the horizon: a cool whitening all round,
        // plus a warm tint on the sun's side of the sky
        float horiz = pow(1.0 - clamp(dir.y, 0.0, 1.0), 6.0);
        sky = mix(sky, vec3(0.93, 0.97, 1.0), horiz * 0.28);
        sky += sunCol * horiz * pow(sd, 2.0) * 0.14;

        float disk = smoothstep(0.9972, 0.9991, sd);
        float halo = pow(sd, 90.0)*0.85 + pow(sd, 11.0)*0.18;

        // animated FBM clouds — kept high so the horizon projection never stretches
        // the noise into streaks. Desktop domain-warps the field (fbm fed through
        // fbm) so puffs billow and curl instead of sliding as a rigid sheet.
        float above = smoothstep(0.12, 0.42, dir.y);
        vec2 uv = dir.xz / max(dir.y, 0.24) * 0.5;
        ${lowPerf ? `
        vec2 cuv = uv + vec2(uTime*0.010, uTime*0.004);` : `
        vec2 q = vec2(fbm(uv + uTime*0.006), fbm(uv + vec2(5.2, 1.3) - uTime*0.005));
        vec2 cuv = uv + q*0.6 + vec2(uTime*0.010, uTime*0.004);`}
        float dens = fbm(cuv)*0.68 + fbm(cuv*2.3 + 7.0)*0.32;
        ${COVER < 0.02 ? `
        float cov  = 0.0;` : `
        float cov  = smoothstep(${(0.80 - 0.35*COVER).toFixed(4)}, 0.80, dens) * above;`}
        // shade the base of each puff darker, and silver-line the ones near the sun
        vec3 cloudCol = mix(vec3(0.66,0.76,0.90), vec3(1.0), smoothstep(0.28,0.94,dens));
        cloudCol += sunCol * (halo*0.5 + pow(sd, 3.0)*0.22);
        sky = mix(sky, cloudCol, cov*0.92);
        ${(lowPerf || CIRRUS < 0.02) ? '' : `
        // thin high cirrus streaks drifting on their own layer (desktop only).
        // CONFIG.clouds.cirrus slides the survival threshold, so low values
        // make the streaks genuinely RARER (only the tallest FBM peaks make
        // it), not just dimmer; cirrus = 1 is exactly the old stock amount.
        float ciBand = smoothstep(0.20, 0.55, dir.y);
        vec2 cuv2 = dir.xz / max(dir.y, 0.30);
        float ci = fbm(cuv2 * vec2(0.55, 2.8) + vec2(uTime*0.006, 0.0));
        ci = smoothstep(${(0.82 - 0.22*CIRRUS).toFixed(4)}, 0.88, ci) * ciBand * ${(0.30*(0.55 + 0.45*CIRRUS)).toFixed(4)} * (1.0 - cov);
        sky = mix(sky, vec3(1.0), ci);`}

        ${FX ? `
        // HDR-pipeline compensation: this shader's palette is authored in display
        // space, but the composer treats the buffer as LINEAR and applies ACES +
        // the sRGB transform afterwards — which would double-brighten the whole
        // dome into a milky haze (and every glass reflection of it). Approximate
        // the inverse transform here so the authored Aero blues survive grading.
        sky = pow(max(sky, 0.0), vec3(2.2)) * 1.06;` : ''}

        // sun disk + soft halo — added AFTER compensation so they stay genuinely
        // HDR for the bloom pass; dimmed where cloud puffs pass over the disk
        sky += sunCol * (disk*2.4 + halo) * (1.0 - cov*0.85);

        // dither to kill 8-bit banding
        sky += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(sky, 1.0);
      }`
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat));

  // IBL / env reflections come from THIS sky (a small stand-in dome sharing the
  // material), not three's RoomEnvironment: the room env's bright light panels
  // reflected off the huge glossy slab under the glass floor and bloomed into
  // giant phantom "ceiling light" glare blobs. With the real sky as the env,
  // glossy surfaces (slab, rails) mirror clouds + the one true sun.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
}

// lighting: soft sky/grass hemisphere + warm Vista sun
const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9fd886, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeccb, 2.25);
sun.position.copy(SUN_DIR.clone().multiplyScalar(95));
sun.castShadow = true;
// 4K shadow map on desktop — the map is rendered ONCE (static casters), so the
// only recurring cost is the sharper lookup; mobile stays at 2K
const SHADOW_RES = lowPerf ? 2048 : 4096;
sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;   sun.shadow.camera.bottom = -50;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;      // kills acne on the curved hill silhouettes
sun.target.position.set(0, 1, DESK_CZ);
scene.add(sun.target);
scene.add(sun);

// dynamic lens flare streaming from the sun — ghosts track across the view
// as you turn, and fade out when the sun is hidden behind glass/hills/frames
{
  function flareTex(stops){
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64,64,0,64,64,64);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g; x.fillRect(0,0,128,128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const texGlow  = flareTex([[0,'rgba(255,255,255,1)'],[0.18,'rgba(255,244,214,0.92)'],[0.5,'rgba(255,224,170,0.32)'],[1,'rgba(255,210,150,0)']]);
  const texGhost = flareTex([[0,'rgba(255,255,255,0)'],[0.55,'rgba(200,225,255,0.26)'],[0.82,'rgba(170,210,255,0.12)'],[1,'rgba(170,210,255,0)']]);
  // (no anamorphic streak on the disk: the flat cyan line read as a smear ON
  // the sun itself — the warm glow + the ghost train carry the lens feel)

  const lf = new Lensflare();
  lf.addElement(new LensflareElement(texGlow, 340, 0,    new THREE.Color(0xfff0cf)));
  lf.addElement(new LensflareElement(texGhost, 46, 0.18));
  lf.addElement(new LensflareElement(texGhost, 72, 0.34));
  lf.addElement(new LensflareElement(texGhost, 120, 0.5));
  lf.addElement(new LensflareElement(texGhost, 58, 0.64));
  lf.addElement(new LensflareElement(texGhost, 94, 0.8));
  lf.addElement(new LensflareElement(texGlow, 130, 1.0,  new THREE.Color(0xcfe6ff)));
  lf.position.copy(SUN_DIR.clone().multiplyScalar(460));   // sit on the sky-shader sun
  // Lensflare tests occlusion by copying a tiny framebuffer patch — that readback
  // is illegal from the composer's multisampled HDR target (it leaves a dark box
  // on the sun). So under FX the flare lives in its own overlay scene, rendered
  // straight to the canvas AFTER the composer — lens artifacts belong on top of
  // the graded image anyway, exactly where a real camera would add them.
  if (flareScene){ flareScene.add(lf); }
  else { scene.add(lf); noReflect.push(lf); }               // FX off: classic in-scene flare
}

// rolling green "Bliss" hills — ringed around the perimeter, never on the platform.
// One InstancedMesh (a single draw call for all of them) with per-hill colour.
{
  const greens = [0x6fbf46, 0x7ed05a, 0x63ad3e, 0x86d669];
  const N = 30;
  // keep-out radius: nothing in the landscape may intrude inside this circle
  const KEEPOUT = Math.hypot(DESK_W, DESK_D) / 2 + 10;
  const hills = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 16, 10),                    // unit sphere; real size folded into per-instance scale
    new THREE.MeshStandardMaterial({ roughness:1 }), N);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < N; i++){
    const r    = 40 + Math.random()*40;
    const sxz  = 1 + Math.random()*0.5;
    const effR = r * sxz;                                   // the hill's true footprint radius
    const ang  = (i / N) * Math.PI * 2 + Math.random()*0.18;
    const dist = KEEPOUT + effR + Math.random()*90;         // near edge always clears the platform
    dummy.position.set(Math.cos(ang)*dist, GROUND_Y, DESK_CZ + Math.sin(ang)*dist);
    dummy.scale.set(r*sxz, r*(0.24 + Math.random()*0.14), r*sxz);
    dummy.updateMatrix();
    hills.setMatrixAt(i, dummy.matrix);
    hills.setColorAt(i, col.setHex(greens[i % greens.length]));
  }
  hills.instanceMatrix.needsUpdate = true;
  hills.instanceColor.needsUpdate = true;
  hills.frustumCulled = false;                             // unit-geo instance bounds would mis-cull the real hills
  scene.add(hills);
  noReflect.push(hills);
}

/* ── semi-transparent mirror: a Reflector you can also see through ──
   patches the Reflector shader so the reflection blends over whatever
   is behind the glass (the landscape), instead of being a solid mirror. */
const allReflectors = [];
function glassReflector(geo, { tex=1024, color=0x9fc0dd, alpha=0.5 } = {}){
  const r = new Reflector(geo, {
    clipBias:0.003, textureWidth:tex, textureHeight:tex, color:new THREE.Color(color),
  });
  const m = r.material;

  // ── cheap softening blur (all devices) ─────────────────────────────────
  // A tiny 5-tap cross blur in the reflector's own shader. On mobile it hides
  // the pixelated low-res 512² mirror; everywhere it adds realism — real
  // surfaces never give a perfect razor-sharp mirror, so the slight diffusion
  // reads as polished glass rather than a flat copy. Costs ~4 extra reads from
  // a small, cache-hot texture. The offset is in texels so the softening looks
  // the same whether the mirror is 512 (mobile) or 1024 (desktop).
  {
    const sampleTarget = 'vec4 base = texture2DProj( tDiffuse, vUv );';
    if (m.fragmentShader.includes(sampleTarget)){
      const tx = (1.3 / tex).toFixed(6);          // ~1.3-texel offset in projective space
      m.fragmentShader = m.fragmentShader.replace(sampleTarget, `
        vec2 _tx = vec2(${tx});
        vec4 base = texture2DProj( tDiffuse, vUv ) * 0.4;
        base += texture2DProj( tDiffuse, vUv + vec4( _tx.x*vUv.w, 0.0, 0.0, 0.0) ) * 0.15;
        base += texture2DProj( tDiffuse, vUv + vec4(-_tx.x*vUv.w, 0.0, 0.0, 0.0) ) * 0.15;
        base += texture2DProj( tDiffuse, vUv + vec4(0.0,  _tx.y*vUv.w, 0.0, 0.0) ) * 0.15;
        base += texture2DProj( tDiffuse, vUv + vec4(0.0, -_tx.y*vUv.w, 0.0, 0.0) ) * 0.15;`);
    }
  }

  const target = 'blendOverlay( base.rgb, color ), 1.0 )';
  if (m.fragmentShader.includes(target)){
    m.fragmentShader = 'uniform float gAlpha;\n'
      + m.fragmentShader.replace(target, 'blendOverlay( base.rgb, color ), gAlpha )');
    m.uniforms.gAlpha = { value: alpha };
    m.transparent = true; m.depthWrite = false;
  }
  m.needsUpdate = true;
  allReflectors.push(r);
  return r;
}
// Each Reflector re-renders the whole scene from a mirror camera — the dominant
// GPU cost. Three things keep that cheap:
//   1. nesting guard — while one mirror renders, hide the others (no recursion)
//   2. decorative cull — skip noReflect objects (bubbles/hills/flare) in mirrors
//   3. throttle — only refresh each mirror every `userData.every` frames; the
//      scene moves slowly so a 1–2 frame-old, faint reflection is invisible
function dontNestReflections(){
  for (const r of allReflectors){
    if (r.userData.nestGuarded) continue;   // idempotent: late panes (the end walls) re-run this
    r.userData.nestGuarded = true;
    const orig = r.onBeforeRender;
    r.userData.tick = 0;
    r.userData.every = r.userData.every || 1;
    r.onBeforeRender = function(...args){
      if ((this.userData.tick++ % this.userData.every) !== 0) return;   // reuse last reflection
      const hidden = [];
      for (const o of allReflectors) if (o !== this && o.visible){ o.visible = false; hidden.push(o); }
      for (const o of noReflect)     if (o.visible){ o.visible = false; hidden.push(o); }
      orig.apply(this, args);
      for (const o of hidden) o.visible = true;
    };
  }
}

/* ── the floating glass corridor: floor + side walls + legs over grass ── */
{
  const REFL_FLOOR = lowPerf ? 512 : 1024;
  const REFL_WALL  = 512;                    // real planar wall reflections on every device

  // grassy ground far below, stretching to the hilly horizon. A single painted
  // radial gradient (vibrant under the platform → hazier at the rim) plus soft
  // mottling patches — reads as a lit "Bliss" field instead of one flat green.
  const grassTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(512, 512, 40, 512, 512, 730);
    g.addColorStop(0,   '#7ed155');
    g.addColorStop(0.5, '#69bf45');
    g.addColorStop(1,   '#57a83a');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 900; i++){                       // organic light/dark patches
      const r = 6 + Math.random() * 26;
      x.fillStyle = Math.random() < 0.5 ? 'rgba(46,110,30,0.05)' : 'rgba(190,240,150,0.05)';
      x.beginPath(); x.arc(Math.random()*1024, Math.random()*1024, r, 0, 7); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness:1 })
  );
  grass.rotation.x = -Math.PI/2;
  grass.position.set(0, GROUND_Y, DESK_CZ);
  grass.receiveShadow = true;
  scene.add(grass);

  // glass slab body — plain transparent clearcoat instead of `transmission`, which
  // would force a whole extra refraction render pass for a slab that's mostly hidden
  // under the reflective floor anyway
  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(DESK_W, 0.7, DESK_D, 5, 0.22),
    new THREE.MeshPhysicalMaterial({
      // frosted, NOT mirror-smooth: the slab top shows through the 52%-alpha
      // floor Reflector above it, and any tight specular here paints a second
      // "stagelight" sun next to the mirror's real one — the analytic sun glint
      // and the env-map sun sit at the true mirror direction, while the
      // Reflector's sun (a reflection of the finite sky dome) lands slightly
      // off it. Rough gloss keeps the blue tint + soft sky sheen, no hot blob.
      color:0xbfe6ff, roughness:0.45, metalness:0,
      clearcoat:1, clearcoatRoughness:0.55,
      transparent:true, opacity:0.3, envMapIntensity:0.8,
      // soap-film shimmer along the slab edge as you walk past (desktop only)
      iridescence: lowPerf ? 0 : 0.35, iridescenceIOR: 1.3,
    })
  );
  slab.position.set(0, -0.35, DESK_CZ);
  scene.add(slab);

  // reflective-but-clear glass walking surface (refresh every frame on desktop,
  // every other frame on mobile — it's underfoot and most scrutinised)
  const floor = glassReflector(new THREE.PlaneGeometry(DESK_W-0.8, DESK_D-0.8),
    { tex:REFL_FLOOR, color:0x9fc0dd, alpha:0.52 });
  floor.rotation.x = -Math.PI/2;
  floor.position.set(0, 0.004, DESK_CZ);
  floor.userData.every = lowPerf ? 2 : 1;
  floor.renderOrder = 1;        // stable transparent order: floor < walls < panels < labels
  scene.add(floor);

  // glass side walls — same reflective look as the floor, carried up the sides.
  // Rail corner math: a back rail arrives with the west pane (the console's
  // wall — console on, west toggle, or the odd wildcard; see buildConsole)
  // and a front rail with the east pane. The side rails run between them,
  // overshooting each end rail's hall-side face by the shared corner radius
  // so their rounded tips hide INSIDE the end rail's volume — the joint
  // meets at a full square cross-section: a perfectly welded corner, no
  // overhang, no notch. With no end rail on a side they instead stop flush
  // with where that pane's edge would sit — an open end.
  const RAIL_BACK  = WEST_ON ? PLAT_Z1 - 0.46 + RAIL_R    // tucked into the back rail
                             : PLAT_Z1 - 0.4;             // open far end → flush with the pane edge
  const RAIL_FRONT = EAST_ON ? PLAT_Z0 + 0.46 - RAIL_R    // tucked into the front rail
                             : PLAT_Z0 + 0.4;             // open entrance → flush with the pane edge
  const RAIL_L  = RAIL_BACK - RAIL_FRONT;
  const RAIL_CZ = (RAIL_BACK + RAIL_FRONT) / 2;
  function buildWall(side){
    const x = side * WALL_X;
    // real planar reflection on EVERY device, so the gallery reflects across the
    // hall on mobile too. (The old mobile path used envmap-only glass, which just
    // smeared a faint copy of the panel behind it — read as a shadow, not a mirror.)
    const w = glassReflector(new THREE.PlaneGeometry(DESK_D-0.8, WALL_H),
      { tex:REFL_WALL, color:0xa9cde6, alpha:0.40 });
    w.rotation.y = side < 0 ? Math.PI/2 : -Math.PI/2;
    w.position.set(x, WALL_H/2, DESK_CZ);
    w.userData.every = lowPerf ? 3 : 2;        // walls refresh less often than the floor
    w.renderOrder = 2;                          // drawn after the floor reflection (no flip-flicker)
    scene.add(w);

    // crisp glossy top rail so the glass wall reads as a solid pane edge
    const rail = new THREE.Mesh(
      new RoundedBoxGeometry(0.12, 0.12, RAIL_L, 3, RAIL_R), RAIL_MAT);
    rail.position.set(x, WALL_H, RAIL_CZ);
    scene.add(rail);
  }
  buildWall(-1); buildWall(1);

  // the front (east) glass wall — arrives with the east toggle (or the odd
  // wildcard), world or no world: the same live-reflection pane as the
  // sides, plus the capping rail the side rails weld into. Toggle off and
  // no wildcard → the entrance stays open, exactly as before.
  if (EAST_ON){
    const fwall = glassReflector(new THREE.PlaneGeometry(WALL_X * 2, WALL_H),
      { tex:REFL_WALL, color:0xa9cde6, alpha:0.40 });
    fwall.position.set(0, WALL_H/2, PLAT_Z0 + 0.4);       // pane's face looks +z, into the hall
    fwall.userData.every = lowPerf ? 3 : 2;
    fwall.renderOrder = 2;
    scene.add(fwall);
    const frontRail = new THREE.Mesh(
      new RoundedBoxGeometry(WALL_X * 2 + 0.12, 0.12, 0.12, 3, RAIL_R), RAIL_MAT);
    frontRail.position.set(0, WALL_H, PLAT_Z0 + 0.4);
    scene.add(frontRail);
  }
  dontNestReflections();

  // glass legs dropping the platform down to the grass.
  // NOTE: kept OPAQUE on purpose — a transparent leg gets dropped by the glass
  // floor's transmission pass and flips in/out with the painter's-algorithm sort,
  // so it vanished from some angles. Opaque (frosted) renders in the solid pass
  // and stays put while still reading as glassy via clearcoat + env reflections.
  const legMat = new THREE.MeshPhysicalMaterial({
    color:0xcdeeff, roughness:0.18, metalness:0,
    clearcoat:1, clearcoatRoughness:0.12, envMapIntensity:1.3,
  });
  const legH = (-0.7) - GROUND_Y;
  const lx = DESK_W/2 - 1.6, lz = DESK_D/2 - 1.6;
  [[-lx,-lz],[lx,-lz],[-lx,lz],[lx,lz]].forEach(([px,pz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, legH, 20), legMat);
    leg.position.set(px, -0.7 - legH/2, DESK_CZ + pz);
    scene.add(leg);
  });
}

/* ════════════════════════════════════════════════════════════════
   4 · drifting bubbles (cheap camera-facing sprites)
   ════════════════════════════════════════════════════════════════ */
// ONE shared bubble texture, repaintable: the membrane + rim stay put while the
// specular hot-spot (hx,hy) is moved each frame to the side facing the sun, so every
// bubble's shine tracks the glare as the camera turns (see updateBubbleShine).
const bubbleCanvas = document.createElement('canvas'); bubbleCanvas.width = bubbleCanvas.height = 128;
const bubbleCtx = bubbleCanvas.getContext('2d');
function drawBubble(hx, hy){
  const x = bubbleCtx; x.clearRect(0,0,128,128);
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0,   'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(180,230,255,0.05)');
  g.addColorStop(0.92,'rgba(140,210,255,0.5)');
  g.addColorStop(1,   'rgba(120,200,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(64,64,62,0,7); x.fill();
  // iridescent film: a faint rainbow ring just inside the rim (real soap bubbles
  // shimmer through hues at the membrane edge) — conic gradient where supported
  if (x.createConicGradient){
    const cg = x.createConicGradient(0.9, 64, 64);
    const hues = [[0,'rgba(255,120,170,.30)'],[0.2,'rgba(255,220,120,.26)'],[0.4,'rgba(140,255,170,.26)'],
                  [0.6,'rgba(120,210,255,.30)'],[0.8,'rgba(190,140,255,.26)'],[1,'rgba(255,120,170,.30)']];
    for (const [o, col] of hues) cg.addColorStop(o, col);
    x.strokeStyle = cg; x.lineWidth = 5;
    x.beginPath(); x.arc(64,64,57,0,7); x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2;
  x.beginPath(); x.arc(64,64,58,0,7); x.stroke();
  const h = x.createRadialGradient(hx,hy,0,hx,hy,16);
  h.addColorStop(0,'rgba(255,255,255,.95)'); h.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = h; x.beginPath(); x.arc(hx,hy,16,0,7); x.fill();
}
const bubbleTex = (() => { drawBubble(46,42); const t = new THREE.CanvasTexture(bubbleCanvas); t.colorSpace = THREE.SRGBColorSpace; return t; })();
// CONFIG.bubbles knobs: count (0 disables; phones run ~2/3 of it) and
// size/speed multipliers on the stock feel — see config.js
const BUB = { count: 44, size: 1, speed: 1, ...(CONFIG.bubbles || {}) };
function spawnBubble(){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:bubbleTex, transparent:true, depthWrite:false }));
  resetBubble(s, true);
  s.userData.speed = (0.3 + Math.random()*0.7) * BUB.speed;
  s.userData.sway  = Math.random()*Math.PI*2;
  s.userData.popT  = 0;            // >0 while a cursor-pop splash is playing
  scene.add(s); bubbles.push(s); noReflect.push(s);   // main view only, not the mirrors
}
for (let i = 0, n = Math.max(0, Math.round(BUB.count * (lowPerf ? 28/44 : 1))); i < n; i++) spawnBubble();
// Console live-preview: re-seed the swarm to the current BUB knobs. Removing
// pops sprites off both lists (scene + noReflect) so the mirror cull stays true.
function reseedBubbles(){
  const want = Math.max(0, Math.round(BUB.count * (lowPerf ? 28/44 : 1)));
  while (bubbles.length > want){
    const b = bubbles.pop();
    scene.remove(b); b.material.dispose();
    const ni = noReflect.indexOf(b); if (ni >= 0) noReflect.splice(ni, 1);
  }
  while (bubbles.length < want) spawnBubble();
  for (const b of bubbles){
    resetBubble(b, true);
    b.userData.speed = (0.3 + Math.random()*0.7) * BUB.speed;
  }
}
// Repaint the shared bubble's hot-spot toward the sun's screen-direction. The sun is
// directional + far, so its view-space x,y give the same shine offset for every
// bubble — one cheap canvas repaint covers all of them.
const _shine = { x:46, y:42 };
const _sunView = new THREE.Vector3(), _invQ = new THREE.Quaternion();
function updateBubbleShine(){
  _sunView.copy(SUN_DIR).applyQuaternion(_invQ.copy(camera.quaternion).invert());   // sun → view space
  const off = 26;
  const hx = clamp(64 + _sunView.x*off, 16, 112);
  const hy = clamp(64 - _sunView.y*off, 16, 112);   // canvas y is down → flip
  if (Math.abs(hx-_shine.x) < 0.8 && Math.abs(hy-_shine.y) < 0.8) return;            // no visible move → skip
  _shine.x = hx; _shine.y = hy;
  drawBubble(hx, hy); bubbleTex.needsUpdate = true;
}
// scratch vectors for the cursor-pop screen-space test (see animate)
const _camRight = new THREE.Vector3(), _bv = new THREE.Vector3(), _bv2 = new THREE.Vector3();
function resetBubble(s, anywhere){
  const sc = (0.1 + Math.random()*0.4) * BUB.size;
  s.scale.set(sc, sc, 1);
  // the spawn field expands the longer the visitor lingers (full size after 3 min),
  // so bubbles gradually bloom outward across the landscape for people who stay
  const age = galleryStartTime ? clamp((performance.now()/1000 - galleryStartTime)/180, 0, 1) : 0;
  const spreadX = lerp(30, 130, age);
  const spreadZ = lerp(40, 170, age);
  s.position.set((Math.random()-0.5)*spreadX, anywhere ? Math.random()*14 : -0.5, DESK_CZ + (Math.random()-0.5)*spreadZ);
}

/* ════════════════════════════════════════════════════════════════
   4b · sun-lit dust motes — tiny bokeh sparkles drifting up the hall
   ════════════════════════════════════════════════════════════════ */
// One THREE.Points draw call; all motion (rise, sway, twinkle) lives in the
// vertex shader so the CPU never touches the buffer again. The soft round
// falloff + additive blend makes each mote read as an out-of-focus glint —
// the "atmosphere volume" trick real engines lean on.
let moteMat = null;
{
  const N  = lowPerf ? 90 : 220;
  const Y0 = 0.15, Y1 = WALL_H + 1.6, YR = Y1 - Y0;
  const geo  = new THREE.BufferGeometry();
  const pos  = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++){
    pos[i*3]   = (Math.random() * 2 - 1) * (WALL_X - 0.3);
    pos[i*3+1] = Y0 + Math.random() * YR;
    pos[i*3+2] = PLAT_Z0 + Math.random() * (PLAT_Z1 - PLAT_Z0);
    seed[i]    = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(seed, 1));
  moteMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: BASE_PR } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uPR;
      varying float vA;
      void main(){
        vec3 p = position;
        float s = aSeed;
        // slow rise that wraps back to the floor, plus a lazy horizontal sway
        p.y = ${Y0.toFixed(2)} + mod(p.y - ${Y0.toFixed(2)} + uTime * (0.06 + 0.10*s), ${YR.toFixed(2)});
        p.x += sin(uTime*(0.30 + s) + s*31.0) * 0.35;
        p.z += cos(uTime*(0.23 + s*0.5) + s*57.0) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime*(0.7 + s*1.7) + s*43.0);
        vA = (0.16 + 0.84*tw*tw) * clamp(1.0 - (-mv.z) / 46.0, 0.0, 1.0);
        gl_PointSize = min((1.5 + 3.0*s) * uPR * (6.0 / max(1.0, -mv.z)), 18.0 * uPR);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float m = smoothstep(0.5, 0.08, d);
        gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * m * vA, m * vA);
      }`,
  });
  const motes = new THREE.Points(geo, moteMat);
  motes.frustumCulled = false;      // vertex-shader drift breaks the static bounds
  motes.renderOrder = 3;            // after the glass floor/walls, before the labels
  scene.add(motes);
  noReflect.push(motes);            // sparkle in the main view only, not the mirrors
}

/* ════════════════════════════════════════════════════════════════
   5 · build the gallery frames once the 3D font has loaded
   ════════════════════════════════════════════════════════════════ */
const frames = [];
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

/* ── loading-sequence canvas helpers ───────────────────────────────────────
   Two phases per panel:
     1. "pending"  → solid white (no noise, no bar — clean Aero blank)
     2. "loading"  → Aero barber-pole progress bar 0 → 100 %
     3. "done"     → live screenshot snaps in; name plaque bloops up
   ─────────────────────────────────────────────────────────────────────────── */
// The animated cutscene lives on a SMALL strip plane floating over the panel
// (label / barber-pole bar / percentage) — NOT on a full-panel canvas. The
// strip's canvas maps ~1:1 to its on-screen pixels so it's always crisp, and
// each repaint uploads a fixed 1024×256 whatever the panel or device size.
// The panel behind it is a static backdrop texture uploaded once, ever.
const STRIP_W = 1024, STRIP_H = 256;

function makeWhiteCanvas(){
  // solid fill — 2×2 is enough, the GPU stretches a flat colour losslessly
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const ctx = c.getContext('2d');
  // mobile reads each device as a phone: its idle/off screen is black, not white
  ctx.fillStyle = isTouch ? '#000000' : '#ffffff'; ctx.fillRect(0, 0, 2, 2);
  return c;
}

function makeStripCanvas(){
  const c = document.createElement('canvas'); c.width = STRIP_W; c.height = STRIP_H; return c;
}

// Panel backdrop while loading — the old full-canvas background (white on
// desktop / black phone bezel, faint blue Aero glow at the top) baked into one
// tiny texture SHARED by every panel: 4×256, uploaded to the GPU exactly once.
const loadBackdropTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = isTouch ? '#000000' : '#ffffff'; x.fillRect(0, 0, 4, 256);
  const tg = x.createLinearGradient(0, 0, 0, 256 * 0.28);
  tg.addColorStop(0,'rgba(195,238,255,.55)'); tg.addColorStop(1,'rgba(195,238,255,0)');
  x.fillStyle = tg; x.fillRect(0, 0, 4, 256 * 0.28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// Frutiger Aero loading strip: barber-pole green/blue/white bar with the
// status label above and the percentage below, on a TRANSPARENT canvas \u2014 the
// white/black panel background lives in loadBackdropTex behind it. Fixed
// 1024\u00d7256 whatever the panel aspect, so layout metrics are plain pixels.
function drawLoadingStrip(canvas, progress, animTime){
  const c2 = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const dark = isTouch;
  c2.clearRect(0, 0, W, H);
  // Bar geometry \u2014 vertically centred; the label + percentage anchor to it
  const barH = 64, barX = 24, barW = W - barX*2, barY = (H - barH)/2, rr = barH/2;
  // Status label
  c2.fillStyle = dark ? 'rgba(170,215,255,.92)' : 'rgba(50,130,200,.65)';
  c2.font = '500 44px Quicksand, Segoe UI, sans-serif';
  c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillText(progress < 0.995 ? 'loading world\u2026' : 'rendering\u2026', W/2, barY - 42);
  // Track (empty pill)
  c2.fillStyle = 'rgba(150,200,235,.38)'; roundRect(c2,barX,barY,barW,barH,rr); c2.fill();
  // Filled portion — barber-pole: diagonal green / blue / white twist
  if (progress > 0){
    const fillW = Math.max(rr*2, barW*progress);
    c2.save(); roundRect(c2,barX,barY,fillW,barH,Math.min(rr,fillW/2)); c2.clip();
    const sw=barH*1.1, rep=sw*3, off=(animTime*42)%rep;
    const pal=['#33c75a','#1a96ff','#ffffff'];
    for (let sx=-(rep*2)+off; sx<fillW+barH+rep; sx+=sw)
      for (let ci=0; ci<3; ci++){
        c2.fillStyle = pal[ci];
        const ox=barX+sx+ci*sw;
        c2.beginPath();
        c2.moveTo(ox-barH,barY+barH); c2.lineTo(ox,barY);
        c2.lineTo(ox+sw,barY); c2.lineTo(ox+sw-barH,barY+barH);
        c2.closePath(); c2.fill();
      }
    // Aero gloss overlay (top half)
    const gl=c2.createLinearGradient(0,barY,0,barY+barH);
    gl.addColorStop(0,'rgba(255,255,255,.72)'); gl.addColorStop(.44,'rgba(255,255,255,.16)');
    gl.addColorStop(.45,'rgba(255,255,255,0)'); gl.addColorStop(1,'rgba(255,255,255,0)');
    c2.fillStyle=gl; c2.fillRect(barX,barY,fillW,barH); c2.restore();
    c2.strokeStyle='rgba(255,255,255,.82)'; c2.lineWidth=3;
    roundRect(c2,barX,barY,fillW,barH,Math.min(rr,fillW/2)); c2.stroke();
  }
  // Percentage (below bar)
  c2.fillStyle = dark ? 'rgba(180,220,255,.95)' : 'rgba(50,130,200,.75)';
  c2.font='600 36px Quicksand, Segoe UI, sans-serif';
  c2.textBaseline='top';
  c2.fillText(`${Math.min(100,Math.round(progress*100))}%`, W/2, barY+barH+14);
}

// Auto-load delay: pings fire in PAIRS — both sides of a row land together
// (no left/right stagger), the east wall riding with the first pair. The
// clock starts WITH the intro whoosh (not after it), so the front pair is
// already pinging as you glide in, and the row cadence keeps each pair
// landing before the player walks up to it.
function autoDelayForRow(row){
  const walkTime = (START_Z + row * DZ) / (CONFIG.movement.maxSpeed * (CONFIG.movement.speed ?? 1));
  return Math.max(0, walkTime - 1.5) + row * 0.3;
}

// Planar UVs from each vertex's local x,y so the full screenshot maps 1:1 across the
// front face — and the curved rim's vertices clamp to the nearest edge column, so the
// page appears to roll over the device's rounded bezel (a hi-tech screen). RoundedBox
// UVs are raw coordinates, not normalised; this fixes that.
function planarUV(geo, w, h){
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++){
    uv.setXY(i, clamp(pos.getX(i) / w + 0.5, 0, 1), clamp(pos.getY(i) / h + 0.5, 0, 1));
  }
  uv.needsUpdate = true;
}

// Fit the capture onto the device panel.
//  • Desktop: stretch the WHOLE page across the slab (full content, no crop).
//  • Mobile: COVER-fit one phone screenful as if you were on the site — fill the
//    portrait slab at the capture's true proportions, anchored to the TOP and centred
//    horizontally, cropping the overflow. This is robust to a provider returning a
//    full-page (very tall) or off-aspect image: instead of squishing the whole page
//    into the slab (which reads as a cut-off corner), it shows the top screenful at
//    the right aspect. Needs the texture's real pixel size, so it reads tex.image.
function fitPanelToImage(u, tex){
  if (!isTouch){ tex.repeat.set(1, 1); tex.offset.set(0, 0); tex.needsUpdate = true; return; }
  const im = tex.image;
  const iw = im?.naturalWidth || im?.width, ih = im?.naturalHeight || im?.height;
  if (!iw || !ih){ tex.repeat.set(1, 1); tex.offset.set(0, 0); tex.needsUpdate = true; return; }
  const ia = iw / ih, pa = FW / FH;
  if (ia >= pa){                       // capture wider than the slab → crop sides, keep centred
    const r = pa / ia;
    tex.repeat.set(r, 1); tex.offset.set((1 - r) / 2, 0);
  } else {                             // capture taller than the slab → crop the bottom, keep the TOP
    const r = ia / pa;                 // (flipY: the page's top sits at v=1, so offset up to it)
    tex.repeat.set(1, r); tex.offset.set(0, 1 - r);
  }
  tex.needsUpdate = true;
}

// name plaque texture — painted to MATCH the .aero-btn enter pill (deep aqua
// gradient + baked top gloss + white inner ring). 2× resolution + mipmaps +
// anisotropy keep it crisp when viewed far down the corridor / at a grazing angle.
function labelTexture(text){
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  const w = c.width, h = c.height, pad = 18;
  const bx = pad, by = pad, bw = w - 2*pad, bh = h - 2*pad, r = bh/2;   // full pill
  // deep aqua gradient (same stops as the Enter button)
  const g = x.createLinearGradient(0, by, 0, by+bh);
  g.addColorStop(0,'#9fdcff'); g.addColorStop(.42,'#4fb6ff');
  g.addColorStop(.66,'#2aa9ff'); g.addColorStop(1,'#0a64c8');
  x.fillStyle = g; roundRect(x, bx, by, bw, bh, r); x.fill();
  // baked top gloss (clipped to the pill, kept in the fill so the label stays crisp)
  x.save(); roundRect(x, bx, by, bw, bh, r); x.clip();
  const gl = x.createLinearGradient(0, by, 0, by + bh*0.54);
  gl.addColorStop(0,'rgba(255,255,255,.72)'); gl.addColorStop(.7,'rgba(255,255,255,.14)'); gl.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = gl; x.fillRect(bx, by, bw, bh*0.54); x.restore();
  // white inner ring
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3;
  roundRect(x, bx+1.5, by+1.5, bw-3, bh-3, r-1.5); x.stroke();
  // label
  x.fillStyle = '#fff';
  x.font = '600 104px Quicksand, Segoe UI, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(4,46,104,.5)'; x.shadowBlur = 5; x.shadowOffsetY = 3;
  x.fillText(text, w/2, h/2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();   // stays sharp at distance/angle
  t.needsUpdate = true;
  return t;
}
// flat 2D name plaque that floats off the wall in front of its device (shares the
// frame's facing rather than billboarding). The pill texture has transparent margins
// that read cleanly on a flat plane — wrapped over a 3D slab's rounded rim they looked
// muddy, so this stays a simple PlaneGeometry.
// base colour multiplier for the plaques: under the composer they get ACES like
// everything else, so lift them the same way as the screens (see buildGallery)
const LABEL_LIFT = 1.15;
function labelPanel(text){
  const m = new THREE.MeshBasicMaterial({ map:labelTexture(text), transparent:true, depthWrite:false, toneMapped:false, opacity:0 });
  if (FX) m.color.setScalar(LABEL_LIFT);
  return new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), m);
}
function roundRect(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r);
  x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }

function buildGallery(font){
  // one shared rounded-slab geometry for every device — a chunky rounded box whose
  // front face + curved edges are skinned by the screenshot (planarUV), so the page
  // gently wraps the bezel like a hi-tech screen. All panels share this geometry at a
  // uniform device aspect; the screenshot is cover-fit onto it (fitPanelToImage).
  // Phones are slimmer than desktop monitors: a thinner slab + tighter rim radius so
  // mobile reads as a modern phone, while the screenshot still skins the front AND
  // wraps the curved edge (planarUV) exactly like desktop — no separate bezel.
  const DEV_DEPTH  = isTouch ? 0.121  : 0.242;   // +10% with the faces (FH/FW) — true uniform scale
  const DEV_RADIUS = isTouch ? 0.0385 : 0.121;
  const DEV_Z = 0.06;                              // lifts the slab off the glass wall
  const deviceGeo = new RoundedBoxGeometry(FW, FH, DEV_DEPTH, 6, DEV_RADIUS);
  planarUV(deviceGeo, FW, FH);

  // loading-strip plane shared by every panel: ~80% of the panel's width (a
  // touch narrower on phones so the cluster sits daintily on the tall bezel),
  // floated just off the slab's front face. Geometry is shared; each loading
  // panel gets its own small canvas texture (see startFrameLoading).
  const stripW = FW * (isTouch ? 0.72 : 0.8);
  stripGeo = new THREE.PlaneGeometry(stripW, stripW * (STRIP_H / STRIP_W));
  stripZ   = DEV_Z + DEV_DEPTH / 2 + 0.012;

  // Lit "visit?" — the beveled 3D look is back (the unlit detour read as a
  // flat sticker). The glare hunt in short: clearcoat spikes → removed; matte
  // → the band still snapped; unlit → glint-proof but shapeless. The real
  // culprit was the GEOMETRY all along — flat facet normals quantising the
  // highlight into hard bands — so visitGeo now ships crease-smoothed normals
  // (see its builder) and the sweep glides instead of cutting. The flat front
  // face still catches broad light head-on; that's a face being a face, and
  // it reads natural. Matte-standard values otherwise, same as before.
  const visitMat = new THREE.MeshStandardMaterial({
    color:0xffffff, roughness:0.85, metalness:0,
    emissive:0x2aa9ff, emissiveIntensity:0.22, envMapIntensity:0.3,
  });

  // "visit?" geometry — built glyph-by-glyph instead of one TextGeometry call.
  // The bevel fattens every outline by ~0.022 a side, which fused the i and ?
  // dots onto their glyphs and closed up the gaps between letters. Per-glyph we
  // can restore a touch of tracking and float the dots clear of their stems.
  // Built ONCE and shared by every frame's mesh (it was 12 identical builds).
  const visitGeo = (() => {
    const SIZE = 0.46, TRACK = 0.055, DOT_GAP = 0.075;
    const opts = { depth:0.13, curveSegments:6,
      bevelEnabled:true, bevelThickness:0.03, bevelSize:0.022, bevelSegments:3 };
    const parts = [];
    let pen = 0;
    for (const ch of 'visit?'){
      const shapes = font.generateShapes(ch, SIZE);
      // the dot is the only disconnected outline in this string: the TOP shape
      // of the i, the BOTTOM one of the ? — lift it away so it floats free
      let dotIdx = -1;
      if (shapes.length > 1){
        const mids = shapes.map(sh => {
          const b = new THREE.Box2().setFromPoints(sh.getPoints(6));
          return (b.min.y + b.max.y) / 2;
        });
        dotIdx = mids.indexOf(ch === 'i' ? Math.max(...mids) : Math.min(...mids));
      }
      shapes.forEach((sh, k) => {
        const g = new THREE.ExtrudeGeometry(sh, opts);
        g.translate(pen, k === dotIdx ? (ch === 'i' ? DOT_GAP : -DOT_GAP) : 0, 0);
        parts.push(g);
      });
      pen += font.data.glyphs[ch].ha * (SIZE / font.data.resolution) + TRACK;
    }
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    g.translate(-(bb.min.x + bb.max.x)/2, -(bb.min.y + bb.max.y)/2, 0);
    // soften the glare sweep: extrusion leaves the 3-segment bevel with flat
    // per-facet normals, so a highlight used to cut across it facet by facet
    // in hard bands. Crease-smoothing welds the normals over every seam
    // shallower than 60° (cap→bevel→wall steps are ~22° apart), so the sun
    // now glides around the profile as on a truly rounded edge, while real
    // corners — glyph outline angles sharper than that — keep their crease.
    const smooth = toCreasedNormals(g, Math.PI / 3);
    g.dispose();
    return smooth;
  })();

  // NOTE: no glass cover sheet over the screens — a near-transparent reflective
  // plane floating off each panel read as a milky rectangle washing out the
  // screenshot. The device slab is bare so every screen stays crisp.

  // one frame group = device slab + name plaque + visit? text — shared by the
  // corridor sides and the end walls; placeFrame positions it and registers it
  function makeFrame(project, loadTrigger, autoDelay, loadDuration){
    const group = new THREE.Group();

    // the screen: a flat rounded-rectangle showing the full screenshot stretched to
    // fill, smooth corners, no dark edge wrap. Per-frame canvas textures — managed
    // by updateLoadingSystem(). Pending = clean white, loading = Aero bar 0→100 %.
    const wc = makeWhiteCanvas();
    const whiteTex = new THREE.CanvasTexture(wc); whiteTex.colorSpace = THREE.SRGBColorSpace;
    // NOTE: the loading strip (canvas + plane) is allocated lazily in
    // startFrameLoading and freed on reveal — only panels actually mid-
    // cutscene hold one, so peak cost is a couple of small canvases

    // the screen material carries the preview (idle tile → loading bar → screenshot);
    // it skins the whole rounded slab, the image wrapping the curved rim (planarUV)
    const screenMat = new THREE.MeshBasicMaterial({ map: whiteTex, toneMapped: false });
    // Under the HDR composer the WHOLE frame goes through ACES (toneMapped:false
    // only skips the direct-to-canvas path), which would grey the screens down.
    // Lifting to ~1.12 tone-maps back to full brightness while staying UNDER the
    // bloom threshold (1.2), so the screens stay crisp — no glow veil.
    if (FX) screenMat.color.setScalar(1.12);
    const panel = new THREE.Mesh(deviceGeo, screenMat);
    panel.position.z = DEV_Z;
    panel.castShadow = true;
    panel.userData.frame = group;   // back-ref for the visit? centre-screen raycast
    group.add(panel);
    // NOTE: no immediate fetch — loading is orchestrated by updateLoadingSystem()

    // name plaque — hidden until world loads, then bloops in
    const label = labelPanel(project.name);
    const labelBaseY = (FH/2 + WALL_H - FRAME_Y) / 2;
    // flush against the glass wall, in the title band above the device (not floating)
    label.position.set(0, labelBaseY, 0.02);
    label.renderOrder = 5;         // always on top of its panel — no sort flicker
    label.scale.setScalar(0.01);   // starts tiny; animates to 1.0 on reveal
    label.userData.frame = group;  // gazing at the name badge above arms the panel too
    group.add(label);

    // 3D "visit?" text — hidden until you approach. Own material clone per
    // frame (same shader program, no extra compiles) so each visit?'s glow
    // can fade in/out independently in the animate loop.
    const visit = new THREE.Mesh(visitGeo, visitMat.clone());
    visit.position.set(0, -0.15, 0.9);
    visit.scale.setScalar(0.001);
    visit.userData.baseY = -0.15;
    group.add(visit);

    group.userData = {
      project, visit, label, labelBaseY, scale:0, worldPos:new THREE.Vector3(),
      // ── loading state ──
      loadState:    'pending',               // 'pending' | 'loading' | 'done'
      loadTrigger, autoDelay, loadDuration,
      loadProgress: 0, imageReady: false, liveTexture: null,
      screenMat, panel, whiteTex, strip: null, stripTex: null, stripCanvas: null,
      labelBloop: -1,
    };
    return group;
  }
  function placeFrame(group, x, z, rotY){
    group.position.set(x, FRAME_Y, z);
    group.rotation.y = rotY;
    group.getWorldPosition(group.userData.worldPos);
    scene.add(group);
    frames.push(group);
  }

  sideProjects.forEach((project, i) => {
    // Orientation breadcrumb (layout is correct as-is — this only documents it):
    // even i → side -1 → x = -FRAME_X; odd i → side +1 → x = +FRAME_X. You spawn
    // facing +z, and for a +z-facing viewer "right" is -x (right = forward × up =
    // +z × +y = -x). So EVEN indices (0,2,4,…) sit on your RIGHT wall at spawn and
    // ODD indices on your LEFT. (The plaque side-notes in config.js follow this.)
    const side        = (i % 2 === 0) ? -1 : 1;      // -1 = player's RIGHT wall, +1 = LEFT
    const row         = Math.floor(i / 2);
    const isGazeFrame = row >= GAZE_ROW_START;  // last N rows are gaze-only
    const f = makeFrame(project,
      isGazeFrame ? 'gaze'      : 'auto',
      isGazeFrame ? Infinity    : autoDelayForRow(row),
      isGazeFrame ? GAZE_LOAD_DUR : LOAD_DUR);
    // pressed to the glass wall, facing the walkway
    placeFrame(f, side * FRAME_X, START_Z + row * DZ, side < 0 ? Math.PI/2 : -Math.PI/2);
  });

  // end-wall worlds (see planWalls): the EAST panel (000 — the slot's own
  // string, or the odd 0000 wildcard) hangs centred on the entrance wall
  // facing into the hall and loads on the front row's beat — it lands with
  // world 0. The WEST panel (00, console-off halls only) hangs on the far
  // wall and reveals by gaze, like the hall's last row. Both sit 0.12 off
  // their pane, the same standoff as the side frames. A toggled-on wall
  // with an empty slot hangs nothing — the pane stands bare.
  if (wallProjects.east)
    placeFrame(makeFrame(wallProjects.east, 'auto', autoDelayForRow(0), LOAD_DUR),
               0, PLAT_Z0 + 0.4 + 0.12, 0);
  if (wallProjects.west)
    placeFrame(makeFrame(wallProjects.west, 'gaze', Infinity, GAZE_LOAD_DUR),
               0, PLAT_Z1 - 0.4 - 0.12, Math.PI);
}

/* ════════════════════════════════════════════════════════════════
   5c · the back-wall console — an in-world Frutiger Aero config
        builder on an XXL rounded canvas slab. Visitors design their
        own gallery live (identity, worlds, atmosphere), then the
        publish tab walks the whole sign-up pipeline: fork the
        template repo (optionally under a custom name), commit their
        design into the fork, deploy on Cloudflare Pages. Aim with
        your view — the cursor rides the slab — click / E to press,
        type to fill fields.
   ════════════════════════════════════════════════════════════════ */
const CON = { W: lowPerf ? 1536 : 2048, H: lowPerf ? 864 : 1152 };   // 16:9 canvas
const CON_CW = 9.24, CON_CH = CON_CW * (CON.H / CON.W);  // slab size in world units (+10%)
const CON_PX = CON_CW / 2048;                            // one layout px on the slab
let consoleMesh = null, consoleTex = null, consoleCtx = null, consoleGroup = null;
let conDesk = false;   // ?console desk overlay: the OS pointer owns cursor + hover, not the raycast
let conCursor = null;                                    // the aero pointer: its own tiny quad
// boot cutscene: the console loads WITH the hall — blank glass until slab 0
// starts its bar, then the same 1.8 s beat before the UI pops in
const CON_BOOT_MS = LOAD_DUR * 1000;
const conBoot = { s: 'pending', t0: 0 };                 // 'pending' | 'loading' | 'done'

// ── the draft: the visitor's design-in-progress. Seeds from the live CONFIG,
// survives the OAuth round-trip (and reloads) via localStorage.
const DRAFT_KEY = 'gallery-console-draft';
function seedDraft(){
  return {
    creator: CONFIG.creator, title: CONFIG.title, tabTitle: CONFIG.tabTitle ?? '',
    subtitle: CONFIG.subtitle, loadingNote: CONFIG.loadingNote, readyNote: CONFIG.readyNote,
    pause: { ...(CONFIG.pause || { title:'Paused', note:'Take a breath.', resume:'Resume' }) },
    bubbles: { ...(CONFIG.bubbles || { count:44, size:1, speed:1 }) },
    clouds:  { ...(CONFIG.clouds  || { cover:1, cirrus:0.35 }) },
    volume: CONFIG.volume ?? 0.6,
    moveSpeed: CONFIG.movement?.speed ?? 1,
    shuffleOrder: CONFIG.shuffleOrder !== false,
    openInNewTab: !!CONFIG.openInNewTab,
    projects: CONFIG.projects.map(p => ({ name: p.name, url: p.url })),
    // end-wall slots: independent { on, name, url } strings — west = the far
    // wall (00, hangs only while the console is off), east = the sun-lit
    // entrance wall (000) — see planWalls
    walls: normWalls(CONFIG.walls),
    // always seeds OFF regardless of this deployment: the console is scaffolding —
    // a committed design hides it on the fork unless the owner opts back in
    consoleOn: false,
    repoName: (CONFIG.console?.sourceRepo || 'you/frutiger-gallery').split('/')[1],
  };
}
let draft = seedDraft(), draftEdited = false;
// the pristine boot seed, frozen BEFORE any saved draft pours over it and
// before applyDraftLive ever mutates CONFIG — the reset swirl restores
// exactly these values, this deployment's true shipped config
const SEED0 = JSON.stringify(draft);
try {
  const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  if (saved && typeof saved === 'object'){ draft = { ...draft, ...saved }; draftEdited = true; }
} catch { /* corrupt draft → fresh seed */ }
draft.walls = normWalls(draft.walls);   // heal pre-walls / legacy-boolean drafts
let _saveT = null;
function saveDraft(){
  draftEdited = true;
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {} }, 250);
}

// ── the reset swirl's teeth: pour the deployment's own pristine config back
// into the console and burn the saved draft — the manual fix for a stale
// localStorage design that outlived the session it belonged to
function resetDraft(){
  clearTimeout(_saveT);                                  // a pending save must not resurrect the old draft
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
  draft = JSON.parse(SEED0);
  draft.walls = normWalls(draft.walls);
  draftEdited = false;
  ui.focus = null; ui.page = 0;
  applyDraftLive();                                      // the live world sheds the old design too
  draftEdited = false;                                   // wearing the seed is not an edit
  ui.dirty = true;
}

// what the visitor designed, as the file their fork will serve (see the
// commit endpoint / the copy buttons — same shape as owner.config.json)
function buildOwnerJson(){
  const d = draft;
  return {
    creator: d.creator, title: d.title, tabTitle: d.tabTitle,
    subtitle: d.subtitle, loadingNote: d.loadingNote, readyNote: d.readyNote,
    pause: { ...d.pause },
    bubbles: { count: Math.round(d.bubbles.count), size: +d.bubbles.size.toFixed(2), speed: +d.bubbles.speed.toFixed(2) },
    clouds:  { cover: +d.clouds.cover.toFixed(2), cirrus: +d.clouds.cirrus.toFixed(2) },
    volume: +d.volume.toFixed(2),
    movement: { speed: +d.moveSpeed.toFixed(2) },   // deep-merges over CONFIG.movement — accel/friction survive
    shuffleOrder: d.shuffleOrder, openInNewTab: d.openInNewTab,
    console: { enabled: !!d.consoleOn },   // deep-merges over CONFIG.console — sourceRepo survives
    // wall slots persist their strings even while toggled off — that's the point
    walls: {
      west: { on: !!d.walls.west.on, name: d.walls.west.name.trim(), url: d.walls.west.url.trim() },
      east: { on: !!d.walls.east.on, name: d.walls.east.name.trim(), url: d.walls.east.url.trim() },
    },
    projects: d.projects.filter(p => p.url.trim()).map(p => ({ name: p.name.trim() || 'World', url: p.url.trim() })),
  };
}

// live preview: pour the draft over the running world wherever that's cheap.
// (clouds are baked into the sky shader at build; projects rebuild the hall —
// both apply on the deployed fork instead, and the console says so.)
function applyDraftLive(){
  CONFIG.creator = draft.creator; CONFIG.title = draft.title; CONFIG.tabTitle = draft.tabTitle;
  CONFIG.subtitle = draft.subtitle; CONFIG.loadingNote = draft.loadingNote; CONFIG.readyNote = draft.readyNote;
  CONFIG.pause = { ...draft.pause }; CONFIG.volume = draft.volume;
  CONFIG.movement.speed = draft.moveSpeed;   // M aliases this object — the walk retunes mid-stride
  setLine('title', draft.title);
  setLine('subtitle', draft.subtitle);
  setLine('pauseTitle', draft.pause.title);
  setLine('pauseNote',  draft.pause.note);
  $('resumeBtn').textContent = draft.pause.resume || 'Resume';
  $('enterBtn').textContent = draft.creator;
  if (draft.tabTitle) document.title = draft.tabTitle;
  audio.setVolume(draft.volume);
  if (BUB.count !== draft.bubbles.count || BUB.size !== draft.bubbles.size || BUB.speed !== draft.bubbles.speed){
    BUB.count = draft.bubbles.count; BUB.size = draft.bubbles.size; BUB.speed = draft.bubbles.speed;
    reseedBubbles();
  }
}

// ── console UI state ──
const ui = {
  tab: 'identity',                 // 'identity' | 'worlds' | 'vibe' | 'publish'
  widgets: [],                     // rebuilt every paint: {id,x,y,w,h,label,act,get,set,...}
  hover: null, focus: null,
  // text editing on the lit field: caret index, selection anchor/end (equal =
  // no selection) and the first visible char of the field's scroll window
  caret: 0, selA: 0, selB: 0, fieldOff: 0,
  cursor: { x: -1, y: -1, on: false },
  page: 0,                         // worlds-list pager
  dirty: true, lastPaint: 0,
  note: null, noteT: 0,            // transient toast ("copied ✓")
  resetT: 0,                       // when the reset swirl was last clicked (drives its spring-spin)
  resetHov: false, resetHovT: 0,   // hover edge + when it flipped (drives the eased cock-back)
  animUntil: 0,                    // keep repainting until this clock time — ui.dirty can't carry
                                   // an animation because drawConsole clears it after every paint
  gh: { mode: 'unknown', login: null, forkRepo: null, forkUrl: null, busy: null,
        doneFork: false, doneConfig: false, err: null },
};
function toast(msg){ ui.note = msg; ui.noteT = performance.now(); ui.dirty = true; }

// ── geometry: glass backwall pane + rail + the XXL console slab ──
// The pane + rail build with WEST_ON (the console needs its backwall, the
// west toggle asks for it, or the odd wildcard forces it) — with all three
// off the far end stays open. CON_ENABLED gates the console app on top.
function buildConsole(){
  if (!WEST_ON) return;                                 // open far end — no pane, no app
  consoleGroup = new THREE.Group();
  // sits exactly where the side panes end (PLAT_Z1 - 0.4), so the back pane's
  // edges land ON the side panes at x = ±WALL_X — a clean glass corner
  consoleGroup.position.set(0, 0, PLAT_Z1 - 0.4);
  consoleGroup.rotation.y = Math.PI;                    // face back down the hall

  // the glass backwall: closes the far end of the corridor like the side panes,
  // spanning exactly between them — the SAME live-reflection glass as the
  // sides (a physical-material pane here read frosted next to real mirrors)
  const backGlass = glassReflector(new THREE.PlaneGeometry(WALL_X * 2, WALL_H),
    { tex:512, color:0xa9cde6, alpha:0.40 });
  backGlass.position.set(0, WALL_H/2, 0);
  backGlass.userData.every = lowPerf ? 3 : 2;   // same refresh cadence as the side panes
  backGlass.renderOrder = 2;
  consoleGroup.add(backGlass);
  // back rail caps across the corner: its ends sit flush with the side rails'
  // outer faces, and the side rails tuck their rounded tips inside its
  // hall-side face (see RAIL_BACK) — the corner welds at full cross-section
  const backRail = new THREE.Mesh(
    new RoundedBoxGeometry(WALL_X * 2 + 0.12, 0.12, 0.12, 3, RAIL_R), RAIL_MAT);
  backRail.position.set(0, WALL_H, 0);
  consoleGroup.add(backRail);
  dontNestReflections();                        // wire the new pane into the mirror nesting guard

  if (!CON_ENABLED){ scene.add(consoleGroup); return; }   // glass wall only, no app

  // the world-rounded-canvas XXL slab the console UI is skinned onto
  const CW = CON_CW, CH = CON_CH;
  const slabGeo = new RoundedBoxGeometry(CW, CH, 0.286, 6, 0.132);   // +10% with the face
  planarUV(slabGeo, CW, CH);
  const cnv = document.createElement('canvas'); cnv.width = CON.W; cnv.height = CON.H;
  consoleCtx = cnv.getContext('2d', { alpha: false });  // opaque face → cheaper GPU uploads
  consoleTex = new THREE.CanvasTexture(cnv);
  consoleTex.colorSpace = THREE.SRGBColorSpace;
  consoleTex.generateMipmaps = false;                   // repainted on interaction
  consoleTex.minFilter = THREE.LinearFilter;
  consoleTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());  // 16× is unpayable for a screen-filling slab
  const slabMat = new THREE.MeshBasicMaterial({ map: consoleTex, toneMapped: false });
  if (FX) slabMat.color.setScalar(1.12);                // same ACES lift as the screens
  consoleMesh = new THREE.Mesh(slabGeo, slabMat);
  // the pane's reveal splits 60/40 around the slab — the largest padding sits
  // UNDER it, the same rule the device slabs follow on the raised eye line
  consoleMesh.position.set(0, (WALL_H - CON_CH) * 0.6 + CON_CH / 2, 0.3);
  consoleMesh.castShadow = true;
  consoleGroup.add(consoleMesh);

  // the aero pointer rides the slab as its own tiny quad: moving it per frame
  // costs nothing, so the big UI canvas repaints only when the UI itself changes
  // (before, every cursor twitch re-uploaded the whole 2048px texture at 30fps)
  const pc = document.createElement('canvas'); pc.width = 132; pc.height = 164;   // 66×82 layout px @2x
  const pcc = pc.getContext('2d');
  pcc.scale(2, 2); pcc.translate(16, 16);               // pad for the drop shadow, tip at (16,16)
  pcc.shadowColor = 'rgba(10,60,120,.4)'; pcc.shadowBlur = 14; pcc.shadowOffsetY = 4;
  pcc.beginPath();                                      // classic pointer, aero-glossed
  pcc.moveTo(0, 0); pcc.lineTo(0, 44); pcc.lineTo(11, 33); pcc.lineTo(19, 50);
  pcc.lineTo(27, 46); pcc.lineTo(19, 30); pcc.lineTo(34, 30); pcc.closePath();
  const pg = pcc.createLinearGradient(0, 0, 0, 50);
  pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#bfe2ff');
  pcc.fillStyle = pg; pcc.fill();
  pcc.shadowColor = 'transparent';
  pcc.strokeStyle = AERO.deep; pcc.lineWidth = 3; pcc.stroke();
  const pTex = new THREE.CanvasTexture(pc); pTex.colorSpace = THREE.SRGBColorSpace;
  const pMat = new THREE.MeshBasicMaterial({ map: pTex, transparent: true, toneMapped: false, depthWrite: false });
  if (FX) pMat.color.setScalar(1.12);
  conCursor = new THREE.Mesh(new THREE.PlaneGeometry(66 * CON_PX, 82 * CON_PX), pMat);
  conCursor.visible = false;
  conCursor.renderOrder = 2;                            // always over the slab face
  consoleMesh.add(conCursor);

  scene.add(consoleGroup);

  if (draftEdited) applyDraftLive();                    // returning mid-design → wear it
  refreshGhState();
  drawConsole();
  document.fonts?.ready?.then(() => { ui.dirty = true; });   // repaint once Quicksand lands

  // ── ?console debug/desk mode: the live canvas as a DOM overlay with direct
  // mouse interaction — used for development and as an escape hatch anywhere
  // pointer lock is unavailable. Same widgets, same actions.
  if (new URLSearchParams(location.search).has('console')){
    conDesk = true;                                       // hover/cursor now belong to the OS pointer
    conBoot.s = 'done';                                   // desk mode skips the cutscene
    drawConsole();                                        // repaint NOW — widgets exist pre-click
    Object.assign(cnv.style, {
      position:'fixed', inset:'auto 2vw 2vh 2vw', width:'96vw', zIndex: 200,
      borderRadius:'18px', boxShadow:'0 30px 80px rgba(10,60,120,.45)',
    });
    document.body.appendChild(cnv);
    const toCanvas = (e) => {
      const r = cnv.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * CON.W, y: (e.clientY - r.top) / r.height * CON.H };
    };
    cnv.addEventListener('mousemove', e => {
      const p = toCanvas(e), S = CON.W / 2048;
      ui.cursor = { x: p.x, y: p.y, on: true };            // the OS pointer is the cursor here
      const h = widgetAt(p.x / S, p.y / S);
      if (h?.id !== ui.hover?.id){ ui.hover = h; ui.dirty = true; drawConsole(); }
      if (conSel.drag){ consoleSelDrag(); if (ui.dirty) drawConsole(); }   // desk-mode drag-select
      if (conSlide.drag){ consoleSlideDrag(); if (ui.dirty) drawConsole(); }  // desk-mode slider drag
    });
    cnv.addEventListener('mousedown', e => { const p = toCanvas(e); ui.cursor = { x:p.x, y:p.y, on:true }; held.mouse = true; consoleSelStart(); consoleSlideStart(); drawConsole(); });
    cnv.addEventListener('click', e => { const p = toCanvas(e); ui.cursor = { x:p.x, y:p.y, on:true }; consolePress(); drawConsole(); });
    cnv.addEventListener('dblclick', e => { const p = toCanvas(e); ui.cursor = { x:p.x, y:p.y, on:true }; consoleSelectAll(); drawConsole(); });
  }
}

function widgetAt(x, y){
  for (let i = ui.widgets.length - 1; i >= 0; i--){
    const w = ui.widgets[i];
    if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
  }
  return null;
}

/* ── painting: a tiny immediate-mode aero toolkit on the slab canvas ── */
const AERO = {
  ink: '#14507e', inkSoft: 'rgba(20,80,126,.62)', inkFaint: 'rgba(20,80,126,.42)',
  aqua: '#1a96ff', deep: '#0a5aa8', green: '#33c75a',
  glassFill: 'rgba(255,255,255,.55)', glassLine: 'rgba(70,150,215,.38)',
};
function cFont(cc, px, w = 500){ cc.font = `${w} ${px}px Quicksand, "Segoe UI", sans-serif`; }
function cGlassInset(cc, x, y, w, h, r, hot){
  cc.fillStyle = hot ? 'rgba(255,255,255,.8)' : AERO.glassFill;
  roundRect(cc, x, y, w, h, r); cc.fill();
  cc.strokeStyle = hot ? AERO.aqua : AERO.glassLine; cc.lineWidth = hot ? 4 : 2;
  roundRect(cc, x, y, w, h, r); cc.stroke();
}
function cAeroPill(cc, x, y, w, h, style, hot){
  const g = cc.createLinearGradient(0, y, 0, y + h);
  if (style === 'green'){ g.addColorStop(0,'#8ee69a'); g.addColorStop(.5,'#3ecb62'); g.addColorStop(1,'#1d9e46'); }
  else if (style === 'ghost'){ g.addColorStop(0,'rgba(255,255,255,.9)'); g.addColorStop(1,'rgba(215,240,255,.9)'); }
  else { g.addColorStop(0,'#9fd8ff'); g.addColorStop(.5,'#2a9df4'); g.addColorStop(1,'#0b6cc9'); }
  cc.fillStyle = g; roundRect(cc, x, y, w, h, h/2); cc.fill();
  // top gloss
  const gl = cc.createLinearGradient(0, y, 0, y + h*0.55);
  gl.addColorStop(0,'rgba(255,255,255,.85)'); gl.addColorStop(1,'rgba(255,255,255,.06)');
  cc.save(); roundRect(cc, x+3, y+3, w-6, h*0.5, h/2 - 3); cc.clip();
  cc.fillStyle = gl; cc.fillRect(x, y, w, h*0.6); cc.restore();
  // ghost pills live on white glass, where a white hover ring vanishes — they
  // light up with the same aqua ring the inset fields use; solid pills keep white
  cc.strokeStyle = hot ? (style === 'ghost' ? AERO.aqua : '#ffffff') : 'rgba(255,255,255,.65)';
  cc.lineWidth = hot ? 4 : 2;
  roundRect(cc, x, y, w, h, h/2); cc.stroke();
}
// widget emitters — each draws AND registers its hit-rect + action
function wButton(cc, id, label, x, y, w, h, act, style = 'aqua', sub){
  const hot = ui.hover?.id === id;
  cAeroPill(cc, x, y, w, h, style, hot);
  cc.fillStyle = style === 'ghost' ? AERO.deep : '#ffffff';
  let px = h * 0.42;                                  // shrink-to-fit long labels
  cFont(cc, px, 600);
  while (px > 18 && cc.measureText(label).width > w - 44){ px -= 1; cFont(cc, px, 600); }
  cc.textAlign = 'center'; cc.textBaseline = 'middle';
  cc.fillText(label, x + w/2, y + h/2 + 1);
  if (sub){ cc.fillStyle = AERO.inkSoft; cFont(cc, 22); cc.fillText(sub, x + w/2, y + h + 24); }
  ui.widgets.push({ id, x, y, w, h, label, act });
}
function wField(cc, id, label, x, y, w, get, set, max = 60, dim = false){
  // dim = a disabled slot: still shows its (kept) strings, greyed, no hit-rect
  const h = 62, focused = !dim && ui.focus === id, hot = !dim && ui.hover?.id === id;
  if (label){
    cc.fillStyle = dim ? AERO.inkFaint : AERO.inkSoft; cFont(cc, 24, 600);
    cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
    cc.fillText(label, x + 6, y - 10);
  }
  cGlassInset(cc, x, y, w, h, 16, hot || focused);
  cFont(cc, 30); cc.textAlign = 'left'; cc.textBaseline = 'middle';
  const v = get(), tx = x + 18, fit = w - 36, ty = y + h/2 + 1;
  if (focused){
    // caret-anchored scroll window: slide just enough to keep the caret visible
    ui.caret = clamp(ui.caret, 0, v.length);
    ui.selA = clamp(ui.selA, 0, v.length); ui.selB = clamp(ui.selB, 0, v.length);
    let off = Math.min(ui.fieldOff, ui.caret);
    while (cc.measureText(v.slice(off, ui.caret)).width > fit) off++;
    ui.fieldOff = off;
    let shown = v.slice(off);
    while (shown.length && cc.measureText(shown).width > fit) shown = shown.slice(0, -1);
    const end = off + shown.length, sA = Math.min(ui.selA, ui.selB), sB = Math.max(ui.selA, ui.selB);
    if (sB > sA && sB > off && sA < end){               // selection wash behind the text
      const p0 = tx + cc.measureText(v.slice(off, Math.max(sA, off))).width;
      const p1 = tx + cc.measureText(v.slice(off, Math.min(sB, end))).width;
      cc.fillStyle = 'rgba(26,150,255,.28)';
      cc.fillRect(p0, y + 9, p1 - p0, h - 18);
    }
    cc.fillStyle = AERO.ink; cc.fillText(shown, tx, ty);
    const cx = tx + cc.measureText(v.slice(off, ui.caret)).width;
    cc.fillStyle = AERO.aqua; cc.fillRect(cx, y + 10, 3, h - 20);   // the caret
  } else {
    let shown = v;                                      // unfocused → tail-anchored
    while (shown.length && cc.measureText(shown).width > fit) shown = shown.slice(1);
    cc.fillStyle = dim ? AERO.inkFaint : AERO.ink;
    cc.fillText(shown, tx, ty);
    if (!v){ cc.fillStyle = AERO.inkFaint; cc.fillText('· empty ·', tx, ty); }
  }
  if (dim) return;                                      // no hit-rect — can't focus a dim slot
  const wid = { id, x, y, w, h, label, type:'field', get, set, max };
  wid.act = cx => fieldPress(wid, cx);
  ui.widgets.push(wid);
}
/* ── field text editing: caret placement, drag/double-click selection ── */
const conSel = { drag:false, dragged:false, id:null, anchor:0 };
// slider press-and-hold: any input's held press (mouse button, E key, gamepad
// A, a touch look-drag) glues the armed slider's knob to the moving cursor,
// so values slide fluidly instead of jumping click by click
const conSlide = { drag:false, id:null, lastX:-1 };
const held = { mouse:false, padA:false, touchLook:false };   // keys.KeyE is read live
function fieldTextOff(w){
  // the first visible char of a field, mirroring wField's two windows:
  // focused = caret-anchored (already stored), unfocused = tail-anchored
  const cc = consoleCtx, v = w.get();
  if (ui.focus === w.id) return Math.min(ui.fieldOff, v.length);
  cc.save(); cFont(cc, 30);
  let shown = v;
  while (shown.length && cc.measureText(shown).width > w.w - 36) shown = shown.slice(1);
  cc.restore();
  return v.length - shown.length;
}
function fieldCharAt(w, cx){
  // cursor x (layout px) → caret index, on the window the visitor sees
  const cc = consoleCtx, v = w.get(), off = fieldTextOff(w);
  const rel = cx - (w.x + 18);
  cc.save(); cFont(cc, 30);
  let i = off;
  for (; i < v.length; i++){
    const before = cc.measureText(v.slice(off, i)).width;
    const after  = cc.measureText(v.slice(off, i + 1)).width;
    if (rel < (before + after) / 2) break;
  }
  cc.restore();
  return i;
}
function fieldPress(w, cx){
  // click / E / tap on a field: focus it and drop the caret under the pointer.
  // A click that lands right after a drag-selection keeps the selection —
  // the release must not eat what the drag just painted.
  if (ui.focus !== w.id){
    const off = fieldTextOff(w);          // keep the window the visitor was looking at
    ui.focus = w.id; ui.fieldOff = off;
  }
  if (conSel.dragged && conSel.id === w.id){ conSel.dragged = false; ui.dirty = true; return; }
  ui.caret = ui.selA = ui.selB = fieldCharAt(w, cx);
  ui.dirty = true;
}
function consoleSelStart(){
  // mousedown on a field: place the caret and arm a drag-selection from it
  if (!consoleMesh || conBoot.s !== 'done' || !ui.cursor.on) return false;
  const S = CON.W / 2048;
  const w = widgetAt(ui.cursor.x / S, ui.cursor.y / S);
  if (!w || w.type !== 'field') return false;
  conSel.drag = false; conSel.dragged = false;
  fieldPress(w, ui.cursor.x / S);
  conSel.drag = true; conSel.id = w.id; conSel.anchor = ui.caret;
  return true;
}
function consoleSelDrag(){
  // while the button stays down the moving cursor extends the selection
  if (!conSel.drag || !ui.cursor.on) return;
  const w = ui.widgets.find(k => k.id === conSel.id && k.type === 'field');
  if (!w) return;
  const i = fieldCharAt(w, ui.cursor.x / (CON.W / 2048));
  if (i !== ui.selB){
    ui.selB = ui.caret = i;
    if (i !== conSel.anchor) conSel.dragged = true;
    ui.dirty = true;
  }
}
function consoleSlideStart(){
  // press lands on a slider: the knob jumps to the press point and stays
  // glued to the cursor until the press releases
  if (!consoleMesh || conBoot.s !== 'done' || !ui.cursor.on) return false;
  const S = CON.W / 2048;
  const w = widgetAt(ui.cursor.x / S, ui.cursor.y / S);
  if (!w || w.type !== 'slider') return false;
  conSlide.drag = true; conSlide.id = w.id; conSlide.lastX = -1;
  consoleSlideDrag();
  return true;
}
function consoleSlideDrag(){
  // while any press stays down the moving cursor drags the knob; everything
  // released → the drag dies here on its own, no per-input cleanup needed
  if (!conSlide.drag) return;
  if (!held.mouse && !held.padA && !held.touchLook && !keys.KeyE){ conSlide.drag = false; return; }
  const w = ui.widgets.find(k => k.id === conSlide.id && k.type === 'slider');
  if (!w){ conSlide.drag = false; return; }
  if (!ui.cursor.on) return;                 // slid off the slab: hold the value, don't jump
  const cx = ui.cursor.x / (CON.W / 2048);
  if (cx !== conSlide.lastX){ conSlide.lastX = cx; w.act(cx); ui.dirty = true; }
}
function consoleSelectAll(){
  // double-click on a field: highlight the whole value
  if (!consoleMesh || conBoot.s !== 'done' || !ui.cursor.on) return false;
  const S = CON.W / 2048;
  const w = widgetAt(ui.cursor.x / S, ui.cursor.y / S);
  if (!w || w.type !== 'field') return false;
  ui.focus = w.id; ui.selA = 0; ui.selB = ui.caret = w.get().length;
  conSel.dragged = false;
  ui.dirty = true;
  return true;
}
function wSlider(cc, id, label, x, y, w, val, min, max, set, fmt, note){
  const hot = ui.hover?.id === id;
  cc.fillStyle = AERO.inkSoft; cFont(cc, 24, 600); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText(label, x + 6, y - 8);
  cc.textAlign = 'right'; cc.fillStyle = AERO.deep; cFont(cc, 24, 700);
  cc.fillText(fmt(val), x + w - 6, y - 8);
  if (note){ cc.textAlign = 'left'; cc.fillStyle = AERO.inkFaint; cFont(cc, 19); cc.fillText(note, x + 6, y + 44); }
  const th = 18, ty = y + 6;
  cc.fillStyle = 'rgba(150,200,235,.45)'; roundRect(cc, x, ty, w, th, th/2); cc.fill();
  const t = clamp((val - min) / (max - min), 0, 1);
  const g = cc.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, AERO.green); g.addColorStop(1, AERO.aqua);
  cc.fillStyle = g; roundRect(cc, x, ty, Math.max(th, w*t), th, th/2); cc.fill();
  cc.beginPath(); cc.arc(x + w*t, ty + th/2, hot ? 17 : 14, 0, 7);
  cc.fillStyle = '#ffffff'; cc.fill();
  cc.strokeStyle = AERO.aqua; cc.lineWidth = 3; cc.stroke();
  ui.widgets.push({ id, x: x - 10, y: y - 14, w: w + 20, h: 52, label, type:'slider',
                    act(cx){ set(min + clamp((cx - x)/w, 0, 1) * (max - min)); } });
}
function wToggle(cc, id, label, x, y, on, set, sub){
  const w = 92, h = 48, hot = ui.hover?.id === id;
  cc.fillStyle = on ? '#57c46e' : 'rgba(150,180,205,.55)';
  roundRect(cc, x, y, w, h, h/2); cc.fill();
  cc.strokeStyle = hot ? AERO.aqua : 'rgba(255,255,255,.7)'; cc.lineWidth = hot ? 4 : 2;
  roundRect(cc, x, y, w, h, h/2); cc.stroke();
  cc.beginPath(); cc.arc(on ? x + w - h/2 : x + h/2, y + h/2, h/2 - 6, 0, 7);
  cc.fillStyle = '#ffffff'; cc.fill();
  cc.fillStyle = AERO.ink; cFont(cc, 26, 600); cc.textAlign = 'left'; cc.textBaseline = 'middle';
  cc.fillText(label, x + w + 18, y + h/2 + 1);
  if (sub){ cc.fillStyle = AERO.inkFaint; cFont(cc, 19); cc.fillText(sub, x + w + 18, y + h/2 + 30); }
  ui.widgets.push({ id, x, y, w: w + 20 + cc.measureText(label).width, h, label, act(){ set(!on); } });
}

function drawConsole(){
  if (!consoleCtx) return;
  const cc = consoleCtx, W = CON.W, H = CON.H, S = W / 2048;   // layout designed at 2048-wide
  cc.save(); cc.scale(S, S);
  const LW = 2048, LH = 1152;
  ui.widgets.length = 0;
  // aero glass face
  const bg = cc.createLinearGradient(0, 0, 0, LH);
  bg.addColorStop(0, '#f4fbff'); bg.addColorStop(.45, '#ddf1fe'); bg.addColorStop(1, '#c9e7fb');
  cc.fillStyle = bg; cc.fillRect(0, 0, LW, LH);
  const sheen = cc.createLinearGradient(0, 0, 0, LH*0.4);
  sheen.addColorStop(0, 'rgba(255,255,255,.85)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  cc.fillStyle = sheen; cc.fillRect(0, 0, LW, LH*0.4);
  // boot cutscene: pending = clean glass (like the panels' white), loading =
  // the same aero bar beat the panels get — no widgets until it lands
  if (conBoot.s !== 'done'){
    cc.fillStyle = 'rgba(20,80,126,.35)'; cFont(cc, 58, 700);
    cc.textAlign = 'center'; cc.textBaseline = 'alphabetic';
    cc.fillText('GALLERY CONSOLE', LW/2, LH/2 - 54);
    if (conBoot.s === 'loading'){
      const p = clamp((performance.now() - conBoot.t0) / CON_BOOT_MS, 0, 1);
      const bw = 720, bh = 26, bx = (LW - bw)/2, by = LH/2;
      cc.fillStyle = 'rgba(150,200,235,.45)'; roundRect(cc, bx, by, bw, bh, bh/2); cc.fill();
      const g = cc.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, AERO.green); g.addColorStop(1, AERO.aqua);
      cc.fillStyle = g; roundRect(cc, bx, by, Math.max(bh, bw*p), bh, bh/2); cc.fill();
    }
    cc.restore();
    consoleTex.needsUpdate = true;
    ui.dirty = false; ui.lastPaint = performance.now();
    return;
  }
  // header
  cc.fillStyle = AERO.deep; cFont(cc, 58, 700); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('GALLERY CONSOLE', 64, 96);
  cc.fillStyle = AERO.inkSoft; cFont(cc, 27);
  cc.textAlign = 'right'; cc.fillText('design yours · fork it · deploy it', LW - 64, 96);
  // tabs
  const tabs = [['identity','identity'],['worlds','worlds'],['vibe','atmosphere'],['publish','publish ✦']];
  let tx = 64;
  for (const [id, label] of tabs){
    const tw = 300, th = 72, on = ui.tab === id, hot = ui.hover?.id === 'tab:' + id;
    if (on) cAeroPill(cc, tx, 130, tw, th, 'aqua', hot);
    else { cGlassInset(cc, tx, 130, tw, th, th/2, hot); }
    cc.fillStyle = on ? '#ffffff' : AERO.deep; cFont(cc, 30, 700);
    cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillText(label, tx + tw/2, 130 + th/2 + 1);
    const tid = 'tab:' + id;
    ui.widgets.push({ id: tid, x: tx, y: 130, w: tw, h: th, label,
                      act(){ ui.tab = id; ui.focus = null; ui.dirty = true; } });
    tx += tw + 28;
  }
  const top = 280;
  if (ui.tab === 'identity')  drawIdentity(cc, top);
  else if (ui.tab === 'worlds') drawWorlds(cc, top);
  else if (ui.tab === 'vibe')  drawVibe(cc, top);
  else drawPublish(cc, top);
  // footer hint
  cc.fillStyle = AERO.inkFaint; cFont(cc, 24); cc.textAlign = 'center'; cc.textBaseline = 'alphabetic';
  cc.fillText(isTouch ? 'aim by dragging · tap to press fields & buttons'
                      : 'aim with your view · click / E to press · type to fill the lit field · drag / double-click selects · ctrl+C / V',
              LW/2, LH - 28);
  // toast
  if (ui.note && performance.now() - ui.noteT < 2600){
    cFont(cc, 28, 600);
    const tw2 = cc.measureText(ui.note).width + 72;
    cGlassInset(cc, LW/2 - tw2/2, LH - 130, tw2, 64, 32, true);
    cc.fillStyle = AERO.deep; cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillText(ui.note, LW/2, LH - 130 + 33);
  } else ui.note = null;
  cc.restore();
  consoleTex.needsUpdate = true;
  ui.dirty = false; ui.lastPaint = performance.now();
}

function drawIdentity(cc, top){
  const colW = 900, x1 = 64, x2 = 64 + colW + 120;
  const d = draft, mk = (id, label, x, y, get, set, max) =>
    wField(cc, id, label, x, y, colW, get, set, max);
  let y = top + 40;
  mk('f:creator', 'your handle — the entrance button', x1, y, () => d.creator, v => { d.creator = v; }, 40);
  mk('f:title', 'gallery title', x1, y += 130, () => d.title, v => { d.title = v; }, 40);
  mk('f:tab', 'browser-tab title', x1, y += 130, () => d.tabTitle, v => { d.tabTitle = v; }, 60);
  mk('f:sub', 'splash subtitle  (empty hides it)', x1, y += 130, () => d.subtitle, v => { d.subtitle = v; }, 60);
  mk('f:load', 'loading line  (empty hides it)', x1, y += 130, () => d.loadingNote, v => { d.loadingNote = v; }, 60);
  y = top + 40;
  mk('f:ready', 'ready line — {n} = world count', x2, y, () => d.readyNote, v => { d.readyNote = v; }, 60);
  mk('f:ptitle', 'pause title', x2, y += 130, () => d.pause.title, v => { d.pause.title = v; }, 40);
  mk('f:pnote', 'pause note', x2, y += 130, () => d.pause.note, v => { d.pause.note = v; }, 60);
  mk('f:presume', 'resume button', x2, y += 130, () => d.pause.resume, v => { d.pause.resume = v; }, 30);
  cc.fillStyle = AERO.inkFaint; cFont(cc, 22); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('everything here previews live — check the splash & pause card', x2 + 6, top + 40 + 3*130 + 130);
}

function drawWorlds(cc, top){
  const d = draft, PER = 4, pages = Math.max(1, Math.ceil(d.projects.length / PER));
  ui.page = clamp(ui.page, 0, pages - 1);
  d.walls = normWalls(d.walls);        // heal drafts that predate the wall slots
  // where everything lands, on the DRAFT's own console/wall settings — the
  // same planner the hall layout uses, so the badges never lie
  const plan = planWalls(d.projects.length, d.walls, d.consoleOn);
  const panels = d.projects.length + (plan.west === 'slot' ? 1 : 0) + (plan.east === 'slot' ? 1 : 0);
  // (00/000/0000 are the code's slot breadcrumbs — the visitor reads "west wall")
  const hint = plan.wild === 'west'  ? '  ·  the odd world rides the west wall'
             : plan.wild === 'east'  ? '  ·  the odd world rides the east wall'
             : d.projects.length % 2 ? '  ·  both walls hold worlds — the odd one rides the last row'
             :                         '  ·  walls balanced ✓';
  cc.fillStyle = AERO.inkSoft; cFont(cc, 26); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText(`your worlds — ${panels} panels` + hint, 64, top + 6);
  // end-wall slots: STATIC rows above the numbered list, each with its OWN
  // strings — the corridor worlds below never fill them. A toggle only greys
  // its slot on and off: the strings survive off states untouched, and an
  // on + empty slot simply builds its glass wall bare. West is the far wall
  // the console occupies while it's on; east the sun-lit entrance.
  let y = top + 70;
  const wallRow = (slot, label, dimmed, tOn, tSet) => {
    const s = d.walls[slot];
    wField(cc, `w:${slot}:name`, label, 64, y, 430, () => s.name, v => { s.name = v; }, 30, dimmed);
    wField(cc, `w:${slot}:url`,  '',   540, y, 1280, () => s.url,  v => { s.url  = v; }, 200, dimmed);
    wToggle(cc, `w:${slot}`, '', 1860, y + 7, tOn, tSet);
    y += 108;
  };
  wallRow('west',
    d.consoleOn ? 'west wall — the console lives here'
                : d.walls.west.on ? 'west wall' : 'west wall — off',
    d.consoleOn || !d.walls.west.on,
    d.walls.west.on && !d.consoleOn,
    d.consoleOn ? () => toast('the console owns the west wall — hide it in atmosphere first')
                : v => { d.walls.west.on = v; saveDraft(); ui.dirty = true; });
  wallRow('east',
    d.walls.east.on ? 'east wall — the entrance' : 'east wall — off',
    !d.walls.east.on,
    d.walls.east.on,
    v => { d.walls.east.on = v; saveDraft(); ui.dirty = true; });
  const start = ui.page * PER;
  d.projects.slice(start, start + PER).forEach((p, k) => {
    const i = start + k;
    const badge = (plan.wild && i === d.projects.length - 1)
      ? `rides the ${plan.wild} wall — the odd one` : '';
    wField(cc, `w:name:${i}`, badge || (k === 0 ? 'plaque' : ''), 64, y, 430, () => p.name, v => { p.name = v; }, 30);
    wField(cc, `w:url:${i}`, k === 0 ? 'url' : '', 540, y, 1280, () => p.url, v => { p.url = v; }, 200);
    wButton(cc, `w:del:${i}`, '✕', 1860, y, 62, 62, () => {
      d.projects.splice(i, 1); ui.focus = null; saveDraft(); ui.dirty = true;
    }, 'ghost');
    y += 108;
  });
  wButton(cc, 'w:add', '+ add a world', 64, y + 10, 360, 70, () => {
    d.projects.push({ name: 'New World', url: 'https://' });
    ui.page = Math.floor((d.projects.length - 1) / PER);
    saveDraft(); ui.dirty = true;
  }, 'green');
  cc.fillStyle = AERO.inkFaint; cFont(cc, 22); cc.textAlign = 'left'; cc.textBaseline = 'middle';
  cc.fillText('applies on your deployed gallery — the hall rebuilds itself to fit', 458, y + 46);
  if (pages > 1){
    wButton(cc, 'w:prev', '‹', 1700, y + 10, 70, 70, () => { ui.page--; ui.dirty = true; }, 'ghost');
    wButton(cc, 'w:next', '›', 1852, y + 10, 70, 70, () => { ui.page++; ui.dirty = true; }, 'ghost');
    cc.fillStyle = AERO.inkSoft; cFont(cc, 26, 600); cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillText(`${ui.page + 1} / ${pages}`, 1811, y + 45);
  }
}

function drawVibe(cc, top){
  const d = draft, colW = 860, x1 = 64, x2 = 64 + colW + 200;
  let y = top + 50;
  wSlider(cc, 'v:bcount', 'bubbles', x1, y, colW, d.bubbles.count, 0, 96,
    v => { d.bubbles.count = Math.round(v); vibeLive(); }, v => `${Math.round(v)}`);
  wSlider(cc, 'v:bsize', 'bubble size', x1, y += 130, colW, d.bubbles.size, 0.4, 2,
    v => { d.bubbles.size = v; vibeLive(); }, v => `${v.toFixed(2)}×`);
  wSlider(cc, 'v:bspeed', 'bubble speed', x1, y += 130, colW, d.bubbles.speed, 0.3, 2.5,
    v => { d.bubbles.speed = v; vibeLive(); }, v => `${v.toFixed(2)}×`);
  wSlider(cc, 'v:vol', 'sound volume', x1, y += 130, colW, d.volume, 0, 1,
    v => { d.volume = v; vibeLive(); }, v => `${Math.round(v*100)}%`);
  wSlider(cc, 'v:mspeed', 'movement speed', x1, y += 130, colW, d.moveSpeed, 0.5, 1.5,
    v => { d.moveSpeed = v; vibeLive(); }, v => `${Math.round(v*100)}%`,
    'tired of hints? stare into the sun and you won\'t see them anymore');
  y = top + 50;
  wSlider(cc, 'v:cover', 'cloud cover', x2, y, colW, d.clouds.cover, 0, 1,
    v => { d.clouds.cover = v; saveDraft(); }, v => v.toFixed(2), 'applies on your deployed gallery');
  wSlider(cc, 'v:cirrus', 'cirrus streaks', x2, y += 130, colW, d.clouds.cirrus, 0, 1,
    v => { d.clouds.cirrus = v; saveDraft(); }, v => v.toFixed(2), 'applies on your deployed gallery');
  wToggle(cc, 'v:shuffle', 'shuffle world order each visit', x2, y += 150, d.shuffleOrder,
    v => { d.shuffleOrder = v; saveDraft(); ui.dirty = true; });
  wToggle(cc, 'v:newtab', 'open worlds in a new tab', x2, y += 110, d.openInNewTab,
    v => { d.openInNewTab = v; saveDraft(); ui.dirty = true; });
  wToggle(cc, 'v:console', 'show the build-a-gallery console', x2, y += 110, d.consoleOn,
    v => { d.consoleOn = v; saveDraft(); ui.dirty = true; }, 'applies on your deployed gallery');
}
function vibeLive(){ saveDraft(); applyDraftLive(); ui.dirty = true; }

function drawPublish(cc, top){
  const d = draft, gh = ui.gh, x1 = 64, colW = 1000, x2 = 1180;
  const step = (n, label, done, y) => {
    cc.beginPath(); cc.arc(x1 + 22, y - 10, 20, 0, 7);
    cc.fillStyle = done ? AERO.green : 'rgba(150,190,220,.6)'; cc.fill();
    cc.fillStyle = '#ffffff'; cFont(cc, 24, 700); cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillText(done ? '✓' : `${n}`, x1 + 22, y - 9);
    cc.fillStyle = AERO.deep; cFont(cc, 32, 700); cc.textAlign = 'left'; cc.textBaseline = 'middle';
    cc.fillText(label, x1 + 60, y - 10);
  };
  let y = top + 40;
  // 1 · name — a plain console field like every other: type straight into it.
  // Keystrokes are sanitised to GitHub-safe repo characters as they land.
  step(1, 'name it', true, y);
  wField(cc, 'p:name', '', x1 + 60, y + 20, 620, () => d.repoName,
    v => { d.repoName = v.replace(/[^a-zA-Z0-9._-]+/g, '-'); }, 60);
  cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('your GitHub repository name', x1 + 700, y + 58);
  // 2 · github
  y += 170;
  step(2, 'get your copy on GitHub', gh.doneFork, y);
  if (gh.mode === 'connected'){
    cc.fillStyle = AERO.inkSoft; cFont(cc, 25); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
    cc.fillText(`connected as ${gh.login} ✓`, x1 + 60, y + 44);
    const busy = gh.busy != null;
    wButton(cc, 'p:fork', busy ? (gh.busy === 'fork' ? 'forking…' : 'writing your design…')
                               : (gh.doneFork ? 'fork again' : 'create my gallery ✦'),
            x1 + 60, y + 62, 560, 84, busy ? null : doCreateGallery, gh.doneFork ? 'ghost' : 'green');
    if (gh.forkRepo){
      cc.fillStyle = AERO.inkSoft; cFont(cc, 22); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
      cc.fillText(`${gh.forkRepo}${gh.doneConfig ? '  ·  design committed ✓' : ''}`, x1 + 60, y + 185);
    }
  } else if (gh.mode === 'anon'){
    wButton(cc, 'p:connect', 'connect GitHub ↗', x1 + 60, y + 40, 480, 84, () => {
      saveDraft();
      pauseHushUntil = performance.now() + 2000;
      window.open('/api/gh/login', '_blank');
      toast('sign in on the new tab · this one notices by itself');
    });
    cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
    cc.fillText('one click — we fork the template into your account & commit your design', x1 + 60, y + 165);
  } else {
    wButton(cc, 'p:forklink', 'fork on GitHub ↗', x1 + 60, y + 40, 480, 84, () => {
      saveDraft();
      pauseHushUntil = performance.now() + 2000;
      window.open(`https://github.com/${CONFIG.console?.sourceRepo || ''}/fork`, '_blank');
      toast('fork page opened — pick your name there');
    });
    cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
    cc.fillText(gh.mode === 'nooauth' ? 'name yours on the fork page, then copy your design (right) into it'
                                      : 'checking sign-in…', x1 + 60, y + 165);
  }
  if (gh.err){ cc.fillStyle = '#b3403f'; cFont(cc, 22); cc.textAlign='left'; cc.textBaseline='alphabetic'; cc.fillText(gh.err, x1 + 60, y + 210); }
  // 3 · cloudflare
  y += 250;
  step(3, 'deploy on Cloudflare Pages', false, y);
  wButton(cc, 'p:deploy', 'open Cloudflare ↗', x1 + 60, y + 40, 480, 84, () => {
    pauseHushUntil = performance.now() + 2000;
    window.open('https://dash.cloudflare.com/?to=/:account/pages/new/provider/github', '_blank');
    toast('pick your new repo · accept the defaults · deploy');
  });
  cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('connect the repo you just made · no build command', x1 + 60, y + 165);
  cc.fillText('every push redeploys', x1 + 60, y + 196);
  // right rail — the design payload
  cGlassInset(cc, x2, top + 10, 800, 700, 26, false);
  cc.fillStyle = AERO.deep; cFont(cc, 34, 700); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('your design', x2 + 40, top + 70);
  // ── the reset swirl: a blue swirly arrow at the OTHER end of the 'your
  // design' line. Hover cocks it back with an aqua glow, a click spins it a
  // full turn and pours the deployment's pristine config back into the
  // console (see resetDraft) — the grey tip underneath says what it is.
  {
    const rw = 64, rx = x2 + 800 - rw - 40, ry = top + 24;
    const hot = ui.hover?.id === 'p:reset';
    const now = performance.now();
    // hover: the cock-back eases in AND out instead of snapping — a 180ms
    // blend clocked from the moment the hover edge flipped, either direction
    if (hot !== ui.resetHov){ ui.resetHov = hot; ui.resetHovT = now; }
    const hb = Math.min(1, (now - ui.resetHovT) / 180);
    const cock = -0.28 * easeOut(hot ? hb : 1 - hb);
    if (hb < 1) ui.animUntil = Math.max(ui.animUntil, now + 200);   // ride out the blend
    // click: an underdamped spring — spins up fast, overshoots the full turn,
    // rocks back and settles. exp decay × cos = the classic solid "clunk".
    const u = (now - ui.resetT) / 1400;
    const spinA = u < 1 ? Math.PI * 2 * (1 - Math.exp(-6 * u) * Math.cos(10 * u)) : 0;
    if (u < 1) ui.animUntil = Math.max(ui.animUntil, now + 60);     // ride out the spring
    const cxp = rx + rw/2, cyp = ry + rw/2;
    cc.save();
    cc.translate(cxp, cyp);
    cc.rotate(spinA + cock);
    // the swirl: an arc whose radius grows along the sweep — a true spiral
    cc.beginPath();
    const A0 = -Math.PI * 0.5, A1 = Math.PI * 1.05, STEPS = 30;
    for (let i = 0; i <= STEPS; i++){
      const a = A0 + (A1 - A0) * i / STEPS, r = 14 + 8 * i / STEPS;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i ? cc.lineTo(px, py) : cc.moveTo(px, py);
    }
    const sg = cc.createLinearGradient(-22, -22, 22, 22);
    sg.addColorStop(0, '#5cc0ff'); sg.addColorStop(1, AERO.deep);
    cc.strokeStyle = hot ? AERO.aqua : sg;
    cc.lineWidth = hot ? 8 : 7; cc.lineCap = 'round';
    if (hot){ cc.shadowColor = 'rgba(26,150,255,.8)'; cc.shadowBlur = 14; }
    cc.stroke();
    cc.shadowColor = 'transparent'; cc.shadowBlur = 0;
    // arrowhead at the spiral's mouth, tangent to the curve
    const rEnd = 22, ex = Math.cos(A1) * rEnd, ey = Math.sin(A1) * rEnd;
    const tx = -Math.sin(A1), ty = Math.cos(A1);         // direction of travel
    cc.beginPath();
    cc.moveTo(ex + tx * 17, ey + ty * 17);               // apex, along the tangent
    cc.lineTo(ex + Math.cos(A1) * 10, ey + Math.sin(A1) * 10);
    cc.lineTo(ex - Math.cos(A1) * 10, ey - Math.sin(A1) * 10);
    cc.closePath();
    cc.fillStyle = hot ? AERO.aqua : AERO.deep;
    cc.fill();
    cc.restore();
    // the grey tip line under the swirl
    cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'center'; cc.textBaseline = 'alphabetic';
    cc.fillText('reset?', cxp, ry + rw + 24);
    cc.textAlign = 'left';                               // the payload lines below expect left
    ui.widgets.push({ id:'p:reset', x:rx - 8, y:ry - 8, w:rw + 16, h:rw + 16, label:'reset', act(){
      ui.resetT = performance.now();
      resetDraft();
      toast('reset ✓ — template values restored');
    } });
  }
  cc.fillStyle = AERO.inkSoft; cFont(cc, 26);
  const oj = buildOwnerJson();
  const ojPlan = planWalls(oj.projects.length, normWalls(oj.walls), !!d.consoleOn);
  const ojWorlds = oj.projects.length + (ojPlan.west === 'slot' ? 1 : 0) + (ojPlan.east === 'slot' ? 1 : 0);
  [
    `“${oj.title}”  by  ${oj.creator}`,
    `${ojWorlds} worlds  ·  ${Math.round(oj.bubbles.count)} bubbles`,
    `tab: ${oj.tabTitle || '(default)'}`,
    gh.doneConfig ? 'committed to your fork as owner.config.json ✓'
                  : 'connected sign-ups commit this automatically —',
    gh.doneConfig ? '' : 'or copy it yourself:',
  ].forEach((l, i) => l && cc.fillText(l, x2 + 40, top + 130 + i * 48));
  wButton(cc, 'p:copyjson', 'copy owner.config.json', x2 + 40, top + 400, 460, 74, async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(buildOwnerJson(), null, 2)); toast('copied ✓ — commit it to your fork'); }
    catch { toast('clipboard blocked — use ?console mode'); }
  }, 'ghost');
  wButton(cc, 'p:copysecret', 'copy as OWNER_CONFIG secret', x2 + 40, top + 500, 460, 74, async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(buildOwnerJson(), null, 2)); toast('copied ✓ — paste into a Pages secret named OWNER_CONFIG'); }
    catch { toast('clipboard blocked — use ?console mode'); }
  }, 'ghost');
  // privacy tip — rides with the copy buttons it talks about
  cc.fillStyle = AERO.inkFaint; cFont(cc, 21); cc.textAlign = 'left'; cc.textBaseline = 'alphabetic';
  cc.fillText('prefer privacy? the OWNER_CONFIG secret is the same JSON,', x2 + 40, top + 616);
  cc.fillText('kept out of the repo — paste it in Pages Settings →', x2 + 40, top + 646);
  cc.fillText('Environment variables', x2 + 40, top + 676);
}

/* ── publish actions ── */
async function refreshGhState(){
  if (!CON_ENABLED) return;
  try {
    const r = await fetch('/api/gh/me');
    if (r.ok){ const j = await r.json(); ui.gh.mode = 'connected'; ui.gh.login = j.login; }
    else if (r.status === 401) ui.gh.mode = 'anon';
    else ui.gh.mode = 'nooauth';
  } catch { ui.gh.mode = 'nooauth'; }
  ui.dirty = true;
}
// sign-in rides a separate tab now (the gallery page must never navigate away) —
// whenever this tab comes back into view while still anonymous, re-ask who we
// are so the console flips to connected on its own
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ui.gh?.mode === 'anon') refreshGhState();
});
addEventListener('focus', () => { if (ui.gh?.mode === 'anon') refreshGhState(); });
async function doCreateGallery(){
  const gh = ui.gh;
  if (gh.busy) return;
  gh.err = null; gh.busy = 'fork'; ui.dirty = true; drawConsole();
  try {
    // the name-it field seeds with the template's own name; whatever it says
    // (sans stray edge dashes) is the fork's name — empty falls back to GitHub's default
    const name = (draft.repoName || '').trim().replace(/^-+|-+$/g, '');
    const body = name ? { name } : {};
    const fr = await fetch('/api/gh/fork', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const fj = await fr.json().catch(() => ({}));
    if (!fr.ok) throw new Error(fj.error || `fork failed (${fr.status})`);
    gh.forkRepo = fj.repo; gh.forkUrl = fj.url; gh.doneFork = true;
    gh.busy = 'commit'; ui.dirty = true; drawConsole();
    const cr = await fetch('/api/gh/commit', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ repo: fj.repo, config: buildOwnerJson() }) });
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok) throw new Error(cj.error || `config commit failed (${cr.status})`);
    gh.doneConfig = true;
    audio.ping(consoleGroup?.position);
    toast('your gallery exists ✦ now deploy it on Cloudflare');
  } catch (e){
    gh.err = String(e.message || e).slice(0, 90);
  }
  gh.busy = null; ui.dirty = true;
}

/* ── per-frame: aim, hover, repaint ── */
const _conRay = new THREE.Raycaster();
function updateConsole(){
  if (!consoleMesh) return;
  const now = performance.now();
  // boot: kick off with slab 0's bar, run the same beat, land with a bloop
  if (conBoot.s === 'pending'){
    if (frames[0] && frames[0].userData.loadState !== 'pending'){
      conBoot.s = 'loading'; conBoot.t0 = now; drawConsole();
    }
  } else if (conBoot.s === 'loading'){
    if (now - conBoot.t0 >= CON_BOOT_MS){
      conBoot.s = 'done'; ui.dirty = true; audio.ping(consoleGroup?.position);
    } else if (now - ui.lastPaint > 33) drawConsole();
  }
  if (!conDesk){   // desk mode: the OS pointer owns cursor + hover — the raycast must not stomp them
    let on = false, cx = -1, cy = -1;
    if ((state === 'play' || state === 'intro') && player.position.z > PLAT_Z1 - 9.5){
      camera.getWorldDirection(_gazeDir);
      if (_gazeDir.z > 0.25){
        _conRay.setFromCamera({ x: 0, y: 0 }, camera);
        const hit = _conRay.intersectObject(consoleMesh, false)[0];
        if (hit?.uv){ on = true; cx = hit.uv.x * CON.W; cy = (1 - hit.uv.y) * CON.H; }
      }
    }
    ui.cursor = { x: cx, y: cy, on };
    if (conCursor){                                        // pointer quad: free per-frame motion
      conCursor.visible = on && conBoot.s === 'done';
      if (on) conCursor.position.set((cx / CON.W - 0.5) * CON_CW + 17 * CON_PX,
                                     (0.5 - cy / CON.H) * CON_CH - 25 * CON_PX, 0.15);
    }
    if (on){
      const h = widgetAt(cx / (CON.W/2048), cy / (CON.W/2048));
      if (h?.id !== ui.hover?.id){ ui.hover = h; ui.dirty = true; if (h) audio.hover(); }
    } else if (ui.hover){ ui.hover = null; ui.dirty = true; }
  }
  consoleSelDrag();                                      // held button + moving view = drag-select
  consoleSlideDrag();                                    // held press + moving view = slider drag

  const caret = ui.focus && now - ui.lastPaint > 500;    // caret keep-alive
  const staleNote = ui.note && now - ui.noteT > 2600;    // one repaint clears the toast
  const anim = now < ui.animUntil;                       // a widget animation is mid-flight
  if ((ui.dirty || caret || staleNote || anim) && now - ui.lastPaint > 33) drawConsole();
}

/* ── pressing & typing ── */
// the buttons that actually make someone's gallery (publish steps 2 & 3) ring
// the notify chime instead of the standard press
const PUBLISH_STEP_BTNS = new Set(['p:connect', 'p:fork', 'p:forklink', 'p:deploy']);
function consolePress(){
  if (!consoleMesh || conBoot.s !== 'done' || !ui.cursor.on) return false;
  const S = CON.W / 2048;
  const w = widgetAt(ui.cursor.x / S, ui.cursor.y / S);
  if (ui.focus && (!w || w.id !== ui.focus)) ui.focus = null;   // click elsewhere blurs
  if (!w){ ui.dirty = true; return true; }                      // on-slab click still consumed
  audio.init();
  if (PUBLISH_STEP_BTNS.has(w.id)) audio.publish(); else audio.press();
  if (w.type === 'slider'){
    w.act(ui.cursor.x / S);
    // a press that stays held (E, pad A) keeps dragging the knob from here;
    // a released click just sets it once and the arm dies on the next frame
    conSlide.drag = true; conSlide.id = w.id; conSlide.lastX = ui.cursor.x / S;
  }
  else w.act?.(ui.cursor.x / S);
  ui.dirty = true;
  return true;
}
function consoleTypeKey(e){
  if (!ui.focus) return false;
  const w = ui.widgets.find(x => x.id === ui.focus && x.type === 'field');
  if (!w){ ui.focus = null; return false; }
  const val = () => w.get();
  const sMin = () => Math.min(ui.selA, ui.selB), sMax = () => Math.max(ui.selA, ui.selB);
  const hasSel = () => ui.selA !== ui.selB;
  const commit = (nv, caret) => {        // set + re-clamp (set may sanitise, e.g. the repo name)
    w.set(nv);
    ui.caret = clamp(caret, 0, val().length);
    ui.selA = ui.selB = ui.caret;
    saveDraft(); applyDraftLive();
  };
  const insert = (str) => {              // replaces the selection (or splices at the caret)
    str = String(str).replace(/[\r\n]+/g, ' ');
    const a = hasSel() ? sMin() : ui.caret, b = hasSel() ? sMax() : ui.caret;
    str = str.slice(0, Math.max(0, w.max - (val().length - (b - a))));
    commit(val().slice(0, a) + str + val().slice(b), a + str.length);
  };
  // power-user chords: select all, copy, cut, paste. (!altKey: AltGr layouts
  // report ctrl+alt for ordinary special characters — those must still type)
  if ((e.ctrlKey || e.metaKey) && !e.altKey){
    const k = (e.key || '').toLowerCase();
    if (k === 'a'){ ui.selA = 0; ui.selB = ui.caret = val().length; }
    else if (k === 'c' || k === 'x'){
      const a = hasSel() ? sMin() : 0, b = hasSel() ? sMax() : val().length;   // no selection → the whole field
      navigator.clipboard?.writeText(val().slice(a, b))
        .then(() => toast('copied ✓')).catch(() => toast('clipboard blocked — use ?console mode'));
      if (k === 'x') commit(val().slice(0, a) + val().slice(b), a);
    }
    else if (k === 'v'){
      navigator.clipboard?.readText?.()
        .then(t => { if (t){ insert(t); ui.dirty = true; } })
        .catch(() => toast('clipboard blocked — use ?console mode'));
    }
    else return true;                    // other chords: off the game keys, browser keeps them
  }
  else if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab'){ ui.focus = null; }
  else if (e.key === 'Backspace'){
    if (hasSel()) commit(val().slice(0, sMin()) + val().slice(sMax()), sMin());
    else if (ui.caret > 0) commit(val().slice(0, ui.caret - 1) + val().slice(ui.caret), ui.caret - 1);
  }
  else if (e.key === 'Delete'){
    if (hasSel()) commit(val().slice(0, sMin()) + val().slice(sMax()), sMin());
    else if (ui.caret < val().length) commit(val().slice(0, ui.caret) + val().slice(ui.caret + 1), ui.caret);
  }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    if (e.shiftKey) ui.selB = ui.caret = clamp(ui.caret + step, 0, val().length);
    else {
      ui.caret = hasSel() ? (step < 0 ? sMin() : sMax()) : clamp(ui.caret + step, 0, val().length);
      ui.selA = ui.selB = ui.caret;
    }
  }
  else if (e.key === 'Home' || e.key === 'End'){
    ui.caret = e.key === 'Home' ? 0 : val().length;
    if (e.shiftKey) ui.selB = ui.caret; else ui.selA = ui.selB = ui.caret;
  }
  else if (e.key.length === 1){ insert(e.key); }
  else return true;                      // swallow the rest while typing
  e.preventDefault(); ui.dirty = true;
  return true;
}
// drag/double-click selection on the console fields: under pointer lock the
// VIEW is the pointer — mousedown drops the caret and arms the drag, the
// per-frame cursor (updateConsole) extends it, mouseup ends it. dblclick
// still fires under lock, selecting the whole field.
addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  held.mouse = true;
  if (controls.isLocked){ consoleSelStart(); consoleSlideStart(); }
});
addEventListener('mouseup',   () => { held.mouse = false; conSel.drag = false; });
addEventListener('dblclick',  () => { if (controls.isLocked) consoleSelectAll(); });

/* ════════════════════════════════════════════════════════════════
   6 · controls — pointer-lock mouse + gamepad + touch, all smoothed
   ════════════════════════════════════════════════════════════════ */
controls = new PointerLockControls(camera, renderer.domElement);
controls.pointerSpeed = CONFIG.movement.mouseSensitivity ?? 1;
// pitch limits in lockstep with applyLook's (0.02 rad shy of the poles): stock
// PLC lets mouse pitch reach ±90° exactly, where the YXZ euler↔quaternion
// round-trip turns singular and the extracted yaw can hop between atan2
// branches — a twitch in the look while staring straight up or down. Every
// input now turns around at the same seam, the same margin off vertical.
controls.minPolarAngle = 0.02;
controls.maxPolarAngle = Math.PI - 0.02;
// PointerLockControls' controlled object IS the camera (getObject() was just a
// deprecated alias for it — r180 warns on every call, so we address it directly)
const player = camera;
scene.add(player);

const velocity = new THREE.Vector3();
const M = CONFIG.movement;
// scratch vectors reused every frame — keeping these out of the render loop avoids
// per-frame allocations (the classic source of periodic GC stutter / micro-jitter)
const _camWorld = new THREE.Vector3();
const _moveDir  = new THREE.Vector3();
const _lookFwd  = new THREE.Vector3();
const _visitRay = new THREE.Raycaster();          // centre-screen "invisible cursor" for visit? targeting
const _visitTargets = [];                          // cached panel+label meshes, rebuilt only when the hall changes
const _screenCentre = { x: 0, y: 0 };
const moveInput = { x:0, y:0 };       // keyboard
const padMove   = { x:0, y:0 };       // gamepad left stick
const touchMove = { x:0, y:0 };       // on-screen joystick

// apply a look delta the same way PointerLockControls does (so they compose)
const _PI2 = Math.PI/2;
const _lookE = new THREE.Euler(0, 0, 0, 'YXZ');
function applyLook(dYaw, dPitch){
  _lookE.setFromQuaternion(camera.quaternion);
  _lookE.y -= dYaw;
  _lookE.x -= dPitch;
  _lookE.x = clamp(_lookE.x, -_PI2 + 0.02, _PI2 - 0.02);
  camera.quaternion.setFromEuler(_lookE);
}

// ── phantom aim-punch guard ──
// The browser can hand the FIRST mousemove after pointer lock engages — or
// after the tab regains focus mid-session — one giant bogus delta: the cursor
// travel accumulated while unlocked, dumped into a single event. Stock
// PointerLockControls applies movementX/Y raw, so that one event snapped the
// view sideways. The console made lock churn routine (Esc menus, publish tabs
// opening and returning), which is when the punches started landing. This
// capture-phase listener runs BEFORE PLC's document-level handler: for a beat
// after any lock/focus flip, deltas beyond a gentle cap are dropped whole;
// past that, a delta no wrist flick could produce in one coalesced frame is
// saturated and fed through applyLook at PLC's own delta→radians scale.
// Ordinary aim never enters either branch and reaches PLC untouched.
{
  const SETTLE_MS  = 150;   // how long after a lock/focus flip big deltas stay suspect
  const SETTLE_CAP = 60;    // px per event allowed through while settling
  const FLICK_CAP  = 350;   // px per event beyond any human flick at frame cadence
  let settleUntil = 0;
  const arm = () => { settleUntil = performance.now() + SETTLE_MS; };
  document.addEventListener('pointerlockchange', arm);
  addEventListener('focus', arm);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
  document.addEventListener('mousemove', e => {
    if (!controls.isLocked) return;
    const mx = e.movementX, my = e.movementY;
    const now = performance.now(), settling = now < settleUntil;
    const cap = settling ? SETTLE_CAP : FLICK_CAP;
    if (Math.abs(mx) <= cap && Math.abs(my) <= cap) return;   // clean event → PLC as usual
    e.stopImmediatePropagation();                             // PLC never sees this one
    if (settling) return;                                     // fresh off a flip → drop it whole
    const k = 0.002 * controls.pointerSpeed;                  // PLC's own delta→radians scale
    applyLook(clamp(mx, -FLICK_CAP, FLICK_CAP) * k, clamp(my, -FLICK_CAP, FLICK_CAP) * k);
  }, true);
}

/* ── adaptive hint: show whichever scheme the visitor is actually using ── */
let inputMode = null;
function setInputMode(mode){
  if (mode === inputMode) return;
  inputMode = mode;
  const L = {
    keyboard: '<b>WASD</b> / arrows move &nbsp;·&nbsp; <b>mouse</b> look &nbsp;·&nbsp; <b>E</b> / click visit &nbsp;·&nbsp; <b>Esc</b> pause',
    gamepad:  '<b>L‑stick</b> move &nbsp;·&nbsp; <b>R‑stick</b> look &nbsp;·&nbsp; <b>A</b> visit &nbsp;·&nbsp; <b>Start</b> pause',
    touch:    '<b>left stick</b> move &nbsp;·&nbsp; <b>drag</b> look &nbsp;·&nbsp; <b>tap</b> to visit',
  };
  const legend = $('legend'); if (legend) legend.innerHTML = L[mode] || L.keyboard;
  $('touch')?.classList.toggle('hidden', !(mode === 'touch' && started));
}

/* ── keyboard ── */
const keys = {};
addEventListener('keydown', e => {
  if (consoleTypeKey(e)) return;      // a lit console field owns the keyboard
  keys[e.code] = true;
  if (e.code === 'KeyE' && !e.repeat) tryLaunch();   // held E drags sliders; autorepeat must not re-press
  if (e.code !== 'Escape') setInputMode('keyboard');
});
addEventListener('keyup', e => { keys[e.code] = false; });
// mouse move → keyboard input mode + drive the custom crosshair cursor, which
// only shows on UI screens (never while pointer-locked / walking the gallery)
const crosshairEl = $('crosshair');
const lastPointer = { x: null, y: null };   // last mouse spot — seeds the pad cursor on a switch
let uiHoverEl = null;
// Lift/glow whatever the shared virtual cursor — mouse OR gamepad — is over, so a
// button enlarges exactly like a real mouseover. This is the ONLY hover path now
// (CSS :hover is dropped): the virtual cursor can sit off the real OS pointer after
// an input switch, so native :hover would light the wrong button.
function setUiHover(el){
  const target = (el && !el.disabled) ? el : null;
  if (uiHoverEl === target) return;
  uiHoverEl?.classList.remove('cursor-over');
  target?.classList.add('cursor-over');
  uiHoverEl = target;
}
const onUiScreen = () => state === 'menu' || state === 'paused';
addEventListener('mousemove', (e) => {
  if (isTouch) return;
  setInputMode('keyboard');
  if (!crosshairEl) return;
  if (controls.isLocked || !onUiScreen()){ crosshairEl.classList.remove('show'); return; }
  // The real OS pointer is authoritative for the mouse: map the virtual cursor
  // straight onto the native clientX/clientY rather than accumulating movement
  // deltas. The crosshair therefore SNAPS to wherever the mouse actually is —
  // including when the pointer leaves and re-enters from a window edge — instead
  // of drifting off after going out of bounds. (The gamepad still nudges padCursor
  // by deltas from this last spot, so a mouse→pad switch resumes from the real
  // pointer without a jump.)
  padCursor.x = clamp(e.clientX, 0, innerWidth);
  padCursor.y = clamp(e.clientY, 0, innerHeight);
  padCursor.ready = true;
  lastPointer.x = padCursor.x; lastPointer.y = padCursor.y;   // keep the seed in sync for the pad
  const over = document.elementFromPoint(padCursor.x, padCursor.y)?.closest?.('.aero-btn');
  setUiHover(over);
  crosshairEl.style.left = padCursor.x + 'px';
  crosshairEl.style.top  = padCursor.y + 'px';
  crosshairEl.classList.add('show');
  crosshairEl.classList.toggle('active', !!over);   // grow/glow over a live button
}, { passive:true });
// Route a real mouse click through the virtual cursor: after switching from the pad
// the crosshair can sit off the real OS pointer, so the native click would hit the
// wrong button (or none). If they differ, swallow it and fire whatever the crosshair
// is actually over. When they match (the common no-pad case) the native click flows
// through untouched.
addEventListener('click', (e) => {
  if (isTouch || controls.isLocked || !onUiScreen() || !padCursor.ready) return;
  const virt = document.elementFromPoint(padCursor.x, padCursor.y)?.closest?.('.aero-btn');
  const real = e.target?.closest?.('.aero-btn') || null;
  if (virt === real) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (virt && !virt.disabled) virt.click();
}, true);

/* ── gamepad ──
   One poller, called every frame (see animate). It branches on game state:
   in‑world it drives movement/look/visit/pause; on any UI screen (the entry
   splash AND the pause menu) the left stick becomes a mouse — A clicks the button
   under the cursor, B / Start leaves the pause menu. Button edge flags are shared
   across branches so a button still held while the state flips (e.g. the Start
   that opened the menu, or the A that started the realm) doesn't instantly re‑fire. */
let padIndex = null, padVisitPrev = false, padPausePrev = false, padBackPrev = false;
const padCursor = { x:0, y:0, ready:false };   // virtual mouse for the UI screens
addEventListener('gamepadconnected',   e => { padIndex = e.gamepad.index; setInputMode('gamepad'); });
addEventListener('gamepaddisconnected', e => {
  if (padIndex === e.gamepad.index){
    padIndex = null; padCursor.ready = false; setUiHover(null);   // drop the pad cursor + any pad hover
    setInputMode(isTouch ? 'touch' : 'keyboard');
  }
});
function getPad(){ return (padIndex != null && navigator.getGamepads) ? navigator.getGamepads()[padIndex] : null; }
function pollPad(dt){
  padMove.x = 0; padMove.y = 0;
  const gp = getPad(); if (!gp){ held.padA = false; return; }
  const lx = dead(gp.axes[0]||0), ly = dead(gp.axes[1]||0);
  const rx = dead(gp.axes[2]||0), ry = dead(gp.axes[3]||0);
  const aBtn = !!gp.buttons[0]?.pressed;        // A / cross
  const bBtn = !!gp.buttons[1]?.pressed;        // B / circle
  const startBtn = !!gp.buttons[9]?.pressed;    // Start / options
  held.padA = aBtn;                             // a held A keeps a slider drag alive

  // ── UI screens (entry splash + pause menu): left stick = cursor, A = click ──
  if (state === 'menu' || state === 'paused'){
    if (lx || ly || aBtn || bBtn || startBtn) setInputMode('gamepad');
    // only DRIVE the cursor while the gamepad is the active input — otherwise the
    // mouse owns the crosshair, so switching mouse↔pad never fights frame-to-frame
    if (inputMode === 'gamepad'){
      if (!padCursor.ready){                     // seed where the mouse left off (or centre) → no jump on switch
        padCursor.x = lastPointer.x ?? innerWidth / 2;
        padCursor.y = lastPointer.y ?? innerHeight / 2;
        padCursor.ready = true;
      }
      const sp = 950;                            // cursor speed, px/s at full deflection
      padCursor.x = clamp(padCursor.x + lx * sp * dt, 0, innerWidth);
      padCursor.y = clamp(padCursor.y + ly * sp * dt, 0, innerHeight);
      const over = document.elementFromPoint(padCursor.x, padCursor.y)?.closest?.('.aero-btn');
      setUiHover(over);                           // lift/glow the button under the cursor, mouseover-style
      if (crosshairEl){
        crosshairEl.style.left = padCursor.x + 'px';
        crosshairEl.style.top  = padCursor.y + 'px';
        crosshairEl.classList.add('show');
        crosshairEl.classList.toggle('active', !!uiHoverEl);   // grow/glow over a live button
      }
      if (aBtn && !padVisitPrev){                 // A → activate the button under the cursor
        if (over === $('resumeBtn')){ audio.init(); resumeGame(); }
        // gamepad start needs no pointer lock (look is on the right stick), so begin
        // play directly rather than via controls.lock(), which a pad press can't grant
        else if (over === $('enterBtn') && !over.disabled){ audio.init(); beginPlay(); }
        else if (over && !over.disabled) over.click();
      }
      if (state === 'paused' && (bBtn || startBtn) && !padBackPrev){ audio.init(); resumeGame(); }   // B / Start → leave
    }
    padVisitPrev = aBtn; padBackPrev = bBtn || startBtn; padPausePrev = startBtn;
    return;
  }

  // ── in‑world (intro / play): movement, look, visit, pause ──
  if (state === 'intro' || state === 'play'){
    if (lx || ly || rx || ry) setInputMode('gamepad');
    padMove.x = lx; padMove.y = -ly;
    if (rx || ry) applyLook(rx * (M.padLook ?? 2.6) * dt, ry * (M.padLook ?? 2.6) * dt);
    if (aBtn && !padVisitPrev) tryLaunch();
    if (startBtn && !padPausePrev) togglePause();
  }
  // edge bookkeeping every frame so transitions between states stay clean
  padVisitPrev = aBtn; padPausePrev = startBtn; padBackPrev = bBtn || startBtn;
}

/* ── touch: floating joystick (move) + drag (look) + tap/button (visit) ── */
{
  const JOY_R = 52;
  let joyId = null, joyCX = 0, joyCY = 0;
  let lookId = null, lookLX = 0, lookLY = 0, lookStart = 0, lookMoved = 0;
  let uiTouchId = null;                       // a finger acting as the menu cursor
  const joyEl = $('joy'), knobEl = $('joyKnob');
  const inJoyZone = (x, y) => x < innerWidth * 0.5 && y > innerHeight * 0.45;

  // On the menu/pause screens a finger drives the custom crosshair cursor (so it can
  // pop bubbles + light/tap the aero buttons) exactly like the mouse/gamepad cursor —
  // the camera is NOT steered there. (In-world, drag still looks around, see below.)
  function driveTouchCursor(x, y){
    padCursor.x = x; padCursor.y = y; padCursor.ready = true;
    lastPointer.x = x; lastPointer.y = y;
    if (!crosshairEl) return;
    crosshairEl.style.left = x + 'px'; crosshairEl.style.top = y + 'px';
    crosshairEl.classList.add('show');
    const over = document.elementFromPoint(x, y)?.closest?.('.aero-btn');
    setUiHover(over);
    crosshairEl.classList.toggle('active', !!over);
  }

  addEventListener('touchstart', e => {
    setInputMode('touch');
    for (const t of e.changedTouches){
      if (t.target?.closest?.('.touch-btn')) continue;   // let buttons handle their own taps
      if (onUiScreen()){                                 // menus: finger = cursor, never the camera
        if (uiTouchId === null){ uiTouchId = t.identifier; driveTouchCursor(t.clientX, t.clientY); }
        continue;
      }
      if (joyId === null && inJoyZone(t.clientX, t.clientY)){
        joyId = t.identifier; joyCX = t.clientX; joyCY = t.clientY;
        if (joyEl){ joyEl.style.left = joyCX+'px'; joyEl.style.top = joyCY+'px'; joyEl.classList.add('on'); }
        if (knobEl) knobEl.style.transform = 'translate(-50%,-50%)';
      } else if (lookId === null){
        lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
        lookStart = performance.now(); lookMoved = 0;
        held.touchLook = true;
        consoleSlideStart();      // finger down while aiming a slider → drag it
      }
    }
  }, { passive:false });

  addEventListener('touchmove', e => {
    for (const t of e.changedTouches){
      if (t.identifier === uiTouchId){ driveTouchCursor(t.clientX, t.clientY); continue; }
      if (t.identifier === joyId){
        const dx = t.clientX - joyCX, dy = t.clientY - joyCY;
        const d = Math.hypot(dx, dy), m = Math.min(d, JOY_R), a = Math.atan2(dy, dx);
        const kx = Math.cos(a)*m, ky = Math.sin(a)*m;
        if (knobEl) knobEl.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
        touchMove.x = kx / JOY_R; touchMove.y = -ky / JOY_R;
      } else if (t.identifier === lookId){
        const dx = t.clientX - lookLX, dy = t.clientY - lookLY;
        lookLX = t.clientX; lookLY = t.clientY; lookMoved += Math.abs(dx) + Math.abs(dy);
        applyLook(dx * (M.touchLook ?? 0.0045), dy * (M.touchLook ?? 0.0045));
      }
    }
    // in-world: block scroll/zoom. On the menus, let native taps through so the
    // aero buttons still fire (touch-action:none in CSS already prevents scrolling).
    if (!onUiScreen() && e.cancelable) e.preventDefault();
  }, { passive:false });

  function endTouch(e){
    for (const t of e.changedTouches){
      if (t.identifier === uiTouchId){            // finger up → drop the menu cursor
        uiTouchId = null; setUiHover(null); crosshairEl?.classList.remove('show');
        continue;
      }
      if (t.identifier === joyId){
        joyId = null; touchMove.x = 0; touchMove.y = 0;
        joyEl?.classList.remove('on');
        if (knobEl) knobEl.style.transform = 'translate(-50%,-50%)';
      } else if (t.identifier === lookId){
        held.touchLook = false;
        if (performance.now() - lookStart < 250 && lookMoved < 10) tryLaunch();   // quick tap = visit
        lookId = null;
      }
    }
  }
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);
}

/* ════════════════════════════════════════════════════════════════
   7 · SFX — Microsoft Windows 7 sounds in sfx/, © Microsoft
       Corporation, drawn from the default and Garden sound schemes.
       Every sound is a real sample now; nothing is synthesised.
   ════════════════════════════════════════════════════════════════ */
const audio = (() => {
  let ctx, master;
  const SFX = {
    press:    'sfx/Windows User Account Control.wav',  // console widget clicked
    hover:    'sfx/Windows Information Bar.wav',       // console field/button highlight
    ping:     'sfx/Windows Balloon.wav',               // slab screenshot lands (all slabs + console boot)
    droplet:  'sfx/Windows Balloon.flac',              // facing a fresh panel
    pop:      'sfx/Speech Disambiguation.wav',         // menu bubble popped
    intro:    'sfx/Windows Logon Sound.flac',          // Enter → the glide in
    launch:   'sfx/Windows Print complete.flac',       // slab clicked → launch swoop
    publish:  'sfx/Windows Notify.flac',               // the make-your-gallery buttons (publish steps 2 & 3)
    resume:   'sfx/Windows Pop-up Blocked.flac',       // pause menu closes
    pause:    'sfx/notify.wav',                        // pause menu opens
  };
  // fetch the bytes immediately (network needs no gesture); decode waits for
  // the first init(), when the gesture-unlocked AudioContext exists
  const raw = {}, decoded = {}, bufs = {};
  for (const [k, url] of Object.entries(SFX))
    raw[k] = fetch(url).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
  function init(){
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = CONFIG.volume ?? 0.6;
    master.connect(ctx.destination);
    for (const k of Object.keys(raw))
      decoded[k] = raw[k].then(ab => ab ? ctx.decodeAudioData(ab) : null)
                         .then(b => (bufs[k] = b)).catch(() => null);
  }

  // ── 3D placement: turn a world position into a {pan, gain} for that source ──
  // Far sources are quieter (distance attenuation) and sources off to one side
  // play louder in that ear (stereo pan). Panels are mounted on the left/right
  // glass walls, so this makes a left-wall ding ring from the left speaker and a
  // distant panel down the hall fade into the background — cheap faux-3D sound.
  const _ear = new THREE.Vector3(), _fwd = new THREE.Vector3(),
        _right = new THREE.Vector3(), _to = new THREE.Vector3();
  function place(pos){
    if (!pos || !camera) return { pan: 0, gain: 1 };
    camera.getWorldPosition(_ear);
    _to.copy(pos).sub(_ear);
    const dist = _to.length();
    // full volume within ~3 m, fading to a faint 0.16 by ~30 m down the corridor
    const gain = clamp(1 - (dist - 3) / 30, 0.16, 1);
    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, camera.up).normalize();      // camera's right axis
    const pan = clamp((dist > 0.0001 ? _to.divideScalar(dist).dot(_right) : 0), -1, 1) * 0.9;
    return { pan, gain };
  }

  // ── sample player: drop a decoded file into the stereo field ──
  const live = {};   // last-started source per sample, so a new sound can cut an old one
  function start(buf, pos, peak, name){
    const src = ctx.createBufferSource(); src.buffer = buf;
    const sp = pos ? place(pos) : null;
    const g = ctx.createGain(); g.gain.value = peak * (sp ? sp.gain : 1);
    src.connect(g); let tail = g;
    if (sp && ctx.createStereoPanner){
      const p = ctx.createStereoPanner(); p.pan.value = sp.pan;
      g.connect(p); tail = p;
    }
    tail.connect(master); src.start();
    live[name] = src;
  }
  function stopBuf(name){
    try { live[name]?.stop(); } catch { /* already ended */ }
    live[name] = null;
  }
  function playBuf(name, pos, peak = 1){
    if (!ctx) return;
    if (bufs[name]) { start(bufs[name], pos, peak, name); return; }
    // the very first plays can race the decode — let a just-late sample still
    // fire, but never an ancient one
    const t0 = performance.now();
    decoded[name]?.then(b => { if (b && performance.now() - t0 < 1200) start(b, pos, peak, name); });
  }
  // console volume slider drives the master gain live
  function setVolume(v){ if (master) master.gain.value = clamp(v, 0, 1); }
  return {
    init, setVolume,
    press:       ()  => playBuf('press', null, 0.9),
    hover:       ()  => playBuf('hover', null, 0.65),
    publish:     ()  => playBuf('publish', null, 0.9),
    ping:        pos => playBuf('ping', pos),
    droplet:     pos => playBuf('droplet', pos, 0.8),
    pop:         pos => playBuf('pop', pos, 0.875),
    intro:       ()  => playBuf('intro'),
    launch:      ()  => playBuf('launch'),
    // pause and resume interrupt each other — a quick close cuts the open
    // chime instead of stacking on top of it, and vice versa
    pauseOpen:   ()  => { stopBuf('resume'); playBuf('pause', null, 0.9); },
    resumeClick: ()  => { stopBuf('pause'); playBuf('resume', null, 0.9); },
  };
})();
// unlock the AudioContext on the first user gesture so menu bubble-pops have sound
// before the visitor ever clicks Enter (browsers gate audio behind a real gesture)
addEventListener('pointerdown', () => audio.init(), { once:true });

/* ════════════════════════════════════════════════════════════════
   8 · state machine: enter → intro swoop → play → launch swoop
   ════════════════════════════════════════════════════════════════ */
let state = 'menu';
let introT = 0;
let launch = null;
let activeFrame = null, lastActive = null, lastCanVisit = false;
let started = false;

function beginPlay(){
  if (started) return;
  started = true;
  galleryStartTime = performance.now() / 1000;   // seconds from page load
  setUiHover(null);                              // clear any button hover left by the cursor
  crosshairEl?.classList.remove('show');         // drop the menu cursor (gamepad start has no pointer-lock event)
  $('enter').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('fade').style.opacity = '1';
  requestAnimationFrame(() => { $('fade').style.opacity = '0'; });
  audio.intro();
  // start elevated + at the entrance; the intro glides forward + descends while
  // letting you look and steer freely (no hard-scripted hold)
  player.position.set(0, INTRO_START_Y, -6);
  velocity.set(0, 0, 0);
  state = 'intro'; introT = 0;
  if (inputMode === 'touch') $('touch')?.classList.remove('hidden');
}
function startExperience(){
  audio.init();
  if (isTouch) beginPlay();          // touch: no pointer lock
  else controls.lock();              // desktop / gamepad: pointer lock → 'lock' begins play
}
let pausedFrom = 'play';
// publish buttons that open a second tab drop pointer lock, which auto-pauses
// the page — that pause should arrive silently, not chime over the new tab
let pauseHushUntil = 0;
function pauseGame(){
  // pausable during the entry glide too (Esc during the whoosh used to no-op and
  // leave you stranded with the cursor showing and no menu)
  if (state !== 'play' && state !== 'intro') return;
  pausedFrom = state;
  if (performance.now() > pauseHushUntil) audio.pauseOpen();
  state = 'paused';                         // freezes movement (loop skips intro/play)
  padCursor.ready = false;                  // gamepad cursor re-centres each time the menu opens
  $('pause').classList.remove('hidden');
  $('hud').classList.add('hidden');         // remove hint / on-screen controls
  $('prompt').classList.remove('show');
}
function resumeGame(){
  if (!started) return;
  if (state === 'paused') audio.resumeClick();   // only when the menu is actually up
  state = pausedFrom;                        // continue the glide, or back to play
  setUiHover(null);                          // clear any button hover left by the cursor
  crosshairEl?.classList.remove('show');     // drop the menu cursor (gamepad path has no pointer-lock event)
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
}
function togglePause(){
  if (state === 'play' || state === 'intro') pauseGame();
  else if (state === 'paused') resumeGame();
}

/* ════════════════════════════════════════════════════════════════
   8b · loading orchestration
       noise → Aero bar → live screenshot + name bloop
   ════════════════════════════════════════════════════════════════ */
function startFrameLoading(f){
  const u = f.userData;
  if (u.loadState !== 'pending') return;
  u.loadState = 'loading';
  // pre-fetch cache first: the screenshots render the moment the PAGE loads
  // (see preFetchScreenshots — GPU-uploaded during the menu), so by ping time
  // they're usually done — AUTO frames reveal NOW, no bar, no fixed-duration
  // theater; a bar on them only means a fetch genuinely still in flight.
  // GAZE frames are the exception: their reveal answers the player's look,
  // so they always play the bar (GAZE_LOAD_DUR) before popping — see
  // updateLoadingSystem, which holds their reveal until the bar completes.
  const ready = prefetchMap.get(u.project.url);
  if (ready !== 'pending' && u.loadTrigger !== 'gaze'){
    u.liveTexture = (ready instanceof THREE.Texture) ? ready : null;
    u.imageReady = true;
    if (!u.liveTexture){ u.screenMat.map = loadBackdropTex; u.screenMat.needsUpdate = true; }  // failed fetch → clean backdrop
    revealWorld(f);
    return;
  }
  // lazy-alloc the strip (canvas + texture + plane): only panels actually
  // mid-cutscene hold one — revealWorld frees it again
  if (!u.strip){
    u.stripCanvas = makeStripCanvas();
    u.stripTex = new THREE.CanvasTexture(u.stripCanvas);
    u.stripTex.colorSpace = THREE.SRGBColorSpace;
    // repainted ~30×/s — regenerating a mip chain on every upload would waste
    // most of what the small canvas saves; plain linear stays sharp
    u.stripTex.generateMipmaps = false;
    u.stripTex.minFilter = THREE.LinearFilter;
    const m = new THREE.MeshBasicMaterial({
      map: u.stripTex, transparent: true, depthWrite: false, toneMapped: false,
    });
    if (FX) m.color.setScalar(1.12);   // same ACES lift as the screens
    u.strip = new THREE.Mesh(stripGeo, m);
    u.strip.position.set(0, 0, stripZ);
    u.strip.renderOrder = 4;           // over its panel, under the name plaque
    f.add(u.strip);
  }
  u.lastBarPaint = -1;
  // panel behind the strip: the shared white/black + Aero-tint backdrop
  u.screenMat.map = loadBackdropTex;
  u.screenMat.needsUpdate = true;
  drawLoadingStrip(u.stripCanvas, 0, 0); u.stripTex.needsUpdate = true;
  // still fetching — updateLoadingSystem polls every frame and reveals on arrival
}

function revealWorld(f){
  const u = f.userData;
  if (u.loadState === 'done') return;
  u.loadState = 'done';
  // Swap in the live screenshot and SNAP the panel to the screenshot's true
  // aspect so the whole page shows, filling it without a crop. On a failed
  // fetch the shared backdrop stays — a clean blank screen, no dead texture.
  // (Never dispose the current map here: it's the SHARED loadBackdropTex.)
  if (u.liveTexture){
    u.screenMat.map = u.liveTexture; u.screenMat.needsUpdate = true;
    fitPanelToImage(u, u.liveTexture);
  }
  // Free the strip + canvas textures — not needed anymore
  if (u.strip){
    f.remove(u.strip);
    u.strip.material.dispose();      // strip geometry is shared — keep it
    u.strip = null;
  }
  u.stripTex?.dispose?.(); u.stripTex = null; u.stripCanvas = null;
  u.whiteTex?.dispose?.(); u.whiteTex = null;
  // Trigger name-plaque bloop — the balloon ping rings from the panel's spot
  // on its wall, one sound for every slab
  u.labelBloop = 0;
  audio.ping(u.worldPos);
}

function updateLoadingSystem(dt, t){
  if (!galleryStartTime) return;
  const elapsed = performance.now() / 1000 - galleryStartTime;
  for (const f of frames){
    const u = f.userData;
    if (u.loadState === 'done') continue;
    if (u.loadState === 'pending'){
      // gaze frames (the west wall + the last row) fire ONLY from the
      // player's look; auto frames ONLY from the pair clock — looking at a
      // panel never hurries its ping
      if (u.loadTrigger === 'gaze' ? f === activeFrame : elapsed >= u.autoDelay){
        startFrameLoading(f); continue;
      }
      // pending state = solid white, nothing to animate
    }
    if (u.loadState === 'loading'){
      // auto frames: a bar here means the fetch is genuinely still in flight
      // (the ready path revealed inside startFrameLoading) — poll the cache
      // and reveal the MOMENT it settles, no artificial wait, no watch-me
      // speedup. Gaze frames ride the bar to FULL first — their reveal is a
      // played cutscene — then take whatever the cache has settled to.
      const cached = prefetchMap.get(u.project.url);
      const settled = cached !== 'pending';
      // the bar may only claim 100% once the network has delivered; short of
      // that it eases toward — and holds just under — full
      u.loadProgress = Math.min(settled ? 1 : 0.95, u.loadProgress + dt / u.loadDuration);
      if (settled && (u.loadTrigger !== 'gaze' || u.loadProgress >= 1)){
        u.liveTexture = (cached instanceof THREE.Texture) ? cached : null;
        u.imageReady = true;
        revealWorld(f); continue;
      }
      // repaint at ~30 Hz — the pole drifts slowly enough that half-rate reads
      // as smooth, and it halves the strip's repaint + GPU upload cost
      if (t - u.lastBarPaint >= 1/32){
        u.lastBarPaint = t;
        drawLoadingStrip(u.stripCanvas, u.loadProgress, t); u.stripTex.needsUpdate = true;
      }
    }
  }
}

// back to the entry card (used when returning via the browser Back button, which
// would otherwise restore a frozen mid-swoop white screen = a "blank realm")
function resetToMenu(){
  launch = null; state = 'menu'; started = false;
  padCursor.ready = false;                    // gamepad cursor re-centres on the splash
  $('fade').style.opacity = '0';
  $('enter').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('touch')?.classList.add('hidden');
  $('prompt')?.classList.remove('show');
  player.position.set(0, eyeHeight, -6);
  camera.lookAt(0, eyeHeight, 10);
}

controls.addEventListener('lock', () => {
  $('pause').classList.add('hidden');
  crosshairEl?.classList.remove('show');     // clear the menu cursor while in-game
  if (!started) beginPlay(); else resumeGame();
});
controls.addEventListener('unlock', () => { if (state === 'launching') return; pauseGame(); });

$('enterBtn').addEventListener('click', startExperience);
$('resumeBtn').addEventListener('click', () => {
  audio.init();
  if (isTouch) resumeGame();
  else controls.lock();                     // desktop: re-lock → 'lock' handler resumes
});
$('pauseBtn')?.addEventListener('click', e => { e.preventDefault(); togglePause(); });

// desktop click inside the world = visit the active frame. If a gamepad/touch
// session started us without pointer lock, the first click instead engages
// mouse-look (a click IS a user gesture, so the lock succeeds) — letting you
// switch from pad to mouse mid-walk with no hitch.
renderer.domElement.addEventListener('click', () => {
  if (controls.isLocked){ tryLaunch(); return; }
  if (!isTouch && state === 'play') controls.lock();
});
// middle-click = force a new tab, like real links: it overrides the owner's
// openInNewTab setting for this one visit. click never fires for button 1 —
// the wheel press arrives as auxclick — and the mousedown preventDefault
// keeps the browser's autoscroll widget out of the hall.
renderer.domElement.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
renderer.domElement.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  e.preventDefault();
  if (controls.isLocked) tryLaunch(true);
});

function tryLaunch(forceTab = false){
  if (consolePress()) return;           // aiming at the back-wall console → press it
  if (state !== 'play' || !activeFrame || launch) return;
  if (activeFrame.userData.loadState !== 'done') return;   // world still loading
  const f = activeFrame;
  state = 'launching';
  audio.launch();
  $('prompt').classList.remove('show');

  const dir = new THREE.Vector3(Math.sin(f.rotation.y), 0, Math.cos(f.rotation.y));
  const toPos = f.position.clone().add(dir.multiplyScalar(2.3)); toPos.y = eyeHeight;
  const tmp = new THREE.Object3D(); tmp.position.copy(toPos);
  tmp.lookAt(f.position.x, eyeHeight, f.position.z);

  launch = {
    frame:f, t:0, forceTab,
    fromPos: player.position.clone(),
    toPos,
    fromQuat: camera.quaternion.clone(),
    toQuat: tmp.quaternion.clone(),
  };
  $('fade').style.opacity = '1';
}

/* ════════════════════════════════════════════════════════════════
   9 · the loop
   ════════════════════════════════════════════════════════════════ */
const clock = new THREE.Clock();
let bobPhase = 0, smoothSpeed = 0;
let sunGazeT = 0, tipsFaded = false;     // gaze at the sun for 2s → control tips fade away
const _gazeDir = new THREE.Vector3();
function updateSunGaze(dt){
  if (tipsFaded || !started || state === 'menu') return;
  camera.getWorldDirection(_gazeDir);
  sunGazeT = (_gazeDir.dot(SUN_DIR) > 0.986) ? sunGazeT + dt : 0;   // looking near the sun disk
  if (sunGazeT >= 2){
    tipsFaded = true;
    const lg = $('legend');
    if (lg){ lg.style.transition = 'opacity 1.4s ease'; lg.style.opacity = '0'; }
  }
}
function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  const t  = clock.elapsedTime;

  if (skyMat) skyMat.uniforms.uTime.value = t;
  if (moteMat) moteMat.uniforms.uTime.value = t;
  if (gradePass) gradePass.uniforms.uTime.value = t;
  perfGovern(dt);              // dynamic resolution: trade pixels for a locked frame rate
  pollPad(dt);                 // every frame — also drives the pause‑menu cursor
  updateLoadingSystem(dt, t);
  updateConsole();             // back-wall console: aim, hover, repaint
  updateSunGaze(dt);

  // Name-plaque bloop-in: scale 0.01→1.22→1.0 with overshoot, opacity 0→1
  for (const f of frames){
    const u = f.userData;
    if (u.labelBloop < 0 || u.labelBloop >= 1) continue;
    u.labelBloop = Math.min(1, u.labelBloop + dt * 3.0);
    const lb = u.labelBloop;
    const scl = lb < 0.65 ? (lb/0.65)*1.22 : 1.22 - ((lb-0.65)/0.35)*0.22;
    u.label.scale.setScalar(Math.max(0.01, scl));
    u.label.material.opacity = Math.min(1, lb * 2.5);
  }

  updateBubbleShine();   // bubble hot-spots follow the sun glare as the camera turns

  // On the menu/pause screens the custom cursor pops any bubble it touches: a quick
  // splash (expand + fade) and a placed "pop" blip, then the bubble respawns.
  const popping = onUiScreen() && crosshairEl?.classList.contains('show');
  if (popping) _camRight.setFromMatrixColumn(camera.matrixWorld, 0);   // world right axis
  for (const b of bubbles){
    const u = b.userData;
    if (u.popT > 0){                                  // splash in progress
      u.popT += dt;
      const p = u.popT / 0.24;
      if (p >= 1){ resetBubble(b, false); u.popT = 0; b.material.opacity = 1; }
      else { const s = u.baseScale * (1 + p*1.2); b.scale.set(s, s, 1); b.material.opacity = 1 - p; }
      continue;
    }
    if (popping){                                     // screen-space cursor-contact test
      _bv.copy(b.position).project(camera);
      if (_bv.z <= 1){
        const sx = (_bv.x*0.5+0.5)*innerWidth, sy = (-_bv.y*0.5+0.5)*innerHeight;
        _bv2.copy(b.position).addScaledVector(_camRight, b.scale.x*0.5).project(camera);
        const r = Math.abs((_bv2.x*0.5+0.5)*innerWidth - sx) + 5;   // projected bubble radius (+fudge)
        const dx = padCursor.x - sx, dy = padCursor.y - sy;
        if (dx*dx + dy*dy <= r*r){
          u.baseScale = b.scale.x; u.popT = 0.0001;   // arm the splash
          audio.pop(b.position);
          continue;
        }
      }
    }
    b.position.y += u.speed * dt;
    b.position.x += Math.sin(t*0.6 + u.sway) * 0.12 * dt;
    if (b.position.y > 16) resetBubble(b, false);
  }

  if (state === 'intro'){
    introT = Math.min(1, introT + dt/INTRO_DUR);
    const e = easeOut(introT);
    // glide forward (auto-walk that fades out) while you look + steer freely…
    const autoFwd = (1 - e) * 0.9;
    moveAndInteract(dt, t, autoFwd);
    // …and descend onto the floor as a height-only blend (doesn't fight your input)
    const o = player;
    o.position.y = lerp(INTRO_START_Y, o.position.y, e);
    if (introT >= 1) state = 'play';
  }
  else if (state === 'play'){
    moveAndInteract(dt, t);
  }
  else if (state === 'launching' && launch){
    launch.t = Math.min(1, launch.t + dt/1.15);
    const e = easeIO(launch.t);
    player.position.lerpVectors(launch.fromPos, launch.toPos, e);
    camera.quaternion.slerpQuaternions(launch.fromQuat, launch.toQuat, e);
    camera.position.y = eyeHeight;
    if (launch.t >= 1){
      const url = withProtocol(launch.frame.userData.project.url);
      const toTab = CONFIG.openInNewTab || launch.forceTab;   // wheel-click forces the tab
      launch = null;
      if (toTab){ window.open(url, '_blank'); $('fade').style.opacity='0'; state='play'; if(!isTouch) controls.lock(); }
      else window.location.href = url;
    }
  }

  // animate the "visit?" text on every frame. Camera world-pos is computed ONCE
  // here, and each frame's world position is read from the cached u.worldPos (the
  // groups never move) — so we skip a per-frame matrix decompose and the two
  // Vector3 allocations per panel that used to churn the GC each frame.
  camera.getWorldPosition(_camWorld);
  // ── the ONE breath every active-frame animation rides ──
  // A full 0→1→0 swing: at the trough the glow is truly GONE (emissive back at
  // the 0.22 resting tint, under the bloom threshold — no halo), the badge
  // swell is fully relaxed and the visit? hover sits back at baseY; at the
  // peak all of them are at full — always in step, never out of phase.
  const pulse = 0.5 + 0.5*Math.sin(t*2.2);   // calm ~2.9s breath (3.4 blinked)
  for (const f of frames){
    const u = f.userData;
    const target = (f === activeFrame && state === 'play' && u.loadState === 'done') ? 1 : 0;
    u.scale = lerp(u.scale, target, 1 - Math.pow(0.001, dt));
    const s = u.scale < 0.002 ? 0.001 : u.scale;
    u.visit.scale.setScalar(s);
    const fw = u.worldPos;
    const yaw = Math.atan2(_camWorld.x - fw.x, _camWorld.z - fw.z) - f.rotation.y;
    u.visit.rotation.y = yaw;

    // u.scale (the approach 0→1) is the envelope on the shared breath, so the
    // badge swell + hover fade in on approach / out on leave at the same pace
    const breath = pulse * u.scale;
    u.visit.position.y = u.visit.userData.baseY + 0.05 * breath;
    // visit? glow: held OUT of the idle breath — it answers the CLICK instead.
    // Choosing a world starts the launch swoop and visit? shrinks away; the
    // halo tapers on as easeIO of that very shrink, so the flare and the
    // shrink are locked to one motion — the visitor activates the glow by
    // choosing. EMISSIVE, so it reads from any angle; the peak (2.32) sits
    // over the bloom threshold (1.2) on purpose. Walking away (no click)
    // shrinks the text with the glow held at the 0.22 resting tint.
    const chosen = launch && launch.frame === f;
    u.visit.material.emissiveIntensity =
      0.22 + (FX ? 2.1 : 0.65) * (chosen ? easeIO(1 - u.scale) : 0);

    // name plaque "hover": swell + lift ride the same breath as the glow.
    // Brightness alone stays steady while active (clamped under bloom, 1.2) —
    // the constant "you're at this world" cue between breaths.
    if (u.labelBloop >= 1){
      u.label.scale.setScalar(1 + 0.16 * breath);
      u.label.position.y = u.labelBaseY + 0.085 * breath;
      let b = (FX ? LABEL_LIFT : 1) * (1 + 0.24 * u.scale);
      if (FX) b = Math.min(b, 1.19);
      u.label.material.color.setRGB(b, b, b);
    }
  }

  if (composer){
    composer.render();
    if (flareScene){                       // flare on top of the graded frame
      renderer.autoClear = false;
      renderer.clearDepth();               // grade pass wrote depth; reset so the
      renderer.render(flareScene, camera); // flare's occlusion quad isn't culled
      renderer.autoClear = true;
    }
  }
  else renderer.render(scene, camera);
}

function moveAndInteract(dt, t, autoFwd = 0){
  // (gamepad is polled once per frame at the top of animate, before this runs)

  // unified analog move vector: keyboard + joystick + gamepad (+ intro auto-glide)
  moveInput.x = (keys.KeyD||keys.ArrowRight?1:0) - (keys.KeyA||keys.ArrowLeft?1:0);
  moveInput.y = (keys.KeyW||keys.ArrowUp?1:0)    - (keys.KeyS||keys.ArrowDown?1:0);
  _moveDir.set(
    moveInput.x + touchMove.x + padMove.x,
    0,
    moveInput.y + touchMove.y + padMove.y + autoFwd
  );
  if (_moveDir.lengthSq() > 1) _moveDir.normalize();   // keep analog magnitudes < 1, cap diagonals

  // damped acceleration → smooth, never jittery. The console's movement-speed
  // multiplier scales accel and top speed together, so time-to-max (the feel)
  // stays the same while the pace changes
  const spMul = M.speed ?? 1, vMax = M.maxSpeed * spMul;
  velocity.x -= velocity.x * M.friction * dt;
  velocity.z -= velocity.z * M.friction * dt;
  if (_moveDir.lengthSq() > 0){
    velocity.x += _moveDir.x * M.accel * spMul * dt;
    velocity.z += _moveDir.z * M.accel * spMul * dt;
  }
  const sp = Math.hypot(velocity.x, velocity.z);
  if (sp > vMax){ velocity.x *= vMax/sp; velocity.z *= vMax/sp; }

  controls.moveRight(velocity.x * dt);
  controls.moveForward(velocity.z * dt);

  const o = player;
  o.position.x = clamp(o.position.x, -(WALL_X-0.7), WALL_X-0.7);
  o.position.z = clamp(o.position.z, PLAT_Z0+1, PLAT_Z1-1);
  // gentle, speed-scaled head-bob (smoothed so it never snaps)
  smoothSpeed = lerp(smoothSpeed, Math.min(sp/vMax, 1), 1 - Math.pow(0.0001, dt));
  bobPhase += dt * 6.2 * smoothSpeed;
  o.position.y = eyeHeight + Math.sin(bobPhase) * 0.012 * smoothSpeed;

  // active frame = the panel your gaze crosshair (screen centre) actually lands
  // ON — its slab OR the name badge above it — within reach. A true centre-screen
  // raycast, the same invisible cursor the console slab uses, replaces the old
  // facing cone: a panel only arms when you're looking straight at it, and backing
  // away drops it once it slides out of reach.
  camera.getWorldDirection(_lookFwd);
  activeFrame = null;
  // rebuild the raycast target list only when the hall's panel count changes
  if (_visitTargets.length !== frames.length * 2){
    _visitTargets.length = 0;
    for (const f of frames) _visitTargets.push(f.userData.panel, f.userData.label);
  }
  // looking up over the glass walls (at sky/landscape) can't hit a panel anyway —
  // a cheap early-out that skips the raycast entirely
  if (_lookFwd.y <= 0.55){
    _visitRay.setFromCamera(_screenCentre, camera);
    // intersections come back nearest-first; take the first whose panel is still
    // within the planar reach — 4.20 units, close to the glass
    for (const hit of _visitRay.intersectObjects(_visitTargets, false)){
      const f = hit.object.userData.frame;
      const dx = f.position.x - o.position.x, dz = f.position.z - o.position.z;
      if (Math.hypot(dx, dz) <= 4.20){ activeFrame = f; break; }
    }
  }
  const canVisit = !!(activeFrame && activeFrame.userData.loadState === 'done');
  if (activeFrame !== lastActive || canVisit !== lastCanVisit){
    const sameFrame = activeFrame === lastActive;
    lastActive = activeFrame; lastCanVisit = canVisit;
    // no in-game crosshair — the centre of the view stays clear
    if (!activeFrame) $('prompt').classList.remove('show');
    if (canVisit){
      if (!sameFrame) audio.droplet(activeFrame.userData.worldPos);   // droplet from the panel you faced
      // Mobile shows no badge/button — you just tap the floating 3D "visit?" text.
      // Desktop keeps the "visit <name>" pill as the click/E affordance.
      if (!isTouch){
        $('prompt').textContent = `visit  ${activeFrame.userData.project.name}`;
        $('prompt').classList.add('show');
      }
    } else {
      $('prompt').classList.remove('show');
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   10 · boot
   ════════════════════════════════════════════════════════════════ */
addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  gradePass?.uniforms.uRes.value.set(innerWidth * BASE_PR * resScale, innerHeight * BASE_PR * resScale);
});

// returning to the gallery via the browser Back button (bfcache restore) lands
// on the entry screen again, not a frozen white/blank realm
addEventListener('pageshow', (e) => { if (e.persisted) resetToMenu(); });

// browser-tab title — configurable like everything else; "" keeps index.html's
if (CONFIG.tabTitle) document.title = CONFIG.tabTitle;
// splash + pause lines are all configurable; an empty string ("") in CONFIG
// removes that line from the card entirely instead of leaving a blank row.
// Hiding goes through the .gone class so the stylesheet can re-balance the
// card's spacing around whichever lines remain (see styles.css).
function setLine(id, text){
  const el = $(id); if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('gone', !text);
}
setLine('title',      CONFIG.title);
setLine('subtitle',   CONFIG.subtitle);
setLine('loadnote',   CONFIG.loadingNote ?? 'Loading the world…');
setLine('pauseTitle', CONFIG.pause?.title ?? 'Paused');
setLine('pauseNote',  CONFIG.pause?.note  ?? 'Take a breath.');
$('resumeBtn').textContent = CONFIG.pause?.resume || 'Resume';
// entrance button is just the owner's handle (CONFIG.creator) — the one breadcrumb
// a new owner edits after cloning (or a future sign-up Worker writes)
$('enterBtn').textContent = CONFIG.creator;

// Keep the handle on ONE centered line: shrink the font until the label fits
// the pill's width (a long name on a narrow portrait phone would otherwise wrap).
function fitEnterBtn(){
  const b = $('enterBtn'); if (!b) return;
  let size = 20;                                   // CSS base size
  b.style.fontSize = size + 'px';
  let guard = 0;
  while (b.scrollWidth > b.clientWidth + 0.5 && size > 10 && guard++ < 80){
    size -= 0.5; b.style.fontSize = size + 'px';
  }
}
fitEnterBtn();
document.fonts?.ready?.then(fitEnterBtn);          // re-fit once Quicksand loads
addEventListener('resize', fitEnterBtn);

setInputMode(isTouch ? 'touch' : 'keyboard');

new FontLoader().load(
  'https://unpkg.com/three@0.180.0/examples/fonts/helvetiker_bold.typeface.json',
  (font) => {
    buildGallery(font);
    buildConsole();                          // back-wall config console (before the one-shot shadow bake)
    renderer.shadowMap.needsUpdate = true;   // render the static shadow map once, now that all casters exist
    setLine('loadnote', (CONFIG.readyNote ?? '{n} worlds ready')
      .replace('{n}', PANEL_COUNT));   // corridor + hung end walls — what's actually in the hall
    $('enterBtn').disabled = false;
    renderer.setAnimationLoop(animate);      // renderer-managed loop (pauses cleanly with the tab)
  },
  undefined,
  () => fatal('Could not load the 3D font (check your internet connection).')
);

function fatal(msg){
  const o = $('oops'); if (!o) return;
  $('oopsmsg').textContent = msg;
  o.classList.remove('hidden');
  $('enter')?.classList.add('hidden');
}

// tiny inspection handle for devtools/tooling (everything above is module-scoped)
window.__realm = {
  renderer, composer, scene, camera, clock, frames,
  get resScale(){ return resScale; },
  renderOnce(){
    if (skyMat) skyMat.uniforms.uTime.value = clock.elapsedTime;
    if (composer){
      composer.render();
      if (flareScene){ renderer.autoClear = false; renderer.clearDepth(); renderer.render(flareScene, camera); renderer.autoClear = true; }
    } else renderer.render(scene, camera);
  },
};
