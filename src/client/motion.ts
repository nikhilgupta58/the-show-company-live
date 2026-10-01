// The motion core. No dependency: IntersectionObserver + the Web Animations API + CSS.
//
// The contract (DESIGN.md §8):
//   · Nothing is hidden in CSS. An element is held back only by a paused animation that this
//     file created, and only if the element was still below the fold when this file ran.
//   · If this file never loads, or an observer never fires, the page is simply complete.
//   · Every reveal ends by cancelling its own animation, so the element finishes on its plain
//     CSS: opacity 1, no transform, no filter.
//   · Photographs are never faded. A photo is uncovered by a curtain; every visible pixel of it
//     is at full brightness from the first frame.
//   · prefers-reduced-motion: nothing is armed. The page is static and complete.
//
// Markup:
//   data-reveal            rise (default) for text blocks
//   data-reveal="lines"    a heading whose lines rise one after another
//   data-reveal="rule"     a hairline that draws from the left
//   data-reveal="curtain"  a <Photo> that is uncovered: a portrait window's curtain rises, a
//                          landscape window (and anything in a side-scroller) is wiped sideways
//   data-reveal="stagger"  a list or row whose children rise in sequence
//   data-spot              the followspot (<Followspot>, which <Hero> carries; see followspot() below)
//   data-reveal-delay="ms" holds any of the above back a little longer once it is in view, to
//                          sequence the parts of one block (a heading, then its list, then a photo)
// Above the fold use the CSS-only `data-enter` instead (base.css): it runs without JavaScript.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
const STAGGER = 70;

interface Held {
  el: HTMLElement;
  play: () => void;
  done: boolean;
}
const held = new Map<Element, Held>();

/** A paused animation that holds `el` on its first keyframe until play() is called. */
function hold(el: Element, frames: Keyframe[], timing: KeyframeAnimationOptions): Animation {
  const anim = el.animate(frames, { fill: 'backwards', ...timing });
  anim.pause();
  anim.addEventListener('finish', () => anim.cancel());
  return anim;
}

const RISE: Keyframe[] = [
  { opacity: 0, transform: 'translate3d(0, 24px, 0)' },
  { opacity: 1, transform: 'translate3d(0, 0, 0)' },
];

function armRise(el: HTMLElement): () => void {
  const anim = hold(el, RISE, { duration: 900, easing: EXPO });
  return () => anim.play();
}

function armRule(el: HTMLElement): () => void {
  const anim = hold(el, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 1200, easing: EXPO });
  return () => anim.play();
}

function armStagger(el: HTMLElement): () => void {
  const anims = Array.from(el.children).map((child, i) => hold(child, RISE, { duration: 900, easing: EXPO, delay: Math.min(i, 8) * STAGGER }));
  return () => anims.forEach((a) => a.play());
}

/** The cover rests at scale 0 in its own style, so if its animation is ever lost the photo is bare.
    Portrait windows: the curtain rises. Landscape windows and side-scroller cards: it is drawn
    aside, left to right (the direction of travel). */
function armCurtain(el: HTMLElement): (() => void) | null {
  const frame = el.querySelector<HTMLElement>('.photo__window') ?? el;
  const box = frame.getBoundingClientRect();
  // In a side-scroller the cards are uncovered one after another, in the direction of travel.
  const track = el.closest('[data-scroller-track]');
  const item = track ? Array.from(track.children).findIndex((child) => child.contains(el)) : 0;
  const wipe = Boolean(track) || box.width > box.height * 1.15;
  const axis = wipe ? 'scaleX' : 'scaleY';
  const cover = document.createElement('span');
  cover.setAttribute('aria-hidden', 'true');
  cover.style.cssText = `position:absolute;inset:-1px;z-index:2;pointer-events:none;background:var(--ground,#050505);transform:${axis}(0);transform-origin:${wipe ? 'right center' : 'center top'}`;
  frame.append(cover);
  const anim = cover.animate([{ transform: `${axis}(1)` }, { transform: `${axis}(0)` }], { duration: wipe ? 1250 : 1100, delay: Math.min(Math.max(item, 0), 4) * 90, easing: IN_OUT, fill: 'backwards' });
  anim.pause();
  anim.addEventListener('finish', () => cover.remove());
  return () => anim.play();
}

