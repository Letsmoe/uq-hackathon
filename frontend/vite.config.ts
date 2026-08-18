import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      // Inside the Capacitor shell every asset is already bundled and served
      // from the app package, so a service worker adds no offline benefit and
      // actively breaks updates: it keeps serving a precached index bundle
      // whose dynamic-import chunk hashes no longer exist in the new build.
      disable: process.env.CAPACITOR_BUILD === "1",
      registerType: "autoUpdate",
      injectRegister: "auto",

      // Icons are maintained by hand in public/icons and referenced from
      // index.html. The generator's 2023 preset expects a favicon.ico that
      // does not exist, and the resulting 404 fails the whole precache.
      pwaAssets: {
        disabled: true,
      },
      manifest: {
        name: "Synapse: Rhythm Protocol",
        short_name: "Synapse",
        description:
          "A highly engaging rhythm game built with Svelte and PixiJS.",
        // "standalone" is the mode iOS actually honours; "fullscreen" is
        // unreliable there and falls back inconsistently.
        display: "standalone",
        orientation: "landscape",
        start_url: "/",
        scope: "/",
        background_color: "#04060f",
        theme_color: "#04060f",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },

      devOptions: {
        enabled: true,
      },
    }),
  ],
});
