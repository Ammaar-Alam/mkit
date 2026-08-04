import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeMutationObserver = MutationObserver;
    let observerCount = 0;
    Object.defineProperty(window, "__mkitObserverCount", {
      configurable: false,
      get: () => observerCount,
    });
    window.MutationObserver = class extends NativeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCount += 1;
        super(callback);
      }
    };
  });
});

test("dashboard-like non-answer routes receive no MKit host, mask, marker, or observer", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard");
  const initialState = await snapshotDashboard(page);
  const initialObserverCount = await page.evaluate(() =>
    Reflect.get(window, "__mkitObserverCount"),
  );

  for (const hash of [
    "#exams",
    "#exams/intro/synthetic",
    "#exams/take/synthetic",
    "#exams/results/synthetic",
    "#exams/synthetic-exam/exam_sections/synthetic-section",
    "#exams/details/exam_section/synthetic-section",
    "#dashboard",
  ]) {
    await page.evaluate((nextHash) => window.__mkitRouteGuardHarness.setHash(nextHash), hash);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
    await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
    await expect(page.locator("#dashboard-root")).toBeVisible();
    expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
    expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
    expect(await page.evaluate(() => Reflect.get(window, "__mkitObserverCount"))).toBe(
      initialObserverCount,
    );
    expect(await snapshotDashboard(page)).toEqual(initialState);
  }
});

test("leaving an answer review removes MKit and restores the dashboard exactly", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard");
  const authoredDashboard = await snapshotDashboard(page);
  const initialObserverCount = await page.evaluate(() =>
    Reflect.get(window, "__mkitObserverCount"),
  );

  await page.evaluate(() =>
    window.__mkitRouteGuardHarness.setHash("#exams/answers/synthetic-exam/synthetic-question"),
  );
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "boot");
  expect(await page.locator("[data-mkit-hidden]").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => Reflect.get(window, "__mkitObserverCount"))).toBeGreaterThan(
    initialObserverCount,
  );

  await page.evaluate(() => window.__mkitRouteGuardHarness.setHash("#exams"));
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#dashboard-root")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await snapshotDashboard(page)).toEqual(authoredDashboard);
});

test("valid wrapperless answer review mounts protection once the host is ready", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard?answer");

  expect(await page.evaluate(() => window.__mkitRouteGuardSyncDisplay)).not.toBe("none");
  expect(await page.evaluate(() => window.__mkitRouteGuardSyncFooterDisplay)).not.toBe("none");
  expect(await page.evaluate(() => window.__mkitRouteGuardSyncQuestionVisibility)).toBe("visible");
  await expect(page.locator(".reviewable")).toHaveCount(2);
  await expect(page.locator(".reviewable:has(> .question-content-container)")).toHaveCount(1);
  await expect(
    page.locator(".reviewable:has(> .question-content-container) .view-answers.switchable"),
  ).toHaveCount(0);
  await expect(page.locator(".view-answers.switchable")).toHaveCount(2);
  await expect(page.locator("ul.question-choices-multi.results")).toHaveCount(0);
  await expect(page.locator(".multi-choice")).toHaveCount(4);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-mkit-route", "answer-review");
  await expect(page.locator("#wrapper")).toBeHidden();
  await expect(page.locator("#main-footer")).toBeHidden();
});

test("exact completed section review auto-attaches and cleans up across native routes", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section");

  expect(await page.evaluate(() => window.__mkitRouteGuardSyncDisplay)).not.toBe("none");
  const authoredMarkup = await page.evaluate(() => window.__mkitRouteGuardAuthoredMarkup);
  const host = page.locator("[data-mkit-host]");
  await expect(host).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-mkit-route", "answer-review");
  await expect(host.locator("[data-focus-key='practice']")).toBeVisible();
  await host.locator("[data-focus-key='practice']").click();
  await expect(host.locator(".mkit-study-rail")).toContainText("Section review");
  await expect(host.locator(".mkit-study-rail")).toContainText("Current question");
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");

  await page.evaluate(() =>
    window.__mkitRouteGuardHarness.setHash(
      "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question-2",
    ),
  );
  await expect(host).toHaveCount(1);
  await expect(host.locator(".mkit-study-rail")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");

  await page.evaluate(() => window.__mkitRouteGuardHarness.setHash("#exams"));
  await expect(host).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#dashboard-root")).toBeVisible();
  expect(await page.locator("#dashboard-root").evaluate((element) => element.outerHTML)).toBe(
    authoredMarkup,
  );
});

