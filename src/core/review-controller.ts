import type {
  AdapterEvent,
  CapabilityReport,
  FullLengthReviewAdapter,
  SanitizedQuestionContext,
} from "../adapter/contracts";
import { type MKitPreflight, NORMAL_REVIEW_REQUEST_EVENT } from "../content/preflight";
import type {
  AnswerChoice,
  AttemptRecord,
  Confidence,
  FreshAttemptMode,
  SessionRecord,
  SettingsRecord,
  StorageRepository,
} from "../storage";
import { attemptKey } from "../storage";
import {
  type ActiveSessionSummary,
  type GateProps,
  type MKitViewHandle,
  mountGate,
  mountScoreShield,
  mountStudyRail,
  mountSummary,
  type SaveState,
  type ScoreShieldProps,
  type SectionLabel,
  type SectionSummary,
  type StudyRailProps,
  type StudyRailStage,
  type SummaryProps,
} from "../ui";
import { FreshAttemptKeyboardController } from "./keyboard";
import { SessionService } from "./session-service";
import { INITIAL_REVIEW_STATE, type ReviewState, reduceReviewState } from "./state";
import { summarizeSession } from "./summary";
import { ActiveQuestionTimer, type TimingSample } from "./timing";

type ViewHandle = Pick<MKitViewHandle<unknown>, "destroy">;

interface PendingNoteSave {
  sessionId: string;
  questionKey: string;
  note: string;
}

export interface ReviewControllerOptions {
  adapter: FullLengthReviewAdapter;
  preflight: MKitPreflight;
  repository: StorageRepository;
  uiCss: string;
}

export class ReviewController {
  readonly #adapter: FullLengthReviewAdapter;
  readonly #preflight: MKitPreflight;
  readonly #repository: StorageRepository;
  readonly #sessions: SessionService;
  readonly #uiStyle: HTMLStyleElement;
  readonly #timer: ActiveQuestionTimer;

  #state: ReviewState = INITIAL_REVIEW_STATE;
  #settings: SettingsRecord | null = null;
  #session: SessionRecord | null = null;
  #attempt: AttemptRecord | null = null;
  #context: SanitizedQuestionContext | null = null;
  #availableSession: SessionRecord | null = null;
  #pendingMode: FreshAttemptMode | null = null;
  #saveState: SaveState = "idle";
  #answersRevealed = false;
  #finishConfirmationOpen = false;
  #view: ViewHandle | null = null;
  #gateView: MKitViewHandle<GateProps> | null = null;
  #railView: MKitViewHandle<StudyRailProps> | null = null;
  // The native toolbar anchor is viewport-relative. Keep the value captured
  // when this rail mounts so save-state rerenders cannot move it after a scroll.
  #railAnchor: StudyRailProps["anchor"] | null = null;
  #scoreView: MKitViewHandle<ScoreShieldProps> | null = null;
  #summaryView: MKitViewHandle<SummaryProps> | null = null;
  #stopObserver: (() => void) | null = null;
  #stopAnnotationSealBoundary: (() => void) | null = null;
  #generation = 0;
  #normalReview = false;
  readonly #pendingNoteSaves = new Map<string, PendingNoteSave>();
  #noteSaveActive = false;
  readonly #keyboard: FreshAttemptKeyboardController;

