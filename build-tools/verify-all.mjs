#!/usr/bin/env node
/**
 * verify-all.mjs — the one-command verification run for Redesign 2.0 (run it before and after a fix round).
 *
 *   node build-tools/verify-all.mjs [--skip-build] [--dist dist] [--base-url URL] [--routes a,b] [--concurrency 6]
 *
 *   1 build    `npx astro build` in the repo (not `npm run build`: its prebuild rewrites the sitemap). --skip-build
 *              reuses --dist as it is. A failed build prints the error and exits 1.
 *   2 judge    `node build-tools/verify-redesign.mjs --dist <dist> --json`; its per-page FAIL and WARN lists are kept.
 *              It runs alongside the captures and only reads dist.
 *   3 serve    `npx astro preview --outDir <dist>` on a free port, awaited with a bounded retry and always stopped at the
 *              end (also on failure or Ctrl-C). With --base-url nothing is started and the given server is never stopped.
 *   4 routes   every <loc> in <dist>/sitemap.xml, plus a path that does not exist, which must answer HTTP 404 with the page
 *              in <dist>/404.html. --routes replaces that list ("/,/about/"); the token `404` adds the not-found probe.
 *   5 capture  per route, build-tools/qa-capture.mjs at 1440x900, at 390x844, and with --no-js at 390x844, --concurrency at
 *              a time, into screenshots/redesign-2.0/qa/verify-<timestamp>/<route>-<desktop|mobile|nojs>/ (`/` is "home",
 *              the not-found probe is "404"; each folder also gets summary.txt, the tool's terminal output). A run that
 *              exits 2 (environment / internal error, e.g. a dev server reloading the page) is retried once and the
 *              report says so; failing twice is a FAIL.
 *   6 report   docs/redesign-2.0/verification/report-<timestamp>.md: one row per route (screens at both sizes next to
 *              production's from docs/redesign-2.0/page-lengths-before.md, images not loaded and dimmed, overflow, console
 *              errors, no-JS hidden text, judge FAIL / WARN), then every FAIL in detail. The raw judge JSON is saved next to
 *              the screenshots (judge.json).
 *
 * Exit 0 = nothing failed (WARNs allowed) · 1 = a FAIL anywhere (build, judge, any capture, the 404 probe, a server that
 * did not start) · 2 = bad usage or environment.
 *
 * The 404 page itself must not fail the run: when `qa-capture.mjs --help` lists --allow-status the probe runs with
 * `--allow-status 404`; either way the runner drops the two FAILs a 404 document always causes in Chromium ("page
 * answered HTTP 404" and the console error for the document itself), so an older qa-capture works too.
 * Zero new dependencies: node built-ins only.
 */
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const USAGE = 'usage: node build-tools/verify-all.mjs [--skip-build] [--dist dist] [--base-url URL] [--routes a,b] [--concurrency 6]';
const die = (m) => { console.error(`verify-all: ${m}`); process.exit(2); };
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const tail = (s, n) => strip(s).trim().split('\n').slice(-n);
const head = (s, n) => strip(s).trim().split('\n').slice(0, n);
const dur = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`);
const show = (p) => { const r = path.relative(REPO, p); return r.startsWith('..') ? p : r || '.'; };

// ─── args ────────────────────────────────────────────────────────────────────────────────────────
let opt;
try {
  opt = parseArgs({ options: {
    'skip-build': { type: 'boolean' }, dist: { type: 'string', default: 'dist' }, 'base-url': { type: 'string' },
    routes: { type: 'string' }, concurrency: { type: 'string', default: '6' }, help: { type: 'boolean', short: 'h' },
  } }).values;
} catch (e) { die(`${e.message}\n${USAGE}`); }
if (opt.help) { console.log(USAGE); process.exit(0); }
const CONC = Number(opt.concurrency);
if (!Number.isInteger(CONC) || CONC < 1 || CONC > 16) die(`--concurrency must be an integer 1..16\n${USAGE}`);
if (opt['base-url'] && !/^https?:\/\/[^/\s]+/i.test(opt['base-url'])) die(`--base-url must start with http:// or https:// (got "${opt['base-url']}")`);
const DIST = path.resolve(opt.dist);
if (!opt['skip-build'] && DIST !== path.join(REPO, 'dist')) die('--dist other than the repo dist/ needs --skip-build (astro builds into dist/)');

