import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import ember from '../../bosses/house/ember-anvil.json';
import neon from '../../bosses/house/neon-brood.json';
import prism from '../../bosses/house/prism-warden.json';
import serpent from '../../bosses/house/brass-serpent.json';
import { codexSvg, twitchSvg } from '../shared/brand-marks';
import type { HeroScene } from './scene';

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Brand marks
for (const el of document.querySelectorAll<HTMLElement>('[data-mark]')) {
  el.innerHTML = el.dataset.mark === 'twitch' ? twitchSvg() : codexSvg();
}

// House boss cards, straight from the checked-in specs.
const shapes: Record<string, string> = { mech: 'hex', blob: 'orb', crystal: 'diamond' };
const cards = document.getElementById('boss-cards')!;
for (const boss of [ember, neon, prism, serpent]) {
  const [a, b, c] = boss.look.palette;
  const card = document.createElement('article');
  card.className = 'boss-card';
  card.dataset.tilt = '';
  card.style.setProperty('--a', a ?? '#cbf579');
  card.style.setProperty('--b', b ?? '#ffffff');
  card.style.setProperty('--c', c ?? '#111411');
  card.innerHTML = `<div class="boss-art ${shapes[boss.look.shape] ?? 'orb'}"><i></i></div>
    <p class="eyebrow">${boss.phases.length} PHASES · ${boss.hp.toLocaleString()} HP</p>
    <h3></h3><blockquote></blockquote><p class="taunt"></p>`;
  card.querySelector('h3')!.textContent = boss.meta.name;
  card.querySelector('blockquote')!.textContent = `“${boss.meta.sourceQuote}”`;
  card.querySelector('.taunt')!.textContent = boss.taunts.intro;
  cards.append(card);
}

// 3D tilt that follows the pointer.
function bindTilt(el: HTMLElement): void {
  const rx = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
  const ry = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
  gsap.set(el, { transformPerspective: 900 });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    rx(-y * 14); ry(x * 18);
    el.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    el.style.setProperty('--my', `${(y + 0.5) * 100}%`);
  });
  el.addEventListener('pointerleave', () => { rx(0); ry(0); });
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
let scene: HeroScene | null = null;
// Three.js is large, so load the scene after the page text is up.
import('./scene').then(({ createHeroScene }) => {
  scene = createHeroScene(canvas);
  if (!scene) root.classList.add('no-webgl');
  else if (reduceMotion) scene.setStaticFrame();
  else scene.setProgress(ScrollTrigger.getAll()[0]?.progress ?? 0);
}).catch(() => root.classList.add('no-webgl'));

if (!reduceMotion) {
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach(bindTilt);

  // Marquee loops run independently of scroll position.
  const loops = [...document.querySelectorAll<HTMLElement>('.marquee-row')].map((row) => {
    row.innerHTML += row.innerHTML; // seamless loop
    const dir = Number(row.dataset.direction);
    return gsap.fromTo(row, { xPercent: dir < 0 ? 0 : -50 }, { xPercent: dir < 0 ? -50 : 0, duration: 40, ease: 'none', repeat: -1 });
  });

  // Scroll triggers are created top to bottom after fonts load, so the
  // pinned manifesto is measured before anything below it.
  document.fonts.ready.then(() => {
    const lines = SplitText.create('.hero-title .line', { type: 'words,chars', mask: 'words' });
    root.classList.add('motion-ready');

    // Hero intro: characters flip up out of a mask.
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.nav', { y: -40, autoAlpha: 0, duration: 1 })
      .from(lines.chars, { yPercent: 120, rotationX: -90, transformOrigin: '50% 100% -20px', duration: 1.1, stagger: 0.018 }, 0.1)
      .from('.hero .reveal', { y: 30, autoAlpha: 0, duration: 1, stagger: 0.1 }, 0.6)
      .from('.platform', { rotationY: -90, z: -80, autoAlpha: 0, duration: 1.2, stagger: 0.15, transformPerspective: 600 }, 0.9);

    // Hero copy drifts back as you leave.
    gsap.to('.hero', { yPercent: -18, autoAlpha: 0.15, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

    // Marquee: tilts with scroll, speeds up with scroll velocity.
    gsap.to('.marquee', { rotation: -2, ease: 'none', scrollTrigger: { trigger: '.marquee', scrub: true } });
    ScrollTrigger.create({
      trigger: '.marquee', start: 'top bottom', end: 'bottom top',
      onUpdate: (self) => {
        const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 300, 6);
        loops.forEach((t) => gsap.to(t, { timeScale: boost, duration: 0.2, overwrite: true, onComplete: () => { gsap.to(t, { timeScale: 1, duration: 1.2 }); } }));
      },
    });

    // Dim the 3D scene behind the reading sections.
    gsap.to(canvas, { opacity: 0.35, ease: 'none', scrollTrigger: { trigger: '.manifesto', start: 'top bottom', end: 'top top', scrub: true } });

    // Manifesto: pinned, words light up as you scroll.
    const words = SplitText.create('.scrub-text', { type: 'words' }).words;
    gsap.timeline({ scrollTrigger: { trigger: '.manifesto', start: 'top top', end: '+=140%', scrub: 0.6, pin: true } })
      .fromTo(words, { opacity: 0.12, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)', stagger: 0.1, ease: 'none' });

    // Section headings: words rise and un-tilt on enter.
    for (const heading of document.querySelectorAll('.split-heading')) {
      const split = SplitText.create(heading, { type: 'words', mask: 'words' });
      gsap.from(split.words, {
        yPercent: 110, rotationZ: 6, duration: 1, ease: 'power4.out', stagger: 0.06,
        scrollTrigger: { trigger: heading, start: 'top 85%' },
      });
    }

    // Steps fly in from depth.
    gsap.from('.step', {
      z: -400, rotationX: 35, rotationY: -20, autoAlpha: 0, transformPerspective: 1000, stagger: 0.12, ease: 'power3.out', duration: 1.2,
      scrollTrigger: { trigger: '.steps', start: 'top 80%' },
    });

    // Counters
    gsap.from('.stats > div', { y: 60, autoAlpha: 0, stagger: 0.1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.stats', start: 'top 85%' } });
    for (const el of document.querySelectorAll<HTMLElement>('.count')) {
      const target = Number(el.dataset.to), state = { v: 0 };
      gsap.to(state, {
        v: target, duration: 1.6, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%' },
        onUpdate: () => { el.textContent = String(Math.round(state.v)); },
      });
    }

    // Boss cards rise with a slight swing.
    gsap.from('.boss-card', {
      y: 120, rotationX: -25, autoAlpha: 0, transformPerspective: 900, stagger: 0.15, duration: 1.2, ease: 'power3.out',
      scrollTrigger: { trigger: '#boss-cards', start: 'top 85%' },
    });

    // Finale: scene returns to full strength, text grows into view.
    gsap.to(canvas, { opacity: 1, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.finale', start: 'top bottom', end: 'center center', scrub: true } });
    const finale = SplitText.create('.finale-title', { type: 'chars' });
    gsap.from(finale.chars, {
      yPercent: 60, scale: 0.4, autoAlpha: 0, rotationY: 90, stagger: 0.05, ease: 'none',
      scrollTrigger: { trigger: '.finale', start: 'top 80%', end: 'center 60%', scrub: 0.8 },
    });

    // The 3D scene follows overall page progress (created last so 'max' includes the pin).
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => scene?.setProgress(self.progress) });
    ScrollTrigger.refresh();
  });
}
