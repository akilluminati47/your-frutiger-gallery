import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';

/* ════════════════════════════════════════════════════════════════
   0 · helpers
   ════════════════════════════════════════════════════════════════ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIO  = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
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

function withProtocol(u){ return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

function screenshotURL(url, w, h){
  const full = withProtocol(url);
  const enc  = encodeURIComponent(full);
  switch (CONFIG.screenshotProvider){
    case 'mshots':
      return `https://s.wordpress.com/mshots/v1/${enc}?w=${w}&h=${h}`;
    case 'microlink':
      return `https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`
           + `&viewport.width=${w}&viewport.height=${h}&viewport.deviceScaleFactor=1&meta=false`;
    case 'thumio':
    default:
      // honours output size + viewport so the snapshot matches the visitor's screen
      return `https://image.thum.io/get/width/${w}/crop/${h}/viewportWidth/${w}/noanimate/${full}`;
  }
}

/* ════════════════════════════════════════════════════════════════
   2 · renderer / scene / camera
   ════════════════════════════════════════════════════════════════ */
let renderer, scene, camera, controls;
const eyeHeight = 2.2;          // raised: you stand over the glass desk, not on the ground

try {
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
} catch (e){ fatal('Your browser/GPU could not start WebGL.'); throw e; }

renderer.setPixelRatio(Math.min(realDpr, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
   3 · sky, light, clouds, hills, glass desk — Frutiger Aero
   ════════════════════════════════════════════════════════════════ */
const clouds = [];
const bubbles = [];

// the grassy world sits far below the floating glass desk you walk on
const GROUND_Y = -8;
const DESK_CZ  = 11;            // desk centre along the walkway (z)

// gradient sky dome
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms:{
        top:    { value:new THREE.Color(0x1f7fe0) },
        mid:    { value:new THREE.Color(0x86c8ff) },
        bottom: { value:new THREE.Color(0xeefaff) },
      },
      vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader:`
        varying vec3 vP; uniform vec3 top,mid,bottom;
        void main(){
          float h = normalize(vP).y*0.5+0.5;
          vec3 c = mix(bottom, mid, smoothstep(0.0,0.5,h));
          c = mix(c, top, smoothstep(0.45,1.0,h));
          gl_FragColor = vec4(c,1.0);
        }`
    })
  );
  scene.add(sky);
}

// lighting: soft sky/grass hemisphere + warm Vista sun beaming from behind you
const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9fd886, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeccb, 2.25);
sun.position.set(-22, 58, -70);          // up and behind the start view → glare over your back
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48;   sun.shadow.camera.bottom = -48;
sun.shadow.bias = -0.0004;
sun.target.position.set(0, 1, 14);
scene.add(sun.target);
scene.add(sun);

// rolling green "Bliss" hills forming a hilly horizon line all around
{
  const greens = [0x6fbf46, 0x7ed05a, 0x63ad3e, 0x86d669];
  const N = 26;
  for (let i = 0; i < N; i++){
    const mat  = new THREE.MeshStandardMaterial({ color:greens[i % greens.length], roughness:1 });
    const r    = 42 + Math.random()*46;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
    const ang  = (i / N) * Math.PI * 2 + Math.random()*0.22;
    const dist = 110 + Math.random()*120;
    // centre sits on the grass so only a rounded hilltop breaks the horizon
    hill.position.set(Math.cos(ang)*dist, GROUND_Y, DESK_CZ + Math.sin(ang)*dist);
    hill.scale.set(1 + Math.random()*0.7, 0.24 + Math.random()*0.14, 1 + Math.random()*0.7);
    scene.add(hill);
  }
}

