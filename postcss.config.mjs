import tailwindcss from "@tailwindcss/postcss";
import legacyColorFallback from "./postcss-legacy-color-fallback.mjs";

const config = {
  plugins: [
    tailwindcss(),
    legacyColorFallback(),
  ],
};

export default config;

