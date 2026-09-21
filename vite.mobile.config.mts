import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("mobile"),
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve("dist-mobile"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
