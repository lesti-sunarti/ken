import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const TAU = Math.PI * 2;
const STEP = 1 / 60;
const ARENA_LIMIT = 14.7;

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

const fallback = {
  enemies: [],
  particles: [],
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
  rightArm: null,
  leftArm: null,
  weapon: null,
  legs: [],
  health: 100,
  attackTimer: 0,
  attackCooldown: 0,
  dodgeTimer: 0,
  dodgeCooldown: 0,
  invulnerable: 0,
  combo: 0,
  lastAttackAt: 0,
  walking: false,
  facing: 0,
};

const run = {
  wave: 0,
  kills: 0,
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
    renderer.toneMappingExposure = 1.13;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.48,
      0.48,
      0.82,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    createWorld();
    createPlayer();
    ui.boot.textContent = 'WEBGL SIAP  ·  ARENA TERBENTANG';
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
  const skyLight = new THREE.HemisphereLight(0x9aafc8, 0x1c1816, 1.05);
  scene.add(skyLight);

  const moonLight = new THREE.DirectionalLight(0xa9c3dc, 2.05);
  moonLight.position.set(-13, 22, 10);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.left = -32;
  moonLight.shadow.camera.right = 32;
  moonLight.shadow.camera.top = 32;
  moonLight.shadow.camera.bottom = -32;
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 70;
  moonLight.shadow.bias = -0.00022;
  moonLight.shadow.normalBias = 0.035;
  scene.add(moonLight);

  const blueFill = new THREE.PointLight(0x39768d, 22, 32, 1.8);
  blueFill.position.set(-1, 8, -10);
  scene.add(blueFill);

  makeGround();
  makeEclipse();
  makeArenaRing();
  makeRuins();
  makeStars();
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
  const size = 512;
  const paint = document.createElement('canvas');
  paint.width = size;
  paint.height = size;
  const context = paint.getContext('2d');
  const image = context.createImageData(size, size);

  for (let index = 0; index < image.data.length; index += 4) {
    const grain = (random() - 0.5) * 21;
    image.data[index] = 37 + grain;
    image.data[index + 1] = 40 + grain;
    image.data[index + 2] = 42 + grain;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = 'rgba(5, 8, 11, 0.45)';
  context.lineWidth = 2;
  for (let i = 0; i < 44; i += 1) {
    const x = random() * size;
    const y = random() * size;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 30, y + (random() - 0.5) * 26);
    context.lineTo(x + (random() - 0.5) * 52, y + (random() - 0.5) * 56);
    context.stroke();
  }

  const groundTexture = new THREE.CanvasTexture(paint);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = THREE.RepeatWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(17, 17);
  groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const geometry = new THREE.PlaneGeometry(150, 150, 144, 144);
  geometry.rotateX(-Math.PI / 2);
  const points = geometry.getAttribute('position');
  for (let index = 0; index < points.count; index += 1) {
    points.setY(index, terrainHeight(points.getX(index), points.getZ(index)));
  }
  geometry.computeVertexNormals();

  const ground = new THREE.Mesh(geometry, material(0xb7b4a8, {
    map: groundTexture,
    roughness: 0.95,
    metalness: 0.025,
  }));
  ground.receiveShadow = true;
  scene.add(ground);
}

function makeEclipse() {
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0x642d2b,
    transparent: true,
    opacity: 0.19,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(4.4, 64), haloMaterial);
  halo.position.set(1.7, 9.7, -34);
  scene.add(halo);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(3.15, 64),
    new THREE.MeshBasicMaterial({ color: 0x9c5542, transparent: true, opacity: 0.47, depthWrite: false }),
  );
  moon.position.set(1.7, 9.7, -33.9);
  scene.add(moon);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(4.38, 0.045, 7, 96),
    new THREE.MeshBasicMaterial({ color: 0xc07154, transparent: true, opacity: 0.48 }),
  );
  rim.position.copy(halo.position);
  scene.add(rim);
}

