/* The Show Company — shared motion + UI script (no dependencies).
   Head sets <html class="js"> always and "motion" unless prefers-reduced-motion.
   Everything here is progressive: without it, content is fully visible. */
(function () {
  var root = document.documentElement;
  var motion = root.classList.contains('motion');
  var fine = window.matchMedia('(pointer: fine)').matches;

  // Split-text: wrap each word of [data-split] in .w > span (text stays in DOM for SEO/AT).
  document.querySelectorAll('[data-split]').forEach(function (el) {
    if (!motion) return;
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement('span'); w.className = 'w';
            var s = document.createElement('span'); s.textContent = part; s.style.setProperty('--i', i++);
            w.appendChild(s); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    })(el);
  });

  // Reveal on scroll. Hero items ([data-hero]) reveal immediately on load.
  var targets = document.querySelectorAll('[data-reveal],[data-split]');
  if (motion && 'IntersectionObserver' in window) {
    // Chromium's IntersectionObserver applies the target's OWN clip-path, so a
    // [data-reveal="clip"] element hidden with clip-path: inset(100% ...) has a zero
    // intersection rect and never fires. Watch its (unclipped) parent instead.
    var groups = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        groups.get(e.target).forEach(function (t) { t.classList.add('is-in'); });
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    targets.forEach(function (el) {
      if (el.hasAttribute('data-hero')) return;
      var watch = el.getAttribute('data-reveal') === 'clip' ? el.parentElement : el;
      if (!groups.has(watch)) { groups.set(watch, []); io.observe(watch); }
      groups.get(watch).push(el);
    });
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      document.querySelectorAll('[data-hero]').forEach(function (el) { el.classList.add('is-in'); });
    }); });
  } else {
    targets.forEach(function (el) { el.classList.add('is-in'); });
  }

  // Count-up: HTML holds the final value (no-JS safe); we animate from 0 when visible.
  var counters = document.querySelectorAll('[data-count]');
  if (motion && counters.length && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        var el = e.target, end = parseFloat(el.getAttribute('data-count')), suffix = el.getAttribute('data-suffix') || '';
        var t0 = performance.now(), dur = 1600;
        (function tick(t) {
          var p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 4);
          el.textContent = Math.round(end * eased) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (c) { c.textContent = '0' + (c.getAttribute('data-suffix') || ''); cio.observe(c); });
  }

  // Magnetic buttons + card spotlight (fine pointers only).
  if (motion && fine) {
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      el.style.transition = 'transform .35s cubic-bezier(.2,.8,.2,1), background-color .3s, color .3s, border-color .3s';
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.25, y = (e.clientY - r.top - r.height / 2) * 0.35;
        el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }
  if (fine) {
    document.querySelectorAll('.card').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  // Pinned horizontal showcase: vertical scroll drives the track sideways (>=768px, motion on).
  var mq = window.matchMedia('(min-width: 768px)');
  document.querySelectorAll('[data-hs]').forEach(function (sec) {
    var track = sec.querySelector('.hs-track');
    var bar = sec.querySelector('[data-hs-progress]');
    if (!track) return;
    var dist = 0, ticking = false;
    function measure() {
      var on = motion && mq.matches;
      sec.classList.toggle('is-pinned', on);
      if (!on) { sec.style.height = ''; track.style.transform = ''; return; }
      dist = Math.max(0, track.scrollWidth - window.innerWidth);
      sec.style.height = (window.innerHeight + dist) + 'px';
      update();
    }
    function update() {
      ticking = false;
      if (!sec.classList.contains('is-pinned')) return;
      var r = sec.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, -r.top / Math.max(1, dist)));
      track.style.transform = 'translate3d(' + (-p * dist) + 'px,0,0)';
      if (bar) bar.style.transform = 'scaleX(' + p + ')';
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    measure();
  });

  // Mobile menu (native <dialog>): close when a link inside is followed.
  var menu = document.getElementById('site-menu');
  if (menu) {
    document.querySelectorAll('[data-menu-open]').forEach(function (b) {
      b.addEventListener('click', function () { menu.showModal(); b.setAttribute('aria-expanded', 'true'); });
    });
    menu.addEventListener('close', function () {
      document.querySelectorAll('[data-menu-open]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    });
    menu.querySelectorAll('a,[data-menu-close]').forEach(function (a) { a.addEventListener('click', function () { menu.close(); }); });
  }
})();
