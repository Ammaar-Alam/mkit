import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

test("synthetic protection paths make no unexpected network requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());
  await page.goto("http://127.0.0.1:4173/score");
  await page.evaluate(() => window.__mkitPrivacyHarness.scoreShield());

  const localPaths = new Set([
    "/browser-entry.js",
    "/icons/icon-48.png",
    "/preflight.css",
    "/review",
    "/score",
  ]);
  const unexpected = requests.filter((url) => {
    const parsed = new URL(url);
    return parsed.origin !== "http://127.0.0.1:4173" || !localPaths.has(parsed.pathname);
  });
  expect(unexpected).toEqual([]);
});