function makeArenaRing() {
  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(11.5, 0.095, 5, 128),
    material(0x80664e, { color: 0x80664e, metalness: 0.4, roughness: 0.65, emissive: 0x24150c, emissiveIntensity: 0.5 }),
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.08;
  scene.add(outerRing);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(10.92, 0.032, 4, 112),
    new THREE.MeshBasicMaterial({ color: 0x8d5a39, transparent: true, opacity: 0.55 }),
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.09;
  scene.add(innerRing);

  const stoneMaterial = material(0x55504a, { roughness: 0.92, metalness: 0.02 });
  const runeMaterial = material(0x9e6947, { roughness: 0.5, metalness: 0.24, emissive: 0x633a22, emissiveIntensity: 0.48 });
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

    if (index % 2 === 0) {
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.018, 0.22), runeMaterial);
      rune.position.set(x, terrainHeight(x, z) + 0.187, z);
      rune.rotation.y = slab.rotation.y + (random() - 0.5) * 0.7;
      scene.add(rune);
    }
  }
}

function makeRuins() {
  const stone = material(0x373a3a, { roughness: 0.94, metalness: 0.05 });
  const litStone = material(0x494641, { roughness: 0.88, metalness: 0.08 });

  for (let index = 0; index < 13; index += 1) {
    const angle = (index / 13) * TAU + (random() - 0.5) * 0.14;
    const radius = 17 + random() * 9;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 2.5 + random() * 4.2;
    const pillar = new THREE.Group();
    pillar.position.set(x, terrainHeight(x, z), z);
    pillar.rotation.y = random() * TAU;
    pillar.rotation.z = (random() - 0.5) * 0.07;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.98, 0.43, 7), litStone);
    base.position.y = 0.22;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.77, height, 7, 2), stone);
    shaft.position.y = 0.42 + height * 0.5;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    const capital = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.39, 1.33), litStone);
    capital.position.set((random() - 0.5) * 0.2, height + 0.58, 0);
    capital.rotation.y = random() * 0.25;
    capital.castShadow = true;

    pillar.add(base, shaft, capital);
    scene.add(pillar);
  }

  for (let index = 0; index < 39; index += 1) {
    const angle = random() * TAU;
    const radius = 13.2 + random() * 19;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.28 + random() * 0.75, 0),
      random() > 0.75 ? litStone : stone,
    );
    rock.position.set(x, terrainHeight(x, z) + 0.13, z);
    rock.rotation.set(random() * 0.8, random() * TAU, random() * 0.7);
    rock.scale.set(0.8 + random() * 0.75, 0.48 + random() * 0.8, 0.65 + random() * 0.75);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  for (let index = 0; index < 15; index += 1) {
    const angle = (index / 15) * TAU + random() * 0.2;
    const radius = 24 + random() * 14;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    makeDeadTree(x, z, stone, 0.8 + random() * 1.2);
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * TAU + Math.PI / 5;
    const radius = 11.9;
    makeTorch(Math.cos(angle) * radius, Math.sin(angle) * radius, index);
  }
}

