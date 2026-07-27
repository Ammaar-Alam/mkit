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
import { ReversibleDomMask } from "./ReversibleDomMask";

const FEEDBACK_GROUP = "feedback";
const ORIGINAL_GROUP = "original";
const CLEAN_SLATE_GROUP = "clean-slate";
const SCORE_SHIELD_GROUP = "score-shield";
const PRIOR_HIGHLIGHTS_GROUP = "prior-highlights";
const PRIOR_CROSS_OUTS_GROUP = "prior-cross-outs";
const CONFIRMED_REVIEW_SWITCHES = new WeakSet<Element>();
const CONFIRMED_REVIEW_SWITCH_MARKER = "data-mkit-review-switch";
const SECTION_OVERVIEW_GROUP = "section-overview";
const SECTION_OVERVIEW_MARKER = "data-mkit-outcome-hidden";
const SECTION_OVERVIEW_RESULT_MARKER = "data-mkit-result-hidden";
const STUDY_RAIL_VIEWPORT_MARGIN = 16;
const STUDY_RAIL_PALETTE_CLEARANCE = 96;
const STUDY_RAIL_PALETTE_GAP = 8;
const CORRECTNESS_VISUAL_PROPERTIES = [
  "background",
  "background-color",
  "border",
  "border-color",
  "box-shadow",
  "outline",
  "outline-color",
] as const;
const PRIOR_HIGHLIGHT_CLASSES = ["user-highlight", "was-highlighted", "highlighted"] as const;
const PRIOR_CROSS_OUT_CLASSES = [
  "user-strikethrough",
  "removed-choice",
  "was-eliminated",
  "eliminated",
  "strikethrough",
] as const;

