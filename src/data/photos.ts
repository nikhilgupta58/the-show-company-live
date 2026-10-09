// The photograph registry. Every entry is one of the company's own photographs.
// Masters live in src/assets/photos/ (crops of bits/*.JPEG, cut clear of the photographer's mark,
// tone untouched) and are served through <Photo>, which makes the AVIF / WebP sizes.
// `glow` is the colour of the light the picture throws on the black around it (measured from the file).
// `position` is the focal point for object-position when a window crops the picture.
import type { ImageMetadata } from 'astro';

import entrance16x9 from '../assets/photos/entrance-arms-wide-16x9.jpg';
import micPalace2x3 from '../assets/photos/mic-palace-backdrop-2x3.jpg';
import highKick2x3 from '../assets/photos/high-kick-palace-backdrop-2x3.jpg';
import emptyHall from '../assets/photos/empty-hall-mic-1920.jpg';
import fullHouseBalcony from '../assets/photos/full-house-balcony-1920.jpg';
import fullHouseStalls from '../assets/photos/full-house-stalls-1600.jpg';
// Library additions (docs/redesign-2.0/photo-library.md).
import crowdworkHoodie from '../assets/photos/crowdwork-hoodie-tan-curtain-4672.jpg';
import micStandHoodie from '../assets/photos/mic-stand-hoodie-dark-stage-3454.jpg';
import standupWhiteTee from '../assets/photos/standup-white-tee-blue-curtains-1200.jpg';
import standupStool from '../assets/photos/standup-stool-blue-curtains-960.jpg';
import hallLightBeams from '../assets/photos/empty-hall-light-beams-led-screen-1280.jpg';
import emptyStageTruss from '../assets/photos/empty-stage-truss-lights-1280.jpg';
import ledMandalaWall from '../assets/photos/led-mandala-wall-wide-1280.jpg';
import collegeTentAudience from '../assets/photos/college-tent-audience-1280.jpg';
import collegeTentStage from '../assets/photos/college-tent-stage-wide-1280.jpg';
import outdoorStage from '../assets/photos/outdoor-stage-red-carpet-1280.jpg';
import conferenceAudience from '../assets/photos/conference-audience-blue-beams-1280.jpg';
import festivalLasers from '../assets/photos/festival-crowd-lasers-1280.jpg';
import festivalSparks from '../assets/photos/festival-crowd-spark-columns-1280.jpg';
// Round 3 additions (docs/redesign-2.0/round3/PHOTO-PLAN.md).
import bitsGesture from '../assets/photos/bits-pilani-gesture-corrected.jpg';
import bitsArmsCrossed from '../assets/photos/bits-pilani-arms-crossed-corrected.jpg';
import beamsOverSeats from '../assets/photos/beams-over-seats-crew-1280.jpg';
import soundcheck from '../assets/photos/soundcheck-crew-on-stage-1280.jpg';
import concertStageA from '../assets/photos/concert-stage-red-led-beams-1280.jpg';
import concertStageB from '../assets/photos/concert-stage-green-violet-beams-1280.jpg';

// What a picture shows: comedian = a performer is the subject; audience = the crowd or seats; stage = the stage,
// rig or hall itself; corporate = a corporate-event setting; college = a college fest (the audit's category;
// the college name is legible in collegeTentStage only).
export type PhotoTag = 'comedian' | 'audience' | 'stage' | 'corporate' | 'college';

export interface Photograph {
  src: ImageMetadata;
  alt: string;
  glow: string;
  position?: string;
  // Library fields. Optional: the first ten entries predate them.
  tags?: PhotoTag[];
  orientation?: 'portrait' | 'landscape' | 'square';
  luminance?: number; // mean luma of the master, 0 to 255 (Rec. 601, on a 1024 px thumbnail). Below ~50 is a low-key picture.
  provenance?: 'own' | 'unverified'; // 'unverified' = the audit could not establish the source (college_fest, college_shows, corporate_image): owner to confirm before it is shown as "our show"
  original?: string; // repo path of the file the master was cut from
}

const AMBER = '#eea010';
const RED = '#f35d0b';
const HALL = '#cc7032';

