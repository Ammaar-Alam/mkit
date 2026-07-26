import { describe, expect, it } from "vitest";
import { AamcFullLengthReviewAdapter } from "../../../src/adapter/AamcFullLengthReviewAdapter";
import {
  FORBIDDEN_SERIALIZED_SENTINELS,
  mountCompleteReviewFixture,
  mountConfirmedAnchorScoreFixture,
  mountScoreReportFixture,
  REVIEW_SENTINELS,
  requiredElement,
} from "../../fixtures/review";

const REVIEW_URL = () => new URL("https://synthetic.invalid/completed/review");
const SCORE_URL = () => new URL("https://synthetic.invalid/completed/score");
const CONFIRMED_REVIEW_URL = () =>
  new URL(
    "https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1#exams/answers/synthetic-exam/synthetic-question",
  );
const CONFIRMED_SECTION_REVIEW_URL = () =>
  new URL(
    "https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question",
  );

describe("AamcFullLengthReviewAdapter capabilities", () => {
  it("recognizes a complete synthetic review without serializing page content or answer keys", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    expect(adapter.inspectCapabilities()).toEqual({
      pageKind: "review",
      safeToReveal: true,
      questionRegionFound: true,
      answerChoiceCount: 4,
      navigatorFound: true,
      feedbackRegionFound: true,
      explanationFound: true,
      correctAnswerParseable: true,
      categoryCodeFound: true,
      scoreRegionCount: 0,
      reviewControlFound: false,
      issues: [],
    });

    const serialized = JSON.stringify({
      capability: adapter.inspectCapabilities(),
      context: await adapter.getQuestionContext(),
      examKey: await adapter.getExamKey(),
      outcomes: ["A", "B", "C", "D"].map((selection) =>
        adapter.gradeFresh(selection as "A" | "B" | "C" | "D"),
      ),
    });

    for (const sentinel of FORBIDDEN_SERIALIZED_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toContain('"correctChoice"');
    expect(serialized).not.toContain('"correctAnswer"');
    expect(serialized).not.toContain('"answerKey"');
  });

  it("fails closed with exact issue codes when required review capabilities are absent", () => {
    const root = mountCompleteReviewFixture();
    requiredElement("#question-navigator").remove();
    requiredElement("#official-solution").remove();
    requiredElement("#question-status").remove();
    requiredElement(".correct-marker").remove();
    requiredElement("#choice-d").remove();
    root.removeAttribute("data-exam-id");
    requiredElement("#question-q1").removeAttribute("data-question-id");
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    const report = adapter.inspectCapabilities();

    expect(report.safeToReveal).toBe(false);
    expect(report.issues).toEqual([
      "QUESTION_REGION_MISSING",
      "ANSWER_CHOICES_INCOMPLETE",
      "NAVIGATOR_MISSING",
      "FEEDBACK_REGION_MISSING",
      "STABLE_EXAM_ID_MISSING",
      "STABLE_QUESTION_ID_MISSING",
    ]);
  });

  it("fails closed for unverified child frames and unsupported shadow-root layouts", () => {
    const root = mountCompleteReviewFixture();
    root.insertAdjacentHTML(
      "beforeend",
      '<iframe title="synthetic child frame"></iframe><div data-mkit-fixture-closed-shadow></div>',
    );
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["CHILD_FRAME_UNVERIFIED", "SHADOW_ROOT_UNSUPPORTED"],
    });
  });
});

