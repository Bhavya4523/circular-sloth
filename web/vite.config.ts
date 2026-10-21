import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 6_000_000,
      },
      manifest: {
        name: "Circular Sloth",
        short_name: "Sloth",
        description: "A calmer way to keep up with school circulars.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#FBFCFA",
        theme_color: "#FBFCFA",
        icons: [{ src: "/sloth-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [{ name: "files", accept: ["image/*", "application/pdf", "text/plain"] }],
          },
        },
      },
    }),
  ],
  server: {
    host: "127.0.0.1", port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
