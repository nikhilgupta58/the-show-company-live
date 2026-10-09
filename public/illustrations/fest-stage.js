/**
 * Fest stage: a college-fest stage (a deck, a lighting truss with cans hung
 * from it, a speaker stack each side) faces a crowd of 35. The pointer is
 * projected onto the plane of the heads, and every arm takes its height from
 * its distance to it, on its own spring. At rest the front rows by the stage
 * are already up. Arms above half height take the bright stroke.
 * Ambient: the raised arms sway to the music, a skew about the shoulders that
 * is zero at phase 0, so the first frame is the rest pose. The slider is the
 * radius, in crowd spacings.
 */
const {
  Cam, facing, fit, prism, proj, rings, unproj, spring, stepS, poly, open, seg, r2,
  mk, place, pointer, put, register, disposer, solid, reducedMotion,
} = HL;

const COL = 16, ROW = 15, NC = 7, NR = 5, HEAD = 2.8, HZ = 8, SH = 2.6, HMAX = 26, SHOW = 6;
const PERIOD = 3200, SWAY = 7; // ms for one sway left and back, degrees of skew at its widest

/** The share of full height at u radii from the pointer: a bell from 1, down to .2 at the radius, held at a floor of .08. */
const falloff = (u) => Math.max(0.08, Math.exp(-1.6 * u * u));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.75);
  fit(C, [[-2, -4, -5], [132, 120, -5], [132, -4, -5], [-2, 120, -5], [19, 2, 66], [111, 8, 66]], 200, 166);
  const P = proj(C), front = facing(C);
  let R = value * COL, over = null;

  const g = mk("g", {}, svg);
  const block = (x0, y0, x1, y1, r, b, z0, z1) => {
    const [ring, inner] = rings(x0, y0, x1, y1, r, b);
    put(solid(g), prism(P, front, ring, inner, z0, z1));
  };
  const mark = (pts, closed) => mk("path", { d: closed ? poly(pts) : open(pts), class: "nf lo" }, g);
  // A cone on a cabinet's front face, which faces the crowd (+y): a circle standing in x and z.
  const cone = (cx, y, cz, r) =>
    mark(Array.from({ length: 24 }, (_, k) => P(cx + r * Math.cos((k * Math.PI) / 12), y, cz + r * Math.sin((k * Math.PI) / 12))), true);
  const stack = (x0) => {
    block(x0, 13, x0 + 14, 27, 1.6, 0.9, 0, 13);
    cone(x0 + 7, 27, 6.5, 4.6); cone(x0 + 7, 27, 6.5, 1.5);
    block(x0 + 0.8, 13.8, x0 + 13.2, 26.2, 1.6, 0.9, 13, 24);
    cone(x0 + 3.9, 26.2, 18.5, 2.3); cone(x0 + 10.1, 26.2, 18.5, 2.3);
  };
  // A truss: a box section with a zigzag of bracing on the face toward the crowd.
  const tower = (x0) => {
    block(x0, 2, x0 + 6, 8, 1.2, 0.7, 12, 60);
    mark(Array.from({ length: 11 }, (_, k) => P(x0 + (k % 2 ? 5 : 1), 8, 13 + k * 4.6)));
  };

  // Back to front: the ground, the far stack, the deck, the truss on it, the near stack, then the crowd.
  block(-2, -4, 132, 120, 9, 2.2, -5, 0);
  stack(4);
  block(22, 0, 108, 30, 3, 1.4, 0, 12);
  tower(21); tower(103);
  for (const x of [46, 65, 84]) block(x - 3, 2, x + 3, 8, 3, 0.8, 52, 60);
  block(19, 2, 111, 8, 1.2, 0.7, 60, 66);
  mark(Array.from({ length: 23 }, (_, k) => P(21 + k * 4, 8, k % 2 ? 65 : 61)));
  stack(112);

  // The crowd: staggered rows, a little loose. At rest a dune of arms: high at the
  // front by the middle of the stage, a smaller rise further back on the left.
  const ppl = [];
  for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
    const n = j * NC + i;
    const x = 12 + i * COL + (j % 2) * (COL / 2) + 1.8 * Math.sin(n * 2.3), y = 46 + j * ROW + 1.8 * Math.sin(n * 1.7 + 1);
    const h0 = HMAX * (0.06 + 0.9 * Math.exp(-(((x - 62) / 30) ** 2 + ((y - 46) / 17) ** 2)) + 0.4 * Math.exp(-(((x - 24) / 16) ** 2 + ((y - 94) / 13) ** 2)));
    ppl.push({ i, j, x, y, h0, sp: spring(h0, { eps: 0.04 }), drawn: NaN, k: 0 });
  }
  ppl.sort((a, b) => a.x + a.y - (b.x + b.y));
  // Each person, seen from above: shoulders, the arms from their ends, the head, then the hands over it.
  for (const p of ppl) {
    block(p.x - 5.6, p.y - 2.8, p.x + 5.6, p.y + 2.8, 2.8, 0.8, 0, SH);
    p.arms = mk("g", {}, g);
    p.armP = mk("path", { class: "nf" }, p.arms);
    block(p.x - HEAD, p.y - HEAD, p.x + HEAD, p.y + HEAD, HEAD, 0.7, SH, HZ);
    p.hands = mk("g", {}, g);
    p.hd = [0, 1].map(() => mk("circle", { r: 1.8, class: "dot m" }, p.hands));
    p.y0 = r2(P(p.x, p.y, SH)[1]);
    p.f = 0.75 + 0.25 * Math.cos(p.x * 0.05 + p.y * 0.03);
  }

  // A person whose spring hasn't moved keeps its paths.
  function drawP(p) {
    const h = p.sp.x;
    if (h === p.drawn) return;
    p.drawn = h;
    const up = h > SHOW, w = 5.4 + (6 * h) / HMAX;
    const ends = [-1, 1].map((s) => [P(p.x + s * 4.8, p.y, SH), P(p.x + s * w, p.y, SH + h)]);
    p.armP.setAttribute("d", up ? ends.map(([a, b]) => seg(a, b)).join("") : "");
    p.armP.classList.toggle("hi", h > HMAX / 2);
    p.hd.forEach((c, k) => {
      place(c, ends[k][1]);
      c.setAttribute("r", up ? 1.8 : 0);
      c.classList.toggle("m", h <= HMAX / 2);
    });
  }
  // The sway: one skew per person about their shoulder line, in unison, a little more or less each.
  function sway(a) {
    for (const p of ppl) {
      const k = r2(a * p.f);
      if (k === p.k) continue;
      p.k = k;
      const tr = k ? `translate(0 ${p.y0}) skewX(${k}) translate(0 ${-p.y0})` : "";
      p.arms.setAttribute("transform", tr);
      p.hands.setAttribute("transform", tr);
    }
  }
  for (const p of ppl) drawP(p);
  read.textContent = "rest";

  let t0 = null;
  const B = register(stage, (dt, now) => {
    let m = false;
    for (const p of ppl) { if (stepS(p.sp, dt)) m = true; drawP(p); }
    if (t0 === null) t0 = now;
    const still = reducedMotion();
    sway(still ? 0 : SWAY * Math.sin(((now - t0) / PERIOD) * 2 * Math.PI));
    return m || !still;
  });
  bag.add(B.unregister);

  function retarget() {
    let near = null, best = COL * 0.8;
    if (over) for (const p of ppl) {
      const d = Math.hypot(p.x - over[0], p.y - over[1]);
      if (d < best) { best = d; near = p; }
    }
    for (const p of ppl) p.sp.t = near ? HMAX * falloff(Math.hypot(p.x - over[0], p.y - over[1]) / R) : p.h0;
    read.textContent = near ? `row ${near.j + 1}·${near.i + 1}` : "rest";
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (pt) => { over = unproj(C, pt[0], pt[1], HZ); retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { R = v * COL; if (over) retarget(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "fest-stage",
  means: "A fest crowd faces the stage; hands go up where the pointer is, falling off with distance, and sway to the music.",
  rules: [1, 3, 5, 6],
  range: [1.6, 2.8, 4],
  mount,
});
