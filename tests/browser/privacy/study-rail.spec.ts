import { expect, type Locator, type Page, test } from "@playwright/test";

test.use({ channel: "chrome" });

test("Fresh Attempt opens below the native tools and stays inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  const toolbar = page.locator(".answer-toolbar-wrapper");
  const initial = await railAndToolbarBounds(page, rail, toolbar);

  expect(initial.rail.top).toBeGreaterThan(initial.toolbar.bottom);
  expect(initial.viewportWidth - initial.rail.right).toBeCloseTo(16, 0);
  expect(initial.rail.bottom).toBeLessThanOrEqual(initial.viewportHeight - 16);
  expect(initial.maxHeight).toBeCloseTo(initial.viewportHeight - initial.rail.top - 16, 0);

  const grip = rail.locator("[data-focus-key='rail-grip']");
  await grip.focus();
  for (let index = 0; index < 30; index += 1) {
    await grip.press("Shift+ArrowRight");
    await grip.press("Shift+ArrowDown");
  }

  const moved = await rail.boundingBox();
  if (!moved) throw new Error("Moved Study Rail does not have viewport bounds.");
  expect(moved.x).toBeGreaterThanOrEqual(16);
  expect(moved.y).toBeGreaterThanOrEqual(16);
  expect(moved.x + moved.width).toBeLessThanOrEqual(1_280 - 16);
  expect(moved.y + moved.height).toBeLessThanOrEqual(900 - 16);

  await grip.press("Home");
  const restored = await railAndToolbarBounds(page, rail, toolbar);
  expect(restored.rail.top).toBeCloseTo(initial.rail.top, 0);
  expect(restored.rail.right).toBeCloseTo(initial.rail.right, 0);

  await page.setViewportSize({ width: 560, height: 640 });
  const resized = await railAndToolbarBounds(page, rail, toolbar);
  expect(resized.rail.left).toBeGreaterThanOrEqual(16);
  expect(resized.rail.right).toBeLessThanOrEqual(560 - 16);
  expect(resized.rail.bottom).toBeLessThanOrEqual(640 - 16);
});

test("moving Fresh Attempt toward the top preserves its current height", async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  const grip = rail.locator("[data-focus-key='rail-grip']");
  const [initialRail, gripBounds] = await Promise.all([rail.boundingBox(), grip.boundingBox()]);
  if (!initialRail || !gripBounds) throw new Error("Study Rail drag geometry is unavailable.");

  const startX = gripBounds.x + gripBounds.width / 2;
  const startY = gripBounds.y + gripBounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - (initialRail.y - 16), { steps: 5 });
  await page.mouse.up();

  const movedRail = await rail.boundingBox();
  if (!movedRail) throw new Error("Moved Study Rail geometry is unavailable.");
  expect(movedRail.y).toBeCloseTo(16, 0);
  expect(movedRail.height).toBeCloseTo(initialRail.height, 0);
  expect(movedRail.y + movedRail.height).toBeLessThanOrEqual(900 - 16);
});

test("a minimized moved rail stays expandable after the viewport shrinks", async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  const grip = rail.locator("[data-focus-key='rail-grip']");
  const toggle = rail.locator("[data-focus-key='rail-toggle']");

  await grip.press("ArrowRight");
  await toggle.click();
  await expect(rail).toHaveClass(/is-minimized/);
  await page.setViewportSize({ width: 1_280, height: 640 });
  await toggle.click();

  const expanded = await rail.boundingBox();
  if (!expanded) throw new Error("Expanded Study Rail geometry is unavailable.");
  expect(expanded.y).toBeGreaterThanOrEqual(16);
  expect(expanded.y + expanded.height).toBeLessThanOrEqual(640 - 16);
});

