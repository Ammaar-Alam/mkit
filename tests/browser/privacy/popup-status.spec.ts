import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

test("a verified review reports attachment and clears it on a native route", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/route-guard?answer");
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "active",
    route: "review",
    issues: [],
  });

  await page.evaluate(() => window.__mkitRouteGuardHarness.setHash("#exams"));
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "unsupported",
    route: "non-review",
    issues: [],
  });
});

test("a fail-open review names the capability that blocked coverage", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/route-guard?answer&missing-capability");
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "supported-not-running",
    route: "review",
    issues: ["REVIEW_SWITCH_MISSING"],
  });
});
