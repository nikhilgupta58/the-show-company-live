/**
 * Brand bridge: a brand's billboard on a plinth, a raised diamond on its face, and
 * an artist's round stage with a mic stand, joined by a rope bridge of nine
 * planks. The plank under the pointer takes the weight and dips; its
 * neighbours dip less, shallower towards the anchors, staggered outwards on the
 * 700ms curve. Ambient: a lit run of the far handrail, a third of its length,
 * travels from the artist's post to the brand's and back, 10s a round trip,
 * easing at each post, the hangers under it lit with it; phase 0 rests against
 * the artist's post. It is the rest mark, and gives the bright up to the plank
 * the pointer picks.
 * The slider is the dip, in world units.
 */
const {
  Cam, bezier, fit, hull, lerp, open, poly, proj, prism, put, rings, ringAt, rrect, run, seg, solid, unproj,
  facing, tdone, tset, tval, tween, disposer, mk, place, pointer, reducedMotion, register,
} = HL;

const N = 9, PITCH = 13.5, HW = 15, TK = 2;              // planks: count, pitch, half width, thickness
const XA = -82, XB = 42, ZA = 26, ZB = 18, SAG = 10;      // the deck runs from the plinth's front (high) to the stage rim (low)
const RH = 14, PA = -86, PB = 48;                         // handrail height; the posts' x at each end
const SX = 66, SR = 26, MX = 80, MY = -4;                  // the stage's centre and radius; the mic stand
const STEP = 45, LOOP = 10000, LEN = (PB - PA) / 3;    // the lit run's length along x
const XS = Array.from({ length: N }, (_, i) => XA + 7 + i * PITCH);
const KX = [PA, ...XS, PB];
const tt = (x) => (x - XA) / (XB - XA);
const REST = XS.map((x) => { const t = tt(x); return lerp(ZA, ZB, t) - SAG * 4 * t * (1 - t); });

/** How far plank i sinks when plank a takes weight D: a string under a point load, shallower near the anchors. */
function sink(i, a, D) {
  const t = tt(XS[i]), ta = tt(XS[a]);
  return D * (t <= ta ? t / ta : (1 - t) / (1 - ta)) * (0.35 + 2.6 * ta * (1 - ta));
}

