import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import forestEnvironmentUrl from './assets/forest_slope_1k.hdr?url';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const TAU = Math.PI * 2;
const STEP = 1 / 60;
const ARENA_LIMIT = 14.7;
const RECORD_KEY = 'sang-penjaga-abu:best-run-v1';

const ui = {
  canvas: $('#world'),
  title: $('#title-screen'),
  start: $('#start-button'),
  boot: $('#boot-status'),
  hud: $('#hud'),
  health: $('#health-fill'),
  healthValue: $('#health-value'),
  enemyCount: $('#enemy-count'),
  killCount: $('#kill-count'),
  waveNumber: $('#wave-number'),
  objective: $('#objective-copy'),
  combo: $('#combo-panel'),
  comboCount: $('#combo-count'),
  toast: $('#toast'),
  damage: $('#damage-flash'),
  pause: $('#pause-overlay'),
  end: $('#end-overlay'),
  endTitle: $('#end-title'),
  endCopy: $('#end-copy'),
  endKicker: $('#end-kicker'),
  lockHint: $('#lock-hint'),
  recordSummary: $('#record-summary'),
  score: $('#score-count'),
  bestScore: $('#best-score'),
};

let renderer;
let composer;
let audio;
let mode = 'menu';
let cameraYaw = 0;
let cameraShake = 0;
let elapsed = 0;
let previousFrame = 0;
let accumulator = 0;
let toastTimer = 0;
let touchLook = null;
let fallbackContext = null;
let forestEnvironmentTarget;

const textureLoader = new THREE.TextureLoader();
const pbrTextureRoot = `${import.meta.env.BASE_URL}assets/textures/`;
const arrows = [];
const arrowShaftGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.58, 6);
const arrowheadGeometry = new THREE.ConeGeometry(0.028, 0.095, 6);
const arrowFeatherGeometry = new THREE.BoxGeometry(0.048, 0.11, 0.012);
const arrowFeatherMaterial = material(0xa15d43, { roughness: 0.88 });
const projectileShaftMaterial = material(0xb6a37e, { roughness: 0.88, metalness: 0.04 });
const projectileTipMaterial = material(0x888571, { roughness: 0.48, metalness: 0.54 });

const fallback = {
  enemies: [],
  particles: [],
  projectiles: [],
  companionShotCooldown: 1.8,
  swingHit: false,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b10);
scene.fog = new THREE.FogExp2(0x0a0e13, 0.023);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 140);
camera.position.set(0, 5, 9);

const random = mulberry32(20819);
const heldKeys = new Set();
const torches = [];
const enemies = [];
const particles = createParticleSystem();

const player = {
  root: new THREE.Group(),
  model: new THREE.Group(),
  velocity: new THREE.Vector3(),
  dodgeDirection: new THREE.Vector3(0, 0, -1),
  torso: null,
  head: null,
  eyeLids: [],
  cloak: null,
  rightArm: null,
  leftArm: null,
  weapon: null,
  legs: [],
  knees: [],
  feet: [],
  health: 100,
  attackTimer: 0,
  attackCooldown: 0,
  dodgeTimer: 0,
  dodgeCooldown: 0,
  invulnerable: 0,
  combo: 0,
  comboTimer: 0,
  lastAttackAt: 0,
  hitTargets: new Set(),
  walking: false,
  facing: 0,
};

const companion = {
  root: new THREE.Group(),
  model: new THREE.Group(),
  velocity: new THREE.Vector3(),
  head: null,
  torso: null,
  cloak: null,
  bowArm: null,
  string: null,
  bow: null,
  bowstring: null,
  legs: [],
  aimTarget: null,
  aimTimer: 0,
  shotCooldown: 1.7,
  phase: 0,
  aiming: false,
};

const run = {
  wave: 0,
  kills: 0,
  score: 0,
  record: loadBestRun(),
  nextWaveIn: null,
  elapsed: 0,
  hasLockedPointer: false,
};

const webglContext = ui.canvas.getContext('webgl2', {
  alpha: false,
  antialias: true,
  powerPreference: 'high-performance',
});
if (webglContext) {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: ui.canvas,
      context: webglContext,
      antialias: true,
      powerPreference: 'high-performance',
    });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.25 : 1.65);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.28,
      0.4,
      0.9,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    createWorld();
    createPlayer();
    createCompanion();
    loadForestEnvironment();
    ui.boot.textContent = 'HUTAN 3D SIAP  ·  PENJAGA & PEMANAH';
  } catch (error) {
    console.error('Tidak dapat menyiapkan arena 3D:', error);
    ui.boot.textContent = 'ARENA MEMERLUKAN BROWSER DENGAN WEBGL';
    ui.start.disabled = true;
  }
} else {
  fallbackContext = ui.canvas.getContext('2d');
  if (fallbackContext) {
    ui.boot.textContent = 'MODE GRAFIS RINGAN  ·  GAME TETAP DAPAT DIMAINKAN';
    resize();
  } else {
    ui.boot.textContent = 'BROWSER INI TIDAK MENDUKUNG KANVAS';
    ui.start.disabled = true;
  }
}

bindControls();
updateHud();
requestAnimationFrame(frame);

function loadBestRun() {
  const empty = { score: 0, kills: 0, wave: 0 };
  try {
    const saved = JSON.parse(window.localStorage.getItem(RECORD_KEY) || 'null');
    if (!saved || !Number.isFinite(saved.score)) return empty;
    return {
      score: Math.max(0, Math.floor(saved.score)),
      kills: Math.max(0, Math.floor(saved.kills || 0)),
      wave: Math.max(0, Math.floor(saved.wave || 0)),
    };
  } catch {
    return empty;
  }
}

function formatScore(score) {
  return Math.max(0, Math.floor(score)).toLocaleString('id-ID');
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.76,
    metalness: options.metalness ?? 0.08,
    ...options,
  });
}

function createWorld() {
  scene.background = new THREE.Color(0x768b7a);
  scene.fog = new THREE.Fog(0x89998a, 26, 106);

  const skyLight = new THREE.HemisphereLight(0xe5eedc, 0x525748, 1.7);
  scene.add(skyLight);

  const canopyLight = new THREE.DirectionalLight(0xffe4c2, 2.45);
  canopyLight.position.set(-18, 27, 14);
  canopyLight.castShadow = true;
  canopyLight.shadow.mapSize.set(2048, 2048);
  canopyLight.shadow.camera.left = -30;
  canopyLight.shadow.camera.right = 30;
  canopyLight.shadow.camera.top = 30;
  canopyLight.shadow.camera.bottom = -30;
  canopyLight.shadow.camera.near = 1;
  canopyLight.shadow.camera.far = 74;
  canopyLight.shadow.bias = -0.00022;
  canopyLight.shadow.normalBias = 0.035;
  canopyLight.shadow.radius = 4;
  scene.add(canopyLight);

  const skyFill = new THREE.DirectionalLight(0xcbd9c8, 0.62);
  skyFill.position.set(14, 10, -14);
  scene.add(skyFill);

  makeGround();
  makeArenaRing();
  makeRuins();
  makeAsh();
}

function terrainHeight(x, z) {
  const radius = Math.hypot(x, z);
  const fade = THREE.MathUtils.clamp((radius - 9) / 13, 0, 1);
  const blend = fade * fade * (3 - 2 * fade);
  const ridges = Math.sin(x * 0.27 + z * 0.09) * 0.29
    + Math.cos(z * 0.25 - x * 0.17) * 0.22
    + Math.sin((x + z) * 0.62) * 0.08;
  return ridges * blend;
}

function makeGround() {
  const geometry = new THREE.PlaneGeometry(150, 150, 192, 192);
  geometry.rotateX(-Math.PI / 2);
  const points = geometry.getAttribute('position');
  for (let index = 0; index < points.count; index += 1) {
    points.setY(index, terrainHeight(points.getX(index), points.getZ(index)));
  }
  geometry.computeVertexNormals();

  geometry.setAttribute('uv2', geometry.attributes.uv.clone());
  const surface = createPbrMaterial(0xffffff, {
    colorMap: 'forest-floor-color',
    normalMap: 'forest-floor-normal',
    roughnessMap: 'forest-floor-roughness',
    repeat: [70, 70],
    roughness: 0.97,
    metalness: 0,
    normalScale: 0.62,
  });
  const ground = new THREE.Mesh(geometry, surface);
  ground.receiveShadow = true;
  scene.add(ground);
}

function makeArenaRing() {
  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(11.5, 0.095, 5, 128),
    createPbrMaterial(0x7b7a62, {
      colorMap: 'mossy-stone-color',
      normalMap: 'mossy-stone-normal',
      roughnessMap: 'mossy-stone-roughness',
      repeat: [6, 1],
      roughness: 0.96,
      metalness: 0,
    }),
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.08;
  scene.add(outerRing);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(10.92, 0.032, 4, 112),
    new THREE.MeshBasicMaterial({ color: 0x59634e, transparent: true, opacity: 0.36 }),
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.09;
  scene.add(innerRing);

  const stoneMaterial = createPbrMaterial(0x858271, {
    colorMap: 'mossy-stone-color',
    normalMap: 'mossy-stone-normal',
    roughnessMap: 'mossy-stone-roughness',
    repeat: [1.6, 1.6],
    roughness: 0.96,
    metalness: 0,
  });
  const runeMaterial = material(0x778268, { roughness: 0.94, metalness: 0.01, color: 0x778268 });
  for (let index = 0; index < 22; index += 1) {
    const angle = (index / 22) * TAU;
    const radius = 10.86;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.53), stoneMaterial);
    slab.position.set(x, terrainHeight(x, z) + 0.1, z);
    slab.rotation.y = -angle + Math.PI / 2;
    slab.rotation.z = (random() - 0.5) * 0.07;
    slab.castShadow = true;
    slab.receiveShadow = true;
    scene.add(slab);

    if (index % 3 === 0) {
      const mossPatch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.34), runeMaterial);
      mossPatch.position.set(x, terrainHeight(x, z) + 0.181, z);
      mossPatch.rotation.y = slab.rotation.y + (random() - 0.5) * 0.4;
      scene.add(mossPatch);
    }
  }
}

function makeRuins() {
  const bark = createPbrMaterial(0x82765e, {
    colorMap: 'pine-bark-color',
    normalMap: 'pine-bark-normal',
    roughnessMap: 'pine-bark-roughness',
    repeat: [2, 4],
    roughness: 0.96,
    metalness: 0,
  });
  const stone = createPbrMaterial(0x807c67, {
    colorMap: 'mossy-stone-color',
    normalMap: 'mossy-stone-normal',
    roughnessMap: 'mossy-stone-roughness',
    repeat: [1.2, 1.2],
    roughness: 0.96,
    metalness: 0,
  });

  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2 + Math.PI / 6;
    const radius = 18 + random() * 7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 1.9 + random() * 2.6;
    const monolith = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.53, height, 7, 2), stone);
    monolith.position.set(x, terrainHeight(x, z) + height * 0.5, z);
    monolith.rotation.set((random() - 0.5) * 0.17, random() * TAU, (random() - 0.5) * 0.18);
    monolith.castShadow = true;
    monolith.receiveShadow = true;
    scene.add(monolith);
  }

  const rockGeometry = new THREE.DodecahedronGeometry(1, 1);
  for (let index = 0; index < 28; index += 1) {
    const angle = random() * TAU;
    const radius = index < 15 ? 8.4 + random() * 8 : 19 + random() * 19;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const size = 0.27 + random() * (index < 15 ? 0.73 : 1.2);
    const rock = new THREE.Mesh(rockGeometry, stone);
    rock.position.set(x, terrainHeight(x, z) + size * 0.35, z);
    rock.rotation.set(random() * 0.8, random() * TAU, random() * 0.7);
    rock.scale.set(size * (0.8 + random() * 0.65), size * (0.5 + random() * 0.5), size * (0.8 + random() * 0.7));
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  for (let index = 0; index < 7; index += 1) {
    const angle = random() * TAU;
    const radius = 14 + random() * 24;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const direction = random() * TAU;
    const length = 2.1 + random() * 2.1;
    const start = [x - Math.cos(direction) * length / 2, terrainHeight(x, z) + 0.25, z - Math.sin(direction) * length / 2];
    const end = [x + Math.cos(direction) * length / 2, terrainHeight(x, z) + 0.11, z + Math.sin(direction) * length / 2];
    const log = new THREE.Mesh(cylinderBetween(start, end, 0.29 + random() * 0.12, 0.1, bark), bark);
    log.castShadow = true;
    log.receiveShadow = true;
    scene.add(log);
  }

  createForest();
  createForestFerns();

  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * TAU + Math.PI / 5;
    const radius = 11.7;
    makeTorch(Math.cos(angle) * radius, Math.sin(angle) * radius, index);
  }
}

function loadForestEnvironment() {
  const generator = new THREE.PMREMGenerator(renderer);
  generator.compileEquirectangularShader();
  new RGBELoader().setDataType(THREE.HalfFloatType).load(forestEnvironmentUrl, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.backgroundIntensity = 0.72;
    scene.backgroundBlurriness = 0.015;
    forestEnvironmentTarget = generator.fromEquirectangular(texture);
    scene.environment = forestEnvironmentTarget.texture;
    scene.environmentIntensity = 0.62;
    generator.dispose();
  }, undefined, (error) => {
    console.warn('HDRI hutan tidak tersedia; menggunakan langit prosedural.', error);
    generator.dispose();
  });
}

function createPbrMaterial(color, options = {}) {
  const surface = material(color, {
    roughness: options.roughness ?? 0.9,
    metalness: options.metalness ?? 0,
    ...(options.normalScale ? { normalScale: new THREE.Vector2(...[options.normalScale, options.normalScale]) } : {}),
  });
  const repeat = options.repeat ?? [2, 2];
  const maps = [
    ['map', options.colorMap, true],
    ['normalMap', options.normalMap, false],
    ['roughnessMap', options.roughnessMap, false],
  ];
  for (const [slot, name, isColor] of maps) {
    if (!name) continue;
    textureLoader.load(`${pbrTextureRoot}${name}.jpg`, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat[0], repeat[1]);
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 10);
      texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      surface[slot] = texture;
      surface.needsUpdate = true;
    });
  }
  return surface;
}

function cylinderBetween(start, end, radiusAtStart, radiusAtEnd, radialSegments = 7) {
  const from = new THREE.Vector3(...start);
  const direction = new THREE.Vector3(...end).sub(from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radiusAtEnd, radiusAtStart, length, radialSegments, 1);
  geometry.translate(0, length * 0.5, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(from.x, from.y, from.z);
  return geometry;
}

function mergeGeometry(parts) {
  for (const geometry of parts) geometry.computeVertexNormals();
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Geometri flora tidak dapat digabungkan.');
  geometry.computeVertexNormals();
  return geometry;
}

function coniferPrototype(height, spread) {
  const barkParts = [new THREE.CylinderGeometry(0.09, 0.62, height, 9, 9)];
  barkParts[0].translate(0, height / 2, 0);
  const needleParts = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (let root = 0; root < 5; root += 1) {
    const angle = (root / 5) * TAU + 0.14;
    barkParts.push(cylinderBetween(
      [0, 0.2, 0],
      [Math.cos(angle) * 1.6, 0.06, Math.sin(angle) * 1.6],
      0.23,
      0.035,
      6,
    ));
  }

  for (let level = 0; level < 6; level += 1) {
    const heightRatio = 0.38 + level * 0.096;
    const heightAtBranch = height * heightRatio;
    const branchSpread = spread * (1 - heightRatio * 0.72);
    for (let branch = 0; branch < 7; branch += 1) {
      const angle = branch / 7 * TAU + level * 0.45;
      const branchLength = branchSpread * (0.72 + random() * 0.3);
      const tip = new THREE.Vector3(Math.cos(angle) * branchLength, heightAtBranch - branchLength * 0.08, Math.sin(angle) * branchLength);
      barkParts.push(cylinderBetween(
        [Math.cos(angle) * 0.08, heightAtBranch, Math.sin(angle) * 0.08],
        tip.toArray(),
        0.1 * (1 - level * 0.09),
        0.025,
        5,
      ));

      for (let cluster = 0; cluster < 3; cluster += 1) {
        const along = 0.42 + cluster * 0.245;
        const base = new THREE.Vector3(Math.cos(angle) * branchLength * along, heightAtBranch - branchLength * along * 0.08, Math.sin(angle) * branchLength * along);
        for (const side of [-1, 1]) {
          const offsetAngle = angle + side * (0.26 + random() * 0.14);
          const fan = new THREE.Vector3(Math.cos(offsetAngle) * 0.7, -0.72, Math.sin(offsetAngle) * 0.7).normalize();
          const leafScale = spread * (0.11 + (1 - heightRatio) * 0.1) * (0.74 + random() * 0.45);
          const leaf = new THREE.ConeGeometry(leafScale, leafScale * 3.3, 5, 1);
          leaf.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, fan));
          leaf.translate(base.x, base.y, base.z);
          needleParts.push(leaf);
        }
      }
    }
  }

  const trunkGeometry = mergeGeometry(barkParts);
  const needlesGeometry = mergeGeometry(needleParts);
  const bark = createPbrMaterial(0xb19b77, {
    colorMap: 'pine-bark-color',
    normalMap: 'pine-bark-normal',
    roughnessMap: 'pine-bark-roughness',
    repeat: [1.7, 4.5],
    roughness: 0.97,
  });
  const needles = material(0x405946, { roughness: 0.97, metalness: 0 });
  return { trunkGeometry, needlesGeometry, bark, needles };
}