test("question transitions keep the Jack Westin shadow sidebar interactive", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section");

  const mkitHost = page.locator("[data-mkit-host]");
  await mkitHost.locator("[data-focus-key='practice']").click();
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");

  await page.evaluate(() => {
    const jackWestinHost = document.createElement("div");
    jackWestinHost.id = "jw-exam-page-shadow-root";
    const shadow = jackWestinHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        aside {
          position: fixed;
          z-index: 10000;
          top: 0;
          right: 0;
          display: flex;
          width: 453px;
          height: 100vh;
        }

        .side-panel-tab-content {
          width: 405px;
          height: 100%;
          overflow-y: auto;
          background: white;
        }

        .explanation {
          min-height: 2400px;
        }
      </style>
      <aside>
        <div class="side-panel-tab-content">
          <section class="explanation" data-question="1">
            Jack Westin Question Solutions
          </section>
        </div>
      </aside>
    `;
    document.body.append(jackWestinHost);

    const records: Array<{
      jackWestinDisplay: string;
      jackWestinTransitionCovered: boolean;
      mkitPointerEvents: string;
      protection: string | null;
      wrapperDisplay: string;
    }> = [];
    const record = (): void => {
      const mkit = document.querySelector("[data-mkit-host]");
      const wrapper = document.querySelector("#wrapper");
      records.push({
        jackWestinDisplay: getComputedStyle(jackWestinHost).display,
        jackWestinTransitionCovered: jackWestinHost.hasAttribute("data-mkit-transition-hidden"),
        mkitPointerEvents: mkit ? getComputedStyle(mkit).pointerEvents : "",
        protection: document.documentElement.dataset.mkitProtection ?? null,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "",
      });
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-mkit-protection")) {
        record();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mkit-protection"],
    });
    record();
    Reflect.set(window, "__mkitJackWestinTransitionProbe", { observer, records });

    const next = document.querySelector<HTMLElement>(".toolbar-btn.next");
    if (!next) throw new Error("Missing synthetic native Next button.");
    next.dataset.nativeClicks = "0";
    next.addEventListener("click", () => {
      const nextQuestion = Number(next.dataset.nativeClicks ?? "0") + 1;
      next.dataset.nativeClicks = String(nextQuestion);
      window.__mkitRouteGuardHarness.setHash(
        `#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question-${nextQuestion + 1}`,
      );
      const explanation = shadow.querySelector<HTMLElement>(".explanation");
      if (explanation) {
        explanation.dataset.question = String(nextQuestion + 1);
        explanation.textContent = `Jack Westin Question ${nextQuestion + 1} Solutions`;
      }
      const scroller = shadow.querySelector<HTMLElement>(".side-panel-tab-content");
      if (scroller) scroller.scrollTop = 0;
    });
  });

  const nativeNext = page.locator(".toolbar-btn.next");
  for (const expectedTransitions of [1, 2]) {
    await nativeNext.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const probe = Reflect.get(window, "__mkitJackWestinTransitionProbe") as {
            records: Array<{ protection: string | null }>;
          };
          return probe.records.filter((record) => record.protection === "transition").length;
        }),
      )
      .toBe(expectedTransitions);
    await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");
  }

  const transitionRecords = await page.evaluate(() => {
    const probe = Reflect.get(window, "__mkitJackWestinTransitionProbe") as {
      observer: MutationObserver;
      records: Array<{
        jackWestinDisplay: string;
        jackWestinTransitionCovered: boolean;
        mkitPointerEvents: string;
        protection: string | null;
        wrapperDisplay: string;
      }>;
    };
    probe.observer.disconnect();
    return probe.records.filter((record) => record.protection === "transition");
  });
  expect(transitionRecords).toHaveLength(2);
  expect(transitionRecords).toEqual(
    transitionRecords.map((record) => ({
      ...record,
      jackWestinDisplay: "block",
      jackWestinTransitionCovered: false,
      mkitPointerEvents: "none",
      wrapperDisplay: "none",
    })),
  );
  await expect(nativeNext).toHaveAttribute("data-native-clicks", "2");
  await expect(page.locator("#wrapper")).toBeVisible();
  await expect(page.locator("#wrapper")).not.toHaveAttribute("data-mkit-transition-hidden");

  const jackWestinScroller = page
    .locator("#jw-exam-page-shadow-root")
    .locator(".side-panel-tab-content");
  await expect(jackWestinScroller).toHaveCount(1);
  const scrollBounds = await jackWestinScroller.boundingBox();
  if (!scrollBounds) throw new Error("Missing Jack Westin scroll geometry.");
  await page.mouse.move(scrollBounds.x + 12, scrollBounds.y + 200);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => jackWestinScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const scrollState = await jackWestinScroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    pointerEvents: getComputedStyle(element).pointerEvents,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollState.clientHeight).toBeGreaterThan(0);
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  expect(scrollState).toMatchObject({ overflowY: "auto", pointerEvents: "auto" });
});

