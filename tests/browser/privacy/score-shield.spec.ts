import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

const SCORE_SENTINELS = [
  "MKIT_SCORE_TITLE_500_0B77",
  "MKIT_SCORE_SUMMARY_LABEL_892A",
  "MKIT_SCORE_500_2F19",
  "MKIT_SCORE_CP_125_D742",
  "MKIT_SCORE_CARS_125_3E4A",
] as const;

test("Score Shield removes scores from display, AX, Find, copy, and print until reveal", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/score");
  const report = await page.evaluate(() => window.__mkitPrivacyHarness.scoreShield());

  expect(report).toMatchObject({
    pageKind: "score-report",
    safeToReveal: true,
    scoreRegionCount: 3,
    reviewControlFound: true,
  });
  await expect(page.locator("#total-score")).toBeHidden();
  await expect(page.locator(".section-score")).toHaveCount(2);
  for (const score of await page.locator(".section-score").all()) {
    await expect(score).toBeHidden();
  }

  const cdp = await page.context().newCDPSession(page);
  const axText = JSON.stringify(await cdp.send("Accessibility.getFullAXTree"));
  const copiedText = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.documentElement);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  const findLeaks = await page.evaluate((sentinels) => {
    return sentinels.filter((sentinel) =>
      window.find(sentinel, false, false, true, false, false, false),
    );
  }, SCORE_SENTINELS);
  for (const sentinel of SCORE_SENTINELS) {
    expect(axText).not.toContain(sentinel);
    expect(copiedText).not.toContain(sentinel);
  }
  expect(findLeaks).toEqual([]);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#score-report")).toBeHidden();

  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.__mkitPrivacyHarness.revealScores());
  await expect(page.locator("#total-score")).toBeVisible();
  expect(await page.locator("#total-score").textContent()).toBe("MKIT_SCORE_500_2F19");

  await page.evaluate(() => {
    document.querySelector("#score-report")?.setAttribute("data-exam-id", "synthetic-fl-2");
    const total = document.querySelector("#total-score");
    if (total) total.textContent = "MKIT_SCORE_SECOND_EXAM_510_96D0";
    window.__mkitPrivacyHarness.scoreShield();
  });
  await expect(page.locator("#total-score")).toBeHidden();
});
