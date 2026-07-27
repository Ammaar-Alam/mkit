import { readdir, readFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", dist), "utf8"));
const failures = [];

if (manifest.manifest_version !== 3) {
  failures.push("manifest_version must be 3");
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage"])) {
  failures.push("permissions must contain only storage");
}
if (manifest.host_permissions) {
  failures.push("host_permissions is not allowed");
}
if (manifest.background) {
  failures.push("a background or service worker is not allowed");
}
if (manifest.externally_connectable) {
  failures.push("externally_connectable is not allowed");
}

for (const contentScript of manifest.content_scripts ?? []) {
  if (contentScript.run_at !== "document_start") {
    failures.push("every content script must run at document_start");
  }
  if (contentScript.world !== "ISOLATED") {
    failures.push("every content script must declare the isolated world");
  }
  if (contentScript.all_frames) {
    failures.push("all_frames is forbidden until a verified child-frame requirement exists");
  }
  for (const match of contentScript.matches ?? []) {
    if (match.includes("<all_urls>") || match.includes("*://") || match.endsWith("/*")) {
      failures.push(`content-script match is too broad: ${match}`);
    }
  }
}

for (const resourceGroup of manifest.web_accessible_resources ?? []) {
  for (const match of resourceGroup.matches ?? []) {
    if (!/^https:\/\/[^/]+\/\*$/.test(match)) {
      failures.push(`web-accessible-resource match must be an HTTPS origin ending in /*: ${match}`);
    }
  }
}

const files = await walk(dist);
for (const file of files) {
  if (file.pathname.endsWith(".map")) {
    failures.push(`source map present: ${relative(file)}`);
    continue;
  }
  if (!/\.(?:js|html|css|json|txt)$/.test(file.pathname)) {
    continue;
  }
  const contents = await readFile(file, "utf8");
  if (file.pathname.endsWith(".js")) {
    for (const [label, expression] of [
      ["fetch", /\bfetch\s*\(/],
      ["XMLHttpRequest", /\bXMLHttpRequest\b/],
      ["WebSocket", /\bWebSocket\b/],
      ["EventSource", /\bEventSource\b/],
      ["dynamic code evaluation", /(?:\beval\s*\(|\bnew\s+Function\s*\()/],
      ["remote module import", /\bimport\s*\(\s*["']https?:\/\//],
    ]) {
      if (expression.test(contents)) {
        failures.push(`${label} found in ${relative(file)}`);
      }
    }
  }
  if (/<script[^>]+src=["']https?:\/\//i.test(contents)) {
    failures.push(`remote script found in ${relative(file)}`);
  }
  if (/@import\s+(?:url\()?["']?https?:\/\//i.test(contents)) {
    failures.push(`remote stylesheet found in ${relative(file)}`);
  }
}

if (failures.length > 0) {
  console.error("Release audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Release audit passed for ${files.length} files.`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name, ensureDirectoryUrl(directory));
    if (entry.isDirectory()) {
      files.push(...(await walk(url)));
    } else if (entry.isFile()) {
      files.push(url);
    }
  }
  return files;
}

function ensureDirectoryUrl(url) {
  return url.pathname.endsWith("/") ? url : new URL(`${url.href}/`);
}

function relative(file) {
  return file.pathname.slice(dist.pathname.length);
}