function createForest() {
  const varieties = [
    coniferPrototype(12.4, 3.5),
    coniferPrototype(15.1, 4.05),
    coniferPrototype(10.7, 3.1),
  ];
  const count = 56;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU + (random() - 0.5) * 0.3;
    const radius = index < 19 ? 15.4 + random() * 6.5 : 23.8 + random() * 22;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const tree = new THREE.Group();
    const prototype = varieties[index % varieties.length];
    const trunk = new THREE.Mesh(prototype.trunkGeometry, prototype.bark);
    const needles = new THREE.Mesh(prototype.needlesGeometry, prototype.needles);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    needles.castShadow = true;
    needles.receiveShadow = true;
    tree.add(trunk, needles);
    tree.position.set(x, terrainHeight(x, z), z);
    tree.rotation.y = random() * TAU;
    const scale = 0.77 + random() * 0.53;
    tree.scale.set(scale * (0.88 + random() * 0.22), scale, scale * (0.88 + random() * 0.22));
    scene.add(tree);
  }
}

function fernGeometry() {
  const pieces = [];
  const leafTemplate = new THREE.SphereGeometry(1, 6, 4);
  for (let frond = 0; frond < 7; frond += 1) {
    const angle = frond / 7 * TAU;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const reach = 0.48 + random() * 0.25;
    const height = 0.76 + random() * 0.32;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.08, 0),
      direction.clone().multiplyScalar(reach * 0.46).setY(height * 0.72),
      direction.clone().multiplyScalar(reach).setY(height),
    );
    pieces.push(new THREE.TubeGeometry(curve, 10, 0.012, 4, false));
    for (let step = 1; step <= 5; step += 1) {
      const t = step / 6;
      const anchor = curve.getPoint(t);
      for (const side of [-1, 1]) {
        const leaf = leafTemplate.clone();
        const size = (1 - t * 0.46) * (0.072 + random() * 0.026);
        leaf.scale(size, size * 2.45, size * 0.42);
        const cross = new THREE.Vector3(-direction.z * side, 0.32, direction.x * side).normalize();
        leaf.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), cross));
        leaf.translate(anchor.x + cross.x * size, anchor.y + size * 0.3, anchor.z + cross.z * size);
        pieces.push(leaf);
      }
    }
  }
  leafTemplate.dispose();
  return mergeGeometry(pieces);
}

function createForestFerns() {
  const geometry = fernGeometry();
  const leaves = material(0x59734d, { roughness: 0.98, metalness: 0 });
  for (let index = 0; index < 23; index += 1) {
    const angle = random() * TAU;
    const radius = 7.9 + random() * 9.8;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const fern = new THREE.Mesh(geometry, leaves);
    fern.position.set(x, terrainHeight(x, z), z);
    fern.rotation.y = random() * TAU;
    fern.scale.setScalar(0.65 + random() * 0.68);
    fern.castShadow = true;
    fern.receiveShadow = true;
    scene.add(fern);
  }
}

function makeTorch(x, z, index) {
  const root = new THREE.Group();
  root.position.set(x, terrainHeight(x, z), z);

  const iron = material(0x292d2e, { roughness: 0.58, metalness: 0.62 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.42, 7), iron);
  post.position.y = 0.71;
  post.castShadow = true;
  root.add(post);

  const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.17, 0.31, 8), iron);
  brazier.position.y = 1.48;
  brazier.castShadow = true;
  root.add(brazier);

  const flame = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.23, 1),
    new THREE.MeshBasicMaterial({ color: index % 2 ? 0xffa05a : 0xff7b44, toneMapped: false }),
  );
  flame.position.set(0, 1.79, 0);
  flame.scale.set(0.7, 1.65, 0.7);
  root.add(flame);

  const light = new THREE.PointLight(index % 2 ? 0xff9558 : 0xff7444, 35, 10, 1.8);
  light.position.set(0, 1.88, 0);
  root.add(light);
  scene.add(root);
  torches.push({ flame, light, phase: random() * TAU });
}

function makeStars() {
  const positions = new Float32Array(390 * 3);
  for (let index = 0; index < 390; index += 1) {
    const angle = random() * TAU;
    const radius = 47 + random() * 37;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 8 + random() * 36;
    positions[index * 3 + 2] = Math.sin(angle) * radius - 13;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x8faabd,
    size: 0.12,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
  }));
  scene.add(stars);
}

function makeGlowTexture() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 64;
  textureCanvas.height = 64;
  const context = textureCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(textureCanvas);
}

function makeAsh() {
  const count = 360;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * TAU;
    const radius = random() * 30;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 0.2 + random() * 7.5;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const ash = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xd4c3ad,
    map: makeGlowTexture(),
    size: 0.19,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  ash.frustumCulled = false;
  scene.add(ash);
  particles.ash = ash;
}

function createParticleSystem() {
  const max = 480;
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const velocities = Array.from({ length: max }, () => new THREE.Vector3());
  const lives = new Float32Array(max);
  const durations = new Float32Array(max);
  const baseColors = Array.from({ length: max }, () => new THREE.Color());
  positions.fill(-1000);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xffffff,
    map: makeGlowTexture(),
    size: 0.33,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    vertexColors: true,
  }));
  points.frustumCulled = false;
  scene.add(points);

  return { max, positions, colors, velocities, lives, durations, baseColors, geometry, points, cursor: 0, ash: null };
}

function burst(origin, color, count = 12, force = 3.7) {
  if (fallbackContext) {
    for (let index = 0; index < count; index += 1) {
      const angle = random() * TAU;
      const speed = force * (0.4 + random() * 0.8);
      fallback.particles.push({
        x: origin.x,
        z: origin.z,
        height: origin.y,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        rise: random() * speed,
        life: 0.42 + random() * 0.52,
        color: `#${new THREE.Color(color).getHexString()}`,
      });
    }
    return;
  }

  const tint = new THREE.Color(color);
  for (let index = 0; index < count; index += 1) {
    const slot = particles.cursor;
    particles.cursor = (particles.cursor + 1) % particles.max;
    const direction = new THREE.Vector3(random() - 0.5, random() * 0.9 + 0.1, random() - 0.5).normalize();
    const offset = slot * 3;
    particles.positions[offset] = origin.x + (random() - 0.5) * 0.28;
    particles.positions[offset + 1] = origin.y + (random() - 0.5) * 0.22;
    particles.positions[offset + 2] = origin.z + (random() - 0.5) * 0.28;
    particles.velocities[slot].copy(direction).multiplyScalar(force * (0.45 + random() * 0.9));
    particles.durations[slot] = 0.38 + random() * 0.55;
    particles.lives[slot] = particles.durations[slot];
    particles.baseColors[slot].copy(tint);
    particles.colors[offset] = tint.r;
    particles.colors[offset + 1] = tint.g;
    particles.colors[offset + 2] = tint.b;
  }
  particles.geometry.attributes.position.needsUpdate = true;
  particles.geometry.attributes.color.needsUpdate = true;
}

function updateParticles(delta) {
  for (let index = 0; index < particles.max; index += 1) {
    if (particles.lives[index] <= 0) continue;
    particles.lives[index] -= delta;
    const offset = index * 3;
    if (particles.lives[index] <= 0) {
      particles.positions[offset + 1] = -1000;
      particles.colors[offset] = 0;
      particles.colors[offset + 1] = 0;
      particles.colors[offset + 2] = 0;
      continue;
    }

    const velocity = particles.velocities[index];
    velocity.y -= 4.3 * delta;
    velocity.multiplyScalar(Math.exp(-0.8 * delta));
    particles.positions[offset] += velocity.x * delta;
    particles.positions[offset + 1] += velocity.y * delta;
    particles.positions[offset + 2] += velocity.z * delta;
    const fade = Math.min(1, particles.lives[index] / particles.durations[index] * 1.9);
    const tint = particles.baseColors[index];
    particles.colors[offset] = tint.r * fade;
    particles.colors[offset + 1] = tint.g * fade;
    particles.colors[offset + 2] = tint.b * fade;
  }

  particles.geometry.attributes.position.needsUpdate = true;
  particles.geometry.attributes.color.needsUpdate = true;

  if (!particles.ash) return;
  const ashPositions = particles.ash.geometry.attributes.position;
  for (let index = 0; index < ashPositions.count; index += 1) {
    let x = ashPositions.getX(index);
    let y = ashPositions.getY(index);
    let z = ashPositions.getZ(index);
    y -= delta * (0.13 + random() * 0.11);
    x += Math.sin(elapsed * 0.24 + index) * delta * 0.1;
    z += Math.cos(elapsed * 0.2 + index * 0.7) * delta * 0.08;
    if (y < 0.12) {
      y = 6 + random() * 2;
      x = (random() - 0.5) * 54;
      z = (random() - 0.5) * 54;
    }
    ashPositions.setXYZ(index, x, y, z);
  }
  ashPositions.needsUpdate = true;
}

function makeShadow(radius, opacity = 0.28) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 22),
    new THREE.MeshBasicMaterial({ color: 0x030405, transparent: true, opacity, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  return shadow;
}

function addBone(parent, start, end, radius, boneMaterial, sides = 8) {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(to, from);
  const bone = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.76, radius, direction.length(), sides),
    boneMaterial,
  );
  bone.position.copy(from).add(to).multiplyScalar(0.5);
  bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  bone.castShadow = true;
  bone.receiveShadow = true;
  parent.add(bone);
  return bone;
}

