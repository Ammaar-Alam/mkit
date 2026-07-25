import type { AnswerChoice, AttemptOutcome, PassageOrDiscrete } from "../storage/schema";
import type {
  AdapterEvent,
  AdapterIssueCode,
  CapabilityReport,
  FullLengthReviewAdapter,
  PageKind,
  SanitizedQuestionContext,
} from "./contracts";
import { ReversibleDomMask } from "./ReversibleDomMask";

const FEEDBACK_GROUP = "feedback";
const ORIGINAL_GROUP = "original";
const CLEAN_SLATE_GROUP = "clean-slate";
const SCORE_SHIELD_GROUP = "score-shield";

export class AamcFullLengthReviewAdapter implements FullLengthReviewAdapter {
  readonly #document: Document;
  readonly #mask = new ReversibleDomMask();
  readonly #url: () => URL;
  #observer: MutationObserver | null = null;
  #locationPoll: number | null = null;
  #lastLocation = "";
  #processing = false;

  readonly #selectors = {
    page: {
      review: [
        ".reviewable",
        '[data-mkit-fixture-page="review"]',
        '[data-page-kind="full-length-review"]',
      ],
      scoreReport: [
        ".score-reports-wrapper",
        ".results-contents",
        '[data-mkit-fixture-page="score-report"]',
        '[data-page-kind="score-report"]',
      ],
    },
    questionRegion: [
      ".reviewable > .question-content-container",
      '[data-mkit-fixture="question"]',
      "[data-question-id][data-section-id]",
    ],
    answerChoices: [
      "ul.question-choices-multi.results > .multi-choice",
      '[data-mkit-fixture="answer-choice"]',
      ".answer-choice",
    ],
    officialInputs: [
      ".review-answer",
      ".review-answer input.view-answers.switchable[role='switch']",
      '[data-mkit-fixture="official-answer"]',
      '.answer-choice input[type="radio"]',
    ],
    navigator: [".icon-bar.navigate", '[data-mkit-fixture="navigator"]', "#question-navigator"],
    navigatorSpoiler: ['[data-mkit-fixture="navigator"]', "#question-navigator"],
    resultRail: [
      ".choices-container > .result-wrapper[role='region']",
      '[data-mkit-fixture="result-rail"]',
      "#official-results-rail",
    ],
    status: [
      ".choices-container > .result-wrapper[role='region'] .result",
      ".choices-container > .result-wrapper[role='region'] .is-incorrect",
      '[data-mkit-fixture="status"]',
      ".review-status",
    ],
    explanation: [
      ".expander-content",
      ".benchprep-content-editor.expanded",
      '[data-mkit-fixture="explanation"]',
      "#official-solution",
    ],
    correctMarker: ['[data-mkit-fixture="correct-marker"]', ".correct-marker"],
    originalMarker: [
      ".choices-container > .result-wrapper[role='region'] .result-group:has(.result-label.user-label)",
      '[data-mkit-fixture="original-marker"]',
      ".original-marker",
    ],
    metadata: [
      ".topbar-result-wrapper",
      '[data-mkit-fixture="metadata"]',
      "#official-metadata",
      ".question-tally",
      ".section-status",
    ],
    tooltip: [
      '[data-mkit-fixture="spoiler-tooltip"]',
      '[role="tooltip"][data-review-result]',
      "#spoiler-tooltip",
    ],
    spoilerAttributeCarrier: [
      "[data-mkit-fixture-spoiler-attribute]",
      ".answer-choice",
      ".multi-choice",
      ".result-wrapper",
      ".review-answer",
      ".navigator-item",
      ".review-status",
      "[data-review-result]",
      "#tooltip-trigger",
    ],
    feedbackClassCarrier: [
      ".multi-choice.corrected",
      ".is-correct",
      ".is-correct-answer",
      ".correct-answer",
      ".answer-correct",
    ],
    originalClassCarrier: [
      ".multi-choice.incorrect",
      ".result-wrapper .is-incorrect",
      ".is-incorrect",
      ".was-selected",
      ".answer-incorrect",
      ".selected-answer",
    ],
    staleClassCarrier: [
      ".removed-choice",
      ".was-eliminated",
      ".was-highlighted",
      ".eliminated",
      ".strikethrough",
      ".highlighted",
    ],
    scoreRegion: [
      ".score-reports-wrapper",
      ".results-contents",
      ".categories-scores-overview",
      ".exam-score-breakdown",
      ".topbar-result-wrapper",
      '[data-mkit-fixture="score-region"]',
      "#score-summary",
    ],
    scoreValue: [
      ".scaled-score",
      ".questions-correct",
      ".questions-answered",
      '[data-mkit-fixture="score-value"]',
      "#total-score",
      ".section-score",
    ],
    reviewControl: ['[data-mkit-fixture="review-all"]', "#review-all"],
    studyRailMount: [
      ".choices-container > .result-wrapper[role='region']",
      ".choices-container",
      '[data-mkit-fixture="study-rail-mount"]',
      "#official-results-rail",
    ],
    previous: [
      ".icon-bar.navigate [role='button'].toolbar-btn.previous",
      '[data-mkit-fixture="previous"]',
      "#native-previous",
    ],
    next: [
      ".icon-bar.navigate [role='button'].toolbar-btn.next",
      '[data-mkit-fixture="next"]',
      "#native-next",
    ],
    examIdCarrier: ["[data-exam-id]", "[data-mkit-fixture-exam-id]"],
    questionIdCarrier: ["[data-question-id]", "[data-mkit-fixture-question-id]"],
    sectionCarrier: ["[data-section-id]", "[data-section-code]", "[data-mkit-fixture-section]"],
    categoryCarrier: ["[data-category-code]", "[data-mkit-fixture-category]"],
    passageCarrier: ["[data-question-kind]", "[data-item-type]", "[data-mkit-fixture-kind]"],
    correctChoiceCarrier: ["[data-correct-choice]", "[data-mkit-fixture-correct-choice]"],
  } as const;

  constructor(document: Document = window.document, url: () => URL = () => new URL(location.href)) {
    this.#document = document;
    this.#url = url;
  }

  classifyPage(): PageKind {
    const route = parseConfirmedReviewRoute(this.#url());
    if (
      (route || isSyntheticFixtureUrl(this.#url())) &&
      this.#queryAny(this.#selectors.page.review)
    ) {
      return "review";
    }
    if (this.#queryAny(this.#selectors.page.scoreReport)) {
      return "score-report";
    }
    if (route) {
      return "unknown-review";
    }
    return "non-review";
  }

  inspectCapabilities(): CapabilityReport {
    const pageKind = this.classifyPage();
    const questionRegionFound = Boolean(this.#queryAny(this.#selectors.questionRegion));
    const answerChoiceCount = this.#queryAll(this.#selectors.answerChoices).length;
    const navigatorFound = Boolean(this.#queryAny(this.#selectors.navigator));
    const feedbackRegionFound =
      this.#queryAll([
        ...this.#selectors.status,
        ...this.#selectors.correctMarker,
        ...this.#selectors.explanation,
      ]).length > 0;
    const explanationFound = Boolean(this.#queryAny(this.#selectors.explanation));
    const correctAnswerParseable = this.#readCorrectChoice() !== null;
    const categoryCodeFound = this.#readCategoryCode() !== null;
    const scoreRegionCount = this.#queryAll(this.#selectors.scoreValue).length;
    const reviewControlFound = Boolean(this.#queryAny(this.#selectors.reviewControl));
    const issues: AdapterIssueCode[] = [];

    if (pageKind === "review") {
      if (!questionRegionFound) issues.push("QUESTION_REGION_MISSING");
      if (answerChoiceCount < 4) issues.push("ANSWER_CHOICES_INCOMPLETE");
      if (!navigatorFound) issues.push("NAVIGATOR_MISSING");
      if (!feedbackRegionFound) issues.push("FEEDBACK_REGION_MISSING");
      if (!this.#readExamIdentifier()) issues.push("STABLE_EXAM_ID_MISSING");
      if (!this.#readQuestionIdentifier()) issues.push("STABLE_QUESTION_ID_MISSING");
    }

    if (pageKind === "score-report") {
      if (scoreRegionCount === 0) issues.push("SCORE_REGION_MISSING");
      if (!reviewControlFound) issues.push("REVIEW_CONTROL_MISSING");
      if (!this.#readExamIdentifier()) issues.push("STABLE_EXAM_ID_MISSING");
    }

    if (this.#document.querySelector("iframe")) {
      issues.push("CHILD_FRAME_UNVERIFIED");
    }
    if (this.#document.querySelector("[data-mkit-fixture-closed-shadow]")) {
      issues.push("SHADOW_ROOT_UNSUPPORTED");
    }

    return {
      pageKind,
      safeToReveal: (pageKind === "review" || pageKind === "score-report") && issues.length === 0,
      questionRegionFound,
      answerChoiceCount,
      navigatorFound,
      feedbackRegionFound,
      explanationFound,
      correctAnswerParseable,
      categoryCodeFound,
      scoreRegionCount,
      reviewControlFound,
      issues: [...new Set(issues)],
    };
  }

  async getQuestionContext(): Promise<SanitizedQuestionContext | null> {
    const examIdentifier = this.#readExamIdentifier();
    const questionIdentifier = this.#readQuestionIdentifier();
    const sectionKey = this.#readSectionKey();
    if (!examIdentifier || !questionIdentifier || !sectionKey) {
      return null;
    }
    return {
      examKey: await sha256Guard(`exam:${examIdentifier}`),
      questionKey: await sha256Guard(
        `question:${examIdentifier}:${sectionKey}:${questionIdentifier}`,
      ),
      sectionKey,
      categoryCode: this.#readCategoryCode(),
      passageOrDiscrete: this.#readPassageOrDiscrete(),
    };
  }

  async getExamKey(): Promise<string | null> {
    const examIdentifier = this.#readExamIdentifier();
    return examIdentifier ? sha256Guard(`exam:${examIdentifier}`) : null;
  }

  applyCleanSlate(): CapabilityReport {
    const report = this.inspectCapabilities();
    if (report.pageKind !== "review") {
      return report;
    }

    this.#mask.hide(this.#queryAll(this.#selectors.navigatorSpoiler), CLEAN_SLATE_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.resultRail), ORIGINAL_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.status), FEEDBACK_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.metadata), CLEAN_SLATE_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.tooltip), CLEAN_SLATE_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.officialInputs), CLEAN_SLATE_GROUP);

    this.#mask.hide(this.#queryAll(this.#selectors.explanation), FEEDBACK_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.correctMarker), FEEDBACK_GROUP);
    this.#mask.hide(this.#queryAll(this.#selectors.originalMarker), ORIGINAL_GROUP);

    const attributeCarriers = this.#queryAll(this.#selectors.spoilerAttributeCarrier);
    this.#mask.removeAttributes(
      attributeCarriers,
      [
        "title",
        "aria-label",
        "aria-describedby",
        "aria-labelledby",
        "data-tooltip",
        "data-correct",
        "alt",
      ],
      CLEAN_SLATE_GROUP,
    );

    const feedbackClassCarriers = this.#queryAll(this.#selectors.feedbackClassCarrier);
    const originalClassCarriers = this.#queryAll(this.#selectors.originalClassCarrier);
    const staleClassCarriers = this.#queryAll(this.#selectors.staleClassCarrier);
    this.#mask.clearInlineStyles(
      [...feedbackClassCarriers, ...originalClassCarriers, ...staleClassCarriers],
      CLEAN_SLATE_GROUP,
    );
    this.#mask.removeClasses(
      feedbackClassCarriers,
      ["corrected", "is-correct", "is-correct-answer", "correct-answer", "answer-correct"],
      FEEDBACK_GROUP,
    );
    this.#mask.removeClasses(
      originalClassCarriers,
      ["incorrect", "is-incorrect", "was-selected", "answer-incorrect", "selected-answer"],
      ORIGINAL_GROUP,
    );
    this.#mask.removeClasses(
      staleClassCarriers,
      [
        "removed-choice",
        "was-eliminated",
        "was-highlighted",
        "eliminated",
        "strikethrough",
        "highlighted",
      ],
      CLEAN_SLATE_GROUP,
    );
    window.getSelection()?.removeAllRanges();
    return report;
  }

  applyScoreShield(): CapabilityReport {
    const report = this.inspectCapabilities();
    if (report.pageKind === "score-report") {
      this.#mask.hide(this.#queryAll(this.#selectors.scoreValue), SCORE_SHIELD_GROUP);
      this.#mask.removeAttributes(
        this.#queryAll(this.#selectors.scoreRegion),
        ["title", "aria-label", "aria-describedby"],
        SCORE_SHIELD_GROUP,
      );
      window.getSelection()?.removeAllRanges();
    }
    return report;
  }

  gradeFresh(selection: AnswerChoice): AttemptOutcome {
    const correct = this.#readCorrectChoice();
    if (!correct) {
      return "unknown";
    }
    return selection === correct ? "correct" : "needs-review";
  }

  revealScores(): void {
    this.#withoutObservation(() => this.#mask.restoreGroup(SCORE_SHIELD_GROUP));
  }

  revealFeedback(): void {
    this.#withoutObservation(() => this.#mask.restoreGroup(FEEDBACK_GROUP));
  }

  revealOriginalAttempt(): void {
    this.#withoutObservation(() => this.#mask.restoreGroup(ORIGINAL_GROUP));
  }

  remaskQuestion(): void {
    this.applyCleanSlate();
  }

  restoreNormalReview(): void {
    this.#withoutObservation(() => {
      this.#mask.restoreAll();
      window.getSelection()?.removeAllRanges();
    });
  }

  mountFreshAttemptEntry(host: HTMLElement): boolean {
    const control = this.#queryAny(this.#selectors.reviewControl);
    if (!(control instanceof HTMLElement) || !control.parentElement) {
      return false;
    }
    control.insertAdjacentElement("afterend", host);
    return true;
  }

  mountStudyRail(host: HTMLElement): boolean {
    const mount = this.#queryAny(this.#selectors.studyRailMount);
    if (!(mount instanceof HTMLElement) || !mount.parentElement) {
      return false;
    }
    mount.insertAdjacentElement("afterend", host);
    return true;
  }

  navigate(direction: "previous" | "next"): boolean {
    void direction;
    return false;
  }

  observe(listener: (event: AdapterEvent) => void): () => void {
    if (this.#observer) {
      throw new Error("AamcFullLengthReviewAdapter already has an active observer.");
    }
    this.#lastLocation = this.#url().href;
    let lastPageKind = this.classifyPage();
    let lastQuestionKey = this.#readQuestionIdentifier();

    const process = (): void => {
      if (this.#processing) return;
      this.#processing = true;
      this.#observer?.disconnect();
      try {
        const pageKind = this.classifyPage();
        if (pageKind === "review") {
          document.documentElement.dataset.mkitProtection = "boot";
          const report = this.applyCleanSlate();
          listener({ type: "capability-change", report });
        }
        if (pageKind !== lastPageKind) {
          lastPageKind = pageKind;
          listener({ type: "page-change", pageKind });
        }
        const questionKey = this.#readQuestionIdentifier();
        if (questionKey !== lastQuestionKey) {
          lastQuestionKey = questionKey;
          listener({ type: "question-change" });
        }
      } finally {
        this.#processing = false;
        if (this.#observer) {
          this.#observeDocument();
        }
      }
    };

    this.#observer = new MutationObserver(process);
    this.#observeDocument();

    const routeListener = (): void => {
      document.documentElement.dataset.mkitProtection = "boot";
      process();
    };
    window.addEventListener("popstate", routeListener);
    window.addEventListener("hashchange", routeListener);
    window.addEventListener("pageshow", routeListener);
    this.#locationPoll = window.setInterval(() => {
      const href = this.#url().href;
      if (href !== this.#lastLocation) {
        this.#lastLocation = href;
        routeListener();
      }
    }, 250);

    return () => {
      this.#observer?.disconnect();
      this.#observer = null;
      if (this.#locationPoll !== null) {
        window.clearInterval(this.#locationPoll);
        this.#locationPoll = null;
      }
      window.removeEventListener("popstate", routeListener);
      window.removeEventListener("hashchange", routeListener);
      window.removeEventListener("pageshow", routeListener);
    };
  }

  #observeDocument(): void {
    this.#observer?.observe(this.#document, {
      attributes: true,
      attributeFilter: [
        "class",
        "title",
        "aria-label",
        "aria-describedby",
        "aria-labelledby",
        "style",
        "checked",
        "alt",
        "data-correct",
        "data-correct-choice",
        "data-question-id",
      ],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  #withoutObservation(action: () => void): void {
    const observing = this.#observer !== null;
    this.#observer?.disconnect();
    try {
      action();
    } finally {
      if (observing && this.#observer) {
        this.#observeDocument();
      }
    }
  }

  #queryAny(selectors: readonly string[]): Element | null {
    for (const selector of selectors) {
      const element = this.#document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  #queryAll(selectors: readonly string[]): Element[] {
    const elements = new Set<Element>();
    for (const selector of selectors) {
      for (const element of this.#document.querySelectorAll(selector)) {
        elements.add(element);
      }
    }
    return [...elements];
  }

  #readExamIdentifier(): string | null {
    const route = parseConfirmedReviewRoute(this.#url());
    if (route) {
      return route.examIdentifier;
    }
    const carrier = this.#queryAny(this.#selectors.examIdCarrier);
    return readFirstSafeAttribute(carrier, [
      "data-exam-id",
      "data-product-id",
      "data-mkit-fixture-exam-id",
    ]);
  }

  #readQuestionIdentifier(): string | null {
    const route = parseConfirmedReviewRoute(this.#url());
    if (route) {
      return route.questionIdentifier;
    }
    const carrier =
      this.#queryAny(this.#selectors.questionIdCarrier) ??
      this.#queryAny(this.#selectors.questionRegion);
    return readFirstSafeAttribute(carrier, [
      "data-question-id",
      "data-item-id",
      "data-mkit-fixture-question-id",
    ]);
  }

  #readSectionKey(): string | null {
    const carrier =
      this.#queryAny(this.#selectors.sectionCarrier) ??
      this.#queryAny(this.#selectors.questionRegion);
    const raw = readFirstSafeAttribute(carrier, [
      "data-section-id",
      "data-section-code",
      "data-mkit-fixture-section",
    ]);
    if (!raw) return parseConfirmedReviewRoute(this.#url()) ? "unknown" : null;
    return (
      raw
        .toLowerCase()
        .replaceAll(/[^a-z0-9/-]/g, "")
        .slice(0, 16) || null
    );
  }

  #readCategoryCode(): string | null {
    const carrier = this.#queryAny(this.#selectors.categoryCarrier);
    const raw = readFirstSafeAttribute(carrier, [
      "data-category-code",
      "data-content-category",
      "data-mkit-fixture-category",
    ]);
    if (!raw) return null;
    const normalized = raw.trim().toUpperCase();
    return /^(?:[1-9][A-D]|CARS[-_ ][A-Z0-9-]{1,20})$/.test(normalized)
      ? normalized.replaceAll(/[_ ]/g, "-")
      : null;
  }

  #readPassageOrDiscrete(): PassageOrDiscrete {
    if (parseConfirmedReviewRoute(this.#url())) {
      return this.#document.querySelector(".reviewable .reading-passage") ? "passage" : "discrete";
    }
    const carrier =
      this.#queryAny(this.#selectors.passageCarrier) ??
      this.#queryAny(this.#selectors.questionRegion);
    const raw = readFirstSafeAttribute(carrier, [
      "data-question-kind",
      "data-item-type",
      "data-mkit-fixture-kind",
    ]);
    return raw?.toLowerCase() === "discrete" ? "discrete" : "passage";
  }

  #readCorrectChoice(): AnswerChoice | null {
    if (parseConfirmedReviewRoute(this.#url())) {
      const choices = this.#queryAll(["ul.question-choices-multi.results > .multi-choice"]);
      const corrected = choices.filter((choice) => choice.classList.contains("corrected"));
      if (corrected.length !== 1) {
        return null;
      }
      const index = choices.indexOf(corrected[0] as Element);
      return (["A", "B", "C", "D"] as const)[index] ?? null;
    }
    const carrier =
      this.#queryAny(this.#selectors.correctChoiceCarrier) ??
      this.#queryAny(this.#selectors.questionRegion);
    const raw = readFirstSafeAttribute(carrier, [
      "data-correct-choice",
      "data-mkit-fixture-correct-choice",
    ]);
    const normalized = raw?.trim().toUpperCase();
    return normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D"
      ? normalized
      : null;
  }
}

