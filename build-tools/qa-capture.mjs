#!/usr/bin/env node
/**
 * qa-capture.mjs — parallel-safe page capture + DOM metrics for Redesign 2.0 QA.
 *
 *   node build-tools/qa-capture.mjs --url http://localhost:4331/ --out screenshots/redesign-2.0/qa/<label>
 *        [--viewport 1440x900|390x844] [--no-js] [--full] [--tiles N] [--reduced-motion] [--allow-status <code>]
 *
 * Launches its OWN headless Chromium per run (private temp profile, CDP over a pipe: no port, no shared
 * state, nothing to collide on), loads the page, waits for network idle and fonts, scrolls the whole page
 * once so lazy images and scroll reveals fire, then writes into --out:
 *   01.jpg 02.jpg ...   viewport-sized JPEG tiles, top to bottom, evenly spaced so the last one ends at the page
 *                       bottom (default 6, --full 12, --tiles N 0..12), device scale 1, quality 75, long side
 *                       <= 1568px (the image budget in BRIEF §6). Each tile's scrollY is in metrics.json.
 *   metrics.json        page height, every img/video/CSS background, light images, overflow, small text,
 *                       console + network problems, and with --no-js the text that only JavaScript makes visible
 * and prints a PASS / WARN / FAIL summary. Docs: docs/redesign-2.0/QA-CAPTURE.md
 *
 * Exit 0 = PASS or WARN · 1 = FAIL (image not loaded, console error, horizontal overflow, with --no-js text
 * that is visible with JavaScript on but invisible with it off, or an HTTP status that is not 2xx and not
 * listed in --allow-status) · 2 = bad usage / environment (not a FAIL of the page).
 *
 * --no-js: the tiles and every metric come from a JavaScript-OFF load (what a no-JS visitor sees). A second
 * JavaScript-ON pass at the same viewport runs in the same browser; the text check is the difference between
 * the two: text blocks visible once JS has run and everything settled, that are not visible with JS off.
 * Text that is hidden in both modes (closed <select>, closed <dialog>, a link display:none at this width) is
 * not a finding; neither is content of a closed <details> (it opens without JS), nor a control that only acts on
 * the page (a button, a tab, an in-page # link: it is JavaScript-only on purpose; a form's submit button is not
 * one). Text that exists only after scripts run (a clock, a label built from data attributes) is "script-made",
 * not hidden: it warns when it looks like copy, and fails when most of the page's text is like that.
 *
 * --out is locked while a run is alive, so two runs can never write the same folder. Use one label per
 * page and viewport. Engine: Playwright + chrome-headless-shell, the same engine gstack browse drives.
 * A page that reloads under the capture (dev-server hot reload) is re-captured, up to 3 times.
 *
 * Known ceilings (deliberate): light-DOM only (shadow roots are not walked); scrolling is programmatic
 * (scrollTo), so wheel-hijacking smooth-scroll libraries see scroll events but not wheel events; the
 * overlay check is a heuristic (WARN only); page height is the document's, so an inner scroll container
 * that holds the whole page reads as one screen; the --no-js comparison matches text blocks by their letters
 * and digits, so it cannot tell a moved block from a hidden one.
 */
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const MAX_SIDE = 1568, QUALITY = 75, MAX_TILES = 12, MAX_POS = 60;
const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;
const tx = (v, n = 60) => String(v).replace(/\s+/g, ' ').trim().slice(0, n); // (the in-page probe has its own copy: it is serialised separately)
const USAGE = `usage: node build-tools/qa-capture.mjs --url <url> --out <dir> [--viewport WxH] [--no-js] [--full] [--tiles N] [--reduced-motion] [--allow-status <code>]
  --url       page to capture, e.g. http://localhost:4331/
  --out       output folder, e.g. screenshots/redesign-2.0/qa/home-desktop (one folder per page + viewport)
  --viewport  1440x900 (default) or 390x844 or any WxH (under 768px wide = phone: touch + mobile viewport)
  --no-js     load with JavaScript disabled (noscript renders); fail on text that is visible with JS on but not with JS off
  --full      keep up to 12 tiles instead of 6        --tiles N   exactly N tiles (0 = metrics only)
  --reduced-motion   emulate prefers-reduced-motion: reduce
  --allow-status <code>   an HTTP status that is the CORRECT answer for this page (404 for the 404 page);
                          repeat or comma-separate for several. Without it only 2xx passes`;
const die = (m, code = 2) => { console.error(`qa-capture: ${m}`); process.exit(code); };
process.on('uncaughtException', (e) => die(`internal error (exit 2, not a FAIL of the page): ${e?.stack ?? e}`));
process.on('unhandledRejection', (e) => die(`internal error (exit 2, not a FAIL of the page): ${e?.stack ?? e}`));
setTimeout(() => die('timed out after 240s (browser is killed with this process)'), 240_000).unref();

// ─── args ────────────────────────────────────────────────────────────────────────────────────────
let o;
try {
  o = parseArgs({ options: {
    url: { type: 'string' }, out: { type: 'string' }, viewport: { type: 'string', default: '1440x900' },
    'no-js': { type: 'boolean' }, full: { type: 'boolean' }, tiles: { type: 'string' },
    'reduced-motion': { type: 'boolean' }, 'allow-status': { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' },
  } }).values;
} catch (e) { die(`${e.message}\n${USAGE}`); }
if (o.help) { console.log(USAGE); process.exit(0); }
if (!o.url || !o.out) die(`--url and --out are required\n${USAGE}`);
if (!/^(https?|file):/i.test(o.url)) die(`--url must start with http://, https:// or file:// (got "${o.url}")`);
const vm = /^(\d{3,4})x(\d{3,4})$/.exec(o.viewport);
if (!vm) die(`--viewport must look like 1440x900 (got "${o.viewport}")`);
const vw = +vm[1], vh = +vm[2];
const wantTiles = o.tiles !== undefined ? +o.tiles : o.full ? MAX_TILES : 6;
if (!Number.isInteger(wantTiles) || wantTiles < 0 || wantTiles > MAX_TILES) die(`--tiles must be an integer 0..${MAX_TILES}`);
const allowedStatus = new Set();
for (const v of o['allow-status'] ?? []) for (const part of String(v).split(',')) {
  if (!/^[1-5]\d\d$/.test(part.trim())) die(`--allow-status takes HTTP status codes such as 404 (got "${part}")`);
  allowedStatus.add(+part.trim());
}
const noJs = !!o['no-js'];
const phone = vw < 768;
const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh)); // device scale 1; only shrinks a viewport whose long side > 1568
const tileW = Math.round(vw * scale), tileH = Math.round(vh * scale);
const outDir = resolve(o.out);

