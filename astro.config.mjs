import { defineConfig } from 'astro/config';

// Static build. Every page is a .astro file in src/pages, built on src/layouts/Base.astro and the
// components in src/components (design system: docs/redesign-2.0/DESIGN.md). Styles are Astro's
// own CSS; photographs go through astro:assets (AVIF / WebP + a JPEG fallback).
export default defineConfig({
  site: 'https://www.theshowcompany.in',
  build: {
    // emit /page/index.html so clean URLs (/corporate-entertainment) work on any host
    format: 'directory',
  },
});