  constructor(options: ReviewControllerOptions) {
    this.#adapter = options.adapter;
    this.#preflight = options.preflight;
    this.#repository = options.repository;
    this.#sessions = new SessionService(options.repository);
    this.#uiStyle = document.createElement("style");
    this.#uiStyle.textContent = options.uiCss;
    this.#timer = new ActiveQuestionTimer((sample) => {
      void this.#recordTiming(sample);
    });
    // Shortcuts drive the same handlers as the rail controls, and stay disarmed
    // until a masked rail is actually showing so they can never reach the native
    // page or act on a revealed answer.
    this.#keyboard = new FreshAttemptKeyboardController({
      select: (choice) => {
        void this.#selectAnswer(choice);
      },
      toggleElimination: (choice) => {
        void this.#toggleElimination(choice);
      },
      check: () => {
        void this.#checkPractice();
      },
      toggleFlag: () => {
        if (this.#attempt) void this.#updateAttempt({ flagged: !this.#attempt.flagged });
      },
      toggleReviewAgain: () => {
        if (this.#attempt) void this.#updateAttempt({ reviewAgain: !this.#attempt.reviewAgain });
      },
      navigate: (direction) => {
        this.#adapter.navigate(direction);
      },
    });
  }

  start(): void {
    this.#showBusyGate();
    this.#stopObserver = this.#adapter.observe((event) => {
      this.#handleAdapterEvent(event);
    });
    void this.reconcile();
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          void this.reconcile();
        },
        { once: true },
      );
    }
  }

  async reconcile(): Promise<void> {
    if (this.#normalReview) return;
    const generation = ++this.#generation;
    const pageKind = this.#adapter.classifyPage();
    if (pageKind !== "review") {
      this.#cancelAnnotationSealBoundary();
    }

    if (pageKind === "non-review") {
      this.#timer.setSessionActive(false);
      this.#clearView();
      this.#preflight.setProtection("non-review");
      return;
    }

    if (pageKind === "unknown-review") {
      this.#timer.setSessionActive(false);
      this.#preflight.setProtection("boot");
      this.#showBusyGate();
      return;
    }

    try {
      this.#settings ??= await this.#repository.getSettings();
      if (generation !== this.#generation || this.#normalReview) return;
      if (!this.#settings.enabled) {
        this.normalReview();
        return;
      }

      if (pageKind === "score-report") {
        await this.#reconcileScoreReport(generation);
        return;
      }

      this.#adapter.configureCleanSlate({
        clearPreviousHighlightsEnabled: this.#settings.clearPreviousHighlightsEnabled,
        clearPreviousCrossOutsEnabled: this.#settings.clearPreviousCrossOutsEnabled,
      });
      const report = this.#adapter.applyCleanSlate();
      if (!report.safeToReveal) {
        this.#showUnsupported(report);
        return;
      }
      const context = await this.#adapter.getQuestionContext();
      if (generation !== this.#generation || this.#normalReview) return;
      if (!context) {
        this.#showUnsupported(report);
        return;
      }
      this.#context = context;

      if (this.#session?.examKey === context.examKey && this.#session.status === "active") {
        await this.#resumeSession(this.#session, generation);
        return;
      }

      const activeSessions = (await this.#repository.listSessions()).filter(
        (session) => session.examKey === context.examKey && session.status === "active",
      );
      if (generation !== this.#generation || this.#normalReview) return;
      this.#availableSession =
        activeSessions.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
      this.#state = {
        ...INITIAL_REVIEW_STATE,
        protection: "MASKED",
      };
      this.#preflight.setProtection("boot");
      this.#showReadyGate();
    } catch {
      if (generation === this.#generation) {
        this.#showUnsupported(this.#adapter.inspectCapabilities());
      }
    }
  }

  normalReview(): void {
    this.#normalReview = true;
    this.#generation += 1;
    this.#timer.setSessionActive(false);
    this.#stopObserver?.();
    this.#stopObserver = null;
    this.#cancelAnnotationSealBoundary();
    this.#adapter.restoreNormalReview();
    this.#state = reduceReviewState(this.#state, { type: "NORMAL_REVIEW" });
    this.#clearView();
    this.#preflight.setProtection("normal-review");
  }

  updateSettings(settings: SettingsRecord): void {
    this.#settings = settings;
    void this.reconcile();
  }

  dispose(): void {
    this.#timer.dispose();
    this.#stopObserver?.();
    this.#stopObserver = null;
    this.#cancelAnnotationSealBoundary();
    this.#clearView();
    this.#keyboard.dispose();
  }

  #handleAdapterEvent(event: AdapterEvent): void {
    if (this.#normalReview) return;
    if (event.type === "capability-change") {
      void this.#appendCapabilityLog(event.report);
    }
    void this.reconcile();
  }

  async #reconcileScoreReport(generation: number): Promise<void> {
    if (!this.#settings?.scoreShieldEnabled) {
      this.#adapter.revealScores();
      this.#preflight.setProtection("non-review");
      this.#clearView();
      return;
    }
    const report = this.#adapter.applyScoreShield();
    if (!report.safeToReveal) {
      this.#showUnsupported(report);
      return;
    }
    const examKey = await this.#adapter.getExamKey();
    if (generation !== this.#generation || this.#normalReview) return;
    if (!examKey) {
      this.#showUnsupported(report);
      return;
    }
    if (await this.#repository.getScoreReveal(examKey)) {
      if (generation !== this.#generation || this.#normalReview) return;
      this.#adapter.revealScores();
      this.#preflight.setProtection("non-review");
      this.#clearView();
      return;
    }

    this.#preflight.host.dataset.mkitPlacement = "rail";
    this.#adapter.mountFreshAttemptEntry(this.#preflight.host);
    this.#preflight.setProtection("masked");
    this.#renderScoreShield({
      state: "shielded",
      showFreshAttemptAction: false,
      onReveal: () => {
        void this.#revealScores(examKey);
      },
      onFreshAttempt: () => undefined,
    });
  }

  async #revealScores(examKey: string): Promise<void> {
    try {
      await this.#repository.setScoreReveal(examKey, true);
      this.#adapter.revealScores();
      this.#clearView();
      this.#preflight.setProtection("non-review");
    } catch {
      this.#showUnsupported(this.#adapter.inspectCapabilities());
    }
  }

  #showBusyGate(): void {
    this.#preflight.host.dataset.mkitPlacement = "gate";
    this.#renderGate({
      state: "busy",
      onSelectMode: () => undefined,
      onResume: () => undefined,
      onArchive: () => undefined,
      onRetryDetection: () => {
        void this.reconcile();
      },
      onNormalReview: () => this.#requestNormalReview(),
    });
  }

  #showReadyGate(): void {
    const activeSession = this.#availableSession
      ? this.#activeSessionSummary(this.#availableSession)
      : undefined;
    const props: GateProps = {
      state: "ready",
      encouragementEnabled: this.#settings?.encouragementEnabled ?? true,
      onSelectMode: (mode) => {
        void this.#selectMode(mode);
      },
      onResume: () => {
        if (this.#availableSession) {
          void this.#resumeSession(this.#availableSession, this.#generation);
        }
      },
      onArchive: () => undefined,
      onRetryDetection: () => {
        void this.reconcile();
      },
      onNormalReview: () => this.#requestNormalReview(),
    };
    if (activeSession) props.activeSession = activeSession;
    this.#preflight.host.dataset.mkitPlacement = "gate";
    this.#renderGate(props);
  }

  #showConflictGate(session: SessionRecord): void {
    this.#availableSession = session;
    this.#preflight.host.dataset.mkitPlacement = "gate";
    this.#renderGate({
      state: "conflict",
      activeSession: this.#activeSessionSummary(session),
      onSelectMode: () => undefined,
      onResume: () => {
        void this.#resumeSession(session, this.#generation);
      },
      onArchive: () => {
        void this.#archiveAndStart(session);
      },
      onRetryDetection: () => {
        void this.reconcile();
      },
      onNormalReview: () => this.#requestNormalReview(),
    });
  }

  #showUnsupported(report: CapabilityReport): void {
    this.#timer.setSessionActive(false);
    this.#state = {
      ...this.#state,
      protection: "UNSUPPORTED",
      reveal: "CONCEALED",
    };
    this.#preflight.host.dataset.mkitPlacement = "gate";
    this.#preflight.setProtection("unsupported");
    this.#renderGate({
      state: "unsupported",
      capabilities: {
        questionArea: report.questionRegionFound,
        navigator: report.navigatorFound,
        answerFeedback: report.feedbackRegionFound,
      },
      onSelectMode: () => undefined,
      onResume: () => undefined,
      onArchive: () => undefined,
      onRetryDetection: () => {
        void this.reconcile();
      },
      onNormalReview: () => this.#requestNormalReview(),
    });
  }

  async #selectMode(mode: FreshAttemptMode): Promise<void> {
    if (!this.#context) return;
    const conflict = (await this.#repository.listSessions()).find(
      (session) =>
        session.examKey === this.#context?.examKey &&
        session.mode === mode &&
        session.status === "active",
    );
    if (conflict) {
      this.#pendingMode = mode;
      this.#showConflictGate(conflict);
      return;
    }
    await this.#startSession(mode);
  }

  async #archiveAndStart(session: SessionRecord): Promise<void> {
    if (!this.#pendingMode) return;
    const mode = this.#pendingMode;
    await this.#sessions.archive(session.id);
    this.#pendingMode = null;
    await this.#startSession(mode);
  }

  async #startSession(mode: FreshAttemptMode): Promise<void> {
    if (!this.#context) return;
    try {
      const session = await this.#sessions.start(
        this.#context.examKey,
        mode,
        this.#context.questionKey,
      );
      this.#session = session;
      this.#attempt = await this.#sessions.getOrCreateAttempt(session.id, this.#context);
      this.#state = reduceReviewState(
        { ...this.#state, protection: "MASKED" },
        { type: mode === "practice" ? "START_PRACTICE" : "START_TEST" },
      );
      this.#state = {
        ...this.#state,
        selection: this.#attempt.selection,
      };
      this.#answersRevealed = false;
      this.#showRail(true);
    } catch {
      this.#saveState = "error";
      this.#showUnsupported(this.#adapter.inspectCapabilities());
    }
  }

  async #resumeSession(session: SessionRecord, generation: number): Promise<void> {
    if (!this.#context || session.examKey !== this.#context.examKey) return;
    const attempt = await this.#sessions.getOrCreateAttempt(session.id, this.#context);
    if (generation !== this.#generation || this.#normalReview) return;
    // Any page mutation reconciles, including a scroll, so a reveal the reader
    // has already made on this question is carried over instead of reset. A
    // different question always starts concealed.
    const hadActiveQuestion = this.#attempt !== null;
    const sameQuestion = this.#attempt?.questionKey === attempt.questionKey;
    if (!sameQuestion) {
      this.#railAnchor = null;
      if (hadActiveQuestion) {
        this.#armAnnotationSealBoundary();
      }
    }
    const revealed = sameQuestion ? this.#state.reveal : "CONCEALED";
    this.#session = session;
    this.#attempt = attempt;
    this.#state = {
      protection: "MASKED",
      session:
        session.mode === "practice"
          ? "PRACTICE_ACTIVE"
          : session.status === "finished"
            ? "TEST_FINISHED"
            : "TEST_ACTIVE",
      reveal: revealed,
      selection: attempt.selection,
    };
    if (session.currentQuestionKey !== this.#context.questionKey) {
      this.#session = await this.#sessions.setCurrentQuestion(
        session.id,
        this.#context.questionKey,
      );
    }
    this.#answersRevealed = sameQuestion && this.#answersRevealed;
    this.#showRail(!sameQuestion && !hadActiveQuestion);
  }

  #showRail(sealPriorAnnotations = false): void {
    if (!this.#session || !this.#attempt || !this.#context) return;
    this.#preflight.host.dataset.mkitPlacement = "rail";
    if (!this.#adapter.mountStudyRail(this.#preflight.host)) {
      this.#showUnsupported(this.#adapter.inspectCapabilities());
      return;
    }
    if (sealPriorAnnotations) {
      this.#sealPriorAnnotations();
    }
    this.#preflight.setProtection("masked");
    this.#timer.visitQuestion(this.#context.questionKey);
    this.#timer.setSessionActive(
      this.#session.status === "active" &&
        this.#state.reveal === "CONCEALED" &&
        this.#state.session !== "TEST_FINISHED",
    );
    this.#renderRail(this.#railProps());
    this.#keyboard.setEnabled(
      this.#session.status === "active" && this.#state.reveal === "CONCEALED",
    );
  }

  #armAnnotationSealBoundary(): void {
    this.#cancelAnnotationSealBoundary();
    const seal = (): void => {
      this.#sealPriorAnnotations();
    };
    for (const eventName of ["pointerdown", "keydown", "click"] as const) {
      document.addEventListener(eventName, seal, { capture: true });
    }
    this.#stopAnnotationSealBoundary = () => {
      for (const eventName of ["pointerdown", "keydown", "click"] as const) {
        document.removeEventListener(eventName, seal, { capture: true });
      }
    };
  }

  #sealPriorAnnotations(): void {
    this.#cancelAnnotationSealBoundary();
    this.#adapter.sealPriorAnnotations();
  }

  #cancelAnnotationSealBoundary(): void {
    this.#stopAnnotationSealBoundary?.();
    this.#stopAnnotationSealBoundary = null;
  }

  #railProps(): StudyRailProps {
    if (!this.#session || !this.#attempt || !this.#context) {
      throw new Error("Cannot render a study rail without an active question.");
    }
    const attempt = this.#attempt;
    const section = sectionLabel(attempt.sectionKey);
    this.#railAnchor ??= this.#adapter.getStudyRailAnchor();
    return {
      anchor: this.#railAnchor,
      mode: this.#session.mode,
      stage: this.#railStage(),
      progress: {
        ...this.#context.progress,
        ...(section ? { section } : {}),
      },
      selection: attempt.selection,
      eliminations: attempt.eliminations,
      confidence: attempt.confidence,
      flagged: attempt.flagged,
      reviewAgain: attempt.reviewAgain,
      outcome: this.#state.reveal === "CONCEALED" ? null : attempt.outcome,
      saveState: this.#saveState,
      answersRevealed: this.#answersRevealed,
      note: attempt.note ?? "",
      tags: attempt.tags,
      canNavigatePrevious: false,
      canNavigateNext: false,
      // A section review can only finish the section it is scoped to, so the
      // rail offers that narrower action instead of ending the whole attempt.
      ...(this.#session.mode === "test" && this.#session.status === "active"
        ? {
            finishScope:
              this.#context.progress.scope === "section"
                ? ("section" as const)
                : ("attempt" as const),
          }
        : {}),
      finishConfirmationOpen: this.#finishConfirmationOpen,
      onSelect: (choice) => {
        void this.#selectAnswer(choice);
      },
      onToggleElimination: (choice) => {
        void this.#toggleElimination(choice);
      },
      onConfidenceChange: (confidence) => {
        void this.#setConfidence(confidence);
      },
      onFlagChange: (flagged) => {
        void this.#updateAttempt({ flagged });
      },
      onReviewAgainChange: (reviewAgain) => {
        void this.#updateAttempt({ reviewAgain });
      },
      onCheck: () => {
        void this.#checkPractice();
      },
      onRevealAnswers: () => this.#revealAnswers(),
      onRevealOriginal: () => this.#revealOriginal(),
      onRetry: () => {
        void this.#retryPractice();
      },
      onFinishRequest: () => {
        this.#finishConfirmationOpen = true;
        this.#showRail();
      },
      onFinishConfirm: () => {
        void this.#finishRequested();
      },
      onFinishCancel: () => {
        this.#finishConfirmationOpen = false;
        this.#showRail();
      },
      onNavigate: () => undefined,
      onNoteChange: (note) => {
        this.#queueNoteSave(note);
      },
      onTagsChange: (tags) => {
        void this.#updateAttempt({ tags: [...tags] });
      },
    };
  }

  async #selectAnswer(choice: AnswerChoice): Promise<void> {
    if (!this.#session || !this.#attempt || this.#state.reveal !== "CONCEALED") return;
    const selection = this.#attempt.selection === choice ? null : choice;
    this.#state = reduceReviewState(this.#state, { type: "SELECT", selection });
    const patch: Partial<AttemptRecord> = { selection };
    if (this.#session.mode === "test") {
      patch.outcome = selection ? this.#adapter.gradeFresh(selection) : "unknown";
    }
    await this.#updateAttempt(patch);
  }

  async #toggleElimination(choice: AnswerChoice): Promise<void> {
    if (!this.#session || !this.#attempt || this.#state.reveal !== "CONCEALED") return;
    await this.#withSave(async () => {
      const saved = await this.#sessions.toggleElimination(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        choice,
      );
      const accepted = this.#acceptSavedAttempt(saved);
      this.#state = { ...this.#state, selection: accepted.selection };
    });
  }

  async #setConfidence(confidence: Confidence | null): Promise<void> {
    if (!this.#session || !this.#attempt) return;
    await this.#withSave(async () => {
      const saved = await this.#sessions.setConfidence(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        confidence,
      );
      this.#acceptSavedAttempt(saved);
    });
  }

  async #checkPractice(): Promise<void> {
    if (!this.#session || !this.#attempt?.selection || this.#session.mode !== "practice") return;
    const outcome = this.#adapter.gradeFresh(this.#attempt.selection);
    await this.#updateAttempt({ outcome });
    this.#state = reduceReviewState(this.#state, { type: "CHECK" });
    this.#answersRevealed = false;
    this.#timer.setSessionActive(false);
    this.#showRail();
  }

  #revealAnswers(): void {
    if (
      !(
        (this.#state.session === "PRACTICE_ACTIVE" && this.#state.reveal === "OUTCOME") ||
        (this.#state.session === "TEST_FINISHED" && this.#state.reveal === "CONCEALED")
      )
    ) {
      return;
    }
    this.#state = reduceReviewState(this.#state, { type: "REVEAL_FEEDBACK" });
    this.#adapter.revealFeedback();
    this.#answersRevealed = true;
    this.#timer.setSessionActive(false);
    this.#showRail();
  }

  #revealOriginal(): void {
    if (this.#state.reveal !== "FEEDBACK") return;
    this.#state = reduceReviewState(this.#state, { type: "REVEAL_ORIGINAL" });
    this.#adapter.revealOriginalAttempt();
    this.#showRail();
  }

  async #retryPractice(): Promise<void> {
    if (!this.#session || !this.#attempt) return;
    this.#adapter.remaskQuestion();
    const saved = await this.#sessions.retry(this.#session.id, this.#attempt.questionKey);
    this.#acceptSavedAttempt(saved);
    this.#state = reduceReviewState(this.#state, { type: "RETRY" });
    this.#answersRevealed = false;
    this.#showRail();
  }

  /**
   * A section-scoped finish records that one section and leaves the attempt
   * active, so the reader can continue in another section. Only an
   * attempt-scoped finish ends the session and reports the summary.
   */
  async #finishRequested(): Promise<void> {
    if (this.#session?.mode !== "test" || !this.#attempt) return;
    if (this.#context?.progress.scope !== "section") {
      await this.#finishTest();
      return;
    }
    this.#session = await this.#sessions.finishSection(this.#session.id, this.#attempt.sectionKey);
    this.#finishConfirmationOpen = false;
    this.#showRail();
  }

  async #finishTest(): Promise<void> {
    if (this.#session?.mode !== "test") return;
    this.#session = await this.#sessions.finish(this.#session.id);
    this.#state = reduceReviewState(this.#state, { type: "FINISH_TEST" });
    this.#finishConfirmationOpen = false;
    this.#timer.setSessionActive(false);
    this.#showRail();
    await this.#showSummary(this.#session);
  }

  /**
   * The summary reports only the reader's own Fresh Attempt results, so it stays
   * available while official answers remain masked. Closing it returns to the
   * finished rail rather than to the native page.
   */
  async #showSummary(session: SessionRecord): Promise<void> {
    const attempts = await this.#repository.listAttempts(session.id);
    const summary = summarizeSession(session, attempts);
    const sections: SectionSummary[] = [];
    for (const [sectionKey, counts] of Object.entries(summary.bySection)) {
      const label = sectionLabel(sectionKey);
      if (!label) continue;
      const timing = summary.timingBySection[sectionKey];
      sections.push({
        section: label,
        counts,
        timing: {
          averageMs: timing?.averageMs ?? 0,
          outlierCount: timing?.outliers.length ?? 0,
        },
      });
    }
    const categories = Object.entries(summary.categoryNeedsReview)
      .map(([code, needsReview]) => ({ code, needsReview }))
      .sort((left, right) => right.needsReview - left.needsReview);

    this.#summaryView = mountSummary(this.#preflight.shadow, {
      counts: summary.counts,
      sections,
      questionTypes: {
        passage: summary.byQuestionType.passage,
        discrete: summary.byQuestionType.discrete,
      },
      timing: {
        averageMs: summary.timing.averageMs,
        outlierCount: summary.timing.outliers.length,
      },
      categories,
      encouragementEnabled: this.#settings?.encouragementEnabled ?? false,
      autoFocus: true,
      onClose: () => {
        this.#summaryView?.destroy();
        this.#summaryView = null;
        this.#showRail();
      },
    });
  }

  async #updateAttempt(patch: Partial<AttemptRecord>): Promise<void> {
    if (!this.#session || !this.#attempt) return;
    await this.#withSave(async () => {
      const saved = await this.#sessions.updateAttempt(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        patch,
      );
      const accepted = this.#acceptSavedAttempt(saved);
      this.#state = { ...this.#state, selection: accepted.selection };
    });
  }

  #queueNoteSave(note: string): void {
    if (!this.#session || !this.#attempt) return;
    const draft: PendingNoteSave = {
      sessionId: this.#session.id,
      questionKey: this.#attempt.questionKey,
      note,
    };
    this.#attempt = { ...this.#attempt, note };
    this.#pendingNoteSaves.set(attemptKey(draft), draft);
    if (!this.#noteSaveActive) void this.#drainNoteSaves();
  }

  async #drainNoteSaves(): Promise<void> {
    if (this.#noteSaveActive) return;
    this.#noteSaveActive = true;
    try {
      while (this.#pendingNoteSaves.size > 0) {
        const next = this.#pendingNoteSaves.entries().next().value;
        if (!next) break;
        const [key, draft] = next;
        try {
          const saved = await this.#sessions.updateAttempt(draft.sessionId, draft.questionKey, {
            note: draft.note,
          });
          const latestDraft = this.#pendingNoteSaves.get(key);
          if (latestDraft === draft) {
            this.#pendingNoteSaves.delete(key);
          }
          if (
            this.#session?.id === draft.sessionId &&
            this.#attempt?.questionKey === draft.questionKey
          ) {
            const pendingNote = this.#pendingNoteSaves.get(key)?.note;
            this.#attempt = {
              ...this.#attempt,
              note: pendingNote ?? saved.note ?? "",
              updatedAt: Math.max(this.#attempt.updatedAt, saved.updatedAt),
              ...(saved.noteUpdatedAt === undefined ? {} : { noteUpdatedAt: saved.noteUpdatedAt }),
            };
          }
        } catch {
          if (this.#pendingNoteSaves.get(key) === draft) {
            this.#pendingNoteSaves.delete(key);
          }
          if (
            this.#session?.id === draft.sessionId &&
            this.#attempt?.questionKey === draft.questionKey
          ) {
            this.#saveState = "error";
            this.#showRail();
          }
        }
      }
    } finally {
      this.#noteSaveActive = false;
      if (this.#pendingNoteSaves.size > 0) void this.#drainNoteSaves();
    }
  }

  #acceptSavedAttempt(saved: AttemptRecord): AttemptRecord {
    const pendingNote = this.#pendingNoteSaves.get(attemptKey(saved))?.note;
    const accepted = pendingNote === undefined ? saved : { ...saved, note: pendingNote };
    this.#attempt = accepted;
    return accepted;
  }

  async #withSave(operation: () => Promise<void>): Promise<void> {
    this.#saveState = "saving";
    this.#showRail();
    try {
      await operation();
      this.#saveState = "saved";
    } catch {
      this.#saveState = "error";
    }
    this.#showRail();
  }

  #railStage(): StudyRailStage {
    if (this.#state.reveal === "ORIGINAL") return "original-revealed";
    if (this.#state.session === "TEST_FINISHED") return "test-finished";
    if (this.#state.reveal === "FEEDBACK") return "practice-revealed";
    if (this.#state.reveal === "OUTCOME") return "practice-checked";
    if (this.#state.session === "TEST_ACTIVE") return "test-active";
    return this.#state.selection ? "selected" : "masked";
  }

  #activeSessionSummary(session: SessionRecord): ActiveSessionSummary {
    return {
      mode: session.mode,
      progress: this.#context?.progress ?? {
        scope: "unknown",
        current: null,
        total: null,
      },
    };
  }

  async #recordTiming(sample: TimingSample): Promise<void> {
    const session = this.#session;
    if (!session || sample.durationMs <= 0) return;
    try {
      await this.#sessions.accumulateDuration(session.id, sample.questionKey, sample.durationMs);
    } catch {
      this.#saveState = "error";
      if (this.#railView) this.#showRail();
    }
  }

  async #appendCapabilityLog(report: CapabilityReport): Promise<void> {
    try {
      await this.#repository.appendDebugLog({
        id: crypto.randomUUID(),
        event: "adapter-capability",
        occurredAt: Date.now(),
        facts: {
          safeToReveal: report.safeToReveal,
          questionRegionFound: report.questionRegionFound,
          answerChoiceCount: report.answerChoiceCount,
          navigatorFound: report.navigatorFound,
          feedbackRegionFound: report.feedbackRegionFound,
          scoreRegionCount: report.scoreRegionCount,
        },
      });
    } catch {
      // Compatibility diagnostics must never interrupt studying.
    }
  }

  #renderGate(props: GateProps): void {
    if (this.#gateView) {
      this.#gateView.update(props);
      return;
    }
    this.#resetView();
    this.#gateView = mountGate(this.#preflight.shadow, props);
    this.#view = this.#gateView as unknown as ViewHandle;
  }

  #renderRail(props: StudyRailProps): void {
    if (this.#railView) {
      this.#railView.update(props);
      return;
    }
    this.#resetView();
    this.#railAnchor = props.anchor;
    this.#railView = mountStudyRail(this.#preflight.shadow, props);
    this.#view = this.#railView as unknown as ViewHandle;
  }

  #renderScoreShield(props: ScoreShieldProps): void {
    if (this.#scoreView) {
      this.#scoreView.update(props);
      return;
    }
    this.#resetView();
    this.#scoreView = mountScoreShield(this.#preflight.shadow, props);
    this.#view = this.#scoreView as unknown as ViewHandle;
  }

  #resetView(): void {
    this.#view?.destroy();
    this.#view = null;
    this.#gateView = null;
    this.#railView = null;
    this.#railAnchor = null;
    this.#scoreView = null;
    this.#summaryView = null;
    this.#preflight.shadow.replaceChildren(this.#uiStyle);
  }

  #clearView(): void {
    // Every teardown path routes through here, so shortcuts cannot outlive the
    // rail that owns them.
    this.#keyboard.setEnabled(false);
    this.#resetView();
  }

  #requestNormalReview(): void {
    this.#preflight.host.dispatchEvent(
      new CustomEvent(NORMAL_REVIEW_REQUEST_EVENT, { bubbles: true, composed: true }),
    );
  }
}

function sectionLabel(sectionKey: string): SectionLabel | undefined {
  const normalized = sectionKey.toLowerCase().replaceAll(/[^a-z]/g, "");
  if (normalized === "cp") return "C/P";
  if (normalized === "cars") return "CARS";
  if (normalized === "bb") return "B/B";
  if (normalized === "ps") return "P/S";
  return undefined;
}
