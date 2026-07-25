import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

test("synthetic protection paths make no unexpected network requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());
  await page.goto("http://127.0.0.1:4173/score");
  await page.evaluate(() => window.__mkitPrivacyHarness.scoreShield());

  const unexpected = requests.filter((url) => {
    const parsed = new URL(url);
    return (
      parsed.origin !== "http://127.0.0.1:4173" ||
      !["/review", "/score", "/preflight.css", "/browser-entry.js"].includes(parsed.pathname)
    );
  });
  expect(unexpected).toEqual([]);
});
