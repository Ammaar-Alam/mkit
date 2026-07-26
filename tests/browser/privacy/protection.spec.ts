import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

const REVIEW_SPOILERS = [
  "MKIT_TALLY_12_OF_59_A10C",
  "MKIT_SECTION_RESULT_8_CORRECT_C2A4",
  "MKIT_NAV_TITLE_CORRECT_44BD",
  "MKIT_NAV_LABEL_CORRECT_571A",
  "MKIT_NAV_ICON_CHECK_9CF2",
  "MKIT_STATUS_TITLE_INCORRECT_93AB",
  "MKIT_STATUS_LABEL_INCORRECT_C163",
  "MKIT_STATUS_INCORRECT_6A5E",
  "MKIT_ORIGINAL_TITLE_SELECTED_927F",
  "MKIT_ORIGINAL_LABEL_SELECTED_INCORRECT_930E",
  "MKIT_ORIGINAL_ANSWER_A_75FC",
  "MKIT_CORRECT_TITLE_B_562C",
  "MKIT_CORRECT_LABEL_B_307A",
  "MKIT_CORRECT_ANSWER_B_71ED",
  "MKIT_EXPLANATION_BODY_824C",
  "MKIT_TIME_07_42_88B0",
  "MKIT_DIFFICULTY_HARD_D79B",
  "MKIT_TOOLTIP_TITLE_CORRECT_053A",
  "MKIT_TOOLTIP_BODY_CORRECT_9A85",
  "MKIT_RESULT_RAIL_OLD_ATTEMPT_074D",
  "MKIT_PSEUDO_CORRECT_67F1",
] as const;

const LIVE_FEEDBACK_SPOILERS = [
  "MKIT_LIVE_INLINE_SOLUTION_4B76",
  "MKIT_LIVE_KNOWN_EXPLANATION_2A31",
  "MKIT_LIVE_TOPBAR_RESULT_91B2",
  "MKIT_LIVE_NATIVE_RESULT_3F42",
  "MKIT_LIVE_ORIGINAL_LABEL_77C4",
  "MKIT_LIVE_ANSWER_COMPARISON_4E18",
  "MKIT_LIVE_REMOVED_CHOICE_620D",
  "MKIT_LIVE_FALLBACK_SOLUTION_88D0",
  "MKIT_LIVE_DELAYED_RESULT_1C50",
  "MKIT_LIVE_DELAYED_INLINE_SOLUTION_6E83",
  "MKIT_LIVE_DELAYED_EXPLANATION_5D29",
] as const;

test("default-deny CSS prevents first-paint spoiler exposure", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => new Promise(requestAnimationFrame));

  expect(await page.evaluate(() => window.__syncBootDisplay)).toBe("none");
  expect(await page.evaluate(() => window.__mkitLeaks)).toEqual([]);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  await expect(page.locator("[data-mkit-host]")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("#exam-review-shell")).toBeHidden();
  expect(await page.evaluate(() => window.__mkitLeaks)).toEqual([]);
});

test("starting Practice keeps a live-style question workspace and MKit rail visible", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());

  const host = page.locator("[data-mkit-host]");
  const practice = host.locator("[data-focus-key='practice']");
  await expect(practice).toBeVisible();
  await practice.click();

  const rail = host.locator(".mkit-study-rail");
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");
  await expect(host).toHaveCount(1);
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("Practice");
  await expect(rail.locator("[data-focus-key='answer-A']")).toBeVisible();
  await expect(page.locator("#live-style-question")).toBeVisible();
  await expect(page.locator(".review-answer")).not.toHaveAttribute("data-mkit-hidden", "");
  await expect(page.locator(".review-answer label")).toBeHidden();
  await expect(page.locator(".view-answers.switchable")).toBeHidden();

  expect(
    await page.evaluate(() => {
      const hostElement = document.querySelector<HTMLElement>("[data-mkit-host]");
      const railElement = hostElement?.shadowRoot?.querySelector<HTMLElement>(".mkit-study-rail");
      const hostStyle = hostElement ? getComputedStyle(hostElement) : null;
      const railStyle = railElement ? getComputedStyle(railElement) : null;
      return {
        bodyTextLength: document.body.innerText.trim().length,
        hostParent: hostElement?.parentElement?.localName ?? null,
        hostPointerEvents: hostStyle?.pointerEvents ?? null,
        railHeight: railElement?.getBoundingClientRect().height ?? 0,
        railPointerEvents: railStyle?.pointerEvents ?? null,
        railWidth: railElement?.getBoundingClientRect().width ?? 0,
      };
    }),
  ).toMatchObject({
    bodyTextLength: expect.any(Number),
    hostParent: "body",
    hostPointerEvents: "none",
    railPointerEvents: "auto",
  });
  expect(await page.evaluate(() => document.body.innerText.trim().length)).toBeGreaterThan(0);
  expect(
    await rail.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }),
  ).toBe(true);
});

