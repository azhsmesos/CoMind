import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const pdfAssets = ["cmaps", "standard_fonts", "wasm", "iccs"];
const pdfRoot = path.resolve("node_modules/pdfjs-dist");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-pdf-assets",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const match = req.url
            ?.split("?")[0]
            .match(/^\/pdfjs\/(cmaps|standard_fonts|wasm|iccs)\/([\w.-]+)$/);
          if (!match) return next();
          fs.readFile(path.join(pdfRoot, match[1], match[2]), (error, data) => {
            if (error) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader(
              "Content-Type",
              match[2].endsWith(".wasm")
                ? "application/wasm"
                : "application/octet-stream",
            );
            res.end(data);
          });
        });
      },
      writeBundle(options) {
        for (const folder of pdfAssets)
          fs.cpSync(
            path.join(pdfRoot, folder),
            path.join(options.dir || "dist", "pdfjs", folder),
            { recursive: true },
          );
      },
    },
  ],
  // Relative paths so the built index.html loads from file:// inside Electron.
  base: "./",
  // AudioWorklet modules must be local files under the strict CSP, never data URLs.
  build: { assetsInlineLimit: 0 },
  server: { port: 5180 },
});
