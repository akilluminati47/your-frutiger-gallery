import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
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
   1 · detect the VISITOR'S display → frame aspect + screenshot size
   ════════════════════════════════════════════════════════════════ */
const realDpr = window.devicePixelRatio || 1;
const ASPECT  = window.screen.width / window.screen.height || 16 / 9;
let SHOT_W = Math.round(window.screen.width  * realDpr);
let SHOT_H = Math.round(window.screen.height * realDpr);
const CAP = 1920;                              // screenshot services cap width
if (SHOT_W > CAP) { SHOT_H = Math.round(SHOT_H * CAP / SHOT_W); SHOT_W = CAP; }

// what kind of inputs does this device have?
const isTouch = matchMedia('(pointer: coarse)').matches
             || (navigator.maxTouchPoints || 0) > 0
             || 'ontouchstart' in window;
const lowPerf = isTouch;                        // mobiles get a lighter reflection budget

function withProtocol(u){ return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

function screenshotURL(url, w, h){
  const full = withProtocol(url);
  const enc  = encodeURIComponent(full);
  // every provider is asked for the VISITOR's exact viewport (w×h) and given a
  // few seconds to finish loading, so the capture is the visitor's aspect ratio
  // and fully painted rather than a half-loaded frame.
  switch (CONFIG.screenshotProvider){
    case 'mshots':
      return `https://s.wordpress.com/mshots/v1/${enc}?w=${w}&h=${h}&vpw=${w}&vph=${h}`;
    case 'microlink':
      return `https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`
           + `&viewport.width=${w}&viewport.height=${h}&viewport.deviceScaleFactor=1`
           + `&waitUntil=networkidle2&meta=false`;
    case 'thumio':
    default:
      // width + crop/height + viewportWidth → exact device aspect; wait → full asset load
      return `https://image.thum.io/get/width/${w}/crop/${h}/viewportWidth/${w}/wait/8/noanimate/${full}`;
  }
}

/* ════════════════════════════════════════════════════════════════
   2 · renderer / scene / camera
   ════════════════════════════════════════════════════════════════ */
let renderer, scene, camera, controls;
const eyeHeight = 1.66;          // standing eye height of a ~5'10" visitor

try {
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
} catch (e){ fatal('Your browser/GPU could not start WebGL.'); throw e; }

renderer.setPixelRatio(Math.min(realDpr, lowPerf ? 1.5 : 2));   // fewer fragments on retina phones
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

scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xd7f1ff, 0.0052);   // gentle haze so the green hills still read at the horizon

camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, eyeHeight, -6);
camera.lookAt(0, eyeHeight, 10);

// studio reflections for the glossy glass frames / text
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* ════════════════════════════════════════════════════════════════
   3 · world — layout, premium sky, light, hills, glass corridor
   ════════════════════════════════════════════════════════════════ */
const bubbles = [];
// decorative objects that are SKIPPED inside the mirror passes (they barely show
// in a faint reflection but cost a full extra draw in each of the 3 reflectors)
const noReflect = [];

// gallery + corridor footprint (everything below is derived from this)
const GROUND_Y = -8;                    // grassy world far beneath the glass
const HALF = 4.7, DZ = 7.2, START_Z = 9;
const FH = 2.4, FW = FH * ASPECT, FRAME_Y = eyeHeight;   // frames float at eye level
const ROWS  = Math.ceil(CONFIG.projects.length / 2);
const END_Z = START_Z + (ROWS - 1) * DZ;

const WALL_X  = HALF + 2.0;             // glass side walls
const FRAME_X = WALL_X - 0.12;          // frames hang pressed flat against the glass walls
const WALL_H  = 4.8;                    // taller: leaves a title-padding band above each panel
const PLAT_Z0 = -7, PLAT_Z1 = END_Z + 7;
const DESK_CZ = (PLAT_Z0 + PLAT_Z1) / 2;
const DESK_W  = (WALL_X + 1.0) * 2;
const DESK_D  = PLAT_Z1 - PLAT_Z0;

const SUN_DIR = new THREE.Vector3(-22, 58, -70).normalize();   // sun beams from up & behind you