const QA = path.join(REPO, 'build-tools/qa-capture.mjs');
const JUDGE = path.join(REPO, 'build-tools/verify-redesign.mjs');
const NOT_FOUND = '/verify-all-not-found/'; // the probe: a path that must not exist
const EXPLICIT = opt.routes === undefined ? null : [...new Set(opt.routes.split(',').filter((r) => r.trim()).map((r) => {
  r = r.trim(); if (r === '404') return NOT_FOUND;
  if (!r.startsWith('/')) r = `/${r}`;
  return /\.[a-z0-9]+$/i.test(r) || r.endsWith('/') ? r : `${r}/`;
}))];
if (EXPLICIT && !EXPLICIT.length) die(`--routes names no route\n${USAGE}`);
const VARIANTS = [
  { name: 'desktop', vp: '1440x900', args: [] },
  { name: 'mobile', vp: '390x844', args: [] },
  { name: 'nojs', vp: '390x844', args: ['--no-js', '--tiles', '3'] },
];
const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
const TS = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const RUN = path.join(REPO, 'screenshots/redesign-2.0/qa', `verify-${TS}`);
const REPORT = path.join(REPO, 'docs/redesign-2.0/verification', `report-${TS}.md`);

const run = (cmd, args) => new Promise((resolve) => {
  const c = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', (x) => (out += x)); c.stderr.on('data', (x) => (err += x));
  c.on('error', (e) => resolve({ code: -1, out, err: err + e.message }));
  c.on('close', (code) => resolve({ code, out, err }));
});

// ─── 1 build ─────────────────────────────────────────────────────────────────────────────────────
if (!opt['skip-build']) {
  console.log('build: npx astro build ...');
  const t = Date.now(), b = await run('npx', ['astro', 'build']);
  if (b.code !== 0) { console.error(tail(b.out + b.err, 60).join('\n')); console.error(`\nverify-all: astro build failed (exit ${b.code})`); process.exit(1); }
  console.log(`build: ok (${dur(Date.now() - t)})`);
}
if (!existsSync(DIST)) die(`dist not found: ${DIST}${opt['skip-build'] && DIST === path.join(REPO, 'dist') ? ' (drop --skip-build to build it)' : ''}`);

// ─── 2 judge (runs alongside the captures; it only reads dist) ──────────────────────────────────
const judgeP = run(process.execPath, [JUDGE, '--dist', DIST, '--json']).then((r) => {
  if (r.code !== 0 && r.code !== 1) return { error: `judge exited ${r.code}: ${head(r.err || r.out, 4).join(' | ')}`, raw: r.out };
  try { return { ...JSON.parse(r.out), raw: r.out }; } catch { return { error: `judge printed no JSON (exit ${r.code}): ${head(r.err, 4).join(' | ')}`, raw: r.out }; }
});