test("Normal review removes the host, restores native interaction, and persists within review routes", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section");
  const host = page.locator("[data-mkit-host]");
  await expect(host.locator("[data-focus-key='normal-review']")).toBeVisible();
  await page.locator(".toolbar-btn.next").evaluate((element) => {
    element.setAttribute("data-native-clicks", "0");
    element.addEventListener("click", () => {
      const clicks = Number(element.getAttribute("data-native-clicks") ?? "0");
      element.setAttribute("data-native-clicks", String(clicks + 1));
    });
  });

  await host.locator("[data-focus-key='normal-review']").click();

  await expect(host).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "normal-review",
    route: "review",
    issues: [],
  });

  await page.locator(".toolbar-btn.next").click();
  await expect(page.locator(".toolbar-btn.next")).toHaveAttribute("data-native-clicks", "1");

  await page.evaluate(() =>
    window.__mkitRouteGuardHarness.setHash(
      "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question-2",
    ),
  );
  await expect(host).toHaveCount(0);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "normal-review",
    route: "review",
    issues: [],
  });

  await page.evaluate(() => window.__mkitRouteGuardHarness.setHash("#exams"));
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "unsupported",
    route: "non-review",
    issues: [],
  });

  await page.evaluate(() =>
    window.__mkitRouteGuardHarness.setHash(
      "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question-3",
    ),
  );
  await expect(host).toHaveCount(1);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "active",
    route: "review",
    issues: [],
  });
});

test("turning MKit off and on restores and reapplies protection without a reload", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section");
  const host = page.locator("[data-mkit-host]");
  await expect(host).toHaveCount(1);

  await page.evaluate(() => window.__mkitRouteGuardHarness.setEnabled(false));
  await expect(host).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "disabled",
    route: "review",
    issues: [],
  });

  await page.evaluate(() => window.__mkitRouteGuardHarness.setEnabled(true));
  await expect(host).toHaveCount(1);
  await expect(page.locator("#wrapper")).toBeHidden();
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "active",
    route: "review",
    issues: [],
  });

  await host.locator("[data-focus-key='normal-review']").click();
  await expect(host).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__mkitRouteGuardHarness.status()).then((value) => value.state),
  ).toBe("normal-review");

  await page.evaluate(() => window.__mkitRouteGuardHarness.setEnabled(false));
  await page.evaluate(() => window.__mkitRouteGuardHarness.setEnabled(true));
  await expect(host).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__mkitRouteGuardHarness.status()).then((value) => value.state),
  ).toBe("active");
});

test("a persisted Off setting leaves the review untouched during startup", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section&disabled");
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden], [data-mkit-outcome-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.hasAttribute("data-mkit-protection")),
  ).toBe(false);
  expect(await page.evaluate(() => window.__mkitRouteGuardStartupMutations)).toBe(0);
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "disabled",
    route: "non-review",
    issues: [],
  });
});

for (const action of ["Practice", "Test", "Normal review"] as const) {
  test(`${action} survives an unrelated page mutation during pointer activation`, async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:4173/route-guard?section");
    const host = page.locator("[data-mkit-host]");
    await expect(host).toHaveCount(1);
    await page.evaluate(() => window.__mkitRouteGuardHarness.armGateMutationOnPointerDown());

    const actionButton =
      action === "Practice"
        ? host.getByRole("button", {
            name: "Practice Check each answer when you’re ready.",
            exact: true,
          })
        : action === "Test"
          ? host.getByRole("button", {
              name: "Test Finish before seeing results.",
              exact: true,
            })
          : host.getByRole("button", { name: "Normal review", exact: true });
    await expect(actionButton).toHaveCount(1);
    await actionButton.click();

    if (action === "Normal review") {
      await expect(host).toHaveCount(0);
      await expect(page.locator("#wrapper")).toBeVisible();
      return;
    }

    await expect(host.locator(".mkit-study-rail")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");
  });
}

