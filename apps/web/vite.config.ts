import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls from the browser: no CORS, and cookies work.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 3000}`,
        // Keep the browser's Host header: the API refuses writes whose Origin does not match Host.
        // (The string shorthand would rewrite Host to the API's own address.)
        changeOrigin: false,
      },
    },
  },
});