function createPlayer() {
  const skin = material(0xa58970, { roughness: 0.84, metalness: 0 });
  const skinLight = material(0xb49577, { roughness: 0.84, metalness: 0 });
  const beard = material(0x403127, { roughness: 0.98, metalness: 0 });
  const beardLight = material(0x584536, { roughness: 0.96, metalness: 0 });
  const leather = material(0x503c2e, { roughness: 0.95, metalness: 0 });
  const wornLeather = material(0x70533a, { roughness: 0.9, metalness: 0.02 });
  const cloth = material(0x383e34, { roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
  const paleCloth = material(0x77684d, { roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
  const iron = material(0x626254, { roughness: 0.56, metalness: 0.42 });
  const bronze = material(0x846441, { roughness: 0.65, metalness: 0.42 });
  const eyeWhite = material(0xd8c7a4, { roughness: 0.47, metalness: 0 });
  const iris = material(0x594331, { roughness: 0.5, metalness: 0 });
  const pupil = material(0x1e201b, { roughness: 0.42, metalness: 0 });

  player.root.position.set(0, 0, 0);
  player.root.add(makeShadow(0.74, 0.27));

  player.torso = new THREE.Group();
  player.model.add(player.torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.47, 8, 16), skin);
  chest.position.set(0, 1.15, 0);
  chest.scale.set(1.23, 1, 0.82);
  chest.castShadow = true;
  player.torso.add(chest);

  for (const side of [-1, 1]) {
    const pectoral = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), skinLight);
    pectoral.position.set(side * 0.165, 1.38, -0.187);
    pectoral.scale.set(1.18, 0.78, 0.58);
    pectoral.castShadow = true;
    player.torso.add(pectoral);

    for (let row = 0; row < 2; row += 1) {
      const abdominal = new THREE.Mesh(new THREE.SphereGeometry(0.093, 10, 8), row % 2 ? skin : skinLight);
      abdominal.position.set(side * (0.086 + row * 0.013), 1.11 - row * 0.165, -0.205);
      abdominal.scale.set(0.96, 0.74, 0.5);
      abdominal.castShadow = true;
      player.torso.add(abdominal);
    }
  }

  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.123, 0.19, 4, 9), skin);
  neck.position.set(0, 1.58, 0.005);
  neck.castShadow = true;
  player.torso.add(neck);

  const harness = new THREE.Mesh(cylinderBetween([-0.26, 1.55, -0.19], [0.31, 0.79, -0.18], 0.047, 0.045, 8), leather);
  harness.castShadow = true;
  player.torso.add(harness);
  for (let stud = 1; stud <= 5; stud += 1) {
    const t = stud / 6;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.027, 7, 5), bronze);
    rivet.position.set(-0.26 + 0.57 * t, 1.55 - 0.76 * t, -0.226);
    player.torso.add(rivet);
  }

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.4, 0.125, 12), leather);
  belt.position.y = 0.8;
  player.torso.add(belt);
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.027, 6, 12), bronze);
  buckle.position.set(0, 0.8, -0.357);
  player.torso.add(buckle);

  const clothPanelShape = new THREE.Shape();
  clothPanelShape.moveTo(-0.18, 0.11);
  clothPanelShape.lineTo(0.16, 0.11);
  clothPanelShape.quadraticCurveTo(0.19, -0.16, 0.1, -0.42);
  clothPanelShape.lineTo(-0.12, -0.46);
  clothPanelShape.quadraticCurveTo(-0.21, -0.15, -0.18, 0.11);
  const skirtPanel = new THREE.ExtrudeGeometry(clothPanelShape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.013,
    bevelThickness: 0.018,
  });
  const frontLoincloth = new THREE.Mesh(skirtPanel, cloth);
  frontLoincloth.position.set(-0.13, 0.75, -0.3);
  frontLoincloth.rotation.y = -0.08;
  frontLoincloth.castShadow = true;
  player.torso.add(frontLoincloth);
  const sideLoincloth = new THREE.Mesh(skirtPanel, paleCloth);
  sideLoincloth.position.set(0.16, 0.75, 0.23);
  sideLoincloth.rotation.y = Math.PI + 0.17;
  sideLoincloth.castShadow = true;
  player.torso.add(sideLoincloth);

  player.cloak = new THREE.Group();
  player.cloak.position.set(0, 1.21, 0.205);
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.285, 12, 8), wornLeather);
  mantle.position.set(-0.31, 0.2, 0.01);
  mantle.scale.set(1.12, 0.74, 0.88);
  mantle.castShadow = true;
  player.cloak.add(mantle);
  for (let fold = 0; fold < 4; fold += 1) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.57 - fold * 0.035, 0.045), fold % 2 ? cloth : paleCloth);
    strip.position.set(-0.28 + fold * 0.145, -0.24, 0.03);
    strip.rotation.z = (fold - 1.5) * 0.065;
    strip.castShadow = true;
    player.cloak.add(strip);
  }
  player.torso.add(player.cloak);

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.235, 13, 9), leather);
  shoulder.position.set(-0.37, 1.45, 0.005);
  shoulder.scale.set(1.22, 0.84, 1.12);
  shoulder.castShadow = true;
  player.torso.add(shoulder);
  for (let plate = 0; plate < 3; plate += 1) {
    const scalePlate = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.19, 3, 7), wornLeather);
    scalePlate.position.set(-0.49 + plate * 0.105, 1.43 + plate * 0.045, -0.158);
    scalePlate.rotation.z = -0.32;
    scalePlate.scale.set(1.08, 1, 0.54);
    player.torso.add(scalePlate);
  }
  for (const side of [-1, 1]) {
    const shoulderRivet = new THREE.Mesh(new THREE.SphereGeometry(0.027, 7, 5), bronze);
    shoulderRivet.position.set(-0.37 + side * 0.13, 1.49, -0.205);
    player.torso.add(shoulderRivet);
  }

  player.head = new THREE.Group();
  player.head.position.set(0, 1.79, -0.005);
  player.torso.add(player.head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.188, 20, 16), skinLight);
  skull.scale.set(0.93, 1.15, 0.89);
  skull.castShadow = true;
  player.head.add(skull);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.051, 10, 8), skin);
  nose.position.set(0, -0.024, -0.169);
  nose.scale.set(0.72, 1.25, 0.9);
  player.head.add(nose);

  const eyes = material(0x372c26, { roughness: 0.65, metalness: 0 });
  player.eyeLids = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.053, 9, 7), skin);
    ear.position.set(side * 0.169, -0.003, -0.008);
    ear.scale.set(0.58, 1.08, 0.72);
    player.head.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 9, 7), eyeWhite);
    eye.position.set(side * 0.071, 0.034, -0.153);
    eye.scale.set(1.12, 0.68, 0.53);
    player.head.add(eye);
    player.eyeLids.push(eye);

    const pupilGroup = new THREE.Group();
    pupilGroup.position.set(side * 0.071, 0.034, -0.171);
    const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), iris);
    const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(0.008, 7, 5), pupil);
    pupilMesh.position.z = -0.012;
    pupilGroup.add(irisMesh, pupilMesh);
    player.head.add(pupilGroup);

    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.07, 3, 7), beard);
    brow.position.set(side * 0.071, 0.082, -0.148);
    brow.rotation.z = side * -0.21;
    player.head.add(brow);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 7), skin);
    cheek.position.set(side * 0.117, -0.074, -0.105);
    cheek.scale.set(1, 0.55, 0.6);
    player.head.add(cheek);
  }

  const beardShape = new THREE.Shape();
  beardShape.moveTo(-0.149, -0.004);
  beardShape.bezierCurveTo(-0.145, -0.09, -0.107, -0.14, -0.074, -0.188);
  beardShape.bezierCurveTo(-0.049, -0.232, -0.029, -0.275, -0.003, -0.298);
  beardShape.bezierCurveTo(0.033, -0.276, 0.052, -0.227, 0.084, -0.188);
  beardShape.bezierCurveTo(0.133, -0.127, 0.147, -0.06, 0.149, 0.004);
  beardShape.quadraticCurveTo(0.07, -0.02, 0, -0.009);
  beardShape.quadraticCurveTo(-0.073, -0.025, -0.149, -0.004);
  const beardMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(beardShape, {
    depth: 0.044,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.013,
    bevelThickness: 0.012,
  }), beard);
  beardMesh.position.set(0, -0.074, -0.139);
  beardMesh.castShadow = true;
  player.head.add(beardMesh);

  for (const side of [-1, 1]) {
    const moustache = new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.067, 4, 8), beardLight);
    moustache.position.set(side * 0.055, -0.027, -0.171);
    moustache.rotation.z = side * -0.38;
    moustache.scale.set(1, 0.86, 0.68);
    player.head.add(moustache);
  }
  for (let tuft = 0; tuft < 3; tuft += 1) {
    const braidedBeard = new THREE.Mesh(new THREE.ConeGeometry(0.029 - tuft * 0.004, 0.12 + tuft * 0.018, 7, 2), beardLight);
    braidedBeard.position.set((tuft - 1) * 0.055, -0.296, -0.157);
    braidedBeard.rotation.z = (tuft - 1) * -0.19;
    player.head.add(braidedBeard);
    if (tuft === 1) {
      const bead = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 8), bronze);
      bead.position.set((tuft - 1) * 0.055, -0.254, -0.19);
      player.head.add(bead);
    }
  }

  const scarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.106, 0.16, -0.138),
    new THREE.Vector3(-0.089, 0.114, -0.166),
    new THREE.Vector3(-0.097, 0.075, -0.177),
  ]);
  player.head.add(new THREE.Mesh(new THREE.TubeGeometry(scarCurve, 10, 0.008, 5, false), material(0x805b49, { roughness: 0.95 })));

  player.rightArm = new THREE.Group();
  player.rightArm.position.set(0.36, 1.42, -0.015);
  player.torso.add(player.rightArm);
  addBone(player.rightArm, [0, 0, 0], [0.06, -0.33, -0.045], 0.142, skinLight, 9);
  addBone(player.rightArm, [0.06, -0.33, -0.045], [0.09, -0.66, -0.13], 0.105, skin, 9);
  for (let wrap = 0; wrap < 4; wrap += 1) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.022, 6, 11), wrap % 2 ? leather : wornLeather);
    band.position.set(0.068, -0.42 - wrap * 0.055, -0.092 - wrap * 0.017);
    band.rotation.x = Math.PI / 2.15;
    player.rightArm.add(band);
  }
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), skin);
  rightHand.position.set(0.09, -0.69, -0.125);
  rightHand.scale.set(0.82, 1, 0.73);
  player.rightArm.add(rightHand);

  player.leftArm = new THREE.Group();
  player.leftArm.position.set(-0.37, 1.39, 0.005);
  player.torso.add(player.leftArm);
  addBone(player.leftArm, [0, 0, 0], [-0.06, -0.34, -0.035], 0.135, skinLight, 9);
  addBone(player.leftArm, [-0.06, -0.34, -0.035], [-0.13, -0.66, -0.11], 0.101, skin, 9);
  for (let wrap = 0; wrap < 3; wrap += 1) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.022, 6, 11), wrap % 2 ? wornLeather : leather);
    band.position.set(-0.079, -0.42 - wrap * 0.06, -0.081 - wrap * 0.018);
    band.rotation.x = Math.PI / 2.2;
    player.leftArm.add(band);
  }

  const buckler = new THREE.Group();
  buckler.position.set(-0.17, -0.52, -0.23);
  const shieldWood = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.27, 0.075, 12), leather);
  shieldWood.rotation.x = Math.PI / 2;
  shieldWood.castShadow = true;
  buckler.add(shieldWood);
  const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.073, 9, 7), bronze);
  shieldBoss.position.z = -0.057;
  shieldBoss.scale.z = 0.48;
  buckler.add(shieldBoss);
  const shieldRim = new THREE.Mesh(new THREE.TorusGeometry(0.244, 0.017, 5, 16), wornLeather);
  shieldRim.position.z = -0.045;
  buckler.add(shieldRim);
  player.leftArm.add(buckler);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.025, 0.26);
  bladeShape.lineTo(-0.055, 0.48);
  bladeShape.lineTo(-0.255, 0.53);
  bladeShape.quadraticCurveTo(-0.54, 0.62, -0.59, 0.82);
  bladeShape.quadraticCurveTo(-0.49, 1.02, -0.28, 0.95);
  bladeShape.quadraticCurveTo(-0.13, 0.87, -0.026, 0.77);
  bladeShape.lineTo(-0.025, 0.26);
  bladeShape.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.065,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.025,
    bevelThickness: 0.022,
  }), material(0x97927d, { roughness: 0.36, metalness: 0.72 }));
  blade.castShadow = true;

  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.95, 9, 2), leather);
  haft.position.set(0.015, 0.33, 0.04);
  haft.castShadow = true;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.059, 0.06, 0.115, 9), iron);
  ferrule.position.set(0.005, 0.79, 0.036);
  for (let wrap = 0; wrap < 5; wrap += 1) {
    const binding = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.008, 5, 9), wornLeather);
    binding.position.set(0.015, -0.02 + wrap * 0.078, 0.04);
    binding.rotation.x = Math.PI / 2;
    blade.add(binding);
  }
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.054, 8, 6), bronze);
  pommel.position.set(0.015, -0.15, 0.04);

  player.weapon = new THREE.Group();
  player.weapon.position.set(0.08, -0.69, -0.14);
  player.weapon.rotation.z = 2.26;
  player.weapon.add(blade, haft, ferrule, pommel);
  player.rightArm.add(player.weapon);

  const bootMat = material(0x342c24, { roughness: 0.95, metalness: 0 });
  const shinMat = material(0x594736, { roughness: 0.93, metalness: 0 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.19, 0.73, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.23, 5, 9), leather);
    thigh.position.y = -0.17;
    thigh.castShadow = true;
    leg.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(side * 0.018, -0.355, -0.01);
    player.knees.push(knee);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.102, 9, 7), skinLight);
    joint.scale.set(1, 0.91, 0.94);
    knee.add(joint);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.093, 0.245, 5, 8), shinMat);
    shin.position.set(0, -0.18, 0.013);
    shin.castShadow = true;
    knee.add(shin);
    for (let wrap = 0; wrap < 2; wrap += 1) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.097, 0.014, 5, 10), leather);
      band.position.set(0, -0.16 - wrap * 0.1, -0.012);
      band.rotation.x = Math.PI / 2;
      knee.add(band);
    }

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.15, 0.34), bootMat);
    foot.position.set(0, -0.39, -0.055);
    foot.castShadow = true;
    knee.add(foot);
    player.feet.push(foot);
    leg.add(knee);
    player.model.add(leg);
    player.legs.push(leg);
  }

  player.root.add(player.model);
  scene.add(player.root);
}

function createCompanion() {
  const skin = material(0xbc9874, { roughness: 0.88, metalness: 0 });
  const hair = material(0x54382a, { roughness: 0.96, metalness: 0 });
  const hairLight = material(0x755039, { roughness: 0.96, metalness: 0 });
  const wool = material(0x726d5c, { roughness: 1, metalness: 0 });
  const tunic = material(0x594432, { roughness: 0.97, metalness: 0 });
  const darkCloth = material(0x40493b, { roughness: 0.98, metalness: 0 });
  const bowWood = material(0x764b30, { roughness: 0.8, metalness: 0 });
  const bowString = material(0xd4c4a5, { roughness: 0.86, metalness: 0 });
  const belt = material(0x413224, { roughness: 0.93, metalness: 0 });
  const shaftMaterial = projectileShaftMaterial;
  const tipMaterial = projectileTipMaterial;

  companion.root.position.set(-1.35, 0, 1.85);
  companion.root.add(makeShadow(0.38, 0.25));
  companion.model.scale.setScalar(0.85);
  companion.root.add(companion.model);

  companion.torso = new THREE.Group();
  companion.model.add(companion.torso);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.205, 0.33, 6, 11), tunic);
  body.position.set(0, 0.86, 0);
  body.scale.set(1.04, 1.08, 0.82);
  body.castShadow = true;
  companion.torso.add(body);
  const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.217, 0.3, 5, 9), darkCloth);
  vest.position.set(0, 0.94, -0.031);
  vest.scale.set(1.02, 0.99, 0.89);
  vest.castShadow = true;
  companion.torso.add(vest);

  const furCollar = new THREE.Mesh(new THREE.TorusGeometry(0.202, 0.073, 7, 13), wool);
  furCollar.position.set(0, 1.105, 0);
  furCollar.rotation.x = Math.PI / 2;
  furCollar.scale.set(1.09, 0.93, 1);
  companion.torso.add(furCollar);

  const sash = new THREE.Mesh(cylinderBetween([-0.2, 1.05, -0.18], [0.19, 0.68, -0.18], 0.033, 0.031, 7), belt);
  companion.torso.add(sash);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.08, 9), belt);
  waist.position.y = 0.65;
  companion.torso.add(waist);

  companion.cloak = new THREE.Group();
  companion.cloak.position.set(0, 1, 0.17);
  const cape = new THREE.Mesh(new THREE.SphereGeometry(0.205, 11, 8), darkCloth);
  cape.position.set(0, -0.17, 0);
  cape.scale.set(1.16, 1.6, 0.45);
  cape.castShadow = true;
  companion.cloak.add(cape);
  const hem = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.034), wool);
  hem.position.set(0, -0.47, -0.018);
  companion.cloak.add(hem);
  companion.torso.add(companion.cloak);

  companion.head = new THREE.Group();
  companion.head.position.set(0, 1.27, -0.01);
  companion.torso.add(companion.head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.153, 16, 12), skin);
  face.scale.set(0.95, 1.05, 0.88);
  face.castShadow = true;
  companion.head.add(face);

  const curls = new THREE.Mesh(new THREE.SphereGeometry(0.158, 14, 10, 0, TAU, 0, Math.PI * 0.66), hair);
  curls.position.set(0, 0.04, 0.017);
  curls.scale.set(1.07, 1.06, 1.02);
  companion.head.add(curls);
  for (let curl = 0; curl < 9; curl += 1) {
    const angle = curl / 9 * TAU;
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.045 + random() * 0.017, 8, 6), curl % 3 ? hair : hairLight);
    tuft.position.set(Math.cos(angle) * 0.123, 0.071 + Math.sin(angle * 1.7) * 0.028, Math.sin(angle) * 0.105);
    tuft.scale.set(1.12, 0.81, 0.95);
    companion.head.add(tuft);
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6), material(0x302721, { roughness: 0.55 }));
    eye.position.set(side * 0.059, 0.017, -0.137);
    companion.head.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), skin);
    cheek.position.set(side * 0.092, -0.036, -0.09);
    cheek.scale.set(1.05, 0.48, 0.58);
    companion.head.add(cheek);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), skin);
  nose.position.set(0, -0.026, -0.143);
  nose.scale.set(0.77, 0.92, 0.78);
  companion.head.add(nose);

  companion.bowArm = new THREE.Group();
  companion.bowArm.position.set(-0.24, 0.99, -0.015);
  companion.torso.add(companion.bowArm);
  addBone(companion.bowArm, [0, 0, 0], [-0.075, 0.035, -0.08], 0.071, skin, 7);
  addBone(companion.bowArm, [-0.075, 0.035, -0.08], [-0.21, 0.09, -0.18], 0.053, tunic, 7);

  const supportArm = new THREE.Group();
  supportArm.position.set(0.24, 0.98, -0.015);
  companion.torso.add(supportArm);
  addBone(supportArm, [0, 0, 0], [0.08, -0.035, -0.04], 0.079, skin, 7);
  addBone(supportArm, [0.08, -0.035, -0.04], [0.19, 0.03, -0.16], 0.057, skin, 7);

  const bowCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.005, 0.47, 0),
    new THREE.Vector3(0.2, 0.33, -0.012),
    new THREE.Vector3(0.28, 0, -0.016),
    new THREE.Vector3(0.2, -0.33, -0.012),
    new THREE.Vector3(-0.005, -0.47, 0),
  ]);
  companion.bow = new THREE.Group();
  companion.bow.position.set(-0.43, 1.02, -0.2);
  companion.bow.add(new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 32, 0.019, 7, false), bowWood));
  const nock = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 5, 8), belt);
  nock.position.set(0.277, 0, -0.018);
  companion.bow.add(nock);
  const stringPoints = [new THREE.Vector3(-0.005, 0.47, 0), new THREE.Vector3(0.244, 0, -0.026), new THREE.Vector3(-0.005, -0.47, 0)];
  companion.bowstring = new THREE.BufferGeometry().setFromPoints(stringPoints);
  companion.bow.add(new THREE.Line(companion.bowstring, bowString));
  companion.torso.add(companion.bow);

  companion.heldArrow = new THREE.Group();
  if (companion.heldArrow) companion.heldArrow.visible = false;
  addArrowComponents(companion.heldArrow, belt, tipMaterial);
  companion.heldArrow.position.set(-0.18, 1.02, -0.25);
  companion.torso.add(companion.heldArrow);

  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.11, 0.43, 8, 2), leatherMaterial(0x493a2e));
  quiver.position.set(0.16, 0.93, 0.195);
  quiver.rotation.z = -0.18;
  quiver.castShadow = true;
  companion.torso.add(quiver);
  for (let arrow = 0; arrow < 4; arrow += 1) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.53, 5), wornLeather);
    shaft.position.set(0.105 + arrow * 0.041, 1.2, 0.2);
    shaft.rotation.z = (arrow - 1.5) * 0.045;
    companion.torso.add(shaft);
    const fletch = new THREE.Mesh(new THREE.ConeGeometry(0.031, 0.078, 4), wool);
    fletch.position.set(shaft.position.x, 1.45, shaft.position.z);
    companion.torso.add(fletch);
  }

  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.117, 0.61, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.19, 4, 7), tunic);
    thigh.position.y = -0.13;
    leg.add(thigh);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.13, 4, 7), leather);
    boot.position.set(0, -0.34, -0.015);
    leg.add(boot);
    thigh.castShadow = true;
    boot.castShadow = true;
    companion.model.add(leg);
    companion.legs.push(leg);
  }

  scene.add(companion.root);
}

function leatherMaterial(color) {
  return material(color, { roughness: 0.94, metalness: 0 });
}

function addArrowComponents(root, shaftMaterial, tipMaterial) {
  const shaft = new THREE.Mesh(arrowShaftGeometry, shaftMaterial);
  root.add(shaft);
  const arrowhead = new THREE.Mesh(arrowheadGeometry, tipMaterial);
  arrowhead.position.y = 0.337;
  root.add(arrowhead);
  for (const side of [-1, 1]) {
    const feather = new THREE.Mesh(arrowFeatherGeometry, arrowFeatherMaterial);
    feather.position.set(side * 0.014, -0.229, 0);
    feather.rotation.y = side * 0.37;
    root.add(feather);
  }
}