test("Practice keeps scroll stable while masking same-question mutations", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());
  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  await expect(host.locator(".mkit-study-rail")).toBeVisible();

  const initialScroll = await page.evaluate(() => {
    scrollTo(0, 720);
    return scrollY;
  });
  expect(initialScroll).toBeGreaterThan(500);

  await page.evaluate(() => {
    const spoiler = document.createElement("div");
    spoiler.id = "same-question-delayed-status";
    spoiler.className = "review-status is-correct";
    spoiler.textContent = "Synthetic delayed status.";
    document.querySelector(".question-container")?.append(spoiler);
  });
  await expect(page.locator("#same-question-delayed-status")).toBeHidden();
  await page.waitForTimeout(300);

  const settled = await page.evaluate(() => ({
    protection: document.documentElement.dataset.mkitProtection,
    scrollY,
  }));
  expect(settled.protection).toBe("masked");
  expect(Math.abs(settled.scrollY - initialScroll)).toBeLessThanOrEqual(1);
  await expect(host.locator(".mkit-study-rail")).toBeVisible();
});

test("Practice neutralizes source correctness visuals without removing layout styles", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/live-review");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());
  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();

  const maskedStyles = await page.evaluate(() => {
    const question = document.querySelector<HTMLElement>(".answer-container.question-container");
    const choices = document.querySelector<HTMLElement>("ul.question-choices-multi.results");
    if (!question || !choices) throw new Error("Synthetic workspace is missing.");
    return {
      question: {
        boxShadow: question.style.boxShadow,
        outline: question.style.outline,
        padding: question.style.padding,
      },
      choices: {
        backgroundColor: choices.style.backgroundColor,
        border: choices.style.border,
        paddingLeft: choices.style.paddingLeft,
      },
    };
  });
  expect(maskedStyles).toEqual({
    question: { boxShadow: "", outline: "", padding: "16px" },
    choices: { backgroundColor: "", border: "", paddingLeft: "32px" },
  });

  await page.evaluate(() => window.__mkitPrivacyHarness.normalReview());
  const restoredStyles = await page.evaluate(() => ({
    question: document
      .querySelector<HTMLElement>(".answer-container.question-container")
      ?.getAttribute("style"),
    choices: document
      .querySelector<HTMLElement>("ul.question-choices-multi.results")
      ?.getAttribute("style"),
  }));
  expect(restoredStyles).toEqual({
    question: "padding: 16px; outline: 5px solid green; box-shadow: 0 0 0 4px red",
    choices: "padding-left: 32px; border: 5px solid red; background-color: pink",
  });
});