function makeDeadTree(x, z, bark, scale) {
  const tree = new THREE.Group();
  tree.position.set(x, terrainHeight(x, z), z);
  tree.rotation.y = random() * TAU;
  tree.scale.setScalar(scale);

  const trunkHeight = 4.2 + random() * 2.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.34, trunkHeight, 6), bark);
  trunk.position.y = trunkHeight / 2;
  trunk.rotation.z = (random() - 0.5) * 0.22;
  trunk.castShadow = true;
  tree.add(trunk);

  for (let index = 0; index < 4; index += 1) {
    const height = trunkHeight * (0.42 + index * 0.12);
    const branchLength = 1.3 + random() * 1.8;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.13, branchLength, 5), bark);
    branch.position.set((random() - 0.5) * 0.65, height, 0);
    branch.rotation.z = (random() > 0.5 ? 1 : -1) * (0.62 + random() * 0.55);
    branch.rotation.x = (random() - 0.5) * 0.36;
    branch.castShadow = true;
    tree.add(branch);
  }
  scene.add(tree);
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
  const armor = material(0x34383a, { roughness: 0.48, metalness: 0.45 });
  const darkArmor = material(0x1b2023, { roughness: 0.6, metalness: 0.35 });
  const leather = material(0x49372d, { roughness: 0.9, metalness: 0.04 });
  const cloth = material(0x302c2b, { roughness: 0.98, metalness: 0.02, side: THREE.DoubleSide });
  const skin = material(0x8e9991, { roughness: 0.83, metalness: 0.02 });
  const bronze = material(0x9c714b, { roughness: 0.42, metalness: 0.7, emissive: 0x2b160a, emissiveIntensity: 0.22 });

  player.root.position.set(0, 0, 0);
  player.root.add(makeShadow(0.63, 0.34));
  player.model.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.43, 5, 10), armor));
  player.model.children[player.model.children.length - 1].position.y = 1.17;

  const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.46, 0.76, 8, 1), cloth);
  tunic.position.set(0, 0.89, 0.01);
  tunic.castShadow = true;
  player.model.add(tunic);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.49, 0.15), darkArmor);
  chestPlate.position.set(0, 1.27, -0.2);
  chestPlate.rotation.x = -0.07;
  chestPlate.castShadow = true;
  player.model.add(chestPlate);

  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.9, 0.49), leather);
  strap.position.set(-0.01, 1.2, -0.025);
  strap.rotation.z = -0.39;
  strap.castShadow = true;
  player.model.add(strap);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 10), bronze);
  belt.position.y = 0.81;
  player.model.add(belt);

  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.91, 0.065), cloth);
  cape.position.set(0, 0.99, 0.2);
  cape.rotation.x = -0.04;
  cape.castShadow = true;
  player.model.add(cape);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin);
  head.position.set(0, 1.86, 0);
  head.scale.set(0.86, 1.04, 0.86);
  head.castShadow = true;
  player.model.add(head);

  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.228, 14, 10, 0, TAU, 0, Math.PI * 0.64), cloth);
  hood.position.set(0, 1.88, 0.025);
  hood.scale.set(1.12, 1.05, 1.04);
  hood.castShadow = true;
  player.model.add(hood);

  const faceGuard = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.12, 0.08), darkArmor);
  faceGuard.position.set(0, 1.81, -0.17);
  faceGuard.castShadow = true;
  player.model.add(faceGuard);

  const eye = material(0x9ab9c0, { color: 0x9ab9c0, emissive: 0x4e8994, emissiveIntensity: 2.7, roughness: 0.3, toneMapped: false });
  for (const side of [-1, 1]) {
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eye);
    glint.position.set(side * 0.068, 1.84, -0.218);
    player.model.add(glint);
  }

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.205, 10, 8), armor);
  shoulder.position.set(0.38, 1.42, 0);
  shoulder.scale.set(1.2, 0.76, 0.95);
  shoulder.castShadow = true;
  player.model.add(shoulder);

  player.rightArm = new THREE.Group();
  player.rightArm.position.set(0.39, 1.39, -0.01);
  player.model.add(player.rightArm);
  addBone(player.rightArm, [0, 0, 0], [0.06, -0.35, -0.03], 0.13, armor);
  addBone(player.rightArm, [0.06, -0.35, -0.03], [0.08, -0.67, -0.1], 0.105, darkArmor);
  const gauntlet = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.16, 0.23), bronze);
  gauntlet.position.set(0.08, -0.55, -0.11);
  player.rightArm.add(gauntlet);

  player.leftArm = new THREE.Group();
  player.leftArm.position.set(-0.39, 1.38, 0);
  player.model.add(player.leftArm);
  addBone(player.leftArm, [0, 0, 0], [-0.07, -0.34, -0.04], 0.135, armor);
  addBone(player.leftArm, [-0.07, -0.34, -0.04], [-0.12, -0.63, -0.15], 0.11, darkArmor);
  const buckler = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.14, 8), bronze);
  buckler.position.set(-0.15, -0.5, -0.21);
  buckler.rotation.x = Math.PI / 2;
  buckler.castShadow = true;
  player.leftArm.add(buckler);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.09, 0.08);
  bladeShape.lineTo(-0.14, 0.42);
  bladeShape.lineTo(-0.19, 0.83);
  bladeShape.lineTo(-0.02, 1.19);
  bladeShape.lineTo(0.22, 0.78);
  bladeShape.lineTo(0.15, 0.33);
  bladeShape.lineTo(0.07, 0.08);
  bladeShape.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.075,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.022,
    bevelThickness: 0.025,
  }), material(0x829091, { roughness: 0.22, metalness: 0.82, emissive: 0x1b3332, emissiveIntensity: 0.42 }));
  blade.castShadow = true;

  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.63, 0.012), material(0x9fc0b2, {
    roughness: 0.3,
    metalness: 0.55,
    emissive: 0x34554a,
    emissiveIntensity: 0.7,
  }));
  fuller.position.set(0.01, 0.67, 0.091);

  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.32, 8), leather);
  hilt.position.y = -0.07;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.075, 0.12), bronze);
  guard.position.set(0, 0.09, 0.035);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.095, 9, 7), bronze);
  pommel.position.y = -0.24;

  player.weapon = new THREE.Group();
  player.weapon.position.set(0.08, -0.67, -0.11);
  player.weapon.rotation.z = 2.25;
  player.weapon.add(blade, fuller, hilt, guard, pommel);
  player.rightArm.add(player.weapon);

  const bootMat = material(0x242729, { roughness: 0.73, metalness: 0.24 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.17, 0.66, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.31, 4, 8), leather);
    thigh.position.y = -0.2;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.125, 8, 7), armor);
    knee.position.y = -0.39;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.24, 3, 7), darkArmor);
    shin.position.y = -0.55;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.37), bootMat);
    boot.position.set(0, -0.7, -0.045);
    for (const part of [thigh, knee, shin, boot]) {
      part.castShadow = true;
      leg.add(part);
    }
    player.model.add(leg);
    player.legs.push(leg);
  }

  player.root.add(player.model);
  scene.add(player.root);
}

