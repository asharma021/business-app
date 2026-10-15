import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        raised: v("raised"),
        ink: v("ink"),
        muted: v("muted"),
        faint: v("faint"),
        line: v("line"),
        accent: v("accent"),
        "accent-ink": v("accent-ink"),
        gain: v("gain"),
        warn: v("warn"),
        loss: v("loss"),
      },
      fontFamily: { sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"] },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: { DEFAULT: "6px", lg: "10px" },
    },
  },
  plugins: [],
} satisfies Config;
