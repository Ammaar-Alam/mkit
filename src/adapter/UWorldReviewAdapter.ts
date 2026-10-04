import type { AnswerChoice, AttemptOutcome, PassageOrDiscrete } from "../storage/schema";
import type {
  AdapterEvent,
  AdapterIssueCode,
  CapabilityReport,
  CleanSlatePreferences,
  FullLengthReviewAdapter,
  PageKind,
  SanitizedQuestionContext,
  StudyRailAnchor,
} from "./contracts";

export const UWORLD_HOSTNAME = "apps.uworld.com";

// Masking is driven by `preflight-uworld.css` keyed off these page-level flags,
// so Angular re-rendering a question can never repaint an answer before MKit
// sees the mutation.
const FEEDBACK_REVEALED = "data-mkit-feedback-revealed";
const ORIGINAL_REVEALED = "data-mkit-original-revealed";
const CLEAR_HIGHLIGHTS = "data-mkit-clear-highlights";
const CLEAR_CROSS_OUTS = "data-mkit-clear-cross-outs";
const PRIOR_ANNOTATION = "data-mkit-prior-annotation";
const OUTCOME_HIDDEN = "data-mkit-outcome-hidden";
const INITIAL_CORRECTNESS_MODE = "data-mkit-initial-correctness-enabled";
const INITIAL_CORRECT = "data-mkit-initial-correct";
const PAGE_FLAGS = [FEEDBACK_REVEALED, ORIGINAL_REVEALED, CLEAR_HIGHLIGHTS, CLEAR_CROSS_OUTS];
const ROW_MARKERS = [OUTCOME_HIDDEN, INITIAL_CORRECTNESS_MODE, INITIAL_CORRECT];

const VIEWPORT_MARGIN = 16;
const RAIL_GAP = 8;
const CHOICES = ["A", "B", "C", "D"] as const;

const REVIEW_PATH =
  /^\/courseapp\/gradschool\/v\d+\/testinterface\/launchtest\/\d+\/(\d{1,20})\/\d+\/\d+\/?$/;
const RESULTS_PATH =
  /^\/courseapp\/gradschool\/v\d+\/(?:performance\/test\/results\/\d+\/\d{1,20}\/[^/]+|assessments\/blockresult\/\d+\/\d{1,20}\/\d+)\/?$/;

const SELECTORS = {
  header: "#layoutHeader",
  toolbar: "#mcatHeader",
  footer: "pearson-footer",
  content: "#centerContent",
  passage: "#AbstractContainer",
  passageLabel: "#abstractQuestionCount",
  question: "#questionInformation",
  choiceRows: "#answerContainer .answer-container > div",
  correctIcon: ".left-td i.fa-check",
  stats: "#questionInformation .stats-bar",
  explanation: "#explanation-container",
  resultIcons:
    "tr.mat-row > td:is(.mat-column-flag, .mat-column-status) i:is(.fa-check, .fa-times)",
  highlights: "h-tag.textHighlight, img.highLightImage",
  crossOuts: "s-tag.textStrikeout",
} as const;

const SECTION_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Chemical and Physical Foundations/i, "cp"],
  [/Critical Analysis and Reasoning/i, "cars"],
  [/Biological and Biochemical Foundations/i, "bb"],
  [/Psychological, Social, and Biological/i, "ps"],
];

interface AnnotationScope {
  readonly key: string;
  readonly roots: readonly Element[];
}

/**
 * UWorld MCAT QBank and practice-exam reviews share one Angular test interface.
 * Every question in a review lives at the same URL, so question identity comes
 * from the header's QId rather than the route.
 */
export class UWorldReviewAdapter implements FullLengthReviewAdapter {
  readonly #document: Document;
  readonly #url: () => URL;
  #observer: MutationObserver | null = null;
  #cleanSlatePreferences: CleanSlatePreferences | null = null;
  #showInitialCorrectnessEnabled = false;
  #sectionOverviewRevealed = false;
  /** Signatures of annotations UWorld restored from the earlier attempt, per scope. */
  readonly #priorSignatures = new Map<string, Set<string>>();
  /** Scopes the reader has started annotating, after which new carriers are theirs. */
  readonly #sealedScopes = new Set<string>();

  constructor(document: Document = window.document, url: () => URL = () => new URL(location.href)) {
    this.#document = document;
    this.#url = url;
  }

  classifyPage(): PageKind {
    const url = this.#url();
    if (url.protocol !== "https:" || url.hostname !== UWORLD_HOSTNAME) return "non-review";
    if (RESULTS_PATH.test(url.pathname)) return "section-overview";
    if (!REVIEW_PATH.test(url.pathname)) return "non-review";
    const header = this.#document.querySelector(SELECTORS.header);
    if (!header) return "unknown-review";
    // The same interface runs live tests, which MKit must never touch.
    const isReview = [...header.querySelectorAll("span")].some(
      (span) => span.textContent?.trim() === "REVIEW",
    );
    return isReview ? "review" : "non-review";
  }

