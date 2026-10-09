/**
 * Standup stage: a comedy-club stage with a brick wall behind it, a bar stool
 * and a mic on its stand, and a follow-spot on a tripod off its right corner.
 * The pointer aims the spot: the lamp swings, its pool slides across the
 * boards on a spring, and whatever stands in the pool takes the bright stroke.
 * At rest the light sits on the mic. The spot is never quite still: the
 * operator's hand sways it in a slow figure-eight round its target, from zero.
 * The slider is the iris, the pool's radius in world units.
 *
 * The pattern: a field cut down to one pool. The pointer lands on the stage's
 * top, which never moves, or on a prop's rest box; what is lit is read from
 * the springs' targets, never from where the pool is on screen.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, prism, proj, rings, rrect, seg, unproj,
  spring, stepS, reducedMotion, disposer, mk, pointer, put, register, solid,
} = HL;

const W = 96, D = 76, RISE = 10, WALL = 64, LAMP = [110, -8, 58], MIC = [58, 38], STOOL = [22, 50];
const SWAY = [2.2, 1.2], PERIOD = 6000; // the operator's hand: world units each way, and ms round the figure-eight

const sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map((v) => v * s), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / Math.hypot(...a));
/** A round footprint of radius r at (cx, cy) and its crease ring, inset by b, with eight steps a quarter so a seat stays smooth. */
const round = ([cx, cy], r, b) => [rrect(cx - r, cy - r, cx + r, cy + r, r, 8), rrect(cx - r + b, cy - r + b, cx + r - b, cy + r - b, r - b, 8)];

/** n points of radius r round c, in the plane square to the unit axis d. */
function disc(c, d, r, n = 16) {
  const u = unit(cross(d, Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), w = cross(d, u);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return add(c, add(mul(u, Math.cos(t) * r), mul(w, Math.sin(t) * r)));
  });
}