test("Resume stays below the rendered highlighter palette through answer updates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".answer-toolbar-wrapper");
    if (!toolbar) throw new Error("Synthetic toolbar is unavailable.");
    toolbar.id = "rendered-toolbar";
    toolbar.style.position = "relative";
    toolbar.style.height = "40px";

    const hiddenToolbar = document.createElement("div");
    hiddenToolbar.className = "answer-toolbar-wrapper";
    hiddenToolbar.style.display = "none";
    toolbar.before(hiddenToolbar);

    const palette = document.createElement("div");
    palette.id = "rendered-palette";
    palette.className = "highlight-color-options";
    Object.assign(palette.style, {
      display: "block",
      height: "64px",
      position: "absolute",
      right: "0",
      top: "40px",
      width: "160px",
    });
    toolbar.append(palette);
  });
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  await page.evaluate(() => window.__mkitPrivacyHarness.restartController());
  await host.locator("[data-focus-key='resume']").click();

  const rail = host.locator(".mkit-study-rail");
  const palette = page.locator("#rendered-palette");
  const [railBounds, paletteBounds] = await Promise.all([
    rail.boundingBox(),
    palette.boundingBox(),
  ]);
  if (!railBounds || !paletteBounds) {
    throw new Error("Resumed Study Rail or highlighter palette geometry is unavailable.");
  }
  expect(railBounds.y).toBeGreaterThanOrEqual(paletteBounds.y + paletteBounds.height + 8);

  await page.evaluate(() => window.scrollTo(0, 400));
  const toolbarBounds = await page.locator("#rendered-toolbar").boundingBox();
  if (!toolbarBounds) throw new Error("Rendered toolbar geometry is unavailable.");
  expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(0);

  await rail.locator("[data-focus-key='answer-A']").click();
  await expect
    .poll(() => page.evaluate(() => window.__mkitPrivacyHarness.savedSelection()))
    .toBe("A");
  const settledRailBounds = await rail.boundingBox();
  if (!settledRailBounds) throw new Error("Updated Study Rail geometry is unavailable.");
  expect(settledRailBounds.y).toBeCloseTo(railBounds.y, 0);
});

test("Study Rail keeps header controls and next action reachable while scrolled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 520 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  const check = rail.locator("[data-focus-key='check']");
  await rail.locator("[data-focus-key='answer-A']").click();
  await expect(check).toBeInViewport();
  await check.click();
  await expect(rail.locator("[data-focus-key='reveal-answers']")).toBeInViewport();
  await rail.locator(".mkit-study-rail__scroller").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(rail.locator("[data-focus-key='rail-grip']")).toBeInViewport();
  await expect(rail.locator("[data-focus-key='rail-toggle']")).toBeInViewport();
  await expect(rail.locator("[data-focus-key='reveal-answers']")).toBeInViewport();
});

test("Study Rail stays usable when the native tools sit near the viewport bottom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 320 });
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".answer-toolbar-wrapper");
    if (!toolbar) throw new Error("Synthetic toolbar is unavailable.");
    Object.assign(toolbar.style, {
      height: "40px",
      position: "fixed",
      top: "260px",
      width: "900px",
    });
    window.__mkitPrivacyHarness.startController();
  });

  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  await expect(rail).toHaveCSS("max-height", "192px");
  await expect(rail.locator("[data-focus-key='rail-grip']")).toBeInViewport();
  await expect(rail.locator("[data-focus-key='rail-toggle']")).toBeInViewport();
  await rail.locator("[data-focus-key='answer-A']").scrollIntoViewIfNeeded();
  await rail.locator("[data-focus-key='answer-A']").click();
  await expect(rail.locator("[data-focus-key='check']")).toBeInViewport();
});

async function railAndToolbarBounds(page: Page, rail: Locator, toolbar: Locator) {
  const [railBounds, toolbarBounds, maxHeight, viewport] = await Promise.all([
    rail.boundingBox(),
    toolbar.boundingBox(),
    rail.evaluate((element) => Number.parseFloat(getComputedStyle(element).maxHeight)),
    page.evaluate(() => ({ height: innerHeight, width: innerWidth })),
  ]);
  if (!railBounds || !toolbarBounds) throw new Error("Study Rail geometry is unavailable.");
  return {
    maxHeight,
    rail: {
      bottom: railBounds.y + railBounds.height,
      left: railBounds.x,
      right: railBounds.x + railBounds.width,
      top: railBounds.y,
    },
    toolbar: {
      bottom: toolbarBounds.y + toolbarBounds.height,
    },
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  };
}