  inspectCapabilities(): CapabilityReport {
    const pageKind = this.classifyPage();
    const questionRegionFound = Boolean(this.#document.querySelector(SELECTORS.question));
    const answerChoiceCount = this.#choiceRows().length;
    const navigatorFound = Boolean(this.#document.querySelector(SELECTORS.footer));
    const explanationFound = Boolean(this.#document.querySelector(SELECTORS.explanation));
    const feedbackRegionFound =
      explanationFound || Boolean(this.#document.querySelector(SELECTORS.stats));
    const issues: AdapterIssueCode[] = [];

    if (pageKind === "review") {
      if (!questionRegionFound) issues.push("QUESTION_REGION_MISSING");
      if (answerChoiceCount !== 4) issues.push("ANSWER_CHOICES_INCOMPLETE");
      if (!navigatorFound) issues.push("NAVIGATOR_MISSING");
      if (!feedbackRegionFound) issues.push("FEEDBACK_REGION_MISSING");
      if (!this.#readTestIdentifier()) issues.push("STABLE_EXAM_ID_MISSING");
      if (!this.#readQuestionIdentifier()) issues.push("STABLE_QUESTION_ID_MISSING");
      if (this.#document.querySelector(`${SELECTORS.content} iframe`)) {
        issues.push("CHILD_FRAME_UNVERIFIED");
      }
    }

    return {
      pageKind,
      safeToReveal: pageKind === "review" && issues.length === 0,
      questionRegionFound,
      answerChoiceCount,
      navigatorFound,
      feedbackRegionFound,
      explanationFound,
      correctAnswerParseable: this.#readCorrectChoice() !== null,
      categoryCodeFound: false,
      scoreRegionCount: 0,
      reviewControlFound: false,
      issues,
    };
  }

  async getQuestionContext(): Promise<SanitizedQuestionContext | null> {
    const testIdentifier = this.#readTestIdentifier();
    const questionIdentifier = this.#readQuestionIdentifier();
    if (!testIdentifier || !questionIdentifier) return null;
    const counter = /(\d+)\s+of\s+(\d+)/.exec(this.#headerText());
    return {
      examKey: await sha256(`uworld:exam:${testIdentifier}`),
      questionKey: await sha256(`uworld:question:${testIdentifier}:${questionIdentifier}`),
      sectionKey: this.#readSectionKey(),
      categoryCode: null,
      passageOrDiscrete: this.#readPassageOrDiscrete(),
      progress: {
        scope: "unknown",
        current: counter ? Number(counter[1]) : null,
        total: counter ? Number(counter[2]) : null,
      },
    };
  }

  async getExamKey(): Promise<string | null> {
    const testIdentifier = this.#readTestIdentifier();
    return testIdentifier ? sha256(`uworld:exam:${testIdentifier}`) : null;
  }

  configureCleanSlate(preferences: CleanSlatePreferences): void {
    this.#cleanSlatePreferences = { ...preferences };
    const root = this.#document.documentElement;
    root.toggleAttribute(CLEAR_HIGHLIGHTS, preferences.clearPreviousHighlightsEnabled);
    root.toggleAttribute(CLEAR_CROSS_OUTS, preferences.clearPreviousCrossOutsEnabled);
  }

  sealPriorAnnotations(): void {
    this.#markPriorAnnotations();
    for (const scope of this.#annotationScopes()) this.#sealedScopes.add(scope.key);
  }

  applyCleanSlate(): CapabilityReport {
    const report = this.inspectCapabilities();
    if (report.pageKind === "review") this.#markPriorAnnotations();
    return report;
  }

  applyScoreShield(): CapabilityReport {
    return this.inspectCapabilities();
  }

  applySectionOverviewCover(
    showInitialCorrectnessEnabled = this.#showInitialCorrectnessEnabled,
  ): boolean {
    this.#showInitialCorrectnessEnabled = showInitialCorrectnessEnabled;
    if (this.classifyPage() !== "section-overview") return false;
    const icons = [...this.#document.querySelectorAll(SELECTORS.resultIcons)];
    if (icons.length === 0) return false;
    if (this.#sectionOverviewRevealed) return true;
    for (const icon of icons) {
      icon.setAttribute(OUTCOME_HIDDEN, "");
      icon.toggleAttribute(INITIAL_CORRECTNESS_MODE, showInitialCorrectnessEnabled);
      icon.toggleAttribute(
        INITIAL_CORRECT,
        showInitialCorrectnessEnabled && icon.classList.contains("fa-check"),
      );
    }
    return true;
  }

  revealSectionOverview(): void {
    this.#sectionOverviewRevealed = true;
    this.#clearRowMarkers();
  }

  getInitialOutcome(): AttemptOutcome {
    const stats = this.#document.querySelector(SELECTORS.stats);
    if (stats?.querySelector(":scope > .correct-answer")) return "correct";
    if (stats?.querySelector(":scope > .incorrect-answer")) return "needs-review";
    return "unknown";
  }

  gradeFresh(selection: AnswerChoice): AttemptOutcome {
    const correct = this.#readCorrectChoice();
    if (!correct) return "unknown";
    return selection === correct ? "correct" : "needs-review";
  }

  revealScores(): void {}

  revealFeedback(): void {
    this.#document.documentElement.setAttribute(FEEDBACK_REVEALED, "");
  }

  revealOriginalAttempt(): void {
    this.#document.documentElement.setAttribute(ORIGINAL_REVEALED, "");
  }

  remaskQuestion(): void {
    this.#concealQuestion();
  }

  restoreNormalReview(): void {
    for (const flag of PAGE_FLAGS) this.#document.documentElement.removeAttribute(flag);
    for (const marked of this.#document.querySelectorAll(`[${PRIOR_ANNOTATION}]`)) {
      marked.removeAttribute(PRIOR_ANNOTATION);
    }
    this.#clearRowMarkers();
    this.#priorSignatures.clear();
    this.#sealedScopes.clear();
    this.#cleanSlatePreferences = null;
  }

  mountFreshAttemptEntry(): boolean {
    return false;
  }

  mountStudyRail(host: HTMLElement): boolean {
    const body = this.#document.body;
    if (!body || !this.#document.querySelector(SELECTORS.question)) return false;
    if (host.parentElement !== body) body.append(host);
    return true;
  }

  /** Sits below the annotation toolbar and keeps the native footer reachable. */
  getStudyRailAnchor(): StudyRailAnchor {
    const view = this.#document.defaultView;
    const toolbar = this.#document.querySelector(SELECTORS.toolbar)?.getBoundingClientRect();
    const footer = this.#document.querySelector(SELECTORS.footer)?.getBoundingClientRect();
    const anchor: StudyRailAnchor = {
      top: toolbar && toolbar.bottom > 0 ? Math.ceil(toolbar.bottom + RAIL_GAP) : VIEWPORT_MARGIN,
      right: VIEWPORT_MARGIN,
    };
    if (view && footer && footer.height > 0 && footer.top < view.innerHeight) {
      anchor.bottom = Math.ceil(view.innerHeight - footer.top + RAIL_GAP);
    }
    return anchor;
  }

  navigate(): boolean {
    return false;
  }

  observe(listener: (event: AdapterEvent) => void): () => void {
    if (this.#observer) {
      throw new Error("UWorldReviewAdapter already has an active observer.");
    }
    let lastHref = this.#url().href;
    let lastPageKind = this.classifyPage();
    let lastQuestion = this.#readQuestionIdentifier();
    let lastSignature: string | null = null;

    const process = (): void => {
      const pageKind = this.classifyPage();
      const question = this.#readQuestionIdentifier();
      if (pageKind === "review") {
        // A reveal belongs to the question it was made on.
        if (question !== lastQuestion) this.#concealQuestion();
        const report = this.applyCleanSlate();
        const signature = JSON.stringify(report);
        if (signature !== lastSignature) {
          lastSignature = signature;
          listener({ type: "capability-change", report });
        }
      } else {
        lastSignature = null;
        if (pageKind === "section-overview") this.applySectionOverviewCover();
      }
      if (pageKind !== lastPageKind) {
        lastPageKind = pageKind;
        listener({ type: "page-change", pageKind });
      }
      if (question !== lastQuestion) {
        lastQuestion = question;
        listener({ type: "question-change" });
      }
    };

    // Any reader interaction with the question means UWorld has finished restoring
    // saved annotations, so whatever the reader authors next stays visible.
    const sealOnInteraction = (event: Event): void => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-mkit-host]")) return;
      if (this.classifyPage() === "review") this.sealPriorAnnotations();
    };

    this.#observer = new MutationObserver(process);
    this.#observer.observe(this.#document, {
      attributes: true,
      attributeFilter: ["class"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    // Angular routes with pushState, which fires no event.
    const poll = window.setInterval(() => {
      const href = this.#url().href;
      if (href === lastHref) return;
      lastHref = href;
      process();
    }, 250);
    this.#document.addEventListener("pointerdown", sealOnInteraction, true);
    this.#document.addEventListener("keydown", sealOnInteraction, true);

    return () => {
      this.#observer?.disconnect();
      this.#observer = null;
      window.clearInterval(poll);
      this.#document.removeEventListener("pointerdown", sealOnInteraction, true);
      this.#document.removeEventListener("keydown", sealOnInteraction, true);
    };
  }

  #concealQuestion(): void {
    this.#document.documentElement.removeAttribute(FEEDBACK_REVEALED);
    this.#document.documentElement.removeAttribute(ORIGINAL_REVEALED);
  }

  #clearRowMarkers(): void {
    for (const marked of this.#document.querySelectorAll(`[${OUTCOME_HIDDEN}]`)) {
      for (const marker of ROW_MARKERS) marked.removeAttribute(marker);
    }
  }

  /**
   * Before a scope is sealed every carrier is a restored prior annotation. After
   * it, only carriers matching a recorded signature are, which re-marks the
   * fresh nodes Angular renders when the reader returns to a question.
   * ponytail: a reader re-annotating the exact same text in the same order stays
   * hidden while clearing is on; track per-node authorship if that matters.
   */
  #markPriorAnnotations(): void {
    if (!this.#cleanSlatePreferences) return;
    for (const scope of this.#annotationScopes()) {
      let signatures = this.#priorSignatures.get(scope.key);
      if (!signatures) {
        signatures = new Set();
        this.#priorSignatures.set(scope.key, signatures);
      }
      const sealed = this.#sealedScopes.has(scope.key);
      for (const root of scope.roots) {
        for (const [kind, selector] of [
          ["highlight", SELECTORS.highlights],
          ["cross-out", SELECTORS.crossOuts],
        ] as const) {
          const seen = new Map<string, number>();
          for (const carrier of root.querySelectorAll(selector)) {
            const text =
              carrier.localName === "img"
                ? (carrier.getAttribute("src") ?? "")
                : (carrier.textContent ?? "").replaceAll(/\s+/g, " ").trim();
            const occurrence = seen.get(text) ?? 0;
            seen.set(text, occurrence + 1);
            const signature = `${root.id}|${kind}|${occurrence}|${text}`;
            if (!sealed) signatures.add(signature);
            if (signatures.has(signature)) carrier.setAttribute(PRIOR_ANNOTATION, kind);
          }
        }
      }
    }
  }

  /**
   * A passage's annotations follow it across its questions, so the passage has
   * its own scope; discrete questions keep their abstract with the question.
   */
  #annotationScopes(): AnnotationScope[] {
    const testIdentifier = this.#readTestIdentifier();
    const questionIdentifier = this.#readQuestionIdentifier();
    const question = this.#document.querySelector(SELECTORS.question);
    if (!testIdentifier || !questionIdentifier || !question) return [];
    const passage = this.#document.querySelector(SELECTORS.passage);
    const passageLabel = this.#document
      .querySelector(SELECTORS.passageLabel)
      ?.textContent?.replaceAll(/\s+/g, " ")
      .trim();
    const questionKey = `${testIdentifier}:question:${questionIdentifier}`;
    if (passage && passageLabel && /^Passage \d+/.test(passageLabel)) {
      return [
        { key: `${testIdentifier}:passage:${passageLabel}`, roots: [passage] },
        { key: questionKey, roots: [question] },
      ];
    }
    return [{ key: questionKey, roots: passage ? [passage, question] : [question] }];
  }

  #choiceRows(): Element[] {
    return [...this.#document.querySelectorAll(SELECTORS.choiceRows)].filter((row) =>
      row.querySelector(".answercontent"),
    );
  }

  #readCorrectChoice(): AnswerChoice | null {
    const rows = this.#choiceRows();
    if (rows.length !== 4) return null;
    const marked = rows.filter((row) => row.querySelector(SELECTORS.correctIcon));
    if (marked.length !== 1) return null;
    return CHOICES[rows.indexOf(marked[0] as Element)] ?? null;
  }

  #headerText(): string {
    return this.#document.querySelector(SELECTORS.header)?.textContent ?? "";
  }

  #readTestIdentifier(): string | null {
    return REVIEW_PATH.exec(this.#url().pathname)?.[1] ?? null;
  }

  #readQuestionIdentifier(): string | null {
    return /QId:\s*(\d{1,20})/.exec(this.#headerText())?.[1] ?? null;
  }

  #readSectionKey(): string {
    const header = this.#headerText();
    return SECTION_KEYS.find(([pattern]) => pattern.test(header))?.[1] ?? "unknown";
  }

  #readPassageOrDiscrete(): PassageOrDiscrete {
    const label = this.#document.querySelector(SELECTORS.passageLabel)?.textContent ?? "";
    return /not refer to a passage/i.test(label) ? "discrete" : "passage";
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
