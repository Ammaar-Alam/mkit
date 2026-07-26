import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const root = process.cwd();
const execFileAsync = promisify(execFile);

test("production manifest keeps the extension worker-free and narrowly permissioned", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, "public/manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.version).toBe(await readPackageVersion());
  expect(manifest.permissions).toEqual(["storage"]);
  expect(manifest).not.toHaveProperty("host_permissions");
  expect(manifest).not.toHaveProperty("optional_permissions");
  expect(manifest).not.toHaveProperty("background");

  const contentScripts = manifest.content_scripts;
  expect(
    Array.isArray(contentScripts),
    "A release manifest must inject exactly one static content script on confirmed completed-review paths.",
  ).toBe(true);
  if (!Array.isArray(contentScripts)) return;
  expect(contentScripts).toHaveLength(1);
  expect(contentScripts[0]).toMatchObject({
    css: ["content/preflight.css"],
    js: ["content/index.js"],
    run_at: "document_start",
    world: "ISOLATED",
  });
  expect(contentScripts[0]?.all_frames ?? false).toBe(false);

  const matches = contentScripts[0]?.matches as string[];
  expect(matches).toEqual(["https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-*"]);
  expect(matches).not.toContain("<all_urls>");
  expect(matches).not.toContain("https://mcatofficialprep.org/app/aamc-mcat-practice-exam-*");
  expect(matches).not.toContain("https://apps.aamc.org/mrs/*");
  expect(matches).not.toContain("https://prep.aamc.org/*");
  expect(matches.every((match) => match.startsWith("https://"))).toBe(true);
});

test("runtime source and build configuration contain no network or remote-code primitives", async () => {
  const runtimeFiles = [
    "src/content/preflight.ts",
    "src/adapter/AamcFullLengthReviewAdapter.ts",
    "src/adapter/ReversibleDomMask.ts",
    "src/core/keyboard.ts",
    "src/core/state.ts",
    "src/core/summary.ts",
    "src/core/timing.ts",
    "src/storage/codec.ts",
    "src/storage/repository.ts",
    "src/storage/sync.ts",
    "src/popup/index.ts",
    "src/options/index.ts",
  ];
  const runtime = (
    await Promise.all(runtimeFiles.map((file) => readFile(resolve(root, file), "utf8")))
  ).join("\n");
  expect(runtime).not.toMatch(
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval)\s*\(/,
  );
  expect(runtime).not.toMatch(/\bnew\s+Function\b|WebAssembly\.(?:compile|instantiate)/);
  expect(runtime).not.toMatch(/https?:\/\//);

  const buildScript = await readFile(resolve(root, "scripts/build.mjs"), "utf8");
  expect(buildScript).not.toMatch(/sourcemap\s*:\s*true/);
});

test("built bundle and packaged ZIP contain no maps, test artifacts, remote code, or network clients", async () => {
  await execFileAsync("pnpm", ["build"], { cwd: root });
  await execFileAsync("pnpm", ["audit:release"], { cwd: root });
  await execFileAsync("pnpm", ["package"], { cwd: root });

  const distFiles = await walk(resolve(root, "dist"));
  const forbiddenPaths =
    /(?:^|\/)(?:tests?|fixtures?|node_modules|coverage|playwright-report|test-results|\.agents?|\.git)(?:\/|$)|(?:^|\/)\.env|\.map$|\.tsx?$|\.DS_Store$|screenshot/i;
  for (const file of distFiles) {
    expect(file.replace(`${resolve(root, "dist")}/`, "")).not.toMatch(forbiddenPaths);
  }

  const packageVersion = await readPackageVersion();
  const { stdout: zipListing } = await execFileAsync(
    "unzip",
    ["-Z1", resolve(root, `release/mkit-${packageVersion}.zip`)],
    { cwd: root },
  );
  const zipFiles = zipListing.split(/\r?\n/).filter(Boolean);
  expect(zipFiles.length).toBeGreaterThan(5);
  for (const file of zipFiles) {
    expect(file).not.toMatch(forbiddenPaths);
  }

  const auditableBundleFiles = distFiles.filter((file) => /\.(?:css|html|js|json)$/i.test(file));
  const bundle = (
    await Promise.all(auditableBundleFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");
  expect(bundle).not.toMatch(
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval)\s*\(/,
  );
  expect(bundle).not.toMatch(/\bnew\s+Function\b|WebAssembly\.(?:compile|instantiate)/);
  expect(bundle).not.toMatch(
    /<script[^>]+src=["']https?:\/\/|@import\s+(?:url\()?["']?https?:\/\/|url\([^)]*https?:\/\//i,
  );
});

async function readPackageVersion(): Promise<string> {
  const packageMetadata = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  expect(packageMetadata.version).toEqual(expect.any(String));
  return packageMetadata.version as string;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
