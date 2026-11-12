// Shows with a public source. Only facts from docs/redesign-2.0/seo/facts-from-public-sources.md
// (every value below is read from the linked Instagram post); nothing inferred, no audience numbers.
export const venue = { name: 'BITS Pilani Main Auditorium', city: 'Pilani', region: 'Rajasthan' };

export const shows = [
  {
    fest: "APOGEE '26",
    name: "Stand-up comedy night at APOGEE '26, BITS Pilani",
    date: '2026-04-14',
    dateLabel: '14 April 2026',
    performers: [
      { name: 'Ashish Solanki', post: 'https://www.instagram.com/the_show_company/p/DXZBf-OoFUs/' },
      { name: 'Vivek Samtani', post: 'https://www.instagram.com/the_show_company/p/DXY_olTIHJf/' },
    ],
  },
  {
    fest: 'BOSM 2026',
    name: 'Stand-up comedy night at BOSM 2026, BITS Pilani',
    date: '2026-09-20',
    dateLabel: '20 September 2026',
    performers: [
      { name: 'Aaditya Kulshreshth (Kullu)', post: 'https://www.instagram.com/the_show_company/p/Dd1_rZck5Fb/' },
      { name: 'Vidit Sharma', post: 'https://www.instagram.com/the_show_company/p/Ddzcs01E14b/' },
    ],
  },
] as const;

export const names = (s: (typeof shows)[number]) => s.performers.map((p) => p.name).join(' and ');