// ─── 3 serve ─────────────────────────────────────────────────────────────────────────────────────
async function waitUp(base, tries, dead = () => false) {
  for (let i = 0; i < tries; i++) {
    if (dead()) return false;
    try { await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) }); return true; } catch { await sleep(500); }
  }
  return false;
}
async function startServer() {
  const port = await new Promise((res, rej) => {
    const s = net.createServer(); s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); });
  });
  // detached = its own process group, so the whole npx -> sh -> node tree can be stopped; only this tree, never another astro process
  const child = spawn('npx', ['astro', 'preview', '--outDir', DIST, '--port', String(port), '--host', '127.0.0.1'], { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = false;
  const keep = (x) => { log = (log + x).slice(-3000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  child.once('exit', () => { exited = true; });
  const kill = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
  const stop = async () => { kill('SIGTERM'); for (let i = 0; i < 30 && !exited; i++) await sleep(100); kill('SIGKILL'); };
  process.on('exit', () => kill('SIGKILL'));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  const base = `http://127.0.0.1:${port}`;
  if (!(await waitUp(base, 40, () => exited))) { await stop(); throw new Error(`astro preview did not answer on ${base}: ${tail(log, 6).join(' | ')}`); }
  return { base, stop };
}

// ─── 4 routes ────────────────────────────────────────────────────────────────────────────────────
function pickRoutes() {
  if (EXPLICIT) return EXPLICIT;
  const f = path.join(DIST, 'sitemap.xml');
  if (!existsSync(f)) throw new Error(`no sitemap: ${f} (pass --routes to name the pages)`);
  const list = [...readFileSync(f, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (!list.length) throw new Error(`${f} has no <loc>`);
  return [...new Set(list), NOT_FOUND];
}
const slug = (r) => (r === NOT_FOUND ? '404' : r === '/' ? 'index' : r.replace(/^\/|\/$/g, '')); // the judge's page key
const label = (r) => (r === NOT_FOUND ? '404' : r === '/' ? 'home' : r.replace(/^\/|\/$/g, '').replace(/[^\w.-]+/g, '-'));
const loose = (s) => String(s).replace(/&[#\w]+;/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// ponytail: the page <title> stands in for "this is the 404 page"; compare bodies if two pages ever share a title
const notFoundFails = (m) => {
  const f = [], file = path.join(DIST, '404.html');
  if (m.httpStatus !== 404) f.push({ head: `the not-found probe answered HTTP ${m.httpStatus || '(none)'}, expected 404`, lines: [] });
  if (!existsSync(file)) { f.push({ head: `${show(file)} is missing: the site has no 404 page`, lines: [] }); return f; }
  const want = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
  if (want && loose(m.page.title) !== loose(want)) f.push({ head: 'the not-found probe did not serve the 404 page', lines: [`served title: "${m.page.title}"`, `${show(file)} title: "${want.trim()}"`] });
  return f;
};

// ─── 5 capture ───────────────────────────────────────────────────────────────────────────────────
/** One run's FAILs: qa-capture's own verdict, minus what a 404 document always causes, details from its terminal output. */
function evaluate(m, stdout, expect404) {
  const blocks = {}; let cur = null; // "  FAIL  <head>" followed by 6-space detail lines
  for (const l of stdout.split('\n')) {
    const h = /^ {2}(FAIL|WARN) {2}(.*)$/.exec(l);
    if (h) cur = h[1] === 'FAIL' ? (blocks[h[2]] = []) : null;
    else if (cur && l.startsWith('      ')) cur.push(l.trim());
    else cur = null;
  }
  // Chromium logs the 404 document itself as a console error ("Failed to load resource ... 404") with the page's own URL
  const own = (e) => expect404 && [m.url, m.finalUrl].includes(e.url) && /\b404\b/.test(e.text);
  const errs = [...m.console.errors.filter((e) => !own(e)).map((e) => e.text + (e.url ? `  <${e.url}>` : '')), ...m.console.uncaught.map((u) => `uncaught: ${u}`)];
  const fails = m.verdict.fail
    .filter((h) => !/^\d+ console error\(s\)$/.test(h) && !(expect404 && /^page answered HTTP 404\b/.test(h))) // old wording, or "...; only 2xx passes (...)"
    .map((head) => ({ head, lines: blocks[head] ?? [] }));
  if (errs.length) fails.push({ head: `${errs.length} console error(s)`, lines: errs.slice(0, 5) });
  return { fails, errs: errs.length };
}
let BASE = (opt['base-url'] ?? '').replace(/\/+$/, ''), allowStatus = false;
async function capture(route, v) { // never throws: one broken run must not abort the others
  const dir = path.join(RUN, `${label(route)}-${v.name}`), probe = route === NOT_FOUND;
  const once = async () => {
    const r = await run(process.execPath, [QA, '--url', BASE + route, '--out', dir, '--viewport', v.vp, ...v.args, ...(probe && allowStatus ? ['--allow-status', '404'] : [])]);
    mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'summary.txt'), strip(r.out + (r.err ? `\n${r.err}` : '')));
    let m = null; try { m = JSON.parse(readFileSync(path.join(dir, 'metrics.json'), 'utf8')); } catch {}
    return { r, m };
  };
  try {
    let { r, m } = await once(), retried = '';
    // exit 2 = environment or internal error, typically a dev server reloading the page mid-run: one retry, and the report says so.
    // A page that really breaks the capture fails twice and is reported as a FAIL.
    if (!m && r.code === 2) { retried = head(r.err || r.out, 1)[0] ?? 'exit 2'; ({ r, m } = await once()); }
    if (!m) return { dir, m, errs: 0, retried, fails: [{ head: `qa-capture did not finish (exit ${r.code})${retried ? ', twice' : ''}`, lines: head(r.err || r.out, 3) }] };
    const { fails, errs } = evaluate(m, r.out, probe);
    if (probe && v.name === 'desktop') fails.push(...notFoundFails(m));
    return { dir, m, errs, retried, fails };
  } catch (e) { return { dir, m: null, errs: 0, retried: '', fails: [{ head: `the runner could not read this capture: ${e.message}`, lines: [] }] }; }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const results = {}; // route -> { desktop, mobile, nojs }
const problems = []; // run-level FAILs: { head, lines }
let routes = [], server = null;
try {
  routes = pickRoutes();
  if (BASE) { if (!(await waitUp(BASE, 10))) throw new Error(`--base-url ${BASE} does not answer`); }
  else { server = await startServer(); BASE = server.base; }
  const help = await run(process.execPath, [QA, '--help']);
  allowStatus = /--allow-status/.test(help.out + help.err);
  mkdirSync(RUN, { recursive: true });
  const tasks = routes.flatMap((r) => VARIANTS.map((v) => ({ r, v })));
  console.log(`capture: ${routes.length} route(s) x ${VARIANTS.length} = ${tasks.length} runs, ${CONC} at a time, ${BASE}${allowStatus ? ' (qa-capture has --allow-status)' : ''}`);
  let done = 0;
  await pool(tasks, CONC, async ({ r, v }) => {
    const x = (results[r] ??= {})[v.name] = await capture(r, v);
    const h = x.m ? `${(x.m.page.heightPx / x.m.viewport.height).toFixed(1)} screens` : 'no metrics';
    console.log(`  [${++done}/${tasks.length}] ${label(r)}-${v.name}  ${x.fails.length ? `FAIL (${x.fails.length})` : 'ok'}  ${h}${x.retried ? `  (retried once after: ${x.retried.slice(0, 90)})` : ''}`);
  });
} catch (e) { problems.push({ head: 'the capture phase did not run to the end', lines: [e.message] }); }
finally { await server?.stop(); }

// ─── judge result ────────────────────────────────────────────────────────────────────────────────
const judge = await judgeP;
if (judge.error) problems.push({ head: 'the judge did not run', lines: [judge.error] });
const byPage = {}; // judge page key -> { FAIL: [], WARN: [] }
for (const x of judge.results ?? []) if (x.status === 'FAIL' || x.status === 'WARN') (byPage[x.page] ??= { FAIL: [], WARN: [] })[x.status].push(x);
mkdirSync(RUN, { recursive: true });
if (judge.raw) writeFileSync(path.join(RUN, 'judge.json'), judge.raw);

// ─── 6 report ────────────────────────────────────────────────────────────────────────────────────
// production's screens, route -> [1440x900, 390x844]: the pixel heights in page-lengths-before.md divided by the viewport height,
// so an identical page prints an identical number (the doc's own one-decimal figures were rounded twice: 5,531 px / 844 prints 6.5)
const prod = {}, VH = VARIANTS.slice(0, 2).map((v) => +v.vp.split('x')[1]);
const PL = path.join(REPO, 'docs/redesign-2.0/page-lengths-before.md');
if (existsSync(PL)) for (const l of readFileSync(PL, 'utf8').split('\n')) {
  const m = /^\|\s*`([^`]+)`[^|]*\|[^|]*?\(([\d,]+) px\)[^|]*\|[^|]*?\(([\d,]+) px\)/.exec(l);
  if (m) prod[m[1]] = [m[2], m[3]].map((px, i) => (+px.replace(/,/g, '') / VH[i]).toFixed(1));
}
const hot = (v) => (typeof v === 'number' && v > 0 ? `**${v}**` : String(v));
const num = (x, f) => (x?.m ? f(x.m, x) : 'n/a');
const screens = (x) => num(x, (m) => (m.page.heightPx / m.viewport.height).toFixed(1));
const broken = (x) => num(x, (m) => m.images.items.filter((i) => !i.loaded && !(i.hidden && !i.url)).length);
const dimmed = (x) => num(x, (m) => m.lightImages.length);
const overflow = (x) => num(x, (m) => (m.page.horizontalOverflowPx > 1 ? m.page.horizontalOverflowPx : 0));
const consoleN = (x) => num(x, (m, r) => r.errs);
const pair = (f, a, b) => `${hot(f(a))} / ${hot(f(b))}`;
const jn = (page, s) => (judge.results ? byPage[page]?.[s].length ?? 0 : 'n/a');

const rows = routes.map((r) => {
  const { desktop: dk, mobile: mb, nojs: nj } = results[r] ?? {};
  const [p1, p2x] = prod[r === NOT_FOUND ? '/404.html' : r] ?? ['–', '–'];
  const failed = [dk, mb, nj].some((x) => x?.fails.length) || !dk || !mb || !nj || byPage[slug(r)]?.FAIL.length;
  const warned = [dk, mb, nj].some((x) => x?.m?.verdict.warn.length) || byPage[slug(r)]?.WARN.length;
  return `| ${r === NOT_FOUND ? '`404` (probe)' : `\`${r}\``} | ${screens(dk)} | ${p1} | ${screens(mb)} | ${p2x} | ${pair(broken, dk, mb)} | ${pair(dimmed, dk, mb)} | ${pair(overflow, dk, mb)} | ${pair(consoleN, dk, mb)} | ${hot(num(nj, (m) => m.hiddenText?.total ?? 'n/a'))} | ${hot(jn(slug(r), 'FAIL'))} | ${hot(jn(slug(r), 'WARN'))} | ${failed ? '**FAIL**' : warned ? 'WARN' : 'PASS'} |`;
});
const mapped = new Set(routes.map(slug));
const other = Object.keys(byPage).filter((k) => !mapped.has(k)); // judge pages that were not captured: site-wide checks, pages outside the route list
if (other.length) {
  const sum = (s) => other.reduce((n, k) => n + byPage[k][s].length, 0);
  rows.push(`| judge only: ${other.map((k) => `\`${k}\``).join(', ')} | – | – | – | – | – | – | – | – | – | ${hot(sum('FAIL'))} | ${hot(sum('WARN'))} | ${sum('FAIL') ? '**FAIL**' : 'WARN'} |`);
}

const captureFails = [];
for (const r of routes) for (const v of VARIANTS) for (const f of results[r]?.[v.name]?.fails ?? []) captureFails.push({ r, v: v.name, dir: results[r][v.name].dir, ...f });
const missing = routes.flatMap((r) => VARIANTS.filter((v) => !results[r]?.[v.name]).map((v) => `${label(r)}-${v.name}`));
const retried = routes.flatMap((r) => VARIANTS.filter((v) => results[r]?.[v.name]?.retried).map((v) => `${label(r)}-${v.name} (${results[r][v.name].retried.slice(0, 120)})`));
const nFail = problems.length + (judge.totals?.fail ?? 0) + captureFails.length;
const took = dur(Date.now() - T0);
const code = (lines) => (lines.length ? ['```text', ...lines, '```'] : []);

const md = [
  `# Verification report ${TS}`,
  '',
  `**Result: ${nFail ? 'FAIL' : 'PASS'}** · ${nFail} FAIL (${problems.length} run, ${judge.totals?.fail ?? 0} judge, ${captureFails.length} capture) · took ${took}`,
  '',
  `- Command: \`node build-tools/verify-all.mjs ${process.argv.slice(2).join(' ')}\``,
  `- Build: \`${show(DIST)}\` ${opt['skip-build'] ? '(--skip-build: reused, not rebuilt)' : '(built by this run with `npx astro build`)'}; it feeds the judge${EXPLICIT ? '' : ' and the route list (its sitemap)'}`,
  `- Pages from: ${opt['base-url'] ? `${BASE} (an existing server, left running; its pages are not necessarily this build)` : BASE ? `\`astro preview\` at ${BASE} (serves that build; stopped at the end)` : '`astro preview` (did not start)'}`,
  `- Routes: ${routes.length} (${routes.map((r) => (r === NOT_FOUND ? '404 probe' : r)).join(', ')}); ${routes.length * VARIANTS.length - missing.length} of ${routes.length * VARIANTS.length} capture runs finished`,
  `- Judge: ${judge.totals ? `${judge.totals.fail} FAIL · ${judge.totals.warn} WARN · ${judge.totals.pass} PASS (full output: \`${show(path.join(RUN, 'judge.json'))}\`)` : 'did not run'}`,
  `- Captures: \`${show(RUN)}/<route>-<desktop|mobile|nojs>/\` (tiles, \`metrics.json\`, \`summary.txt\`)`,
  ...retried.map((x) => `- Retried once after an exit 2 (the numbers above are from the second attempt): ${x}`),
  '',
  '## Routes',
  '',
  '| Route | Screens 1440 | Prod 1440 | Screens 390 | Prod 390 | Images not loaded (1440 / 390) | Images dimmed (1440 / 390) | Overflow px (1440 / 390) | Console errors (1440 / 390) | No-JS hidden text | Judge FAIL | Judge WARN | Result |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  'Screens = document height ÷ viewport height (1440×900, 390×844) after one full scroll pass; Prod = production, from the pixel heights in `docs/redesign-2.0/page-lengths-before.md` (`–` = new page). Dimmed = images with opacity < 1, a filter or a blend mode. No-JS hidden text = invisible text elements at 390×844 with JavaScript off. Bold = not zero. The 404 probe\'s own HTTP 404 is expected and not counted.',
  '',
  `## FAIL details (${nFail})`,
  '',
  ...(nFail ? [] : ['None.', '']),
  ...problems.flatMap((p) => [`**Run · ${p.head}**`, '', ...code(p.lines), '']),
  ...Object.entries(byPage).flatMap(([pg, x]) => x.FAIL.flatMap((f) => [`**Judge · \`${pg}\` · ${f.id}** — ${f.msg}`, '', ...code([...f.details.slice(0, 8).flatMap((t) => String(t).split('\n')), ...(f.details.length > 8 ? [`… ${f.details.length - 8} more (judge.json)`] : [])]), ''])),
  ...captureFails.flatMap((f) => [`**Capture · \`${f.r === NOT_FOUND ? '404 probe' : f.r}\` · ${f.v}** — ${f.head}`, '', ...code(f.lines), `Metrics: \`${show(path.join(f.dir, 'metrics.json'))}\``, '']),
  ...(missing.length ? [`**Capture runs without a result:** ${missing.join(', ')}`, ''] : []),
  `## Judge WARN (${judge.totals?.warn ?? 0})`,
  '',
  ...(Object.values(byPage).some((x) => x.WARN.length) ? Object.entries(byPage).flatMap(([pg, x]) => x.WARN.map((w) => `- \`${pg}\` · ${w.id} — ${w.msg}`)) : ['None.']),
  '',
];
mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${md.join('\n')}\n`);

console.log(`\nverify-all: ${nFail ? 'FAIL' : 'PASS'} — ${nFail} FAIL (${problems.length} run, ${judge.totals?.fail ?? 0} judge, ${captureFails.length} capture), judge ${judge.totals?.warn ?? '?'} WARN, took ${took}`);
for (const p of problems) console.log(`  FAIL  run: ${p.head}${p.lines[0] ? ` — ${p.lines[0]}` : ''}`);
for (const f of captureFails.slice(0, 40)) console.log(`  FAIL  ${f.r === NOT_FOUND ? '404 probe' : f.r} [${f.v}]: ${f.head}`);
if (captureFails.length > 40) console.log(`  ... +${captureFails.length - 40} more capture FAILs (see the report)`);
console.log(`  report    ${show(REPORT)}\n  captures  ${show(RUN)}/`);
process.exitCode = nFail ? 1 : 0;