/* ── premium sky dome: gradient + sun glow + animated FBM clouds ── */
let skyMat;
{
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

        // sun disk + soft halo
        float sd  = max(dot(dir, normalize(sunDir)), 0.0);
        float disk = smoothstep(0.9972, 0.9991, sd);
        float halo = pow(sd, 90.0)*0.55 + pow(sd, 11.0)*0.16;
        sky += sunCol * (disk*1.5 + halo);

        // animated FBM clouds — kept high so the horizon projection never stretches
        // the noise into streaks; two layers give a soft faux-volumetric puffiness
        float above = smoothstep(0.12, 0.42, dir.y);
        vec2 uv = dir.xz / max(dir.y, 0.24) * 0.5;
        uv += vec2(uTime*0.010, uTime*0.004);
        float dens = fbm(uv)*0.7 + fbm(uv*2.1 + 7.0)*0.3;
        float cov  = smoothstep(0.46, 0.82, dens) * above;
        // shade the base of each puff a touch darker for depth
        vec3 cloudCol = mix(vec3(0.70,0.79,0.91), vec3(1.0), smoothstep(0.30,0.92,dens));
        cloudCol += sunCol * halo * 0.5;
        sky = mix(sky, cloudCol, cov*0.9);

        // dither to kill 8-bit banding
        sky += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(sky, 1.0);
      }`
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat));
}

// lighting: soft sky/grass hemisphere + warm Vista sun
const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9fd886, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeccb, 2.25);
sun.position.copy(SUN_DIR.clone().multiplyScalar(95));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;   sun.shadow.camera.bottom = -50;
sun.shadow.bias = -0.0004;
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

  const lf = new Lensflare();
  lf.addElement(new LensflareElement(texGlow, 340, 0,    new THREE.Color(0xfff0cf)));
  lf.addElement(new LensflareElement(texGhost, 46, 0.18));
  lf.addElement(new LensflareElement(texGhost, 72, 0.34));
  lf.addElement(new LensflareElement(texGhost, 120, 0.5));
  lf.addElement(new LensflareElement(texGhost, 58, 0.64));
  lf.addElement(new LensflareElement(texGhost, 94, 0.8));
  lf.addElement(new LensflareElement(texGlow, 130, 1.0,  new THREE.Color(0xcfe6ff)));
  lf.position.copy(SUN_DIR.clone().multiplyScalar(460));   // sit on the sky-shader sun
  scene.add(lf);
  noReflect.push(lf);                                       // never reflect the flare
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
  const target = 'blendOverlay( base.rgb, color ), 1.0 )';
  if (m.fragmentShader.includes(target)){
    m.fragmentShader = 'uniform float gAlpha;\n'
      + m.fragmentShader.replace(target, 'blendOverlay( base.rgb, color ), gAlpha )');
    m.uniforms.gAlpha = { value: alpha };
    m.transparent = true; m.depthWrite = false; m.needsUpdate = true;
  }
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

  // grassy ground far below, stretching to the hilly horizon
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color:0x69bf45, roughness:1 })
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
      color:0xbfe6ff, roughness:0.08, metalness:0,
      clearcoat:1, clearcoatRoughness:0.06,
      transparent:true, opacity:0.3, envMapIntensity:1.6,
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
  scene.add(floor);

  // glass side walls — same reflective look as the floor, carried up the sides
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
    scene.add(w);

    // crisp glossy top rail so the glass wall reads as a solid pane edge
    const rail = new THREE.Mesh(
      new RoundedBoxGeometry(0.12, 0.12, DESK_D-0.6, 3, 0.05),
      new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.08, clearcoat:1, envMapIntensity:1.4 })
    );
    rail.position.set(x, WALL_H, DESK_CZ);
    scene.add(rail);
  }
  buildWall(-1); buildWall(1);
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
function bubbleTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0,   'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(180,230,255,0.05)');
  g.addColorStop(0.92,'rgba(140,210,255,0.5)');
  g.addColorStop(1,   'rgba(120,200,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(64,64,62,0,7); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2;
  x.beginPath(); x.arc(64,64,58,0,7); x.stroke();
  const h = x.createRadialGradient(46,42,0,46,42,16);
  h.addColorStop(0,'rgba(255,255,255,.95)'); h.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = h; x.beginPath(); x.arc(46,42,16,0,7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const bt = bubbleTexture();
  const COUNT = lowPerf ? 28 : 44;
  for (let i = 0; i < COUNT; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:bt, transparent:true, depthWrite:false }));
    resetBubble(s, true);
    s.userData.speed = 0.3 + Math.random()*0.7;
    s.userData.sway  = Math.random()*Math.PI*2;
    scene.add(s); bubbles.push(s);
  }
  noReflect.push(...bubbles);      // bubbles drift in the main view only, not the mirrors
}
function resetBubble(s, anywhere){
  const sc = 0.1 + Math.random()*0.4;
  s.scale.set(sc, sc, 1);
  s.position.set((Math.random()-0.5)*30, anywhere ? Math.random()*14 : -0.5, DESK_CZ + (Math.random()-0.5)*40);
}

/* ════════════════════════════════════════════════════════════════
   5 · build the gallery frames once the 3D font has loaded
   ════════════════════════════════════════════════════════════════ */
const frames = [];
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

function placeholderTexture(name){
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024/ASPECT);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0,0,c.width,c.height);
  g.addColorStop(0,'#eafaff'); g.addColorStop(.5,'#9ddcff'); g.addColorStop(1,'#3aa0ee');
  x.fillStyle = g; x.fillRect(0,0,c.width,c.height);
  x.fillStyle = 'rgba(255,255,255,.85)';
  x.font = `600 ${Math.round(c.height*0.13)}px Quicksand, Segoe UI, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, c.width/2, c.height/2 - c.height*0.05);
  x.font = `500 ${Math.round(c.height*0.06)}px Quicksand, Segoe UI, sans-serif`;
  x.fillStyle = 'rgba(255,255,255,.7)';
  x.fillText('loading live preview…', c.width/2, c.height/2 + c.height*0.12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// rounded-corner alpha mask at the panel's aspect, so the screenshot rolls right
// to the curved edges of the panel instead of sitting as a square in a big inset
const PANEL_MASK = (() => {
  const W = 512, H = Math.max(2, Math.round(512 / ASPECT));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = Math.min(W, H) * 0.07;
  x.fillStyle = '#fff'; roundRect(x, 0, 0, W, H, r); x.fill();
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
})();

// "cover"-fit a texture to the panel aspect via a UV crop: fills the panel
// edge-to-edge at the image's TRUE aspect — no stretch, no letterbox squares
function coverFit(tex){
  const ia = tex.image.naturalWidth / tex.image.naturalHeight, pa = FW / FH;
  if (ia > pa){ tex.repeat.set(pa/ia, 1); tex.offset.set((1 - pa/ia)/2, 0); }
  else        { tex.repeat.set(1, ia/pa); tex.offset.set(0, (1 - ia/pa)/2); }
}

// loads the live screenshot and cover-fits it onto the panel material
function loadScreen(project, mat){
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    coverFit(t);
    t.needsUpdate = true;
    mat.map?.dispose?.();                       // drop the placeholder
    mat.map = t; mat.needsUpdate = true;
  };
  img.onerror = () => { /* keep the placeholder */ };
  img.src = screenshotURL(project.url, SHOT_W, SHOT_H);
}

