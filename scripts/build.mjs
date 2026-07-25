import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const dist = new URL("../dist/", import.meta.url);
await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  charset: "utf8",
  legalComments: "none",
  logLevel: "info",
  minify: true,
  sourcemap: false,
  target: ["chrome120"],
};

await build({
  ...common,
  entryPoints: {
    "popup/index": new URL("../src/popup/index.ts", import.meta.url).pathname,
    "options/index": new URL("../src/options/index.ts", import.meta.url).pathname,
  },
  format: "iife",
  outdir: dist.pathname,
  platform: "browser",
});

await Promise.all([
  cp(new URL("../public/", import.meta.url), dist, { recursive: true }),
  cp(
    new URL("../src/popup/index.html", import.meta.url),
    new URL("../dist/popup/index.html", import.meta.url),
  ),
  cp(
    new URL("../src/options/index.html", import.meta.url),
    new URL("../dist/options/index.html", import.meta.url),
  ),
]);

const manifestPath = new URL("../dist/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== "0.1.0" || manifest.manifest_version !== 3) {
  throw new Error("Manifest version does not match the package release.");
}

await writeFile(
  new URL("../dist/BUILD.txt", import.meta.url),
  "MKit 0.1.0\nBuilt from local source with no remote runtime dependencies.\n",
);
