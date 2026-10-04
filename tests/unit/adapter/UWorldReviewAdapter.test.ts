import { describe, expect, it } from "vitest";
import type { AdapterEvent } from "../../../src/adapter/contracts";
import { UWorldReviewAdapter } from "../../../src/adapter/UWorldReviewAdapter";
import { startContentLifecycle } from "../../../src/content/lifecycle";
import type { DisposableMKitPreflight } from "../../../src/content/preflight";
import type { ReviewController } from "../../../src/core/review-controller";
import { DEFAULT_SETTINGS } from "../../../src/storage";

const ROOT = "https://apps.uworld.com/courseapp/gradschool/v62";
const REVIEW_URL = () => new URL(`${ROOT}/testinterface/launchtest/111/222333/3/1`);
const QBANK_RESULTS_URL = () => new URL(`${ROOT}/performance/test/results/111/222333/7`);
const EXAM_RESULTS_URL = () => new URL(`${ROOT}/assessments/blockresult/111/444555/5`);
const CLEAR_ALL = { clearPreviousHighlightsEnabled: true, clearPreviousCrossOutsEnabled: true };

interface ReviewFixture {
  questionId?: string;
  counter?: string;
  review?: boolean;
  correct?: "A" | "B" | "C" | "D";
  picked?: "A" | "B" | "C" | "D";
  passage?: string | null;
  sectionTitle?: string;
}

function mountReview({
  questionId = "900001",
  counter = "3 of 15",
  review = true,
  correct = "B",
  picked = "C",
  passage = "Passage 1 (Questions 2–6)",
  sectionTitle = "Test Id: 222333",
}: ReviewFixture = {}): void {
  const rows = (["A", "B", "C", "D"] as const)
    .map(
      (letter) => `
        <div>
          <div class="left-td">
            <div>${letter === correct ? '<i class="fal fa-lg fa-check"></i>' : ""}${
              letter === picked && picked !== correct ? '<i class="fal fa-lg fa-times"></i>' : ""
            }</div>
            <mat-radio-group><mat-radio-button class="mat-radio-button${
              letter === picked ? " mat-radio-checked" : ""
            }"></mat-radio-button></mat-radio-group>
          </div>
          <span class="answer-choice-parent"><span>${letter}.</span>
            <span class="answercontent"><span>Synthetic choice ${letter}</span><span> (25%)</span></span>
          </span>
        </div>`,
    )
    .join("");
  const outcome =
    picked === correct
      ? '<div class="correct-answer content"><div>Correct</div></div>'
      : `<div class="incorrect-answer content"><div>Incorrect</div><span>Correct answer ${correct}</span></div>`;
  document.body.innerHTML = `
    <app-root>
      <div id="layoutHeader">
        <div>Synthetic topic</div>
        <div>${sectionTitle} <span>QId: ${questionId}</span></div>
        <div>${review ? "<span>REVIEW</span>" : ""}<span>${counter}</span></div>
      </div>
      <pearson-header id="mcatHeader"><a aria-label="Apply Highlight">Highlight</a></pearson-header>
      <div id="centerContent">
        <div id="AbstractContainer">
          <div id="abstractQuestionCount"><span>${
            passage ?? "Question 1 does not refer to a passage and is an independent question."
          }</span></div>
          <div id="currentAbstract"><p>Synthetic <h-tag class="textHighlight highlight-color-1">passage note</h-tag> text.</p></div>
        </div>
        <div id="questionInformation">
          <div id="questionText"><p>Synthetic <s-tag class="textStrikeout">stem</s-tag>?</p></div>
          <div id="answerContainer"><div class="answer-container">${rows}</div></div>
          <div class="stats-bar">${outcome}</div>
          <div id="explanation-container">Synthetic explanation</div>
        </div>
      </div>
      <pearson-footer class="footer-nav"><a>Next</a></pearson-footer>
    </app-root>`;
}

function mountResults(cell: "mat-column-flag" | "mat-column-status"): void {
  const row = (icon: string) =>
    `<tr class="mat-row"><td class="${cell}"><div><i class="fas fa-bookmark"></i><i class="fal fa-lg ${icon}"></i></div></td><td>1 - 900001</td></tr>`;
  document.body.innerHTML = `<table><tbody>${row("fa-check")}${row("fa-times")}</tbody></table>`;
}

