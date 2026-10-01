#!/usr/bin/env node
/**
 * verify-redesign.mjs — the objective judge for Redesign 2.0.
 *
 * Compares the built site (dist/) with production (git branch `main`, whose pages are
 * pass-through HTML in src/pages/*.html) and with the keyword plan build-tools/seo-targets.json.
 * Copy, titles, descriptions and H1s may change — but only as the plan declares. Everything else
 * search engines and users rely on stays as it is on main. Indifferent to markup, class names and
 * section order. Long pages may be split: copy may move and new pages may appear.
 *
 *   node build-tools/verify-redesign.mjs [--base main] [--dist dist] [--targets <file>] [--page <slug>] [--json]
 *
 * Exit 0 = no FAIL (WARNs allowed) · 1 = at least one FAIL · 2 = bad usage / environment.
 * <slug> = file name in src/pages (index, 404, artist-booking, ...) or a new page's path (about, work/shows).
 * --targets defaults to build-tools/seo-targets.json. If that file is missing the judge says so and runs
 * everything except PLAN and FACTS. Zero new dependencies: HTML is parsed with `parse5` (ships with astro).
 *
 * seo-targets.json:  { "site": "https://www.theshowcompany.in",
 *                      "facts": { "required": ["+91 70602 93132", "500+"] },
 *                      "pages": { "/": { "title", "description", "h1", "primary", "secondary": [], "protected": [], "minWords" },
 *                                 "/about/": { ... new pages are listed too } } }
 *
 * STRICT, per existing URL (FAIL)
 *    1 route         the built file exists (dist/index.html, dist/<slug>/index.html, dist/404.html)
 *    2 head          <html lang>, canonical, robots, og:url, hreflang + verification metas unchanged from main;
 *                    every og:* / twitter:* tag main had is still present and non-empty (its value may change)
 *    2 title/description, 4 h1
 *                    each equals main's value OR the value declared for that URL in the plan; when the plan
 *                    declares a value the page must carry exactly that value. Exactly one <h1>.
 *    9 analytics     the page's GA/GTM ids are unchanged (missing = FAIL, extra = WARN)
 *    7 links         every production URL is linked from at least one other built page
 * PLAN, per URL listed in the plan, existing or new
 *      `primary` (case-insensitive, its words in order, punctuation between is fine) is in the title, h1,
 *      description and the first 150 words of the main content (FAIL); each `protected` term is in the page
 *      text (FAIL); each `secondary` term (WARN); title 30-60 / description 70-160 chars (WARN);
 *      visible words in the main content >= minWords (WARN). Terms only inside hidden elements: WARN.
 * FACTS (FAIL, site-wide) every facts.required string is in the built site's visible text or link hrefs.
 * COPY (INFO only) per page: share of main's text blocks kept here / moved elsewhere / rewritten, words vs main.
 * JSON-LD  every block parses (FAIL). Every @type main had on a URL is still on it (FAIL if not), or moved:
 *      FAQPage to any page; other types to a new page or a page that had none; WebSite, WebPage and
 *      BreadcrumbList must stay on their own URL. FAQPage: each question AND its answer is in the same
 *      page's text (FAIL). Deep equality with main is not required.
 * UNCHANGED  form field names + EmailJS ids (site-wide; ids must sit on the page holding the form) (FAIL),
 *      dead internal links and #anchors (FAIL), assets 10: every local URL resolves case-exact (FAIL),
 *      every production sitemap URL survives (FAIL), contact links gone from the site (WARN),
 *      new-page rules (FAIL), images 11 alt/width/height (WARN), weight 12 (INFO).
 * NEW PAGES (in dist, not on main) FAIL unless: non-empty <title> and description unique across the site,
 *      self-referencing absolute canonical, exactly one h1, og:title + og:description + og:image, an entry
 *      in dist/sitemap.xml, the site's GA ids. WARN: not in the plan, not in llms.txt, orphan, no JSON-LD.
 *
 * Known ceilings (deliberate): text hidden by CSS classes is invisible to this script (only the `hidden`
 * attribute and inline display:none / visibility:hidden are seen); production asset weights come from main:public/.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.theshowcompany.in';
const SITE_HOSTS = new Set(['www.theshowcompany.in', 'theshowcompany.in']);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const USAGE = 'usage: node build-tools/verify-redesign.mjs [--base main] [--dist dist] [--targets build-tools/seo-targets.json] [--page <slug>] [--json]';
const die = (m) => { console.error(`verify-redesign: ${m}`); process.exit(2); };
process.on('uncaughtException', (e) => die(`internal error (exit 2, not a FAIL): ${e?.stack ?? e}`));

// ───────────────────────────── args, git, parser ─────────────────────────────
const opt = { base: 'main', dist: 'dist', targets: '', page: '', json: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const [k, v] = argv[i].split(/=(.*)/s);
  if (k === '-h' || k === '--help') { console.log(USAGE); process.exit(0); }
  else if (k === '--json') opt.json = true;
  else if (['--base', '--dist', '--targets', '--page'].includes(k)) opt[k.slice(2)] = v ?? argv[++i] ?? die(`${k} needs a value`);
  else die(`unknown argument "${argv[i]}"\n${USAGE}`);
}
const DIST = path.resolve(opt.dist);
if (!fs.existsSync(DIST)) die(`dist not found: ${DIST} (run \`npx astro build\` first)`);
const TARGETS = path.resolve(opt.targets || path.join(REPO, 'build-tools', 'seo-targets.json'));

let parse5;
try { parse5 = await import('parse5'); } catch { die('parse5 not found in node_modules (it ships with astro) — run npm install'); }

const git = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const show = (p) => { try { return git('show', `${opt.base}:${p}`); } catch { return null; } };
let srcFiles;
try { srcFiles = git('ls-tree', '--name-only', opt.base, 'src/pages/').toString().split('\n').filter((f) => f.endsWith('.html')); }
catch (e) { die(`cannot read branch "${opt.base}": ${String(e.stderr ?? e.message).trim()}`); }
if (!srcFiles.length) die(`no src/pages/*.html on ${opt.base}`);

const routeOf = (rel) => `/${rel.replace(/(^|\/)index\.html$/, '$1')}`; // 'x/index.html' -> '/x/'
const slugOf = (route) => (route === '/' ? 'index' : route === '/404.html' ? '404' : route.replace(/^\/|\/$/g, ''));
const routeKey = (p) => p.replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1'); // '/x/' and '/x' are one link

// ───────────────────────────── html model + text ─────────────────────────────
const kids = (n) => (n.content ? n.content.childNodes : n.childNodes ?? []);
const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
const rawText = (n) => kids(n).map((c) => c.value ?? '').join('');
function* walk(n) { yield n; for (const c of kids(n)) yield* walk(c); }
function model(html) {
  // scriptingEnabled:false parses <noscript> as real elements, so their links/images are scanned too.
  const all = [...walk(parse5.parse(html, { scriptingEnabled: false }))].filter((n) => n.tagName);
  const by = (...tags) => all.filter((n) => tags.includes(n.tagName));
  return { html, all, by, body: by('body')[0] };
}

const norm = (s) => s.normalize('NFC').replace(/[\u00ad\u200b-\u200d\u2060]/g, '').replace(/\s+/g, ' ').trim(); // drops soft hyphens + zero-width chars
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); // case/punctuation/spacing-blind
const words = (s) => (s ? s.split(' ').length : 0);
const tok = (s) => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; // words; punctuation and case ignored
const hasPhrase = (hay, phrase) => { const p = tok(phrase); for (let i = 0; p.length && i + p.length <= hay.length; i++) if (p.every((w, j) => hay[i + j] === w)) return true; return false; };
const SKIP = new Set('script style template noscript head svg math iframe object canvas select textarea datalist audio video'.split(' '));
const INLINE = new Set('a abbr b bdi bdo cite code data del dfn em font i ins kbd mark q s samp small span strong sub sup time u var wbr'.split(' '));
const BLOCK = new Set('p li td th dd dt blockquote figcaption summary label'.split(' '));
const isHidden = (n) => attr(n, 'hidden') != null || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(n, 'style') ?? '');

/** Visible text of a subtree. Non-inline elements (div, p, br, ...) separate words with a space. */
function flat(root, skipHidden = false, skipFn = null) {
  let s = '';
  const w = (n) => {
    if (n.nodeName === '#text') s += n.value;
    else if (n.tagName && !SKIP.has(n.tagName) && !(skipHidden && isHidden(n)) && !(skipFn && skipFn(n))) {
      const gap = !INLINE.has(n.tagName);
      if (gap) s += ' ';
      kids(n).forEach(w);
      if (gap) s += ' ';
    }
  };
  w(root);
  return norm(s);
}
/** Plain text of an HTML snippet (JSON-LD answers may contain tags / entities). */
const plain = (s) => norm(parse5.parseFragment(String(s ?? '')).childNodes.map((c) => (c.nodeName === '#text' ? c.value : flat(c))).join(' '));
/** Visible text of the main content: <main> if there is one, else the body without nav / footer / aside / site header. */
const isChrome = (n) => n.tagName === 'nav' || n.tagName === 'footer' || n.tagName === 'aside' || (n.tagName === 'header' && ![...walk(n)].some((x) => x.tagName === 'h1'));
function mainText(M) {
  const root = M.by('main')[0] ?? M.all.find((n) => attr(n, 'role') === 'main');
  return root ? flat(root, true) : flat(M.body, true, isChrome);
}