function createEnemy(id, wave, angle, radius) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  const palette = [0x777d70, 0x767269, 0x6c7774, 0x807264];
  const skin = material(palette[id % palette.length], { roughness: 0.95, metalness: 0.01 });
  const cloth = material(id % 2 ? 0x332c2a : 0x282e2e, { roughness: 1, metalness: 0.01, side: THREE.DoubleSide });
  const bone = material(0xaaa287, { roughness: 0.86, metalness: 0.01 });
  const dark = material(0x191e20, { roughness: 0.8, metalness: 0.06 });
  const coreMaterial = material(0xe37449, { color: 0xe37449, roughness: 0.3, metalness: 0.05, emissive: 0xe04c2b, emissiveIntensity: 2.2, toneMapped: false });
  const eyeMaterial = material(0xffa24f, { color: 0xffa24f, roughness: 0.25, metalness: 0, emissive: 0xff5c29, emissiveIntensity: 3, toneMapped: false });

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

  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.115, 1), coreMaterial);
  heart.position.set(0.06, 1.22, -0.235);
  model.add(heart);

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
  player.lastAttackAt = 0;
  player.facing = 0;
  player.root.rotation.y = 0;
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
    const now = performance.now() / 1000;
    player.combo = now - player.lastAttackAt < 1.25 ? Math.min(player.combo + 1, 9) : 1;
    player.lastAttackAt = now;
    tone(245, 94, 0.16, 0.025, 'sawtooth');
    updateHud();
    return;
  }

  player.attackTimer = 0.48;
  player.attackCooldown = 0.49;
  player.facing = cameraYaw;
  player.root.rotation.y = cameraYaw;
  const now = performance.now() / 1000;
  player.combo = now - player.lastAttackAt < 1.25 ? Math.min(player.combo + 1, 9) : 1;
  player.lastAttackAt = now;
  tone(245, 94, 0.16, 0.025, 'sawtooth');
  updateHud();
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

  const direction = movementDirection();
  player.walking = direction.lengthSq() > 0.025;
  if (player.dodgeTimer > 0) {
    const dash = player.dodgeDirection.clone().multiplyScalar(9.2);
    player.velocity.lerp(dash, 1 - Math.exp(-17 * delta));
  } else {
    const desired = direction.multiplyScalar(4.8);
    player.velocity.lerp(desired, 1 - Math.exp(-(player.walking ? 11.5 : 8.2) * delta));
  }

  player.root.position.x += player.velocity.x * delta;
  player.root.position.z += player.velocity.z * delta;
  limitToArena(player.root.position, player.velocity);
  player.root.position.y = terrainHeight(player.root.position.x, player.root.position.z);

  if (player.walking && player.dodgeTimer <= 0 && player.attackTimer <= 0) {
    player.facing = Math.atan2(-direction.x, -direction.z);
  }
  player.root.rotation.y = lerpAngle(player.root.rotation.y, player.facing, 1 - Math.exp(-13 * delta));

  const gait = player.walking ? Math.sin(elapsed * 10) * 0.42 : Math.sin(elapsed * 1.5) * 0.025;
  player.model.position.y = player.walking ? Math.abs(Math.sin(elapsed * 10)) * 0.035 : 0;
  player.legs[0].rotation.x = gait;
  player.legs[1].rotation.x = -gait;
  player.leftArm.rotation.x = player.walking ? -gait * 0.48 : 0.02;
  player.rightArm.rotation.x = player.walking ? gait * 0.38 : 0;

  if (player.attackTimer > 0) {
    const progress = 1 - player.attackTimer / 0.48;
    player.weapon.rotation.z = 2.25 - Math.sin(Math.min(progress / 0.86, 1) * Math.PI) * 2.35;
    player.rightArm.rotation.x = -0.32 - Math.sin(progress * Math.PI) * 0.68;
    if (progress > 0.18 && progress < 0.7) resolveSwing(progress);
  } else {
    player.weapon.rotation.z = THREE.MathUtils.damp(player.weapon.rotation.z, 2.25, 9, delta);
  }

  if (player.invulnerable > 0) {
    player.model.visible = Math.sin(elapsed * 39) > -0.25;
  } else {
    player.model.visible = true;
  }
}