// procedural soft-cloud sprite — each call yields a different puffy shape
function cloudTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const lobes = 7 + Math.floor(Math.random()*7);
  for (let i = 0; i < lobes; i++){
    const px = 40 + Math.random()*176, py = 80 + Math.random()*96, r = 28 + Math.random()*58;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(255,255,255,${0.7 + Math.random()*0.25})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const texes = [cloudTexture(), cloudTexture(), cloudTexture(), cloudTexture(), cloudTexture()];
  const SPREAD = 320;
  for (let i = 0; i < 22; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texes[(Math.random()*texes.length)|0],
      transparent:true, opacity:0.45 + Math.random()*0.5, depthWrite:false,
    }));
    s.position.set((Math.random()-0.5)*SPREAD, 34 + Math.random()*78, (Math.random()-0.5)*SPREAD + DESK_CZ);
    const sc = 24 + Math.random()*64;
    s.scale.set(sc, sc*(0.42 + Math.random()*0.26), 1);
    s.userData.drift = (0.25 + Math.random()*0.85) * (Math.random() < 0.5 ? 1 : -1);  // random direction + speed
    s.userData.bob   = Math.random()*Math.PI*2;
    s.userData.bobA  = 0.3 + Math.random()*0.8;
    s.userData.baseY = s.position.y;
    s.userData.span  = SPREAD;
    scene.add(s); clouds.push(s);
  }
}

// a giant glass desk floats over the grass — the gallery stands on its top
{
  const DESK_W = 26, DESK_D = 56, DESK_T = 0.7;

  // grassy ground far below the desk, stretching out to the hilly horizon
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color:0x69bf45, roughness:1 })
  );
  grass.rotation.x = -Math.PI/2;
  grass.position.set(0, GROUND_Y, DESK_CZ);
  grass.receiveShadow = true;
  scene.add(grass);

  // thick translucent glass slab (the desk top)
  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(DESK_W, DESK_T, DESK_D, 5, 0.22),
    new THREE.MeshPhysicalMaterial({
      color:0xcdeeff, roughness:0.06, metalness:0,
      transmission:0.7, thickness:1.4, ior:1.32,
      clearcoat:1, clearcoatRoughness:0.05,
      transparent:true, opacity:0.5, envMapIntensity:1.5,
    })
  );
  slab.position.set(0, -DESK_T/2, DESK_CZ);
  scene.add(slab);

  // reflective film on the very top → the signature wet Frutiger Aero shine
  const mirror = new Reflector(new THREE.PlaneGeometry(DESK_W-0.8, DESK_D-0.8), {
    clipBias: 0.003,
    textureWidth:  1024,
    textureHeight: 1024,
    color: 0x9fb4c4,
  });
  mirror.rotation.x = -Math.PI/2;
  mirror.position.set(0, 0.004, DESK_CZ);
  scene.add(mirror);

  // faint aqua tint so the reflections read as cool "water-glass"
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(DESK_W-0.8, DESK_D-0.8),
    new THREE.MeshBasicMaterial({ color:0x2a93d8, transparent:true, opacity:0.16, depthWrite:false })
  );
  tint.rotation.x = -Math.PI/2; tint.position.set(0, 0.006, DESK_CZ);
  scene.add(tint);

  // four chunky glass legs dropping to the grass
  const legMat = new THREE.MeshPhysicalMaterial({
    color:0xbfe6ff, roughness:0.08, metalness:0, transmission:0.5,
    thickness:1.0, ior:1.3, clearcoat:1, transparent:true, opacity:0.55,
  });
  const legH = (-DESK_T) - GROUND_Y;            // from desk underside down to the grass
  const lx = DESK_W/2 - 1.6, lz = DESK_D/2 - 1.6;
  [[-lx,-lz],[lx,-lz],[-lx,lz],[lx,lz]].forEach(([px,pz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, legH, 20), legMat);
    leg.position.set(px, -DESK_T - legH/2, DESK_CZ + pz);
    scene.add(leg);
  });
}

