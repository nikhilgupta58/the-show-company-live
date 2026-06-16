import { defineConfig } from 'astro/config';

// Static build. The homepage is housed as src/pages/index.html (passed through
// identically — no style rescoping / script rebundling). Future landing pages
// can be added as .astro files sharing a layout.
export default defineConfig({
  site: 'https://www.theshowcompany.in',
  build: {
    // emit /page/index.html so clean URLs (/corporate-entertainment) work on any host
    format: 'directory',
  },
});
