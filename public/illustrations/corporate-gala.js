/**
 * Corporate gala: a ballroom stage with an LED wall and a lectern, facing six
 * round banquet tables seated cabaret style, the side to the stage left open.
 * The table under the pointer rises to its feet, and the ovation spreads to
 * every guest within reach of it, nearest first, on the 700ms lift curve.
 * Meanwhile the LED wall runs its deck: a slide holds, then a wipe crosses the
 * panel and each bar eases to the next slide's height as the wipe passes it.
 * The slider is the reach, in world units from the chosen table.
 *
 * The pattern: discrete items (tables), a stagger by distance, and a hit test
 * on the fixed plane of the table tops, which never move.
 */
const {
  Cam, EASE_LIFT, circ, clamp, facing, fit, hull, lerp, open, poly, prism, proj, rad, reducedMotion, ringAt, rings, rrect, run, unproj,
  tdone, tset, tval, tween, disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

const TR = 10, TF = 11, TH = 7.5, GR = 15.5, PUSH = 1.4, BR = 2.7, HR = 1.6, STEP = 1.2; // STEP: ms per world unit, ~45ms a table
const TABLES = [[52, 24], [52, 62], [52, 100], [92, 43], [92, 81], [92, 119]];
const SEATS = [-110, -55, 0, 55, 110]; // degrees from +x: the stage side of each table stays open
const SX = 5.05, BARS = [86, 70, 54, 38], BZ = 13, BW = 4; // bar centres along the wall, base height, half width
// The deck: slide 0 is the rest pose. Each slide holds HOLD ms, then a wipe runs U0 -> U1 (left to right) for WIPE ms.
const SLIDES = [[10, 14, 19, 24], [20, 25, 12, 16], [15, 8, 25, 9]], HOLD = 600, WIPE = 3600, U0 = 103, U1 = 25;
const wipeAt = (p) => (1 - Math.cos(Math.PI * p)) / 2; // the wipe's ease in and out, 0..1
const HITS = BARS.map((y) => HOLD + (Math.acos(1 - 2 * (U0 - y) / (U0 - U1)) / Math.PI) * WIPE); // when the wipe crosses each bar

/** A ring moved to (cx, cy). */
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));