/* a beaming Vista sun + lens glare, low behind the start view ("over your back") */
{
  const sunPos = new THREE.Vector3(-26, 30, -120);
  function glareTexture(coreA, edge){
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128,128,0,128,128,128);
    g.addColorStop(0,   `rgba(255,255,255,${coreA})`);
    g.addColorStop(0.18,`rgba(255,248,224,${coreA*0.9})`);
    g.addColorStop(0.5, `rgba(255,236,190,${edge})`);
    g.addColorStop(1,   'rgba(255,230,170,0)');
    x.fillStyle = g; x.beginPath(); x.arc(128,128,128,0,7); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const add = (tex, sc, op) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map:tex, transparent:true, opacity:op, depthWrite:false, depthTest:false,
      blending:THREE.AdditiveBlending, fog:false,
    }));
    s.position.copy(sunPos); s.scale.set(sc, sc, 1); s.renderOrder = 5;
    scene.add(s);
  };
  add(glareTexture(1.0, 0.5), 46, 1.0);     // bright sun core
  add(glareTexture(0.6, 0.25), 150, 0.8);   // wide atmospheric glare halo
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
  // rim + highlight
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2;
  x.beginPath(); x.arc(64,64,58,0,7); x.stroke();
  const h = x.createRadialGradient(46,42,0,46,42,16);
  h.addColorStop(0,'rgba(255,255,255,.95)'); h.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = h; x.beginPath(); x.arc(46,42,16,0,7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const bt = bubbleTexture();
  for (let i = 0; i < 46; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:bt, transparent:true, depthWrite:false }));
    resetBubble(s, true);
    s.userData.speed = 0.3 + Math.random()*0.7;
    s.userData.sway  = Math.random()*Math.PI*2;
    scene.add(s); bubbles.push(s);
  }
}
function resetBubble(s, anywhere){
  const sc = 0.1 + Math.random()*0.4;
  s.scale.set(sc, sc, 1);
  s.position.set((Math.random()-0.5)*30, anywhere ? Math.random()*14 : -0.5, Math.random()*120 - 6);
}

/* ════════════════════════════════════════════════════════════════
   5 · build the gallery frames once the 3D font has loaded
   ════════════════════════════════════════════════════════════════ */
const frames = [];
const HALF = 4.7, DZ = 7.2, START_Z = 9, FRAME_Y = 1.4, FH = 2.4, FW = FH * ASPECT;
let END_Z = START_Z;

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

function loadScreen(project){
  const tex = placeholderTexture(project.name);          // show instantly
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    tex.image = img; tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  };
  img.onerror = () => { /* keep the placeholder */ };
  img.src = screenshotURL(project.url, SHOT_W, SHOT_H);
  return tex;
}

function labelSprite(text){
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  // glossy aqua pill
  const r = 56, w = c.width, h = c.height, pad = 12;
  const g = x.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'rgba(150,215,255,.95)'); g.addColorStop(1,'rgba(20,120,210,.95)');
  x.fillStyle = g;
  roundRect(x, pad, pad, w-2*pad, h-2*pad, r); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 4;
  roundRect(x, pad, pad, w-2*pad, h-2*pad, r); x.stroke();
  // top gloss
  const gl = x.createLinearGradient(0,pad,0,h/2);
  gl.addColorStop(0,'rgba(255,255,255,.6)'); gl.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = gl; roundRect(x, pad+6, pad+4, w-2*pad-12, h/2-pad, r*0.7); x.fill();
  x.fillStyle = '#fff';
  x.font = '600 52px Quicksand, Segoe UI, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w/2, h/2+2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthWrite:false }));
  sp.scale.set(2.6, 0.65, 1);
  return sp;
}
function roundRect(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r);
  x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }

