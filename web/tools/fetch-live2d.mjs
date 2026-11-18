// After `vite build --mode phone`: put Nova's Live2D files into dist-phone/ when
// they aren't there. They are kept out of git (Live2D's licences don't allow
// sharing the raw files in a public repo), so a build from git (Vercel) fetches
// them from Live2D's own public sources, the same ones setup.ps1 uses:
//   - Cubism Core, the engine:   cubism.live2d.com (only a "latest" address exists)
//   - Hiyori, the character:     Live2D's CubismWebSamples on GitHub, pinned to one commit
// On this laptop the files are already in public/ (setup.ps1), Vite copies them in,
// and nothing is downloaded. Any failure leaves the build working without the
// character: the app already falls back to captions and voice only.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "dist-phone";
const CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
// "Update to Cubism SDK for Web R4" (2021-12-09), the last change to Hiyori
const SAMPLES = "https://raw.githubusercontent.com/Live2D/CubismWebSamples/b032ce27e111a228138b9363be408ff24bc7eaa6/Samples/Resources/Hiyori/";
const MODELS = ["models/hiyori-recolour/Hiyori.model3.json", "models/hiyori/Hiyori.model3.json"];

async function get(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function save(rel, data) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

async function core() {
  if (existsSync(join(OUT, "live2dcubismcore.min.js"))) return "engine: already there";
  const js = await get(CORE_URL);
  // a changed address could answer with an error page instead of the engine
  if (!js.includes("Live2DCubismCore")) throw new Error("the engine download doesn't look like Cubism Core");
  save("live2dcubismcore.min.js", js);
  return `engine: downloaded (${(js.length / 1024).toFixed(0)} KB)`;
}

async function character() {
  if (MODELS.some((m) => existsSync(join(OUT, m)))) return "character: already there";
  const manifest = await get(SAMPLES + "Hiyori.model3.json");
  const refs = JSON.parse(manifest.toString("utf8")).FileReferences;
  const files = [
    refs.Moc, refs.Physics, refs.Pose, refs.UserData, refs.DisplayInfo,
    ...(refs.Textures ?? []),
    ...Object.values(refs.Motions ?? {}).flat().map((m) => m.File),
    ...(refs.Expressions ?? []).map((e) => e.File),
  ].filter(Boolean);
  // all or nothing: half a character would fail to load anyway
  const got = await Promise.all(files.map(async (f) => [f, await get(SAMPLES + f)]));
  for (const [f, data] of got) save(`models/hiyori/${f}`, data);
  save("models/hiyori/Hiyori.model3.json", manifest);
  const kb = got.reduce((n, [, d]) => n + d.length, manifest.length) / 1024;
  return `character: downloaded Hiyori (${files.length + 1} files, ${(kb / 1024).toFixed(1)} MB)`;
}

for (const [name, step] of [["engine", core], ["character", character]]) {
  try {
    console.log(`live2d ${await step()}`);
  } catch (e) {
    // a warning, not a failure: the site still goes live, just without Nova's picture
    console.warn(`live2d ${name}: could not fetch (${e.message}). The site will show captions and voice without the character.`);
  }
}