function readFirstSafeAttribute(element: Element | null, names: readonly string[]): string | null {
  if (!element) return null;
  for (const name of names) {
    const value = element.getAttribute(name)?.trim();
    if (value && value.length <= 128 && /^[a-zA-Z0-9_./:-]+$/.test(value)) {
      return value;
    }
  }
  return null;
}

async function sha256Guard(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface ConfirmedReviewRoute {
  examIdentifier: string;
  questionIdentifier: string;
}

function parseConfirmedReviewRoute(url: URL): ConfirmedReviewRoute | null {
  if (url.protocol !== "https:" || url.hostname !== "mcatofficialprep.org") {
    return null;
  }
  const pathMatch = /^\/app\/aamc-mcat-practice-exam-(\d{1,3})\/?$/.exec(url.pathname);
  const hashMatch = /^#exams\/answers\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,128})$/.exec(
    url.hash,
  );
  if (!pathMatch || !hashMatch) {
    return null;
  }
  const examNumber = pathMatch[1];
  const examIdentifier = hashMatch[1];
  const questionIdentifier = hashMatch[2];
  if (!examNumber || !examIdentifier || !questionIdentifier) {
    return null;
  }
  return {
    examIdentifier: `${examNumber}:${examIdentifier}`,
    questionIdentifier,
  };
}

function isSyntheticFixtureUrl(url: URL): boolean {
  return url.hostname.endsWith(".invalid") || url.hostname === "127.0.0.1";
}
