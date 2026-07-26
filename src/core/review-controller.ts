import type {
  AdapterEvent,
  CapabilityReport,
  FullLengthReviewAdapter,
  SanitizedQuestionContext,
} from "../adapter/contracts";
import type { MKitPreflight } from "../content/preflight";
import type {
  AnswerChoice,
  AttemptRecord,
  Confidence,
  FreshAttemptMode,
  SessionRecord,
  SettingsRecord,
  StorageRepository,
} from "../storage";
import {
  type ActiveSessionSummary,
  type GateProps,
  type MKitViewHandle,
  mountGate,
  mountScoreShield,
  mountStudyRail,
  type SaveState,
  type ScoreShieldProps,
  type SectionLabel,
  type StudyRailProps,
  type StudyRailStage,
} from "../ui";
import { SessionService } from "./session-service";
import { INITIAL_REVIEW_STATE, type ReviewState, reduceReviewState } from "./state";
import { ActiveQuestionTimer, type TimingSample } from "./timing";

type ViewHandle = Pick<MKitViewHandle<unknown>, "destroy">;

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
  #scoreView: MKitViewHandle<ScoreShieldProps> | null = null;
  #stopObserver: (() => void) | null = null;
  #generation = 0;
  #normalReview = false;

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
    this.#adapter.restoreNormalReview();
    this.#state = reduceReviewState(this.#state, { type: "NORMAL_REVIEW" });
    this.#clearView();
    this.#preflight.setProtection("normal-review");
  }

  dispose(): void {
    this.#timer.dispose();
    this.#stopObserver?.();
    this.#stopObserver = null;
    this.#clearView();
  }

  #handleAdapterEvent(event: AdapterEvent): void {
    if (this.#normalReview) return;
    if (event.type === "capability-change") {
      void this.#appendCapabilityLog(event.report);
    }
    void this.reconcile();
  }

  async #reconcileScoreReport(generation: number): Promise<void> {
    const report = this.#adapter.applyScoreShield();
    if (!report.safeToReveal || !this.#settings?.scoreShieldEnabled) {
      if (!report.safeToReveal) {
        this.#showUnsupported(report);
      } else {
        this.#preflight.setProtection("non-review");
        this.#clearView();
      }
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
      onNormalReview: () => this.normalReview(),
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
      onNormalReview: () => this.normalReview(),
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
      onNormalReview: () => this.normalReview(),
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
      onNormalReview: () => this.normalReview(),
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
      this.#showRail();
    } catch {
      this.#saveState = "error";
      this.#showUnsupported(this.#adapter.inspectCapabilities());
    }
  }

  async #resumeSession(session: SessionRecord, generation: number): Promise<void> {
    if (!this.#context || session.examKey !== this.#context.examKey) return;
    const attempt = await this.#sessions.getOrCreateAttempt(session.id, this.#context);
    if (generation !== this.#generation || this.#normalReview) return;
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
      reveal: "CONCEALED",
      selection: attempt.selection,
    };
    if (session.currentQuestionKey !== this.#context.questionKey) {
      this.#session = await this.#sessions.setCurrentQuestion(
        session.id,
        this.#context.questionKey,
      );
    }
    this.#answersRevealed = false;
    this.#showRail();
  }

  #showRail(): void {
    if (!this.#session || !this.#attempt || !this.#context) return;
    this.#preflight.host.dataset.mkitPlacement = "rail";
    if (!this.#adapter.mountStudyRail(this.#preflight.host)) {
      this.#showUnsupported(this.#adapter.inspectCapabilities());
      return;
    }
    this.#preflight.setProtection("masked");
    this.#timer.visitQuestion(this.#context.questionKey);
    this.#timer.setSessionActive(
      this.#session.status === "active" &&
        this.#state.reveal === "CONCEALED" &&
        this.#state.session !== "TEST_FINISHED",
    );
    this.#renderRail(this.#railProps());
  }

  #railProps(): StudyRailProps {
    if (!this.#session || !this.#attempt || !this.#context) {
      throw new Error("Cannot render a study rail without an active question.");
    }
    const attempt = this.#attempt;
    const section = sectionLabel(attempt.sectionKey);
    return {
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
      ...(this.#session.mode === "test" && this.#session.status === "active"
        ? { finishScope: "attempt" as const }
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
        void this.#finishTest();
      },
      onFinishCancel: () => {
        this.#finishConfirmationOpen = false;
        this.#showRail();
      },
      onNavigate: () => undefined,
      onNoteChange: (note) => {
        void this.#updateAttempt({ note });
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
      this.#attempt = await this.#sessions.toggleElimination(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        choice,
      );
      this.#state = { ...this.#state, selection: this.#attempt.selection };
    });
  }

  async #setConfidence(confidence: Confidence | null): Promise<void> {
    if (!this.#session || !this.#attempt) return;
    await this.#withSave(async () => {
      this.#attempt = await this.#sessions.setConfidence(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        confidence,
      );
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
    this.#attempt = await this.#sessions.retry(this.#session.id, this.#attempt.questionKey);
    this.#state = reduceReviewState(this.#state, { type: "RETRY" });
    this.#answersRevealed = false;
    this.#showRail();
  }

  async #finishTest(): Promise<void> {
    if (this.#session?.mode !== "test") return;
    this.#session = await this.#sessions.finish(this.#session.id);
    this.#state = reduceReviewState(this.#state, { type: "FINISH_TEST" });
    this.#finishConfirmationOpen = false;
    this.#timer.setSessionActive(false);
    this.#showRail();
  }

  async #updateAttempt(patch: Partial<AttemptRecord>): Promise<void> {
    if (!this.#session || !this.#attempt) return;
    await this.#withSave(async () => {
      this.#attempt = await this.#sessions.updateAttempt(
        this.#session?.id ?? "",
        this.#attempt?.questionKey ?? "",
        patch,
      );
      this.#state = { ...this.#state, selection: this.#attempt.selection };
    });
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
    this.#scoreView = null;
    this.#preflight.shadow.replaceChildren(this.#uiStyle);
  }

  #clearView(): void {
    this.#resetView();
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