let lastSwingFrame = -1;
function resolveSwing(progress) {
  const frame = Math.floor(progress * 8);
  if (frame === lastSwingFrame) return;
  lastSwingFrame = frame;
  const frontX = -Math.sin(player.root.rotation.y);
  const frontZ = -Math.cos(player.root.rotation.y);

  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const dx = enemy.root.position.x - player.root.position.x;
    const dz = enemy.root.position.z - player.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 2.55 || distance < 0.01) continue;
    const forwardDot = (dx * frontX + dz * frontZ) / distance;
    if (forwardDot < -0.04) continue;

    const damage = 35 + Math.min(player.combo, 4) * 3;
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
    ui.objective.textContent = 'Gelombang berikutnya mendekat.';
    sayToast('KEHENINGAN TAK AKAN BERTAHAN', 1900);
  }

  run.nextWaveIn -= delta;
  if (run.nextWaveIn <= 0) spawnWave(run.wave + 1);
}

function finishGame(victory) {
  if (mode !== 'playing') return;
  mode = 'ended';
  heldKeys.clear();
  $('#touch-controls').classList.add('is-hidden');
  ui.end.classList.remove('is-hidden');
  ui.end.classList.toggle('victory', victory);
  if (victory) {
    ui.endKicker.textContent = 'API MASIH MENYALA';
    ui.endTitle.innerHTML = 'Fajar<br /><em>menyambut.</em>';
    ui.endCopy.textContent = `Lima gerombolan tumbang. Kau menaklukkan ${run.kills} mayat sebelum pagi tiba.`;
    tone(310, 620, 0.62, 0.045, 'sine');
  } else {
    ui.endKicker.textContent = 'MALAM MENELAN SEGALANYA';
    ui.endTitle.innerHTML = 'Api<br /><em>meredup.</em>';
    ui.endCopy.textContent = `Perburuan berakhir setelah ${run.kills} musuh ditaklukkan. Bangkit dan coba lagi.`;
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
    torch.flame.scale.y = 1.55 + Math.sin(elapsed * 8 + torch.phase) * 0.22;
    torch.flame.rotation.z = Math.sin(elapsed * 5 + torch.phase) * 0.16;
    torch.light.intensity = 34 * flicker;
  }
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
  if (renderer) composer.render(delta);
  else if (fallbackContext) drawFallback(timestamp / 1000);
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

  const direction = movementDirection();
  player.walking = direction.lengthSq() > 0.025;
  const targetSpeed = player.dodgeTimer > 0 ? 9.2 : 4.8;
  const target = player.dodgeTimer > 0
    ? player.dodgeDirection.clone().multiplyScalar(targetSpeed)
    : direction.clone().multiplyScalar(targetSpeed);
  player.velocity.lerp(target, 1 - Math.exp(-(player.dodgeTimer > 0 ? 17 : 10) * delta));
  player.root.position.x += player.velocity.x * delta;
  player.root.position.z += player.velocity.z * delta;
  limitToArena(player.root.position, player.velocity);
  player.root.position.y = terrainHeight(player.root.position.x, player.root.position.z);

  if (player.walking && player.dodgeTimer <= 0 && player.attackTimer <= 0) {
    player.facing = Math.atan2(-direction.x, -direction.z);
  }
  player.root.rotation.y = player.facing;

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

  updateWaves(delta);
  if (Math.floor(run.elapsed * 8) !== Math.floor((run.elapsed - delta) * 8)) updateHud();
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

    enemy.health -= 35 + Math.min(player.combo, 4) * 3;
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
  const scale = Math.min(width / 30, height / 19);
  const centerX = width * (compact ? 0.63 : 0.65);
  const centerY = height * (compact ? 0.69 : 0.69);

  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#070a11');
  sky.addColorStop(0.38, '#151c25');
  sky.addColorStop(0.64, '#252522');
  sky.addColorStop(1, '#101111');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const eclipseX = width * 0.73;
  const eclipseY = height * 0.29;
  const eclipseRadius = Math.min(width, height) * 0.13;
  const eclipseGlow = context.createRadialGradient(eclipseX, eclipseY, eclipseRadius * 0.45, eclipseX, eclipseY, eclipseRadius * 2.6);
  eclipseGlow.addColorStop(0, 'rgba(173, 91, 64, 0.3)');
  eclipseGlow.addColorStop(0.45, 'rgba(122, 57, 49, 0.11)');
  eclipseGlow.addColorStop(1, 'rgba(111, 57, 49, 0)');
  context.fillStyle = eclipseGlow;
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.arc(eclipseX, eclipseY, eclipseRadius, 0, TAU);
  const moonFill = context.createRadialGradient(eclipseX - eclipseRadius * 0.3, eclipseY - eclipseRadius * 0.36, 0, eclipseX, eclipseY, eclipseRadius);
  moonFill.addColorStop(0, 'rgba(164, 101, 78, 0.88)');
  moonFill.addColorStop(0.7, 'rgba(110, 60, 53, 0.72)');
  moonFill.addColorStop(1, 'rgba(51, 39, 41, 0.24)');
  context.fillStyle = moonFill;
  context.fill();

  for (let index = 0; index < 85; index += 1) {
    const x = ((Math.sin(index * 76.13) * 4312.8) % 1 + 1) % 1 * width;
    const y = ((Math.sin(index * 13.73) * 931.6) % 1 + 1) % 1 * height * 0.55;
    const flicker = 0.27 + (Math.sin(timestamp * 0.001 + index) + 1) * 0.2;
    context.fillStyle = `rgba(204, 207, 205, ${flicker})`;
    context.fillRect(x, y, index % 8 === 0 ? 2 : 1, index % 8 === 0 ? 2 : 1);
  }

  const horizon = height * 0.55;
  context.fillStyle = '#11161a';
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
  ground.addColorStop(0, '#292a27');
  ground.addColorStop(0.3, '#20211f');
  ground.addColorStop(1, '#0d1011');
  context.fillStyle = ground;
  context.fillRect(0, horizon + 14, width, height - horizon);

  drawFallbackRuins(context, width, height);

  const arenaY = centerY + scale * 0.17;
  const radiusX = scale * 11.5 * 0.67;
  const radiusY = scale * 11.5 * 0.29;
  const floor = context.createRadialGradient(centerX, arenaY - radiusY * 0.3, 0, centerX, arenaY, radiusX);
  floor.addColorStop(0, 'rgba(74, 69, 59, 0.81)');
  floor.addColorStop(0.7, 'rgba(42, 43, 40, 0.83)');
  floor.addColorStop(1, 'rgba(17, 20, 20, 0.16)');
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX, radiusY, 0, 0, TAU);
  context.fillStyle = floor;
  context.fill();

  context.save();
  context.setLineDash([11, 8, 2, 8]);
  context.lineWidth = Math.max(1, scale * 0.035);
  context.strokeStyle = 'rgba(194, 139, 97, 0.44)';
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX * 0.82, radiusY * 0.79, 0, 0, TAU);
  context.stroke();
  context.setLineDash([]);
  context.lineWidth = Math.max(1, scale * 0.027);
  context.strokeStyle = 'rgba(168, 157, 137, 0.2)';
  context.beginPath();
  context.ellipse(centerX, arenaY, radiusX * 0.89, radiusY * 0.89, 0, 0, TAU);
  context.stroke();
  context.restore();

  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * TAU;
    const x = centerX + Math.cos(angle) * radiusX * 0.8;
    const y = arenaY + Math.sin(angle) * radiusY * 0.78;
    const rune = context.createLinearGradient(x - 3, y - 3, x + 3, y + 3);
    rune.addColorStop(0, 'rgba(220, 163, 113, 0.73)');
    rune.addColorStop(1, 'rgba(135, 90, 62, 0.28)');
    context.strokeStyle = rune;
    context.lineWidth = Math.max(1, scale * 0.045);
    context.beginPath();
    context.moveTo(x - Math.cos(angle) * scale * 0.17, y - Math.sin(angle) * scale * 0.1);
    context.lineTo(x + Math.cos(angle + 0.23) * scale * 0.15, y + Math.sin(angle + 0.23) * scale * 0.12);
    context.stroke();
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * TAU + Math.PI / 5;
    const torchX = centerX + Math.cos(angle) * radiusX * 0.94;
    const torchY = arenaY + Math.sin(angle) * radiusY * 0.94;
    drawFallbackTorch(context, torchX, torchY, scale, timestamp, index);
  }

  const figures = fallback.enemies.filter((enemy) => enemy.deathTimer > 0 || !enemy.dead).map((enemy) => ({
    x: enemy.x,
    z: enemy.z,
    enemy,
  }));
  if (mode === 'menu') figures.push({ x: 4.2, z: -6.2, ambient: true, enemy: { facing: 0.35, phase: 0, flash: 0, attackWindup: -1 } });
  figures.push({ x: player.root.position.x, z: player.root.position.z, hero: true });
  figures.sort((a, b) => a.z - b.z);

  for (const figure of figures) {
    const lift = figure.enemy?.dead ? Math.max(0, 1 - figure.enemy.deathTimer / 0.58) * -0.35 : 0;
    const screenX = centerX + figure.x * scale * 0.67;
    const screenY = arenaY + figure.z * scale * 0.28 + lift * scale;
    if (figure.hero) {
      const attackProgress = player.attackTimer > 0 ? 1 - player.attackTimer / (fallbackContext ? 0.42 : 0.48) : 0;
      drawFallbackFighter(context, screenX, screenY, scale, false, player.facing, timestamp, attackProgress, player.invulnerable, 1);
    } else {
      const alpha = figure.ambient ? 0.5 : figure.enemy.dead ? Math.max(0, figure.enemy.deathTimer / 0.58) : 1;
      drawFallbackFighter(
        context,
        screenX,
        screenY,
        scale * (figure.ambient ? 0.9 : 1),
        true,
        figure.enemy.facing,
        timestamp + figure.enemy.phase * 100,
        figure.enemy.attackWindup > 0 ? 0.7 : 0,
        figure.enemy.flash > 0 ? 0.2 : 0,
        alpha,
      );
    }
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
  mist.addColorStop(0, 'rgba(166, 181, 181, 0.08)');
  mist.addColorStop(1, 'rgba(155, 164, 160, 0)');
  context.fillStyle = mist;
  context.fillRect(0, horizon - 15, width, height * 0.72 - horizon);
}