test("Practice conceals the complete live-style feedback boundary until intentional reveal", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/live-review");
  const initialFeedbackState = await snapshotLiveFeedbackState(page);
  const initialQuestionState = await snapshotLiveQuestionState(page);
  const initialQuestionClasses = await page
    .locator("#live-question-container")
    .getAttribute("class");
  await page.evaluate(() => window.__mkitPrivacyHarness.startController());
  const host = page.locator("[data-mkit-host]");
  await host.locator("[data-focus-key='practice']").click();
  const rail = host.locator(".mkit-study-rail");
  await rail.locator("[data-focus-key='answer-A']").click();
  await expect(rail.locator("[data-focus-key='check']")).toBeEnabled();

  await page.evaluate(() => {
    scrollTo(0, 900);
    const delayedResult = document.createElement("section");
    delayedResult.id = "delayed-live-result";
    delayedResult.className = "result-wrapper";
    delayedResult.textContent = "MKIT_LIVE_DELAYED_RESULT_1C50";
    document.querySelector(".choices-container")?.append(delayedResult);

    const delayedExplanation = document.createElement("section");
    delayedExplanation.id = "delayed-live-explanation";
    delayedExplanation.className = "expander-content";
    delayedExplanation.textContent = "MKIT_LIVE_DELAYED_EXPLANATION_5D29";
    document.querySelector(".content-container")?.append(delayedExplanation);

    const delayedInlineContainer = document.createElement("div");
    delayedInlineContainer.id = "delayed-inline-feedback-container";
    delayedInlineContainer.className = "answer-container incorrect is-hidden question-container";
    const delayedInlineRegion = document.createElement("div");
    delayedInlineRegion.id = "delayed-inline-feedback";
    delayedInlineRegion.setAttribute("role", "region");
    delayedInlineRegion.textContent = "MKIT_LIVE_DELAYED_INLINE_SOLUTION_6E83";
    delayedInlineContainer.append(delayedInlineRegion);
    document.querySelector(".content-container")?.append(delayedInlineContainer);

    dispatchEvent(new PopStateEvent("popstate", { state: { synthetic: true } }));
  });
  await expect(page.locator("html")).toHaveAttribute("data-mkit-protection", "masked");

  for (const selector of [
    ".sidebar-container",
    ".choices-container",
    ".result-wrapper",
    ".topbar-result-wrapper",
    "#inline-feedback",
    "#fallback-solution",
    "#known-feedback",
    "#delayed-live-result",
    "#delayed-inline-feedback",
    "#delayed-live-explanation",
  ]) {
    await expect(page.locator(selector).first(), selector).toBeHidden();
  }
  await expect(page.locator("#live-style-question")).toBeVisible();
  await expect(page.locator("#live-question-image")).toBeVisible();
  await expect(page.locator("#live-question-svg")).toBeVisible();
  await expect(page.locator("#live-question-container")).toHaveAttribute(
    "class",
    initialQuestionClasses ?? "",
  );
  expect(await snapshotLiveQuestionState(page)).toEqual(initialQuestionState);
  await expect(rail).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await expect(page.locator("#inline-feedback-container")).toHaveClass(/\bcorrect\b/);

  const cdp = await page.context().newCDPSession(page);
  const axText = JSON.stringify(await cdp.send("Accessibility.getFullAXTree"));
  for (const sentinel of LIVE_FEEDBACK_SPOILERS) {
    expect(axText).not.toContain(sentinel);
  }

  const absentFromFind = await page.evaluate((sentinels) => {
    return sentinels.every(
      (sentinel) => !window.find(sentinel, false, false, true, false, false, false),
    );
  }, LIVE_FEEDBACK_SPOILERS);
  expect(absentFromFind).toBe(true);

  const selectedText = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.documentElement);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  for (const sentinel of LIVE_FEEDBACK_SPOILERS) {
    expect(selectedText).not.toContain(sentinel);
  }

  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ printBackground: true });
  for (const sentinel of LIVE_FEEDBACK_SPOILERS) {
    expect(pdf.includes(Buffer.from(sentinel))).toBe(false);
  }
  await page.emulateMedia({ media: "screen" });

  await rail.locator("[data-focus-key='check']").click();
  await expect(page.locator("#inline-feedback")).toBeVisible();
  await expect(page.locator("#inline-feedback-container")).toHaveClass(/\bcorrect\b/);
  await expect(page.locator("#delayed-inline-feedback")).toBeVisible();
  await expect(page.locator("#known-feedback")).toBeVisible();
  await expect(page.locator(".sidebar-container")).toBeHidden();
  await expect(page.locator("#fallback-solution")).toBeHidden();

  await page.evaluate(() => window.__mkitPrivacyHarness.normalReview());
  await expect(page.locator(".sidebar-container")).toBeVisible();
  await expect(page.locator("#fallback-solution")).toBeVisible();
  await expect(page.locator("#delayed-live-result")).toBeVisible();
  await expect(page.locator("#delayed-live-explanation")).toBeVisible();
  await expect(page.locator("#delayed-inline-feedback")).toBeVisible();
  expect(
    await page.locator("#delayed-inline-feedback-container").evaluate((element) => ({
      attributes: [...element.attributes]
        .map(({ name, value }) => [name, value] as [string, string])
        .sort(([left], [right]) => left.localeCompare(right)),
      hidden: element instanceof HTMLElement ? element.hidden : null,
      inert: element instanceof HTMLElement ? element.inert : null,
    })),
  ).toEqual({
    attributes: [
      ["class", "answer-container incorrect is-hidden question-container"],
      ["id", "delayed-inline-feedback-container"],
    ],
    hidden: false,
    inert: false,
  });
  expect(await snapshotLiveFeedbackState(page)).toEqual(initialFeedbackState);
  expect(await snapshotLiveQuestionState(page)).toEqual(initialQuestionState);
  await expect(page.locator("#live-question-container")).toHaveAttribute(
    "class",
    initialQuestionClasses ?? "",
  );
});

