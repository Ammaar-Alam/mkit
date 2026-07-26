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
const CORRECTNESS_VISUAL_PROPERTIES = [
  "background",
  "background-color",
  "border",
  "border-color",
  "box-shadow",
  "outline",
  "outline-color",
] as const;

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
      "label.review-answer:has(input.view-answers.switchable[role='switch'])",
      ".review-answer label:has(input.view-answers.switchable[role='switch'])",
      ".review-answer input.view-answers.switchable[role='switch']",
      '[data-mkit-fixture="official-answer"]',
      '.answer-choice input[type="radio"]',
    ],
    completedReviewSwitch: [".review-answer input.view-answers.switchable[role='switch']"],
    navigator: [".icon-bar.navigate", '[data-mkit-fixture="navigator"]', "#question-navigator"],
    navigatorSpoiler: ['[data-mkit-fixture="navigator"]', "#question-navigator"],
    resultRail: [
      ".reviewable > .question-content-container > .answer-set-content > .fixed-width-sidebar-columns > .sidebar-column > .sidebar-container",
      ".reviewable .fixed-width-sidebar-columns > .sidebar-column > .sidebar-container",
      ".reviewable .sidebar-column > .sidebar-container",
      ".reviewable .sidebar-container > .choices-container",
      ".reviewable .choices-container",
      ".reviewable .result-wrapper",
      ".choices-container > .result-wrapper[role='region']",
      '[data-mkit-fixture="result-rail"]',
      "#official-results-rail",
    ],
    status: [
      ".reviewable .result-wrapper .result",
      ".reviewable .result-wrapper .is-incorrect",
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
    inlineFeedback: [
      ".reviewable .question-content-container > .answer-set-content > .fixed-width-sidebar-columns > .content-column > .questions-container > .content-container > .answer-container.correct.is-hidden.question-container > div[role='region']",
    ],
    correctMarker: ['[data-mkit-fixture="correct-marker"]', ".correct-marker"],
    originalMarker: [
      ".reviewable .result-wrapper .result-group:has(.result-label.user-label)",
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
      ".multi-choice.correct",
      "ul.question-choices-multi.results.corrected",
      ".is-correct:not(.answer-container):not(.question-container):not(.question-content-container)",
      ".is-correct-answer:not(.answer-container):not(.question-container):not(.question-content-container)",
      ".correct-answer:not(.answer-container):not(.question-container):not(.question-content-container)",
      ".answer-correct:not(.answer-container):not(.question-container):not(.question-content-container)",
    ],
    originalClassCarrier: [
      ".multi-choice.incorrect",
      "ul.question-choices-multi.results.incorrect",
      ".result-wrapper .is-incorrect",
      ".is-incorrect:not(.answer-container):not(.question-container):not(.question-content-container)",
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
    correctnessVisualCarrier: [
      ".reviewable > .question-content-container",
      ".reviewable .answer-container.question-container",
      ".reviewable ul.question-choices-multi.results",
      ".reviewable .multi-choice",
      ".reviewable .choice-content",
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
      ".reviewable .sidebar-container > .choices-container",
      ".reviewable .choices-container",
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
    const confirmedRoute = parseConfirmedReviewRoute(this.#url());
    const confirmedReviewRoot = confirmedRoute ? this.#activeReviewRoot() : null;
    const confirmedAnswerChoices = confirmedRoute
      ? this.#confirmedAnswerChoices(confirmedReviewRoot)
      : null;
    const pageKind = this.classifyPage();
    const questionRegionFound = confirmedRoute
      ? Boolean(
          confirmedReviewRoot &&
            this.#queryAnyWithin(confirmedReviewRoot, this.#selectors.questionRegion),
        )
      : Boolean(this.#queryAny(this.#selectors.questionRegion));
    const answerChoiceCount = confirmedAnswerChoices
      ? confirmedAnswerChoices.length
      : this.#queryAll(this.#selectors.answerChoices).length;
    const navigatorFound = confirmedRoute
      ? Boolean(
          confirmedReviewRoot &&
            this.#queryAnyWithin(confirmedReviewRoot, this.#selectors.navigator),
        )
      : Boolean(this.#queryAny(this.#selectors.navigator));
    const feedbackSelectors = [
      ...this.#selectors.status,
      ...this.#selectors.correctMarker,
      ...this.#selectors.explanation,
      ...this.#selectors.inlineFeedback,
    ];
    const feedbackRegionFound = confirmedRoute
      ? Boolean(confirmedReviewRoot && this.#queryAnyWithin(confirmedReviewRoot, feedbackSelectors))
      : Boolean(this.#queryAny(feedbackSelectors));
    const explanationFound = confirmedRoute
      ? Boolean(
          confirmedReviewRoot &&
            this.#queryAnyWithin(confirmedReviewRoot, this.#selectors.explanation),
        )
      : Boolean(this.#queryAny(this.#selectors.explanation));
    const correctAnswerParseable =
      (confirmedRoute && confirmedAnswerChoices
        ? this.#readConfirmedCorrectChoice(confirmedRoute, confirmedAnswerChoices)
        : this.#readCorrectChoice()) !== null;
    const categoryCodeFound =
      (confirmedRoute ? this.#readCategoryCode(confirmedReviewRoot) : this.#readCategoryCode()) !==
      null;
    const scoreRegionCount = this.#queryAll(this.#selectors.scoreValue).length;
    const reviewControlFound = Boolean(this.#queryAny(this.#selectors.reviewControl));
    const completedReviewSwitchFound = confirmedRoute
      ? Boolean(
          confirmedReviewRoot &&
            this.#queryAnyWithin(confirmedReviewRoot, this.#selectors.completedReviewSwitch),
        )
      : false;
    const issues: AdapterIssueCode[] = [];

    if (pageKind === "review") {
      if (!questionRegionFound) issues.push("QUESTION_REGION_MISSING");
      if (answerChoiceCount !== 4) issues.push("ANSWER_CHOICES_INCOMPLETE");
      if (!navigatorFound) issues.push("NAVIGATOR_MISSING");
      if (!feedbackRegionFound) issues.push("FEEDBACK_REGION_MISSING");
      if (confirmedRoute && !completedReviewSwitchFound) {
        issues.push("REVIEW_SWITCH_MISSING");
      }
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
    const sectionKey = await this.#readSectionKey();
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
      progress: {
        scope: parseConfirmedReviewRoute(this.#url())?.kind ?? "unknown",
        current: null,
        total: null,
      },
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
    this.#mask.hide(this.#queryAll(this.#selectors.inlineFeedback), FEEDBACK_GROUP);
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
    this.#mask.sanitizeInlineStyles(
      this.#queryAll(this.#selectors.correctnessVisualCarrier),
      CORRECTNESS_VISUAL_PROPERTIES,
      CLEAN_SLATE_GROUP,
    );
    this.#mask.clearInlineStyles(
      [...feedbackClassCarriers, ...originalClassCarriers, ...staleClassCarriers].filter(
        (element) => !element.matches(".multi-choice"),
      ),
      CLEAN_SLATE_GROUP,
    );
    this.#mask.removeClasses(
      feedbackClassCarriers,
      [
        "corrected",
        "correct",
        "is-correct",
        "is-correct-answer",
        "correct-answer",
        "answer-correct",
      ],
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
    if (control.nextElementSibling !== host) {
      control.insertAdjacentElement("afterend", host);
    }
    return true;
  }

  mountStudyRail(host: HTMLElement): boolean {
    const mount = this.#queryAny(this.#selectors.studyRailMount);
    if (!(mount instanceof HTMLElement) || !this.#document.body) {
      return false;
    }
    if (host.parentElement !== this.#document.body) {
      this.#document.body.append(host);
    }
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
        const questionKey = this.#readQuestionIdentifier();
        const pageChanged = pageKind !== lastPageKind;
        const questionChanged = questionKey !== lastQuestionKey;
        if (pageKind === "review") {
          if (pageChanged || questionChanged) {
            document.documentElement.dataset.mkitProtection = "boot";
          }
          const report = this.applyCleanSlate();
          listener({ type: "capability-change", report });
        }
        if (pageChanged) {
          lastPageKind = pageKind;
          listener({ type: "page-change", pageKind });
        }
        if (questionChanged) {
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

  #queryAnyWithin(root: Element, selectors: readonly string[]): Element | null {
    return this.#queryAll(selectors).find((element) => root.contains(element)) ?? null;
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

  async #readSectionKey(): Promise<string | null> {
    const route = parseConfirmedReviewRoute(this.#url());
    if (route?.sectionIdentifier) {
      return sha256Guard(`section:${route.examIdentifier}:${route.sectionIdentifier}`);
    }
    const reviewRoot = route ? this.#activeReviewRoot() : null;
    const carrier = route
      ? reviewRoot &&
        (this.#queryAnyWithin(reviewRoot, this.#selectors.sectionCarrier) ??
          this.#queryAnyWithin(reviewRoot, this.#selectors.questionRegion))
      : (this.#queryAny(this.#selectors.sectionCarrier) ??
        this.#queryAny(this.#selectors.questionRegion));
    const raw = readFirstSafeAttribute(carrier, [
      "data-section-id",
      "data-section-code",
      "data-mkit-fixture-section",
    ]);
    if (!raw) return route ? "unknown" : null;
    return (
      raw
        .toLowerCase()
        .replaceAll(/[^a-z0-9/-]/g, "")
        .slice(0, 16) || null
    );
  }

  #readCategoryCode(confirmedReviewRoot?: Element | null): string | null {
    const route = parseConfirmedReviewRoute(this.#url());
    const reviewRoot = route
      ? confirmedReviewRoot === undefined
        ? this.#activeReviewRoot()
        : confirmedReviewRoot
      : null;
    const carrier = route
      ? reviewRoot && this.#queryAnyWithin(reviewRoot, this.#selectors.categoryCarrier)
      : this.#queryAny(this.#selectors.categoryCarrier);
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
      return this.#activeReviewRoot()?.querySelector(".reading-passage") ? "passage" : "discrete";
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
    const route = parseConfirmedReviewRoute(this.#url());
    if (route) {
      return this.#readConfirmedCorrectChoice(route, this.#confirmedAnswerChoices());
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

  #readConfirmedCorrectChoice(
    route: ConfirmedReviewRoute,
    choices: readonly Element[],
  ): AnswerChoice | null {
    if (choices.length !== 4) {
      return null;
    }
    const correctChoices = choices.filter(
      (choice) =>
        this.#mask.hasClass(choice, "corrected", FEEDBACK_GROUP) ||
        (route.kind === "full-length" && this.#mask.hasClass(choice, "correct", FEEDBACK_GROUP)),
    );
    if (correctChoices.length !== 1) {
      return null;
    }
    const index = choices.indexOf(correctChoices[0] as Element);
    return (["A", "B", "C", "D"] as const)[index] ?? null;
  }

  #confirmedAnswerChoices(reviewRoot: Element | null = this.#activeReviewRoot()): Element[] {
    const questionRegion = reviewRoot?.querySelector(":scope > .question-content-container");
    if (!reviewRoot || !questionRegion || !this.#isAuthoredVisible(questionRegion)) {
      return [];
    }
    return [...questionRegion.querySelectorAll(".multi-choice")].filter(
      (choice) =>
        choice.closest(".reviewable") === reviewRoot &&
        !choice.closest(".sidebar-column, .result-wrapper, .expander-content"),
    );
  }

  #activeReviewRoot(): Element | null {
    const visibleRoots = [...this.#document.querySelectorAll(".reviewable")].filter((root) =>
      this.#isAuthoredVisible(root),
    );
    return visibleRoots.length === 1 ? (visibleRoots[0] ?? null) : null;
  }

  #isAuthoredVisible(element: Element): boolean {
    const view = this.#document.defaultView;
    const pageCoverActive = this.#isMKitPageCoverActive();
    let current: Element | null = element;
    while (current) {
      if (
        current.hasAttribute("hidden") ||
        current.hasAttribute("data-mkit-hidden") ||
        current.getAttribute("aria-hidden") === "true" ||
        (current instanceof HTMLElement && current.inert)
      ) {
        return false;
      }
      if (current instanceof HTMLElement) {
        if (
          current.style.display === "none" ||
          current.style.visibility === "hidden" ||
          current.style.visibility === "collapse" ||
          Number.parseFloat(current.style.opacity || "1") === 0
        ) {
          return false;
        }
      }
      if (view && !pageCoverActive) {
        const style = view.getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
      }
      current = current.parentElement;
    }
    return true;
  }

  #isMKitPageCoverActive(): boolean {
    const protection = this.#document.documentElement.dataset.mkitProtection;
    return protection === "boot" || protection === "unsupported";
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
  kind: "full-length" | "section";
  questionIdentifier: string;
  sectionIdentifier: string | null;
}

function parseConfirmedReviewRoute(url: URL): ConfirmedReviewRoute | null {
  if (url.protocol !== "https:" || url.hostname !== "www.mcatofficialprep.org") {
    return null;
  }
  const pathMatch = /^\/app\/aamc-mcat-practice-exam-(\d{1,3})\/?$/.exec(url.pathname);
  if (!pathMatch) {
    return null;
  }
  const examNumber = pathMatch[1];
  if (!examNumber) {
    return null;
  }

  const fullLengthMatch = /^#exams\/answers\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,128})$/.exec(
    url.hash,
  );
  if (fullLengthMatch) {
    const examIdentifier = fullLengthMatch[1];
    const questionIdentifier = fullLengthMatch[2];
    if (!examIdentifier || !questionIdentifier) {
      return null;
    }
    return {
      examIdentifier: `${examNumber}:${examIdentifier}`,
      kind: "full-length",
      questionIdentifier,
      sectionIdentifier: null,
    };
  }

  const sectionMatch =
    /^#exams\/([a-zA-Z0-9_-]{1,128})\/exam_sections\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]{1,128})$/.exec(
      url.hash,
    );
  if (!sectionMatch) {
    return null;
  }
  const examIdentifier = sectionMatch[1];
  const sectionIdentifier = sectionMatch[2];
  const questionIdentifier = sectionMatch[3];
  if (!examIdentifier || !sectionIdentifier || !questionIdentifier) {
    return null;
  }
  return {
    examIdentifier: `${examNumber}:${examIdentifier}`,
    kind: "section",
    questionIdentifier,
    sectionIdentifier,
  };
}

function isSyntheticFixtureUrl(url: URL): boolean {
  return url.hostname.endsWith(".invalid") || url.hostname === "127.0.0.1";
}
