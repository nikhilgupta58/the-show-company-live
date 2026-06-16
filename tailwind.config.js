/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan index.html (markup + inline <script> string literals like 'bg-[#c6a87c]').
  // /deliverables is intentionally excluded.
  content: ["./src/pages/**/*.{html,astro}", "./src/**/*.{astro,js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
