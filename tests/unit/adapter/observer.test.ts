import { describe, expect, it } from "vitest";
import { AamcFullLengthReviewAdapter } from "../../../src/adapter/AamcFullLengthReviewAdapter";
import type { CapabilityReport } from "../../../src/adapter/contracts";
import {
  mountCompleteReviewFixture,
  REVIEW_SENTINELS,
  requiredElement,
} from "../../fixtures/review";

const REVIEW_URL = () => new URL("https://synthetic.invalid/completed/review");
const CLEAR_PRIOR_ANNOTATIONS = {
  clearPreviousHighlightsEnabled: true,
  clearPreviousCrossOutsEnabled: true,
} as const;

describe("AamcFullLengthReviewAdapter observer", () => {
  it("masks delayed spoiler nodes and a replacement review root", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();
    const stop = adapter.observe(() => undefined);

    const question = requiredElement("#question-q1");
    question.insertAdjacentHTML(
      "beforeend",
      `<div id="delayed-status" class="review-status is-correct"
        title="${REVIEW_SENTINELS.statusTitle}">${REVIEW_SENTINELS.statusText}</div>`,
    );
    await mutationTurn();
    expectMasked(requiredElement<HTMLElement>("#delayed-status"));
    expect(requiredElement("#delayed-status").classList.contains("is-correct")).toBe(false);
    expect(requiredElement("#delayed-status").getAttribute("title")).toBeNull();

    stop();

    const replacementMarkup = document.body.innerHTML;
    document.body.innerHTML = replacementMarkup;
    const replacementAdapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    const stopReplacement = replacementAdapter.observe(() => undefined);
    requiredElement("#exam-review-shell").append(document.createTextNode("route mutation"));
    await mutationTurn();
    expectMasked(requiredElement<HTMLElement>("#question-navigator"));
    expectMasked(requiredElement<HTMLElement>("#official-solution"));
    stopReplacement();
  });

  it("remasks class-only correctness mutations", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();
    const stop = adapter.observe(() => undefined);
    const choice = requiredElement("#choice-c");

    choice.classList.add("is-correct");
    await mutationTurn();

    expect(choice.classList.contains("is-correct")).toBe(false);
    stop();
  });

  it("masks baseline annotations once without absorbing annotations added later", async () => {
    mountCompleteReviewFixture();
    const passage = requiredElement("#passage-copy");
    const choice = requiredElement("#choice-c");
    passage.innerHTML = '<span id="prior-highlight" class="user-highlight">Prior highlight.</span>';
    choice.insertAdjacentHTML(
      "beforeend",
      '<span id="prior-cross" class="user-strikethrough">Prior cross-out.</span>',
    );
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.configureCleanSlate(CLEAR_PRIOR_ANNOTATIONS);
    adapter.applyCleanSlate();
    const stop = adapter.observe(() => undefined);

    passage.insertAdjacentHTML(
      "beforeend",
      '<span id="fresh-highlight" class="user-highlight">Fresh highlight.</span>',
    );
    choice.insertAdjacentHTML(
      "beforeend",
      '<span id="fresh-cross" class="user-strikethrough">Fresh cross-out.</span>',
    );
    await mutationTurn();

    expect(requiredElement("#prior-highlight").classList.contains("user-highlight")).toBe(false);
    expect(requiredElement("#prior-cross").classList.contains("user-strikethrough")).toBe(false);
    expect(requiredElement("#fresh-highlight").classList.contains("user-highlight")).toBe(true);
    expect(requiredElement("#fresh-cross").classList.contains("user-strikethrough")).toBe(true);

    const priorHighlight = requiredElement("#prior-highlight");
    const priorCross = requiredElement("#prior-cross");
    priorHighlight.classList.add("user-highlight");
    priorCross.classList.add("user-strikethrough");
    await mutationTurn();
    expect(priorHighlight.classList.contains("user-highlight")).toBe(true);
    expect(priorCross.classList.contains("user-strikethrough")).toBe(true);

    priorHighlight.classList.remove("user-highlight");
    priorCross.classList.remove("user-strikethrough");
    await mutationTurn();
    stop();
    adapter.restoreNormalReview();
    expect(priorHighlight.classList.contains("user-highlight")).toBe(false);
    expect(priorCross.classList.contains("user-strikethrough")).toBe(false);
  });

  it("sanitizes title, ARIA, checked, data-correct, and character-only spoiler mutations", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();
    const stop = adapter.observe(() => undefined);
    const choice = requiredElement("#choice-c");
    const officialInput = requiredElement<HTMLInputElement>("#official-c");
    const status = requiredElement<HTMLElement>("#question-status");

    choice.setAttribute("title", "MKIT_MUTATED_TITLE_1F4A");
    choice.setAttribute("aria-label", "MKIT_MUTATED_ARIA_3C6B");
    choice.setAttribute("aria-describedby", "spoiler-tooltip");
    choice.setAttribute("data-correct", "true");
    officialInput.setAttribute("checked", "");
    status.firstChild?.replaceWith("MKIT_MUTATED_STATUS_TEXT_86E0");
    await mutationTurn();

    expect(choice.getAttribute("title")).toBeNull();
    expect(choice.getAttribute("aria-label")).toBeNull();
    expect(choice.getAttribute("aria-describedby")).toBeNull();
    expect(choice.getAttribute("data-correct")).toBeNull();
    expectMasked(officialInput);
    expectMasked(status);
    stop();
  });

  it("returns a question-scoped context when an older digest resolves after navigation", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    const firstContext = adapter.getQuestionContext();
    requiredElement("#question-q1").setAttribute("data-question-id", "synthetic-cp-002");
    const secondContext = adapter.getQuestionContext();

    const [first, second] = await Promise.all([firstContext, secondContext]);

    expect(first?.questionKey).not.toBe(second?.questionKey);
    expect(first?.sectionKey).toBe("cp");
    expect(second?.sectionKey).toBe("cp");
  });

  it("remasks unrelated mutations without publishing an unchanged capability report", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();
    let capabilityEvents = 0;
    const stop = adapter.observe((event) => {
      if (event.type !== "capability-change") return;
      capabilityEvents += 1;
    });

    requiredElement("#choice-c").classList.add("is-correct");
    await mutationTurn();
    await mutationTurn();

    expect(requiredElement("#choice-c").classList.contains("is-correct")).toBe(false);
    expect(capabilityEvents).toBe(0);
    stop();
  });

  it("publishes a capability change when the supported structure actually changes", async () => {
    mountCompleteReviewFixture();
    const adapter = new AamcFullLengthReviewAdapter(document, REVIEW_URL);
    adapter.applyCleanSlate();
    const reports: CapabilityReport[] = [];
    const stop = adapter.observe((event) => {
      if (event.type === "capability-change") reports.push(event.report);
    });

    requiredElement("#question-navigator").remove();
    await mutationTurn();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.issues).toContain("NAVIGATOR_MISSING");
    stop();
  });
});

async function mutationTurn(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function expectMasked(element: HTMLElement): void {
  expect(element.hidden).toBe(true);
  expect(element.inert).toBe(true);
  expect(element.getAttribute("aria-hidden")).toBe("true");
  expect(element.hasAttribute("data-mkit-hidden")).toBe(true);
}