test("completed section result marks are neutralized without blocking native review links", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/route-guard?section-overview");
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);

  await page.evaluate(() => {
    const wrapper = document.querySelector("#wrapper");
    if (!wrapper) throw new Error("Missing synthetic wrapper.");
    wrapper.innerHTML = `
      <ul class="answers-wrapper list-table" aria-hidden="true">
        <li class="content">
          <div
            id="section-result-cue"
            class="li-cell correctness correct"
            title="Correct"
            aria-label="Correct"
          ></div>
          <a id="section-review-link" href="#synthetic-review">Review</a>
        </li>
      </ul>
      <div class="sr-only">
        <table class="answers-wrapper">
          <thead>
            <tr>
              <th id="answer-listing-header-correctness-synthetic">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr class="content">
              <td headers="answer-listing-header-correctness-synthetic">
                This was answered correctly
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const reviewLink = document.querySelector("#section-review-link");
    reviewLink?.addEventListener("click", (event) => {
      event.preventDefault();
      const clicks = Number(reviewLink.getAttribute("data-native-clicks") ?? "0");
      reviewLink.setAttribute("data-native-clicks", String(clicks + 1));
    });
  });

  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("#section-result-cue")).toHaveAttribute("data-mkit-outcome-hidden", "");
  const resultMarkStyle = await page.locator("#section-result-cue").evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      backgroundImage: style.backgroundImage,
      content: style.content,
    };
  });
  expect(resultMarkStyle.content).toBe('""');
  expect(resultMarkStyle.backgroundImage).toMatch(/^url\("data:image\/png;base64,/);
  expect(
    await page.locator("#section-result-cue").evaluate((element) => ({
      correct: element.classList.contains("correct"),
      incorrect: element.classList.contains("incorrect"),
    })),
  ).toEqual({ correct: false, incorrect: false });
  await expect(
    page.locator('td[headers="answer-listing-header-correctness-synthetic"]'),
  ).toHaveText("Hidden");
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "active",
    route: "section-overview",
    issues: [],
  });

  await page.locator("#section-review-link").click();
  await expect(page.locator("#section-review-link")).toHaveAttribute("data-native-clicks", "1");

  await page.evaluate(() => window.__mkitRouteGuardHarness.setShowInitialCorrectnessEnabled(true));
  await expect(page.locator("#section-result-cue")).toHaveAttribute(
    "data-mkit-initial-correctness-enabled",
    "",
  );
  await expect(page.locator("#section-result-cue")).toHaveAttribute(
    "data-mkit-initial-correct",
    "",
  );
  const initialCorrectMarkStyle = await page.locator("#section-result-cue").evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      backgroundImage: style.backgroundImage,
      content: style.content,
    };
  });
  expect(initialCorrectMarkStyle).toEqual({
    backgroundImage: "none",
    content: '"✓"',
  });
  await expect(
    page.locator('td[headers="answer-listing-header-correctness-synthetic"]'),
  ).toHaveText("Correct on initial attempt");

  await page.evaluate(() => {
    const wrapper = document.querySelector("#wrapper");
    if (!wrapper) throw new Error("Missing synthetic wrapper.");
    wrapper.innerHTML = `
      <ul class="answers-wrapper list-table" aria-hidden="true">
        <li class="content">
          <div
            id="replacement-section-result-cue"
            class="li-cell correctness incorrect"
            title="Incorrect"
            aria-label="Incorrect"
          ></div>
          <a id="replacement-section-review-link" href="#synthetic-review">Review</a>
        </li>
      </ul>
      <div class="sr-only">
        <table class="answers-wrapper">
          <thead>
            <tr>
              <th id="answer-listing-header-correctness-replacement">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr class="content">
              <td headers="answer-listing-header-correctness-replacement">
                This was answered incorrectly
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  });

  await expect(page.locator("#replacement-section-result-cue")).toHaveAttribute(
    "data-mkit-outcome-hidden",
    "",
  );
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveClass(/incorrect/);
  await expect(page.locator("#replacement-section-result-cue")).toHaveAttribute(
    "data-mkit-initial-correctness-enabled",
    "",
  );
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveAttribute(
    "data-mkit-initial-correct",
    "",
  );
  await expect(
    page.locator('td[headers="answer-listing-header-correctness-replacement"]'),
  ).toHaveText("Hidden");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document
          .querySelector("#replacement-section-review-link")
          ?.setAttribute("data-observer-mutation", "true");
        requestAnimationFrame(() => resolve());
      }),
  );

  await page.evaluate(() => window.__mkitRouteGuardHarness.setHideSectionResultMarksEnabled(false));
  await expect(page.locator("#replacement-section-result-cue")).toHaveClass(/incorrect/);
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveAttribute(
    "data-mkit-outcome-hidden",
    "",
  );
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveAttribute(
    "data-mkit-initial-correctness-enabled",
    "",
  );
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveAttribute(
    "data-mkit-initial-correct",
    "",
  );
  await expect(page.locator("#replacement-section-result-cue")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.locator('td[headers="answer-listing-header-correctness-replacement"]'),
  ).toHaveText("This was answered incorrectly");
  expect(await page.evaluate(() => window.__mkitRouteGuardHarness.status())).toEqual({
    state: "supported-not-running",
    route: "section-overview",
    issues: [],
  });
});