function createEnemy(id, wave, angle, radius) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  const palette = [0x777d70, 0x767269, 0x6c7774, 0x807264];
  const skin = material(palette[id % palette.length], { roughness: 0.95, metalness: 0.01 });
  const cloth = material(id % 2 ? 0x332c2a : 0x282e2e, { roughness: 1, metalness: 0.01, side: THREE.DoubleSide });
  const bone = material(0xaaa287, { roughness: 0.86, metalness: 0.01 });
  const dark = material(0x191e20, { roughness: 0.8, metalness: 0.06 });
  const coreMaterial = material(0x633e34, { roughness: 0.82, metalness: 0, emissive: 0x351710, emissiveIntensity: 0.55 });
  const eyeMaterial = material(0xb18452, { roughness: 0.45, metalness: 0, emissive: 0x553319, emissiveIntensity: 0.82 });

  const tunic = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.76, 0.35), cloth);
  tunic.position.y = 1.06;
  tunic.rotation.z = (random() - 0.5) * 0.12;
  tunic.castShadow = true;
  model.add(tunic);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.4, 4, 8), skin);
  torso.position.set(0, 1.3, 0);
  torso.scale.set(1, 1.03, 0.82);
  torso.castShadow = true;
  model.add(torso);

  for (let index = 0; index < 3; index += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.34 - index * 0.035, 0.052, 0.05), bone);
    rib.position.set(0, 1.27 - index * 0.13, -0.195);
    rib.rotation.z = (index - 1) * 0.05;
    model.add(rib);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 11, 8), skin);
  head.position.set(0.015, 1.83, -0.015);
  head.rotation.z = (random() - 0.5) * 0.2;
  head.castShadow = true;
  model.add(head);

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.075, 0.17), dark);
  jaw.position.set(0.015, 1.7, -0.15);
  model.add(jaw);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.029, 8, 6), eyeMaterial);
    eye.position.set(side * 0.072, 1.85, -0.181);
    model.add(eye);
  }

  const wound = new THREE.Mesh(new THREE.IcosahedronGeometry(0.086, 1), coreMaterial);
  wound.position.set(0.06, 1.22, -0.235);
  wound.scale.set(1, 1.18, 0.54);
  model.add(wound);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.3, 1.48, 0);
    model.add(arm);
    addBone(arm, [0, 0, 0], [side * 0.08, -0.37, -0.05], 0.12, skin, 7);
    addBone(arm, [side * 0.08, -0.37, -0.05], [side * 0.1, -0.7, -0.2], 0.083, skin, 7);
    for (let finger = 0; finger < 3; finger += 1) {
      addBone(arm,
        [side * 0.1 + (finger - 1) * 0.035, -0.68, -0.2],
        [side * 0.1 + (finger - 1) * 0.055, -0.83, -0.21],
        0.023,
        bone,
        5,
      );
    }
    arms.push(arm);
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.16, 0.75, 0);
    model.add(leg);
    addBone(leg, [0, 0, 0], [side * 0.03, -0.36, 0.01], 0.12, cloth, 7);
    addBone(leg, [side * 0.03, -0.36, 0.01], [side * 0.02, -0.69, -0.03], 0.085, skin, 7);
    legs.push(leg);
  }

  const woundMat = material(0x51423a, { roughness: 1, metalness: 0 });
  for (let index = 0; index < 4; index += 1) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.1 + random() * 0.13, 0.22 + random() * 0.12, 0.06), woundMat);
    flap.position.set((random() - 0.5) * 0.45, 0.71 + random() * 0.1, -0.19);
    flap.rotation.z = (random() - 0.5) * 0.5;
    model.add(flap);
  }

  const targetRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.026, 5, 24),
    new THREE.MeshBasicMaterial({ color: 0xb65a3c, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  targetRing.rotation.x = Math.PI / 2;
  targetRing.position.y = 0.045;
  root.add(targetRing);
  root.add(makeShadow(0.49, 0.34));
  root.add(model);
  scene.add(root);

  const startX = Math.cos(angle) * radius;
  const startZ = Math.sin(angle) * radius;
  root.position.set(startX, terrainHeight(startX, startZ), startZ);
  model.scale.setScalar(0.92 + random() * 0.15);

  return {
    id,
    root,
    model,
    arms,
    legs,
    heart,
    coreMaterial,
    targetRing,
    velocity: new THREE.Vector3(),
    health: 64 + wave * 9,
    speed: 1.2 + Math.min(wave, 5) * 0.11 + random() * 0.16,
    phase: random() * TAU,
    attackCooldown: 0.65 + random() * 0.85,
    attackWindup: -1,
    stun: 0,
    flash: 0,
    dead: false,
    deathTimer: 0,
    facing: 0,
  };
}

function spawnWave(wave) {
  run.wave = wave;
  run.nextWaveIn = null;
  const count = 3 + wave;
  if (wave > 1) player.health = Math.min(100, player.health + 18);
  if (fallbackContext) {
    const startAngle = random() * TAU;
    for (let index = 0; index < count; index += 1) {
      const angle = startAngle + (index / count) * TAU + (random() - 0.5) * 0.24;
      const radius = 11.7 + random() * 1.7;
      fallback.enemies.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        vx: 0,
        vz: 0,
        health: 64 + wave * 9,
        speed: 1.2 + Math.min(wave, 5) * 0.11 + random() * 0.16,
        phase: random() * TAU,
        attackCooldown: 0.65 + random() * 0.85,
        attackWindup: -1,
        stun: 0,
        flash: 0,
        dead: false,
        deathTimer: 0,
        facing: 0,
      });
    }
    ui.objective.textContent = wave === 5 ? 'Tahan hingga fajar.' : 'Singkirkan setiap mayat.';
    sayToast(wave === 1 ? 'MEREKA DATANG DARI KABUT' : `GEROMBOLAN ${String(wave).padStart(2, '0')} TELAH TIBA`, 2200);
    updateHud();
    return;
  }

  const startAngle = random() * TAU;
  for (let index = 0; index < count; index += 1) {
    const angle = startAngle + (index / count) * TAU + (random() - 0.5) * 0.24;
    const radius = 11.7 + random() * 1.7;
    enemies.push(createEnemy(enemies.length + run.kills + index + wave * 9, wave, angle, radius));
  }
  ui.objective.textContent = wave === 5 ? 'Tahan hingga fajar.' : 'Singkirkan setiap mayat.';
  sayToast(wave === 1 ? 'MEREKA DATANG DARI KABUT' : `GEROMBOLAN ${String(wave).padStart(2, '0')} TELAH TIBA`, 2200);
  updateHud();
}

function clearEnemies() {
  for (const enemy of enemies) scene.remove(enemy.root);
  enemies.length = 0;
  fallback.enemies.length = 0;
  clearArrows();
}

function clearArrows() {
  for (const arrow of arrows) scene.remove(arrow.mesh);
  arrows.length = 0;
  fallback.projectiles.length = 0;
  companion.aimTarget = null;
  companion.aimTimer = 0;
}

function bindControls() {
  ui.start.addEventListener('click', startGame);
  $('#pause-button').addEventListener('click', pauseGame);
  $('#resume-button').addEventListener('click', resumeGame);
  $('#restart-button').addEventListener('click', startGame);
  $('#again-button').addEventListener('click', startGame);
  $('#title-button').addEventListener('click', returnToTitle);

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (mode === 'playing') pauseGame();
      else if (mode === 'paused') resumeGame();
      return;
    }
    if (event.code === 'Enter' && mode === 'menu') {
      startGame();
      return;
    }
    if (mode !== 'playing') return;

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
      heldKeys.add(event.code);
    }
    if (event.repeat) return;
    if (event.code === 'Space') dodge();
    if (event.code === 'KeyF') attack();
  });

  window.addEventListener('keyup', (event) => heldKeys.delete(event.code));
  window.addEventListener('blur', () => heldKeys.clear());
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  ui.canvas.addEventListener('pointerdown', (event) => {
    if (mode !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button === 0) {
      requestPointerLock();
      attack();
    } else if (event.pointerType === 'touch') {
      touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });

  ui.canvas.addEventListener('pointermove', (event) => {
    if (mode !== 'playing') return;
    if (document.pointerLockElement === ui.canvas) {
      cameraYaw -= event.movementX * 0.00225;
    } else if (touchLook?.id === event.pointerId) {
      cameraYaw -= (event.clientX - touchLook.x) * 0.007;
      touchLook.x = event.clientX;
      touchLook.y = event.clientY;
    }
  });
  ui.canvas.addEventListener('pointerup', (event) => {
    if (touchLook?.id === event.pointerId) touchLook = null;
  });
  ui.canvas.addEventListener('pointercancel', () => { touchLook = null; });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === ui.canvas;
    ui.lockHint.classList.toggle('visible', mode === 'playing' && !locked && !isTouchDevice());
    if (locked) run.hasLockedPointer = true;
    else if (mode === 'playing' && run.hasLockedPointer && !isTouchDevice()) pauseGame();
  });

  document.querySelectorAll('[data-move]').forEach((button) => {
    const mapping = { forward: 'KeyW', left: 'KeyA', back: 'KeyS', right: 'KeyD' };
    const key = mapping[button.dataset.move];
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      heldKeys.add(key);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(name, () => heldKeys.delete(key));
    }
  });
  document.querySelector('[data-action="attack"]').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    attack();
  });
  document.querySelector('[data-action="dodge"]').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dodge();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'playing') pauseGame();
  });

  window.addEventListener('resize', resize);
}

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

function requestPointerLock() {
  if (isTouchDevice() || !ui.canvas.requestPointerLock) return;
  try {
    const result = ui.canvas.requestPointerLock();
    if (result?.catch) result.catch(() => {});
  } catch {
    ui.lockHint.classList.add('visible');
  }
}

function startGame() {
  if (!renderer && !fallbackContext) return;
  clearEnemies();
  heldKeys.clear();
  run.wave = 0;
  run.kills = 0;
  run.score = 0;
  run.elapsed = 0;
  run.nextWaveIn = null;
  run.hasLockedPointer = false;
  mode = 'playing';
  player.root.position.set(0, 0, 0);
  player.velocity.set(0, 0, 0);
  player.health = 100;
  player.attackTimer = 0;
  player.attackCooldown = 0;
  player.dodgeTimer = 0;
  player.dodgeCooldown = 0;
  player.invulnerable = 0;
  player.combo = 0;
  player.comboTimer = 0;
  player.lastAttackAt = 0;
  player.hitTargets.clear();
  player.facing = 0;
  player.root.rotation.y = 0;
  player.model.rotation.set(0, 0, 0);
  player.model.position.set(0, 0, 0);
  companion.root.position.set(-1.35, 0, 1.85);
  companion.root.rotation.y = 0;
  companion.velocity.set(0, 0, 0);
  companion.shotCooldown = 1.55;
  companion.aimTimer = 0;
  companion.aimTarget = null;
  if (companion.heldArrow) companion.heldArrow.visible = false;
  fallback.companionShotCooldown = 1.6;
  cameraYaw = 0;
  ui.title.classList.add('is-hidden');
  ui.pause.classList.add('is-hidden');
  ui.end.classList.add('is-hidden');
  ui.end.classList.remove('victory');
  ui.hud.classList.remove('is-hidden');
  $('#touch-controls').classList.remove('is-hidden');
  $('#combo-panel').classList.add('is-hidden');
  beginAudio();
  spawnWave(1);
  requestPointerLock();
}