/** 4+ word text runs per BLOCK element. A nested block (li > p) is cut out of its parent's own text. */
function blockTexts(root) {
  const out = [];
  const visit = (el) => {
    let s = '';
    const w = (n) => {
      if (n.nodeName === '#text') s += n.value;
      else if (n.tagName && !SKIP.has(n.tagName)) {
        if (BLOCK.has(n.tagName)) { s += '\u0001'; visit(n); return; }
        const gap = !INLINE.has(n.tagName);
        if (gap) s += ' ';
        kids(n).forEach(w);
        if (gap) s += ' ';
      }
    };
    kids(el).forEach(w);
    out.push(...s.split('\u0001').map(norm));
  };
  const scan = (n) => kids(n).forEach((c) => { if (c.tagName && !SKIP.has(c.tagName)) (BLOCK.has(c.tagName) ? visit(c) : scan(c)); });
  scan(root);
  return [...new Set(out.filter((t) => words(t) >= 4))];
}

// ───────────────────────────── dist file system ─────────────────────────────
const dirCache = new Map();
const ls = (d) => { if (!dirCache.has(d)) { try { dirCache.set(d, fs.readdirSync(d)); } catch { dirCache.set(d, []); } } return dirCache.get(d); };
/** Case-EXACT lookup of a URL pathname in dist (macOS is case-insensitive, Vercel is not). */
function distFile(pathname, asRoute = false) {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch { /* keep raw */ }
  let cur = DIST;
  for (const part of p.split('/').filter(Boolean)) {
    if (!ls(cur).includes(part)) return asRoute && !p.endsWith('.html') && !p.endsWith('/') ? distFile(`${p}.html`) : null;
    cur = path.join(cur, part);
  }
  const st = fs.statSync(cur);
  if (st.isFile()) return cur;
  if (asRoute && st.isDirectory() && ls(cur).includes('index.html')) return path.join(cur, 'index.html');
  return null;
}
const distRead = (p) => { const f = distFile(p); return f ? fs.readFileSync(f) : null; };
const baseRead = (p) => show(`public${p}`);
/** A same-site URL's pathname, or null for external / non-http / pure-fragment references. */
function local(ref, base) {
  const s = (ref ?? '').trim();
  if (!s || s[0] === '#') return null;
  let u; try { u = new URL(s, base); } catch { return null; }
  return /^https?:$/.test(u.protocol) && SITE_HOSTS.has(u.host) ? u.pathname : null;
}
const walkDir = (d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, f)).filter((f) => fs.statSync(f).isFile());
const rel = (f) => path.relative(DIST, f);

