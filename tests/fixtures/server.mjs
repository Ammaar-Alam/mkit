import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const port = 4173;
const browserEntry = await build({
  bundle: true,
  entryPoints: [new URL("./browser-entry.ts", import.meta.url).pathname],
  format: "iife",
  legalComments: "none",
  minify: false,
  platform: "browser",
  target: ["chrome120"],
  write: false,
});
const browserScript = browserEntry.outputFiles[0]?.text;
if (!browserScript) {
  throw new Error("Synthetic browser harness did not compile.");
}

const routes = new Map([
  ["/", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/review.html" }],
  ["/review", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/review.html" }],
  ["/score", { contentType: "text/html; charset=utf-8", file: "tests/fixtures/score.html" }],
  ["/preflight.css", { contentType: "text/css; charset=utf-8", file: "src/content/preflight.css" }],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname === "/browser-entry.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(browserScript);
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
