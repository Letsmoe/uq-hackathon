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
      registerType: "autoUpdate",
      injectRegister: "auto",

      pwaAssets: {
        disabled: false,
        config: true,
      },
      manifest: {
        name: "Synapse: Rhythm Protocol",
        short_name: "Synapse",
        description:
          "A highly engaging rhythm game built with Svelte and PixiJS.",
        display: "fullscreen",
        start_url: "/",
        scope: "/",
        background_color: "#eceae4",
        theme_color: "#eceae4",
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
