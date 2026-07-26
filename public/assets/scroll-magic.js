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

  function heroScene() {}
  function aboutScene() {}
  function showsScene() {}
  function depthScene() {}
  function marqueeScene() {}

  // recalc pin positions once all images are in
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