/** A small round post standing at (x, y) from z0 to z1. */
const post = (P, front, x, y, z0, z1) => prism(P, front, rrect(x - 1.5, y - 1.5, x + 1.5, y + 1.5, 1.5, 3), rrect(x - 1, y - 1, x + 1, y + 1, 1, 3), z0, z1);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let D = value;

  // fitted to the tallest parts and the deepest dip, so no pose leaves the frame
  const C = Cam(45, 0.5, 1.55);
  fit(C, [[-118, -22, 0], [-118, 22, 0], [-82, 22, 0], [-112, -21, 76], [-109, 21, 76], [SX + SR, 0, 0], [SX, SR, 0], [SX, -SR, ZB], [MX, MY, 72], [XS[4], HW, 2]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);
  const S = (paths, parent = g) => put(solid(parent), paths);

  // the brand: a plinth, and on it a billboard on two legs, its face looking down the bridge, a raised diamond on it
  S(prism(P, front, ...rings(-118, -22, -82, 22, 4, 1.6), 0, ZA));
  S(post(P, front, -110.5, -12, ZA, 50));
  S(post(P, front, -110.5, 12, ZA, 50));
  S(prism(P, front, ...rings(-112, -21, -109, 21, 1.4, 0.6), 46, 76));
  const R2 = Math.SQRT1_2, rot = (ring) => ring.map((q) => ({ u: (q.u - q.v) * R2, v: (q.u + q.v) * R2, nu: (q.nu - q.nv) * R2, nv: (q.nu + q.nv) * R2 }));
  const PM = (u, v, w) => P(-109 + w, u, 61 + v), frontM = (q) => 0.612 * q.nu + 0.5 * q.nv > 0;
  S(prism(PM, frontM, rot(rrect(-8, -8, 8, 8, 2.5, 4)), rot(rrect(-6.8, -6.8, 6.8, 6.8, 1.3, 4)), 0, 2.5));

  // far side: post, handrail and hangers, painted before the planks they hang from
  S(post(P, front, PA, -HW, ZA, ZA + RH + 1.5));
  const farRope = mk("path", { class: "nf" }, g), lit = mk("path", { class: "nf hi" }, g), farHang = XS.map(() => mk("path", { class: "nf lo" }, g));

  const planks = XS.map((x) => {
    const [ring, inner] = rings(x - 5, -HW, x + 5, HW, 2, 1);
    return { ring, inner, el: solid(g), tw: tween(0) };
  });

  // the artist: a round stage, its far post, then everything in front of the deck
  const stg = rrect(SX - SR, -SR, SX + SR, SR, SR, 14), stgIn = rrect(SX - SR + 1.6, -SR + 1.6, SX + SR - 1.6, SR - 1.6, SR - 1.6, 14);
  S(prism(P, front, stg, stgIn, 0, ZB));
  S(post(P, front, PB, -HW, ZB, ZB + RH + 1.5));
  const nearHang = mk("path", { class: "nf lo" }, g), nearRope = mk("path", { class: "nf" }, g);
  S(post(P, front, PA, HW, ZA, ZA + RH + 1.5));
  S(post(P, front, PB, HW, ZB, ZB + RH + 1.5));

  // the mic stand: a round base, a pole, a body that widens to the head, and a ball head with its equator
  const ring = (r, n = 4) => rrect(MX - r, MY - r, MX + r, MY + r, r, n);
  S(prism(P, front, ring(7, 6), ring(6, 6), ZB, ZB + 1.6));
  S(prism(P, front, ring(1.2, 3), ring(0.8, 3), ZB + 1.6, 54));
  S({ sil: poly(hull(ringAt(P, ring(1.5), 54).concat(ringAt(P, ring(2.7), 61)))), crease: open(ringAt(P, run(ring(2.1), front), 61)) });
  const head = mk("ellipse", { rx: 5.5 * 1.55, ry: 5.5 * 1.55, class: "sil" }, g);
  place(head, P(MX, MY, 66.5));
  mk("path", { d: open(ringAt(P, run(ring(5.5, 8), front), 66.5)), class: "nf lo" }, g);

  /** The handrail's height above x, for the deck heights z. */
  function railZ(x, z) {
    const kz = [ZA, ...z, ZB];
    let k = 1;
    while (k < KX.length - 1 && KX[k] < x) k++;
    return lerp(kz[k - 1], kz[k], (x - KX[k - 1]) / (KX[k] - KX[k - 1])) + RH;
  }

  let last = null;
  function draw(z) {
    planks.forEach((p, i) => { if (!last || last[i] !== z[i]) put(p.el, prism(P, front, p.ring, p.inner, z[i] - TK, z[i])); });
    const rail = (y) => open(KX.map((x) => P(x, y, railZ(x, z))));
    const hang = (y, i) => seg(P(XS[i], y, z[i]), P(XS[i], y, z[i] + RH));
    farRope.setAttribute("d", rail(-HW)); farHang.forEach((h, i) => h.setAttribute("d", hang(-HW, i)));
    nearRope.setAttribute("d", rail(HW)); nearHang.setAttribute("d", XS.map((_, i) => hang(HW, i)).join(""));
    last = z;
  }

  // the lit run: phase 0 rests against the artist's post; it runs to the brand's and back, easing at each post.
  // The hangers under it light with it, at rest only; the stroke's own 260ms fade turns them in and out.
  const T0 = performance.now(), ease = bezier(0.3, 0, 0.7, 1);
  let litD = "", act = -1;
  function shuttle(now, z) {
    const ph = reducedMotion() ? 0 : ((now - T0) % LOOP) / LOOP;
    const x1 = PB - ease(1 - Math.abs(1 - 2 * ph)) * (PB - PA - LEN), x0 = x1 - LEN;
    const d = open([x0, ...KX.filter((x) => x > x0 && x < x1), x1].map((x) => P(x, -HW, railZ(x, z))));
    if (d !== litD) lit.setAttribute("d", (litD = d));
    farHang.forEach((h, i) => { const on = act < 0 && XS[i] > x0 && XS[i] < x1; h.classList.toggle("lo", !on); h.classList.toggle("hi", on); });
  }

  draw(REST);
  shuttle(T0, REST);

  const B = register(stage, (_dt, now) => {
    let moving = false;
    const z = planks.map((p, i) => { if (!tdone(p.tw, now)) moving = true; return REST[i] - tval(p.tw, now); });
    if (z.some((v, i) => v !== last[i])) draw(z);
    shuttle(now, z);
    return moving || !reducedMotion();
  });
  bag.add(B.unregister);

  // hit test on each plank's RESTING top: the pointer is unprojected onto that plank's own height
  function hit([sx, sy]) {
    let best = -1, bd = Infinity;
    XS.forEach((x, i) => {
      const [wx, wy] = unproj(C, sx, sy, REST[i]);
      const dx = Math.abs(wx - x), dy = Math.abs(wy);
      if (dx <= PITCH / 2 && dy <= HW + 8 && dx < bd) { bd = dx; best = i; }
    });
    return best;
  }

  /** Puts the weight on plank a (-1 lifts it). The stagger spreads out from the plank stepped on, or the one left. */
  function setActive(a, force) {
    if (a === act && !force) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    planks.forEach((p, i) => {
      tset(p.tw, a < 0 ? 0 : sink(i, a, D), now, Math.abs(i - from) * STEP);
      p.el.sil.classList.toggle("hi", i === a);
    });
    lit.classList.toggle("hi", a < 0); lit.classList.toggle("sil", a >= 0);
    read.textContent = a < 0 ? "rest" : "plank " + (a + 1);
    B.wake();
  }

  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { D = v; if (act >= 0) setActive(act, true); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "brand-bridge",
  means: "An artist's stage and a brand's sign, joined by a rope bridge: the plank under the pointer takes the weight.",
  rules: [1, 2, 6, 7],
  range: [4, 7, 10],
  mount,
});