function buildGallery(font){
  // glossy white glass frame material
  const frameMat = new THREE.MeshPhysicalMaterial({
    color:0xffffff, roughness:0.12, metalness:0.0,
    clearcoat:1, clearcoatRoughness:0.05, envMapIntensity:1.4,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color:0xddf3ff, roughness:0.05, metalness:0, transmission:0.6,
    thickness:0.4, ior:1.3, clearcoat:1, transparent:true, opacity:0.85,
  });
  const visitMat = new THREE.MeshPhysicalMaterial({
    color:0xffffff, roughness:0.08, metalness:0, clearcoat:1, clearcoatRoughness:0.05,
    emissive:0x2aa9ff, emissiveIntensity:0.22, envMapIntensity:1.4,
  });

  CONFIG.projects.forEach((project, i) => {
    const group = new THREE.Group();
    const side = (i % 2 === 0) ? -1 : 1;      // left / right of the corridor
    const row  = Math.floor(i / 2);
    group.position.set(side * HALF, FRAME_Y, START_Z + row * DZ);
    group.rotation.y = side < 0 ? Math.PI/2 : -Math.PI/2;   // face the walkway
    END_Z = Math.max(END_Z, START_Z + row * DZ);

    // glass border (rounded box behind the screen)
    const border = new THREE.Mesh(new RoundedBoxGeometry(FW+0.5, FH+0.5, 0.2, 4, 0.12), frameMat);
    border.castShadow = true; group.add(border);

    // the live screenshot (unlit so it reads as a glowing screen)
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(FW, FH),
      new THREE.MeshBasicMaterial({ map: loadScreen(project), toneMapped:false })
    );
    screen.position.z = 0.11; group.add(screen);

    // glass pedestal + base
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, FRAME_Y - FH/2, 16), glassMat);
    post.position.y = -(FH/2) - (FRAME_Y - FH/2)/2; group.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.08, 24), glassMat);
    base.position.y = -FRAME_Y; group.add(base);

    // floating name label
    const label = labelSprite(project.name);
    label.position.set(0, FH/2 + 0.55, 0.2); group.add(label);

    // 3D "visit?" text — hidden until you approach
    const tg = new TextGeometry('visit?', {
      font, size:0.46, depth:0.13, height:0.13, curveSegments:6,
      bevelEnabled:true, bevelThickness:0.03, bevelSize:0.022, bevelSegments:3,
    });
    tg.computeBoundingBox();
    const bb = tg.boundingBox;
    tg.translate(-(bb.max.x-bb.min.x)/2, -(bb.max.y-bb.min.y)/2, 0);
    const visit = new THREE.Mesh(tg, visitMat);
    visit.position.set(0, -0.15, 0.9);   // floats in front of the painting, toward you
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
   6 · controls — calm, damped first-person glide
   ════════════════════════════════════════════════════════════════ */
controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyE') tryLaunch(); });
addEventListener('keyup',   e => { keys[e.code] = false; });

const velocity = new THREE.Vector3();
const M = CONFIG.movement;

/* ════════════════════════════════════════════════════════════════
   7 · SFX / ambient — synthesised, no audio files needed
   ════════════════════════════════════════════════════════════════ */
const audio = (() => {
  let ctx, master, ambientOn = false;
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
    src.connect(bp); const g = env(bp, t, 0.25, 0.95, 0.5); src.start(t); src.stop(t+1.2);
    // rising shimmer
    const o = ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(880, t+1.0);
    env(o, t, 0.3, 0.9, 0.18); o.start(t); o.stop(t+1.2);
  }
  function startAmbient(){
    if (!ctx || ambientOn) return; ambientOn = true;
    const g = ctx.createGain(); g.gain.value = 0.025; g.connect(master);  // ambient pad lowered 50%
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 600; lp.connect(g);
    [110, 110.4, 165].forEach(f => {
      const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f; o.connect(lp); o.start();
    });
  }
  return { init, droplet, pop, whoosh, startAmbient };
})();

/* ════════════════════════════════════════════════════════════════
   8 · state machine: enter → intro swoop → play → launch swoop
   ════════════════════════════════════════════════════════════════ */
let state = 'menu';
let introT = 0;
let launch = null;          // { frame, t, fromPos, toPos, fromQuat, toQuat }
let activeFrame = null, lastActive = null;
let started = false;

function startExperience(){
  audio.init();
  controls.lock();
}
controls.addEventListener('lock', () => {
  $('pause').classList.add('hidden');
  if (!started){
    started = true;
    $('enter').classList.add('hidden');
    $('hud').classList.remove('hidden');
    // begin the white swoop-in
    $('fade').style.opacity = '1';
    requestAnimationFrame(() => { $('fade').style.opacity = '0'; });
    audio.whoosh(); audio.startAmbient();
    state = 'intro'; introT = 0;
  }
});
controls.addEventListener('unlock', () => {
  if (state === 'launching') return;
  $('pause').classList.remove('hidden');
});

$('enterBtn').addEventListener('click', startExperience);
$('resumeBtn').addEventListener('click', () => { audio.init(); controls.lock(); });