test("masked review removes spoilers from display, AX, Find, selection, and print", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>("#official-a")?.focus();
    const status = document.querySelector("#question-status");
    if (!status) return;
    const range = document.createRange();
    range.selectNodeContents(status);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  const report = await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());
  expect(report.safeToReveal).toBe(true);
  expect(
    await page.evaluate(() => ({
      activeId: document.activeElement?.id ?? "",
      selection: getSelection()?.toString() ?? "",
    })),
  ).toEqual({ activeId: "", selection: "" });
  await page.evaluate(() => document.querySelector<HTMLInputElement>("#official-a")?.focus());
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).not.toBe("official-a");

  const leaks = await page.locator("[data-synth-spoiler]").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          element.getClientRects().length > 0
        );
      })
      .map((element) => element.id || element.textContent),
  );
  expect(leaks).toEqual([]);
  await expect(page.locator("#allowed-question")).toBeVisible();
  await expect(page.locator("#allowed-passage")).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  const axTree = await cdp.send("Accessibility.getFullAXTree");
  const axText = JSON.stringify(axTree);
  for (const sentinel of REVIEW_SPOILERS) {
    expect(axText).not.toContain(sentinel);
  }

  const findLeaks = await page.evaluate((sentinels) => {
    const leaked: string[] = [];
    for (const sentinel of sentinels) {
      getSelection()?.removeAllRanges();
      if (window.find(sentinel, false, false, true, false, false, false)) {
        leaked.push(sentinel);
      }
    }
    return leaked;
  }, REVIEW_SPOILERS);
  expect(findLeaks).toEqual([]);

  const selectedText = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.documentElement);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  for (const sentinel of REVIEW_SPOILERS) {
    expect(selectedText).not.toContain(sentinel);
  }

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    addEventListener(
      "beforeprint",
      () => {
        const delayed = document.createElement("div");
        delayed.id = "beforeprint-spoiler";
        delayed.className = "review-status is-correct";
        delayed.dataset.synthSpoiler = "";
        delayed.textContent = "MKIT_BEFOREPRINT_CORRECT_3FA9";
        document.body.append(delayed);
      },
      { once: true },
    );
    dispatchEvent(new Event("beforeprint"));
  });
  await expect(page.locator("#exam-review-shell")).toBeHidden();
  await expect(page.locator("#beforeprint-spoiler")).toBeHidden();
  const pdf = await page.pdf({ printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(500);
  expect(pdf.includes(Buffer.from("MKIT_BEFOREPRINT_CORRECT_3FA9"))).toBe(false);
  for (const sentinel of REVIEW_SPOILERS) {
    expect(pdf.includes(Buffer.from(sentinel))).toBe(false);
  }

  const pdfPage = await page.context().newPage();
  await pdfPage.goto(`data:application/pdf;base64,${pdf.toString("base64")}`);
  await pdfPage.waitForTimeout(250);
  const pdfCdp = await pdfPage.context().newCDPSession(pdfPage);
  const pdfAxText = JSON.stringify(await pdfCdp.send("Accessibility.getFullAXTree"));
  expect(pdfAxText).not.toContain("MKIT_BEFOREPRINT_CORRECT_3FA9");
  for (const sentinel of REVIEW_SPOILERS) {
    expect(pdfAxText).not.toContain(sentinel);
  }
  await pdfPage.close();
});

