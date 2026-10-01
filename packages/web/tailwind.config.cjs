/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The forensic-workspace screens (S1-S5) use the hand-authored CSS token
  // system in src/styles/global.css (--bench, --panel, --ink, etc). Tailwind
  // is scoped to the landing layer only, so we disable preflight to avoid
  // fighting that existing reset/typography baseline.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