function pauseGame() {
  if (mode !== 'playing') return;
  mode = 'paused';
  heldKeys.clear();
  ui.pause.classList.remove('is-hidden');
  $('#touch-controls').classList.add('is-hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function resumeGame() {
  if (mode !== 'paused') return;
  mode = 'playing';
  ui.pause.classList.add('is-hidden');
  $('#touch-controls').classList.remove('is-hidden');
  requestPointerLock();
}

function returnToTitle() {
  mode = 'menu';
  heldKeys.clear();
  clearEnemies();
  ui.end.classList.add('is-hidden');
  ui.hud.classList.add('is-hidden');
  ui.title.classList.remove('is-hidden');
  $('#touch-controls').classList.add('is-hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function beginAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
}

function tone(startFrequency, endFrequency, duration, loudness = 0.035, type = 'triangle') {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(18, endFrequency), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(loudness, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function attack() {
  if (mode !== 'playing' || player.attackCooldown > 0) return;
  if (fallbackContext) {
    player.attackTimer = 0.42;
    player.attackCooldown = 0.47;
    player.facing = cameraYaw;
    fallback.swingHit = false;
    player.hitTargets.clear();
    tone(245, 94, 0.16, 0.025, 'sawtooth');
    return;
  }

  player.attackTimer = 0.57;
  player.attackCooldown = 0.65;
  player.facing = cameraYaw;
  player.root.rotation.y = cameraYaw;
  player.hitTargets.clear();
  tone(245, 94, 0.16, 0.025, 'sawtooth');
}

function registerHit() {
  const now = performance.now() / 1000;
  player.combo = now - player.lastAttackAt < 1.25 ? Math.min(player.combo + 1, 9) : 1;
  player.lastAttackAt = now;
  player.comboTimer = 1.4;
  run.score += (20 + player.combo * 5) * Math.max(1, run.wave);
  updateHud();
  return player.combo;
}

function tickCombo(delta) {
  if (player.comboTimer <= 0) return;
  player.comboTimer = Math.max(0, player.comboTimer - delta);
  if (player.comboTimer === 0 && player.combo > 0) {
    player.combo = 0;
    updateHud();
  }
}

function dodge() {
  if (mode !== 'playing' || player.dodgeCooldown > 0) return;
  const direction = movementDirection();
  if (direction.lengthSq() < 0.001) {
    direction.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  }
  player.dodgeDirection.copy(direction.normalize());
  player.dodgeTimer = 0.27;
  player.dodgeCooldown = 0.86;
  player.invulnerable = 0.58;
  player.velocity.copy(player.dodgeDirection).multiplyScalar(9.2);
  const origin = player.root.position.clone();
  origin.y += 0.65;
  burst(origin, 0x83b4c1, 11, 2.7);
  tone(150, 62, 0.12, 0.026, 'triangle');
  cameraShake = Math.max(cameraShake, 0.12);
}

function movementDirection() {
  const forward = (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') ? 1 : 0)
    - (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') ? 1 : 0);
  const sideways = (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') ? 1 : 0)
    - (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') ? 1 : 0);
  const direction = new THREE.Vector3(
    Math.cos(cameraYaw) * sideways - Math.sin(cameraYaw) * forward,
    0,
    -Math.sin(cameraYaw) * sideways - Math.cos(cameraYaw) * forward,
  );
  if (direction.lengthSq() > 1) direction.normalize();
  return direction;
}

function updatePlayer(delta) {
  player.attackCooldown = Math.max(0, player.attackCooldown - delta);
  player.attackTimer = Math.max(0, player.attackTimer - delta);
  player.dodgeCooldown = Math.max(0, player.dodgeCooldown - delta);
  player.dodgeTimer = Math.max(0, player.dodgeTimer - delta);
  player.invulnerable = Math.max(0, player.invulnerable - delta);
  tickCombo(delta);

  const direction = movementDirection();
  player.walking = direction.lengthSq() > 0.025;
  if (player.dodgeTimer > 0) {
    const dash = player.dodgeDirection.clone().multiplyScalar(8.1);
    player.velocity.lerp(dash, 1 - Math.exp(-17 * delta));
  } else {
    const desired = direction.clone().multiplyScalar(4.1);
    player.velocity.lerp(desired, 1 - Math.exp(-(player.walking ? 8.4 : 6.1) * delta));
  }

  player.root.position.x += player.velocity.x * delta;
  player.root.position.z += player.velocity.z * delta;
  limitToArena(player.root.position, player.velocity);
  player.root.position.y = terrainHeight(player.root.position.x, player.root.position.z);

  if (player.walking && player.dodgeTimer <= 0 && player.attackTimer <= 0) {
    player.facing = Math.atan2(-direction.x, -direction.z);
  }
  player.root.rotation.y = lerpAngle(player.root.rotation.y, player.facing, 1 - Math.exp(-13 * delta));

  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  const gaitBlend = THREE.MathUtils.clamp(speed / 2.7, 0, 1);
  const gaitRate = elapsed * (5.6 + speed * 1.9);
  const stride = Math.sin(gaitRate);
  const gait = stride * 0.43 * gaitBlend;
  player.model.position.y = Math.abs(stride) * 0.035 * gaitBlend;
  const localSideSpeed = player.velocity.x * Math.cos(player.root.rotation.y) - player.velocity.z * Math.sin(player.root.rotation.y);
  const localForwardSpeed = player.velocity.x * -Math.sin(player.root.rotation.y) - player.velocity.z * Math.cos(player.root.rotation.y);
  player.model.rotation.z = THREE.MathUtils.damp(player.model.rotation.z, -localSideSpeed * 0.035, 6.5, delta);
  player.model.rotation.x = THREE.MathUtils.damp(player.model.rotation.x, -localForwardSpeed * 0.025, 6.5, delta);
  player.torso.rotation.x = Math.sin(elapsed * 1.7) * 0.014 + gaitBlend * 0.025;
  player.torso.rotation.y = THREE.MathUtils.damp(player.torso.rotation.y, 0, 5.5, delta);
  player.cloak.rotation.x = -0.06 - gaitBlend * 0.1 + Math.sin(elapsed * 2.4) * 0.035;
  player.cloak.rotation.z = Math.sin(elapsed * 1.9 + 0.8) * 0.018 + localSideSpeed * 0.012;
  player.legs[0].rotation.x = gait;
  player.legs[1].rotation.x = -gait;
  player.knees[0].rotation.x = Math.max(0, -stride) * gaitBlend * 0.48;
  player.knees[1].rotation.x = Math.max(0, stride) * gaitBlend * 0.48;
  player.feet[0].rotation.x = -player.knees[0].rotation.x * 0.58 - gait * 0.16;
  player.feet[1].rotation.x = -player.knees[1].rotation.x * 0.58 + gait * 0.16;
  player.leftArm.rotation.x = player.walking ? -gait * 0.37 : 0.035 + Math.sin(elapsed * 1.7) * 0.012;
  player.rightArm.rotation.x = player.walking ? gait * 0.28 : -0.015;

  let lookYaw = 0;
  let closest = Infinity;
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const dx = enemy.root.position.x - player.root.position.x;
    const dz = enemy.root.position.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < closest) {
      closest = distance;
      lookYaw = THREE.MathUtils.clamp(lerpAngle(player.root.rotation.y, Math.atan2(-dx, -dz), 1) - player.root.rotation.y, -0.33, 0.33);
    }
  }
  player.head.rotation.y = THREE.MathUtils.damp(player.head.rotation.y, lookYaw, 4.8, delta);
  const blink = Math.pow(Math.max(0, Math.sin(elapsed * 0.87 + 0.52)), 56);
  for (const eye of player.eyeLids) eye.scale.y = 0.68 * (1 - blink * 0.84);

  if (player.attackTimer > 0) {
    const progress = 1 - player.attackTimer / 0.57;
    const windup = 1 - THREE.MathUtils.smoothstep(progress, 0.04, 0.32);
    const swing = Math.sin(THREE.MathUtils.smoothstep(progress, 0.23, 0.79) * Math.PI);
    player.weapon.rotation.z = 2.26 + windup * 0.58 - swing * 2.48;
    player.weapon.rotation.y = -0.18 - swing * 0.53;
    player.rightArm.rotation.x = -0.18 - windup * 0.44 - swing * 0.48;
    player.rightArm.rotation.z = -windup * 0.24 + swing * 0.18;
    player.torso.rotation.y = -windup * 0.22 + swing * 0.31;
    player.torso.rotation.x = -windup * 0.04 + swing * 0.055;
    if (progress > 0.24 && progress < 0.69) resolveSwing();
  } else {
    player.weapon.rotation.z = THREE.MathUtils.damp(player.weapon.rotation.z, 2.26, 9, delta);
    player.weapon.rotation.y = THREE.MathUtils.damp(player.weapon.rotation.y, 0, 8, delta);
    player.rightArm.rotation.z = THREE.MathUtils.damp(player.rightArm.rotation.z, 0, 8, delta);
  }

  if (player.invulnerable > 0) {
    player.model.visible = Math.sin(elapsed * 39) > -0.25;
  } else {
    player.model.visible = true;
  }
}

function nearestCompanionTarget(maximumDistance) {
  let target = null;
  let nearest = maximumDistance;
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const distance = companion.root.position.distanceTo(enemy.root.position);
    if (distance < nearest) {
      nearest = distance;
      target = enemy;
    }
  }
  return target;
}

function updateCompanion(delta) {
  const yaw = player.root.rotation.y;
  const offset = new THREE.Vector3(
    Math.sin(yaw) * 1.75 - Math.cos(yaw) * 1.28,
    0,
    Math.cos(yaw) * 1.75 + Math.sin(yaw) * 1.28,
  );
  const desired = player.root.position.clone().add(offset);
  const closeEnemy = nearestCompanionTarget(2.1);
  if (closeEnemy) {
    const escape = new THREE.Vector3().subVectors(companion.root.position, closeEnemy.root.position);
    if (escape.lengthSq() > 0.01) desired.add(escape.normalize().multiplyScalar(1.55));
  }
  const toDesired = desired.sub(companion.root.position);
  const followDistance = toDesired.length();
  const targetSpeed = followDistance > 4.1 ? 4.8 : followDistance > 1.45 ? 2.65 : 0;
  if (followDistance > 0.01) toDesired.multiplyScalar(targetSpeed / followDistance);
  companion.velocity.lerp(toDesired, 1 - Math.exp(-5.8 * delta));
  companion.root.position.addScaledVector(companion.velocity, delta);
  limitToArena(companion.root.position, companion.velocity);
  companion.root.position.y = terrainHeight(companion.root.position.x, companion.root.position.z);

  const target = nearestCompanionTarget(10.5);
  companion.aimTarget = target;
  companion.aimTimer = Math.max(0, companion.aimTimer - delta);
  companion.shotCooldown = Math.max(0, companion.shotCooldown - delta);
  companion.aiming = Boolean(target && (companion.aimTimer > 0 || companion.shotCooldown <= 0));

  let facing = Math.atan2(-offset.x, -offset.z);
  if (companion.aiming && target) {
    const dx = target.root.position.x - companion.root.position.x;
    const dz = target.root.position.z - companion.root.position.z;
    facing = Math.atan2(-dx, -dz);
  } else if (followDistance > 1.9) {
    facing = Math.atan2(-companion.velocity.x, -companion.velocity.z);
  }
  companion.root.rotation.y = lerpAngle(companion.root.rotation.y, facing, 1 - Math.exp(-6.2 * delta));

  const movement = THREE.MathUtils.clamp(companion.velocity.length() / 3.5, 0, 1);
  companion.phase += delta * (4.7 + companion.velocity.length() * 2.3);
  const gait = Math.sin(companion.phase) * 0.37 * movement;
  companion.model.position.y = Math.abs(Math.sin(companion.phase)) * 0.028 * movement;
  companion.legs[0].rotation.x = gait;
  companion.legs[1].rotation.x = -gait;
  companion.torso.rotation.x = Math.sin(elapsed * 1.8 + 1.4) * 0.018 - (companion.aiming ? 0.075 : movement * 0.025);
  companion.head.rotation.y = THREE.MathUtils.damp(companion.head.rotation.y, companion.aiming ? -0.08 : Math.sin(elapsed * 0.37) * 0.13, 4, delta);
  companion.cloak.rotation.x = -movement * 0.15 + Math.sin(companion.phase * 0.45) * 0.035;
  companion.cloak.rotation.z = Math.sin(companion.phase * 0.3) * 0.024;
  companion.bowArm.rotation.z = companion.aiming ? -0.14 : Math.sin(elapsed * 1.6) * 0.014;
  companion.bow.rotation.z = companion.aiming ? 0.055 : 0;

  const stringPosition = companion.bowstring.attributes.position;
  stringPosition.setXYZ(1, 0.244 + (companion.aiming ? 0.16 : 0.01), -0.035, -0.028);
  stringPosition.needsUpdate = true;
  companion.heldArrow.visible = companion.aiming;
  if (companion.aiming && target && companion.shotCooldown <= 0) launchArrow(target);
}

function launchArrow(target) {
  if (target.dead) return;
  const mesh = new THREE.Group();
  addArrowComponents(mesh, projectileShaftMaterial, projectileTipMaterial);
  const origin = companion.root.position.clone();
  origin.y += 1.03;
  const impact = target.root.position.clone();
  impact.y += 1.12;
  const travelTime = Math.max(origin.distanceTo(impact) / 11.8, 0.32);
  const velocity = new THREE.Vector3(
    (impact.x - origin.x) / travelTime,
    (impact.y - origin.y + 1.5 * travelTime * travelTime) / travelTime,
    (impact.z - origin.z) / travelTime,
  );
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), velocity.clone().normalize());
  mesh.traverse((part) => {
    if (part.isMesh) part.castShadow = true;
  });
  scene.add(mesh);
  arrows.push({ mesh, velocity, age: 0 });
  companion.aimTimer = 0.5;
  companion.shotCooldown = 2.5 + random() * 0.35;
  companion.heldArrow.visible = false;
  tone(325, 184, 0.09, 0.012, 'triangle');
}

function updateArrows(delta) {
  for (let index = arrows.length - 1; index >= 0; index -= 1) {
    const arrow = arrows[index];
    arrow.age += delta;
    arrow.velocity.y -= 3 * delta;
    arrow.mesh.position.addScaledVector(arrow.velocity, delta);
    arrow.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrow.velocity.clone().normalize());

    let struck = false;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const target = enemy.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
      if (arrow.mesh.position.distanceToSquared(target) > 0.34 * 0.34) continue;
      enemy.health -= 18;
      enemy.stun = Math.max(enemy.stun, 0.63);
      enemy.attackWindup = -1;
      enemy.flash = 0.14;
      const push = new THREE.Vector3(arrow.velocity.x, 0, arrow.velocity.z).normalize().multiplyScalar(1.55);
      enemy.velocity.add(push);
      burst(target, 0x9a9679, 5, 1.4);
      if (enemy.health <= 0) killEnemy(enemy);
      struck = true;
      break;
    }

    const grounded = arrow.mesh.position.y < terrainHeight(arrow.mesh.position.x, arrow.mesh.position.z) + 0.04;
    if (struck || grounded || arrow.age > 1.7) {
      scene.remove(arrow.mesh);
      arrows.splice(index, 1);
    }
  }
}

function createIdleActorMotion(delta) {
  player.model.position.y = THREE.MathUtils.damp(player.model.position.y, Math.sin(elapsed * 1.3) * 0.008, 2, delta);
  player.torso.rotation.x = Math.sin(elapsed * 1.7) * 0.013;
  player.head.rotation.y = THREE.MathUtils.damp(player.head.rotation.y, Math.sin(elapsed * 0.42) * 0.11, 1.6, delta);
  player.cloak.rotation.x = -0.045 + Math.sin(elapsed * 1.9) * 0.03;
  companion.model.position.y = Math.sin(elapsed * 1.2 + 0.6) * 0.006;
  companion.torso.rotation.x = Math.sin(elapsed * 1.6 + 1.3) * 0.015;
  companion.head.rotation.y = THREE.MathUtils.damp(companion.head.rotation.y, Math.sin(elapsed * 0.37) * 0.12, 1.4, delta);
  companion.cloak.rotation.z = Math.sin(elapsed * 1.1 + 0.8) * 0.025;
}

function resolveSwing() {
  const frontX = -Math.sin(player.root.rotation.y);
  const frontZ = -Math.cos(player.root.rotation.y);

  for (const enemy of enemies) {
    if (enemy.dead || player.hitTargets.has(enemy)) continue;
    const dx = enemy.root.position.x - player.root.position.x;
    const dz = enemy.root.position.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 2.55 || distance < 0.01) continue;
    const forwardDot = (dx * frontX + dz * frontZ) / distance;
    if (forwardDot < -0.04) continue;

    player.hitTargets.add(enemy);
    const combo = registerHit();
    const damage = 35 + Math.min(combo, 4) * 3;
    enemy.health -= damage;
    enemy.stun = 0.3;
    enemy.attackWindup = -1;
    enemy.velocity.x += (dx / distance) * 5.7;
    enemy.velocity.z += (dz / distance) * 5.7;
    enemy.flash = 0.16;
    enemy.coreMaterial.emissiveIntensity = 4.4;
    const impact = enemy.root.position.clone();
    impact.y += 1.05;
    burst(impact, 0xa7c4b5, 9, 3.6);
    tone(118, 48, 0.13, 0.045, 'triangle');
    cameraShake = Math.max(cameraShake, 0.18);
    if (enemy.health <= 0) killEnemy(enemy);
  }
}

function killEnemy(enemy) {
  if (enemy.dead) return;
  enemy.dead = true;
  enemy.deathTimer = 0.64;
  enemy.attackWindup = -1;
  run.kills += 1;
  run.score += 75 * Math.max(1, run.wave);
  player.health = Math.min(100, player.health + 6);
  const origin = enemy.root.position.clone();
  origin.y += 1.12;
  burst(origin, 0xe98554, 26, 4.6);
  tone(85, 31, 0.22, 0.045, 'sawtooth');
  updateHud();
}

function updateEnemies(delta) {
  for (const enemy of enemies) {
    if (enemy.dead) {
      enemy.deathTimer -= delta;
      enemy.model.rotation.z = THREE.MathUtils.damp(enemy.model.rotation.z, 1.18, 4.5, delta);
      enemy.model.position.y = THREE.MathUtils.damp(enemy.model.position.y, -0.7, 5, delta);
      enemy.model.scale.multiplyScalar(Math.max(0, 1 - delta * 0.78));
      if (enemy.deathTimer <= 0) scene.remove(enemy.root);
      continue;
    }

    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
    enemy.stun = Math.max(0, enemy.stun - delta);
    enemy.flash = Math.max(0, enemy.flash - delta);
    enemy.coreMaterial.emissiveIntensity = enemy.flash > 0 ? 4.3 : 2.2;

    const dx = player.root.position.x - enemy.root.position.x;
    const dz = player.root.position.z - enemy.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.01) enemy.facing = Math.atan2(-dx, -dz);
    enemy.root.rotation.y = lerpAngle(enemy.root.rotation.y, enemy.facing, 1 - Math.exp(-5.5 * delta));

    let desiredX = 0;
    let desiredZ = 0;
    if (enemy.attackWindup >= 0) {
      const remaining = enemy.attackWindup;
      enemy.attackWindup -= delta;
      if (remaining > 0 && enemy.attackWindup <= 0) {
        enemy.attackWindup = -1;
        if (distance < 2.1) damagePlayer(10 + Math.min(run.wave, 5) * 1.25);
        enemy.attackCooldown = 1.55 + random() * 0.65;
      }
    } else if (enemy.stun <= 0 && distance > 1.72) {
      desiredX = (dx / Math.max(distance, 0.01)) * enemy.speed;
      desiredZ = (dz / Math.max(distance, 0.01)) * enemy.speed;
    } else if (enemy.stun <= 0 && enemy.attackCooldown <= 0 && distance < 2.05) {
      enemy.attackWindup = 0.57;
    }

    enemy.velocity.x += (desiredX - enemy.velocity.x) * (1 - Math.exp(-7.2 * delta));
    enemy.velocity.z += (desiredZ - enemy.velocity.z) * (1 - Math.exp(-7.2 * delta));
    enemy.root.position.x += enemy.velocity.x * delta;
    enemy.root.position.z += enemy.velocity.z * delta;
    limitToArena(enemy.root.position, enemy.velocity);
    enemy.root.position.y = terrainHeight(enemy.root.position.x, enemy.root.position.z);

    const stride = enemy.stun > 0 ? 0 : Math.sin(elapsed * (distance > 1.75 ? 7.4 : 3.2) + enemy.phase) * 0.48;
    enemy.model.position.y = Math.abs(Math.sin(elapsed * 4.7 + enemy.phase)) * 0.035;
    enemy.legs[0].rotation.x = stride;
    enemy.legs[1].rotation.x = -stride;
    const windup = enemy.attackWindup > 0 ? 1 - enemy.attackWindup / 0.57 : 0;
    enemy.arms[0].rotation.x = -0.12 - windup * 0.86 + stride * 0.22;
    enemy.arms[1].rotation.x = -0.1 - windup * 0.62 - stride * 0.22;
    enemy.targetRing.material.opacity = enemy.attackWindup > 0 ? 0.62 : 0.24;
    const pulse = 1 + (enemy.attackWindup > 0 ? Math.sin(elapsed * 20) * 0.09 : Math.sin(elapsed * 2.2 + enemy.phase) * 0.035);
    enemy.targetRing.scale.setScalar(pulse);
  }

  separateEnemies(delta);
  collidePlayerWithEnemies();
  for (let index = enemies.length - 1; index >= 0; index -= 1) {
    if (enemies[index].dead && enemies[index].deathTimer <= 0) enemies.splice(index, 1);
  }
}

function separateEnemies(delta) {
  for (let first = 0; first < enemies.length; first += 1) {
    const a = enemies[first];
    if (a.dead) continue;
    for (let second = first + 1; second < enemies.length; second += 1) {
      const b = enemies[second];
      if (b.dead) continue;
      let dx = b.root.position.x - a.root.position.x;
      let dz = b.root.position.z - a.root.position.z;
      let distance = Math.hypot(dx, dz);
      if (distance >= 0.72) continue;
      if (distance < 0.001) {
        dx = 0.01;
        dz = 0;
        distance = 0.01;
      }
      const push = (0.72 - distance) * Math.min(0.55, delta * 11);
      const nx = dx / distance;
      const nz = dz / distance;
      a.root.position.x -= nx * push;
      a.root.position.z -= nz * push;
      b.root.position.x += nx * push;
      b.root.position.z += nz * push;
    }
  }
}

function collidePlayerWithEnemies() {
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const dx = enemy.root.position.x - player.root.position.x;
    const dz = enemy.root.position.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.63 || distance > 1) continue;
    const force = (1 - distance) * 0.018;
    enemy.root.position.x += (dx / distance) * force;
    enemy.root.position.z += (dz / distance) * force;
  }
}

function limitToArena(position, velocity) {
  const distance = Math.hypot(position.x, position.z);
  if (distance <= ARENA_LIMIT) return;
  const nx = position.x / distance;
  const nz = position.z / distance;
  position.x = nx * ARENA_LIMIT;
  position.z = nz * ARENA_LIMIT;
  const outward = velocity.x * nx + velocity.z * nz;
  if (outward > 0) {
    velocity.x -= outward * nx;
    velocity.z -= outward * nz;
  }
}