function drawFallbackRuins(context, width, height) {
  const count = Math.ceil(width / 112);
  for (let index = 0; index < count; index += 1) {
    const x = index * 112 + 18;
    const base = height * (0.57 + Math.sin(index * 3.7) * 0.018);
    const pillarHeight = height * (0.1 + ((index * 37) % 7) * 0.012);
    const pillarWidth = 12 + (index % 3) * 5;
    context.fillStyle = index % 2 ? 'rgba(12, 16, 18, 0.85)' : 'rgba(18, 20, 20, 0.88)';
    context.beginPath();
    context.moveTo(x, base);
    context.lineTo(x + 2, base - pillarHeight);
    context.lineTo(x + pillarWidth * 0.42, base - pillarHeight - 6);
    context.lineTo(x + pillarWidth, base - pillarHeight + 4);
    context.lineTo(x + pillarWidth - 2, base);
    context.closePath();
    context.fill();
    if (index % 2 === 0) {
      context.fillRect(x - 3, base - pillarHeight, pillarWidth + 6, 8);
      context.fillRect(x - 1, base - pillarHeight + 8, pillarWidth + 2, 4);
    }
  }

  for (let index = 0; index < 12; index += 1) {
    const x = ((index * 193 + 61) % Math.max(width, 1));
    const y = height * (0.48 + ((index * 19) % 10) * 0.013);
    const treeHeight = height * (0.11 + ((index * 11) % 7) * 0.012);
    context.strokeStyle = 'rgba(10, 14, 15, 0.86)';
    context.lineWidth = 4 + (index % 3);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x, y + treeHeight);
    context.lineTo(x + Math.sin(index) * 10, y);
    context.moveTo(x, y + treeHeight * 0.35);
    context.lineTo(x - 15, y + treeHeight * 0.13);
    context.moveTo(x, y + treeHeight * 0.52);
    context.lineTo(x + 18, y + treeHeight * 0.28);
    context.stroke();
  }
}

