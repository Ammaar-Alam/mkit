import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";

const releaseDirectory = new URL("../release/", import.meta.url);
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
if (typeof packageMetadata.version !== "string" || packageMetadata.version.length === 0) {
  throw new Error("Package version is missing.");
}
const archive = new URL(`../release/mkit-${packageMetadata.version}.zip`, import.meta.url);

await mkdir(releaseDirectory, { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-q", "-r", archive.pathname, "."], {
  cwd: new URL("../dist/", import.meta.url),
  stdio: "inherit",
});

console.log(`Created ${archive.pathname}`);
