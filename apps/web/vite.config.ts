import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls from the browser: no CORS, and cookies work.
    proxy: { "/api": "http://localhost:3000" },
  },
});