function damagePlayer(amount) {
  if (player.invulnerable > 0 || mode !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  player.invulnerable = 1;
  cameraShake = Math.max(cameraShake, 0.42);
  ui.damage.classList.remove('active');
  void ui.damage.offsetWidth;
  ui.damage.classList.add('active');
  tone(76, 35, 0.19, 0.065, 'sawtooth');
  updateHud();
  if (player.health <= 0) finishGame(false);
}

function updateWaves(delta) {
  const liveEnemies = fallbackContext ? fallback.enemies : enemies;
  const living = liveEnemies.some((enemy) => !enemy.dead);
  if (living) {
    run.nextWaveIn = null;
    return;
  }

  if (run.nextWaveIn === null) {
    if (run.wave >= 5) {
      finishGame(true);
      return;
    }
    run.nextWaveIn = 3.1;
    const waveBonus = 250 * run.wave;
    run.score += waveBonus;
    ui.objective.textContent = 'Gelombang berikutnya mendekat.';
    sayToast(`+${formatScore(waveBonus)} POIN  ·  KEHENINGAN TAK AKAN BERTAHAN`, 2100);
    updateHud();
  }

  run.nextWaveIn -= delta;
  if (run.nextWaveIn <= 0) spawnWave(run.wave + 1);
}

function finishGame(victory) {
  if (mode !== 'playing') return;
  const recordBeaten = saveBestRun();
  mode = 'ended';
  heldKeys.clear();
  $('#touch-controls').classList.add('is-hidden');
  ui.end.classList.remove('is-hidden');
  ui.end.classList.toggle('victory', victory);
  if (victory) {
    ui.endKicker.textContent = 'API MASIH MENYALA';
    ui.endTitle.innerHTML = 'Fajar<br /><em>menyambut.</em>';
    ui.endCopy.textContent = `Lima gerombolan tumbang. ${run.kills} mayat ditaklukkan, skor ${formatScore(run.score)} poin.${recordBeaten ? ' Rekor baru!' : ''}`;
    tone(310, 620, 0.62, 0.045, 'sine');
  } else {
    ui.endKicker.textContent = 'MALAM MENELAN SEGALANYA';
    ui.endTitle.innerHTML = 'Api<br /><em>meredup.</em>';
    ui.endCopy.textContent = `Perburuan berakhir dengan ${run.kills} musuh tumbang dan skor ${formatScore(run.score)} poin.${recordBeaten ? ' Rekor baru!' : ''} Bangkit dan coba lagi.`;
    tone(110, 37, 0.75, 0.055, 'triangle');
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function updateHud() {
  if (!ui.health) return;
  const health = Math.round(player.health);
  ui.health.style.width = `${health}%`;
  ui.health.classList.toggle('critical', health <= 30);
  ui.healthValue.textContent = String(health).padStart(3, '0');
  const liveEnemies = fallbackContext ? fallback.enemies : enemies;
  ui.enemyCount.textContent = `${String(liveEnemies.filter((enemy) => !enemy.dead).length).padStart(2, '0')} MUSUH`;
  ui.killCount.textContent = String(run.kills).padStart(2, '0');
  ui.waveNumber.textContent = String(Math.max(1, run.wave)).padStart(2, '0');
  ui.comboCount.textContent = String(player.combo).padStart(2, '0');
  ui.combo.classList.toggle('is-hidden', player.combo < 2 || mode !== 'playing');
  ui.score.textContent = formatScore(run.score);
  ui.bestScore.textContent = `REKOR ${formatScore(run.record.score)}`;
  if (run.record.score > 0) {
    ui.recordSummary.textContent = `REKOR ${formatScore(run.record.score)} POIN  ·  GELOMBANG ${String(run.record.wave).padStart(2, '0')}  ·  ${String(run.record.kills).padStart(2, '0')} MAYAT`;
  } else {
    ui.recordSummary.textContent = 'REKOR MENUNGGU  ·  RAIH SKOR TERBAIK';
  }
}

function saveBestRun() {
  if (run.score <= run.record.score) return false;
  run.record = { score: run.score, kills: run.kills, wave: run.wave };
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(run.record));
  } catch {
    // Keep the current-session record even when storage is unavailable.
  }
  updateHud();
  return true;
}

function sayToast(message, duration = 1700) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  toastTimer = duration / 1000;
}

function lerpAngle(current, target, blend) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * blend;
}

function updateAmbient(delta) {
  elapsed += delta;
  for (const torch of torches) {
    const flicker = 0.9 + Math.sin(elapsed * 13 + torch.phase) * 0.12 + Math.sin(elapsed * 27 + torch.phase) * 0.06;
    torch.flame.scale.y = 1.14 + Math.sin(elapsed * 8 + torch.phase) * 0.12;
    torch.flame.rotation.z = Math.sin(elapsed * 5 + torch.phase) * 0.16;
    torch.light.intensity = 10 * flicker;
  }
  if (renderer && mode !== 'playing') createIdleActorMotion(delta);
  updateParticles(delta);
  if (toastTimer > 0) {
    toastTimer -= delta;
    if (toastTimer <= 0) ui.toast.classList.remove('is-visible');
  }
  cameraShake = Math.max(0, cameraShake - delta * 1.9);
}

function updateCamera(delta, timestamp) {
  const idleOrbit = mode === 'menu' ? Math.sin(timestamp * 0.00017) * 0.11 : 0;
  const yaw = cameraYaw + idleOrbit;
  const playerPosition = player.root.position;
  const distance = window.innerWidth < 760 ? 8.1 : 8.7;
  const height = window.innerWidth < 760 ? 4.6 : 4.9;
  const desired = new THREE.Vector3(
    playerPosition.x + Math.sin(yaw) * distance,
    playerPosition.y + height,
    playerPosition.z + Math.cos(yaw) * distance,
  );

  if (camera.position.lengthSq() < 0.1) camera.position.copy(desired);
  camera.position.lerp(desired, 1 - Math.exp(-4.3 * delta));
  if (cameraShake > 0.001) {
    camera.position.x += (random() - 0.5) * cameraShake;
    camera.position.y += (random() - 0.5) * cameraShake * 0.55;
  }
  camera.lookAt(playerPosition.x, playerPosition.y + 1.05, playerPosition.z);
}

function update(delta) {
  if (mode !== 'playing') return;
  if (fallbackContext) {
    updateFallback(delta);
    return;
  }
  run.elapsed += delta;
  updatePlayer(delta);
  updateEnemies(delta);
  updateCompanion(delta);
  updateArrows(delta);
  updateWaves(delta);
  if (Math.floor(run.elapsed * 8) !== Math.floor((run.elapsed - delta) * 8)) updateHud();
}

function frame(timestamp) {
  requestAnimationFrame(frame);
  const delta = previousFrame === 0 ? 0 : Math.min((timestamp - previousFrame) / 1000, 0.05);
  previousFrame = timestamp;

  if (mode === 'playing') {
    accumulator = Math.min(accumulator + delta, 0.15);
    while (accumulator >= STEP) {
      update(STEP);
      accumulator -= STEP;
    }
  } else {
    accumulator = 0;
  }

  updateAmbient(delta);
  updateCamera(delta, timestamp);
  if (renderer && composer) composer.render(delta);
  else if (renderer) renderer.render(scene, camera);
  else if (fallbackContext) drawFallback(timestamp);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (fallbackContext) {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    ui.canvas.width = Math.round(width * ratio);
    ui.canvas.height = Math.round(height * ratio);
    fallbackContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  if (!renderer) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 760 ? 1.25 : 1.65));
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
}

function updateFallback(delta) {
  run.elapsed += delta;
  player.attackCooldown = Math.max(0, player.attackCooldown - delta);
  player.attackTimer = Math.max(0, player.attackTimer - delta);
  player.dodgeCooldown = Math.max(0, player.dodgeCooldown - delta);
  player.dodgeTimer = Math.max(0, player.dodgeTimer - delta);
  player.invulnerable = Math.max(0, player.invulnerable - delta);
  tickCombo(delta);

  const direction = movementDirection();
  player.walking = direction.lengthSq() > 0.025;
  const targetSpeed = player.dodgeTimer > 0 ? 8.1 : 4.1;
  const target = player.dodgeTimer > 0
    ? player.dodgeDirection.clone().multiplyScalar(targetSpeed)
    : direction.clone().multiplyScalar(targetSpeed);
  player.velocity.lerp(target, 1 - Math.exp(-(player.dodgeTimer > 0 ? 17 : player.walking ? 8.4 : 6.1) * delta));
  player.root.position.x += player.velocity.x * delta;
  player.root.position.z += player.velocity.z * delta;
  limitToArena(player.root.position, player.velocity);
  player.root.position.y = terrainHeight(player.root.position.x, player.root.position.z);

  if (player.walking && player.dodgeTimer <= 0 && player.attackTimer <= 0) {
    player.facing = Math.atan2(-direction.x, -direction.z);
  }
  player.root.rotation.y = player.facing;
  updateFallbackCompanion(delta);

  if (player.attackTimer > 0 && !fallback.swingHit && 1 - player.attackTimer / 0.42 > 0.22) {
    fallback.swingHit = true;
    resolveFallbackSwing();
  }

  for (const enemy of fallback.enemies) {
    if (enemy.dead) {
      enemy.deathTimer -= delta;
      continue;
    }

    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
    enemy.stun = Math.max(0, enemy.stun - delta);
    enemy.flash = Math.max(0, enemy.flash - delta);
    const dx = player.root.position.x - enemy.x;
    const dz = player.root.position.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.01) enemy.facing = Math.atan2(-dx, -dz);

    let targetX = 0;
    let targetZ = 0;
    if (enemy.attackWindup >= 0) {
      const remaining = enemy.attackWindup;
      enemy.attackWindup -= delta;
      if (remaining > 0 && enemy.attackWindup <= 0) {
        enemy.attackWindup = -1;
        if (distance < 2.1) damagePlayer(10 + Math.min(run.wave, 5) * 1.25);
        enemy.attackCooldown = 1.55 + random() * 0.65;
      }
    } else if (enemy.stun <= 0 && distance > 1.72) {
      targetX = (dx / Math.max(distance, 0.01)) * enemy.speed;
      targetZ = (dz / Math.max(distance, 0.01)) * enemy.speed;
    } else if (enemy.stun <= 0 && enemy.attackCooldown <= 0 && distance < 2.05) {
      enemy.attackWindup = 0.57;
    }

    enemy.vx += (targetX - enemy.vx) * (1 - Math.exp(-7.2 * delta));
    enemy.vz += (targetZ - enemy.vz) * (1 - Math.exp(-7.2 * delta));
    enemy.x += enemy.vx * delta;
    enemy.z += enemy.vz * delta;
    limitFallbackEnemy(enemy);
    if (mode !== 'playing') break;
  }

  separateFallbackEnemies(delta);
  collideFallbackPlayer();
  for (let index = fallback.enemies.length - 1; index >= 0; index -= 1) {
    if (fallback.enemies[index].dead && fallback.enemies[index].deathTimer <= 0) fallback.enemies.splice(index, 1);
  }

  for (let index = fallback.particles.length - 1; index >= 0; index -= 1) {
    const particle = fallback.particles[index];
    particle.life -= delta;
    particle.x += particle.vx * delta;
    particle.z += particle.vz * delta;
    particle.height += particle.rise * delta;
    particle.rise -= 3.5 * delta;
    if (particle.life <= 0) fallback.particles.splice(index, 1);
  }

  for (let index = fallback.projectiles.length - 1; index >= 0; index -= 1) {
    const arrow = fallback.projectiles[index];
    arrow.age += delta;
    arrow.x += arrow.vx * delta;
    arrow.z += arrow.vz * delta;
    arrow.y += arrow.vy * delta;
    arrow.vy -= 3 * delta;
    const target = arrow.target;
    if (target.dead || arrow.age > 1.5 || arrow.y < 0.03) {
      fallback.projectiles.splice(index, 1);
      continue;
    }
    if (Math.hypot(target.x - arrow.x, target.z - arrow.z) > 0.42 || arrow.y < 0.35 || arrow.y > 2) continue;
    target.health -= 18;
    target.stun = 0.63;
    target.attackWindup = -1;
    target.flash = 0.14;
    const speed = Math.hypot(arrow.vx, arrow.vz) || 1;
    target.vx += arrow.vx / speed * 1.4;
    target.vz += arrow.vz / speed * 1.4;
    burst({ x: target.x, y: 1.1, z: target.z }, 0x9a9679, 5, 1.4);
    if (target.health <= 0) {
      target.dead = true;
      target.deathTimer = 0.58;
      run.kills += 1;
      run.score += 75 * Math.max(1, run.wave);
      player.health = Math.min(100, player.health + 6);
      updateHud();
    }
    fallback.projectiles.splice(index, 1);
  }

  updateWaves(delta);
  if (Math.floor(run.elapsed * 8) !== Math.floor((run.elapsed - delta) * 8)) updateHud();
}

function updateFallbackCompanion(delta) {
  const yaw = player.facing;
  const desiredX = player.root.position.x + Math.sin(yaw) * 1.75 - Math.cos(yaw) * 1.28;
  const desiredZ = player.root.position.z + Math.cos(yaw) * 1.75 + Math.sin(yaw) * 1.28;
  const damping = 1 - Math.exp(-5.8 * delta);
  companion.velocity.x += (desiredX - companion.root.position.x - companion.velocity.x * 0.46) * damping;
  companion.velocity.z += (desiredZ - companion.root.position.z - companion.velocity.z * 0.46) * damping;
  companion.root.position.x += companion.velocity.x * delta;
  companion.root.position.z += companion.velocity.z * delta;
  limitToArena(companion.root.position, companion.velocity);

  let target = null;
  let nearest = 10.5;
  for (const enemy of fallback.enemies) {
    if (enemy.dead) continue;
    const distance = Math.hypot(enemy.x - companion.root.position.x, enemy.z - companion.root.position.z);
    if (distance < nearest) {
      nearest = distance;
      target = enemy;
    }
  }
  fallback.companionShotCooldown = Math.max(0, fallback.companionShotCooldown - delta);
  companion.aiming = Boolean(target && fallback.companionShotCooldown <= 0);
  const facing = target && companion.aiming
    ? Math.atan2(-(target.x - companion.root.position.x), -(target.z - companion.root.position.z))
    : Math.atan2(-companion.velocity.x, -companion.velocity.z);
  companion.root.rotation.y = lerpAngle(companion.root.rotation.y, facing, 1 - Math.exp(-6 * delta));
  companion.phase += delta * (4.7 + companion.velocity.length() * 2);
  if (!target || fallback.companionShotCooldown > 0) return;

  const dx = target.x - companion.root.position.x;
  const dz = target.z - companion.root.position.z;
  const travelTime = Math.max(Math.hypot(dx, dz) / 11.8, 0.32);
  fallback.projectiles.push({
    x: companion.root.position.x,
    y: 1.03,
    z: companion.root.position.z,
    vx: dx / travelTime,
    vy: (1.12 - 1.03 + 1.5 * travelTime * travelTime) / travelTime,
    vz: dz / travelTime,
    age: 0,
    target,
  });
  fallback.companionShotCooldown = 2.5;
  tone(325, 184, 0.09, 0.012, 'triangle');
}

function limitFallbackEnemy(enemy) {
  const distance = Math.hypot(enemy.x, enemy.z);
  if (distance <= ARENA_LIMIT) return;
  const nx = enemy.x / distance;
  const nz = enemy.z / distance;
  enemy.x = nx * ARENA_LIMIT;
  enemy.z = nz * ARENA_LIMIT;
  const outward = enemy.vx * nx + enemy.vz * nz;
  if (outward > 0) {
    enemy.vx -= outward * nx;
    enemy.vz -= outward * nz;
  }
}

function separateFallbackEnemies(delta) {
  for (let first = 0; first < fallback.enemies.length; first += 1) {
    const a = fallback.enemies[first];
    if (a.dead) continue;
    for (let second = first + 1; second < fallback.enemies.length; second += 1) {
      const b = fallback.enemies[second];
      if (b.dead) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let distance = Math.hypot(dx, dz);
      if (distance >= 0.72) continue;
      if (distance < 0.001) {
        dx = 0.01;
        dz = 0;
        distance = 0.01;
      }
      const push = (0.72 - distance) * Math.min(0.55, delta * 11);
      a.x -= (dx / distance) * push;
      a.z -= (dz / distance) * push;
      b.x += (dx / distance) * push;
      b.z += (dz / distance) * push;
    }
  }
}

function collideFallbackPlayer() {
  for (const enemy of fallback.enemies) {
    if (enemy.dead) continue;
    const dx = enemy.x - player.root.position.x;
    const dz = enemy.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.63 || distance > 1) continue;
    const force = (1 - distance) * 0.018;
    enemy.x += (dx / distance) * force;
    enemy.z += (dz / distance) * force;
  }
}