const flags = () => document.documentElement;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("UWorldReviewAdapter", () => {
  it("recognizes a completed review and reports content-free capabilities", async () => {
    mountReview();
    const adapter = new UWorldReviewAdapter(document, REVIEW_URL);

    expect(adapter.inspectCapabilities()).toMatchObject({
      pageKind: "review",
      safeToReveal: true,
      answerChoiceCount: 4,
      correctAnswerParseable: true,
      issues: [],
    });
    const context = await adapter.getQuestionContext();
    expect(context).toMatchObject({
      sectionKey: "unknown",
      passageOrDiscrete: "passage",
      progress: { scope: "unknown", current: 3, total: 15 },
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("900001");
    expect(serialized).not.toContain("222333");
    expect(context?.examKey).toBe(await adapter.getExamKey());
  });

  it("never treats a live test or a still-loading interface as a review", () => {
    mountReview({ review: false });
    expect(new UWorldReviewAdapter(document, REVIEW_URL).classifyPage()).toBe("non-review");

    document.body.innerHTML = "";
    expect(new UWorldReviewAdapter(document, REVIEW_URL).classifyPage()).toBe("unknown-review");

    mountReview();
    const elsewhere = () => new URL(`${ROOT}/dashboard/111`);
    expect(new UWorldReviewAdapter(document, elsewhere).classifyPage()).toBe("non-review");
    const otherHost = () => new URL("https://www.uworld.com/courseapp/gradschool/v62/x");
    expect(new UWorldReviewAdapter(document, otherHost).classifyPage()).toBe("non-review");
  });

  it("keeps detecting while the review header hydrates", async () => {
    // Angular renders the header before its REVIEW label and the question.
    mountReview({ review: false, counter: "" });
    document.querySelector("#questionInformation")?.remove();
    expect(new UWorldReviewAdapter(document, REVIEW_URL).classifyPage()).toBe("unknown-review");

    const lifecycle = startContentLifecycle(
      {
        createAdapter: () => new UWorldReviewAdapter(document, REVIEW_URL),
        createPreflight: () => {
          const host = document.createElement("div");
          host.dataset.mkitHost = "";
          document.body.append(host);
          return {
            host,
            shadow: host.attachShadow({ mode: "open" }),
            setProtection: () => undefined,
            showPreparing: () => undefined,
            destroy: () => host.remove(),
          } as DisposableMKitPreflight;
        },
        createController: () =>
          ({
            start: () => undefined,
            dispose: () => undefined,
            normalReview: () => undefined,
            updateSettings: () => undefined,
          }) as unknown as ReviewController,
      },
      DEFAULT_SETTINGS,
    );
    expect(lifecycle.status().state).toBe("supported-not-running");

    mountReview();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lifecycle.status()).toEqual({ state: "active", route: "review", issues: [] });
    lifecycle.dispose();
  });

  it("fails closed when the review shape is incomplete", () => {
    mountReview();
    document.querySelector("#answerContainer .answer-container > div")?.remove();
    document.querySelector("pearson-footer")?.remove();
    const report = new UWorldReviewAdapter(document, REVIEW_URL).inspectCapabilities();
    expect(report.safeToReveal).toBe(false);
    expect(report.issues).toEqual(["ANSWER_CHOICES_INCOMPLETE", "NAVIGATOR_MISSING"]);
  });

  it("grades against the marked answer and reads the original outcome", () => {
    mountReview({ correct: "B", picked: "C" });
    const adapter = new UWorldReviewAdapter(document, REVIEW_URL);
    expect(adapter.gradeFresh("B")).toBe("correct");
    expect(adapter.gradeFresh("C")).toBe("needs-review");
    expect(adapter.getInitialOutcome()).toBe("needs-review");

    mountReview({ correct: "D", picked: "D" });
    expect(adapter.getInitialOutcome()).toBe("correct");
  });

  it("maps practice exam sections and discrete questions", async () => {
    mountReview({
      passage: null,
      sectionTitle: "Critical Analysis and Reasoning Skills (Untutored, Timed)",
    });
    const context = await new UWorldReviewAdapter(document, REVIEW_URL).getQuestionContext();
    expect(context).toMatchObject({ sectionKey: "cars", passageOrDiscrete: "discrete" });
  });

  it("drives masking through page flags that reveal and conceal per question", async () => {
    mountReview({ questionId: "900001" });
    const adapter = new UWorldReviewAdapter(document, REVIEW_URL);
    const events: AdapterEvent[] = [];
    const stop = adapter.observe((event) => events.push(event));

    adapter.revealFeedback();
    adapter.revealOriginalAttempt();
    expect(flags().hasAttribute("data-mkit-feedback-revealed")).toBe(true);
    expect(flags().hasAttribute("data-mkit-original-revealed")).toBe(true);

    const id = document.querySelector("#layoutHeader span");
    if (id) id.textContent = "QId: 900002";
    await flush();
    expect(flags().hasAttribute("data-mkit-feedback-revealed")).toBe(false);
    expect(flags().hasAttribute("data-mkit-original-revealed")).toBe(false);
    expect(events.some((event) => event.type === "question-change")).toBe(true);

    adapter.revealFeedback();
    adapter.remaskQuestion();
    expect(flags().hasAttribute("data-mkit-feedback-revealed")).toBe(false);
    stop();
    adapter.restoreNormalReview();
  });

  it("hides restored annotations but keeps the ones the reader adds", async () => {
    mountReview();
    const adapter = new UWorldReviewAdapter(document, REVIEW_URL);
    adapter.configureCleanSlate(CLEAR_ALL);
    expect(flags().hasAttribute("data-mkit-clear-highlights")).toBe(true);
    adapter.applyCleanSlate();
    expect(document.querySelectorAll("[data-mkit-prior-annotation]")).toHaveLength(2);

    const stop = adapter.observe(() => undefined);
    // A trusted pointer or key press inside the review seals the same way.
    adapter.sealPriorAnnotations();
    const fresh = document.createElement("h-tag");
    fresh.className = "textHighlight highlight-color-2";
    fresh.textContent = "reader note";
    document.querySelector("#questionText p")?.append(fresh);
    await flush();
    expect(fresh.hasAttribute("data-mkit-prior-annotation")).toBe(false);

    // Angular re-renders the passage when the reader returns to it
    const passage = document.querySelector("#currentAbstract");
    if (passage) {
      passage.innerHTML =
        '<p>Synthetic <h-tag class="textHighlight highlight-color-1">passage note</h-tag> text.</p>';
    }
    await flush();
    expect(
      document.querySelector("#currentAbstract h-tag")?.getAttribute("data-mkit-prior-annotation"),
    ).toBe("highlight");

    stop();
    adapter.restoreNormalReview();
    expect(document.querySelector("[data-mkit-prior-annotation]")).toBeNull();
    expect(flags().hasAttribute("data-mkit-clear-highlights")).toBe(false);
  });

  it("keeps a passage highlight made on one question visible on its siblings", () => {
    mountReview({ questionId: "900001" });
    const adapter = new UWorldReviewAdapter(document, REVIEW_URL);
    adapter.configureCleanSlate(CLEAR_ALL);
    adapter.applyCleanSlate();
    adapter.sealPriorAnnotations();
    const fresh = document.createElement("h-tag");
    fresh.className = "textHighlight highlight-color-3";
    fresh.textContent = "shared reader note";
    document.querySelector("#currentAbstract")?.append(fresh);

    mountReview({ questionId: "900002" });
    document.querySelector("#currentAbstract")?.append(fresh);
    adapter.applyCleanSlate();
    expect(fresh.hasAttribute("data-mkit-prior-annotation")).toBe(false);
    expect(
      document.querySelector("#currentAbstract h-tag")?.getAttribute("data-mkit-prior-annotation"),
    ).toBe("highlight");
  });

  it.each([
    ["QBank results", QBANK_RESULTS_URL, "mat-column-flag"],
    ["practice exam results", EXAM_RESULTS_URL, "mat-column-status"],
  ] as const)("covers row outcomes on %s and restores them", (_label, url, cell) => {
    mountResults(cell);
    const adapter = new UWorldReviewAdapter(document, url);
    expect(adapter.classifyPage()).toBe("section-overview");
    expect(adapter.applySectionOverviewCover(true)).toBe(true);

    const [right, wrong] = document.querySelectorAll("[data-mkit-outcome-hidden]");
    expect(right?.hasAttribute("data-mkit-initial-correct")).toBe(true);
    expect(wrong?.hasAttribute("data-mkit-initial-correct")).toBe(false);
    expect(document.querySelector(".fa-bookmark")?.hasAttribute("data-mkit-outcome-hidden")).toBe(
      false,
    );

    adapter.restoreNormalReview();
    expect(document.querySelector("[data-mkit-outcome-hidden]")).toBeNull();
  });

  it("keeps the rail clear of the native footer", () => {
    mountReview();
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, height: bottom - top, width: 100 }) as DOMRect;
    const toolbar = document.querySelector("#mcatHeader") as HTMLElement;
    const footer = document.querySelector("pearson-footer") as HTMLElement;
    toolbar.getBoundingClientRect = () => rect(64, 104);
    footer.getBoundingClientRect = () => rect(window.innerHeight - 40, window.innerHeight);

    expect(new UWorldReviewAdapter(document, REVIEW_URL).getStudyRailAnchor()).toEqual({
      top: 112,
      right: 16,
      bottom: 48,
    });
  });
});
