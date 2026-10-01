#!/usr/bin/env node
/**
 * Regenerates <lastmod> in public/sitemap.xml from each page's real last
 * change date, so the sitemap stops shipping a hardcoded/stale date.
 *
 * For each <url>/<loc>, finds the page's source file in src/pages/ by trying
 * <slug>.astro, <slug>.html, <slug>/index.astro, <slug>/index.html (the root
 * URL maps to index.astro / index.html) and uses:
 *   1. The last git commit date that touched the file (if this is a git
 *      checkout and the file is tracked) — most accurate signal of "content
 *      actually changed".
 *   2. Falls back to the file's filesystem mtime otherwise (e.g. CI checkout
 *      without full history, or an untracked/new file).
 *
 * A URL with no source file gets a warning and keeps its old <lastmod>. If the
 * sitemap has URLs but none resolve, the script exits 1 so the build fails
 * instead of silently shipping stale dates.
 *
 * Runs as a prebuild step (see package.json "build" script) before
 * `astro build`, so dist/ always ships freshly computed lastmod values.
 */
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITEMAP_PATH = path.join(ROOT, 'public', 'sitemap.xml');
const PAGES_DIR = path.join(ROOT, 'src', 'pages');

// Sitemap URL path -> absolute path of its source file in src/pages/, or null.
// ponytail: .astro/.html pages only; dynamic routes ([slug].astro) and .md/.mdx
// pages come back null and are warned about, add candidates here if needed.
function resolvePage(urlPath) {
  const slug = urlPath.replace(/^\/+|\/+$/g, '');
  const names = slug
    ? [`${slug}.astro`, `${slug}.html`, `${slug}/index.astro`, `${slug}/index.html`]
    : ['index.astro', 'index.html'];
  return names.map((n) => path.join(PAGES_DIR, n)).find((f) => existsSync(f)) ?? null;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function gitLastCommitDate(absFilePath) {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', absFilePath],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    if (!out) return null;
    return new Date(out);
  } catch {
    return null;
  }
}

function lastmodForFile(absFile) {
  const gitDate = gitLastCommitDate(absFile);
  if (gitDate) return isoDate(gitDate);

  // Fallback: filesystem mtime (uncommitted changes, or no git history available)
  const stat = statSync(absFile);
  return isoDate(stat.mtime);
}

function main() {
  let xml = readFileSync(SITEMAP_PATH, 'utf8');
  let total = 0;
  let updated = 0;

  // Process each <url>...</url> block, matching its <loc> to a source file
  xml = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) return block;
    total += 1;

    let urlPath = null;
    try {
      urlPath = new URL(locMatch[1]).pathname;
    } catch {
      // unparseable <loc>: reported below like any other unresolved URL
    }

    const file = urlPath && resolvePage(urlPath);
    if (!file) {
      console.warn(
        `[update-sitemap-lastmod] WARNING: no source file in src/pages/ for ${locMatch[1]} ` +
          '(tried <slug>.astro, <slug>.html, <slug>/index.astro, <slug>/index.html); lastmod left unchanged'
      );
      return block;
    }

    const newDate = lastmodForFile(file);
    updated += 1;
    if (/<lastmod>.*?<\/lastmod>/.test(block)) {
      return block.replace(/<lastmod>.*?<\/lastmod>/, `<lastmod>${newDate}</lastmod>`);
    }
    // no existing <lastmod> — insert right after <loc>
    return block.replace(/(<loc>.*?<\/loc>)/, `$1\n    <lastmod>${newDate}</lastmod>`);
  });

  if (total > 0 && updated === 0) {
    console.error(
      `[update-sitemap-lastmod] ERROR: none of the ${total} sitemap URLs resolved to a file in src/pages/; sitemap left unchanged`
    );
    process.exitCode = 1;
    return;
  }

  writeFileSync(SITEMAP_PATH, xml);
  console.log(`[update-sitemap-lastmod] updated ${updated} <url> entr${updated === 1 ? 'y' : 'ies'} in public/sitemap.xml`);
}

main();