// click inside the world = visit the active frame
renderer.domElement.addEventListener('click', () => { if (controls.isLocked) tryLaunch(); });

function tryLaunch(){
  if (state !== 'play' || !activeFrame || launch) return;
  const f = activeFrame;
  state = 'launching';
  audio.whoosh();
  $('prompt').classList.remove('show');

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
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t  = clock.elapsedTime;

  // clouds + bubbles always drift
  for (const c of clouds){
    c.position.x += c.userData.drift * dt;
    const lim = c.userData.span * 0.5;
    if (c.position.x >  lim) c.position.x = -lim;
    if (c.position.x < -lim) c.position.x =  lim;
    c.position.y = c.userData.baseY + Math.sin(t*0.15 + c.userData.bob) * c.userData.bobA;
  }
  for (const b of bubbles){
    b.position.y += b.userData.speed * dt;
    b.position.x += Math.sin(t*0.6 + b.userData.sway) * 0.12 * dt;
    if (b.position.y > 16) resetBubble(b, false);
  }

  if (state === 'intro'){
    introT = Math.min(1, introT + dt/2.6);
    const e = easeOut(introT);
    controls.getObject().position.set(0, lerp(3.8, eyeHeight, e), lerp(-6, 0, e));
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
      if (CONFIG.openInNewTab){ window.open(url, '_blank'); $('fade').style.opacity='0'; state='play'; controls.lock(); }
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
    // face the camera (yaw only) so it always reads
    const cw = new THREE.Vector3(); camera.getWorldPosition(cw);
    const fw = new THREE.Vector3(); f.getWorldPosition(fw);
    const yaw = Math.atan2(cw.x - fw.x, cw.z - fw.z) - f.rotation.y;
    u.visit.rotation.y = yaw;
    u.label.position.y = FH/2 + 0.55 + Math.sin(t*1.2 + f.position.z)*0.04;
  }

  renderer.render(scene, camera);
}

function moveAndInteract(dt, t){
  // damped movement
  velocity.x -= velocity.x * M.friction * dt;
  velocity.z -= velocity.z * M.friction * dt;
  const dir = new THREE.Vector3(
    (keys.KeyD||keys.ArrowRight?1:0) - (keys.KeyA||keys.ArrowLeft?1:0),
    0,
    (keys.KeyW||keys.ArrowUp?1:0)    - (keys.KeyS||keys.ArrowDown?1:0)
  );
  if (dir.lengthSq() > 0){
    dir.normalize();
    velocity.x += dir.x * M.accel * dt;
    velocity.z += dir.z * M.accel * dt;
  }
  const sp = Math.hypot(velocity.x, velocity.z);
  if (sp > M.maxSpeed){ velocity.x *= M.maxSpeed/sp; velocity.z *= M.maxSpeed/sp; }

  controls.moveRight(velocity.x * dt);
  controls.moveForward(velocity.z * dt);

  const o = controls.getObject();
  o.position.x = clamp(o.position.x, -HALF-1.3, HALF+1.3);
  o.position.z = clamp(o.position.z, -5, END_Z + 5);
  // gentle calm head-bob
  o.position.y = eyeHeight + Math.sin(t*7) * 0.018 * Math.min(sp/M.maxSpeed, 1);

  // find nearest frame in range
  activeFrame = null; let best = 6.0;
  for (const f of frames){
    const d = Math.hypot(o.position.x - f.position.x, o.position.z - f.position.z);
    if (d < best){ best = d; activeFrame = f; }
  }
  if (activeFrame !== lastActive){
    lastActive = activeFrame;
    if (activeFrame){
      audio.droplet();
      $('prompt').textContent = `visit  ${activeFrame.userData.project.name}`;
      $('prompt').classList.add('show');
      $('crosshair').classList.add('active');
    } else {
      $('prompt').classList.remove('show');
      $('crosshair').classList.remove('active');
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

$('title').textContent = CONFIG.title;
$('subtitle').textContent = CONFIG.subtitle;

new FontLoader().load(
  'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
  (font) => {
    buildGallery(font);
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
