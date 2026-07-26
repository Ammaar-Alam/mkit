import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

const releaseDirectory = new URL("../release/", import.meta.url);
const archive = new URL("../release/mkit-0.1.1.zip", import.meta.url);

await mkdir(releaseDirectory, { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-q", "-r", archive.pathname, "."], {
  cwd: new URL("../dist/", import.meta.url),
  stdio: "inherit",
});

console.log(`Created ${archive.pathname}`);