function labelTexture(text){
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  const r = 56, w = c.width, h = c.height, pad = 12;
  const g = x.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'rgba(150,215,255,.95)'); g.addColorStop(1,'rgba(20,120,210,.95)');
  x.fillStyle = g;
  roundRect(x, pad, pad, w-2*pad, h-2*pad, r); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 4;
  roundRect(x, pad, pad, w-2*pad, h-2*pad, r); x.stroke();
  const gl = x.createLinearGradient(0,pad,0,h/2);
  gl.addColorStop(0,'rgba(255,255,255,.6)'); gl.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = gl; roundRect(x, pad+6, pad+4, w-2*pad-12, h/2-pad, r*0.7); x.fill();
  x.fillStyle = '#fff';
  x.font = '600 52px Quicksand, Segoe UI, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w/2, h/2+2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// flat name plaque that sits ON the gallery panel (shares the frame's facing,
// rather than billboarding to always face the camera)
function labelPanel(text){
  return new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshBasicMaterial({ map:labelTexture(text), transparent:true, depthWrite:false, toneMapped:false })
  );
}
function roundRect(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r);
  x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }

function buildGallery(font){
  // glossy white glass frame material
  const frameMat = new THREE.MeshPhysicalMaterial({
    color:0xffffff, roughness:0.12, metalness:0.0,
    clearcoat:1, clearcoatRoughness:0.05, envMapIntensity:1.4,
  });
  const visitMat = new THREE.MeshPhysicalMaterial({
    color:0xffffff, roughness:0.08, metalness:0, clearcoat:1, clearcoatRoughness:0.05,
    emissive:0x2aa9ff, emissiveIntensity:0.22, envMapIntensity:1.4,
  });

  CONFIG.projects.forEach((project, i) => {
    const group = new THREE.Group();
    const side = (i % 2 === 0) ? -1 : 1;      // left / right of the corridor
    const row  = Math.floor(i / 2);
    group.position.set(side * FRAME_X, FRAME_Y, START_Z + row * DZ);  // pressed to the glass wall
    group.rotation.y = side < 0 ? Math.PI/2 : -Math.PI/2;   // face the walkway

    // glass backing with curved edges: gives depth + shadow, and is the edge the
    // screenshot rolls over (its rounded front sits right behind the image)
    const back = new THREE.Mesh(new RoundedBoxGeometry(FW, FH, 0.16, 5, 0.09), frameMat);
    back.castShadow = true; group.add(back);

    // the live screenshot — fills the panel edge-to-edge at the image's true
    // aspect (cover-fit) and is rounded by PANEL_MASK so it rolls over the edges
    const panelMat = new THREE.MeshBasicMaterial({
      map: placeholderTexture(project.name), alphaMap: PANEL_MASK,
      transparent: true, toneMapped: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), panelMat);
    screen.position.z = 0.082; group.add(screen);
    loadScreen(project, panelMat);            // swap in the live render, cover-fit

    // name plaque — centered in the gap between the panel top and the wall top
    const label = labelPanel(project.name);
    label.position.set(0, (FH/2 + WALL_H - FRAME_Y) / 2, 0.06); group.add(label);

    // 3D "visit?" text — hidden until you approach
    const tg = new TextGeometry('visit?', {
      font, size:0.46, depth:0.13, height:0.13, curveSegments:6,
      bevelEnabled:true, bevelThickness:0.03, bevelSize:0.022, bevelSegments:3,
    });
    tg.computeBoundingBox();
    const bb = tg.boundingBox;
    tg.translate(-(bb.max.x-bb.min.x)/2, -(bb.max.y-bb.min.y)/2, 0);
    const visit = new THREE.Mesh(tg, visitMat);
    visit.position.set(0, -0.15, 0.9);
    visit.scale.setScalar(0.001);
    visit.userData.baseY = -0.15;
    group.add(visit);

    group.userData = { project, visit, label, scale:0, worldPos:new THREE.Vector3() };
    group.getWorldPosition(group.userData.worldPos);
    scene.add(group);
    frames.push(group);
  });
}