export class AamcFullLengthReviewAdapter implements FullLengthReviewAdapter {
  readonly #document: Document;
  readonly #mask = new ReversibleDomMask();
  readonly #url: () => URL;
  #observer: MutationObserver | null = null;
  #locationPoll: number | null = null;
  #lastLocation = "";
  #processing = false;
  #completedReviewSwitch: Element | null = null;
  #cleanSlatePreferences: CleanSlatePreferences | null = null;
  #highlightBaselines = new WeakMap<Element, Element[]>();
  #crossOutBaselines = new WeakMap<Element, Element[]>();
  /**
   * Groups the reader has intentionally revealed. Masking runs again on every
   * page mutation, so without this a revealed solution would be concealed again
   * by the next reconciliation.
   */
  readonly #revealedGroups = new Set<string>();

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
    /**
     * Row-level correctness on the completed section overview. The glyph is
     * painted by a `::before` on the cell, so the cue lives in the state class
     * rather than in any child node.
     */
    sectionOverviewCorrectness: [
      "ul.answers-wrapper.list-table > li.content .li-cell.correctness",
      '[data-mkit-fixture="section-overview-correctness"]',
    ],
    sectionOverviewAccessibleResult: [
      'table.answers-wrapper tr.content > td[headers^="answer-listing-header-correctness-"]',
      '[data-mkit-fixture="section-overview-accessible-result"]',
    ],
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
      ".reviewable .question-content-container > .answer-set-content > .fixed-width-sidebar-columns > .content-column > .questions-container > .content-container > .answer-container.incorrect.is-hidden.question-container > div[role='region']",
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
    priorHighlightCarrier: ["span.user-highlight", ".was-highlighted", ".highlighted"],
    priorCrossOutCarrier: [
      "span.user-strikethrough",
      ".removed-choice",
      ".was-eliminated",
      ".eliminated",
      ".strikethrough",
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
    studyRailToolbar: [
      ".reviewable .answer-toolbar-wrapper",
      '[data-mkit-fixture="answer-toolbar"]',
    ],
    studyRailPalette: [
      ".reviewable .highlight-color-options",
      '[data-mkit-fixture="highlight-palette"]',
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
    if (parseSectionOverviewRoute(this.#url())) {
      return "section-overview";
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
        ? this.#readConfirmedCorrectChoice(confirmedAnswerChoices)
        : this.#readCorrectChoice()) !== null;
    const categoryCodeFound =
      (confirmedRoute ? this.#readCategoryCode(confirmedReviewRoot) : this.#readCategoryCode()) !==
      null;
    const scoreRegionCount = this.#queryAll(this.#selectors.scoreValue).length;
    const reviewControlFound = Boolean(this.#queryAny(this.#selectors.reviewControl));
    const completedReviewSwitchFound = confirmedRoute
      ? Boolean(confirmedReviewRoot && this.#resolveCompletedReviewSwitch(confirmedReviewRoot))
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

  configureCleanSlate(preferences: CleanSlatePreferences): void {
    const previous = this.#cleanSlatePreferences;
    if (
      previous?.clearPreviousHighlightsEnabled === preferences.clearPreviousHighlightsEnabled &&
      previous.clearPreviousCrossOutsEnabled === preferences.clearPreviousCrossOutsEnabled
    ) {
      return;
    }
    this.#cleanSlatePreferences = { ...preferences };
    this.#withoutObservation(() => {
      if (previous?.clearPreviousHighlightsEnabled && !preferences.clearPreviousHighlightsEnabled) {
        this.#mask.restoreGroup(PRIOR_HIGHLIGHTS_GROUP);
        this.#highlightBaselines = new WeakMap();
      }
      if (previous?.clearPreviousCrossOutsEnabled && !preferences.clearPreviousCrossOutsEnabled) {
        this.#mask.restoreGroup(PRIOR_CROSS_OUTS_GROUP);
        this.#crossOutBaselines = new WeakMap();
      }
    });
  }

  applyCleanSlate(): CapabilityReport {
    const report = this.inspectCapabilities();
    if (report.pageKind !== "review") {
      return report;
    }

    // Masking hides the switch and its control, after which computed style can no
    // longer tell the presented control from its responsive duplicate. The
    // confirmed switch is marked first so a restarted content script reading an
    // already-masked page can still resolve it. Marking only happens here, where
    // protection is actually applied, so a fail-open page keeps no MKit marker.
    if (report.safeToReveal && this.#completedReviewSwitch?.isConnected) {
      this.#completedReviewSwitch.setAttribute(CONFIRMED_REVIEW_SWITCH_MARKER, "");
    }

    this.#hide(this.#selectors.navigatorSpoiler, CLEAN_SLATE_GROUP);
    this.#hide(this.#selectors.resultRail, ORIGINAL_GROUP);
    this.#hide(this.#selectors.status, FEEDBACK_GROUP);
    this.#hide(this.#selectors.metadata, CLEAN_SLATE_GROUP);
    this.#hide(this.#selectors.tooltip, CLEAN_SLATE_GROUP);
    this.#hide(this.#selectors.officialInputs, CLEAN_SLATE_GROUP);

    this.#hide(this.#selectors.explanation, FEEDBACK_GROUP);
    this.#hide(this.#selectors.inlineFeedback, FEEDBACK_GROUP);
    this.#hide(this.#selectors.correctMarker, FEEDBACK_GROUP);
    this.#hide(this.#selectors.originalMarker, ORIGINAL_GROUP);

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
    this.#mask.sanitizeInlineStyles(
      this.#queryAll(this.#selectors.correctnessVisualCarrier),
      CORRECTNESS_VISUAL_PROPERTIES,
      CLEAN_SLATE_GROUP,
    );
    this.#mask.clearInlineStyles(
      [...feedbackClassCarriers, ...originalClassCarriers].filter(
        (element) => !element.matches(".multi-choice"),
      ),
      CLEAN_SLATE_GROUP,
    );
    if (this.#maskGroupActive(FEEDBACK_GROUP)) {
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
    }
    if (this.#maskGroupActive(ORIGINAL_GROUP)) {
      this.#mask.removeClasses(
        originalClassCarriers,
        ["incorrect", "is-incorrect", "was-selected", "answer-incorrect", "selected-answer"],
        ORIGINAL_GROUP,
      );
    }
    this.#applyPriorAnnotationMasks();
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

  /**
   * Covers only the per-row correctness cue on a completed section overview. The
   * cue is a `::before` selected by the `correct`/`incorrect` state class, so the
   * class is removed reversibly rather than the cell hidden: the row, its
   * preview, native filters, sorting, pagination, and Review links all stay
   * usable. Returns whether any cue was covered.
   */
  applySectionOverviewCover(): boolean {
    if (this.classifyPage() !== "section-overview") {
      return false;
    }
    const cues = this.#queryAll(this.#selectors.sectionOverviewCorrectness);
    const accessibleResults = this.#queryAll(this.#selectors.sectionOverviewAccessibleResult);
    if (cues.length === 0 && accessibleResults.length === 0) {
      return false;
    }
    if (this.#revealedGroups.has(SECTION_OVERVIEW_GROUP)) {
      return true;
    }
    this.#mask.removeClasses(cues, ["correct", "incorrect"], SECTION_OVERVIEW_GROUP);
    this.#mask.removeAttributes(
      cues,
      ["title", "aria-label", "aria-hidden"],
      SECTION_OVERVIEW_GROUP,
    );
    for (const cue of cues) {
      cue.setAttribute("aria-hidden", "true");
      cue.setAttribute(SECTION_OVERVIEW_MARKER, "");
    }
    this.#mask.replaceText(accessibleResults, "Hidden", SECTION_OVERVIEW_GROUP);
    for (const result of accessibleResults) {
      result.setAttribute(SECTION_OVERVIEW_RESULT_MARKER, "");
    }
    return true;
  }

  revealSectionOverview(): void {
    this.#revealedGroups.add(SECTION_OVERVIEW_GROUP);
    this.#withoutObservation(() => {
      this.#mask.restoreGroup(SECTION_OVERVIEW_GROUP);
      for (const marked of this.#document.querySelectorAll(`[${SECTION_OVERVIEW_MARKER}]`)) {
        marked.removeAttribute(SECTION_OVERVIEW_MARKER);
      }
      for (const marked of this.#document.querySelectorAll(`[${SECTION_OVERVIEW_RESULT_MARKER}]`)) {
        marked.removeAttribute(SECTION_OVERVIEW_RESULT_MARKER);
      }
    });
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
    this.#revealedGroups.add(FEEDBACK_GROUP);
    this.#withoutObservation(() => this.#mask.restoreGroup(FEEDBACK_GROUP));
  }

