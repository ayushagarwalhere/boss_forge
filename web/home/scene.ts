import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TWITCH_GLITCH_PATH, TWITCH_PURPLE } from '../shared/brand-marks';

/** Core colour per scroll stop: hero, chat, gate, arena. */
const STOPS = ['#cbf579', TWITCH_PURPLE, '#78ffb2', '#ff7038'].map((c) => new THREE.Color(c));
const BULLETS = 360;
const RINGS = 6;

export interface HeroScene {
  setProgress(value: number): void;
  setStaticFrame(): void;
}

function twitchGeometry(): THREE.ExtrudeGeometry {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${TWITCH_GLITCH_PATH}"/></svg>`;
  const shapes = new SVGLoader().parse(svg).paths.flatMap((path) => SVGLoader.createShapes(path));
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 3, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.35, bevelSegments: 3, curveSegments: 4 });
  geometry.center();
  geometry.scale(0.055, -0.055, 0.055); // SVG y points down
  return geometry;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number, path: THREE.Path): void {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

function codexGeometry(): THREE.ExtrudeGeometry {
  const frame = new THREE.Shape();
  roundedRect(-12, -12, 24, 24, 7, frame);
  const hole = new THREE.Path();
  roundedRect(-9.6, -9.6, 19.2, 19.2, 5, hole);
  frame.holes.push(hole);

  const chevron = new THREE.Shape();
  chevron.moveTo(-6.4, 5.4); chevron.lineTo(-4.2, 5.4); chevron.lineTo(0.4, 0.4);
  chevron.lineTo(-4.2, -4.6); chevron.lineTo(-6.4, -4.6); chevron.lineTo(-1.8, 0.4);
  chevron.lineTo(-6.4, 5.4);

  const underscore = new THREE.Shape();
  roundedRect(1.4, -5.4, 5.6, 2.2, 1, underscore);

  const geometry = new THREE.ExtrudeGeometry([frame, chevron, underscore], { depth: 3, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.35, bevelSegments: 3, curveSegments: 8 });
  geometry.center();
  geometry.scale(0.055, 0.055, 0.055);
  return geometry;
}

export function createHeroScene(canvas: HTMLCanvasElement): HeroScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c0a, 0.045);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rimA = new THREE.PointLight(0xcbf579, 30, 20);
  rimA.position.set(-4, 2, 3);
  const rimB = new THREE.PointLight(0x9146ff, 40, 20);
  rimB.position.set(4, -3, 2);
  scene.add(rimA, rimB);

  // The boss core: a faceted heart with a counter-rotating wire cage.
  const rig = new THREE.Group();
  scene.add(rig);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x1a1f17, emissive: STOPS[0]!.clone(), emissiveIntensity: 0.32, flatShading: true, metalness: 0.6, roughness: 0.25 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), coreMat);
  const cageMat = new THREE.LineBasicMaterial({ color: STOPS[0]!.clone(), transparent: true, opacity: 0.55 });
  const cage = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.95, 1)), cageMat);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.015, 8, 160), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  halo.rotation.x = Math.PI / 2.3;
  rig.add(core, cage, halo);

  // Bullet rings: expanding spirals, like a boss firing volleys.
  const bulletMat = new THREE.MeshBasicMaterial({ color: STOPS[0]!.clone() });
  const bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 8), bulletMat, BULLETS);
  rig.add(bullets);
  const dummy = new THREE.Object3D();

  // Platform marks orbit the core.
  const twitch = new THREE.Mesh(twitchGeometry(), new THREE.MeshStandardMaterial({ color: TWITCH_PURPLE, emissive: 0x2a1060, metalness: 0.35, roughness: 0.3 }));
  const codex = new THREE.Mesh(codexGeometry(), new THREE.MeshStandardMaterial({ color: 0xf1f2ea, emissive: 0x1d2416, metalness: 0.5, roughness: 0.22 }));
  rig.add(twitch, codex);

  // Distant dust.
  const dustPositions = new Float32Array(900 * 3);
  for (let i = 0; i < dustPositions.length; i += 3) {
    dustPositions[i] = (Math.random() - 0.5) * 40;
    dustPositions[i + 1] = (Math.random() - 0.5) * 26;
    dustPositions[i + 2] = -Math.random() * 30;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x9aa58c, size: 0.03, transparent: true, opacity: 0.7 }));
  scene.add(dust);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let progress = 0;
  let smooth = 0;
  const pointer = new THREE.Vector2();
  const look = new THREE.Vector2();
  const tint = new THREE.Color();
  let wide = true;

  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    wide = w > 900;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.enabled = w > 760;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  function colorAt(p: number, out: THREE.Color): THREE.Color {
    const x = Math.min(Math.max(p, 0), 0.999) * (STOPS.length - 1);
    const i = Math.floor(x);
    return out.copy(STOPS[i]!).lerp(STOPS[i + 1]!, x - i);
  }

  function frame(t: number): void {
    smooth += (progress - smooth) * 0.06;
    look.lerp(pointer, 0.05);

    // Core sits right of the hero copy, then drifts to centre stage.
    const heroX = wide ? 2.4 : 0;
    rig.position.x = THREE.MathUtils.lerp(heroX, 0, Math.min(smooth * 3, 1));
    rig.position.y = wide ? 0 : 2.8 - Math.min(smooth * 3, 1) * 2.8;
    camera.position.z = 9 - Math.sin(smooth * Math.PI) * 1.2;
    camera.position.x = look.x * 0.6;
    camera.position.y = -look.y * 0.4;
    camera.lookAt(rig.position.x * 0.5, 0, 0);

    colorAt(smooth, tint);
    coreMat.emissive.copy(tint);
    cageMat.color.copy(tint);
    bulletMat.color.copy(tint);

    const spin = t * 0.25 + smooth * Math.PI * 2;
    core.rotation.set(spin * 0.7, spin, 0);
    cage.rotation.set(-spin * 0.4, -spin * 0.6, spin * 0.2);
    halo.rotation.z = spin * 0.5;
    const pulse = 1 + Math.sin(t * 2.4) * 0.04;
    core.scale.setScalar(pulse);

    // Each ring expands from the core, fades out by shrinking, then restarts.
    const perRing = BULLETS / RINGS;
    for (let i = 0; i < BULLETS; i++) {
      const ring = Math.floor(i / perRing);
      const k = i % perRing;
      const life = (t * 0.22 + ring / RINGS) % 1;
      const radius = 1.5 + life * 4.2;
      const angle = (k / perRing) * Math.PI * 2 + life * 1.6 * (ring % 2 ? 1 : -1);
      dummy.position.set(Math.cos(angle) * radius, Math.sin(angle * 3 + ring) * 0.25, Math.sin(angle) * radius);
      dummy.scale.setScalar(1 - life * 0.85);
      dummy.updateMatrix();
      bullets.setMatrixAt(i, dummy.matrix);
    }
    bullets.instanceMatrix.needsUpdate = true;
    bullets.rotation.x = 0.45 + Math.sin(t * 0.3) * 0.1;

    const orbit = t * 0.35 + smooth * Math.PI * 3;
    const r = 3.1 + Math.sin(smooth * Math.PI) * 0.3;
    twitch.position.set(Math.cos(orbit) * r, 0.9 + Math.sin(t * 0.9) * 0.25, Math.sin(orbit) * r);
    codex.position.set(Math.cos(orbit + Math.PI) * r, -0.8 + Math.cos(t * 0.8) * 0.25, Math.sin(orbit + Math.PI) * r);
    twitch.rotation.set(Math.sin(t * 0.6) * 0.3, -orbit + Math.PI / 2 + Math.sin(t) * 0.4, 0);
    codex.rotation.set(Math.cos(t * 0.5) * 0.3, -orbit - Math.PI / 2 + Math.cos(t) * 0.4, 0);

    dust.rotation.y = t * 0.01 + smooth * 0.4;
    composer.render();
  }

  let running = true;
  const clock = new THREE.Clock();
  function loop(): void {
    if (!running) return;
    frame(clock.getElapsedTime());
    requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; clock.stop(); }
    else if (!running) { running = true; clock.start(); loop(); }
  });
  loop();

  return {
    setProgress(value) { progress = value; },
    setStaticFrame() { running = false; frame(1.2); },
  };
}