/** Split a heading into words, hold each word under its own baseline, release line by line. */
function armLines(el: HTMLElement): () => void {
  const original = el.innerHTML;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  const words: { clip: HTMLElement; anim: Animation }[] = [];
  for (const node of texts) {
    const parts = (node.nodeValue ?? '').split(/(\s+)/);
    if (parts.length === 1 && !parts[0].trim()) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (!part.trim()) {
        frag.append(part);
        continue;
      }
      const clip = document.createElement('span');
      const inner = document.createElement('span');
      // The clip is one line tall; the padding / negative margin pair keeps descenders visible.
      clip.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:0.16em;margin-bottom:-0.16em';
      inner.style.cssText = 'display:inline-block;will-change:transform';
      inner.textContent = part;
      clip.append(inner);
      frag.append(clip);
      words.push({ clip, anim: hold(inner, [{ transform: 'translate3d(0, 112%, 0)' }, { transform: 'translate3d(0, 0, 0)' }], { duration: 1100, easing: EXPO }) });
    }
    node.replaceWith(frag);
  }
  return () => {
    if (!words.length) return;
    // Group words into visual lines at the moment of release, then stagger by line.
    let line = -1;
    let top = Number.NaN;
    words.forEach(({ clip, anim }) => {
      if (clip.offsetTop !== top) {
        top = clip.offsetTop;
        line += 1;
      }
      anim.effect?.updateTiming({ delay: Math.min(line, 5) * 95 });
      anim.play();
    });
    // Put the untouched markup back once the last word has landed.
    Promise.all(words.map((w) => w.anim.finished.catch(() => undefined))).then(() => {
      el.innerHTML = original;
    });
  };
}

function arm(el: HTMLElement): (() => void) | null {
  switch (el.dataset.reveal) {
    case 'lines':
      return armLines(el);
    case 'rule':
      return armRule(el);
    case 'curtain':
      return armCurtain(el);
    case 'stagger':
      return armStagger(el);
    default:
      return armRise(el);
  }
}

function release(el: Element, now = false) {
  const h = held.get(el);
  if (!h || h.done) return;
  h.done = true;
  const delay = now ? 0 : Math.min(Number((el as HTMLElement).dataset.revealDelay) || 0, 1200);
  if (delay > 0) window.setTimeout(h.play, delay);
  else h.play();
}

function reveals() {
  if (reduced.matches || !('IntersectionObserver' in window) || typeof Element.prototype.animate !== 'function') return;
  const fold = window.innerHeight * 0.94;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        release(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0 },
  );
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    // Anything already on screen (or not rendered at all) is left exactly as it is.
    if (el.getBoundingClientRect().top < fold) return;
    const play = arm(el);
    if (!play) return;
    held.set(el, { el, play, done: false });
    io.observe(el);
  });
  if (!held.size) return;

  // Belt and braces: if an observer callback is ever missed, a scroll releases whatever is in view.
  let queued = false;
  const sweep = () => {
    queued = false;
    const h = window.innerHeight;
    held.forEach((item) => {
      // Vertical position only: a card waiting off to the side of a scroller is released with its
      // row, so no photograph can be left covered by a missed observer.
      if (!item.done && item.el.getBoundingClientRect().top < h) release(item.el);
    });
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sweep);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  // Printing, or switching to reduced motion mid-visit, shows everything at once.
  const releaseAll = () => held.forEach((item) => release(item.el, true));
  window.addEventListener('beforeprint', releaseAll);
  reduced.addEventListener('change', releaseAll);
}

