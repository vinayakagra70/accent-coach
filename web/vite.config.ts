import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Local testing only: serve the already-downloaded q4 model at /__dev-model on
 * `vite` and `vite preview`, so browser tests don't re-download 242 MB.
 * Never part of a build; the app only uses it when a test asks for it on localhost.
 */
function devModel(): Plugin {
  const file = resolve(__dirname, "../models/onnx-candidates/onnx-community/onnx/model_q4.onnx");
  const serve = (_req: IncomingMessage, res: ServerResponse) => {
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end("no local model");
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(statSync(file).size));
    createReadStream(file).pipe(res);
  };
  return {
    name: "dev-model",
    configureServer(server) {
      server.middlewares.use("/__dev-model", serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/__dev-model", serve);
    },
  };
}

/**
 * Cross-origin isolation lets the speech model use several CPU threads
 * (SharedArrayBuffer). The hosted build sets the same headers (public/_headers).
 * Everything else the page loads is same-origin or CORS (Hugging Face, jsDelivr).
 */
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => ({
  // relative paths, so the phone build works from any web address or sub-folder
  base: mode === "phone" ? "./" : "/",
  plugins: [devModel()],
  preview: { headers: ISOLATION, host: "127.0.0.1", port: 5190 },
  server: {
    headers: ISOLATION,
    // a phone build writes ~1,600 files; watching them crashed the dev server (EBUSY)
    watch: { ignored: ["**/dist/**", "**/dist-phone/**"] },
    host: "127.0.0.1",
    port: 5180,
    // the Python speech server (server/app.py)
    proxy: { "/api": "http://127.0.0.1:5181" },
  },
  build: { chunkSizeWarningLimit: 1200 },
  worker: { format: "es" },
}));
