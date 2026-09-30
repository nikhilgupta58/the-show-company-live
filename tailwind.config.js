/** @type {import('tailwindcss').Config} */
// Design system: "HOUSE LIGHTS" — a gig-poster / handbill system.
// Brand BLACK + GOLD, hexes kept from the original site (#050505, #C6A87C, #E8D5B0, #A8885C); tints/shades only.
// Type: Anton (condensed poster display) · Instrument Serif italic (editorial aside) · Instrument Sans (body).
// Full token + component notes live at the top of src/input.css.
module.exports = {
  content: ["./src/pages/**/*.{html,astro}", "./src/**/*.{astro,js,ts,jsx,tsx}", "./public/assets/motion.js"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#050505", 2: "#0B0A08", 3: "#17140F" },
        paper: { DEFAULT: "#F1E7D4", 2: "#E8D5B0", 3: "#E3D4B8" },
        // gold = brand accent (~9:1 on #050505). gold-ink = dark gold for text on paper (~5.7:1).
        gold: { DEFAULT: "#C6A87C", light: "#E8D5B0", deep: "#A8885C", ink: "#6E5530" },
        fog: { DEFAULT: "#B9AE9E", dim: "#8C8274" },
      },
      fontFamily: {
        display: ['"Anton"', "Impact", '"Arial Narrow"', "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ['"Instrument Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        // display sizes capped with clamp(); leading ~0.95-1.1 and slightly open tracking so Anton doesn't jam
        "mega": ["clamp(3.5rem, 17vw, 12rem)", { lineHeight: "0.95", letterSpacing: "0.005em" }],
        "d1": ["clamp(2.75rem, 7.5vw, 6.5rem)", { lineHeight: "1", letterSpacing: "0.01em" }],
        "d2": ["clamp(2.25rem, 5vw, 4.5rem)", { lineHeight: "1.02", letterSpacing: "0.01em" }],
        "d3": ["clamp(1.5rem, 2.8vw, 2.25rem)", { lineHeight: "1.1", letterSpacing: "0.01em" }],
      },
      maxWidth: { shell: "88rem" },
      transitionTimingFunction: { stage: "cubic-bezier(.2,.8,.2,1)" },
    },
  },
  plugins: [],
};