  revealOriginalAttempt(): void {
    this.#revealedGroups.add(ORIGINAL_GROUP);
    this.#withoutObservation(() => this.#mask.restoreGroup(ORIGINAL_GROUP));
  }

  remaskQuestion(): void {
    // Retrying a question deliberately takes back every earlier reveal, so the
    // reader answers it concealed again.
    this.#revealedGroups.clear();
    this.applyCleanSlate();
  }

  restoreNormalReview(): void {
    this.#withoutObservation(() => {
      this.#revealedGroups.clear();
      this.#mask.restoreAll();
      for (const marked of this.#document.querySelectorAll(
        `[${CONFIRMED_REVIEW_SWITCH_MARKER}], [${SECTION_OVERVIEW_MARKER}], [${SECTION_OVERVIEW_RESULT_MARKER}]`,
      )) {
        marked.removeAttribute(CONFIRMED_REVIEW_SWITCH_MARKER);
        marked.removeAttribute(SECTION_OVERVIEW_MARKER);
        marked.removeAttribute(SECTION_OVERVIEW_RESULT_MARKER);
      }
      this.#completedReviewSwitch = null;
      this.#highlightBaselines = new WeakMap();
      this.#crossOutBaselines = new WeakMap();
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

  getStudyRailAnchor(): StudyRailAnchor {
    const fallback = {
      top: STUDY_RAIL_VIEWPORT_MARGIN,
      right: STUDY_RAIL_VIEWPORT_MARGIN,
    };
    const reviewRoot = this.#activeReviewRoot();
    const toolbar = this.#renderedElement(
      this.#queryAll(this.#selectors.studyRailToolbar).filter(
        (element) => !reviewRoot || reviewRoot.contains(element),
      ),
    );
    if (!toolbar) {
      return fallback;
    }
    const toolbarRect = toolbar.getBoundingClientRect();
    let bottom = toolbarRect.bottom + STUDY_RAIL_PALETTE_CLEARANCE;
    const palette = this.#renderedElement(
      this.#queryAll(this.#selectors.studyRailPalette).filter((element) =>
        toolbar.contains(element),
      ),
    );
    if (palette) {
      bottom =
        Math.max(toolbarRect.bottom, palette.getBoundingClientRect().bottom) +
        STUDY_RAIL_PALETTE_GAP;
    }
    return {
      top: Math.ceil(Math.max(STUDY_RAIL_VIEWPORT_MARGIN, bottom)),
      right: STUDY_RAIL_VIEWPORT_MARGIN,
    };
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
    let lastCapabilitySignature =
      lastPageKind === "review" ? capabilityReportSignature(this.inspectCapabilities()) : null;

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
            // A reveal applies to the question it was made on, so arriving at a
            // different question conceals again before masking runs.
            this.#revealedGroups.clear();
          }
          const report = this.applyCleanSlate();
          const nextCapabilitySignature = capabilityReportSignature(report);
          if (nextCapabilitySignature !== lastCapabilitySignature) {
            lastCapabilitySignature = nextCapabilitySignature;
            listener({ type: "capability-change", report });
          }
        } else if (pageKind === "section-overview") {
          this.applySectionOverviewCover();
          lastCapabilitySignature = null;
        } else {
          lastCapabilitySignature = null;
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

    // A route signal alone does not mean the question changed: the page fires
    // popstate for in-place updates too. Re-veiling unconditionally would
    // collapse the masked page to zero height and lose the reader's scroll
    // position, so `process()` arms the cover only when the route or question
    // actually moved.
    const routeListener = (): void => {
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
    const shouldResume = this.#observer !== null && !this.#processing;
    this.#observer?.disconnect();
    try {
      action();
    } finally {
      if (shouldResume && this.#observer) {
        this.#observeDocument();
      }
    }
  }

  /**
   * Masking runs again on every page mutation, so a group the reader has already
   * revealed is left alone: re-hiding it would take back an intentional reveal
   * the moment the page changed. Class and attribute masking use the same guard
   * through `#maskGroupActive`.
   */
  #hide(selectors: readonly string[], group: string): void {
    if (!this.#maskGroupActive(group)) return;
    this.#mask.hide(this.#queryAll(selectors), group);
  }

  #maskGroupActive(group: string): boolean {
    return !this.#revealedGroups.has(group);
  }

  #applyPriorAnnotationMasks(): void {
    const preferences = this.#cleanSlatePreferences;
    if (!preferences) return;
    const question = this.#activeAnnotationQuestion();
    if (!question) return;

    if (preferences.clearPreviousHighlightsEnabled) {
      const highlights = this.#annotationBaseline(
        question,
        this.#selectors.priorHighlightCarrier,
        this.#highlightBaselines,
      );
      this.#mask.removeClasses(highlights, PRIOR_HIGHLIGHT_CLASSES, PRIOR_HIGHLIGHTS_GROUP);
    }
    if (preferences.clearPreviousCrossOutsEnabled) {
      const crossOuts = this.#annotationBaseline(
        question,
        this.#selectors.priorCrossOutCarrier,
        this.#crossOutBaselines,
      );
      this.#mask.removeClasses(crossOuts, PRIOR_CROSS_OUT_CLASSES, PRIOR_CROSS_OUTS_GROUP);
    }
  }

  #annotationBaseline(
    question: Element,
    selectors: readonly string[],
    baselines: WeakMap<Element, Element[]>,
  ): Element[] {
    const existing = baselines.get(question);
    if (existing) return existing;
    const baseline = this.#queryAllWithin(question, selectors).filter((element) =>
      this.#isAuthoredVisible(element),
    );
    baselines.set(question, baseline);
    return baseline;
  }

  #activeAnnotationQuestion(): Element | null {
    if (!parseConfirmedReviewRoute(this.#url())) {
      const candidates = this.#queryAll(this.#selectors.questionRegion).filter((element) =>
        this.#isAuthoredVisible(element),
      );
      return candidates.length === 1 ? (candidates[0] ?? null) : null;
    }

    const reviewRoot = this.#activeReviewRoot();
    if (!reviewRoot) return null;
    const containers = new Set(
      this.#structuralAnswerChoices(reviewRoot)
        .map((choice) => choice.closest(".answer-container.question-container"))
        .filter((element): element is Element => element !== null),
    );
    if (containers.size !== 1) return null;
    const question = [...containers][0] ?? null;
    return question && this.#isAuthoredVisible(question) ? question : null;
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

  #queryAllWithin(root: Element, selectors: readonly string[]): Element[] {
    const elements = new Set<Element>();
    for (const selector of selectors) {
      if (root.matches(selector)) {
        elements.add(root);
      }
      for (const element of root.querySelectorAll(selector)) {
        elements.add(element);
      }
    }
    return [...elements];
  }

  #queryAnyWithin(root: Element, selectors: readonly string[]): Element | null {
    return this.#queryAll(selectors).find((element) => root.contains(element)) ?? null;
  }

  #renderedElement(elements: readonly Element[]): HTMLElement | null {
    return (
      elements.find((element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return Number.isFinite(rect.bottom) && rect.bottom > 0 && rect.width > 0;
      }) ?? null
    );
  }

  #resolveCompletedReviewSwitch(reviewRoot: Element): Element | null {
    const candidates = this.#queryAll(this.#selectors.completedReviewSwitch).filter((element) => {
      const owner = element.closest(".reviewable");
      return owner === null || owner === reviewRoot;
    });
    if (
      this.#completedReviewSwitch?.isConnected &&
      candidates.includes(this.#completedReviewSwitch)
    ) {
      return this.#completedReviewSwitch;
    }

    // Masking the switch erases the only signal that distinguished it from its
    // responsive duplicate: both then compute `display: none`. The confirmed
    // control therefore carries MKit's own marker, which survives a restarted
    // content script reading an already-masked page.
    const maskedConfirmedCandidates = candidates.filter(
      (element) =>
        element.hasAttribute("data-mkit-hidden") &&
        (CONFIRMED_REVIEW_SWITCHES.has(element) ||
          element.hasAttribute(CONFIRMED_REVIEW_SWITCH_MARKER)),
    );
    if (maskedConfirmedCandidates.length === 1) {
      this.#completedReviewSwitch = maskedConfirmedCandidates[0] ?? null;
      return this.#completedReviewSwitch;
    }
    if (maskedConfirmedCandidates.length > 1) {
      this.#completedReviewSwitch = null;
      return null;
    }

    const visibleCandidates = candidates.filter((element) =>
      this.#isReviewSwitchControlShown(this.#reviewSwitchControl(element)),
    );
    this.#completedReviewSwitch =
      visibleCandidates.length === 1 ? (visibleCandidates[0] ?? null) : null;
    if (this.#completedReviewSwitch) {
      CONFIRMED_REVIEW_SWITCHES.add(this.#completedReviewSwitch);
    }
    return this.#completedReviewSwitch;
  }

  /**
   * The completed-review switch is a custom control: the native input is
   * visually hidden and its owning `.review-answer` paints the visible
   * affordance. Authored visibility therefore has to be resolved at that
   * control rather than at a zero-opacity, zero-sized input.
   */
  #reviewSwitchControl(element: Element): Element {
    return element.closest(".review-answer") ?? element;
  }

  /**
   * The switch selects between the answerable and reviewable views of a
   * question, so a completed review reports the state that hides the answerable
   * view the switch lives in. Judging the whole ancestor chain would therefore
   * reject every copy of a control the page deliberately keeps mounted, while
   * judging the control alone would admit responsive duplicates that are hidden
   * at a wrapper. Visibility is resolved between those boundaries: from the
   * control up to, but excluding, the view container the switch itself governs.
   */
  /**
   * Judged from the control up to, but excluding, the view container the switch
   * governs. A completed review reports the state that hides its own answerable
   * view, through either the `.answerable` region or the card wrapping it, so
   * that container's visibility is page view state rather than concealment of
   * the control. Everything below it, including responsive duplicates hidden at
   * a wrapper, is still judged normally.
   */
  #isReviewSwitchControlShown(control: Element): boolean {
    const boundary = control.closest(".answerable, .luca-ui-card");
    const view = this.#document.defaultView;
    let current: Element | null = control;
    while (current && current !== boundary) {
      if (
        current.hasAttribute("hidden") ||
        current.hasAttribute("data-mkit-hidden") ||
        current.getAttribute("aria-hidden") === "true" ||
        (current instanceof HTMLElement && current.inert)
      ) {
        return false;
      }
      if (view) {
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
      return this.#readConfirmedCorrectChoice(this.#confirmedAnswerChoices());
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

  #readConfirmedCorrectChoice(choices: readonly Element[]): AnswerChoice | null {
    if (choices.length !== 4) {
      return null;
    }
    // Both review scopes mark the one correct option with either class, so
    // grading accepts either. Requiring exactly one marked choice keeps an
    // ambiguous shape ungraded.
    const correctChoices = choices.filter(
      (choice) =>
        this.#mask.hasClass(choice, "corrected", FEEDBACK_GROUP) ||
        this.#mask.hasClass(choice, "correct", FEEDBACK_GROUP),
    );
    if (correctChoices.length !== 1) {
      return null;
    }
    const index = choices.indexOf(correctChoices[0] as Element);
    return (["A", "B", "C", "D"] as const)[index] ?? null;
  }

  #confirmedAnswerChoices(reviewRoot: Element | null = this.#activeReviewRoot()): Element[] {
    return reviewRoot ? this.#structuralAnswerChoices(reviewRoot) : [];
  }

  #structuralAnswerChoices(reviewRoot: Element): Element[] {
    const questionRegion = reviewRoot.querySelector(":scope > .question-content-container");
    if (!questionRegion || !this.#isAuthoredVisible(questionRegion)) {
      return [];
    }
    return [...questionRegion.querySelectorAll(".multi-choice")].filter(
      (choice) =>
        choice.closest(".reviewable") === reviewRoot &&
        !choice.closest(".sidebar-column, .result-wrapper, .expander-content"),
    );
  }

  #activeReviewRoot(): Element | null {
    const questionRoots = [...this.#document.querySelectorAll(".reviewable")].filter(
      (root) => this.#isAuthoredVisible(root) && this.#structuralAnswerChoices(root).length > 0,
    );
    return questionRoots.length === 1 ? (questionRoots[0] ?? null) : null;
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
      if (view) {
        const style = view.getComputedStyle(current);
        if (
          (style.display === "none" && !this.#isHiddenByPageCover(current, pageCoverActive)) ||
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

  /**
   * The boot and unsupported covers hide every direct body child that is not an
   * MKit host, so that single rule must not read as authored concealment: the
   * page wrapper MKit itself just covered would otherwise report every review
   * anchor as hidden and startup could never complete. Computed `display` is not
   * inherited by descendants, so exempting the covered element alone still
   * judges responsive duplicates and page-authored hiding by their own styles.
   */
  #isHiddenByPageCover(element: Element, pageCoverActive: boolean): boolean {
    return (
      pageCoverActive &&
      element.parentElement === this.#document.body &&
      !element.hasAttribute("data-mkit-host")
    );
  }

  #isMKitPageCoverActive(): boolean {
    const protection = this.#document.documentElement.dataset.mkitProtection;
    return protection === "boot" || protection === "unsupported";
  }
}

function capabilityReportSignature(report: CapabilityReport): string {
  return JSON.stringify([
    report.pageKind,
    report.safeToReveal,
    report.questionRegionFound,
    report.answerChoiceCount,
    report.navigatorFound,
    report.feedbackRegionFound,
    report.explanationFound,
    report.correctAnswerParseable,
    report.categoryCodeFound,
    report.scoreRegionCount,
    report.reviewControlFound,
    report.issues,
  ]);
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

/**
 * The completed section overview lists every question in one section. It is not
 * a review workspace, so it is recognized separately from the answer routes.
 */
function parseSectionOverviewRoute(url: URL): { sectionIdentifier: string } | null {
  if (url.protocol !== "https:" || url.hostname !== "www.mcatofficialprep.org") {
    return null;
  }
  if (!/^\/app\/aamc-mcat-practice-exam-\d{1,3}\/?$/.test(url.pathname)) {
    return null;
  }
  const match = /^#exams\/details\/exam_section\/([a-zA-Z0-9_-]{1,128})$/.exec(url.hash);
  const sectionIdentifier = match?.[1];
  return sectionIdentifier ? { sectionIdentifier } : null;
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
