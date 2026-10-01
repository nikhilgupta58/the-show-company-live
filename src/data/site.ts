// One source for everything the chrome says: navigation, footer, contact facts, analytics id.
// Header.astro, Footer.astro, Base.astro, NextBand.astro, ChannelRows.astro and EnquiryForm.astro
// read from here. The page map, labels and link targets are the strategy's
// (docs/redesign-2.0/seo/strategy.md §1, §4.5, §7.3); facts are its ledger's (§5). Do not invent any.
// One label per page, the same in the header, the menu and the footer.

export interface NavLink {
  label: string;
  href: string;
}

const home: NavLink = { label: 'Home', href: '/' };
const comedy: NavLink = { label: 'Stand-up comedy', href: '/stand-up-comedy-shows/' };
const corporate: NavLink = { label: 'Corporate entertainment', href: '/corporate-entertainment/' };
const college: NavLink = { label: 'College fests', href: '/college-fest-entertainment/' };
const artists: NavLink = { label: 'Artist booking', href: '/artist-booking/' };
const events: NavLink = { label: 'Event management', href: '/event-management-company-india/' };
const pricing: NavLink = { label: 'Booking cost guide', href: '/comedian-booking-cost-india/' };
const work: NavLink = { label: 'Work', href: '/work/' };
const about: NavLink = { label: 'About', href: '/about/' };
const contactPage: NavLink = { label: 'Contact', href: '/contact/' };

export const site = {
  name: 'The Show Company',
  url: 'https://www.theshowcompany.in',
  lang: 'en-IN',
  ogLocale: 'en_IN',
  themeColor: '#050505',
  gaId: 'G-Y5FKNQX4H0', // also written literally inside the inline snippet in Base.astro
  twitterSite: '@theshowcompany',
  ogImage: { path: '/assets/og-image.png', width: 1200, height: 630 },
  // Per-page share cards (docs/redesign-2.0/share-images.md): 1200×630 PNG, like ogImage.
  // Keyed by the canonical path Base receives; any page not listed shares ogImage.
  ogCards: {
    '/stand-up-comedy-shows/': { path: '/og/stand-up-comedy-shows.png', alt: 'The Show Company logo with the line “Stand-up comedian booking across India”, beside a photograph of a comedian telling a story on a stage washed in warm amber light' },
    '/corporate-entertainment/': { path: '/og/corporate-entertainment.png', alt: 'The Show Company logo with the line “Corporate event entertainment that people remember”, beside a photograph of a comedian in a white hoodie, mid-sentence with the mic at his chest, in front of a tan stage curtain' },
    '/college-fest-entertainment/': { path: '/og/college-fest-entertainment.png', alt: 'The Show Company logo with the line “College fest artist booking, produced properly”, beside a photograph of an audience in a large tent facing a truss stage with LED screens and a red carpet' },
    '/artist-booking/': { path: '/og/artist-booking.png', alt: 'The Show Company logo with the line “Artist booking: the artist you want, confirmed”, beside a photograph of a microphone on a stand facing an empty tiered auditorium with red seats' },
    '/comedian-booking-cost-india/': { path: '/og/comedian-booking-cost-india.png', alt: 'The Show Company logo with the line “How much does it cost to book a comedian in India?”, beside a photograph of a full auditorium with a packed balcony' },
    '/event-management-company-india/': { path: '/og/event-management-company-india.png', alt: 'The Show Company logo with the line “Full-service event management, built for India”, beside a photograph of an empty stage under a truss of warm lights and yellow beams' },
    '/work/': { path: '/og/work.png', alt: 'The Show Company logo with the line “Recent shows, as they happened”, beside a photograph of a comedian landing a high kick in front of a painted palace backdrop' },
    '/about/': { path: '/og/about.png', alt: 'The Show Company logo with the line “Team, partners and how we work”, beside a photograph of a full tiered auditorium with every seat taken, house lights on' },
    '/contact/': { path: '/og/contact.png', alt: 'The Show Company logo with the line “Book a show or an artist”, beside a photograph of a comedian walking on stage with arms spread wide, lit in red' },
  } as Record<string, { path: string; alt: string }>,
  robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',

  contact: {
    phone: { label: '+91 70602 93132', href: 'tel:+917060293132' },
    email: { label: 'contact@theshowcompany.in', href: 'mailto:contact@theshowcompany.in' },
    whatsapp: { label: 'WhatsApp', href: 'https://wa.me/917060293132' },
    instagram: { label: 'Instagram', href: 'https://www.instagram.com/the_show_company/', handle: 'the_show_company' },
    location: 'Based in India · Operating pan-India',
  },

  nav: {
    // Header bar (from 78rem): the four buyer routes and the proof route.
    primary: [comedy, corporate, college, artists, work] as NavLink[],
    // The menu (phones and tablets) and the no-JavaScript list: every page.
    menu: [home, comedy, corporate, college, artists, events, pricing, work, about, contactPage] as NavLink[],
    // The one enquiry action: header, dock, menu, NextBand. The forms live on /contact/;
    // the homepage keeps a compact block with id="contact", so old /#contact links still land.
    cta: { label: 'Enquire', href: '/contact/' } as NavLink,
  },

  footer: {
    groups: [
      { title: 'Services', links: [comedy, corporate, college, artists, events, pricing] },
      { title: 'Company', links: [home, work, about, contactPage] },
    ] as { title: string; links: NavLink[] }[],
    copyright: 'The Show Company. All Rights Reserved.',
    year: '2026',
  },

  // The page-ending ring (strategy §7.3): each page's NextBand names the page after it; the last
  // points Home; the 404 points Home. Use nextAfter(Astro.url.pathname) for href and title.
  ring: [home, comedy, corporate, college, artists, events, pricing, work, about, contactPage] as NavLink[],
  // Where the ring would send a buyer sideways, to a page written for a different buyer, the
  // page leads to that buyer's own next step instead. (College fests → Artist booking and Event
  // management → Booking cost guide are already the ring's order.)
  next: { [corporate.href]: pricing } as Record<string, NavLink>,

  // The three figures production repeats on every page (strategy §5.2).
  stats: [
    { value: '500+', label: 'shows produced' },
    { value: '100+', label: 'artists booked' },
    { value: '50+', label: 'cities, pan-India' },
  ],

  // EmailJS (public by design). The ids are also written literally in src/client/enquiry.ts,
  // because build-tools/verify-redesign.mjs looks for them in the shipped JavaScript.
  enquiry: {
    publicKey: 'ypAwRD-OQwNtchzlS',
    serviceId: 'service_p7e6via',
    templates: { booking: 'template_j8f54gl', query: 'template_y4r8oub' },
  },
} as const;

const bare = (path: string) => path.replace(/\/+$/, '') || '/';

/** True when `href` is the page being rendered (trailing slash agnostic). */
export const isCurrent = (href: string, pathname: string) => !href.includes('#') && bare(href) === bare(pathname);

/** The page a page ends on: its own next step (`site.next`) if it has one, else the next page in the ring
    (Home for the last page and for any page not in it, such as the 404). */
export const nextAfter = (pathname: string): NavLink => {
  const own = Object.entries(site.next).find(([href]) => bare(href) === bare(pathname));
  if (own) return own[1];
  const i = site.ring.findIndex((page) => bare(page.href) === bare(pathname));
  return i < 0 ? home : site.ring[(i + 1) % site.ring.length];
};