export const photos = {
  // Hero-grade (Sony A7, 2026-09): bright, sharp, on-brand gold.
  entranceWide: { src: entrance16x9, alt: 'Comedian in a white hoodie walking on stage with arms spread wide, lit in red', glow: RED, position: '46% 40%' },
  micPalace: { src: micPalace2x3, alt: 'Comedian holding the mic close mid-bit, standing in front of a golden painted palace backdrop', glow: AMBER, position: '50% 30%' },
  highKick: { src: highKick2x3, alt: 'Comedian in a sunflower-print top landing a high kick mid-punchline in front of a painted palace backdrop', glow: AMBER, position: '50% 45%' },
  // Rooms (older stills, 1600 to 1920 px wide: bands and cards, not full-bleed on large screens).
  emptyHall: { src: emptyHall, alt: 'Microphone on a stand at centre stage, facing an empty tiered auditorium', glow: HALL, position: '50% 55%' },
  fullHouseBalcony: { src: fullHouseBalcony, alt: 'Full auditorium with balcony seating packed out', glow: HALL, position: '50% 50%' },
  fullHouseStalls: { src: fullHouseStalls, alt: 'Full tiered auditorium with every seat taken, house lights on', glow: HALL, position: '50% 55%' },

  // ---- Library additions (14 masters; index, contact sheets and held-back files: docs/redesign-2.0/photo-library.md) ----
  // Each master is a crop (never an erase) of the file named in `original`: no resize, tone untouched, JPEG q90.
  // `luminance` is measured from the master; `glow` is the hue and saturation of the picture's vivid pixels (weighted by
  // saturation x brightness) lifted to 95% value; `position` is the focal point for object-position.

  // Comedians.
  // IMG_7244 (Sony ILCE-7M5, 4672x7008): cut at y 6150 to clear the photographer mark, so the legs end at the shins. Warm gold and bright; crisp hair but a slightly soft face at 100% (the audit rates it the softest of the six raws), so serve it at 2400 px or less.
  crowdworkHoodie: { src: crowdworkHoodie, alt: 'Comedian in a white hoodie and olive cargo trousers, seen in profile mid-sentence with the mic held low at his chest and his other hand open, in front of a tan stage curtain in warm light', glow: '#f2b145', position: '38% 36%', tags: ['comedian'], orientation: 'portrait', luminance: 90, provenance: 'own', original: 'bits/IMG_7244.JPEG' },
  // IMG_7243 (Sony ILCE-6100, 3454x5423): cut at y 4760 to clear the mark. Low-key (dark hall, lit floor, deep shadows): cards and half-width windows, not a hero.
  micStandHoodie: { src: micStandHoodie, alt: 'Comedian in a white hoodie and olive cargo trousers laughing with his head tipped down, one hand on a mic stand and the other holding the mic, on a warm-lit wooden stage with the hall dark behind him', glow: '#f2be47', position: '58% 32%', tags: ['comedian'], orientation: 'portrait', luminance: 48, provenance: 'own', original: 'bits/IMG_7243.JPEG' },
  // Older stills, blue-lit. The comedian is about a third of the frame: cards only (about 600 css px wide for the first, 480 for the second).
  standupWhiteTee: { src: standupWhiteTee, alt: 'Comedian in a light T-shirt and olive trousers standing centre stage with a mic, blue curtains behind him and a stage monitor in the foreground', glow: '#1a13f2', position: '55% 56%', tags: ['comedian'], orientation: 'portrait', luminance: 44, provenance: 'own', original: 'public/assets/live-performance-1200x1600.jpeg' },
  standupStool: { src: standupStool, alt: 'Comedian in a white shirt and light jeans at the mic on a wooden stage, a stool and a stage monitor beside him, blue curtains behind and audience heads in the foreground', glow: '#553af2', position: '56% 56%', tags: ['comedian'], orientation: 'portrait', luminance: 48, provenance: 'own', original: 'public/assets/comedy-show-blue-stage-960x1280.jpeg' },

  // Rooms, rigs and stages (no performer).
  // Set-up shot: no audience, a few crew with cameras in the front seats. The LED screen shows a third-party event title and a sponsor logo that a crop cannot remove: owner to confirm.
  // Its glow is the mean of the brightest 20% of pixels: the beams are near-white, so a saturation-weighted mean has no stable hue here.
  hallLightBeams: { src: hallLightBeams, alt: 'Auditorium with fans of white moving-light beams converging on a central LED screen that shows a gold winged emblem and an event title, a few crew members and camera stands in the front rows of red seats', glow: '#c3dbed', position: '50% 66%', tags: ['stage'], orientation: 'landscape', luminance: 88, provenance: 'own', original: 'public/assets/auditorium-beam-lights-1280x960.jpeg' },
  emptyStageTruss: { src: emptyStageTruss, alt: 'Empty stage with a red valance and dark curtains, a truss of warm lights, yellow beams, a lectern at left and flight cases at centre, red seats in the foreground', glow: '#f28561', position: '50% 58%', tags: ['stage'], orientation: 'landscape', luminance: 70, provenance: 'own', original: 'public/assets/auditorium-stage-show-1280x960.jpeg' },
  // 2.46:1 as shot: a ready-made 21/9 band.
  ledMandalaWall: { src: ledMandalaWall, alt: 'Wide view of a stage lit in red and green, with a mandala-pattern LED wall, tall magenta LED panels and black speakers along the front', glow: '#f2977e', position: '48% 45%', tags: ['stage'], orientation: 'landscape', luminance: 84, provenance: 'own', original: 'public/assets/college-fest-real-1280x520.jpg' },

  // College. The two tent frames are one tent and one stage; a fest title and a college name are legible on the backdrop in collegeTentStage only (third-party branding: owner to confirm).
  collegeTentAudience: { src: collegeTentAudience, alt: 'Audience seated on white chairs in a large tent, facing a truss stage with LED screens and a red carpet, a barricade across the foreground', glow: '#f28183', position: '50% 62%', tags: ['college', 'audience', 'stage'], orientation: 'landscape', luminance: 110, provenance: 'own', original: 'public/assets/college-event-audience-1280x960.jpeg' },
  collegeTentStage: { src: collegeTentStage, alt: 'View over rows of white chairs in a large tent to a distant truss stage with a colourful LED backdrop and people on stage', glow: '#f2a78d', position: '42% 62%', tags: ['college', 'audience', 'stage'], orientation: 'landscape', luminance: 124, provenance: 'own', original: 'public/assets/college-event-tent-1280x960.jpeg' },
  // Daylight set-up shot, no people, soft. Small cards only. Not tagged college: the audit files it under college events, but the only identifier in the frame is a lectern sign reading "BMIS" (a school or a college: unknown). Owner to confirm.
  outdoorStage: { src: outdoorStage, alt: 'Empty outdoor stage with a black-skirted platform, steps and truss, a red carpet in the foreground, and a brick-red wall and trees behind under a pale sky', glow: '#f27e7b', position: '60% 68%', tags: ['stage'], orientation: 'landscape', luminance: 131, provenance: 'own', original: 'public/assets/college-outdoor-stage-1280x960.jpeg' },

  // UNVERIFIED provenance: each file carries only a resolution tag and a Photoshop resource block (no camera data), has no recorded source, and
  // looks like arena or stock imagery (bulk-imported 2026-06-16). Owner to confirm before any of these is shown as "our show". Their old file
  // names (college_fest, college_shows) are not evidence: nothing in the pictures says college.
  conferenceAudience: { src: conferenceAudience, alt: 'Seated conference audience wearing lanyards and holding notebooks, in a large hall with blue light beams across the roof truss and warm orange light on the rows', glow: '#5cc2f2', position: '30% 68%', tags: ['corporate', 'audience'], orientation: 'landscape', luminance: 61, provenance: 'unverified', original: 'public/assets/corporate_image.jpg' },
  festivalLasers: { src: festivalLasers, alt: 'Crowd in silhouette, hands raised, facing a stage lit by fans of green and red laser beams and magenta spotlights', glow: '#f23a51', position: '55% 42%', tags: ['audience', 'stage'], orientation: 'landscape', luminance: 43, provenance: 'unverified', original: 'public/assets/college_fest.jpg' },
  festivalSparks: { src: festivalSparks, alt: 'Standing crowd with hands raised facing a stage where white spark columns rise in front of vertical beams of light, with a bright flare in the haze', glow: '#89acf2', position: '58% 52%', tags: ['audience', 'stage'], orientation: 'landscape', luminance: 119, provenance: 'unverified', original: 'public/assets/college_shows.jpg' },
  // Round 3 additions. BITS stills are tone-corrected (levels + gamma only) copies; the stage stays low-key by nature.
  bitsGesture: { src: bitsGesture, alt: 'Comedian on a dark stage in a maroon jacket, mic in one hand and the other hand raised, smiling', glow: '#d9694f', position: '48% 50%', tags: ['comedian'], orientation: 'landscape', luminance: 12.7, provenance: 'own', original: 'public/assets/recent-event-standup-gesture-1600x1066.jpeg' },
  bitsArmsCrossed: { src: bitsArmsCrossed, alt: 'Comedian standing alone on a dark stage in a maroon jacket and wide cream trousers, arms crossed, looking up', glow: '#d9694f', position: '52% 50%', tags: ['comedian'], orientation: 'landscape', luminance: 14.9, provenance: 'own', original: 'public/assets/recent-event-standup-arms-crossed-1600x1066.jpeg' },
  beamsOverSeats: { src: beamsOverSeats, alt: 'Hall with white light beams fanning over the stage and a screen, red seats in the foreground with a few people seated and one standing', glow: '#9fc2f2', position: '50% 42%', tags: ['stage', 'audience'], orientation: 'landscape', luminance: 96.2, provenance: 'own', original: 'public/assets/auditorium-full-house-1280x960.jpeg' },
  soundcheck: { src: soundcheck, alt: 'View from the stage across rows of empty red seats, with a mic stand, two stage monitors and a few crew members setting up', glow: '#e07a9a', position: '62% 50%', tags: ['stage'], orientation: 'landscape', luminance: 89, provenance: 'own', original: 'public/assets/auditorium-soundcheck-1280x680.jpeg' },
  concertStageA: { src: concertStageA, alt: 'Stage washed in red and orange light, with beams crossing over an LED wall and flanking LED panels, speakers at the edges', glow: '#f2573a', position: '50% 50%', tags: ['stage'], orientation: 'landscape', luminance: 125.5, provenance: 'own', original: 'public/assets/concert-stage-purple-1280x575.jpeg' },
  concertStageB: { src: concertStageB, alt: 'Stage with green and violet light beams crossing over an LED wall and LED panels, a truss of lights above', glow: '#a8f24a', position: '55% 50%', tags: ['stage'], orientation: 'landscape', luminance: 112, provenance: 'own', original: 'public/assets/auditorium-green-purple-1280x575.jpeg' },
} satisfies Record<string, Photograph>;