/** The one cyclic run of points that pass keep, in order. */
function arc(pts, keep) {
  const k = pts.map(keep), s = k.findIndex((v, i) => v && !k[(i + pts.length - 1) % pts.length]);
  return s < 0 ? (k[0] ? pts : []) : pts.slice(s).concat(pts.slice(0, s)).filter(keep);
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.8);
  fit(C, [[-4, -4, WALL], [-4, D + 4, WALL], [0, D + 4, -RISE], [W, D, -RISE], [W, 0, -RISE],
    [LAMP[0] + 11, LAMP[1], -RISE], [LAMP[0], LAMP[1] - 11, -RISE], [LAMP[0], LAMP[1], LAMP[2] + 7]], 200, 166);
  const P = proj(C), front = facing(C), Pv = (p) => P(p[0], p[1], p[2]);
  // toward the viewer: the one direction the camera flattens to a point
  const o = P(0, 0, 0), ax = [P(1, 0, 0), P(0, 1, 0), P(0, 0, 1)].map((q) => [q[0] - o[0], q[1] - o[1]]);
  let V = unit(cross(ax.map((a) => a[0]), ax.map((a) => a[1])));
  if (V[2] < 0) V = mul(V, -1);
  /** A round rod from a to b, radius ra to rb: its silhouette, and its rings at either end. */
  const rod = (a, b, ra, rb = ra) => {
    const d = unit(sub(b, a)), A = disc(a, d, ra), B = disc(b, d, rb);
    return { A, B, sil: poly(hull(A.concat(B).map(Pv))) };
  };
  const g = mk("g", {}, svg), path = (cls, d = "") => mk("path", { class: cls, d }, g);

  // the wall, with a few bricks on its face, as a club's wall is drawn
  const [wr, wi] = rings(-4, -4, 0, D + 4, 1.6, 0.8);
  put(solid(g), prism(P, front, wr, wi, -RISE, WALL));
  for (const [y0, z0] of [[5, 48], [20.6, 48], [12.8, 40.4], [56, 6], [48.2, 13.6], [63.8, 13.6]])
    path("nf lo", poly(rrect(y0, z0, y0 + 14, z0 + 6, 1.2, 2).map((q) => P(0, q.u, q.v))));

  // the follow-spot: a tripod, a pole and a can that turns to the pool
  const hub = [LAMP[0], LAMP[1], 4], feet = [0, 1, 2].map((k) => {
    const t = (k * 2 * Math.PI) / 3 + 0.5;
    return [LAMP[0] + 11 * Math.cos(t), LAMP[1] + 11 * Math.sin(t), -RISE];
  });
  const behind = (f) => f[0] + f[1] < LAMP[0] + LAMP[1];
  feet.filter(behind).forEach((f) => path("sil", rod(f, hub, 0.8).sil));
  path("sil", rod([LAMP[0], LAMP[1], -RISE + 1], [LAMP[0], LAMP[1], LAMP[2] - 6], 1.2).sil);
  feet.filter((f) => !behind(f)).forEach((f) => path("sil", rod(f, hub, 0.8).sil));
  const can = path("sil"), canEnd = path("nf lo");

  // the stage
  const [sr, si] = rings(0, 0, W, D, 6, 2);
  put(solid(g), prism(P, front, sr, si, -RISE, 0));

  // the light on the boards, and the beam's two edges, behind everything that stands on them
  const pen = path("nf dash"), pool = path("nf hi"), beam = path("nf sil");
  // the beam reads as a line on black: edge weight, a longer dash than .dash (1 3 at 55% vanished)
  beam.setAttribute("stroke-dasharray", "6 4");

  // the stool: four splayed legs, a foot ring, a round seat
  const stoolEls = [], legs = [0, 1, 2, 3].map((k) => {
    const t = ((20 + 90 * k) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return [[STOOL[0] + 10 * c, STOOL[1] + 10 * s, 0], [STOOL[0] + 5.5 * c, STOOL[1] + 5.5 * s, 36]];
  }).sort((a, b) => a[0][0] + a[0][1] - b[0][0] - b[0][1]);
  legs.slice(0, 2).forEach(([f, t]) => stoolEls.push(path("sil", rod(f, t, 0.9).sil)));
  path("nf", poly(disc([STOOL[0], STOOL[1], 13], [0, 0, 1], 8.4, 24).map(Pv)));
  legs.slice(2).forEach(([f, t]) => stoolEls.push(path("sil", rod(f, t, 0.9).sil)));
  const [st, sti] = round(STOOL, 9, 1.4), seat = solid(g);
  put(seat, prism(P, front, st, sti, 36, 39.5));
  stoolEls.push(seat.sil);

  // the mic: a heavy round base, a pole, and the mic in its clip, tilted up to the comic, with its grille's band
  const clip = [MIC[0], MIC[1], 46], m = unit([0.1, -0.8, 0.6]), head = add(clip, mul(m, 11.6)), hr = 2.9;
  const [br, bi] = round(MIC, 7, 1.2), base = solid(g);
  put(base, prism(P, front, br, bi, 0, 2));
  const pole = path("sil", rod([MIC[0], MIC[1], 2], clip, 1.1).sil);
  const handle = path("sil", rod(sub(clip, mul(m, 3)), add(clip, mul(m, 9)), 1.1, 1.6).sil);
  const hc = Pv(head), e = Pv(add(head, mul(unit(cross(V, [0, 0, 1])), hr))), rs = Math.hypot(e[0] - hc[0], e[1] - hc[1]);
  const ball = path("sil", poly(Array.from({ length: 24 }, (_, i) => [hc[0] + rs * Math.cos(i * Math.PI / 12), hc[1] + rs * Math.sin(i * Math.PI / 12)])));
  path("nf lo", open(arc(disc(head, m, hr, 24), (p) => dot(sub(p, head), V) >= 0).map(Pv)));

  /** A rest box on screen round some world points: props never move, so nothing under the pointer does. */
  const box = (pts) => {
    const s = pts.map(Pv), xs = s.map((p) => p[0]), ys = s.map((p) => p[1]);
    return [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2];
  };
  const props = [
    { name: "mic", at: MIC, els: [base.sil, pole, handle, ball], box: box(disc([...MIC, 0], [0, 0, 1], 7).concat([add(head, [0, 0, hr]), add(head, mul(m, hr))])) },
    { name: "stool", at: STOOL, els: stoolEls, box: box(legs.map((l) => l[0]).concat(disc([...STOOL, 39.5], [0, 0, 1], 9))) },
  ];

  let R = value, drawn = "", lastP = null, sway = [0, 0];
  const t0 = performance.now(), sp = [spring(MIC[0]), spring(MIC[1])];

  function drawLight() {
    const c = [sp[0].x + sway[0], sp[1].x + sway[1], 0], key = c.join() + R;
    if (key === drawn) return;
    drawn = key;
    const ring = disc(c, [0, 0, 1], R, 40).map(Pv);
    pool.setAttribute("d", poly(ring));
    pen.setAttribute("d", poly(disc(c, [0, 0, 1], R + 5, 40).map(Pv)));
    const d = unit(sub(c, LAMP)), cn = rod(sub(LAMP, mul(d, 8)), add(LAMP, mul(d, 12)), 4.4, 5.6);
    can.setAttribute("d", cn.sil);
    canEnd.setAttribute("d", poly((dot(d, V) > 0 ? cn.B : cn.A).map(Pv)));
    // the beam: the two hull edges that join the lens to the pool
    const lens = cn.B.map(Pv), keyOf = (p) => p[0] + "," + p[1], L = new Set(lens.map(keyOf)), h = hull(lens.concat(ring));
    beam.setAttribute("d", h.map((p, i) => { const q = h[(i + 1) % h.length]; return L.has(keyOf(p)) !== L.has(keyOf(q)) ? seg(p, q) : ""; }).join(""));
  }

  const B = register(stage, (dt, now) => {
    let moving = stepS(sp[0], dt);
    moving = stepS(sp[1], dt) || moving;
    // the ambient sway: a figure-eight from zero, so its first frame is rest; none for reduced motion
    const ph = ((now - t0) / PERIOD) * 2 * Math.PI, still = reducedMotion();
    sway = still ? [0, 0] : [SWAY[0] * Math.sin(ph), SWAY[1] * Math.sin(2 * ph)];
    drawLight();
    return moving || !still;
  });
  bag.add(B.unregister);

  /** Lights one prop (or none) and names what is in the light. */
  function light(q, text) {
    props.forEach((o) => o.els.forEach((el) => el.classList.toggle("hi", o === q)));
    read.textContent = text;
    B.wake();
  }
  /** Aims at the prop whose rest box holds the point, or the stage under it; the pool is kept on the boards. */
  function aim(p) {
    lastP = p;
    if (!p) { sp[0].t = clamp(MIC[0], R + 3, W - R - 3); sp[1].t = clamp(MIC[1], R + 3, D - R - 3); return light(props[0], "rest"); }
    let pick = props.find((q) => p[0] >= q.box[0] && p[0] <= q.box[2] && p[1] >= q.box[1] && p[1] <= q.box[3]);
    const w = pick ? pick.at : unproj(C, p[0], p[1], 0), t = [clamp(w[0], R + 3, W - R - 3), clamp(w[1], R + 3, D - R - 3)];
    pick = pick || props.find((q) => Math.hypot(q.at[0] - t[0], q.at[1] - t[1]) < R);
    sp[0].t = t[0]; sp[1].t = t[1];
    light(pick, pick ? pick.name : "stage");
  }

  aim(null);
  drawLight();
  bag.add(pointer(stage, { move: aim, leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { R = v; drawn = ""; aim(lastP); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "standup-stage",
  means: "A comedy-club stage: the pointer aims the follow-spot, and the mic or stool standing in its pool is lit.",
  rules: [1, 3, 4, 5],
  range: [10, 15, 22],
  mount,
});
