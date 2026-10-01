// Site-wide behaviour: the header's state, the menu, tabs, side-scrollers and the phone dock.
// Each block upgrades markup that already works without it:
//   chrome    the header is complete as served; this marks the moment the page's first block has
//             scrolled away (html.is-past-hero), which the header answers by lighting Enquire
//             solid and, on a desktop, folding the page links into the Menu
//   menu      the Menu control is a link to the footer navigation until this opens the <dialog>
//   tabs      every panel is on the page, stacked under its own heading, until this adds the tablist
//   scroller  the track scrolls natively; this only adds the previous / next buttons
//   dock      always visible; this only moves it out of the way while the enquiry form is on screen
//             (and marks html.is-at-form, so the header's Enquire is outlined beside the form's
//             own solid send button)

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function menu() {
  const dialog = document.querySelector<HTMLDialogElement>('#site-menu');
  const opener = document.querySelector<HTMLAnchorElement>('[data-menu-open]');
  if (!dialog || !opener || typeof dialog.showModal !== 'function') return;
  opener.setAttribute('role', 'button');
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.setAttribute('aria-controls', dialog.id);
  opener.setAttribute('aria-expanded', 'false');
  const open = () => {
    dialog.showModal();
    opener.setAttribute('aria-expanded', 'true');
  };
  opener.addEventListener('click', (event) => {
    event.preventDefault();
    open();
  });
  opener.addEventListener('keydown', (event) => {
    if (event.key !== ' ') return;
    event.preventDefault();
    open();
  });
  dialog.addEventListener('close', () => opener.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    // Close on the Close button and on any link (in-page anchors must not leave the menu open).
    if (target.closest('[data-menu-close], a[href]')) dialog.close();
  });
}

/** html.is-past-hero: the page's opening (the <Hero>, or an element marked data-hero; on a page
    with neither, its <h1>, because there the first block can be most of the page) is no longer
    on screen. One observer; no scroll listener. */
function chrome() {
  const first = document.querySelector('[data-hero]') ?? document.querySelector('main h1') ?? document.querySelector('main > :first-child');
  if (!first || !('IntersectionObserver' in window)) return;
  // The top 7.5rem belongs to the fixed controls: a block that has gone under them has gone.
  new IntersectionObserver(([entry]) => document.documentElement.classList.toggle('is-past-hero', !entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: '-120px 0px 0px 0px' }).observe(first);
}

function tabs() {
  document.querySelectorAll<HTMLElement>('[data-tabs]').forEach((root, n) => {
    const list = root.querySelector<HTMLElement>('[data-tab-list]');
    const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-tab-panel]')).filter((p) => p.closest('[data-tabs]') === root);
    if (!list || panels.length < 2) return;

    const marker = document.createElement('span');
    marker.className = 'tabs__marker';
    marker.setAttribute('aria-hidden', 'true');
    const buttons = panels.map((panel, i) => {
      if (!panel.id) panel.id = `tabs-${n}-panel-${i}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tabs__tab';
      button.id = `${panel.id}-tab`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      button.textContent = panel.dataset.tabLabel ?? `Tab ${i + 1}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      // A panel with nothing focusable in it takes focus itself, so Tab from the tabs reaches it.
      if (!panel.querySelector('a[href], button, input, select, textarea, [tabindex]')) panel.tabIndex = 0;
      list.append(button);
      return button;
    });
    list.append(marker);

    let current = -1;
    const place = () => {
      const button = buttons[current];
      if (!button) return;
      marker.style.transform = `translate3d(${button.offsetLeft}px, 0, 0) scaleX(${button.offsetWidth / 100})`;
    };
    const select = (index: number, how: 'pointer' | 'keyboard' | 'init') => {
      if (index === current) return;
      current = index;
      buttons.forEach((button, i) => {
        const on = i === index;
        button.setAttribute('aria-selected', String(on));
        button.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
      });
      // Keyboard changes are instant (they repeat fast); a pointer change slides the marker
      // and lets the new panel settle in.
      marker.style.transitionDuration = how === 'pointer' ? '' : '0ms';
      place();
      if (how === 'pointer' && !reduced.matches) {
        panels[index].animate(
          [
            { opacity: 0, transform: 'translate3d(0, 10px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
      }
    };

    buttons.forEach((button, i) => {
      button.addEventListener('click', () => select(i, 'pointer'));
      button.addEventListener('keydown', (event) => {
        const move = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[event.key];
        if (move === undefined) return;
        event.preventDefault();
        const next = (move + buttons.length) % buttons.length;
        select(next, 'keyboard');
        buttons[next].focus();
      });
    });

    root.classList.add('is-enhanced');
    list.hidden = false;
    const fromHash = panels.findIndex((p) => `#${p.id}` === window.location.hash);
    select(fromHash >= 0 ? fromHash : 0, 'init');
    if ('ResizeObserver' in window) new ResizeObserver(place).observe(list);
    // Web fonts change the tab widths once they land.
    document.fonts?.ready.then(place);
  });
}

function scrollers() {
  document.querySelectorAll<HTMLElement>('[data-scroller]').forEach((root) => {
    const track = root.querySelector<HTMLElement>('[data-scroller-track]');
    const prev = root.querySelector<HTMLButtonElement>('[data-scroller-prev]');
    const next = root.querySelector<HTMLButtonElement>('[data-scroller-next]');
    const controls = root.querySelector<HTMLElement>('[data-scroller-controls]');
    if (!track || !prev || !next || !controls) return;
    const step = () => {
      const first = track.firstElementChild as HTMLElement | null;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return first ? first.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    };
    // At either end the button says it is unavailable (aria-disabled) but stays focusable: a real
    // `disabled` would drop the keyboard user's focus to the page.
    const off = (button: HTMLButtonElement) => button.getAttribute('aria-disabled') === 'true';
    const go = (dir: 1 | -1) => track.scrollBy({ left: dir * step(), behavior: reduced.matches ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => off(prev) || go(-1));
    next.addEventListener('click', () => off(next) || go(1));
    let queued = false;
    const sync = () => {
      queued = false;
      const max = track.scrollWidth - track.clientWidth;
      prev.setAttribute('aria-disabled', String(track.scrollLeft <= 2));
      next.setAttribute('aria-disabled', String(track.scrollLeft >= max - 2));
      controls.hidden = max <= 2; // everything fits: no controls
    };
    track.addEventListener(
      'scroll',
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(sync);
      },
      { passive: true },
    );
    window.addEventListener('resize', sync, { passive: true });
    sync();
  });
}

/** While an enquiry form ([data-dock-away]) is on screen, its own send button is the one solid gold
    thing: the phone dock steps away and the header's Enquire goes back to its outline
    (html.is-at-form). */
function dock() {
  const el = document.querySelector<HTMLElement>('[data-dock]');
  const forms = document.querySelectorAll<HTMLElement>('[data-dock-away]');
  if (!forms.length || !('IntersectionObserver' in window)) return;
  const seen = new Set<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? seen.add(entry.target) : seen.delete(entry.target)));
      el?.classList.toggle('is-away', seen.size > 0);
      document.documentElement.classList.toggle('is-at-form', seen.size > 0);
    },
    { threshold: 0 }, // any part of the form on screen counts: Send must never share a screen with a solid Enquire
  );
  forms.forEach((form) => io.observe(form));
}

chrome();
menu();
tabs();
scrollers();
dock();
