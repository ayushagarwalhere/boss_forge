import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { codexSvg, twitchSvg } from './brand-marks';

gsap.registerPlugin(SplitText);

const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "Codex × Twitch" pill in the masthead. Shown with or without motion. */
export function mountPlatformBadge(): void {
  const masthead = document.querySelector('.masthead');
  if (!masthead || masthead.querySelector('.platform-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'platform-badge';
  badge.setAttribute('aria-label', 'Built with Codex for Twitch');
  badge.innerHTML = `<span class="pb codex" title="Built with Codex">${codexSvg()}</span><span class="pb-x" aria-hidden="true">×</span><span class="pb twitch" title="Made for Twitch">${twitchSvg()}</span>`;
  masthead.insertBefore(badge, masthead.querySelector('.local'));
}

/** Pointer-following 3D tilt. */
export function bindTilt(el: HTMLElement, strength = 10): void {
  const rx = gsap.quickTo(el, 'rotationX', { duration: 0.45, ease: 'power3' });
  const ry = gsap.quickTo(el, 'rotationY', { duration: 0.45, ease: 'power3' });
  gsap.set(el, { transformPerspective: 700 });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    rx(-((e.clientY - r.top) / r.height - 0.5) * strength);
    ry(((e.clientX - r.left) / r.width - 0.5) * strength * 1.3);
  });
  el.addEventListener('pointerleave', () => { rx(0); ry(0); });
}

/**
 * Animate children that appear in a container that is re-rendered wholesale.
 * Only items with an unseen key animate, so live updates don't replay old rows.
 */
export function animateNewChildren(container: HTMLElement, key: (el: Element) => string, from: gsap.TweenVars): void {
  if (reduceMotion()) return;
  const seen = new Set<string>();
  const run = (): void => {
    const fresh = [...container.children].filter((child) => {
      if (child.classList.contains('empty')) return false;
      const k = key(child);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length) gsap.from(fresh, { ...from, stagger: 0.06, clearProps: 'transform,opacity,visibility' });
  };
  new MutationObserver(run).observe(container, { childList: true });
  run();
}

/** Re-split and animate a heading each time its text is replaced. */
export function animateTextSwaps(el: HTMLElement): void {
  if (reduceMotion()) return;
  let split: SplitText | null = null;
  let last = el.textContent ?? '';
  const observer = new MutationObserver(() => {
    const text = el.textContent ?? '';
    if (text === last) return;
    last = text;
    observer.disconnect();
    split?.revert();
    el.textContent = text;
    split = SplitText.create(el, { type: 'chars', mask: 'chars' });
    gsap.from(split.chars, { yPercent: 110, rotationX: -80, duration: 0.7, ease: 'expo.out', stagger: 0.025 });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  });
  observer.observe(el, { childList: true, characterData: true, subtree: true });
}

/** Page entrance: masthead, split headline, then panels rising out of depth. */
export function playEntrance(panels: string): void {
  if (reduceMotion()) return;
  document.fonts.ready.then(() => {
    const heading = document.querySelector('.page-heading h1');
    const split = heading ? SplitText.create(heading, { type: 'words,chars', mask: 'words' }) : null;
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.masthead > *', { y: -24, autoAlpha: 0, duration: 0.8, stagger: 0.08 });
    if (split) tl.from(split.chars, { yPercent: 120, rotationX: -90, transformOrigin: '50% 100% -16px', duration: 1, stagger: 0.015 }, 0.1);
    tl.from('.page-heading .eyebrow, .heading-note', { y: 16, autoAlpha: 0, duration: 0.8, stagger: 0.1 }, 0.3)
      .from(panels, { y: 50, rotationX: -14, transformPerspective: 1100, transformOrigin: '50% 0%', autoAlpha: 0, duration: 1.1, stagger: 0.08, clearProps: 'transform' }, 0.35);
  });
}

export const prefersReducedMotion = reduceMotion;
