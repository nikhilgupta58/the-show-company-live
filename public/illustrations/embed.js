/**
 * embed.js: puts a live hairline figure over the static <img> already in a
 * box, without the bench (no slider, title or means line).
 *
 *   import { mountFigure } from "/illustrations/embed.js";
 *   const stop = await mountFigure(document.querySelector('[data-figure="call-line"]'), "call-line");
 *   stop();   // back to the static <img>
 *
 * - Nothing is fetched until mountFigure is called; kernel.js loads once, <slug>.js on first use.
 * - The <img> keeps its box (it is only hidden), and the live svg sits exactly over it, so nothing shifts.
 * - prefers-reduced-motion: reduce keeps the <img>; turning it on later goes back to the <img>.
 * - The kernel sleeps the frame loop while the figure is off screen and when it has settled.
 * - The figure is not focusable (no focus trap) and has touch-action: pan-y, so pages still scroll over it.
 * - Its accessible name is the <img>'s alt (the site's i18n); the figure's corner read-out is not shown.
 * - Theming: strokes follow the box's `color`; plates fill with --hairline-plate (default #fff), as in <slug>.svg.
 * - If the kernel or the figure fails to load, the <img> simply stays.
 */
const base = new URL(".", import.meta.url);
const figures = new Map();
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let kernel = null;

/** kernel.js is a classic script that defines the global HL; each figure file calls the global hairline({ … }), which is caught here instead of building a bench. */
function load(slug) {
  kernel ??= new Promise((ok, fail) => {
    globalThis.hairline = (fig) => { figures.set(fig.name, fig); };
    const s = document.createElement("script");
    s.src = new URL("kernel.js", base).href;
    s.onload = () => { HL.inject(document); ok(); };
    s.onerror = () => { kernel = null; fail(new Error("embed: kernel.js did not load")); };
    document.head.append(s);
  });
  return kernel.then(() => (figures.has(slug) ? null : import(new URL(`${slug}.js`, base).href))).then(() => figures.get(slug));
}

export async function mountFigure(el, slug) {
  const img = el.querySelector("img");
  let live = null, turn = 0;

  async function up() {
    const mine = ++turn;
    const fig = await load(slug).catch(() => null);
    if (!fig || mine !== turn || live || reduce.matches) return;
    const stage = document.createElement("div");
    stage.dataset.hairline = slug;
    stage.setAttribute("role", "img");
    if (img?.alt) stage.setAttribute("aria-label", img.alt);
    // strokes take currentColor in the same four weights as the static <slug>.svg, so the swap does not change colour
    const mix = (p) => `color-mix(in srgb,currentColor ${p}%,transparent)`;
    stage.style.cssText = `position:absolute;aspect-ratio:auto;margin:0;--hairline-hi:currentColor;--hairline-edge:${mix(75)};--hairline-mid:${mix(55)};--hairline-lo:${mix(35)}`;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    // sit exactly on the <img>'s box, and follow it when it resizes
    const fitBox = () => {
      const r = img ? [img.offsetLeft, img.offsetTop, img.offsetWidth, img.offsetHeight] : [0, 0, el.clientWidth, el.clientHeight];
      Object.assign(stage.style, { left: r[0] + "px", top: r[1] + "px", width: r[2] + "px", height: r[3] + "px" });
    };
    fitBox();
    const ro = new ResizeObserver(fitBox);
    ro.observe(img ?? el);
    const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
    el.append(stage);
    const handle = fig.mount({ stage, svg, read: { textContent: "" } }, fig.range[1]);
    if (img) img.style.visibility = "hidden";   // the figure drew its rest pose synchronously, so this is the same frame
    live = { stage, handle, ro };
  }

  function down() {
    turn++;
    if (!live) return;
    live.ro.disconnect();
    live.handle.destroy();
    live.stage.remove();
    live = null;
    if (img) img.style.visibility = "";
  }

  const onMotion = () => (reduce.matches ? down() : up());
  reduce.addEventListener("change", onMotion);
  if (!reduce.matches) await up();
  return () => { reduce.removeEventListener("change", onMotion); down(); };
}