test("accepted answer route fails open when a completed-review capability is absent", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:4173/route-guard?answer&missing-capability&stale-route&stale-protection",
  );
  await waitForTwoFrames(page);

  expect(await page.evaluate(() => window.__mkitRouteGuardSyncDisplay)).not.toBe("none");
  expect(await page.evaluate(() => window.__mkitRouteGuardSyncFooterDisplay)).not.toBe("none");
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  await expect(page.locator("#main-footer")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
  expect(await snapshotAuthoredSurface(page)).toBe(
    await page.evaluate(() => window.__mkitRouteGuardAuthoredSurface),
  );
});

test("answer review with two visible external switches remains fail-open", async ({ page }) => {
  await page.goto(
    "http://127.0.0.1:4173/route-guard?answer&ambiguous-switch&stale-route&stale-protection",
  );
  await waitForTwoFrames(page);

  await expect(page.locator(".view-answers.switchable")).toHaveCount(2);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  await expect(page.locator("#main-footer")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
  expect(await snapshotAuthoredSurface(page)).toBe(
    await page.evaluate(() => window.__mkitRouteGuardAuthoredSurface),
  );
});

test("wrapperless answer review with fewer than four choices remains fail-open", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:4173/route-guard?answer&incomplete-choices&stale-route&stale-protection",
  );
  await waitForTwoFrames(page);

  await expect(page.locator("ul.question-choices-multi.results")).toHaveCount(0);
  await expect(page.locator(".multi-choice")).toHaveCount(3);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  await expect(page.locator("#main-footer")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
  expect(await snapshotAuthoredSurface(page)).toBe(
    await page.evaluate(() => window.__mkitRouteGuardAuthoredSurface),
  );
});

for (const failureMode of [
  "bootstrap-fail",
  "controller-fail",
  "disconnected-preflight",
] as const) {
  test(`accepted answer route fails open after ${failureMode}`, async ({ page }) => {
    await page.goto(
      `http://127.0.0.1:4173/route-guard?answer&stale-route&stale-protection&${failureMode}`,
    );
    await waitForTwoFrames(page);

    await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
    await expect(page.locator("[data-mkit-hidden]")).toHaveCount(0);
    await expect(page.locator("#wrapper")).toBeVisible();
    await expect(page.locator("#main-footer")).toBeVisible();
    expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
    expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();
    expect(await snapshotAuthoredSurface(page)).toBe(
      await page.evaluate(() => window.__mkitRouteGuardAuthoredSurface),
    );
  });
}

test("delayed capability recovery covers only after its host is connected", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/route-guard?answer&missing-capability&stale-route");
  await waitForTwoFrames(page);

  await expect(page.locator("[data-mkit-host]")).toHaveCount(0);
  await expect(page.locator("#wrapper")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-mkit-route")).toBeNull();
  expect(await page.locator("html").getAttribute("data-mkit-protection")).toBeNull();

  const recovered = await page.evaluate(() =>
    window.__mkitRouteGuardHarness.restoreCompletedReviewCapability(),
  );
  expect(recovered).toEqual({
    footerDisplay: "none",
    hostConnected: true,
    wrapperDisplay: "none",
  });
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-mkit-route", "answer-review");
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "boot");
  await expect(page.locator("#wrapper")).toBeHidden();
  await expect(page.locator("#main-footer")).toBeHidden();
});

async function snapshotDashboard(page: import("@playwright/test").Page): Promise<string> {
  return page.locator("#dashboard-root").evaluate((element) => element.outerHTML);
}

async function snapshotAuthoredSurface(page: import("@playwright/test").Page): Promise<string> {
  return page
    .locator("#wrapper, #main-footer")
    .evaluateAll((elements) => elements.map((element) => element.outerHTML).join(""));
}

async function waitForTwoFrames(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
