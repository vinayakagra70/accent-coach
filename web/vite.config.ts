import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5180,
    // the Python speech server (server/app.py)
    proxy: { "/api": "http://127.0.0.1:5181" },
  },
  build: { chunkSizeWarningLimit: 1200 },
});