/* ════════════════════════════════════════════════════════════════
   6 · controls — pointer-lock mouse + gamepad + touch, all smoothed
   ════════════════════════════════════════════════════════════════ */
controls = new PointerLockControls(camera, renderer.domElement);
controls.pointerSpeed = CONFIG.movement.mouseSensitivity ?? 1;
scene.add(controls.getObject());

const velocity = new THREE.Vector3();
const M = CONFIG.movement;
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
  keys[e.code] = true;
  if (e.code === 'KeyE') tryLaunch();
  if (e.code !== 'Escape') setInputMode('keyboard');
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', () => { if (!isTouch) setInputMode('keyboard'); }, { passive:true });

/* ── gamepad ── */
let padIndex = null, padVisitPrev = false, padPausePrev = false;
addEventListener('gamepadconnected',   e => { padIndex = e.gamepad.index; setInputMode('gamepad'); });
addEventListener('gamepaddisconnected', e => {
  if (padIndex === e.gamepad.index){ padIndex = null; setInputMode(isTouch ? 'touch' : 'keyboard'); }
});
function getPad(){ return (padIndex != null && navigator.getGamepads) ? navigator.getGamepads()[padIndex] : null; }
function pollPad(dt){
  padMove.x = 0; padMove.y = 0;
  const gp = getPad(); if (!gp) return;
  const lx = dead(gp.axes[0]||0), ly = dead(gp.axes[1]||0);
  const rx = dead(gp.axes[2]||0), ry = dead(gp.axes[3]||0);
  if (lx || ly || rx || ry) setInputMode('gamepad');
  padMove.x = lx; padMove.y = -ly;
  if (rx || ry) applyLook(rx * (M.padLook ?? 2.6) * dt, ry * (M.padLook ?? 2.6) * dt);
  const visit = !!gp.buttons[0]?.pressed; if (visit && !padVisitPrev) tryLaunch(); padVisitPrev = visit;
  const pause = !!gp.buttons[9]?.pressed; if (pause && !padPausePrev) togglePause();  padPausePrev = pause;
}

