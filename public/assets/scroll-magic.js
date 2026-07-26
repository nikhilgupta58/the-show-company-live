/* Scroll-driven cinematic layer for theshowcompany.in.
   Progressive enhancement: the page must be fully usable without this file.
   Bails out when GSAP/ScrollTrigger are unavailable or the user prefers
   reduced motion — the existing IntersectionObserver reveals then apply. */
(function () {
  if (!window.gsap || !window.ScrollTrigger) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  gsap.registerPlugin(ScrollTrigger);

  var ctx = {
    isDesktop: false,
    lenis: null
  };

  // ── Anchor click intercept (registered once; guarded at click-time by
  //    ctx.lenis so it only engages when Lenis smooth-scroll is active) ──
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    // the skip-to-content a11y link must keep native jump-and-focus behavior
    if (a.getAttribute('href') === '#main-content') return;
    a.addEventListener('click', function (e) {
      if (!ctx.lenis) return; // no smooth-scroll active (mobile / reduced motion) — let the browser handle it natively
      var sel = a.getAttribute('href');
      if (!sel || sel.length < 2) return;
      var target = document.querySelector(sel);
      if (!target) return;
      e.preventDefault();
      ctx.lenis.scrollTo(target);
      history.pushState(null, '', sel);
    });
  });

  // ── Page scroll progress bar (viewport-independent: created once) ──
  gsap.to('#scroll-progress', {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { start: 'top top', end: 'max', scrub: 0.3 }
  });

  // ── Scenes that don't depend on viewport/pointer: created once ──
  aboutScene();
  depthScene();
  marqueeScene();

  // ── Resize-adaptive scenes: rebuilt whenever the desktop/mobile media
  //    query flips, via gsap.matchMedia() ──
  var mm = gsap.matchMedia();

  mm.add('(min-width: 768px) and (pointer: fine)', function () {
    ctx.isDesktop = true;

    var tickerFn = null;
    if (window.Lenis) {
      ctx.lenis = new Lenis({ lerp: 0.09 });
      ctx.lenis.on('scroll', ScrollTrigger.update);
      tickerFn = function (time) { ctx.lenis.raf(time * 1000); };
      gsap.ticker.add(tickerFn);
      gsap.ticker.lagSmoothing(0);
    }

    heroScene();
    var showsWrap = showsScene();

    return function () {
      if (tickerFn) gsap.ticker.remove(tickerFn);
      if (ctx.lenis) {
        ctx.lenis.destroy();
        ctx.lenis = null;
      }
      // hand control back to the autoplay carousel
      if (showsWrap) {
        showsWrap.addEventListener('mouseenter', window.stopShowsAutoScroll);
        showsWrap.addEventListener('mouseleave', window.startShowsAutoScroll);
      }
      if (window.startShowsAutoScroll) window.startShowsAutoScroll();
    };
  });

  mm.add('(max-width: 767.98px), (pointer: coarse)', function () {
    ctx.isDesktop = false;

    heroScene();
    // showsScene() is a no-op here (ctx.isDesktop is false); the autoplay
    // carousel keeps driving the shows section on mobile/touch.

    return function () {
      // nothing external to GSAP's own context was created on this branch
    };
  });

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
    if (!ctx.isDesktop) return null;
    var section = document.getElementById('shows');
    if (!section || typeof window.switchShowSlide !== 'function') return null;

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

    return wrap;
  }
  function depthScene() {
    // recent-events collage: each photo drifts at its own depth.
    // Images are pre-scaled so the drift never exposes container edges.
    var depths = [-7, 9, -11, 7];
    gsap.utils.toArray('#recent-events .grid > div').forEach(function (card, i) {
      var img = card.querySelector('img');
      if (!img) return;
      gsap.set(img, { scale: 1.24 });
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
  function marqueeScene() {
    var track = document.querySelector('.marquee-track');
    if (!track || !track.getAnimations) return;
    var lanes = Array.prototype.slice.call(track.children);
    var state = { rate: 1, skew: 0 };
    var decay = null;

    function apply() {
      var anim = track.getAnimations()[0];
      if (anim) anim.playbackRate = state.rate;
      lanes.forEach(function (lane) {
        lane.style.transform = 'skewX(' + state.skew + 'deg)';
      });
    }

    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: function (self) {
        var v = self.getVelocity();
        state.rate = gsap.utils.clamp(1, 5, 1 + Math.abs(v) / 600);
        state.skew = gsap.utils.clamp(-4, 4, v / -350);
        apply();
        if (decay) decay.kill();
        decay = gsap.to(state, {
          rate: 1, skew: 0, duration: 0.9, ease: 'power2.out', onUpdate: apply
        });
      }
    });
  }

  // recalc pin positions once all images are in, then land on any hash
  // deep link *after* the pin spacers (hero ~160vh, shows 1600px) exist
  window.addEventListener('load', function () {
    ScrollTrigger.refresh();
    if (location.hash && document.querySelector(location.hash)) {
      requestAnimationFrame(function () {
        var t = document.querySelector(location.hash);
        if (t) (ctx.lenis ? ctx.lenis.scrollTo(t, { immediate: true }) : t.scrollIntoView());
      });
    }
  });
})();