// ───────────────────────────── references (assets) ─────────────────────────────
const LINK_RELS = new Set('stylesheet icon apple-touch-icon apple-touch-icon-precomposed preload modulepreload prefetch manifest mask-icon image_src'.split(' '));
const PATHLIKE = /^(\/|\.\.?\/)[^\s"'<>]*\.(avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|mov|woff2?|ttf|otf|json|css|m?js)(\?\S*)?$/i;
const cssUrls = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)]
  .map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).filter((u) => u && !/^(data:|#|%23)/i.test(u.trim()));
function srcsetUrls(v) { // per the HTML spec: URL = run of non-space chars; trailing commas end a candidate
  const out = []; let i = 0;
  while (i < v.length) {
    while (i < v.length && /[\s,]/.test(v[i])) i++;
    let j = i; while (j < v.length && !/\s/.test(v[j])) j++;
    let url = v.slice(i, j);
    if (!url) break;
    if (url.endsWith(',')) { url = url.replace(/,+$/, ''); i = j; } else { const k = v.indexOf(',', j); i = k < 0 ? v.length : k + 1; }
    out.push(url);
  }
  return out;
}
/** Every URL-bearing attribute / style / JSON-LD value of a page: [{url, via}]. */
function refsOf(M) {
  const out = []; const add = (url, via) => { if (url) out.push({ url, via }); };
  for (const n of M.all) {
    const t = n.tagName; const a = (k) => attr(n, k);
    add(a('src'), `${t}[src]`);
    srcsetUrls(a('srcset') ?? '').forEach((u) => add(u, `${t}[srcset]`));
    srcsetUrls(a('imagesrcset') ?? '').forEach((u) => add(u, `${t}[imagesrcset]`));
    add(a('poster'), `${t}[poster]`);
    if (t === 'object') add(a('data'), 'object[data]');
    if (t === 'link' && (a('rel') ?? '').toLowerCase().split(/\s+/).some((r) => LINK_RELS.has(r))) add(a('href'), `link[${a('rel')}]`);
    if (t === 'image' || t === 'use') add(a('href'), `${t}[href]`);
    if (t === 'meta' && /^(og:(image|video|audio)(:(url|secure_url))?|twitter:image(:src)?)$/i.test(a('property') ?? a('name') ?? '')) add(a('content'), `meta[${a('property') ?? a('name')}]`);
    cssUrls(a('style') ?? '').forEach((u) => add(u, `${t}[style]`));
    if (t === 'style') cssUrls(rawText(n)).forEach((u) => add(u, 'style'));
    for (const at of n.attrs) if (/^data-/.test(at.name) && PATHLIKE.test(at.value)) add(at.value, `${t}[${at.name}]`);
  }
  const walkLd = (v) => (typeof v === 'string' ? (/^https?:\/\/\S+\.(avif|webp|png|jpe?g|gif|svg|ico)$/i.test(v) && add(v, 'json-ld')) : v && typeof v === 'object' && Object.values(v).forEach(walkLd));
  ldEntities(M).forEach(walkLd);
  return out;
}

// ───────────────────────────── json-ld ─────────────────────────────
const withCtx = (v, c) => (c && v && typeof v === 'object' && !v['@context'] ? { '@context': c, ...v } : v);
function flattenLd(v, ctx) { // entities, whether shipped as one block each, an array, or one @graph
  if (Array.isArray(v)) return v.flatMap((x) => flattenLd(x, ctx));
  if (v && Array.isArray(v['@graph'])) {
    const { '@graph': g, '@context': c, ...rest } = v;
    return [...(Object.keys(rest).length ? [withCtx(rest, c ?? ctx)] : []), ...flattenLd(g, c ?? ctx)];
  }
  return [withCtx(v, ctx)];
}
function ldEntities(M) {
  const out = [];
  for (const s of M.by('script')) {
    if (!/^application\/ld\+json/i.test(attr(s, 'type') ?? '')) continue;
    try { out.push(...flattenLd(JSON.parse(rawText(s)))); } catch { out.push({ '#invalid-json': norm(rawText(s)) }); }
  }
  return out;
}
const typeName = (t) => String(t).replace(/^.*[/#:]/, ''); // https://schema.org/Service -> Service
const typesOf = (ld) => new Set(ld.flatMap((e) => [].concat(e['@type'] ?? []).map(typeName)));
const isFaq = (e) => [].concat(e?.['@type'] ?? []).map(typeName).includes('FAQPage');
const questions = (e) => [].concat(e.mainEntity ?? []);
const PINNED = new Set(['WebSite', 'WebPage', 'BreadcrumbList']); // describe the page itself: they cannot move
const SUBTYPES = { WebPage: ['AboutPage', 'CollectionPage', 'ContactPage', 'ItemPage', 'ProfilePage', 'SearchResultsPage', 'CheckoutPage', 'QAPage', 'MedicalWebPage'] }; // a more specific type still counts
const hasType = (p, t) => p.types.has(t) || (SUBTYPES[t] ?? []).some((x) => p.types.has(x));

// ───────────────────────────── head, links, forms, tokens, weight ─────────────────────────────
const EXACT_META = /^(robots|googlebot|bingbot|googlebot-news|og:url|.*verif.*|msvalidate\.01|p:domain_verify)$/; // must equal main
const FREE_META = /^(og:.*|twitter:.*|article:.*|fb:.*)$/; // must stay present + non-empty, value may change
function headFacts(M) {
  const exact = {}; const free = {}; const soft = {}; const title = []; const desc = [];
  const put = (o, k, v) => { (o[k] ??= []).push(norm(String(v ?? ''))); };
  const html = M.by('html')[0];
  if (html) put(exact, 'html[lang]', attr(html, 'lang'));
  for (const t of M.by('title')) if (t.parentNode?.tagName === 'head') title.push(flat(t));
  for (const m of M.by('meta')) {
    const key = (attr(m, 'name') ?? attr(m, 'property') ?? attr(m, 'http-equiv') ?? (attr(m, 'charset') != null ? 'charset' : '')).toLowerCase();
    if (!key) continue;
    let v = attr(m, 'content') ?? attr(m, 'charset') ?? '';
    if (/^(robots|googlebot|bingbot|googlebot-news)$/.test(key)) v = v.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean).sort().join(', ');
    if (key === 'charset') v = v.toLowerCase();
    if (key === 'description') desc.push(norm(v));
    else put(EXACT_META.test(key) ? exact : FREE_META.test(key) ? free : soft, `meta[${key}]`, v);
  }
  for (const l of M.by('link')) {
    const rels = (attr(l, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (rels.includes('canonical')) put(exact, 'canonical', attr(l, 'href'));
    if (rels.includes('alternate') && attr(l, 'hreflang')) put(exact, `hreflang[${attr(l, 'hreflang').toLowerCase()}]`, attr(l, 'href'));
  }
  return { exact, free, soft, title, desc };
}
const show1 = (l) => (l.length ? l.map((x) => JSON.stringify(x.length > 170 ? `${x.slice(0, 170)}…` : x)).join(' | ') : '(absent)');
function diffMaps(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => {
    const x = [...(a[k] ?? [])].sort(); const y = [...(b[k] ?? [])].sort();
    return JSON.stringify(x) === JSON.stringify(y) ? [] : [`${k}\nmain: ${show1(x)}\nnew:  ${show1(y)}`];
  });
}

const CONTACT = /^(tel|mailto|sms|whatsapp):$/;
function linkFacts(M, pageUrl) {
  const f = { internal: new Set(), contact: new Set(), anchors: [] };
  for (const a of M.by('a', 'area')) {
    const href = attr(a, 'href')?.trim();
    let u; try { u = href ? new URL(href, pageUrl) : null; } catch { u = null; }
    if (!u) continue;
    if (CONTACT.test(u.protocol)) f.contact.add(`${u.protocol}${decodeURIComponent(u.pathname || u.searchParams.get('phone') || '').toLowerCase().replace(/[\s().-]/g, '')}`);
    else if (!/^https?:$/.test(u.protocol)) continue;
    else if (SITE_HOSTS.has(u.host)) {
      f.internal.add(routeKey(u.pathname));
      const id = decodeURIComponent(u.hash.slice(1));
      if (id && id !== 'top') f.anchors.push({ path: u.pathname, id, href });
    } else if (/^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)$/.test(u.host)) f.contact.add(`whatsapp:${u.host === 'wa.me' ? u.pathname.slice(1) : u.searchParams.get('phone') ?? u.pathname}`);
  }
  return f;
}
const idCache = new Map();
const idsOf = (file) => { if (!idCache.has(file)) idCache.set(file, new Set(model(fs.readFileSync(file, 'utf8')).all.flatMap((n) => [attr(n, 'id'), n.tagName === 'a' ? attr(n, 'name') : null]).filter(Boolean))); return idCache.get(file); };

const FIELD = new Set(['input', 'select', 'textarea', 'button']);
const namesIn = (root) => new Set([...walk(root)].filter((n) => FIELD.has(n.tagName)).map((n) => attr(n, 'name')).filter(Boolean));
const formsOf = (M) => M.by('form').map((f) => ({ sig: `id=${attr(f, 'id') ?? ''} action=${attr(f, 'action') ?? ''} method=${(attr(f, 'method') ?? '').toLowerCase()}`, names: namesIn(f) }));

const TOKEN_RES = [/\bG-[A-Z0-9]{6,}\b/g, /\bGTM-[A-Z0-9]{4,}\b/g, /\bUA-\d{4,}-\d+\b/g, /\bAW-\d{6,}\b/g, /\bservice_[A-Za-z0-9]{5,}\b/g, /\btemplate_[A-Za-z0-9]{5,}\b/g];
const isGA = (t) => /^(G|GTM|UA|AW)-/.test(t);
function tokens(corpus) {
  const t = new Set();
  for (const re of TOKEN_RES) for (const m of corpus.matchAll(re)) t.add(m[0]);
  for (const m of corpus.matchAll(/emailjs\.init\(\s*['"]([^'"]+)['"]/g)) t.add(`EmailJS public key ${m[1]}`);
  if (/emailjs/i.test(corpus)) t.add('EmailJS SDK reference');
  return t;
}

/** Local scripts/styles a page loads (+ static imports of those scripts): {css:[buf], js:[buf], ext:{css,js}}. */
function loaded(M, pageUrl, read) {
  const css = []; const js = []; const ext = { css: 0, js: 0 }; const seen = new Set(); const queue = [];
  const take = (ref, kind) => {
    const p = local(ref, pageUrl);
    if (p === null) { if (/^(https?:)?\/\//i.test(ref.trim())) ext[kind]++; return; }
    if (seen.has(p)) return; seen.add(p);
    const b = read(p);
    if (b) (kind === 'css' ? css : js).push(b);
    if (b && kind === 'js') queue.push([p, b]);
  };
  for (const n of M.all) {
    const rels = (attr(n, 'rel') ?? '').toLowerCase().split(/\s+/); const href = attr(n, 'href'); const src = attr(n, 'src');
    if (n.tagName === 'style') css.push(Buffer.from(rawText(n)));
    else if (n.tagName === 'link' && href && (rels.includes('stylesheet') || (rels.includes('preload') && attr(n, 'as') === 'style'))) take(href, 'css');
    else if (n.tagName === 'link' && href && (rels.includes('modulepreload') || (rels.includes('preload') && attr(n, 'as') === 'script'))) take(href, 'js');
    else if (n.tagName === 'script' && !/json/i.test(attr(n, 'type') ?? '')) { if (src) take(src, 'js'); else js.push(Buffer.from(rawText(n))); }
  }
  while (queue.length) { // static + dynamic imports between bundled chunks
    const [p, b] = queue.pop();
    for (const m of b.toString('utf8').matchAll(/(?:from|import)\s*\(?\s*["']((?:\.{1,2}\/|\/)[^"']+\.m?js)["']/g)) take(new URL(m[1], SITE + p).href, 'js');
  }
  return { css, js, ext };
}
const sum = (l) => l.reduce((a, b) => a + b.length, 0);
const gz = (l) => l.reduce((a, b) => a + zlib.gzipSync(b, { level: 9 }).length, 0);
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

/** Everything the checks need to know about one page (production source or built file). */
function facts(M, route, read, bytes) {
  const url = SITE + route; const ld = ldEntities(M); const ldd = loaded(M, url, read); const main = mainText(M);
  return {
    M, route, url, bytes, loaded: ldd,
    text: flat(M.body), vis: flat(M.body, true), main, mainWords: words(main), h1s: M.by('h1').map((n) => flat(n)),
    ld, types: typesOf(ld),
    links: linkFacts(M, url), hrefs: M.by('a', 'area').map((n) => attr(n, 'href')).filter(Boolean),
    fields: namesIn(M.body), forms: formsOf(M), head: headFacts(M),
    tokens: tokens(`${M.html.replace(/<!--[\s\S]*?-->/g, '')}\n${ldd.js.map(String).join('\n')}`),
  };
}

// ───────────────────────────── the plan: build-tools/seo-targets.json ─────────────────────────────
const planRoute = (k) => {
  let p = String(k).trim(); if (p.startsWith(SITE)) p = p.slice(SITE.length);
  p = p.split(/[?#]/)[0];
  return !p.startsWith('/') ? null : /\.html$/.test(p) || p.endsWith('/') ? p : `${p}/`;
};
function loadPlan(file) {
  const plan = { found: fs.existsSync(file), file, problems: [], warnings: [], facts: [], pages: new Map() };
  if (!plan.found) return plan;
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`${file} is not valid JSON: ${e.message}`); }
  const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const str = (x) => typeof x === 'string' && x.trim() !== '';
  const strs = (x) => Array.isArray(x) && x.every(str);
  if (!obj(raw)) { plan.problems.push('the top level must be an object'); return plan; }
  Object.keys(raw).filter((k) => !['site', 'facts', 'pages'].includes(k)).forEach((k) => plan.warnings.push(`unknown top-level key "${k}" (ignored)`));
  if (raw.site !== undefined && String(raw.site).replace(/\/+$/, '') !== SITE) plan.problems.push(`"site" must be "${SITE}" (found ${JSON.stringify(raw.site)})`);
  if (raw.facts !== undefined) {
    if (!obj(raw.facts) || (raw.facts.required !== undefined && !strs(raw.facts.required))) plan.problems.push('"facts.required" must be an array of non-empty strings');
    else { plan.facts = raw.facts.required ?? []; Object.keys(raw.facts).filter((k) => k !== 'required').forEach((k) => plan.warnings.push(`unknown key "facts.${k}" (ignored)`)); }
  }
  if (!obj(raw.pages)) { plan.problems.push('"pages" must be an object keyed by URL path, e.g. "/about/"'); return plan; }
  for (const [k, d] of Object.entries(raw.pages)) {
    const route = planRoute(k);
    if (!route) { plan.problems.push(`pages key ${JSON.stringify(k)} must be a URL path starting with "/"`); continue; }
    if (!obj(d)) { plan.problems.push(`pages["${k}"] must be an object`); continue; }
    const clean = {};
    for (const f of Object.keys(d)) {
      const ok = ['title', 'description', 'h1', 'primary'].includes(f) ? str(d[f]) : ['secondary', 'protected'].includes(f) ? strs(d[f]) : f === 'minWords' ? Number.isInteger(d[f]) && d[f] > 0 : null;
      if (ok === null) plan.warnings.push(`pages["${k}"]: unknown key "${f}" (ignored)`);
      else if (!ok) plan.problems.push(`pages["${k}"].${f} has the wrong type (${f === 'minWords' ? 'positive integer' : ['secondary', 'protected'].includes(f) ? 'array of non-empty strings' : 'non-empty string'})`);
      else clean[f] = d[f];
    }
    if (clean.primary !== undefined && !tok(clean.primary).length) { plan.problems.push(`pages["${k}"].primary has no words`); delete clean.primary; }
    plan.pages.set(route, clean);
  }
  return plan;
}
const PLAN = loadPlan(TARGETS);
const declOf = (route) => PLAN.pages.get(route);

// ───────────────────────────── site model ─────────────────────────────
const BASE = srcFiles.map((src) => {
  const slug = path.basename(src, '.html');
  const built = slug === 'index' ? 'index.html' : slug === '404' ? '404.html' : `${slug}/index.html`;
  const buf = show(src); const route = routeOf(built);
  const B = buf ? facts(model(buf.toString('utf8')), route, baseRead, buf.length) : null;
  return { slug, src, built, route, B, blocks: B ? blockTexts(B.M.body) : [] };
});
const BASE_ROUTES = new Set(BASE.map((b) => b.route));
const BASE_BY_ROUTE = new Map(BASE.map((b) => [b.route, b]));
const BUILT = new Map(); // route -> facts of every built html page
for (const f of walkDir(DIST)) {
  if (!f.endsWith('.html') || fs.existsSync(path.join(REPO, 'public', rel(f)))) continue; // public/*.html is a static file, not a page
  const route = routeOf(rel(f));
  BUILT.set(route, { file: f, rel: rel(f), ...facts(model(fs.readFileSync(f, 'utf8')), route, distRead, fs.statSync(f).size) });
}
const NEW_PAGES = [...BUILT.values()].filter((p) => !BASE_ROUTES.has(p.route));
const others = (np) => [...BUILT.values()].filter((p) => p !== np && p.route !== '/404.html');

let selBase = BASE; let selNew = NEW_PAGES;
if (opt.page) {
  const want = opt.page.replace(/^\/+|\/+$|\.html$/g, '') || 'index';
  selBase = BASE.filter((b) => b.slug === want); selNew = NEW_PAGES.filter((p) => slugOf(p.route) === want);
  if (!selBase.length && !selNew.length) die(`unknown page "${opt.page}"; known: ${[...BASE.map((b) => b.slug), ...NEW_PAGES.map((p) => slugOf(p.route))].join(', ')}`);
}

// ───────────────────────────── results ─────────────────────────────
const R = []; const TITLES = new Map();
const NUM = { route: 1, head: 2, title: 2, description: 2, jsonld: 3, h1: 4, copy: 6, links: 7, forms: 8, analytics: 9, pipeline: 9, assets: 10, images: 11, weight: 12 };
const reporter = (page, title) => { TITLES.set(page, title); return (id, status, msg, details = [], data) => R.push({ page, id, n: NUM[id] ?? null, status, msg, details, ...(data ? { data } : {}) }); };
const q = (t, n = 110) => `"${t.length > n ? `${t.slice(0, n)}…` : t}"`;
const movedLines = (moved, f = (x) => q(x)) => moved.map(({ it, to }) => `MOVED -> ${to.slice(0, 4).join(', ')}${to.length > 4 ? ', …' : ''}   ${f(it)}`);
/** Split `items` into kept (on np), moved (only on other pages) and lost (nowhere); has(page, item). */
function place(items, np, has) {
  const kept = []; const moved = []; const lost = []; const pool = others(np);
  for (const it of items) {
    if (has(np, it)) kept.push(it);
    else { const to = pool.filter((p) => has(p, it)).map((p) => p.route); if (to.length) moved.push({ it, to }); else lost.push(it); }
  }
  return { kept, moved, lost };
}
/** title / description / h1: equals main's value OR the value the plan declares (declared => must equal it). mv=null: new page. */
function declared(out, id, label, nv, mv, decl) {
  if (mv === null && decl === undefined) return;
  const want = decl !== undefined ? [norm(decl)] : mv;
  if (nv.length === want.length && nv.every((v, i) => v === want[i])) return out(id, 'PASS', decl !== undefined ? `${label} equals the value declared in seo-targets.json` : `${label} unchanged from main`);
  out(id, 'FAIL', decl !== undefined ? `${label} differs from the value declared in seo-targets.json` : `${label} changed, and seo-targets.json declares no new value for this URL`,
    [[mv ? `main: ${show1(mv)}` : null, `new:  ${show1(nv)}`, decl !== undefined ? `plan: ${JSON.stringify(norm(decl))}` : null].filter(Boolean).join('\n')]);
}

const baseNames = new Set(BASE.flatMap((b) => [...(b.B?.fields ?? [])]));
const formPages = [...BUILT.values()].filter((p) => p.forms.some((f) => [...f.names].filter((n) => baseNames.has(n)).length >= 2));
const commonGA = BASE.filter((b) => b.B).map((b) => new Set([...b.B.tokens].filter(isGA))).reduce((a, s) => new Set([...a].filter((t) => s.has(t))));

// ───────────────────────────── checks on production URLs ─────────────────────────────
function strictChecks(bp, np, out) {
  const d = declOf(bp.route) ?? {}; const hb = bp.B.head; const hn = np.head;
  const bad = [...diffMaps(hb.exact, hn.exact), ...Object.keys(hb.free).filter((k) => !(hn.free[k] ?? []).some(Boolean)).map((k) => `${k}\nmain: present\nnew:  missing or empty (the value may change, the tag must stay)`)];
  out('head', bad.length ? 'FAIL' : 'PASS', bad.length ? `${bad.length} problem(s)` : `${Object.keys(hb.exact).length} fields unchanged (lang, canonical, robots, og:url...), ${Object.keys(hb.free).length} og:/twitter: tags present`, bad);
  const hs = diffMaps(hb.soft, hn.soft);
  if (hs.length) out('head', 'WARN', `${hs.length} other <meta> difference(s) (viewport, theme-color, geo.*, charset...)`, hs);
  declared(out, 'title', '<title>', hn.title, hb.title, d.title);
  declared(out, 'description', 'meta description', hn.desc, hb.desc, d.description);
  if (np.h1s.length !== 1) out('h1', 'FAIL', `${np.h1s.length} <h1> elements (need exactly 1)`, np.h1s.map((t) => `"${t}"`));
  else declared(out, 'h1', `h1 "${np.h1s[0]}"`, np.h1s, bp.B.h1s.slice(0, 1), d.h1);
  if (bp.B.h1s.length !== 1) out('h1', 'WARN', `production itself has ${bp.B.h1s.length} <h1> elements`);

  const ga = [...bp.B.tokens].filter(isGA); const noGa = ga.filter((t) => !np.tokens.has(t)); const moreGa = [...np.tokens].filter((t) => isGA(t) && !bp.B.tokens.has(t));
  out('analytics', noGa.length ? 'FAIL' : 'PASS', ga.length ? `${ga.length - noGa.length}/${ga.length} analytics ids unchanged (${ga.join(', ')})` : 'no analytics ids in production', noGa.map((x) => `missing: ${x}`));
  if (moreGa.length) out('analytics', 'WARN', 'analytics id(s) that production does not have', moreGa);
}

function siteChecks(bp, np, out) {
  const pool = others(np);

  // JSON-LD: every @type main had here is still here (or moved, where that is allowed)
  const kept = []; const moved = []; const lost = [];
  for (const t of [...bp.B.types].sort()) {
    if (hasType(np, t)) { kept.push(t); continue; }
    const have = pool.filter((p) => hasType(p, t));
    const fresh = have.filter((p) => !BASE_BY_ROUTE.get(p.route)?.B.types.has(t)); // a new page, or a page that had none on main
    const to = t === 'FAQPage' ? have : PINNED.has(t) ? [] : fresh;
    if (to.length) moved.push({ it: t, to: to.map((p) => p.route) });
    else lost.push(`@type ${t} is gone from this page${PINNED.has(t) ? ' (WebSite, WebPage and BreadcrumbList must stay on their own URL)' : have.length ? ` (other pages carry their own ${t}; it may move only to a new page or to a page that had none)` : ' and is on no other page'}`);
  }
  out('jsonld', lost.length ? 'FAIL' : 'PASS', `${bp.B.types.size} @types on main: ${kept.length} still here, ${moved.length} moved, ${lost.length} gone (${[...bp.B.types].sort().join(', ') || 'none'})`, [...lost, ...movedLines(moved, (t) => `@type ${t}`)]);

  // reachability: every production URL is linked from another built page
  if (bp.route !== '/404.html') {
    const by = pool.filter((p) => p.links.internal.has(routeKey(bp.route)));
    out('links', by.length ? 'PASS' : 'FAIL', by.length ? `linked from ${by.length} other built page(s)` : 'no other built page links to this URL (it is unreachable)', by.length ? [] : [`link ${bp.route} from the navigation or another page`]);
  }
  const lc = place([...bp.B.links.contact].sort(), np, (p, k) => p.links.contact.has(k));
  if (lc.lost.length) out('links', 'WARN', `${lc.lost.length} production contact link(s) are on no built page`, lc.lost.map((k) => `contact link gone: ${k}`));

  // forms: field names site-wide; form structure (JS binds forms by id) as WARN
  const fp = place([...bp.B.fields].sort(), np, (p, n) => p.fields.has(n));
  out('forms', fp.lost.length ? 'FAIL' : 'PASS', `${bp.B.fields.size} production field names: ${fp.kept.length} kept, ${fp.moved.length} moved, ${fp.lost.length} missing`,
    [...fp.lost.map((x) => `field name is on no page: ${x}`), ...movedLines(fp.moved, (n) => `field name: ${n}`)]);
  const sp = place(bp.B.forms.map((f) => f.sig), np, (p, s) => p.forms.some((f) => f.sig === s));
  if (sp.lost.length) out('forms', 'WARN', 'production form structure not found on any page (JS binds forms by id; check the submit handler)', sp.lost.map((s) => `form: ${s}`));

  // pipeline: the EmailJS ids/SDK must ride along with the enquiry form
  const pipe = [...bp.B.tokens].filter((t) => !isGA(t)).sort();
  if (pipe.length) {
    const dead = formPages.length ? formPages.flatMap((p) => pipe.filter((t) => !p.tokens.has(t)).map((t) => `${p.route}: missing ${t}`)) : pipe.filter((t) => ![...BUILT.values()].some((p) => p.tokens.has(t))).map((t) => `missing from every page: ${t}`);
    out('pipeline', dead.length ? 'FAIL' : 'PASS', formPages.length ? `form pipeline (${pipe.length} tokens) present on every page holding the enquiry form: ${formPages.map((p) => p.route).join(', ')}` : `no page holds the enquiry form; ${pipe.length} pipeline tokens checked site-wide`, dead);
  }

  // copy (information only): how much of main's text survives, here or elsewhere
  const tp = place(bp.blocks, np, (p, t) => p.text.includes(t)); const total = bp.blocks.length;
  const pct = (n) => (total ? Math.round((100 * n) / total) : 100);
  out('copy', 'INFO', `retained ${pct(tp.kept.length + tp.moved.length)}% of main's ${total} text blocks (${tp.kept.length} here, ${tp.moved.length} moved, ${tp.lost.length} rewritten or removed) · ${np.mainWords} words in main content (main: ${bp.B.mainWords})`,
    movedLines(tp.moved), { total, kept: tp.kept.length, moved: tp.moved.length, rewritten: tp.lost.length, words: np.mainWords, mainWords: bp.B.mainWords, movedBlocks: tp.moved.map(({ it, to }) => ({ text: it, to })) });
}

// ───────────────────────────── plan checks (any URL listed in seo-targets.json) ─────────────────────────────
function planChecks(np, d, out) {
  const fails = []; const warns = []; const [title, desc, h1] = [np.head.title[0] ?? '', np.head.desc[0] ?? '', np.h1s[0] ?? ''];
  const first150 = np.main.split(' ').slice(0, 150).join(' ');
  if (d.primary) {
    for (const [where, v] of [['title', title], ['h1', h1], ['meta description', desc], ['first 150 words of the main content', first150]]) {
      if (!hasPhrase(tok(v), d.primary)) fails.push(`primary "${d.primary}" is missing from the ${where}${v && where !== 'first 150 words of the main content' ? `: ${q(v, 90)}` : ''}`);
    }
  }
  const all = tok(np.text); const vis = tok(np.vis);
  for (const t of d.protected ?? []) { if (!hasPhrase(all, t)) fails.push(`protected term missing from the page text: "${t}"`); else if (!hasPhrase(vis, t)) warns.push(`protected term only inside hidden elements: "${t}"`); }
  for (const t of d.secondary ?? []) { if (!hasPhrase(all, t)) warns.push(`secondary term not on the page: "${t}"`); else if (!hasPhrase(vis, t)) warns.push(`secondary term only inside hidden elements: "${t}"`); }
  const len = (s) => [...s].length;
  if (title && (len(title) < 30 || len(title) > 60)) warns.push(`title is ${len(title)} characters (aim for 30-60)`);
  if (desc && (len(desc) < 70 || len(desc) > 160)) warns.push(`description is ${len(desc)} characters (aim for 70-160)`);
  if (d.minWords && np.mainWords < d.minWords) warns.push(`${np.mainWords} visible words in the main content; the plan wants at least ${d.minWords}`);
  const n = (d.primary ? 4 : 0) + (d.protected?.length ?? 0);
  out('plan', fails.length ? 'FAIL' : 'PASS', fails.length ? `${fails.length} keyword-plan problem(s)` : n ? `keyword plan met (${n} required placements${d.secondary?.length ? `, ${d.secondary.length} secondary terms checked` : ''})` : 'no primary or protected terms declared for this URL', fails);
  if (warns.length) out('plan', 'WARN', `${warns.length} keyword-plan warning(s)`, warns);
}

// ───────────────────────────── checks on every built page ─────────────────────────────
function commonChecks(np, out, bp) {
  // json-ld: every block parses; FAQPage questions AND answers are in the same page's text
  const inv = np.ld.filter((e) => e['#invalid-json'] != null);
  if (inv.length) out('jsonld', 'FAIL', `${inv.length} JSON-LD block(s) on this page do not parse`, inv.map((e) => e['#invalid-json'].slice(0, 120)));
  const noCtx = np.ld.filter((e) => e['#invalid-json'] == null && !e['@context']);
  if (noCtx.length) out('jsonld', 'WARN', `${noCtx.length} JSON-LD entit${noCtx.length > 1 ? 'ies have' : 'y has'} no @context (search engines ignore it)`, noCtx.map((e) => `@type ${[].concat(e['@type'] ?? '?').join('/')}`));
  const qs = np.ld.filter(isFaq).flatMap(questions);
  if (qs.length) {
    const L = loose(np.text); const V = loose(np.vis);
    const has = (s, hay) => { const t = loose(plain(s)); return t.length > 0 && hay.includes(t); };
    const noQ = qs.filter((x) => !has(x.name, L)); const noA = qs.filter((x) => !has(x.acceptedAnswer?.text, L));
    const hid = qs.filter((x) => has(x.name, L) && has(x.acceptedAnswer?.text, L) && !(has(x.name, V) && has(x.acceptedAnswer?.text, V)));
    const bad = [...noQ.map((x) => `question is not in the page's text: ${q(plain(x.name), 140)}`), ...noA.map((x) => `answer is missing or not in the page's text: ${q(plain(x.name), 100)}`)];
    out('faq', bad.length ? 'FAIL' : 'PASS', `${qs.length} FAQPage question(s): ${qs.length - new Set([...noQ, ...noA]).size} with question and answer in the page text`, bad);
    if (hid.length) out('faq', 'WARN', `${hid.length} FAQPage item(s) sit inside hidden / display:none elements`, hid.map((x) => q(plain(x.name), 140)));
  }
  // links: no dead routes / anchors
  const dead = [...np.links.internal].filter((p) => !distFile(p, true)).sort();
  const noId = [...new Map(np.links.anchors.filter((a) => { const f = distFile(a.path, true); return f && !idsOf(f).has(a.id); }).map((a) => [a.href, a])).values()];
  const bad = [...dead.map((p) => `dead internal link (no such route in dist): ${p}`), ...noId.map((a) => `anchor target missing: ${a.href} (no id="${a.id}" on ${a.path})`)];
  out('links', bad.length ? 'FAIL' : 'PASS', bad.length ? `${bad.length} broken internal link(s)/anchor(s)` : 'no dead internal links or #anchors', bad);
  // images
  const imgInfo = (M) => { const im = M.by('img'); const w = (f) => im.filter(f).map((n) => attr(n, 'src') ?? '(no src)'); return { n: im.length, alt: w((n) => attr(n, 'alt') == null), wh: w((n) => attr(n, 'width') == null || attr(n, 'height') == null) }; };
  const inn = imgInfo(np.M); const ib = bp ? imgInfo(bp.B.M) : null;
  const imgBad = [...inn.alt.map((s) => `no alt: ${s}`), ...inn.wh.map((s) => `no width/height (layout shift): ${s}`)];
  out('images', imgBad.length ? 'WARN' : 'PASS', `${inn.n} <img>: ${inn.alt.length} without alt, ${inn.wh.length} without width+height${ib ? ` (production: ${ib.n} img, ${ib.alt.length}, ${ib.wh.length})` : ''}`, imgBad);
  // weight
  const wt = (p) => ({ html: p.bytes, css: sum(p.loaded.css), js: sum(p.loaded.js), gz: { html: zlib.gzipSync(Buffer.from(p.M.html)).length, css: gz(p.loaded.css), js: gz(p.loaded.js) }, ext: p.loaded.ext });
  const fmt = (w) => `html ${kb(w.html)} (gz ${kb(w.gz.html)}) · css ${kb(w.css)} (gz ${kb(w.gz.css)}) · js ${kb(w.js)} (gz ${kb(w.gz.js)}) · external css/js refs ${w.ext.css}/${w.ext.js}`;
  out('weight', 'INFO', fmt(wt(np)), bp ? [`production: ${fmt(wt(bp.B))}`] : [], { new: wt(np), ...(bp ? { base: wt(bp.B) } : {}) });
}

// ───────────────────────────── sitemap + new pages ─────────────────────────────
const locs = (xml) => new Set([...(xml ?? '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
const distSitemapFile = distFile('/sitemap.xml');
const distMap = locs(distSitemapFile ? fs.readFileSync(distSitemapFile, 'utf8') : '');
const baseMap = locs(show('public/sitemap.xml')?.toString());
const llms = distFile('/llms.txt') ? fs.readFileSync(distFile('/llms.txt'), 'utf8') : '';

function newPageChecks(np, out) {
  const h = np.head; const d = declOf(np.route); const bad = [];
  const dup = (k) => [...BUILT.values()].filter((p) => p !== np && (p.head[k][0] ?? '') === (h[k][0] ?? '')).map((p) => p.route);
  const [title, desc] = [h.title[0] ?? '', h.desc[0] ?? ''];
  if (!title) bad.push('empty or missing <title>'); else if (dup('title').length) bad.push(`<title> is not unique (same as ${dup('title').join(', ')})`);
  if (!desc) bad.push('empty or missing meta description'); else if (dup('desc').length) bad.push(`meta description is not unique (same as ${dup('desc').join(', ')})`);
  const canon = h.exact.canonical ?? [];
  if (canon.length !== 1 || canon[0] !== np.url) bad.push(`canonical must be exactly one self-referencing absolute URL ${np.url} (found: ${canon.join(' | ') || 'none'})`);
  if (np.h1s.length !== 1 || !np.h1s[0]) bad.push(`needs exactly one non-empty <h1> (found ${np.h1s.length})`);
  for (const k of ['og:title', 'og:description', 'og:image']) if (!(h.free[`meta[${k}]`] ?? []).some(Boolean)) bad.push(`missing ${k}`);
  if (!distMap.has(np.url)) bad.push(`not listed in dist/sitemap.xml (expected <loc>${np.url}</loc>)`);
  [...commonGA].filter((t) => !np.tokens.has(t)).forEach((t) => bad.push(`analytics id missing: ${t}`));
  out('newpage', bad.length ? 'FAIL' : 'PASS', bad.length ? `${bad.length} problem(s) on this new page` : 'title, description, canonical, h1, og:*, sitemap entry, analytics all in order', bad);
  if (d) { declared(out, 'title', '<title>', h.title, null, d.title); declared(out, 'description', 'meta description', h.desc, null, d.description); declared(out, 'h1', 'h1', np.h1s, null, d.h1); }
  const warn = [];
  if (PLAN.found && !d) warn.push('not listed in seo-targets.json (no keyword plan for it)');
  if (!llms.includes(np.url) && !llms.includes(np.route)) warn.push('not mentioned in dist/llms.txt');
  if (!others(np).some((p) => p.links.internal.has(routeKey(np.route)))) warn.push('no other page links to it (orphan)');
  if (!np.ld.length) warn.push('no JSON-LD on the page');
  if (warn.length) out('newpage', 'WARN', warn.join('; '));
}

// ───────────────────────────── run ─────────────────────────────
{
  const out = reporter('plan', `seo-targets.json (${path.relative(REPO, PLAN.file).startsWith('..') ? PLAN.file : path.relative(REPO, PLAN.file)})`);
  if (!PLAN.found) out('plan', 'WARN', 'seo-targets.json not found: PLAN and FACTS checks were NOT run; title, description and h1 must equal main', [`looked for ${PLAN.file}`]);
  else {
    out('plan', PLAN.problems.length ? 'FAIL' : 'PASS', PLAN.problems.length ? `${PLAN.problems.length} problem(s) in the plan file` : `${PLAN.pages.size} page(s) planned, ${PLAN.facts.length} required fact(s)`, PLAN.problems);
    if (PLAN.warnings.length) out('plan', 'WARN', `${PLAN.warnings.length} warning(s) about the plan file`, PLAN.warnings);
    const unbuilt = opt.page ? [] : [...PLAN.pages.keys()].filter((r) => !BUILT.has(r) && !BASE_ROUTES.has(r));
    if (unbuilt.length) out('plan', 'FAIL', `${unbuilt.length} planned page(s) are not built`, unbuilt.map((r) => `${r} is in seo-targets.json but dist has no such page`));
  }
}
for (const bp of selBase) {
  const out = reporter(bp.slug, `${bp.slug}  (${bp.src} -> dist/${bp.built})`);
  const np = BUILT.get(bp.route);
  if (!bp.B) { out('route', 'FAIL', `cannot read ${opt.base}:${bp.src}`); continue; }
  if (!np || np.bytes === 0) { out('route', 'FAIL', `missing dist/${bp.built}`); continue; }
  out('route', 'PASS', `dist/${bp.built}`);
  strictChecks(bp, np, out); siteChecks(bp, np, out);
  if (declOf(bp.route)) planChecks(np, declOf(bp.route), out);
  commonChecks(np, out, bp);
}
for (const np of selNew) {
  const out = reporter(slugOf(np.route), `${slugOf(np.route)}  (NEW page -> dist/${np.rel})`);
  out('route', 'PASS', `dist/${np.rel} (not on main)`);
  newPageChecks(np, out);
  if (declOf(np.route)) planChecks(np, declOf(np.route), out);
  out('copy', 'INFO', `${np.mainWords} words in main content`, [], { words: np.mainWords });
  commonChecks(np, out, null);
}
{
  const out = reporter('dist', 'site-wide (facts, sitemap, assets)');
  // facts: every required string is somewhere in the built site's visible text or link hrefs
  if (PLAN.found && !opt.page) {
    const pages = [...BUILT.values()].filter((p) => p.route !== '/404.html');
    const hay = pages.flatMap((p) => [p.text, ...p.hrefs.flatMap((h) => { try { return [h, decodeURIComponent(h)]; } catch { return [h]; } })]).join('\n').toLowerCase();
    const missing = PLAN.facts.filter((f) => !hay.includes(norm(f).toLowerCase()));
    out('facts', missing.length ? 'FAIL' : 'PASS', `${PLAN.facts.length - missing.length}/${PLAN.facts.length} required facts found in the site's text or link hrefs`, missing.map((f) => `fact not on any page: ${JSON.stringify(f)}`));
  }
  // sitemap: every production URL must survive
  const want = opt.page ? [...baseMap].filter((u) => selBase.some((b) => SITE + b.route === u)) : [...baseMap];
  const gone = want.filter((u) => !distMap.has(u));
  out('sitemap', gone.length || (!distSitemapFile && baseMap.size) ? 'FAIL' : 'PASS', distSitemapFile ? `${want.length - gone.length}/${want.length} production sitemap URLs still listed` : 'dist/sitemap.xml missing', gone.map((u) => `sitemap URL gone: ${u}`));
  const stale = opt.page ? [] : [...distMap].filter((u) => { const p = local(u, SITE); return p !== null && !distFile(p, true); });
  if (stale.length) out('sitemap', 'WARN', `${stale.length} sitemap URL(s) point at no built page`, stale);

  // 10 assets: every local URL resolves, case-exact (whole dist, or only the --page)
  const pages = opt.page ? [...selBase.map((b) => BUILT.get(b.route)), ...selNew].filter(Boolean) : [...BUILT.values()];
  const refs = []; const cssFiles = new Set(); const jsFiles = new Set(); const misses = new Set();
  const test = (u, via, from, base) => {
    const p = local(u, base); if (p === null) return;
    refs.push(1);
    if (!distFile(p)) misses.add(`${rel(from)}  ${via}  ${u}`);
  };
  for (const pg of pages) {
    refsOf(pg.M).forEach((r) => test(r.url, r.via, pg.file, pg.url));
    for (const l of pg.M.by('link')) { const p = local(attr(l, 'href'), pg.url); if (p && /css$/i.test(p) && distFile(p)) cssFiles.add(distFile(p)); }
    for (const s of pg.M.by('script')) { const p = local(attr(s, 'src'), pg.url); if (p && distFile(p)) jsFiles.add(distFile(p)); }
  }
  if (!opt.page) walkDir(DIST).forEach((f) => { if (f.endsWith('.css')) cssFiles.add(f); if (/\.m?js$/.test(f)) jsFiles.add(f); });
  for (const f of cssFiles) cssUrls(fs.readFileSync(f, 'utf8')).forEach((u) => test(u, 'css url()', f, SITE + routeOf(rel(f))));
  out('assets', misses.size ? 'FAIL' : 'PASS', `${pages.length} html + ${cssFiles.size} css scanned, ${refs.length} local URLs, ${misses.size} unresolved`, [...misses].sort());
  // JS string literals like "/assets/x.jpg" (advisory: strings can be dead code or API paths)
  const jsMiss = new Set();
  const scanJs = (code, from) => { for (const m of code.matchAll(/["'`](\/[\w\-./%]+\.(?:avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|mov|woff2?|ttf|otf|pdf))["'`]/gi)) if (!distFile(m[1])) jsMiss.add(`${from}  ${m[1]}`); };
  for (const f of jsFiles) scanJs(fs.readFileSync(f, 'utf8'), rel(f));
  for (const pg of pages) for (const s of pg.M.by('script')) if (!attr(s, 'src') && !/json/i.test(attr(s, 'type') ?? '')) scanJs(rawText(s), pg.rel);
  if (jsMiss.size) out('assets', 'WARN', `${jsMiss.size} asset path string(s) inside scripts point at files not in dist`, [...jsMiss].sort());
}

// ───────────────────────────── output ─────────────────────────────
const count = (s, page) => R.filter((r) => r.status === s && (!page || r.page === page)).length;
const totals = { fail: count('FAIL'), warn: count('WARN'), pass: count('PASS') };
if (opt.json) {
  console.log(JSON.stringify({ base: opt.base, dist: DIST, targets: { file: PLAN.file, found: PLAN.found }, ok: totals.fail === 0, totals, results: R }, null, 2));
} else {
  const CAP = 150;
  const shown = path.relative(process.cwd(), DIST);
  console.log(`verify-redesign  base=${opt.base}  dist=${!shown ? '.' : shown.startsWith('..') ? DIST : shown}${opt.page ? `  page=${opt.page}` : ''}  (${BASE.length} production pages, ${NEW_PAGES.length} new)`);
  if (!PLAN.found) console.log(`NOTE: ${PLAN.file} not found — PLAN and FACTS checks are NOT run; title, description and h1 must equal main.`);
  for (const page of [...new Set(R.map((r) => r.page))]) {
    console.log(`\n== ${TITLES.get(page)}`);
    for (const r of R.filter((x) => x.page === page)) {
      console.log(`  ${r.status}  ${String(r.n ?? '').padStart(2)} ${r.id.padEnd(11)} ${r.msg}`);
      const cap = r.id === 'copy' ? 25 : CAP; // moved-block listings can be long
      for (const d of r.details.slice(0, cap)) console.log(d.split('\n').map((l, i) => `${i ? '          ' : '       - '}${l}`).join('\n'));
      if (r.details.length > cap) console.log(`       … ${r.details.length - cap} more (use --json for the full list)`);
    }
  }
  const trouble = [...new Set(R.filter((r) => r.status === 'FAIL' || r.status === 'WARN').map((r) => r.page))];
  console.log(`\nRESULT: ${totals.fail ? 'FAIL' : 'PASS'} — ${totals.fail} fail, ${totals.warn} warn, ${totals.pass} pass`);
  for (const pg of trouble) console.log(`  ${pg.padEnd(34)} ${count('FAIL', pg)} FAIL  ${count('WARN', pg)} WARN`);
  const cp = R.filter((r) => r.id === 'copy' && r.data?.total !== undefined);
  if (cp.length) {
    console.log('\nCOPY vs main (information only):');
    for (const r of cp) console.log(`  ${r.page.padEnd(34)} ${r.data.kept}/${r.data.total} blocks kept · ${r.data.moved} moved · ${r.data.rewritten} rewritten or removed · ${r.data.words} words (main ${r.data.mainWords})`);
  }
}
process.exitCode = totals.fail ? 1 : 0;