/** Guest k of table j: where it sits, how tall seated and standing (people differ a little). */
function guest(j, k) {
  const [cx, cy] = TABLES[j], a = rad(SEATS[k]), i = j * 5 + k;
  return { j, cx, cy, ca: Math.cos(a), sa: Math.sin(a), x: cx + GR * Math.cos(a), y: cy + GR * Math.sin(a),
    seat: 9 + 0.8 * Math.sin(i * 2.7), stand: 14.6 + 0.7 * Math.sin(i * 1.9 + 1), t: tween(0), v: -1 };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value, act = -1, t0 = null;

  const guests = [];
  TABLES.forEach((_, j) => SEATS.forEach((__, k) => guests.push(guest(j, k))));

  // Fitted to the room with every guest on their feet and the wall at full height.
  const C = Cam(45, 0.5, 2.02);
  const ext = [[0, 0, 0], [26, 0, 0], [0, 128, 0], [26, 128, 0], [2, 20, 46], [2, 108, 46], [5, 108, 46]];
  guests.forEach((g) => { const x = g.cx + (GR + PUSH + BR) * g.ca, y = g.cy + (GR + PUSH + BR) * g.sa; ext.push([x, y, 0], [x, y, 20]); });
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // The stage, painted first: everything on it has x < 32, every table and guest x > 32, so it is always behind them.
  const block = (x0, y0, x1, y1, r, b, z0, z1) => { const [ring, inner] = rings(x0, y0, x1, y1, r, b); const s = solid(g); put(s, prism(P, front, ring, inner, z0, z1)); return s; };
  block(0, 0, 26, 128, 3, 1.6, 0, 7);
  const wall = block(2, 20, 5, 108, 1.4, 0.6, 7, 46);
  const onWall = (ring) => poly(ring.map((q) => P(SX, q.u, q.v)));
  mk("path", { d: onWall(rrect(25, 10.5, 103, 42.5, 1.8, 4)), class: "nf lo" }, g);
  const bars = BARS.map(() => ({ el: mk("path", { class: "nf lo" }, g), h: -1 }));
  const sweep = { el: mk("path", { class: "nf lo" }, g), u: null }; // the wipe line, painted before the lectern hides its foot
  const lf = rrect(15, 90, 19, 95, 1, 3), lt = rrect(13.6, 88.6, 20.4, 96.4, 1.2, 3), li = rrect(14.4, 89.4, 19.6, 95.6, 0.6, 3);
  const slant = (ring) => ring.map((q) => P(q.u, q.v, 19 - 0.45 * (q.u - 17))); // its desk tips toward the room
  put(solid(g), { sil: poly(hull(ringAt(P, lf, 7).concat(slant(lt)))), crease: open(slant(run(li, front))) });
  block(26, 56, 31, 72, 1.5, 0.8, 0, 3.5);

  // Tables and guests, back to front by x + y. A table's cloth flares a little to the floor.
  const items = TABLES.map(([cx, cy], j) => ({ key: cx + cy, j }))
    .concat(guests.map((gu) => ({ key: gu.x + gu.y, gu })))
    .sort((a, b) => a.key - b.key);
  const tables = [];
  for (const it of items) {
    if (it.gu) {
      const s = solid(g);
      it.gu.body = s;
      it.gu.head = mk("path", { class: "sil" }, s.g);
      continue;
    }
    const [cx, cy] = TABLES[it.j], s = solid(g);
    put(s, {
      sil: poly(hull(ringAt(P, at(circ(TF, 32), cx, cy), 0).concat(ringAt(P, at(circ(TR, 32), cx, cy), TH)))),
      crease: open(ringAt(P, run(at(circ(TR - 1.2, 32), cx, cy), front), TH)),
    });
    const dot = flatDot(s.g, C, 1.6, "dot off");
    place(dot, P(cx, cy, TH));
    tables[it.j] = { s, dot };
  }

  /** A guest half-way (v) between seated and standing: a body with rounded shoulders, and a head. */
  function drawGuest(gu, v) {
    gu.v = v;
    const r = GR + PUSH * v, x = gu.cx + r * gu.ca, y = gu.cy + r * gu.sa, hb = lerp(gu.seat, gu.stand, v), hc = hb + HR + 1.1;
    put(gu.body, {
      sil: poly(hull([[circ(BR, 16), 0], [circ(BR, 16), hb - 1.1], [circ(BR - 0.7, 16), hb]].flatMap(([ring, z]) => ringAt(P, at(ring, x, y), z)))),
      crease: open(ringAt(P, run(at(circ(BR - 1.4, 16), x, y), front), hb)),
    });
    gu.head.setAttribute("d", poly(hull([-70, -35, 0, 35, 70].map((d) => [Math.cos(rad(d)), Math.sin(rad(d))]).flatMap(([s, dz]) => ringAt(P, at(circ(HR * s, 24), x, y), hc + HR * dz)))));
  }

  /** The wall at t ms into the loop: at t 0 slide 0 holds and no wipe is drawn, the rest pose. */
  function chart(t) {
    const n = Math.floor(t / (HOLD + WIPE)), tau = t - n * (HOLD + WIPE);
    const from = SLIDES[n % SLIDES.length], to = SLIDES[(n + 1) % SLIDES.length];
    bars.forEach((b, i) => {
      const h = lerp(from[i], to[i], EASE_LIFT(clamp((tau - HITS[i]) / 700, 0, 1)));
      if (Math.abs(h - b.h) < 0.01) return;
      b.h = h;
      b.el.setAttribute("d", onWall(rrect(BARS[i] - BW, BZ, BARS[i] + BW, BZ + h, 1.2, 3)));
    });
    const p = (tau - HOLD) / WIPE, u = p > 0 && p < 1 ? lerp(U0, U1, wipeAt(p)) : null;
    if (u === sweep.u) return;
    sweep.u = u;
    sweep.el.setAttribute("d", u === null ? "" : open([P(SX, u, 12.3), P(SX, u, 40.7)]));
  }

  guests.forEach((gu) => drawGuest(gu, 0));
  chart(0);
  wall.sil.classList.add("hi");

  const B = register(stage, (_dt, now) => {
    const live = !reducedMotion();
    if (t0 === null) t0 = now;
    chart(live ? now - t0 : 0);
    let moving = false;
    for (const gu of guests) {
      const v = tval(gu.t, now);
      if (v !== gu.v) drawGuest(gu, v);
      if (!tdone(gu.t, now)) moving = true;
    }
    return live || moving;
  });
  bag.add(B.unregister);

  /** The table under the pointer, from the fixed plane of the table tops; -1 off every table. */
  function hit([sx, sy]) {
    const [x, y] = unproj(C, sx, sy, TH);
    let best = -1, bd = 21;
    TABLES.forEach(([cx, cy], j) => { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = j; } });
    return best;
  }

  /** Stands table a and every guest within reach of it; -1 sits them all down. Spreads out from a, or from the table let go. */
  function aim(a, from) {
    const now = performance.now(), [fx, fy] = TABLES[from];
    for (const gu of guests) {
      const d = Math.hypot(gu.x - fx, gu.y - fy);
      tset(gu.t, a >= 0 && (gu.j === a || d < reach) ? 1 : 0, now, d * STEP);
    }
    tables.forEach((t, j) => { t.s.sil.classList.toggle("hi", j === a); t.dot.setAttribute("class", j === a ? "dot" : "dot off"); });
    wall.sil.classList.toggle("hi", a < 0);
    read.textContent = a < 0 ? "rest" : "table " + (a + 1);
    B.wake();
  }

  function setActive(a) {
    if (a === act) return;
    const from = a >= 0 ? a : act;
    act = a;
    if (from >= 0) aim(a, from);
  }

  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; if (act >= 0) aim(act, act); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "corporate-gala",
  means: "A gala ballroom facing its stage: point at a table and its guests rise to their feet, the ovation spreading to tables nearby.",
  rules: [2, 3, 5, 6],
  range: [30, 55, 85],
  mount,
});