// ─── output folder: lock it, clear only our own previous files ──────────────────────────────────
mkdirSync(outDir, { recursive: true });
const lock = join(outDir, '.qa-capture.lock');
try {
  const pid = +readFileSync(lock, 'utf8');
  if (pid && pid !== process.pid) { try { process.kill(pid, 0); die(`${relative(process.cwd(), outDir) || outDir} is in use by another qa-capture run (pid ${pid}); use a different --out label`); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
} catch (e) { if (e.code !== 'ENOENT') throw e; }
writeFileSync(lock, String(process.pid));
const release = () => rmSync(lock, { force: true });
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const clearOutputs = () => { for (const f of readdirSync(outDir)) if (/^\d\d\.jpg$/.test(f) || f === 'metrics.json') rmSync(join(outDir, f)); };
clearOutputs();

// ─── engine: gstack's Playwright (same chrome-headless-shell gstack drives), else any playwright-core ─
const require = createRequire(import.meta.url);
const CANDIDATES = [join(homedir(), '.claude/skills/gstack/node_modules/playwright-core'), 'playwright-core', 'playwright'];
const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function launch() {
  let last;
  for (const id of CANDIDATES) {
    let pw; try { pw = require(id); } catch (e) { last = e; continue; }
    for (const opts of [{}, ...(existsSync(CHROME_APP) ? [{ executablePath: CHROME_APP }] : [])]) {
      try {
        const browser = await pw.chromium.launch({ headless: true, ...opts });
        let ver = '?'; try { ver = require(`${id}/package.json`).version; } catch {}
        return { browser, engine: { browser: `Chromium ${browser.version()}`, playwright: ver, source: opts.executablePath ? 'system Chrome' : 'chrome-headless-shell' } };
      } catch (e) { last = e; }
    }
  }
  die(`no usable Playwright + Chromium (${String(last?.message).split('\n')[0]}).\n  Fix: npm i -D playwright-core && npx playwright-core install chromium-headless-shell`);
}
const { browser, engine } = await launch();

// ─── in-page probe (serialised by Playwright: must not close over anything from this module) ────
// noJs = scripts are disabled in THIS page; text = track which text blocks are visible (for the --no-js comparison)
function probe({ noJs, vw, text }) {
  const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const tx = (s, n = 60) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
  const gcs = (n, ps) => getComputedStyle(n, ps || null);
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!el.checkVisibility || el.checkVisibility()); };
  const view = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && (!el.checkVisibility || el.checkVisibility()); };
  const sel = (el) => {
    const parts = [];
    for (let n = el, d = 0; n && n.nodeType === 1 && d < 4; n = up(n), d++) {
      if (n.id) { parts.unshift(n.localName + '#' + CSS.escape(n.id)); break; }
      let s = n.localName + [...n.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(s);
    }
    return tx(parts.join(' > '), 140);
  };
  const selCache = new WeakMap();
  const selc = (el) => { let s = selCache.get(el); if (s === undefined) { s = sel(el); selCache.set(el, s); } return s; };
  // effective paint state: product of opacity up the whole ancestor chain, plus any filter / blend mode
  const paint = (el, pseudo) => {
    let eff = 1; const op = [], filters = [], blends = [];
    for (let n = el; n; n = up(n)) {
      const s = gcs(n, n === el ? pseudo : null), who = n === el ? 'self' : sel(n);
      const o = parseFloat(s.opacity);
      if (o < 1) { eff *= o; op.push(who + ' ' + r2(o)); }
      if (s.filter !== 'none') filters.push(who + ': ' + tx(s.filter));
      if (s.mixBlendMode !== 'normal') blends.push(who + ': ' + s.mixBlendMode);
    }
    return { eff, op, filters, blends };
  };
  const short = (u) => (u.startsWith('data:') ? u.slice(0, 48) + '…(' + u.length + ' chars)' : u);
  const urlsIn = (v) => [...v.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)].map((m) => m[2]);

  // registry of every image-like thing: <img>, <video>, CSS backgrounds (element, ::before, ::after)
  const reg = [], idx = new Map();
  const add = (el, kind, url, pseudo) => {
    let m = idx.get(el); if (!m) idx.set(el, (m = new Map()));
    const key = kind + '|' + url + '|' + pseudo;
    if (!m.has(key)) { const rec = { el, kind, url, pseudo, max: -1, seen: false, cur: null, last: null }; m.set(key, rec); reg.push(rec); }
  };
  const scan = () => {
    for (const el of document.querySelectorAll('*')) {
      if (el.localName === 'img' || el.localName === 'video') add(el, el.localName, '', '');
      const bg = gcs(el).backgroundImage;
      if (bg !== 'none') for (const u of urlsIn(bg)) add(el, 'bg', u, '');
      for (const p of ['::before', '::after']) { const b = gcs(el, p).backgroundImage; if (b !== 'none') for (const u of urlsIn(b)) add(el, 'bg', u, p); }
    }
  };
  const hideDevUi = () => { for (const e of document.querySelectorAll('astro-dev-toolbar')) e.style.setProperty('display', 'none', 'important'); };
  const height = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  // native lazy-loading never fires for images in closed <details>/tabs or far off to the right inside a side-scroller
  const eagerLazy = () => { let n = 0; for (const i of document.images) if (i.loading === 'lazy' && !i.complete) { i.loading = 'eager'; n++; } return n; };
  const pending = () => [...document.images].filter((i) => (i.currentSrc || i.getAttribute('src')) && !i.complete).length;
  const fontsBusy = () => document.fonts.status === 'loading';

  // text helpers
  const textBox = (p) => {
    const rg = document.createRange(); let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const c of p.childNodes) {
      if (c.nodeType !== 3 || !/\S/.test(c.data)) continue;
      rg.selectNodeContents(c);
      for (const q of rg.getClientRects()) { if (!q.width && !q.height) continue; L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); }
    }
    return L === Infinity ? null : { L, T, R, B };
  };
  const clipEmpty = (cp) => {
    if (/^circle\(\s*0(px|%)?[\s)]/.test(cp)) return true;
    const m = /^inset\(([^)]*)\)/.exec(cp); if (!m) return false;
    const v = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/).map((x) => (x.endsWith('%') ? parseFloat(x) : /^0(px)?$/.test(x) ? 0 : NaN));
    const [t, r, b, l] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v;
    return t + b >= 100 || l + r >= 100;
  };
  // why can a visitor not see this text? null = visible. design = deliberate (closed <details>, sr-only, skip link)
  const hiddenInfo = (p) => {
    const d = p.closest('details:not([open])');
    if (d && !p.closest('summary')) return { by: d, why: 'closed <details>', design: true };
    let eff = 1, effBy = null;
    for (let n = p; n; n = up(n)) {
      const s = gcs(n);
      if (s.display === 'none') return { by: n, why: 'display:none' };
      if (n === p && (s.visibility === 'hidden' || s.visibility === 'collapse')) return { by: n, why: 'visibility:hidden' };
      const o = parseFloat(s.opacity); if (o < 1) { eff *= o; effBy = effBy || n; }
      if (s.clipPath !== 'none' && clipEmpty(s.clipPath)) return { by: n, why: 'clip-path: ' + s.clipPath };
    }
    if (eff < 0.05) return { by: effBy, why: 'opacity:' + r2(eff) };
    const tb = textBox(p);
    if (!tb) return { by: p, why: 'no box (zero size / not rendered)' };
    let { L, T, R, B } = tb;
    for (let n = p; n && n !== document.body && n !== document.documentElement; n = up(n)) {
      const s = gcs(n);
      const cx = s.overflowX === 'hidden' || s.overflowX === 'clip', cy = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (!cx && !cy) continue;
      const q = n.getBoundingClientRect();
      if (cx) { L = Math.max(L, q.left); R = Math.min(R, q.right); }
      if (cy) { T = Math.max(T, q.top); B = Math.min(B, q.bottom); }
      if (R - L < 1 || B - T < 1) {
        const tiny = q.width <= 2 && q.height <= 2 && gcs(n).position === 'absolute';
        return { by: n, why: 'clipped to nothing by overflow', design: tiny };
      }
    }
    if (tb.R <= 0 || tb.B <= 0) return p.closest('a,button,[tabindex]') ? { by: p, why: 'off-screen focusable (skip link)', design: true } : { by: p, why: 'positioned off the page' };
    return null;
  };
  const textNodes = () => {
    const out = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = tw.nextNode());) {
      if (!/\S/.test(t.data)) continue;
      const p = t.parentElement;
      if (!p || p.closest('script,style,template,svg,head' + (noJs ? '' : ',noscript'))) continue;
      out.push([t, p]);
    }
    return out;
  };

  // --no-js comparison: the text is compared as blocks (the nearest non-inline ancestor), by their letters and digits only,
  // so a script that wraps words in spans, re-flows or re-cases a heading cannot cause a false difference
  const alnum = (s) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const INLINE = /^(inline|inline-block|inline-flex|inline-grid|inline-table|contents|ruby|ruby-text)$/;
  const blockOf = (p) => { let n = p; while (n && n !== document.body && INLINE.test(gcs(n).display)) n = up(n); return n || p; };
  // controls that act on the current page (a menu button, a tab, a "back to top" or in-page # link) exist to drive scripts: they are
  // hidden without JS on purpose. A form's submit / reset button is not one of them: without JS it must still be there.
  const CTL = 'button,[role=button],[role=tab],[role=switch],[role=menuitem],a[href^="#"]';
  const isCtl = (p) => { const c = p.closest(CTL); return !!c && !(c.localName === 'button' && c.type !== 'button' && c.closest('form')); };
  const segs = new Map(); // alnum text -> { k, ctl, parts, text, sel, y }: blocks seen visible while in view at a settled scroll position
  const scanText = (record) => {
    let n = 0, h = 0; const groups = new Map();
    for (const [t, p] of textNodes()) {
      const q = p.getBoundingClientRect();
      if ((q.width || q.height) && (q.bottom <= 0 || q.top >= innerHeight || q.right <= 0 || q.left >= innerWidth)) continue;
      if (hiddenInfo(p)) continue;
      const tb = textBox(p); if (!tb || tb.B <= 0 || tb.T >= innerHeight || tb.R <= 0 || tb.L >= innerWidth) continue;
      n++;
      for (let i = 0; i < t.data.length; i++) h = (h * 31 + t.data.charCodeAt(i)) | 0; // content hash: a counter that is still counting is not settled
      if (record) { const b = blockOf(p); let g = groups.get(b); if (!g) groups.set(b, (g = [[], []])); g[isCtl(p) ? 1 : 0].push(t); }
    }
    for (const [b, pair] of groups) pair.forEach((ts, isC) => {
      if (!ts.length) return;
      const txt = ts.map((t) => t.data).join(' '), k = alnum(txt), id = k + (isC ? '|c' : '');
      // parts = the block's text node by node: the comparison tests them in chunks, so a script that clones
      // a track (marquee) or splits a heading into spans does not break the match
      if (k.length >= 2 && !segs.has(id)) segs.set(id, { k, ctl: !!isC, parts: ts.map((t) => ({ k: alnum(t.data), t: t.data })).filter((x) => x.k), text: tx(txt, 60), sel: selc(b) + (isC ? ' [control]' : ''), y: Math.round(b.getBoundingClientRect().top + scrollY) });
    });
    return n + ':' + h;
  };

  // one look at every in-view image (and, for --no-js, in-view text); the signature stops changing once things have settled
  const running = () => document.getAnimations().filter((a) => a.playState === 'running' && a.timeline === document.timeline && a.effect && a.effect.getComputedTiming().iterations !== Infinity).length;
  const sample = () => {
    const sig = [];
    reg.forEach((rec, i) => { if (!view(rec.el)) { rec.cur = null; return; } rec.cur = paint(rec.el, rec.pseudo); sig.push(i + ':' + r2(rec.cur.eff)); });
    return { sig: sig.join(',') + (text ? '|t' + scanText(false) : ''), running: running() };
  };
  const commit = () => {
    for (const rec of reg) if (rec.cur) { rec.seen = true; rec.last = rec.cur; if (rec.cur.eff > rec.max) rec.max = rec.cur.eff; }
    if (text) scanText(true);
  };
  // the text picture for the comparison: blocks sampled visible during the walk, plus (statically, whole document)
  // every visible block and every hidden block with the reason it is hidden
  const finText = (withStatic) => {
    scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (!withStatic) return { segs: [...segs.values()] };
    const vis = new Map(), hid = new Map();
    for (const [t, p] of textNodes()) {
      const h = hiddenInfo(p), b = blockOf(p);
      if (!h) { const g = vis.get(b); if (g) g.push(t.data); else vis.set(b, [t.data]); continue; }
      const key = h.why + '|' + selc(h.by);
      let m = hid.get(b); if (!m) hid.set(b, (m = new Map()));
      let e = m.get(key);
      if (!e) m.set(key, (e = { k: '', text: tx(t.data, 60), why: h.why, by: selc(h.by), design: !!h.design, y: Math.round(h.by.getBoundingClientRect().top) }));
      e.k += alnum(t.data);
    }
    return {
      segs: [...segs.values()],
      vis: [...vis.values()].map((a) => alnum(a.join(' '))).filter((k) => k.length >= 2),
      hid: [...hid.values()].flatMap((m) => [...m.values()]).filter((e) => e.k.length >= 2),
    };
  };

  const fin = async () => {
    scrollTo({ top: 0, left: 0, behavior: 'instant' });
    scan();
    const de = document.documentElement, b = document.body;
    // the element whose overflow-x governs the viewport: <html> if it sets one, else <body>
    const rootEl = gcs(de).overflowX !== 'visible' ? de : (b || de), rootOverflowX = gcs(rootEl).overflowX;
    const doc = {
      height: height(), scrollWidth: Math.max(de.scrollWidth, b ? b.scrollWidth : 0), innerWidth, innerHeight,
      title: document.title, h1: tx((document.querySelector('h1') || {}).textContent || '', 90),
      metaViewport: !!document.querySelector('meta[name=viewport]'), lang: de.lang || '',
      rootOverflowX, rootClipsX: rootOverflowX === 'hidden' || rootOverflowX === 'clip',
    };
    // image-like items
    const perf = new Map(); for (const e of performance.getEntriesByType('resource')) perf.set(e.name, e);
    const decs = new Map();
    const dec = (u) => { if (!decs.has(u)) { const i = new Image(); i.src = u; decs.set(u, i.decode().then(() => [i.naturalWidth, i.naturalHeight], () => null)); } return decs.get(u); };
    // start every background / poster decode at once; the loop below then reads settled promises
    await Promise.all(reg.flatMap((rec) => (rec.kind === 'bg' ? [dec(rec.url)] : rec.kind === 'video' && rec.el.poster ? [dec(rec.el.poster)] : [])));
    const items = [], light = [];
    for (const rec of reg) {
      const { el, kind } = rec, r = el.getBoundingClientRect();
      const it = { kind, sel: sel(el) + (rec.pseudo || ''), y: Math.round(r.top + scrollY), rendered: [Math.round(r.width), Math.round(r.height)], hidden: !shown(el) };
      if (kind === 'img') {
        const u = el.currentSrc || el.src || '';
        let ok = !!u && el.complete && el.naturalWidth > 0;
        // complete but 0x0: a broken image, or a valid SVG with no intrinsic size; decode() tells them apart
        if (!ok && u && el.complete && el.naturalWidth === 0) ok = await el.decode().then(() => true, () => false);
        Object.assign(it, { url: short(u), natural: [el.naturalWidth, el.naturalHeight], loaded: ok, lazy: el.loading === 'lazy', picture: !!el.parentElement && el.parentElement.localName === 'picture' });
      } else if (kind === 'video') {
        // the source the browser plays, else the first <source> it could play (preload=none leaves currentSrc empty)
        const u = el.currentSrc || (el.getAttribute('src') ? el.src : '') || ([...el.querySelectorAll('source')].find((x) => !x.type || el.canPlayType(x.type)) || {}).src || '', poster = el.poster || '';
        const pn = poster ? await dec(poster) : null, err = el.error ? el.error.code : null;
        // healthy = no media error and not "no usable source"; preload=none / metadata videos legitimately sit at readyState 0-1
        Object.assign(it, { url: short(u || poster), poster: poster ? short(poster) : undefined, natural: [el.videoWidth, el.videoHeight], video: { ready: el.readyState, net: el.networkState, err, preload: el.preload },
          loaded: !err && (u ? el.networkState !== 3 : !!poster) && (!poster || !!pn) });
      } else {
        const nat = await dec(rec.url);
        Object.assign(it, { url: short(rec.url), natural: nat || [0, 0], loaded: !!nat });
      }
      const pe = perf.get(kind === 'bg' ? rec.url : it.url); if (pe && pe.encodedBodySize) it.bytes = pe.encodedBodySize;
      if (it.natural[0] > 0 && it.rendered[0] > 0) it.scale = r2(it.rendered[0] / it.natural[0]);
      items.push(it);
      if (rec.seen && (rec.max < 0.999 || rec.last.filters.length || rec.last.blends.length)) {
        light.push({ kind, sel: it.sel, url: it.url, y: it.y, opacity: r2(rec.max), opacityChain: rec.last.op, filters: rec.last.filters, blends: rec.last.blends });
      }
    }
    // horizontal overflow: elements sticking out of the viewport's right edge (the only side that can scroll)
    // that no overflow clipper / fixed box contains. Off-canvas-left things (skip links, drawers) are not overflow.
    const over = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect(); if ((!r.width && !r.height) || r.right <= vw + 1) continue;
      let skip = false;
      for (let n = el; n && n !== document.body && n !== de; n = up(n)) {
        const s = gcs(n);
        if (s.position === 'fixed' || (n !== el && /^(hidden|clip|auto|scroll)$/.test(s.overflowX))) { skip = true; break; }
      }
      if (!skip) over.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), y: Math.round(r.top), by: Math.round(r.right - vw) });
    }
    over.sort((a, c) => c.by - a.by);
    // text smaller than 12px (visible elements; closed <details> excluded)
    const small = [], seenP = new Set();
    for (const [, p] of textNodes()) {
      if (seenP.has(p)) continue; seenP.add(p);
      const tb = textBox(p), fs = parseFloat(gcs(p).fontSize);
      if (tb && fs < 12 && !p.closest('details:not([open])')) small.push({ sel: sel(p), px: r2(fs), text: tx(p.textContent, 50), y: Math.round(tb.T) });
    }
    // heuristic: a later-painted, absolutely positioned sibling covering >= 85% of an image with a visible background
    const overlays = [];
    for (const [k, it] of items.entries()) {
      if (it.hidden || it.kind === 'bg' || !it.rendered[0] || !it.rendered[1]) continue;
      const rec = reg[k]; // items[k] was built from reg[k]
      const ir = rec.el.getBoundingClientRect(), area = ir.width * ir.height;
      for (let node = rec.el, depth = 0; node && depth < 3 && node.parentElement; node = node.parentElement, depth++) {
        const sibs = [...node.parentElement.children], after = sibs.indexOf(node);
        sibs.forEach((s, j) => {
          if (s === node || s === rec.el) return;
          const ss = gcs(s); if (ss.position !== 'absolute' && ss.position !== 'fixed') return;
          if (ss.display === 'none' || ss.visibility === 'hidden' || parseFloat(ss.opacity) === 0) return;
          const z = parseInt(ss.zIndex, 10) || 0, zi = parseInt(gcs(node).zIndex, 10) || 0;
          if (j < after && z <= zi) return;
          const sr = s.getBoundingClientRect();
          const ix = Math.max(0, Math.min(ir.right, sr.right) - Math.max(ir.left, sr.left)) * Math.max(0, Math.min(ir.bottom, sr.bottom) - Math.max(ir.top, sr.top));
          if (area && ix / area < 0.85) return;
          // mean alpha: of the colour, or of the gradient's colour stops (equal spacing assumed): ~how much it darkens on average
          const alphas = (v) => [...v.matchAll(/rgba?\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+(?:,\s*([\d.]+))?\s*\)/g)].map((m) => (m[1] === undefined ? 1 : +m[1]));
          const al = ss.backgroundImage !== 'none' ? alphas(ss.backgroundImage) : alphas(ss.backgroundColor);
          const mean = al.length ? al.reduce((x, y) => x + y, 0) / al.length : 0;
          if (mean < 0.15) return;
          overlays.push({ image: it.sel, url: it.url, overlay: sel(s), covers: r2(ix / area), meanAlpha: r2(mean), background: tx(ss.backgroundImage !== 'none' ? ss.backgroundImage : ss.backgroundColor, 110), y: it.y });
        });
      }
    }
    const fontErrors = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family);
    return { doc, items, light, over: over.slice(0, 15), overTotal: over.length, small: small.slice(0, 30), smallTotal: small.length, overlays: overlays.sort((a, c) => c.meanAlpha - a.meanAlpha).slice(0, 15), overlayTotal: overlays.length, fontErrors };
  };
  return { scan, sample, commit, fin, finText, hideDevUi, height, eagerLazy, pending, fontsBusy };
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now(), lap = {}, mark = (k) => { lap[k] = Date.now() - t0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const giveUp = (ms) => new Promise((r) => setTimeout(() => r(null), ms).unref()); // never keeps the process alive
// the page navigated / reloaded under us (dev-server hot reload): the in-page handle is gone, capture again
const NAV_RACE = /Execution context was destroyed|JSHandles can be evaluated only|rame (was )?detached|Cannot find context|Inspected target navigated/i;

// One full pass over the page in its own browser context. primary = the pass whose tiles + metrics are reported.
async function runPass({ js, primary }) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh }, deviceScaleFactor: scale, isMobile: phone, hasTouch: phone,
    javaScriptEnabled: js, reducedMotion: o['reduced-motion'] ? 'reduce' : 'no-preference', serviceWorkers: 'block', ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const bag = { consoleErrors: [], pageErrors: [], failedReqs: [], badStatus: new Map(), aborted: 0, consoleWarnings: 0 };
  const open = new Map(); // requests still in flight, to name the culprit when a third-party host stalls
  page.on('request', (r) => open.set(r, Date.now()));
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
  const pendingList = () => [...new Set([...open.keys()].filter((r) => r.resourceType() !== 'websocket' && r.resourceType() !== 'eventsource').map((r) => r.url().slice(0, 100)))].slice(0, 3).join(', ');
  page.on('console', (m) => { if (m.type() === 'error') bag.consoleErrors.push({ text: m.text().slice(0, 300), url: m.location().url || undefined, line: m.location().lineNumber || undefined }); else if (m.type() === 'warning') bag.consoleWarnings++; });
  page.on('pageerror', (e) => bag.pageErrors.push(String(e?.message ?? e).slice(0, 300)));
  page.on('requestfailed', (r) => { const err = r.failure()?.errorText || 'failed'; if (/ERR_ABORTED/.test(err)) bag.aborted++; else bag.failedReqs.push({ url: r.url(), type: r.resourceType(), error: err }); });
  page.on('response', (r) => { if (r.status() >= 400) bag.badStatus.set(r.url(), { status: r.status(), type: r.request().resourceType() }); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('crash', () => die('the page crashed'));
  const notes = new Set(), pre = primary ? '' : 'JavaScript-on comparison pass: ', passName = primary ? (noJs ? 'the JavaScript-off pass' : 'the page') : 'the JavaScript-on comparison pass';
  const tilesWanted = primary ? wantTiles : 0;

  const once = async () => {
    bag.consoleErrors.length = 0; bag.pageErrors.length = 0; bag.failedReqs.length = 0; bag.badStatus.clear(); bag.aborted = 0; bag.consoleWarnings = 0;
    let status = 0, finalUrl = o.url;
    for (let attempt = 1; ; attempt++) { // a dev server mid-restart (or a saturated one) resets / refuses the first try; a stalled host times out: retry
      try {
        // DOMContentLoaded, not load: a stalled async analytics script delays load for as long as the host stalls, and says nothing about the page
        const resp = await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        status = resp ? resp.status() : 0; finalUrl = page.url();
        break;
      } catch (e) {
        const why = String(e.message).match(/net::\w+|interrupted by another navigation|Timeout \d+ms exceeded/)?.[0];
        if (attempt < (/Timeout/.test(e.message) ? 2 : 3) && why) { notes.add(`${pre}page.goto attempt ${attempt} failed (${why}${open.size ? `; pending: ${pendingList()}` : ''}); retried`); await sleep(1500); continue; }
        await browser.close().catch(() => {}); die(`could not load ${o.url}${primary && !noJs ? '' : ` in ${passName}`}: ${String(e.message).split('\n')[0]}${open.size ? ` (still waiting for: ${pendingList()})` : ''}`);
      }
    }
    // the load event follows normally in a few seconds; a stalled third-party host must not turn a correct page into an error
    const loadOk = await page.waitForLoadState('load', { timeout: 20_000 }).then(() => true, () => false);
    if (!loadOk) notes.add(`${pre}the load event did not fire within 20s of DOMContentLoaded; continued without it${open.size ? ` (still pending: ${pendingList()}; a stalled third-party host?)` : ''}`);
    if (primary) mark('loaded');
    const idle = await page.waitForLoadState('networkidle', { timeout: loadOk ? 15_000 : 2_000 }).then(() => true, () => false); // a known stall will not go idle
    if (primary) mark('networkIdle');
    if (!idle) notes.add(`${pre}network never went idle within ${loadOk ? 15 : 2}s (long-polling or a stuck request?)`);

    const api = await page.evaluateHandle(probe, { noJs: !js, vw, text: noJs });
    const waitFonts = async () => { for (let i = 0; i < 25 && (await page.evaluate((a) => a.fontsBusy(), api)); i++) await sleep(200); };
    await waitFonts();
    await page.evaluate((a) => a.scan(), api);

    // pass 1: scroll the whole page once (fires lazy images and scroll reveals), then force-load lazy images that scrolling cannot reach
    const step = Math.round(vh * 0.75);
    for (let y = 0, i = 0; i < 200; i++) {
      await page.evaluate((yy) => scrollTo({ top: yy, left: 0, behavior: 'instant' }), y);
      await sleep(170);
      if (y + vh >= (await page.evaluate((a) => a.height(), api))) break; // re-read after the wait: lazy content may have grown the page
      y += step;
    }
    if (primary) mark('scrollSteps');
    await page.waitForLoadState('networkidle', { timeout: loadOk ? 6_000 : 1_500 }).catch(() => {});
    if (primary) mark('idleAfterScroll');
    await page.evaluate((a) => a.eagerLazy(), api);
    for (let i = 0; i < 120 && (await page.evaluate((a) => a.pending(), api)); i++) await sleep(200); // up to ~24s: a dev server may be transcoding
    if (primary) mark('imagesPending');
    await waitFonts();
    if (primary) mark('scrollPass');

    // pass 2: walk the page one screen at a time; wait until in-view image opacity (and, for --no-js, in-view text) stops
    // changing; sample; screenshot
    const settle = async (isTile) => {
      let prev = null;
      for (let i = 0; i < 8; i++) {
        await sleep(250);
        const r = await page.evaluate((a) => a.sample(), api);
        if (!isTile && !r.sig && !r.running) return true; // nothing to watch on this screen and nothing to photograph
        if (r.sig === prev && !r.running) return true;    // in-view opacity stopped changing and finite CSS animations are done
        prev = r.sig;
      }
      return false;
    };
    const tiles = []; let unsettled = 0, height = await page.evaluate((a) => a.height(), api);
    const positions = Math.min(Math.max(1, Math.ceil(height / vh)), MAX_POS);
    if (Math.ceil(height / vh) > MAX_POS) notes.add(`${pre}page is ${r1(height / vh)} screens; only the first ${MAX_POS} were sampled for the image-opacity check`);
    for (let i = 0; i < positions; i++) {
      height = await page.evaluate((a) => a.height(), api);
      // evenly spaced over the scrollable range, stride <= one screen: no near-duplicate last tile, last tile ends at the page bottom
      const maxScroll = Math.max(0, height - vh), stride = positions === 1 ? 0 : Math.min(vh, maxScroll / (positions - 1));
      const y = Math.round(i * stride);
      await page.evaluate((yy) => scrollTo({ top: yy, left: 0, behavior: 'instant' }), y);
      if (!(await settle(i < tilesWanted))) unsettled++;
      await page.evaluate((a) => a.commit(), api);
      if (i < tilesWanted) {
        await page.evaluate((a) => a.hideDevUi(), api);
        const file = `${String(i + 1).padStart(2, '0')}.jpg`;
        writeFileSync(join(outDir, file), await page.screenshot({ type: 'jpeg', quality: QUALITY }));
        tiles.push({ file, scrollY: y, width: tileW, height: tileH });
      }
    }
    if (unsettled) notes.add(`${pre}${unsettled} screen(s) never settled in ~2s (looping animation?); readings there may be mid-animation`);
    if (primary) mark('tilesAndSampling');

    // final: whole-page measurements from the top
    const fin = primary ? await Promise.race([page.evaluate((a) => a.fin(), api), giveUp(60_000)]) : null;
    if (primary && !fin) die('final measurements timed out (a stuck image decode?)');
    if (primary) { // a video the browser has not started (preload=none / metadata) cannot tell us its URL is broken: ask the server
      for (const it of fin.items) {
        if (it.kind !== 'video' || !it.loaded || !/^https?:/i.test(it.url) || it.video.ready !== 0 || it.video.err || it.video.net === 3) continue;
        try {
          let res = await ctx.request.head(it.url, { timeout: 15_000, failOnStatusCode: false });
          if (res.status() === 405 || res.status() === 501) { await res.dispose(); res = await ctx.request.get(it.url, { headers: { Range: 'bytes=0-0' }, timeout: 15_000, failOnStatusCode: false }); }
          it.video.probe = res.status(); if (res.status() >= 400) { it.loaded = false; it.httpStatus = res.status(); }
          await res.dispose();
        } catch (e) { it.video.probe = 'unreachable'; it.loaded = false; }
      }
    }
    const txt = noJs ? await page.evaluate(([a, st]) => a.finText(st), [api, primary]) : null;
    if (primary) mark('finalMeasure');
    await sleep(150); // late console / network events
    return { status, finalUrl, idle, tiles, height, fin, txt };
  };

  for (let attempt = 1; ; attempt++) {
    try { return { ...(await once()), bag, notes }; } catch (e) {
      if (attempt < 4 && NAV_RACE.test(String(e.message))) { notes.add(`${pre}the page reloaded while it was being captured (dev-server hot reload?); captured again (attempt ${attempt + 1} of 4)`); if (primary) clearOutputs(); await sleep(800); continue; }
      if (NAV_RACE.test(String(e.message))) die(`${pre}the page kept reloading while it was captured (4 attempts); is something editing its source in a loop?`);
      throw e;
    }
  }
}

// --no-js: the JavaScript-ON pass runs alongside, only to learn which text a visitor sees once scripts have run
const helperP = noJs ? runPass({ js: true, primary: false }).then((v) => ({ v }), (err) => ({ err })) : null;
const P = await runPass({ js: !noJs, primary: true });
const H = helperP ? await helperP : null;
await browser.close().catch(() => {});
if (H?.err) die(`the JavaScript-on comparison pass failed: ${String(H.err?.message ?? H.err).split('\n')[0]}`);
const { status, finalUrl, idle, tiles, fin, bag } = P;
const notes = new Set([...P.notes, ...(H ? H.v.notes : [])]);
const restarts = [...notes].filter((n) => /reloaded while it was being captured/.test(n)).length;

// ─── verdict ─────────────────────────────────────────────────────────────────────────────────────
const { doc, items, light, over, overTotal, small, smallTotal, overlays, overlayTotal, fontErrors } = fin;
const totalScreens = Math.ceil(doc.height / vh);
// which saved tile shows this element best: the tile whose centre is closest to the element's centre (null = not in any saved tile)
const tileOf = (y, h = 0) => {
  const c = y + Math.min(h, vh) / 2; let best = null, bd = Infinity;
  tiles.forEach((t, k) => { if (c >= t.scrollY && c <= t.scrollY + vh) { const d = Math.abs(c - (t.scrollY + vh / 2)); if (d < bd) { bd = d; best = k + 1; } } });
  return best;
};
const tag = (x) => ({ ...x, screen: r1(x.y / vh + 1), tile: tileOf(x.y, x.rendered ? x.rendered[1] : 0) });

// an HTTP status the caller declared correct (--allow-status) is not an error: drop the main document's own 4xx/5xx noise
const sameDoc = (u) => !!u && u.split('#')[0] === finalUrl.split('#')[0];
const statusAllowed = allowedStatus.has(status) && !(status >= 200 && status <= 299);
const consoleErrors = bag.consoleErrors.filter((e) => !(statusAllowed && sameDoc(e.url) && /^Failed to load resource/.test(e.text)));
const badStatus = new Map([...bag.badStatus].filter(([u, s]) => !(statusAllowed && s.type === 'document' && sameDoc(u))));
const { pageErrors, failedReqs } = bag;
for (const it of items) { const s = badStatus.get(it.url); if (s) { it.loaded = false; it.httpStatus = s.status; } if (failedReqs.some((f) => f.url === it.url)) it.loaded = false; }
const images = items.map(tag);
const broken = images.filter((i) => !i.loaded && !(i.hidden && !i.url));
const lightT = light.map(tag), overT = over.map(tag), smallT = small.map(tag), overlayT = overlays.map(tag);

// --no-js: text blocks visible with JS on (settled) but not visible with JS off. Hidden in both modes = not a finding.
let hiddenText = null;
if (noJs) {
  const on = H.v.txt, off = P.txt;
  const visOff = [...new Set([...off.vis, ...off.segs.map((s) => s.k)])];
  const corpus = visOff.join('\u0001'), flat = visOff.join('');
  const exactOff = new Set(visOff);
  // short strings must match a whole block ("menu" must not be found inside "the restaurant menu"); long ones may sit inside a larger block
  const found = (k) => exactOff.has(k) || (k.length >= 12 && (corpus.includes(k) || flat.includes(k)));
  // a block is accounted for when its whole text is visible without JS, or when every chunk of it is (chunks = consecutive
  // text nodes merged to >= 12 letters: tolerates cloned tracks and heading characters split into spans)
  const chunks = (parts) => { const out = []; let k = '', t = ''; for (const p of parts) { k += p.k; t += ' ' + p.t; if (k.length >= 12) { out.push({ k, t }); k = ''; t = ''; } } if (k.length >= 2) out.push({ k, t }); return out; };
  const missing = (s) => (found(s.k) ? [] : chunks(s.parts).filter((c) => !found(c.k)));
  const blocks = new Map(); // one entry per block: the longest text seen for it
  for (const s of on.segs) { const p = blocks.get(s.sel); if (!p || s.k.length > p.k.length) blocks.set(s.sel, s); }
  let onChars = 0; for (const s of blocks.values()) onChars += s.k.length;
  const flagged = [], created = [], exempt = {}, exemptItems = [];
  const keep = (why, text, by, y) => { exempt[why] = (exempt[why] || 0) + 1; exemptItems.push({ why, text: tx(text, 60), by, y }); };
  for (const s of blocks.values()) {
    const miss = missing(s); if (!miss.length) continue;
    if (s.ctl) { keep('control that acts on the page (button, tab, in-page link): JavaScript-only on purpose', s.text, s.sel, s.y); continue; }
    for (const c of miss) { // each piece of the block that the no-JS page does not show
      const h = off.hid.find((x) => (c.k.length < 12 ? x.k === c.k : x.k.includes(c.k) || (x.k.length >= 6 && c.k.includes(x.k)))); // where the no-JS page keeps it, hidden
      if (!h) created.push({ text: tx(c.t, 60), by: s.sel, y: s.y, chars: c.k.length }); // not in the HTML at all: script-made
      else if (h.design) keep(h.why === 'closed <details>' ? 'closed <details> (opens without JavaScript)' : h.why, c.t, h.by, h.y);
      else flagged.push({ why: h.why, by: h.by, y: h.y, text: tx(c.t, 60) });
    }
  }
  const groups = new Map(), byCause = {};
  for (const f of flagged) {
    const key = f.why + '|' + f.by, g = groups.get(key), cause = f.why.replace(/[:(].*$/, '').trim();
    byCause[cause] = (byCause[cause] || 0) + 1;
    if (g) g.count++; else groups.set(key, { why: f.why, by: f.by, count: 1, text: f.text, y: f.y });
  }
  const createdChars = created.reduce((a, c) => a + c.chars, 0), share = onChars ? createdChars / onChars : 0;
  hiddenText = {
    method: 'text blocks visible with JavaScript on (after settling) but not visible with JavaScript off, same viewport',
    total: flagged.length, byCause, groupsTotal: groups.size, groups: [...groups.values()].slice(0, 30).map(tag),
    exemptByDesign: Object.values(exempt).reduce((x, y) => x + y, 0), exemptReasons: exempt, exemptItems: exemptItems.slice(0, 30).map(tag),
    // text that exists only while scripts run (a clock filled in by JS, a tab label built from data attributes): an enhancement,
    // not hidden content, so a WARN; but a page whose text is mostly script-made is not progressively enhanced at all
    // short values (a clock, a date, a counter) are listed here but only look like copy, and warn, from 40 letters in one block or 80 in total
    createdByScript: { total: created.length, letters: createdChars, shareOfVisibleText: r2(share), looksLikeCopy: created.some((c) => c.chars >= 40) || createdChars >= 80, items: created.slice(0, 30).map(tag) },
    mostlyScriptMade: createdChars >= 200 && share >= 0.5,
    jsOnVisibleBlocks: on.segs.length, jsOffVisibleBlocks: visOff.length,
  };
}

// phone emulation shrinks-to-fit: wide content (or a missing <meta viewport>) grows the layout viewport, so compare with the requested width
const docW = Math.max(doc.scrollWidth, doc.innerWidth), docOverflow = Math.max(0, docW - vw);
const grew = doc.innerWidth > vw + 1;
const clippedAtRoot = docOverflow > 1 && !grew && doc.rootClipsX; // overflow-x:hidden|clip on the root: nothing scrolls, the excess is just cut off
const consoleCount = consoleErrors.length + pageErrors.length;
const fails = [], warns = [];
const where = (x) => (x.tile ? `[tile ${x.tile}] ` : x.screen ? `[screen ${x.screen}] ` : '');
const list = (arr, f, n = 5) => arr.slice(0, n).map((x) => '      ' + f(x)).concat(arr.length > n ? [`      ... +${arr.length - n} more (metrics.json)`] : []);
if (/^https?:/i.test(o.url) && !((status >= 200 && status <= 299) || allowedStatus.has(status))) fails.push([`page answered HTTP ${status || '(no response)'}; only 2xx passes${status ? ` (if ${status} is the correct answer for this page, pass --allow-status ${status})` : ''}`]);
if (broken.length) fails.push([`${broken.length} image(s) not loaded`, ...list(broken, (i) => `${where(i)}${i.kind} ${i.url || '(no src)'}${i.httpStatus ? ' -> HTTP ' + i.httpStatus : ''}  ${i.sel}`)]);
if (consoleCount) fails.push([`${consoleCount} console error(s)`, ...list([...consoleErrors.map((e) => e.text + (e.url ? '  <' + e.url + '>' : '')), ...pageErrors.map((e) => 'uncaught: ' + e)], (s) => s.slice(0, 200))]);
if (docOverflow > 1 && !clippedAtRoot) fails.push([`horizontal overflow: page is ${docW}px wide in a ${vw}px viewport (+${docOverflow}px)${grew ? ' - the phone layout viewport grew: wide content, or a missing <meta name="viewport" content="width=device-width, initial-scale=1">' : ''}`, ...list(overT, (e) => `${where(e)}${e.sel} sticks out ${e.by}px (${e.left}..${e.right}px, ${e.width}px wide)`, 6)]);
if (hiddenText?.mostlyScriptMade) fails.push([`most of this page's text exists only while JavaScript runs: ${hiddenText.createdByScript.letters} of the page's visible letters and digits (${Math.round(hiddenText.createdByScript.shareOfVisibleText * 100)}%) are not in the HTML`, ...list(hiddenText.createdByScript.items, (c) => `${where(c)}"${c.text}"  ${c.by}`)]);
if (hiddenText?.total) fails.push([`${hiddenText.total} text block(s) visible with JavaScript on but invisible with JavaScript off, in ${hiddenText.groupsTotal} group(s)${hiddenText.groupsTotal > hiddenText.groups.length ? ` (first ${hiddenText.groups.length} listed in metrics.json)` : ''}: ${Object.entries(hiddenText.byCause).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(', ')}`, ...list(hiddenText.groups, (g) => `${where(g)}${g.why} on ${g.by}  (${g.count} text block${g.count > 1 ? 's' : ''}, e.g. "${g.text}")`, 6)]);
if (hiddenText?.createdByScript.looksLikeCopy && !hiddenText.mostlyScriptMade) warns.push([`${hiddenText.createdByScript.total} text block(s) exist only while JavaScript runs (created by script, not hidden content): confirm each is an enhancement and not copy`, ...list(hiddenText.createdByScript.items, (c) => `${where(c)}"${c.text}"  ${c.by}`)]);
if (lightT.length) warns.push([`${lightT.length} image(s) with opacity < 1, a filter or a blend mode`, ...list(lightT, (l) => `${where(l)}${l.kind} ${l.url.startsWith('data:') ? l.url.slice(0, 30) : l.url.split('/').pop() || l.sel}  opacity ${l.opacity}${l.opacityChain.length ? ' [' + l.opacityChain.join(', ') + ']' : ''}${l.filters.length ? ' filter ' + l.filters.join('; ') : ''}${l.blends.length ? ' blend ' + l.blends.join('; ') : ''}`)]);
if (overlayTotal) warns.push([`${overlayTotal} image(s) under a near-full-cover overlay with mean alpha >= 0.15 (heaviest first; judge: localised scrim under text, or full-bleed dimming?)`, ...list(overlayT, (v) => `${where(v)}${v.image} <- ${v.overlay} covers ${Math.round(v.covers * 100)}%, mean alpha ${v.meanAlpha}: ${v.background}`)]);
if (clippedAtRoot) warns.push([`content is ${docW}px wide in a ${vw}px viewport (+${docOverflow}px) but cut off by overflow-x:${doc.rootOverflowX} on the root, so nothing scrolls; anything beyond the right edge is unreachable (fine for a decorative glow, a defect for text or images)`, ...list(overT, (e) => `${where(e)}${e.sel} +${e.by}px`)]);
else if (overTotal && docOverflow <= 1) warns.push([`${overTotal} element(s) stick out of the viewport (contained: no page-level overflow)`, ...list(overT, (e) => `${where(e)}${e.sel} +${e.by}px`)]);
if (smallTotal) warns.push([`${smallTotal} text element(s) under 12px`, ...list(smallT, (s) => `${where(s)}${s.px}px "${s.text}"  ${s.sel}`)]);
if (failedReqs.length || badStatus.size) warns.push([`${failedReqs.length} failed + ${badStatus.size} HTTP>=400 network request(s)`, ...list([...failedReqs.map((f) => `${f.type} ${f.url} ${f.error}`), ...[...badStatus].map(([u, s]) => `${s.type} ${u} HTTP ${s.status}`)], (s) => s.slice(0, 200))]);
if (fontErrors.length) warns.push([`${fontErrors.length} web font(s) failed to load: ${fontErrors.join(', ')}`]);
if (totalScreens > tiles.length && o.tiles === undefined) warns.push([`${totalScreens} screens tall, only ${tiles.length} tile(s) saved${wantTiles < MAX_TILES ? ' (--full keeps up to 12)' : ''}`]);
for (const n of notes) warns.push([n]);
const result = fails.length ? 'FAIL' : warns.length ? 'WARN' : 'PASS';

// ─── write + print ───────────────────────────────────────────────────────────────────────────────
const loadedN = images.filter((i) => i.loaded).length;
const metrics = {
  tool: 'qa-capture', createdAt: new Date().toISOString(), seconds: r1((Date.now() - t0) / 1000), msAt: lap, engine,
  url: o.url, finalUrl, httpStatus: status, allowedStatus: [...allowedStatus], restarts, js: !noJs, reducedMotion: !!o['reduced-motion'],
  viewport: { width: vw, height: vh, deviceScaleFactor: r2(scale), phoneEmulation: phone, layoutWidth: doc.innerWidth },
  page: { title: doc.title, h1: doc.h1, lang: doc.lang, heightPx: doc.height, screens: r2(doc.height / vh), scrollWidthPx: doc.scrollWidth, layoutWidthPx: doc.innerWidth, horizontalOverflowPx: docOverflow, overflowClippedByRoot: clippedAtRoot, networkIdle: idle },
  tiles, tilesSaved: tiles.length, screensTotal: totalScreens,
  images: { total: images.length, loaded: loadedN, notLoaded: images.length - loadedN, hidden: images.filter((i) => i.hidden).length, items: images },
  lightImages: lightT, overlays: { total: overlayTotal, items: overlayT },
  overflow: { documentOverflowPx: docOverflow, total: overTotal, elements: overT },
  smallText: { total: smallTotal, items: smallT },
  console: { errors: consoleErrors, uncaught: pageErrors, warnings: bag.consoleWarnings },
  network: { failed: failedReqs, httpError: [...badStatus].map(([url, s]) => ({ url, ...s })), aborted: bag.aborted },
  fonts: { failed: fontErrors },
  hiddenText,
  verdict: { result, fail: fails.map((f) => f[0]), warn: warns.map((w) => w[0]) },
};
writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');

const rel = relative(process.cwd(), outDir) || '.';
console.log(`qa-capture  ${finalUrl}  ${vw}x${vh}  js:${noJs ? 'OFF' : 'on'}${phone ? '  phone' : ''}  (${engine.browser}, ${metrics.seconds}s)`);
console.log(`  page      ${r1(doc.height / vh)} screens (${doc.height}px)  "${doc.title.slice(0, 70)}"${doc.h1 ? `  h1 "${doc.h1.slice(0, 50)}"` : ''}`);
console.log(`  tiles     ${tiles.length ? `${tiles.length} of ${totalScreens} saved: ${rel}/${tiles[0].file} .. ${tiles.at(-1).file} (${tileW}x${tileH})` : 'none (metrics only)'}`);
console.log(`  images    ${images.length}: ${loadedN} loaded, ${images.length - loadedN} not, ${images.filter((i) => i.hidden).length} hidden; light ${lightT.length}`);
console.log(`  checks    overflow ${docOverflow > 1 ? '+' + docOverflow + 'px' + (clippedAtRoot ? ' (cut off at root)' : '') : 'none'} · text<12px ${smallTotal} · console errors ${consoleCount} · failed requests ${failedReqs.length + badStatus.size}${noJs ? ` · hidden text ${hiddenText.total} (+${hiddenText.exemptByDesign} by design${hiddenText.createdByScript.total ? `, ${hiddenText.createdByScript.total} script-made` : ''})` : ''}`);
for (const [head, ...rest] of fails) { console.log(`  FAIL  ${head}`); rest.forEach((r) => console.log(r)); }
for (const [head, ...rest] of warns) { console.log(`  WARN  ${head}`); rest.forEach((r) => console.log(r)); }
console.log(`${result}  ${rel}/metrics.json`);
process.stdout.write('', () => process.exit(fails.length ? 1 : 0)); // flush first: a pipe must never lose the summary