function resolveFallbackSwing() {
  const frontX = -Math.sin(player.facing);
  const frontZ = -Math.cos(player.facing);
  for (const enemy of fallback.enemies) {
    if (enemy.dead) continue;
    const dx = enemy.x - player.root.position.x;
    const dz = enemy.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 2.55 || distance < 0.01) continue;
    if ((dx * frontX + dz * frontZ) / distance < -0.04) continue;

    player.hitTargets.add(enemy);
    const combo = registerHit();
    enemy.health -= 35 + Math.min(combo, 4) * 3;
    enemy.stun = 0.3;
    enemy.attackWindup = -1;
    enemy.vx += (dx / distance) * 5.7;
    enemy.vz += (dz / distance) * 5.7;
    enemy.flash = 0.16;
    burst({ x: enemy.x, y: 1.05, z: enemy.z }, 0xa7c4b5, 9, 3.6);
    tone(118, 48, 0.13, 0.045, 'triangle');
    cameraShake = Math.max(cameraShake, 0.18);
    if (enemy.health <= 0) {
      enemy.dead = true;
      enemy.deathTimer = 0.58;
      run.kills += 1;
      run.score += 75 * Math.max(1, run.wave);
      player.health = Math.min(100, player.health + 6);
      burst({ x: enemy.x, y: 1.12, z: enemy.z }, 0xe98554, 24, 4.6);
      tone(85, 31, 0.22, 0.045, 'sawtooth');
      updateHud();
    }
  }
}

function drawFallback(timestamp) {
  const context = fallbackContext;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const compact = width < 760;
  const scale = Math.min(width / 22, height / 15);
  const centerX = width * (compact ? 0.78 : 0.67);
  const centerY = height * (compact ? 0.69 : 0.69);

  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#647867');
  sky.addColorStop(0.3, '#9aa78b');
  sky.addColorStop(0.58, '#b0b398');
  sky.addColorStop(1, '#53624e');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const sunX = width * 0.77;
  const sunY = height * 0.2;
  const morningGlow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, height * 0.66);
  morningGlow.addColorStop(0, 'rgba(247, 229, 179, 0.66)');
  morningGlow.addColorStop(0.24, 'rgba(224, 225, 191, 0.27)');
  morningGlow.addColorStop(1, 'rgba(203, 222, 199, 0)');
  context.fillStyle = morningGlow;
  context.fillRect(0, 0, width, height * 0.88);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.translate(sunX, sunY);
  context.rotate(-0.26);
  for (let shaft = -3; shaft <= 3; shaft += 1) {
    const beam = context.createLinearGradient(0, 0, 0, height * 0.67);
    beam.addColorStop(0, 'rgba(247, 236, 199, 0.1)');
    beam.addColorStop(0.5, 'rgba(246, 237, 208, 0.045)');
    beam.addColorStop(1, 'rgba(255, 244, 216, 0)');
    context.fillStyle = beam;
    context.fillRect(shaft * 35 - 11, -20, 22 + Math.abs(shaft) * 5, height * 0.8);
  }
  context.restore();

  const horizon = height * 0.55;
  drawFallbackRuins(context, width, height);
  context.fillStyle = '#536049';
  context.beginPath();
  context.moveTo(0, horizon + 20);
  for (let x = 0; x <= width + 40; x += 40) {
    context.lineTo(x, horizon - 24 - Math.sin(x * 0.017) * 18 - Math.sin(x * 0.044) * 11);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  const ground = context.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, '#67704e');
  ground.addColorStop(0.27, '#595c42');
  ground.addColorStop(0.62, '#403f30');
  ground.addColorStop(1, '#22281f');
  context.fillStyle = ground;
  context.fillRect(0, horizon + 14, width, height - horizon);

  const arenaY = centerY + scale * 0.17;
  const radiusX = scale * 11.5 * 0.67;
  const radiusY = scale * 11.5 * 0.29;
  const floor = context.createRadialGradient(centerX, arenaY - radiusY * 0.3, 0, centerX, arenaY, radiusX);
  floor.addColorStop(0, 'rgba(133, 132, 94, 0.63)');
  floor.addColorStop(0.62, 'rgba(86, 88, 61, 0.66)');
  floor.addColorStop(1, 'rgba(42, 49, 34, 0.04)');
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX, radiusY, 0, 0, TAU);
  context.fillStyle = floor;
  context.fill();

  context.save();
  context.setLineDash([9, 12, 3, 10]);
  context.lineWidth = Math.max(1, scale * 0.035);
  context.strokeStyle = 'rgba(171, 166, 122, 0.22)';
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX * 0.82, radiusY * 0.79, 0, 0, TAU);
  context.stroke();
  context.setLineDash([]);
  context.lineWidth = Math.max(1, scale * 0.027);
  context.strokeStyle = 'rgba(208, 197, 150, 0.12)';
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX * 0.89, radiusY * 0.89, 0, 0, TAU);
  context.stroke();
  context.restore();

  for (let index = 0; index < 33; index += 1) {
    const angle = (index / 18) * TAU;
    const x = centerX + Math.cos(angle) * radiusX * (0.42 + (index % 4) * 0.12);
    const y = arenaY + Math.sin(angle) * radiusY * (0.32 + (index % 3) * 0.17);
    context.strokeStyle = index % 3 ? 'rgba(50, 66, 40, 0.23)' : 'rgba(181, 182, 132, 0.27)';
    context.lineWidth = Math.max(1, scale * 0.031);
    context.beginPath();
    context.moveTo(x - Math.cos(angle) * scale * 0.14, y - Math.sin(angle) * scale * 0.07);
    context.lineTo(x + Math.cos(angle + 0.28) * scale * 0.12, y + Math.sin(angle + 0.28) * scale * 0.08);
    context.stroke();
  }

  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * TAU + Math.PI / 5;
    const torchX = centerX + Math.cos(angle) * radiusX * 0.94;
    const torchY = arenaY + Math.sin(angle) * radiusY * 0.94;
    drawFallbackTorch(context, torchX, torchY, scale, timestamp, index);
  }

  for (let stone = 0; stone < 16; stone += 1) {
    const x = centerX + Math.sin(stone * 83.1) * radiusX * 0.82;
    const y = arenaY + Math.cos(stone * 24.6) * radiusY * 0.86;
    const size = scale * (0.14 + (stone % 4) * 0.055);
    context.fillStyle = stone % 2 ? 'rgba(119, 117, 90, 0.76)' : 'rgba(75, 83, 60, 0.8)';
    context.beginPath();
    context.ellipse(x, y, size * 1.4, size * 0.73, stone * 0.36, Math.PI, TAU);
    context.fill();
  }

  const figures = fallback.enemies.filter((enemy) => enemy.deathTimer > 0 || !enemy.dead).map((enemy) => ({
    x: enemy.x,
    z: enemy.z,
    enemy,
  }));
  figures.push({ x: companion.root.position.x, z: companion.root.position.z, archer: true });
  figures.push({ x: player.root.position.x, z: player.root.position.z, hero: true });
  figures.sort((a, b) => a.z - b.z);

  for (const figure of figures) {
    const lift = figure.enemy?.dead ? Math.max(0, 1 - figure.enemy.deathTimer / 0.58) * -0.35 : 0;
    const screenX = centerX + figure.x * scale * 0.67;
    const screenY = arenaY + figure.z * scale * 0.28 + lift * scale;
    if (figure.hero) {
      const attackProgress = player.attackTimer > 0 ? 1 - player.attackTimer / 0.42 : 0;
      drawFallbackHero(context, screenX, screenY, scale, player.facing, timestamp, attackProgress);
    } else if (figure.archer) {
      drawFallbackArcher(context, screenX, screenY, scale * 0.78, companion.root.rotation.y, timestamp, companion.aiming);
    } else {
      const alpha = figure.enemy.dead ? Math.max(0, figure.enemy.deathTimer / 0.58) : 1;
      drawFallbackFighter(
        context,
        screenX,
        screenY,
        scale,
        true,
        figure.enemy.facing,
        timestamp + figure.enemy.phase * 100,
        figure.enemy.attackWindup > 0 ? 0.7 : 0,
        figure.enemy.flash > 0 ? 0.2 : 0,
        alpha,
      );
    }
  }

  for (const arrow of fallback.projectiles) {
    const x = centerX + arrow.x * scale * 0.67;
    const y = arenaY + arrow.z * scale * 0.28 - arrow.y * scale * 0.42;
    const velocityX = arrow.vx * scale * 0.67;
    const velocityY = arrow.vz * scale * 0.28 - arrow.vy * scale * 0.42;
    const speed = Math.hypot(velocityX, velocityY) || 1;
    const length = Math.min(scale * 0.52, speed * 0.035);
    context.strokeStyle = 'rgba(232, 219, 187, 0.92)';
    context.lineWidth = Math.max(1.5, scale * 0.025);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x - velocityX / speed * length, y - velocityY / speed * length);
    context.lineTo(x, y);
    context.stroke();
    context.fillStyle = '#e2c27e';
    context.beginPath();
    context.arc(x, y, Math.max(1.2, scale * 0.027), 0, TAU);
    context.fill();
  }

  for (const particle of fallback.particles) {
    const x = centerX + particle.x * scale * 0.67;
    const y = arenaY + particle.z * scale * 0.28 - particle.height * scale * 0.42;
    const alpha = Math.min(1, particle.life * 2.1);
    context.globalAlpha = alpha;
    context.fillStyle = particle.color;
    context.shadowColor = particle.color;
    context.shadowBlur = 12;
    context.beginPath();
    context.arc(x, y, Math.max(1.3, scale * 0.045), 0, TAU);
    context.fill();
    context.shadowBlur = 0;
  }
  context.globalAlpha = 1;

  const mist = context.createLinearGradient(0, horizon - 15, 0, height * 0.72);
  mist.addColorStop(0, 'rgba(227, 222, 186, 0.13)');
  mist.addColorStop(1, 'rgba(211, 215, 188, 0)');
  context.fillStyle = mist;
  context.fillRect(0, horizon - 15, width, height * 0.72 - horizon);
}

function drawFallbackRuins(context, width, height) {
  for (let row = 0; row < 3; row += 1) {
    const spacing = 36 + row * 22;
    const count = Math.ceil(width / spacing) + 2;
    const offset = row * 19;
    for (let index = 0; index < count; index += 1) {
      const x = index * spacing - offset - 8;
      const base = height * (0.555 + row * 0.029 + Math.sin(index * 3.7 + row) * 0.012);
      const treeHeight = height * (0.13 + ((index * 17 + row * 11) % 8) * 0.013) * (row === 2 ? 1.22 : 1);
      const trunkWidth = (2.2 + (index % 3) * 1.5) * (row === 2 ? 2.2 : 1);
      const tip = base - treeHeight;
      const crown = (15 + (index * 9 % 17)) * (row === 2 ? 1.2 : 1);
      const palette = row === 0
        ? ['rgba(65, 96, 68, 0.34)', 'rgba(73, 103, 73, 0.38)', 'rgba(80, 110, 76, 0.42)']
        : row === 1
          ? ['rgba(49, 75, 51, 0.58)', 'rgba(58, 83, 54, 0.62)', 'rgba(65, 88, 57, 0.63)']
          : ['rgba(37, 53, 36, 0.78)', 'rgba(43, 61, 41, 0.8)', 'rgba(50, 66, 43, 0.82)'];

      context.fillStyle = palette[index % palette.length];
      context.beginPath();
      context.moveTo(x, base + 4);
      context.lineTo(x + trunkWidth * 0.6, tip - treeHeight * 0.035);
      context.lineTo(x + trunkWidth, base + 4);
      context.closePath();
      context.fill();

      const bark = row === 2 ? 'rgba(87, 71, 48, 0.78)' : 'rgba(78, 90, 63, 0.58)';
      context.fillStyle = bark;
      context.fillRect(x + trunkWidth * 0.26, tip + treeHeight * 0.48, trunkWidth * 0.42, base - tip - treeHeight * 0.48);
      context.fillStyle = palette[(index + 1) % palette.length];
      for (let level = 0; level < 5; level += 1) {
        const branchY = tip + treeHeight * (0.19 + level * 0.14);
        const branchWidth = crown * (0.12 + level * 0.16);
        context.beginPath();
        context.moveTo(x + trunkWidth * 0.48, branchY - treeHeight * 0.13);
        context.quadraticCurveTo(x + trunkWidth * 0.48 - branchWidth * 0.3, branchY - treeHeight * 0.01, x + trunkWidth * 0.48 - branchWidth, branchY + treeHeight * 0.075);
        context.lineTo(x + trunkWidth * 0.48 + branchWidth * 0.42, branchY + treeHeight * 0.025);
        context.quadraticCurveTo(x + trunkWidth * 0.48 + branchWidth * 0.68, branchY + treeHeight * 0.03, x + trunkWidth * 0.48 + branchWidth, branchY + treeHeight * 0.08);
        context.quadraticCurveTo(x + trunkWidth * 0.48, branchY + treeHeight * 0.01, x + trunkWidth * 0.48, branchY - treeHeight * 0.13);
        context.fill();
      }
      if (row === 2 && (index % 2 === 0 || x < 14 || x > width - 50)) {
        context.fillStyle = 'rgba(43, 57, 39, 0.32)';
        context.fillRect(x - 1, base - treeHeight * 0.23, trunkWidth + 2, treeHeight * 0.25);
      }
    }
  }

  const canopy = context.createLinearGradient(0, height * 0.35, 0, height * 0.56);
  canopy.addColorStop(0, 'rgba(36, 54, 38, 0.73)');
  canopy.addColorStop(1, 'rgba(52, 78, 50, 0)');
  context.fillStyle = canopy;
  context.fillRect(0, height * 0.34, width, height * 0.23);
}

function drawFallbackTorch(context, x, y, scale, timestamp, index) {
  const size = Math.max(2, scale * 0.12);
  const glow = context.createRadialGradient(x, y - size * 1.2, 1, x, y - size * 1.2, size * 4.5);
  glow.addColorStop(0, 'rgba(249, 165, 98, 0.15)');
  glow.addColorStop(1, 'rgba(255, 162, 77, 0)');
  context.fillStyle = glow;
  context.fillRect(x - size * 5, y - size * 6, size * 10, size * 10);
  context.fillStyle = '#403528';
  context.fillRect(x - size * 0.16, y - size * 1.15, size * 0.32, size * 1.1);
  const flicker = 0.83 + Math.sin(timestamp * 0.006 + index) * 0.12;
  context.save();
  context.translate(x, y - size * 1.3);
  context.scale(flicker, 1 + Math.sin(timestamp * 0.009 + index * 2) * 0.12);
  context.fillStyle = '#e99856';
  context.beginPath();
  context.moveTo(0, -size * 1.3);
  context.quadraticCurveTo(size * 1.1, -size * 0.15, 0, size * 0.08);
  context.quadraticCurveTo(-size * 0.85, -size * 0.2, 0, -size * 1.3);
  context.fill();
  context.fillStyle = '#efc27e';
  context.beginPath();
  context.ellipse(0, -size * 0.28, size * 0.24, size * 0.52, 0, 0, TAU);
  context.fill();
  context.restore();
}

