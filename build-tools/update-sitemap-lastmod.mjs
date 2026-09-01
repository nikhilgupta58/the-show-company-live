#!/usr/bin/env node
/**
 * Regenerates <lastmod> in public/sitemap.xml from each page's real last
 * change date, so the sitemap stops shipping a hardcoded/stale date.
 *
 * For each <url>/<loc>, resolves the matching src/pages/*.html file and uses:
 *   1. The last git commit date that touched the file (if this is a git
 *      checkout and the file is tracked) — most accurate signal of "content
 *      actually changed".
 *   2. Falls back to the file's filesystem mtime otherwise (e.g. CI checkout
 *      without full history, or an untracked/new file).
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

// Map sitemap URL path -> src/pages/*.html file
const URL_TO_FILE = {
  '/': 'index.html',
  '/stand-up-comedy-shows/': 'stand-up-comedy-shows.html',
  '/corporate-entertainment/': 'corporate-entertainment.html',
  '/college-fest-entertainment/': 'college-fest-entertainment.html',
  '/artist-booking/': 'artist-booking.html',
  '/comedian-booking-cost-india/': 'comedian-booking-cost-india.html',
};

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

function lastmodForFile(relFile) {
  const absFile = path.join(PAGES_DIR, relFile);
  if (!existsSync(absFile)) return null;

  const gitDate = gitLastCommitDate(absFile);
  if (gitDate) return isoDate(gitDate);

  // Fallback: filesystem mtime (uncommitted changes, or no git history available)
  const stat = statSync(absFile);
  return isoDate(stat.mtime);
}

function main() {
  let xml = readFileSync(SITEMAP_PATH, 'utf8');
  let updated = 0;

  // Process each <url>...</url> block, matching its <loc> to a known page
  xml = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) return block;

    let urlPath;
    try {
      urlPath = new URL(locMatch[1]).pathname;
    } catch {
      return block;
    }

    const relFile = URL_TO_FILE[urlPath];
    if (!relFile) return block; // unknown URL, leave untouched

    const newDate = lastmodForFile(relFile);
    if (!newDate) return block;

    updated += 1;
    if (/<lastmod>.*?<\/lastmod>/.test(block)) {
      return block.replace(/<lastmod>.*?<\/lastmod>/, `<lastmod>${newDate}</lastmod>`);
    }
    // no existing <lastmod> — insert right after <loc>
    return block.replace(/(<loc>.*?<\/loc>)/, `$1\n    <lastmod>${newDate}</lastmod>`);
  });

  writeFileSync(SITEMAP_PATH, xml);
  console.log(`[update-sitemap-lastmod] updated ${updated} <url> entr${updated === 1 ? 'y' : 'ies'} in public/sitemap.xml`);
}

main();
