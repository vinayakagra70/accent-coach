// After `vite build --mode phone`: remove the speech runtime's .wasm that Vite copied
// in. The app loads that file from jsDelivr (listen/worker.ts sets wasmPaths), and at
// 28 MB it is over Cloudflare Pages' 25 MB per-file limit.
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-phone/assets";
let removed = 0;
for (const f of readdirSync(dir)) {
  if (/^ort-wasm.*\.wasm$/.test(f)) {
    removed += statSync(join(dir, f)).size;
    unlinkSync(join(dir, f));
  }
}
const big = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.size > 25 * 1024 * 1024) big.push(p);
  }
};
walk("dist-phone");
console.log(`removed ${(removed / 1e6).toFixed(1)} MB of unused runtime files`);
if (big.length) {
  console.error("files over 25 MB (too big for Cloudflare Pages):", big);
  process.exit(1);
}