/* ── touch: floating joystick (move) + drag (look) + tap/button (visit) ── */
{
  const JOY_R = 52;
  let joyId = null, joyCX = 0, joyCY = 0;
  let lookId = null, lookLX = 0, lookLY = 0, lookStart = 0, lookMoved = 0;
  const joyEl = $('joy'), knobEl = $('joyKnob');
  const inJoyZone = (x, y) => x < innerWidth * 0.5 && y > innerHeight * 0.45;

  addEventListener('touchstart', e => {
    setInputMode('touch');
    for (const t of e.changedTouches){
      if (t.target?.closest?.('.touch-btn')) continue;   // let buttons handle their own taps
      if (joyId === null && inJoyZone(t.clientX, t.clientY)){
        joyId = t.identifier; joyCX = t.clientX; joyCY = t.clientY;
        if (joyEl){ joyEl.style.left = joyCX+'px'; joyEl.style.top = joyCY+'px'; joyEl.classList.add('on'); }
        if (knobEl) knobEl.style.transform = 'translate(-50%,-50%)';
      } else if (lookId === null){
        lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
        lookStart = performance.now(); lookMoved = 0;
      }
    }
  }, { passive:false });

  addEventListener('touchmove', e => {
    for (const t of e.changedTouches){
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
    if (e.cancelable) e.preventDefault();
  }, { passive:false });

  function endTouch(e){
    for (const t of e.changedTouches){
      if (t.identifier === joyId){
        joyId = null; touchMove.x = 0; touchMove.y = 0;
        joyEl?.classList.remove('on');
        if (knobEl) knobEl.style.transform = 'translate(-50%,-50%)';
      } else if (t.identifier === lookId){
        if (performance.now() - lookStart < 250 && lookMoved < 10) tryLaunch();   // quick tap = visit
        lookId = null;
      }
    }
  }
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);
}

/* ════════════════════════════════════════════════════════════════
   7 · SFX / ambient — synthesised, no audio files needed
   ════════════════════════════════════════════════════════════════ */
const audio = (() => {
  let ctx, master;
  function init(){
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = CONFIG.volume ?? 0.6;
    master.connect(ctx.destination);
  }
  function env(node, t0, a, d, peak){
    const g = ctx.createGain(); node.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return g;
  }
  function droplet(){
    if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(420, t+0.12);
    env(o, t, 0.005, 0.22, 0.5); o.start(t); o.stop(t+0.3);
  }
  function pop(){
    if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(1100, t+0.06);
    env(o, t, 0.004, 0.1, 0.4); o.start(t); o.stop(t+0.16);
  }
  function whoosh(){
    if (!ctx) return; const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate*1.2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<d.length;i++) d[i] = (Math.random()*2-1);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=1.2;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4000, t+1.0);
    src.connect(bp); env(bp, t, 0.25, 0.95, 0.5); src.start(t); src.stop(t+1.2);
    const o = ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(880, t+1.0);
    env(o, t, 0.3, 0.9, 0.18); o.start(t); o.stop(t+1.2);
  }
  return { init, droplet, pop, whoosh };
})();

/* ════════════════════════════════════════════════════════════════
   8 · state machine: enter → intro swoop → play → launch swoop
   ════════════════════════════════════════════════════════════════ */
let state = 'menu';
let introT = 0;
let launch = null;
let activeFrame = null, lastActive = null;
let started = false;

function beginPlay(){
  if (started) return;
  started = true;
  $('enter').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('fade').style.opacity = '1';
  requestAnimationFrame(() => { $('fade').style.opacity = '0'; });
  audio.whoosh();
  state = 'intro'; introT = 0;
  if (inputMode === 'touch') $('touch')?.classList.remove('hidden');
}
function startExperience(){
  audio.init();
  if (isTouch) beginPlay();          // touch: no pointer lock
  else controls.lock();              // desktop / gamepad: pointer lock → 'lock' begins play
}
function pauseGame(){
  if (state !== 'play') return;
  state = 'paused';                         // freezes all movement (loop skips moveAndInteract)
  $('pause').classList.remove('hidden');
  $('hud').classList.add('hidden');         // remove crosshair / hint / on-screen controls
  $('prompt').classList.remove('show');
}
function resumeGame(){
  if (!started) return;
  state = 'play';
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
}
function togglePause(){ if (state === 'play') pauseGame(); else if (state === 'paused') resumeGame(); }

