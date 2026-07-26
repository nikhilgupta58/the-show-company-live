/* Scroll-driven cinematic layer for theshowcompany.in.
   Progressive enhancement: the page must be fully usable without this file.
   Bails out when GSAP/ScrollTrigger are unavailable or the user prefers
   reduced motion — the existing IntersectionObserver reveals then apply. */
(function () {
  if (!window.gsap || !window.ScrollTrigger) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  gsap.registerPlugin(ScrollTrigger);

  var ctx = {
    isDesktop: window.matchMedia('(min-width: 768px) and (pointer: fine)').matches,
    lenis: null
  };

  // ── Lenis smooth scroll (desktop pointer devices only) ──
  if (ctx.isDesktop && window.Lenis) {
    ctx.lenis = new Lenis({ lerp: 0.09 });
    ctx.lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { ctx.lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);

    // route anchor clicks through Lenis so pinned sections resolve correctly
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var sel = a.getAttribute('href');
        if (!sel || sel.length < 2) return;
        var target = document.querySelector(sel);
        if (!target) return;
        e.preventDefault();
        ctx.lenis.scrollTo(target);
      });
    });
  }

  // ── Page scroll progress bar ──
  gsap.to('#scroll-progress', {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { start: 'top top', end: 'max', scrub: 0.3 }
  });

  // ── Scenes (filled in by later tasks) ──
  heroScene();
  aboutScene();
  showsScene();
  depthScene();
  marqueeScene();

  function heroScene() {
    var hero = document.getElementById('hero');
    if (!hero) return;

    // the hero's own reveal elements must not fight the scrub:
    // force them visible and kill their CSS transitions
    hero.querySelectorAll('.reveal-hidden').forEach(function (el) {
      el.classList.add('reveal-visible');
      el.style.transition = 'none';
    });

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: ctx.isDesktop ? '+=160%' : '+=100%',
        scrub: 0.5,
        pin: true,
        anticipatePin: 1
      }
    });

    tl.to('#hero-bg img', { scale: 1.22, ease: 'none' }, 0)
      .to('#curtain-left', { xPercent: -85, ease: 'none' }, 0)
      .to('#curtain-right', { xPercent: 85, ease: 'none' }, 0)
      .to('#hero-scroll-hint', { opacity: 0, ease: 'none' }, 0)
      .to('#hero-content', { scale: 1.1, yPercent: -22, opacity: 0, ease: 'none' }, 0.25);
  }
  function aboutScene() {
    // manifesto: each paragraph brightens as it passes through the viewport
    gsap.utils.toArray('#about-copy p').forEach(function (p) {
      gsap.fromTo(p,
        { opacity: 0.15, y: 24 },
        {
          opacity: 1, y: 0, ease: 'none',
          scrollTrigger: { trigger: p, start: 'top 90%', end: 'top 45%', scrub: 0.4 }
        });
    });

    // stat counters driven by scroll position (not time)
    gsap.utils.toArray('#about-stats .stat-num').forEach(function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      var obj = { v: 0 };
      gsap.to(obj, {
        v: target, ease: 'none',
        scrollTrigger: { trigger: '#about-stats', start: 'top 90%', end: 'top 45%', scrub: 0.5 },
        onUpdate: function () { el.textContent = Math.round(obj.v) + '+'; }
      });
    });
  }
  function showsScene() {
    // Desktop only: scroll drives the slides. Mobile keeps the autoplay carousel.
    if (!ctx.isDesktop) return;
    var section = document.getElementById('shows');
    if (!section || typeof window.switchShowSlide !== 'function') return;

    // hand control from the autoplay timer to the scrollbar
    if (window.stopShowsAutoScroll) window.stopShowsAutoScroll();
    var wrap = document.getElementById('shows-carousel-wrapper');
    if (wrap) {
      wrap.removeEventListener('mouseenter', window.stopShowsAutoScroll);
      wrap.removeEventListener('mouseleave', window.startShowsAutoScroll);
    }

    var lastIdx = -1;
    ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: '+=1600',
      pin: true,
      anticipatePin: 1,
      onUpdate: function (self) {
        var idx = Math.min(3, Math.floor(self.progress * 4));
        if (idx !== lastIdx) {
          lastIdx = idx;
          window.switchShowSlide(idx);
        }
      }
    });
  }
  function depthScene() {
    // recent-events collage: each photo drifts at its own depth.
    // Images are pre-scaled so the drift never exposes container edges.
    var depths = [-7, 9, -11, 7];
    gsap.utils.toArray('#recent-events .grid > div').forEach(function (card, i) {
      var img = card.querySelector('img');
      if (!img) return;
      gsap.set(img, { scale: 1.18 });
      gsap.to(img, {
        yPercent: depths[i % depths.length], ease: 'none',
        scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: 0.6 }
      });
    });

    // ghost typography drifts against scroll for depth
    gsap.utils.toArray('.ghost-num').forEach(function (el) {
      gsap.to(el, {
        yPercent: -30, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.8 }
      });
    });

    // team portraits unmask as they enter
    gsap.utils.toArray('#team .group img').forEach(function (img) {
      gsap.fromTo(img,
        { clipPath: 'inset(12% 12% 12% 12%)', scale: 1.12 },
        {
          clipPath: 'inset(0% 0% 0% 0%)', scale: 1, ease: 'none',
          scrollTrigger: { trigger: img, start: 'top 95%', end: 'top 55%', scrub: 0.5 }
        });
    });

    // footer wordmark rises like an end-credits title card
    var ghost = document.querySelector('.footer-ghost');
    if (ghost) {
      gsap.fromTo(ghost,
        { yPercent: 60, opacity: 0.35 },
        {
          yPercent: 0, opacity: 1, ease: 'none',
          scrollTrigger: { trigger: 'footer', start: 'top bottom', end: 'bottom bottom', scrub: 0.5 }
        });
    }
  }
  function marqueeScene() {}

  // recalc pin positions once all images are in
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