test("delayed, class-only, route, root, and body replacements remask before a frame", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());

  const mutationLeaks = await page.evaluate(async () => {
    const leaks: string[] = [];
    const sample = (id: string) => {
      const element = document.querySelector<HTMLElement>(`#${id}`);
      if (!element) return;
      const style = getComputedStyle(element);
      if (style.display !== "none" && element.getClientRects().length > 0) leaks.push(id);
    };
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const delayed = document.createElement("div");
    delayed.id = "delayed-status";
    delayed.className = "review-status is-correct";
    delayed.title = "MKIT_DELAYED_TITLE_665B";
    delayed.textContent = "MKIT_DELAYED_STATUS_87D2";
    document.querySelector("#question-q1")?.append(delayed);
    await nextFrame();
    sample("delayed-status");

    const portal = document.createElement("div");
    portal.id = "body-portal-tooltip";
    portal.setAttribute("role", "tooltip");
    portal.setAttribute("data-review-result", "incorrect");
    portal.textContent = "MKIT_BODY_PORTAL_TOOLTIP_C750";
    document.body.append(portal);
    await nextFrame();
    sample("body-portal-tooltip");

    document.querySelector("#choice-c")?.classList.add("is-correct");
    await nextFrame();
    if (document.querySelector("#choice-c")?.classList.contains("is-correct")) {
      leaks.push("class-only-choice-c");
    }

    history.pushState({}, "", "/review?question=2");
    document
      .querySelector("#exam-review-shell")
      ?.insertAdjacentHTML(
        "beforeend",
        '<div id="route-status" class="review-status is-incorrect">MKIT_ROUTE_STATUS_142F</div>',
      );
    await nextFrame();
    sample("route-status");

    const markup = window.__freshReviewMarkup;
    document
      .querySelector("#exam-review-shell")
      ?.replaceWith(document.createRange().createContextualFragment(markup));
    await nextFrame();
    sample("question-status");

    document.body.innerHTML = markup;
    await nextFrame();
    sample("question-status");
    return leaks;
  });

  expect(mutationLeaks).toEqual([]);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
});

test("unsupported layouts stay covered and Normal review restores native state", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.locator("#question-navigator").evaluate((element) => element.remove());
  const unsupportedNativeState = await snapshotNativeState(page);
  const report = await page.evaluate(() => window.__mkitPrivacyHarness.mask());

  expect(report.safeToReveal).toBe(false);
  expect(report.issues).toContain("NAVIGATOR_MISSING");
  await expect(page.locator("#exam-review-shell")).toBeHidden();
  await expect(page.locator("[data-mkit-host]")).toBeVisible();

  await page.evaluate(() => window.__mkitPrivacyHarness.normalReview());
  await expect(page.locator("#exam-review-shell")).toBeVisible();
  expect(await snapshotNativeState(page)).toEqual(unsupportedNativeState);
});

test("protection and grading never trigger native answers, submit, or reset", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/review");
  const result = await page.evaluate(() => {
    window.__mkitPrivacyHarness.maskAndObserve();
    const outcomes = (["A", "B", "C", "D"] as const).map((choice) =>
      window.__mkitPrivacyHarness.grade(choice),
    );
    window.__mkitPrivacyHarness.normalReview();
    return { events: window.__nativeEvents, outcomes };
  });

  expect(result.events).toEqual({ answer: 0, next: 0, previous: 0, reset: 0, submit: 0 });
  expect(result.outcomes).toEqual(["needs-review", "correct", "needs-review", "needs-review"]);
});