// back to the entry card (used when returning via the browser Back button, which
// would otherwise restore a frozen mid-swoop white screen = a "blank realm")
function resetToMenu(){
  launch = null; state = 'menu'; started = false;
  $('fade').style.opacity = '0';
  $('enter').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('touch')?.classList.add('hidden');
  $('prompt')?.classList.remove('show');
  controls.getObject().position.set(0, eyeHeight, -6);
  camera.lookAt(0, eyeHeight, 10);
}

controls.addEventListener('lock', () => {
  $('pause').classList.add('hidden');
  if (!started) beginPlay(); else resumeGame();
});
controls.addEventListener('unlock', () => { if (state === 'launching') return; pauseGame(); });

$('enterBtn').addEventListener('click', startExperience);
$('resumeBtn').addEventListener('click', () => {
  audio.init();
  if (isTouch) resumeGame();
  else controls.lock();                     // desktop: re-lock → 'lock' handler resumes
});
$('visitBtn')?.addEventListener('click', e => { e.preventDefault(); tryLaunch(); });
$('pauseBtn')?.addEventListener('click', e => { e.preventDefault(); togglePause(); });

// desktop click inside the world = visit the active frame
renderer.domElement.addEventListener('click', () => { if (controls.isLocked) tryLaunch(); });

function tryLaunch(){
  if (state !== 'play' || !activeFrame || launch) return;
  const f = activeFrame;
  state = 'launching';
  audio.whoosh();
  $('prompt').classList.remove('show');
  $('visitBtn')?.classList.remove('on');

  const dir = new THREE.Vector3(Math.sin(f.rotation.y), 0, Math.cos(f.rotation.y));
  const toPos = f.position.clone().add(dir.multiplyScalar(2.3)); toPos.y = eyeHeight;
  const tmp = new THREE.Object3D(); tmp.position.copy(toPos);
  tmp.lookAt(f.position.x, eyeHeight, f.position.z);

  launch = {
    frame:f, t:0,
    fromPos: controls.getObject().position.clone(),
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
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t  = clock.elapsedTime;

  if (skyMat) skyMat.uniforms.uTime.value = t;

  for (const b of bubbles){
    b.position.y += b.userData.speed * dt;
    b.position.x += Math.sin(t*0.6 + b.userData.sway) * 0.12 * dt;
    if (b.position.y > 16) resetBubble(b, false);
  }

  if (state === 'intro'){
    introT = Math.min(1, introT + dt/2.6);
    const e = easeOut(introT);
    controls.getObject().position.set(0, lerp(2.6, eyeHeight, e), lerp(-6, 0, e));
    if (introT >= 1) state = 'play';
  }
  else if (state === 'play'){
    moveAndInteract(dt, t);
  }
  else if (state === 'launching' && launch){
    launch.t = Math.min(1, launch.t + dt/1.15);
    const e = easeIO(launch.t);
    controls.getObject().position.lerpVectors(launch.fromPos, launch.toPos, e);
    camera.quaternion.slerpQuaternions(launch.fromQuat, launch.toQuat, e);
    camera.position.y = eyeHeight;
    if (launch.t >= 1){
      const url = withProtocol(launch.frame.userData.project.url);
      launch = null;
      if (CONFIG.openInNewTab){ window.open(url, '_blank'); $('fade').style.opacity='0'; state='play'; if(!isTouch) controls.lock(); }
      else window.location.href = url;
    }
  }

  // animate the "visit?" text on every frame
  for (const f of frames){
    const u = f.userData;
    const target = (f === activeFrame && state === 'play') ? 1 : 0;
    u.scale = lerp(u.scale, target, 1 - Math.pow(0.001, dt));
    const s = u.scale < 0.002 ? 0.001 : u.scale;
    u.visit.scale.setScalar(s);
    u.visit.position.y = u.visit.userData.baseY + Math.sin(t*1.8)*0.05*u.scale;
    const cw = new THREE.Vector3(); camera.getWorldPosition(cw);
    const fw = new THREE.Vector3(); f.getWorldPosition(fw);
    const yaw = Math.atan2(cw.x - fw.x, cw.z - fw.z) - f.rotation.y;
    u.visit.rotation.y = yaw;
  }

  renderer.render(scene, camera);
}

function moveAndInteract(dt, t){
  pollPad(dt);

  // unified analog move vector: keyboard + joystick + gamepad
  moveInput.x = (keys.KeyD||keys.ArrowRight?1:0) - (keys.KeyA||keys.ArrowLeft?1:0);
  moveInput.y = (keys.KeyW||keys.ArrowUp?1:0)    - (keys.KeyS||keys.ArrowDown?1:0);
  const dir = new THREE.Vector3(
    moveInput.x + touchMove.x + padMove.x,
    0,
    moveInput.y + touchMove.y + padMove.y
  );
  if (dir.lengthSq() > 1) dir.normalize();      // keep analog magnitudes < 1, cap diagonals

  // damped acceleration → smooth, never jittery
  velocity.x -= velocity.x * M.friction * dt;
  velocity.z -= velocity.z * M.friction * dt;
  if (dir.lengthSq() > 0){
    velocity.x += dir.x * M.accel * dt;
    velocity.z += dir.z * M.accel * dt;
  }
  const sp = Math.hypot(velocity.x, velocity.z);
  if (sp > M.maxSpeed){ velocity.x *= M.maxSpeed/sp; velocity.z *= M.maxSpeed/sp; }

  controls.moveRight(velocity.x * dt);
  controls.moveForward(velocity.z * dt);

  const o = controls.getObject();
  o.position.x = clamp(o.position.x, -(WALL_X-0.7), WALL_X-0.7);
  o.position.z = clamp(o.position.z, PLAT_Z0+1, PLAT_Z1-1);
  // gentle, speed-scaled head-bob (smoothed so it never snaps)
  smoothSpeed = lerp(smoothSpeed, Math.min(sp/M.maxSpeed, 1), 1 - Math.pow(0.0001, dt));
  bobPhase += dt * 6.2 * smoothSpeed;
  o.position.y = eyeHeight + Math.sin(bobPhase) * 0.012 * smoothSpeed;

  // active frame = the nearest one you're actually LOOKING at, within range
  // (so you can't back away and trigger a panel that's now behind you)
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const fl = Math.hypot(fwd.x, fwd.z) || 1, fX = fwd.x/fl, fZ = fwd.z/fl;
  activeFrame = null; let best = 7.5;
  for (const f of frames){
    const dx = f.position.x - o.position.x, dz = f.position.z - o.position.z;
    const d  = Math.hypot(dx, dz);
    if (d > 7.5) continue;
    if ((dx/d)*fX + (dz/d)*fZ < 0.6) continue;     // must be facing it (~within 53°)
    if (d < best){ best = d; activeFrame = f; }
  }
  if (activeFrame !== lastActive){
    lastActive = activeFrame;
    if (activeFrame){
      audio.droplet();
      $('prompt').textContent = `visit  ${activeFrame.userData.project.name}`;
      $('prompt').classList.add('show');
      $('crosshair').classList.add('active');
      $('visitBtn')?.classList.add('on');
    } else {
      $('prompt').classList.remove('show');
      $('crosshair').classList.remove('active');
      $('visitBtn')?.classList.remove('on');
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   10 · boot
   ════════════════════════════════════════════════════════════════ */
addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// returning to the gallery via the browser Back button (bfcache restore) lands
// on the entry screen again, not a frozen white/blank realm
addEventListener('pageshow', (e) => { if (e.persisted) resetToMenu(); });

$('title').textContent = CONFIG.title;
$('subtitle').textContent = CONFIG.subtitle;
// entrance button is just the owner's handle (CONFIG.creator) — the one breadcrumb
// a new owner edits after cloning (or a future sign-up Worker writes)
$('enterBtn').textContent = CONFIG.creator;
setInputMode(isTouch ? 'touch' : 'keyboard');

new FontLoader().load(
  'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
  (font) => {
    buildGallery(font);
    renderer.shadowMap.needsUpdate = true;   // render the static shadow map once, now that all casters exist
    $('loadnote').textContent = `${CONFIG.projects.length} worlds ready`;
    $('enterBtn').disabled = false;
    animate();
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
