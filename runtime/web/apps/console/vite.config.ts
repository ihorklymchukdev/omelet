import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // The MSW worker lives in dev-public/, so a production build never ships it.
  publicDir: command === "serve" ? "dev-public" : false,
  // The page's CSP refuses data: fonts, so every asset ships as a file.
  build: { assetsInlineLimit: 0 },
}));
