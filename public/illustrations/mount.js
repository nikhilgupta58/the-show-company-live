// Lazy-mounts every `.hl-fig[data-figure]` (see src/components/illustrations/Hairline.astro).
// Under prefers-reduced-motion nothing is fetched; any failure leaves the static <img>.
// Once a live figure is >=35% in view its strokes draw on once (pathLength=1 dash 1 -> 0, ~700ms each,
// staggered from the centre, whole reveal <= 1.5s), then the inline dash styles are stripped so the kernel is unaffected.
const figs = [...document.querySelectorAll(".hl-fig[data-figure]")].filter((el) => !el.dataset.hlSeen);
const EASE = "cubic-bezier(.32,.72,0,1)", DUR = 700, SPREAD = 800;

// Hide strokes now (while still off screen); return the function that plays the reveal.
function prepare(svg) {
  const items = [];
  for (const el of svg.querySelectorAll("path,polygon,ellipse,line")) {
    const cs = getComputedStyle(el);
    const b = el.getBBox();
    // dashed, stroke-less (dots) or empty shapes only fade; the rest draw on
    const draw = cs.stroke !== "none" && cs.strokeDasharray === "none" && (el.localName !== "path" || el.getAttribute("d"));
    items.push({ el, draw, x: b.x + b.width / 2, y: b.y + b.height / 2 });
    if (draw) {
      el.setAttribute("pathLength", "1");
      // "1 2": at offset 1 the whole path sits in the gap, so a round cap leaves no dot
      el.style.strokeDasharray = "1 2";
      el.style.strokeDashoffset = "1";
    }
    el.style.opacity = "0";
  }
  const cx = items.reduce((s, i) => s + i.x, 0) / (items.length || 1), cy = items.reduce((s, i) => s + i.y, 0) / (items.length || 1);
  const dist = (i) => Math.hypot(i.x - cx, i.y - cy), max = Math.max(1, ...items.map(dist));
  return () => {
    svg.getBoundingClientRect(); // commit the hidden state so the transitions start from it
    for (const i of items) {
      const d = Math.round((dist(i) / max) * SPREAD);
      i.el.style.transition = `stroke-dashoffset ${DUR}ms ${EASE} ${d}ms, opacity 160ms linear ${d}ms`;
      i.el.style.strokeDashoffset = "0";
      i.el.style.opacity = "1";
    }
    setTimeout(() => {
      for (const i of items) {
        i.el.removeAttribute("pathLength");
        for (const p of ["stroke-dasharray", "stroke-dashoffset", "opacity", "transition"]) i.el.style.removeProperty(p);
      }
    }, DUR + SPREAD + 120);
  };
}

if (figs.length && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const play = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { play.unobserve(e.target); e.target.hlPlay?.(); }
  }, { threshold: 0.35 });
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      near.unobserve(e.target);
      const el = e.target;
      import(new URL("./embed.js", import.meta.url).href)
        .then(({ mountFigure }) => mountFigure(el, el.dataset.figure))
        .then(() => {
          const svg = el.querySelector("[data-hairline] > svg");
          if (!svg) throw 0;
          el.hlPlay = prepare(svg);
          play.observe(el);
        })
        .catch(() => { delete el.dataset.hlJs; });
    }
  }, { rootMargin: "300px 0px" });
  for (const el of figs) { el.dataset.hlSeen = "1"; el.dataset.hlJs = "1"; near.observe(el); }
}
