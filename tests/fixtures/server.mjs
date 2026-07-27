import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const port = 4173;
const uiCss = await readFile(new URL("src/content/ui.css", root), "utf8");
const resultMark = await readFile(new URL("public/icons/icon-32.png", root));
const preflightCss = (
  await readFile(new URL("src/content/preflight.css", root), "utf8")
).replaceAll(
  "__MKIT_RESULT_MARK_URL__",
  `data:image/png;base64,${Buffer.from(resultMark).toString("base64")}`,
);
const define = {
  __MKIT_UI_CSS__: JSON.stringify(
    uiCss
      .replaceAll("__MKIT_ATKINSON_URL__", "data:font/ttf;base64,AA==")
      .replaceAll("__MKIT_LITERATA_URL__", "data:font/ttf;base64,AA==")
      .replaceAll("__MKIT_MARK_URL__", "/icons/icon-48.png"),
  ),
};
const buildFixtureEntry = async (filename) => {
  const result = await build({
    bundle: true,
    define,
    entryPoints: [new URL(filename, import.meta.url).pathname],
    format: "iife",
    legalComments: "none",
    minify: false,
    platform: "browser",
    target: ["chrome120"],
    write: false,
  });
  const script = result.outputFiles[0]?.text;
  if (!script) throw new Error(`Synthetic browser harness did not compile: ${filename}`);
  return script;
};
const browserScript = await buildFixtureEntry("./browser-entry.ts");
const routeGuardScript = await buildFixtureEntry("./route-guard-entry.ts");

const routes = new Map([
  ["/", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/review.html" }],
  [
    "/live-review",
    { contentType: "text/html; charset=utf-8", file: "tests/fixtures/live-review.html" },
  ],
  [
    "/section-review",
    { contentType: "text/html; charset=utf-8", file: "tests/fixtures/live-review.html" },
  ],
  [
    "/route-guard",
    { contentType: "text/html; charset=utf-8", file: "tests/fixtures/route-guard.html" },
  ],
  ["/review", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/review.html" }],
  ["/score", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/score.html" }],
  ["/icons/icon-48.png", { contentType: "image/png", file: "public/icons/icon-48.png" }],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname === "/browser-entry.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(browserScript);
      return;
    }
    if (url.pathname === "/route-guard-entry.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(routeGuardScript);
      return;
    }
    if (url.pathname === "/preflight.css") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/css; charset=utf-8",
      });
      response.end(preflightCss);
      return;
    }

    const route = routes.get(url.pathname);
    if (!route) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const body = await readFile(new URL(route.file, root));
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": route.contentType,
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Synthetic fixture server failure");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MKit synthetic fixtures listening on http://127.0.0.1:${port}`);
});

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