// ── The followspot: the system's one signature. A soft amber pool on black ground, behind a
//    headline (<Followspot> draws it; <Hero> keeps it off the photograph and out of the logo's
//    zone). It lights the words; it never dims or covers anything.
//      · no JavaScript, or reduced motion: it rests where the CSS puts it, behind the headline
//      · a mouse: it follows the pointer over its block (the hero, or a standalone <Followspot>'s
//        wrapper) with an operator's lag (a 130ms time constant), and goes back to the headline
//        when the pointer leaves
//      · touch: it swings in once from the photograph's side as the curtain lifts, then rests
//    Transform only (`translate` for the rest point, `transform` for the motion), so it never
//    shifts layout. One element, and the loop stops as soon as the light has settled.
function followspot(spot: HTMLElement) {
  const stage = spot.parentElement;
  const hero = spot.closest<HTMLElement>('[data-hero], [data-spot-scope]') ?? stage?.parentElement;
  if (!stage || !hero) return;

  // Rest: behind the headline (a marked target, the hero's statement, or the first heading). The
  // CSS puts the pool's centre at its own left/top; the rest point is reached with `translate`.
  const rest = { x: 0, y: 0 };
  const place = () => {
    const words = hero.querySelector<HTMLElement>('[data-spot-target], .hero__statement') ?? hero.querySelector<HTMLElement>('h1, h2');
    const copy = words?.offsetParent;
    const s = stage.getBoundingClientRect();
    if (!words || !copy || !s.width || !s.height) return;
    // Layout offsets, not the on-screen box: the words may still be rising in on their entrance.
    const c = copy.getBoundingClientRect();
    rest.x = c.left - s.left + words.offsetLeft + Math.min(words.offsetWidth * 0.42, 320);
    rest.y = c.top - s.top + words.offsetTop + words.offsetHeight * 0.5;
    const css = getComputedStyle(spot);
    spot.style.setProperty('--rx', `${(rest.x - parseFloat(css.left)).toFixed(1)}px`);
    spot.style.setProperty('--ry', `${(rest.y - parseFloat(css.top)).toFixed(1)}px`);
  };
  place();
  document.fonts?.ready.then(place);
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(stage);
  if (reduced.matches || typeof spot.animate !== 'function') return;

  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    // Touch: one sweep, from the photograph's side to the headline, while the curtain lifts.
    const s = stage.getBoundingClientRect();
    const from = `translate3d(${Math.round(s.width * 0.55)}px, ${Math.round(-s.height * 0.3)}px, 0)`;
    spot.animate([{ transform: from }, { transform: 'translate3d(0, 0, 0)' }], { duration: 2200, delay: 500, easing: EXPO, fill: 'backwards' });
    return;
  }

  // Mouse: exponential smoothing towards the pointer; x and y are offsets from the rest point.
  const TAU = 130;
  let x = 0;
  let y = 0;
  let tx = 0;
  let ty = 0;
  let last = 0;
  let running = false;
  const tick = (now: number) => {
    const k = 1 - Math.exp(-Math.min(now - last, 64) / TAU);
    last = now;
    x += (tx - x) * k;
    y += (ty - y) * k;
    if (Math.abs(tx - x) < 0.1 && Math.abs(ty - y) < 0.1) {
      x = tx;
      y = ty;
      running = false;
    }
    spot.style.transform = x || y ? `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)` : '';
    if (running) requestAnimationFrame(tick);
  };
  const aim = (nx: number, ny: number) => {
    tx = nx;
    ty = ny;
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  };
  hero.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse' || reduced.matches) return;
      const s = stage.getBoundingClientRect();
      // The pool's centre stays on the stage; the stage's own mask fades it out at the edges.
      aim(Math.min(Math.max(event.clientX - s.left, 0), s.width) - rest.x, Math.min(Math.max(event.clientY - s.top, 0), s.height) - rest.y);
    },
    { passive: true },
  );
  hero.addEventListener('pointerleave', () => aim(0, 0), { passive: true });
  reduced.addEventListener('change', () => {
    if (reduced.matches) aim(0, 0);
  });
}

reveals();
document.querySelectorAll<HTMLElement>('[data-spot]').forEach(followspot);
