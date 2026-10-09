/**
 * Booking flow: a desk calendar, the tent kind, standing open on October 2026.
 * A wire coil binds the pad along its ridge; the page carries the month's
 * header band, a dot over each weekday, and a ruled grid of seven columns with
 * a dot in the corner of each date, the three days before the 1st left blank.
 * The show nights already booked stand out of the page as blocks; the next one
 * is bright and rises and settles on a 4s loop that starts at rest. The date
 * under the pointer rises out furthest, as if being booked, and the dates round
 * it rise a little, staggered outwards from it. The read-out names the date.
 * The slider is the reach, in days.
 *
 * The pattern: one of many, on a grid, over an ambient loop. Tweens, a stagger
 * by distance, and a hit test against each date's rest box, nearest first.
 */
const {
  Cam, clamp, fit, open, poly, prism, proj, ringAt, rings, rrect, seg, unproj,
  tween, tset, tval, tdone, reducedMotion, mk, pointer, put, register, disposer, solid,
} = HL;

// October 2026: the 1st is a Thursday; weeks start on Monday, so three blank days lead.
const PITCH = 15, M = 7, W = 7 * PITCH + 2 * M, GY = 31, H = GY + 5 * PITCH + M;
const LEAD = 3, DAYS = 31, BOOKED = [10, 16, 17, 24, 31], NEXT = 10;
const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PAD = 2.6, INSET = 1.9, BOOK = 6, LIFT = 22, NB = 8, STAG = 40, RR = 4.6, LOOPS = 12;
const LEAN = 0.32, AMB = 11, PERIOD = 4000; // the page's lean back (rad); the next show's rise, and one loop in ms
const SN = Math.sin(LEAN), CS = Math.cos(LEAN), TOP = H * CS;
// Two planes meeting at the ridge: u along it, v down the plane, w out of it, toward the inside of the tent for the stand.
const page = (u, v, w) => [u, v * SN + w * CS, TOP - v * CS + w * SN];
const stand = (u, v, w) => [u, -v * SN + w * CS, TOP - v * CS - w * SN];
const cell = (k) => [M + (k % 7) * PITCH, GY + Math.floor(k / 7) * PITCH];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value;

  // Fitted to the tent with every date at the most it can stand out, so no pose leaves the frame.
  const C = Cam(45, 0.5, 1.7), OUT = Math.max(LIFT, BOOK + NB + AMB);
  const box = [page(0, 0, 0), page(0, H, 0), page(W, H, 0), stand(W, H, -1.4), [0, 0, TOP + RR], [W, 0, TOP + RR]];
  for (let k = LEAD; k < LEAD + DAYS; k++) { const [u, v] = cell(k); box.push(page(u, v, OUT), page(u, v + PITCH, OUT)); }
  fit(C, box, 200, 166);
  const P = proj(C);
  // toward the camera: how far a point moves over the ground to stay put on screen as it climbs one unit
  const a = unproj(C, 200, 160, 0), b = unproj(C, 200, 160, 1), T = [b[0] - a[0], b[1] - a[1], 1];
  const toCam = (p) => p[0] * T[0] + p[1] * T[1] + p[2] * T[2];
  /** A plane's projection, its rings' facing test, and the point [u, v] under the screen point at height w. */
  function plane(f) {
    const Pf = (u, v, w) => P(...f(u, v, w)), tv = toCam(f(0, 1, 0)) - toCam(f(0, 0, 0));
    const un = (sx, sy, w) => {
      const o = Pf(0, 0, w), pu = Pf(1, 0, w), pv = Pf(0, 1, w);
      const ux = pu[0] - o[0], uy = pu[1] - o[1], vx = pv[0] - o[0], vy = pv[1] - o[1], dx = sx - o[0], dy = sy - o[1];
      const det = ux * vy - uy * vx;
      return [(dx * vy - dy * vx) / det, (ux * dy - uy * dx) / det];
    };
    return { P: Pf, front: (s) => s.nu * T[0] + s.nv * tv > 0, un };
  }
  const F = plane(page), S = plane(stand);

  const g = mk("g", {}, svg);
  // the stand behind, then the pad of pages leaning on it
  put(solid(g), prism(S.P, S.front, ...rings(0, 0, W, H, 4, 1.2), -1.4, 0));
  put(solid(g), prism(F.P, F.front, ...rings(0, 0, W, H, 4, 1.3), -PAD, 0));
  // printed on the top page: the header band, a dot over each weekday, the ruled grid, a dot in each date's corner
  const flat = (ring, cls) => mk("path", { d: poly(ringAt(F.P, ring, 0)), class: cls }, g);
  const dot = (u, v, r, cls) => flat(rrect(u - r, v - r, u + r, v + r, r, 3), cls);
  flat(rrect(M, 10, W - M, 21, 3, 4), "nf");
  for (let c = 0; c < 7; c++) dot(M + (c + 0.5) * PITCH, 26, 1.5, "dot m");
  flat(rrect(M, GY, W - M, GY + 5 * PITCH, 2.5, 4), "nf");
  let rule = "";
  for (let c = 1; c < 7; c++) rule += seg(F.P(M + c * PITCH, GY, 0), F.P(M + c * PITCH, GY + 5 * PITCH, 0));
  for (let r = 1; r < 5; r++) rule += seg(F.P(M, GY + r * PITCH, 0), F.P(W - M, GY + r * PITCH, 0));
  mk("path", { d: rule, class: "nf lo" }, g);
  for (let k = LEAD; k < LEAD + DAYS; k++) { const [u, v] = cell(k); dot(u + 3.8, v + 3.8, 1.9, "dot"); } // full gold and larger than the weekday dots: 35%/1.1 vanished on black, 75%/1.5 was still faint at phone width
  // the binding: a punched hole, and a coil from it over the ridge, until the stand hides it
  const f0 = Math.atan2(-CS, SN), f1 = Math.PI + 0.35;
  let wire = "";
  for (let k = 0; k < LOOPS; k++) {
    const u = 9 + (k * (W - 18)) / (LOOPS - 1), arc = [];
    dot(u, RR, 1.1, "dot off");
    for (let s = 0; s <= 16; s++) { const t = f0 + ((f1 - f0) * s) / 16; arc.push(P(u, RR * Math.cos(t), TOP + RR * Math.sin(t))); }
    wire += open(arc);
  }
  mk("path", { d: wire, class: "nf sil" }, g);

  // the dates as blocks out of the page, appended far to near; a free date lies flat, undrawn
  const tiles = [];
  for (let d = 1; d <= DAYS; d++) {
    const k = d + LEAD - 1, [u, v] = cell(k), h0 = BOOKED.includes(d) ? BOOK : 0;
    const [ring, inner] = rings(u + INSET, v + INSET, u + PITCH - INSET, v + PITCH - INSET, 3, 1.1);
    tiles.push({ d, c: k % 7, r: Math.floor(k / 7), u, v, ring, inner, h0, tw: tween(h0), drawn: NaN, z: toCam(page(u + PITCH / 2, v + PITCH / 2, 0)) });
  }
  const order = tiles.slice().sort((p, q) => p.z - q.z);
  order.forEach((t) => { t.el = solid(g); });
  tiles[NEXT - 1].el.sil.classList.add("hi");

  /** The date whose REST box the pointer is over, the nearest to the camera when two are; -1 for none. */
  function hit([sx, sy]) {
    let best = -1;
    for (const t of order) {
      for (let s = 0; s <= 4; s++) {
        const [u, v] = F.un(sx, sy, (t.h0 * s) / 4);
        if (u > t.u && u < t.u + PITCH && v > t.v && v < t.v + PITCH) { best = t.d - 1; break; }
      }
    }
    return best;
  }

  // Phase 0 of the breath is the rest pose; under reduced motion it holds there. It fades out while a date is chosen.
  const t0 = performance.now(), amp = tween(1);
  const breath = (now) => (reducedMotion() ? 0 : (AMB * tval(amp, now) * (1 - Math.cos((2 * Math.PI * (now - t0)) / PERIOD))) / 2);
  /** Draws every block whose height changed; true while anything moves, which the breath does whenever no date is chosen. */
  function draw(now) {
    let moving = !reducedMotion() && (tval(amp, now) > 0 || !tdone(amp, now));
    for (const t of tiles) {
      const h = tval(t.tw, now) + (t.d === NEXT ? breath(now) : 0);
      if (!tdone(t.tw, now)) moving = true;
      if (h === t.drawn) continue;
      t.drawn = h;
      put(t.el, h < 0.05 ? { sil: "", crease: "" } : prism(F.P, F.front, t.ring, t.inner, 0, h));
    }
    return moving;
  }
  draw(t0);
  const B = register(stage, (_dt, now) => draw(now));
  bag.add(B.unregister);

  let act = -1;
  /** Retargets every date, the stagger spreading out from date `from`. */
  function apply(from) {
    const now = performance.now(), f = tiles[from];
    tset(amp, act < 0 ? 1 : 0, now, 0);
    tiles.forEach((t, i) => {
      const dist = Math.hypot(t.c - f.c, t.r - f.r);
      const near = NB * clamp(1 - dist / (reach + 1), 0, 1);
      tset(t.tw, act < 0 ? t.h0 : i === act ? LIFT : t.h0 + near, now, dist * STAG);
      t.el.sil.classList.toggle("hi", act < 0 ? t.d === NEXT : i === act);
    });
    const t = tiles[act];
    read.textContent = act < 0 ? "rest" : `${WD[t.c]} ${t.d}` + (BOOKED.includes(t.d) ? " · booked" : "");
    B.wake();
  }
  /** Picks date a (-1 lets go). */
  function setActive(a) {
    if (a === act) return;
    const from = a >= 0 ? a : act;
    act = a;
    apply(from);
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; if (act >= 0) apply(act); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "booking-flow",
  means: "A desk calendar open on the month: booked show nights stand out of the page, and the date under the pointer rises to be booked.",
  rules: [1, 2, 5, 10],
  range: [0.6, 1.2, 2],
  mount,
});