test("route signals remask without duplicate hosts or native actions", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());

  const routeStates = await page.evaluate(async () => {
    const states: string[] = [];
    const settlePoll = () => new Promise((resolve) => window.setTimeout(resolve, 300));
    const capture = () => states.push(document.documentElement.dataset.mkitProtection ?? "");

    history.replaceState({}, "", "/review?question=2");
    await settlePoll();
    capture();

    location.hash = "question-3";
    await settlePoll();
    capture();

    dispatchEvent(new PopStateEvent("popstate", { state: { question: 2 } }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    capture();

    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    capture();

    return {
      events: window.__nativeEvents,
      hostCount: document.querySelectorAll("[data-mkit-host]").length,
      states,
    };
  });

  expect(routeStates.states).toEqual(["masked", "masked", "masked", "masked"]);
  expect(routeStates.hostCount).toBe(1);
  expect(routeStates.events).toEqual({
    answer: 0,
    next: 0,
    previous: 0,
    reset: 0,
    submit: 0,
  });
});

test("Normal review restores the latest page-authored attributes, classes, styles, and checked state", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());

  const restored = await page.evaluate(async () => {
    const choice = document.querySelector<HTMLElement>("#choice-c");
    const input = document.querySelector<HTMLInputElement>("#official-c");
    if (!choice || !input) throw new Error("Synthetic choice C is missing.");

    choice.title = "MKIT_LATEST_PAGE_TITLE_103A";
    choice.setAttribute("aria-label", "MKIT_LATEST_PAGE_ARIA_749B");
    choice.setAttribute("style", "border: 6px solid blue");
    choice.classList.add("is-correct");
    input.checked = true;
    input.setAttribute("checked", "");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const masked = {
      aria: choice.getAttribute("aria-label"),
      correctClass: choice.classList.contains("is-correct"),
      style: choice.getAttribute("style"),
      title: choice.getAttribute("title"),
    };
    window.__mkitPrivacyHarness.normalReview();
    return {
      masked,
      restored: {
        aria: choice.getAttribute("aria-label"),
        checked: input.checked,
        checkedAttribute: input.hasAttribute("checked"),
        classAttribute: choice.getAttribute("class"),
        style: choice.getAttribute("style"),
        title: choice.getAttribute("title"),
      },
    };
  });

  expect(restored.masked).toEqual({
    aria: null,
    correctClass: false,
    style: null,
    title: null,
  });
  expect(restored.restored).toEqual({
    aria: "MKIT_LATEST_PAGE_ARIA_749B",
    checked: true,
    checkedAttribute: true,
    classAttribute: "answer-choice is-correct",
    style: "border: 6px solid blue",
    title: "MKIT_LATEST_PAGE_TITLE_103A",
  });
});