describe("AamcFullLengthReviewAdapter clean slate", () => {
  it("masks every native spoiler surface while leaving allowed study content intact", () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    adapter.applyCleanSlate();

    for (const selector of [
      "#question-navigator",
      "#official-results-rail",
      "#question-status",
      "#official-solution",
      "#official-metadata",
      "#spoiler-tooltip",
      "#official-a",
      "#official-b",
      "#official-c",
      "#official-d",
      ".correct-marker",
      ".original-marker",
    ]) {
      expectHiddenFromInteraction(requiredElement<HTMLElement>(selector));
    }

    for (const selector of [
      "#nav-q1",
      "#nav-q2",
      "#question-status",
      "#choice-a",
      "#choice-b",
      "#tooltip-trigger",
    ]) {
      const element = requiredElement(selector);
      expect(element.getAttribute("title")).toBeNull();
      expect(element.getAttribute("aria-label")).toBeNull();
      expect(element.getAttribute("aria-describedby")).toBeNull();
    }

    expect(requiredElement("#choice-a").classList.contains("is-incorrect")).toBe(false);
    expect(requiredElement("#choice-a").classList.contains("was-selected")).toBe(false);
    expect(requiredElement("#choice-a").classList.contains("was-highlighted")).toBe(false);
    expect(requiredElement("#choice-b").classList.contains("is-correct-answer")).toBe(false);
    expect(requiredElement("#choice-b").classList.contains("was-eliminated")).toBe(false);
    expect(requiredElement("#choice-a").getAttribute("style")).toBeNull();
    expect(requiredElement("#choice-b").getAttribute("style")).toBeNull();

    expect(requiredElement("#question-copy").textContent).toBe(REVIEW_SENTINELS.question);
    expect(requiredElement("#passage-copy").textContent).toBe(REVIEW_SENTINELS.passage);
    expect(requiredElement("#choice-a .choice-copy").textContent).toBe(REVIEW_SENTINELS.choiceA);
    expect(requiredElement("#choice-b .choice-copy").textContent).toBe(REVIEW_SENTINELS.choiceB);
  });

  it("reveals feedback and original attempt only in their deliberate stages", () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();

    adapter.revealFeedback();

    expect(requiredElement<HTMLElement>("#official-solution").hidden).toBe(false);
    expect(requiredElement<HTMLElement>(".correct-marker").hidden).toBe(false);
    expectHiddenFromInteraction(requiredElement<HTMLElement>(".original-marker"));

    adapter.revealOriginalAttempt();

    expect(requiredElement<HTMLElement>(".original-marker").hidden).toBe(false);
  });

  it("restores the untouched native page exactly after repeated masking", () => {
    const root = mountCompleteReviewFixture();
    const originalNodes = new Map(
      [...root.querySelectorAll<HTMLElement>("*")].map((element) => [
        element.id || stableFixturePath(element),
        element,
      ]),
    );
    const originalState = snapshotTree(root);
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    adapter.applyCleanSlate();
    adapter.applyCleanSlate();
    adapter.revealFeedback();
    adapter.remaskQuestion();
    adapter.restoreNormalReview();

    expect(snapshotTree(root)).toEqual(originalState);
    for (const [key, element] of originalNodes) {
      const current = [...root.querySelectorAll<HTMLElement>("*")].find(
        (candidate) => (candidate.id || stableFixturePath(candidate)) === key,
      );
      expect(current).toBe(element);
    }
  });

  it("grades to an outcome only and stores no original or correct key in the return value", () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    expect(adapter.gradeFresh("A")).toBe("needs-review");
    expect(adapter.gradeFresh("B")).toBe("correct");
    expect(adapter.gradeFresh("C")).toBe("needs-review");
    expect(adapter.gradeFresh("D")).toBe("needs-review");
    expect(new Set(["A", "B", "C", "D"]).has(adapter.gradeFresh("B"))).toBe(false);

    requiredElement("#question-q1").removeAttribute("data-correct-choice");
    expect(adapter.gradeFresh("B")).toBe("unknown");
  });

  it("masks image, SVG, table, dropdown, and progress-strip spoiler variants", () => {
    mountCompleteReviewFixture();
    requiredElement("#choice-b").insertAdjacentHTML(
      "beforeend",
      `
        <img
          id="image-correct-marker"
          class="correct-marker"
          alt="MKIT_IMAGE_ALT_CORRECT_52C0"
          title="MKIT_IMAGE_TITLE_CORRECT_9A72"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
        >
        <svg id="svg-correct-marker" class="correct-marker" role="img">
          <title>MKIT_SVG_TITLE_CORRECT_A812</title>
          <desc>MKIT_SVG_DESC_CORRECT_D71C</desc>
          <circle cx="5" cy="5" r="4"></circle>
        </svg>
      `,
    );
    requiredElement("#official-solution").insertAdjacentHTML(
      "beforeend",
      `
        <table id="solution-table">
          <caption>MKIT_TABLE_EXPLANATION_CAPTION_B0F4</caption>
          <tbody><tr><th>Result</th><td>MKIT_TABLE_CORRECT_CELL_2D77</td></tr></tbody>
        </table>
      `,
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <select id="navigator-dropdown" data-mkit-fixture="navigator" aria-label="Question navigator">
          <option>1 — MKIT_DROPDOWN_INCORRECT_18B1</option>
        </select>
        <div id="navigator-progress" data-mkit-fixture="navigator">
          MKIT_PROGRESS_CORRECT_0C43
        </div>
      `,
    );
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);

    adapter.applyCleanSlate();

    for (const selector of [
      "#image-correct-marker",
      "#svg-correct-marker",
      "#solution-table",
      "#navigator-dropdown",
      "#navigator-progress",
    ]) {
      const element = requiredElement(selector);
      const hiddenAncestor = element.closest("[data-mkit-hidden]");
      expect(hiddenAncestor, `${selector} must have a hidden spoiler ancestor`).not.toBeNull();
      expect(hiddenAncestor?.getAttribute("aria-hidden"), selector).toBe("true");
      expect(hiddenAncestor?.hasAttribute("data-mkit-hidden"), selector).toBe(true);
      if (hiddenAncestor instanceof HTMLElement) {
        expect(hiddenAncestor.hidden, selector).toBe(true);
        expect(hiddenAncestor.inert, selector).toBe(true);
      }
    }
  });
});

describe("AamcFullLengthReviewAdapter score shielding", () => {
  it("reports score capabilities, masks values and labels, and restores the score report exactly", () => {
    const root = mountScoreReportFixture();
    const originalState = snapshotTree(root);
    const adapter = new AamcFullLengthReviewAdapter(document, SCORE_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      pageKind: "score-report",
      safeToReveal: true,
      scoreRegionCount: 3,
      reviewControlFound: true,
      issues: [],
    });

    adapter.applyScoreShield();

    expectHiddenFromInteraction(requiredElement<HTMLElement>("#total-score"));
    for (const score of document.querySelectorAll<HTMLElement>(".section-score")) {
      expectHiddenFromInteraction(score);
    }
    expect(requiredElement("#score-summary").getAttribute("title")).toBeNull();
    expect(requiredElement("#score-summary").getAttribute("aria-label")).toBeNull();

    adapter.revealScores();

    expect(snapshotTree(root)).toEqual(originalState);
  });
});

describe("AamcFullLengthReviewAdapter confirmed production boundary", () => {
  it("grades one wrapperless active-root choice snapshot and rejects active ambiguity", () => {
    mountConfirmedProductionFixture();
    const correctChoice = requiredElement(".multi-choice.corrected");
    correctChoice.classList.replace("corrected", "correct");
    const choiceWrapper = requiredElement(".question-choices-multi.results");
    const activeChoices = [...choiceWrapper.querySelectorAll(".multi-choice")];
    const structuralQuestion = requiredElement<HTMLElement>("#confirmed-question-container");
    const visibleWorkspace = requiredElement<HTMLElement>("#confirmed-question-region");
    structuralQuestion.style.visibility = "hidden";
    visibleWorkspace.style.visibility = "visible";
    visibleWorkspace.append(...activeChoices);
    choiceWrapper.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <article class="reviewable" style="display: none">
          <div class="question-content-container">
            <div class="multi-choice correct"></div>
            <div class="multi-choice"></div>
            <div class="multi-choice"></div>
            <div class="multi-choice"></div>
          </div>
        </article>
        <aside class="reviewable">
          <div class="result-wrapper">
            <div class="result"></div>
          </div>
        </aside>
      `,
    );
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(document.querySelector("ul.question-choices-multi.results")).toBeNull();
    expect(visibleWorkspace.querySelectorAll(".multi-choice")).toHaveLength(4);
    expect(adapter.inspectCapabilities()).toMatchObject({
      answerChoiceCount: 4,
      correctAnswerParseable: true,
      safeToReveal: true,
    });
    adapter.applyCleanSlate();

    expect(correctChoice.classList.contains("correct")).toBe(false);
    expect(structuralQuestion.classList.contains("correct")).toBe(true);
    expect(adapter.gradeFresh("A")).toBe("needs-review");
    expect(adapter.gradeFresh("B")).toBe("correct");
    expect(correctChoice.classList.contains("correct")).toBe(false);

    activeChoices[0]?.classList.add("correct");
    adapter.applyCleanSlate();
    expect(adapter.gradeFresh("B")).toBe("unknown");
  });

  it("rejects multiple visible review roots that each own answer choices", () => {
    mountConfirmedProductionFixture();
    const duplicate = requiredElement(".reviewable").cloneNode(true);
    document.body.append(duplicate);
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      answerChoiceCount: 0,
      safeToReveal: false,
    });
  });

  it("admits one visible external review switch and ignores its hidden responsive duplicate", () => {
    mountConfirmedProductionFixture();
    const reviewRoot = requiredElement(".reviewable");
    const toolbar = requiredElement(".answer-toolbar-wrapper");
    const card = requiredElement(".luca-ui-card");
    card.append(toolbar);
    const hiddenToolbar = toolbar.cloneNode(true);
    if (!(hiddenToolbar instanceof HTMLElement)) {
      throw new Error("Expected an HTML toolbar clone.");
    }
    hiddenToolbar.style.display = "none";
    card.append(hiddenToolbar);
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(reviewRoot.querySelector(".view-answers.switchable")).toBeNull();
    expect(document.querySelectorAll(".view-answers.switchable")).toHaveLength(2);
    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      issues: [],
    });

    adapter.applyCleanSlate();
    const replacementAdapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);
    expect(replacementAdapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      issues: [],
    });
  });

  it("admits a visually hidden switch input whose owning control is visible", () => {
    mountConfirmedProductionFixture();
    const toolbar = requiredElement(".answer-toolbar-wrapper");
    const card = requiredElement(".luca-ui-card");
    card.append(toolbar);
    const hiddenToolbar = toolbar.cloneNode(true);
    if (!(hiddenToolbar instanceof HTMLElement)) {
      throw new Error("Expected an HTML toolbar clone.");
    }
    card.append(hiddenToolbar);
    // The live control paints its own affordance and leaves the native input at
    // zero opacity in both the visible and the responsive duplicate copy.
    for (const input of document.querySelectorAll<HTMLElement>(".view-answers.switchable")) {
      input.style.opacity = "0";
    }
    const duplicateLabel = hiddenToolbar.querySelector<HTMLElement>(".review-answer");
    if (!duplicateLabel) throw new Error("Expected a duplicate review-answer control.");
    duplicateLabel.style.display = "none";
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(document.querySelectorAll(".view-answers.switchable")).toHaveLength(2);
    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      issues: [],
    });
  });

  it("still fails open when two visually hidden inputs both have visible controls", () => {
    mountConfirmedProductionFixture();
    const toolbar = requiredElement(".answer-toolbar-wrapper");
    const card = requiredElement(".luca-ui-card");
    card.append(toolbar);
    card.append(toolbar.cloneNode(true));
    for (const input of document.querySelectorAll<HTMLElement>(".view-answers.switchable")) {
      input.style.opacity = "0";
    }
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["REVIEW_SWITCH_MISSING"],
    });
  });

  it("judges the same page identically while MKit's own boot cover is applied", () => {
    mountConfirmedProductionFixture();
    const toolbar = requiredElement(".answer-toolbar-wrapper");
    const card = requiredElement(".luca-ui-card");
    card.append(toolbar);
    const duplicateToolbar = toolbar.cloneNode(true);
    if (!(duplicateToolbar instanceof HTMLElement)) {
      throw new Error("Expected an HTML toolbar clone.");
    }
    card.append(duplicateToolbar);
    // The live page hides the responsive duplicate control through a stylesheet
    // rule rather than an inline style, so authored concealment is only visible
    // through computed style.
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".mkit-test-responsive-duplicate { display: none; }";
    document.head.append(stylesheet);
    const duplicateLabel = duplicateToolbar.querySelector(".review-answer");
    if (!duplicateLabel) throw new Error("Expected a duplicate review-answer control.");
    duplicateLabel.classList.add("mkit-test-responsive-duplicate");
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(document.querySelectorAll(".view-answers.switchable")).toHaveLength(2);
    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      issues: [],
    });

    // Startup arms the boot cover before capabilities are inspected. That cover
    // hides every direct body child, so it must not read as authored
    // concealment of the review anchors underneath it. A fresh adapter carries
    // no confirmed switch, matching the instance startup actually inspects with.
    document.documentElement.dataset.mkitProtection = "boot";
    const bootAdapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);
    expect(bootAdapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      issues: [],
    });

    // The cover must not loosen admission either. Startup builds a fresh adapter
    // per reconciliation, so a genuinely visible duplicate control stays
    // ambiguous while the cover is applied.
    duplicateLabel.classList.remove("mkit-test-responsive-duplicate");
    const coveredAdapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);
    expect(coveredAdapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["REVIEW_SWITCH_MISSING"],
    });
  });

  it("fails open when the external review switch is missing or ambiguous", () => {
    mountConfirmedProductionFixture();
    const toolbar = requiredElement(".answer-toolbar-wrapper");
    const card = requiredElement(".luca-ui-card");
    card.append(toolbar);
    const duplicateToolbar = toolbar.cloneNode(true);
    card.append(duplicateToolbar);
    const ambiguousAdapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(ambiguousAdapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["REVIEW_SWITCH_MISSING"],
    });

    for (const input of document.querySelectorAll(".view-answers.switchable")) {
      input.remove();
    }
    const missingAdapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);
    expect(missingAdapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["REVIEW_SWITCH_MISSING"],
    });
  });

  it("recognizes only the confirmed route and masks confirmed anchors without reading data-choice", async () => {
    mountConfirmedProductionFixture();
    let nativeNavigationEvents = 0;
    for (const control of document.querySelectorAll(".toolbar-btn")) {
      control.addEventListener("click", () => {
        nativeNavigationEvents += 1;
      });
    }
    const original = snapshotTree(requiredElement(".reviewable"));
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      pageKind: "review",
      safeToReveal: true,
      questionRegionFound: true,
      answerChoiceCount: 4,
      navigatorFound: true,
      feedbackRegionFound: true,
      correctAnswerParseable: true,
      issues: [],
    });
    expect(adapter.gradeFresh("A")).toBe("needs-review");
    expect(adapter.gradeFresh("B")).toBe("correct");

    const context = await adapter.getQuestionContext();
    expect(context).toMatchObject({
      sectionKey: "unknown",
      passageOrDiscrete: "passage",
      categoryCode: null,
    });
    expect(context?.examKey).toMatch(/^[a-f0-9]{64}$/);
    expect(context?.questionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(context)).not.toContain("synthetic-exam");
    expect(JSON.stringify(context)).not.toContain("synthetic-question");

    adapter.applyCleanSlate();
    expect(requiredElement(".review-answer").hasAttribute("data-mkit-hidden")).toBe(true);
    expect(requiredElement(".view-answers.switchable").hasAttribute("data-mkit-hidden")).toBe(true);
    expect(requiredElement(".result-wrapper").hasAttribute("data-mkit-hidden")).toBe(true);
    expect(requiredElement(".sidebar-container").hasAttribute("data-mkit-hidden")).toBe(true);
    expect(requiredElement("#confirmed-inline-feedback").hasAttribute("data-mkit-hidden")).toBe(
      true,
    );
    expect(requiredElement(".expander-content").hasAttribute("data-mkit-hidden")).toBe(true);
    expect(document.querySelector(".multi-choice.corrected")).toBeNull();
    expect(document.querySelector(".multi-choice.incorrect")).toBeNull();
    expect(document.querySelector("#confirmed-question-container.correct")).not.toBeNull();
    expect(requiredElement("#confirmed-question-region").hasAttribute("data-mkit-hidden")).toBe(
      false,
    );
    expect(requiredElement<HTMLElement>("#confirmed-question-copy").hidden).toBe(false);
    expect(requiredElement<HTMLElement>(".answer-container").style.outline).toBe("");
    expect(requiredElement<HTMLElement>(".answer-container").style.boxShadow).toBe("");
    expect(requiredElement<HTMLElement>(".answer-container").style.padding).toBe("12px");
    expect(requiredElement<HTMLElement>(".question-choices-multi").style.border).toBe("");
    expect(requiredElement<HTMLElement>(".question-choices-multi").style.backgroundColor).toBe("");
    expect(requiredElement<HTMLElement>(".question-choices-multi").style.paddingLeft).toBe("24px");
    expect(requiredElement(".toolbar-btn.previous").hasAttribute("data-mkit-hidden")).toBe(false);
    expect(requiredElement(".toolbar-btn.next").hasAttribute("data-mkit-hidden")).toBe(false);
    expect(adapter.navigate("previous")).toBe(false);
    expect(adapter.navigate("next")).toBe(false);
    expect(nativeNavigationEvents).toBe(0);

    const host = document.createElement("div");
    expect(adapter.mountStudyRail(host)).toBe(true);
    expect(host.parentElement).toBe(document.body);
    expect(requiredElement(".reviewable").contains(host)).toBe(false);
    const hostObserver = new MutationObserver(() => undefined);
    hostObserver.observe(document.body, { childList: true });
    expect(adapter.mountStudyRail(host)).toBe(true);
    expect(hostObserver.takeRecords()).toEqual([]);
    hostObserver.disconnect();

    adapter.revealFeedback();
    expect(document.querySelector(".multi-choice.corrected")).not.toBeNull();
    expect(requiredElement<HTMLElement>("#confirmed-inline-feedback").hidden).toBe(false);
    expect(requiredElement<HTMLElement>(".expander-content").hidden).toBe(false);
    expect(requiredElement<HTMLElement>(".result-wrapper").hidden).toBe(true);

    adapter.revealOriginalAttempt();
    expect(requiredElement<HTMLElement>(".result-wrapper").hidden).toBe(false);
    adapter.restoreNormalReview();
    expect(snapshotTree(requiredElement(".reviewable"))).toEqual(original);
  });

  it("admits only the exact completed section route with hashed section context", async () => {
    mountConfirmedProductionFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_SECTION_REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      pageKind: "review",
      safeToReveal: true,
      answerChoiceCount: 4,
      navigatorFound: true,
      feedbackRegionFound: true,
      correctAnswerParseable: true,
      issues: [],
    });
    expect(adapter.gradeFresh("B")).toBe("correct");

    const context = await adapter.getQuestionContext();
    expect(context).toMatchObject({
      passageOrDiscrete: "passage",
      progress: {
        scope: "section",
        current: null,
        total: null,
      },
    });
    expect(context?.examKey).toMatch(/^[a-f0-9]{64}$/);
    expect(context?.questionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(context?.sectionKey).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(context);
    for (const rawIdentifier of ["synthetic-exam", "synthetic-section", "synthetic-question"]) {
      expect(serialized).not.toContain(rawIdentifier);
    }

    const sectionCorrectChoice = requiredElement(".multi-choice.corrected");
    sectionCorrectChoice.classList.replace("corrected", "correct");
    expect(adapter.gradeFresh("B")).toBe("unknown");
    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: true,
      correctAnswerParseable: false,
    });

    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <article class="reviewable" style="display: none">
          <div class="review-answer">
            <input class="view-answers switchable" role="switch">
          </div>
        </article>
      `,
    );
    requiredElement(".view-answers.switchable").remove();
    expect(adapter.inspectCapabilities()).toMatchObject({
      safeToReveal: false,
      issues: ["REVIEW_SWITCH_MISSING"],
    });
  });

  it("keeps the confirmed answer route covered until its review root exists", () => {
    document.body.innerHTML = "<main></main>";
    const adapter = new AamcFullLengthReviewAdapter(document, CONFIRMED_REVIEW_URL);
    expect(adapter.classifyPage()).toBe("unknown-review");

    const wrongRoute = new AamcFullLengthReviewAdapter(
      document,
      () => new URL("https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1#dashboard"),
    );
    expect(wrongRoute.classifyPage()).toBe("non-review");

    const unverifiedOrigin = new AamcFullLengthReviewAdapter(
      document,
      () =>
        new URL(
          "https://mcatofficialprep.org/app/aamc-mcat-practice-exam-1#exams/answers/synthetic-exam/synthetic-question",
        ),
    );
    expect(unverifiedOrigin.classifyPage()).toBe("non-review");

    for (const unsupportedHash of [
      "#exams/synthetic-exam/exam_sections/synthetic-section",
      "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question/extra",
      "#exams/details/exam_section/synthetic-section",
    ]) {
      const unsupported = new AamcFullLengthReviewAdapter(
        document,
        () =>
          new URL(
            `https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${unsupportedHash}`,
          ),
      );
      expect(unsupported.classifyPage(), unsupportedHash).toBe("non-review");
    }
  });
});

describe("AamcFullLengthReviewAdapter confirmed score anchors", () => {
  it("recognizes and shields the content-free score anchor shape", () => {
    mountConfirmedAnchorScoreFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, SCORE_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      pageKind: "score-report",
      safeToReveal: true,
      scoreRegionCount: 3,
      reviewControlFound: true,
      issues: [],
    });

    adapter.applyScoreShield();

    for (const selector of [".scaled-score", ".questions-correct", ".questions-answered"]) {
      expectHiddenFromInteraction(requiredElement<HTMLElement>(selector));
    }
  });
});

function expectHiddenFromInteraction(element: HTMLElement): void {
  expect(element.hidden).toBe(true);
  expect(element.inert).toBe(true);
  expect(element.getAttribute("aria-hidden")).toBe("true");
  expect(element.getAttribute("tabindex")).toBe("-1");
  expect(element.hasAttribute("data-mkit-hidden")).toBe(true);
}

function snapshotTree(root: Element): object[] {
  return [root, ...root.querySelectorAll("*")].map((element) => ({
    name: element.localName,
    text: element.childElementCount === 0 ? element.textContent : null,
    attributes: [...element.attributes]
      .map(({ name, value }) => [name, normalizeAttribute(name, value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    hidden: element instanceof HTMLElement ? element.hidden : null,
    inert: element instanceof HTMLElement ? element.inert : null,
    checked: element instanceof HTMLInputElement ? element.checked : null,
  }));
}

function normalizeAttribute(name: string, value: string): string {
  return name === "class" ? value.split(/\s+/).filter(Boolean).sort().join(" ") : value;
}

function stableFixturePath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current?.parentElement) {
    parts.push(`${current.localName}:${[...current.parentElement.children].indexOf(current)}`);
    current = current.parentElement;
  }
  return parts.reverse().join("/");
}

function mountConfirmedProductionFixture(): void {
  document.body.innerHTML = `
    <main class="luca-ui-card">
      <article class="reviewable sidebar-shown">
        <div class="question-content-container">
          <div class="answer-set-content">
            <div
              class="answer-container question-container"
              style="padding: 12px; outline: 4px solid green; box-shadow: 0 0 0 3px red"
            >
              <div class="reading-passage">Synthetic passage.</div>
              <ul
                class="question-choices-multi results"
                style="padding-left: 24px; border: 4px solid red; background-color: pink"
              >
                <li class="multi-choice incorrect" data-choice="D">
                  <span class="choice-content">Synthetic choice A.</span>
                </li>
                <li class="multi-choice corrected" data-choice="A">
                  <span class="choice-content">Synthetic choice B.</span>
                </li>
                <li class="multi-choice" data-choice="B">
                  <span class="choice-content">Synthetic choice C.</span>
                </li>
                <li class="multi-choice" data-choice="C">
                  <span class="choice-content">Synthetic choice D.</span>
                </li>
              </ul>
            </div>
            <div class="answer-toolbar-wrapper">
              <label class="review-answer">
                <input class="view-answers switchable" role="switch" type="checkbox">
                Review
              </label>
            </div>
            <div class="fixed-width-sidebar-columns">
              <div class="content-column">
                <div class="questions-container">
                  <div class="content-container">
                    <div
                      class="answer-container correct is-hidden question-container"
                      id="confirmed-question-container"
                    >
                      <div id="confirmed-question-region">
                        <p id="confirmed-question-copy">Synthetic question workspace.</p>
                        <span class="choice-content">Synthetic visible choice.</span>
                        <svg
                          id="confirmed-question-figure"
                          aria-label="Synthetic visible diagram"
                          role="img"
                          viewBox="0 0 10 10"
                        ></svg>
                      </div>
                      <div id="confirmed-inline-feedback" role="region">
                        Synthetic inline solution.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <aside class="sidebar-column">
                <div class="sidebar-container">
                  <div class="topbar-result-wrapper">Synthetic topbar result.</div>
                  <div class="choices-container">
                    <section class="result-wrapper">
                      <div class="result is-incorrect">Synthetic result.</div>
                      <div class="result-group">
                        <span class="result-label user-label">Synthetic prior result.</span>
                        <div class="answers">
                          <span class="answer-set">Synthetic comparison.</span>
                        </div>
                      </div>
                      <div class="removed-choice">Synthetic removed choice.</div>
                    </section>
                  </div>
                </div>
              </aside>
            </div>
            <section class="expander-content">
              <div class="benchprep-content-editor expanded">Synthetic explanation.</div>
            </section>
          </div>
          <nav class="icon-bar navigate">
            <button class="toolbar-btn previous" role="button" type="button">Previous</button>
            <button class="toolbar-btn next" role="button" type="button">Next</button>
          </nav>
        </div>
      </article>
    </main>
  `;
}