function drawFallbackTorch(context, x, y, scale, timestamp, index) {
  const size = Math.max(2, scale * 0.16);
  const glow = context.createRadialGradient(x, y - size * 1.2, 1, x, y - size * 1.2, size * 4.5);
  glow.addColorStop(0, 'rgba(255, 155, 85, 0.26)');
  glow.addColorStop(1, 'rgba(255, 126, 62, 0)');
  context.fillStyle = glow;
  context.fillRect(x - size * 5, y - size * 6, size * 10, size * 10);
  context.fillStyle = '#262624';
  context.fillRect(x - size * 0.16, y - size * 1.15, size * 0.32, size * 1.1);
  const flicker = 0.83 + Math.sin(timestamp * 0.006 + index) * 0.12;
  context.save();
  context.translate(x, y - size * 1.3);
  context.scale(flicker, 1 + Math.sin(timestamp * 0.009 + index * 2) * 0.12);
  context.fillStyle = '#ff9a5c';
  context.beginPath();
  context.moveTo(0, -size * 1.3);
  context.quadraticCurveTo(size * 1.1, -size * 0.15, 0, size * 0.08);
  context.quadraticCurveTo(-size * 0.85, -size * 0.2, 0, -size * 1.3);
  context.fill();
  context.fillStyle = '#f2c28a';
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