test("keyboard bindings preserve browser shortcuts, editable fields, and native controls", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  const result = await page.evaluate(() => {
    window.__mkitPrivacyHarness.mask();
    window.__mkitPrivacyHarness.setKeyboardEnabled(true);

    const dispatch = (target: EventTarget, key: string, init: KeyboardEventInit = {}): boolean => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    const bodyResults = [
      dispatch(document.body, "a"),
      dispatch(document.body, "2"),
      dispatch(document.body, "C", { shiftKey: true }),
      dispatch(document.body, "Enter"),
      dispatch(document.body, "f"),
      dispatch(document.body, "r"),
      dispatch(document.body, "["),
      dispatch(document.body, "]"),
    ];
    const editablePrevented = dispatch(document.querySelector("#official-a") ?? document.body, "d");
    const shortcutResults = [
      dispatch(document.body, "f", { metaKey: true }),
      dispatch(document.body, "c", { metaKey: true }),
      dispatch(document.body, "v", { metaKey: true }),
      dispatch(document.body, "p", { metaKey: true }),
      dispatch(document.body, "r", { metaKey: true }),
      dispatch(document.body, "l", { metaKey: true }),
      dispatch(document.body, "f", { ctrlKey: true }),
    ];

    return {
      bodyResults,
      editablePrevented,
      keyboard: window.__mkitPrivacyHarness.keyboardLog(),
      native: window.__nativeEvents,
      shortcutResults,
    };
  });

  expect(result.bodyResults).toEqual([true, true, true, true, true, true, true, true]);
  expect(result.editablePrevented).toBe(false);
  expect(result.shortcutResults).toEqual([false, false, false, false, false, false, false]);
  expect(result.keyboard).toEqual({
    checks: 1,
    eliminations: ["C"],
    flags: 1,
    navigation: ["previous", "next"],
    reviewAgain: 1,
    selections: ["A", "B"],
  });
  expect(result.native).toEqual({ answer: 0, next: 0, previous: 0, reset: 0, submit: 0 });
});

test("documentElement replacement stays veiled and remounts one recovery host", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/review");
  await page.evaluate(() => window.__mkitPrivacyHarness.maskAndObserve());
  const preflightCss = await readFile(resolve(process.cwd(), "src/content/preflight.css"), "utf8");

  await page.evaluate(
    async ({ css }) => {
      const replacement = document.createElement("html");
      replacement.lang = "en";
      replacement.innerHTML = `
        <head><style>${css}</style></head>
        <body>${window.__freshReviewMarkup}</body>
      `;
      document.documentElement.replaceWith(replacement);
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    },
    { css: preflightCss },
  );

  const visibleSpoilers = await page.locator("[data-synth-spoiler]").evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && element.getClientRects().length > 0;
      }).length,
  );
  expect(visibleSpoilers).toBe(0);
  await expect(page.locator("[data-mkit-host]")).toHaveCount(1);
  await expect(page.locator("[data-mkit-host]")).toBeVisible();
});

async function snapshotNativeState(
  page: import("@playwright/test").Page,
): Promise<Array<{ attributes: Array<[string, string]>; checked: boolean | null; id: string }>> {
  return page.locator("#exam-review-shell, #exam-review-shell *").evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.id,
      attributes: [...element.attributes]
        .map(
          ({ name, value }) =>
            [
              name,
              name === "class" ? value.split(/\s+/).filter(Boolean).sort().join(" ") : value,
            ] as [string, string],
        )
        .sort(([left], [right]) => left.localeCompare(right)),
      checked: element instanceof HTMLInputElement ? element.checked : null,
    })),
  );
}

async function snapshotLiveFeedbackState(
  page: import("@playwright/test").Page,
): Promise<Array<{ attributes: Array<[string, string]>; hidden: boolean; selector: string }>> {
  return page.evaluate(() => {
    const selectors = [
      ".sidebar-container",
      ".choices-container",
      ".result-wrapper",
      ".topbar-result-wrapper",
      "#inline-feedback-container",
      "#inline-feedback",
      "#fallback-solution",
      "#known-feedback",
    ];
    return selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing synthetic feedback element: ${selector}`);
      return {
        selector,
        attributes: [...element.attributes]
          .map(({ name, value }) => [name, value] as [string, string])
          .sort(([left], [right]) => left.localeCompare(right)),
        hidden: element.hidden === true,
      };
    });
  });
}

async function snapshotLiveQuestionState(
  page: import("@playwright/test").Page,
): Promise<Array<{ attributes: Array<[string, string]>; text: string | null }>> {
  return page
    .locator(
      "#live-question-region, #live-style-question, #live-question-image, #live-question-svg, #live-question-svg *",
    )
    .evaluateAll((elements) =>
      elements.map((element) => ({
        attributes: [...element.attributes]
          .map(({ name, value }) => [name, value] as [string, string])
          .sort(([left], [right]) => left.localeCompare(right)),
        text: element.childElementCount === 0 ? element.textContent : null,
      })),
    );
}