function drawFallbackFighter(context, x, groundY, scale, isEnemy, facing, time, attack, hurt, alpha) {
  context.save();
  context.translate(x, groundY);
  if (Math.sin(facing) > 0) context.scale(-1, 1);
  context.scale(scale, scale);
  context.globalAlpha = alpha;

  context.fillStyle = 'rgba(3, 5, 7, 0.64)';
  context.beginPath();
  context.ellipse(0, 0.03, 0.42, 0.13, 0, 0, TAU);
  context.fill();

  if (isEnemy) {
    const gait = Math.sin(time * 0.007) * 0.12;
    context.lineCap = 'round';
    context.lineWidth = 0.16;
    context.strokeStyle = '#323b38';
    context.beginPath();
    context.moveTo(-0.14, -0.58);
    context.lineTo(-0.2 - gait, -0.08);
    context.moveTo(0.13, -0.57);
    context.lineTo(0.2 + gait, -0.08);
    context.stroke();

    context.fillStyle = '#272c2b';
    context.beginPath();
    context.moveTo(-0.28, -1.42);
    context.lineTo(0.27, -1.37);
    context.lineTo(0.34, -0.57);
    context.lineTo(0.15, -0.49);
    context.lineTo(0.04, -0.64);
    context.lineTo(-0.08, -0.49);
    context.lineTo(-0.34, -0.59);
    context.closePath();
    context.fill();

    const corpse = context.createLinearGradient(-0.25, -1.5, 0.24, -0.6);
    corpse.addColorStop(0, hurt ? '#c9987b' : '#9a9b8a');
    corpse.addColorStop(0.5, '#646b61');
    corpse.addColorStop(1, '#343b39');
    context.fillStyle = corpse;
    context.beginPath();
    context.ellipse(0, -1.06, 0.28, 0.43, -0.04, 0, TAU);
    context.fill();

    context.strokeStyle = '#878675';
    context.lineWidth = 0.045;
    for (let rib = 0; rib < 3; rib += 1) {
      context.beginPath();
      context.moveTo(-0.17, -1.17 + rib * 0.13);
      context.lineTo(0.16, -1.14 + rib * 0.13);
      context.stroke();
    }

    context.lineCap = 'round';
    context.lineWidth = 0.12;
    context.strokeStyle = '#757a6c';
    context.beginPath();
    context.moveTo(-0.24, -1.31);
    context.lineTo(-0.39, -0.92);
    context.lineTo(-0.35, -0.56);
    context.moveTo(0.24, -1.3);
    context.lineTo(0.39, -0.92);
    context.lineTo(0.34, -0.56);
    context.stroke();

    context.fillStyle = '#8e7b69';
    context.beginPath();
    context.ellipse(0.015, -1.65, 0.19, 0.25, -0.1, 0, TAU);
    context.fill();
    context.fillStyle = '#262727';
    context.beginPath();
    context.ellipse(0.02, -1.78, 0.2, 0.13, 0, Math.PI, TAU);
    context.fill();

    context.shadowColor = '#ff7146';
    context.shadowBlur = 10;
    context.fillStyle = hurt ? '#ffe2a4' : '#ff8a4e';
    context.fillRect(-0.085, -1.71, 0.045, 0.026);
    context.fillRect(0.055, -1.71, 0.045, 0.026);
    context.shadowBlur = 0;
    context.fillStyle = '#d46c49';
    context.beginPath();
    context.arc(0.07, -1.05, 0.085, 0, TAU);
    context.fill();

    if (attack > 0) {
      context.strokeStyle = `rgba(227, 103, 67, ${0.38 + attack * 0.3})`;
      context.lineWidth = 0.035;
      context.beginPath();
      context.ellipse(0, 0.05, 0.52 + attack * 0.1, 0.16, 0, 0, TAU);
      context.stroke();
    }
  } else {
    const gait = player.walking ? Math.sin(time * 0.012) * 0.13 : 0;
    context.lineCap = 'round';
    context.lineWidth = 0.19;
    context.strokeStyle = '#25292b';
    context.beginPath();
    context.moveTo(-0.16, -0.67);
    context.lineTo(-0.18 + gait, -0.08);
    context.moveTo(0.16, -0.67);
    context.lineTo(0.18 - gait, -0.08);
    context.stroke();

    context.fillStyle = '#242829';
    context.beginPath();
    context.moveTo(-0.29, -1.35);
    context.lineTo(0.28, -1.35);
    context.lineTo(0.43, -0.2);
    context.lineTo(0.19, -0.08);
    context.lineTo(0.05, -0.22);
    context.lineTo(-0.12, -0.09);
    context.lineTo(-0.41, -0.23);
    context.closePath();
    context.fill();

    const armor = context.createLinearGradient(-0.32, -1.5, 0.35, -0.55);
    armor.addColorStop(0, hurt > 0 ? '#a57461' : '#57605e');
    armor.addColorStop(0.48, '#343b3c');
    armor.addColorStop(1, '#1b2224');
    context.fillStyle = armor;
    context.beginPath();
    context.moveTo(-0.3, -1.37);
    context.lineTo(-0.2, -1.52);
    context.lineTo(0.21, -1.5);
    context.lineTo(0.32, -1.34);
    context.lineTo(0.24, -0.75);
    context.lineTo(-0.24, -0.73);
    context.closePath();
    context.fill();

    context.fillStyle = '#503c31';
    context.beginPath();
    context.moveTo(-0.25, -1.4);
    context.lineTo(-0.12, -1.47);
    context.lineTo(0.14, -0.76);
    context.lineTo(0.04, -0.73);
    context.closePath();
    context.fill();
    context.fillStyle = '#b08258';
    context.fillRect(-0.27, -0.82, 0.54, 0.09);
    context.fillStyle = '#b9915e';
    context.fillRect(-0.055, -0.83, 0.11, 0.1);

    context.strokeStyle = '#353c3d';
    context.lineWidth = 0.14;
    context.beginPath();
    context.moveTo(-0.31, -1.31);
    context.lineTo(-0.44, -0.96 + gait * 0.5);
    context.lineTo(-0.39, -0.68);
    context.moveTo(0.31, -1.3);
    context.lineTo(0.4, -1.0 - attack * 0.45);
    context.lineTo(0.39, -0.71 - attack * 0.18);
    context.stroke();

    context.fillStyle = '#b6aa90';
    context.beginPath();
    context.ellipse(0, -1.66, 0.17, 0.23, 0, 0, TAU);
    context.fill();
    context.fillStyle = '#24282a';
    context.beginPath();
    context.ellipse(0, -1.75, 0.22, 0.19, 0, Math.PI, TAU);
    context.fill();
    context.fillRect(-0.17, -1.72, 0.34, 0.12);
    context.fillStyle = '#202426';
    context.fillRect(-0.16, -1.64, 0.32, 0.095);
    context.shadowColor = '#a1d4d2';
    context.shadowBlur = 7;
    context.fillStyle = '#9dc4bf';
    context.fillRect(-0.07, -1.7, 0.042, 0.023);
    context.fillRect(0.035, -1.7, 0.042, 0.023);
    context.shadowBlur = 0;

    context.save();
    context.translate(0.42, -0.92);
    context.rotate(attack > 0 ? 0.9 - Math.sin(attack * Math.PI) * 2.2 : 0.52);
    context.fillStyle = '#976a48';
    context.fillRect(-0.035, -0.03, 0.07, 0.53);
    context.fillStyle = '#aa8d68';
    context.fillRect(-0.2, -0.09, 0.4, 0.075);
    const sword = context.createLinearGradient(-0.12, -1.08, 0.13, -0.18);
    sword.addColorStop(0, '#d7ded0');
    sword.addColorStop(0.52, '#8da2a0');
    sword.addColorStop(1, '#3e575a');
    context.fillStyle = sword;
    context.beginPath();
    context.moveTo(-0.09, -0.06);
    context.lineTo(-0.13, -0.73);
    context.lineTo(0.03, -1.08);
    context.lineTo(0.14, -0.68);
    context.lineTo(0.08, -0.06);
    context.closePath();
    context.fill();
    context.restore();

    if (attack > 0) {
      context.strokeStyle = `rgba(218, 168, 119, ${0.45 + attack * 0.3})`;
      context.lineWidth = 0.055;
      context.beginPath();
      context.arc(0.2, -0.98, 0.86, -1.4, 0.93);
      context.stroke();
    }
  }

  context.restore();
}

function drawFallbackHero(context, x, groundY, scale, facing, time, attack) {
  context.save();
  context.translate(x, groundY);
  if (Math.sin(facing) > 0) context.scale(-1, 1);
  context.scale(scale, scale);

  const gait = player.walking ? Math.sin(time * 0.011) * 0.1 : Math.sin(time * 0.0016) * 0.018;
  context.fillStyle = 'rgba(22, 29, 21, 0.3)';
  context.beginPath();
  context.ellipse(0.05, 0.035, 0.44, 0.105, 0, 0, TAU);
  context.fill();

  context.lineCap = 'round';
  context.lineWidth = 0.19;
  context.strokeStyle = '#473b2d';
  context.beginPath();
  context.moveTo(-0.145, -0.68);
  context.lineTo(-0.19 + gait, -0.07);
  context.moveTo(0.14, -0.67);
  context.lineTo(0.19 - gait, -0.07);
  context.stroke();

  context.lineWidth = 0.21;
  context.strokeStyle = '#352d24';
  context.beginPath();
  context.moveTo(-0.18 + gait, -0.09);
  context.lineTo(-0.29 + gait, 0);
  context.moveTo(0.19 - gait, -0.09);
  context.lineTo(0.35 - gait, -0.01);
  context.stroke();

  context.fillStyle = '#37382e';
  context.beginPath();
  context.moveTo(-0.27, -1.22);
  context.lineTo(0.27, -1.22);
  context.lineTo(0.4, -0.19);
  context.lineTo(0.19, -0.08);
  context.lineTo(0.02, -0.21);
  context.lineTo(-0.17, -0.1);
  context.lineTo(-0.4, -0.25);
  context.closePath();
  context.fill();

  const torso = context.createLinearGradient(-0.32, -1.53, 0.33, -0.67);
  torso.addColorStop(0, '#c6a281');
  torso.addColorStop(0.42, '#a77e5e');
  torso.addColorStop(1, '#806348');
  context.fillStyle = torso;
  context.beginPath();
  context.moveTo(-0.26, -1.47);
  context.quadraticCurveTo(-0.18, -1.56, -0.02, -1.45);
  context.quadraticCurveTo(0.18, -1.56, 0.29, -1.43);
  context.lineTo(0.33, -1.16);
  context.lineTo(0.2, -0.76);
  context.lineTo(-0.2, -0.75);
  context.lineTo(-0.34, -1.16);
  context.closePath();
  context.fill();

  context.strokeStyle = 'rgba(230, 204, 166, 0.39)';
  context.lineWidth = 0.019;
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * 0.09, -1.42);
    context.quadraticCurveTo(side * 0.23, -1.28, side * 0.1, -1.14);
    context.lineTo(side * 0.07, -0.84);
    context.stroke();
  }

  context.fillStyle = '#523c2a';
  context.beginPath();
  context.moveTo(-0.21, -0.93);
  context.lineTo(0.25, -0.93);
  context.lineTo(0.37, -0.43);
  context.lineTo(0.16, -0.48);
  context.lineTo(0.05, -0.38);
  context.lineTo(-0.18, -0.45);
  context.closePath();
  context.fill();

  context.fillStyle = '#a58959';
  context.fillRect(-0.28, -0.96, 0.55, 0.085);
  context.fillStyle = '#d2ad6e';
  context.fillRect(-0.055, -0.969, 0.11, 0.11);

  context.strokeStyle = '#6b4c36';
  context.lineWidth = 0.15;
  context.beginPath();
  context.moveTo(-0.3, -1.31);
  context.lineTo(-0.42, -0.99 + gait * 0.45);
  context.lineTo(-0.38, -0.74);
  context.moveTo(0.3, -1.31);
  context.lineTo(0.42, -0.99 - gait * 0.4 - attack * 0.18);
  context.lineTo(0.4, -0.73 - attack * 0.26);
  context.stroke();

  context.strokeStyle = '#9d7958';
  context.lineWidth = 0.045;
  context.beginPath();
  context.moveTo(-0.31, -1.3);
  context.lineTo(-0.24, -1.45);
  context.moveTo(-0.24, -1.45);
  context.lineTo(-0.04, -0.84);
  context.stroke();

  context.fillStyle = '#c09975';
  context.beginPath();
  context.ellipse(0, -1.71, 0.168, 0.217, -0.025, 0, TAU);
  context.fill();
  context.fillStyle = '#49372b';
  context.beginPath();
  context.moveTo(-0.14, -1.62);
  context.quadraticCurveTo(-0.115, -1.69, -0.133, -1.78);
  context.quadraticCurveTo(-0.085, -1.73, -0.058, -1.65);
  context.quadraticCurveTo(0.025, -1.72, 0.09, -1.66);
  context.quadraticCurveTo(0.13, -1.75, 0.15, -1.77);
  context.lineTo(0.14, -1.6);
  context.closePath();
  context.fill();

  context.fillStyle = '#362b22';
  context.beginPath();
  context.moveTo(-0.143, -1.63);
  context.quadraticCurveTo(-0.16, -1.5, -0.087, -1.48);
  context.quadraticCurveTo(0, -1.41, 0.094, -1.49);
  context.quadraticCurveTo(0.166, -1.54, 0.144, -1.64);
  context.lineTo(0.105, -1.57);
  context.quadraticCurveTo(0, -1.52, -0.112, -1.58);
  context.closePath();
  context.fill();
  context.fillStyle = '#614936';
  context.beginPath();
  context.moveTo(-0.09, -1.55);
  context.quadraticCurveTo(-0.04, -1.53, 0, -1.56);
  context.quadraticCurveTo(0.05, -1.52, 0.1, -1.56);
  context.lineTo(0.08, -1.62);
  context.quadraticCurveTo(0, -1.59, -0.08, -1.62);
  context.closePath();
  context.fill();

  context.fillStyle = '#443529';
  context.fillRect(-0.091, -1.735, 0.058, 0.022);
  context.fillRect(0.034, -1.735, 0.058, 0.022);
  context.fillStyle = '#353027';
  context.fillRect(-0.027, -1.713, 0.046, 0.055);

  context.save();
  context.translate(0.42, -0.93);
  context.rotate(0.36 + attack * 0.44 - Math.sin(attack * Math.PI) * 1.15);
  context.strokeStyle = '#563e29';
  context.lineWidth = 0.057;
  context.beginPath();
  context.moveTo(0, 0.16);
  context.lineTo(0, -0.67);
  context.stroke();
  context.fillStyle = '#8d8a75';
  context.beginPath();
  context.moveTo(-0.025, -0.43);
  context.lineTo(-0.29, -0.51);
  context.quadraticCurveTo(-0.32, -0.75, -0.18, -0.89);
  context.quadraticCurveTo(-0.06, -0.73, 0.025, -0.61);
  context.closePath();
  context.fill();
  context.strokeStyle = 'rgba(242, 230, 203, 0.58)';
  context.lineWidth = 0.018;
  context.beginPath();
  context.moveTo(-0.13, -0.47);
  context.lineTo(-0.19, -0.72);
  context.moveTo(-0.07, -0.49);
  context.lineTo(-0.096, -0.76);
  context.stroke();
  context.restore();

  if (attack > 0.36) {
    context.strokeStyle = 'rgba(224, 206, 163, 0.62)';
    context.lineWidth = 0.044;
    context.beginPath();
    context.arc(0.12, -0.9, 0.82, -1.25, 0.93);
    context.stroke();
  }
  context.restore();
}

function drawFallbackArcher(context, x, groundY, scale, facing, time, aiming) {
  context.save();
  context.translate(x, groundY + Math.sin(time * 0.0017 + 0.8) * 0.026);
  if (Math.sin(facing) > 0) context.scale(-1, 1);
  context.scale(scale, scale);

  context.fillStyle = 'rgba(22, 29, 21, 0.25)';
  context.beginPath();
  context.ellipse(0, 0.027, 0.37, 0.085, 0, 0, TAU);
  context.fill();
  context.lineCap = 'round';
  context.lineWidth = 0.13;
  context.strokeStyle = '#463b2d';
  const gait = Math.sin(time * 0.006) * 0.07;
  context.beginPath();
  context.moveTo(-0.1, -0.55);
  context.lineTo(-0.13 + gait, -0.05);
  context.moveTo(0.1, -0.55);
  context.lineTo(0.13 - gait, -0.05);
  context.stroke();

  context.fillStyle = '#465042';
  context.beginPath();
  context.moveTo(-0.23, -1.06);
  context.lineTo(0.24, -1.06);
  context.lineTo(0.34, -0.23);
  context.lineTo(0.2, -0.08);
  context.lineTo(0.01, -0.2);
  context.lineTo(-0.16, -0.08);
  context.lineTo(-0.33, -0.24);
  context.closePath();
  context.fill();
  context.fillStyle = '#776b53';
  context.beginPath();
  context.ellipse(0, -1.02, 0.25, 0.16, 0, 0, TAU);
  context.fill();
  context.strokeStyle = '#69513b';
  context.lineWidth = 0.11;
  context.beginPath();
  context.moveTo(-0.23, -0.92);
  context.lineTo(-0.33, -0.71);
  context.lineTo(-0.29, -0.52);
  context.moveTo(0.22, -0.91);
  context.lineTo(0.3, -0.7);
  context.lineTo(0.29, -0.5);
  context.stroke();

  context.fillStyle = '#bd9878';
  context.beginPath();
  context.ellipse(0, -1.31, 0.137, 0.169, 0, 0, TAU);
  context.fill();
  context.fillStyle = '#56392a';
  context.beginPath();
  context.arc(-0.02, -1.36, 0.148, Math.PI * 1.03, Math.PI * 1.95);
  context.lineTo(0.11, -1.26);
  context.quadraticCurveTo(0.05, -1.21, -0.08, -1.25);
  context.closePath();
  context.fill();
  context.fillStyle = '#3c2c23';
  context.fillRect(-0.069, -1.335, 0.026, 0.018);
  context.fillRect(0.032, -1.335, 0.026, 0.018);
  context.fillStyle = '#7f6451';
  context.fillRect(-0.024, -1.33, 0.05, 0.04);

  context.save();
  context.translate(-0.46, -0.98);
  context.lineCap = 'round';
  context.strokeStyle = '#65482f';
  context.lineWidth = 0.043;
  context.beginPath();
  context.moveTo(0, -0.51);
  context.quadraticCurveTo(0.34, -0.18, 0.02, 0.28);
  context.stroke();
  context.strokeStyle = '#ddcbaa';
  context.lineWidth = 0.012;
  context.beginPath();
  context.moveTo(0, -0.51);
  context.lineTo(0.025 + (aiming ? 0.12 : 0.01), -0.09);
  context.lineTo(0.02, 0.28);
  context.stroke();
  context.restore();
  if (aiming) {
    context.strokeStyle = 'rgba(224, 200, 154, 0.65)';
    context.lineWidth = 0.024;
    context.beginPath();
    context.moveTo(-0.43, -1.08);
    context.lineTo(0.31, -1.08);
    context.stroke();
  }
  context.restore();
}
