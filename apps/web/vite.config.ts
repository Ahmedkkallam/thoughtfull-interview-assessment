import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls from the browser: no CORS, and cookies work.
    proxy: { "/api": process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
