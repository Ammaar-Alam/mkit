import { describe, expect, it, vi } from "vitest";
import type {
  AdapterEvent,
  CapabilityReport,
  CleanSlatePreferences,
  FullLengthReviewAdapter,
  SanitizedQuestionContext,
} from "../../../src/adapter/contracts";
import type { MKitPreflight, PreflightProtection } from "../../../src/content/preflight";
import { ReviewController } from "../../../src/core/review-controller";
import { DEFAULT_SETTINGS, StorageRepository } from "../../../src/storage";
import { FakeStorageArea } from "../storage/fake-storage";

const SAFE_REVIEW_REPORT: CapabilityReport = {
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
};

describe("ReviewController generation safety", () => {
  it("leaves annotation hydration open during a slow session start", async () => {
    const local = new FakeStorageArea("local");
    const repository = new StorageRepository({
      local,
      now: monotonicNow(),
    });
    const adapter = new ControlledAdapter([Promise.resolve(context("question-q1"))]);
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    const protectionCount = preflight.protections.length;
    const storageGate = deferred<void>();
    local.setGate = storageGate.promise;
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();

    expect(preflight.protections).toHaveLength(protectionCount + 1);
    expect(preflight.protections.at(-1)).toBe("boot");
    expect(adapter.annotationSeals).toBe(0);
    expect(preflight.shadow.querySelector(".mkit-study-rail")).toBeNull();

    await vi.waitFor(() => expect(local.events).toContain("local:set"));
    expect(preflight.protections.at(-1)).toBe("boot");
    expect(adapter.annotationSeals).toBe(0);
    expect(preflight.shadow.querySelector(".mkit-study-rail")).toBeNull();

    storageGate.resolve(undefined);
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    });
    expect(adapter.annotationSeals).toBe(0);
    expect(preflight.protections.at(-1)).toBe("masked");
    controller.dispose();
  });

  it("discards a stale Q1 context that resolves after Q2 and starts only the Q2 attempt", async () => {
    const q1 = deferred<SanitizedQuestionContext | null>();
    const q2 = deferred<SanitizedQuestionContext | null>();
    const adapter = new ControlledAdapter([q1.promise, q2.promise]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    const firstReconcile = controller.reconcile();
    await vi.waitFor(() => expect(adapter.contextRequests).toBe(1));
    const secondReconcile = controller.reconcile();
    await vi.waitFor(() => expect(adapter.contextRequests).toBe(2));

    q2.resolve(context("question-q2"));
    await secondReconcile;
    q1.resolve(context("question-q1"));
    await firstReconcile;

    expect(adapter.cleanSlatePreferences).toEqual({
      clearPreviousHighlightsEnabled: true,
      clearPreviousCrossOutsEnabled: true,
    });
    const practice = preflight.shadow.querySelector<HTMLButtonElement>(
      "[data-focus-key='practice']",
    );
    expect(practice).not.toBeNull();
    practice?.click();

    await vi.waitFor(async () => {
      expect(await repository.listSessions()).toHaveLength(1);
    });
    const sessions = await repository.listSessions();
    const attempts = await repository.listAttempts(sessions[0]?.id);

    expect(sessions[0]?.currentQuestionKey).toBe("question-q2");
    expect(attempts.map((attempt) => attempt.questionKey)).toEqual(["question-q2"]);
    expect(adapter.studyRailMounts).toBe(1);
    expect(adapter.annotationSeals).toBe(0);

    controller.dispose();
  });

  it("keeps the mounted rail anchor stable through answer save rerenders", async () => {
    const adapter = new ControlledAdapter([Promise.resolve(context("question-q1"))]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector<HTMLElement>(".mkit-study-rail")?.style.top).toBe(
        "297px",
      );
    });

    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='answer-A']")?.click();
    await vi.waitFor(async () => {
      expect((await repository.listAttempts())[0]?.selection).toBe("A");
    });

    expect(preflight.shadow.querySelector<HTMLElement>(".mkit-study-rail")?.style.top).toBe(
      "297px",
    );
    expect(adapter.anchorRequests).toBe(1);

    controller.dispose();
  });

  it("shows and hides the initial result when the live preference changes", async () => {
    const adapter = new ControlledAdapter([
      Promise.resolve(context("question-q1")),
      Promise.resolve(context("question-q1")),
      Promise.resolve(context("question-q1")),
    ]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    });
    expect(preflight.shadow.querySelector(".mkit-initial-outcome")).toBeNull();

    controller.updateSettings({
      ...DEFAULT_SETTINGS,
      showInitialCorrectnessEnabled: true,
      updatedAt: 42,
    });
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-initial-outcome--incorrect")?.textContent).toBe(
        "Initially incorrect",
      );
    });

    controller.updateSettings({ ...DEFAULT_SETTINGS, updatedAt: 43 });
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-initial-outcome")).toBeNull();
    });
    controller.dispose();
  });

  it("remeasures the mounted rail when the active question changes", async () => {
    const adapter = new ControlledAdapter([
      Promise.resolve(context("question-q1")),
      Promise.resolve(context("question-q2")),
    ]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector<HTMLElement>(".mkit-study-rail")?.style.top).toBe(
        "297px",
      );
    });
    expect(adapter.anchorRequests).toBe(1);

    await controller.reconcile();

    expect(preflight.shadow.querySelector<HTMLElement>(".mkit-study-rail")?.style.top).toBe("16px");
    expect(adapter.anchorRequests).toBe(2);
    expect(adapter.annotationSeals).toBe(0);
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='answer-A']")?.click();
    await vi.waitFor(async () => {
      expect((await repository.listAttempts())[1]?.selection).toBe("A");
    });
    expect(adapter.annotationSeals).toBe(0);
    expect(preflight.shadow.querySelector<HTMLElement>(".mkit-study-rail")?.style.top).toBe("16px");
    expect(adapter.anchorRequests).toBe(2);

    controller.dispose();
  });

  it("keeps navigated annotations unsealed across a transient detection gate", async () => {
    const adapter = new ControlledAdapter([
      Promise.resolve(context("question-q1")),
      Promise.resolve(null),
      Promise.resolve(context("question-q2")),
    ]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(() => expect(adapter.annotationSeals).toBe(0));
    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    });

    await controller.reconcile();
    expect(preflight.shadow.querySelector(".mkit-study-rail")).toBeNull();
    await controller.reconcile();

    expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    expect(adapter.annotationSeals).toBe(0);
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='answer-A']")?.click();
    await vi.waitFor(async () => {
      expect((await repository.listAttempts())[1]?.selection).toBe("A");
    });
    expect(adapter.annotationSeals).toBe(0);
    controller.dispose();
  });

  it("persists a note with an immediate answer without per-keystroke redraws", async () => {
    const adapter = new ControlledAdapter([Promise.resolve(context("question-q1"))]);
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(() => {
      expect(
        preflight.shadow.querySelector<HTMLTextAreaElement>("[data-focus-key='private-note']"),
      ).not.toBeNull();
    });
    const note = preflight.shadow.querySelector<HTMLTextAreaElement>(
      "[data-focus-key='private-note']",
    );
    if (!note) throw new Error("Study Rail note editor was not rendered.");

    for (const draft of ["C", "Compare", "Compare the limiting cases."]) {
      note.value = draft;
      note.dispatchEvent(new Event("input", { bubbles: true }));
      expect(
        preflight.shadow.querySelector<HTMLTextAreaElement>("[data-focus-key='private-note']"),
      ).toBe(note);
    }
    expect(note.isConnected).toBe(true);
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='answer-A']")?.click();

    await vi.waitFor(async () => {
      expect((await repository.listAttempts())[0]).toMatchObject({
        note: "Compare the limiting cases.",
        selection: "A",
      });
    });
    expect(
      preflight.shadow.querySelector<HTMLTextAreaElement>("[data-focus-key='private-note']")?.value,
    ).toBe("Compare the limiting cases.");
    controller.dispose();
  });

  it("restores native scores when live settings disable Score Shield", async () => {
    const adapter = new ScoreReportAdapter();
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: "",
    });

    await controller.reconcile();
    expect(adapter.scoreShieldApplications).toBe(1);
    expect(preflight.shadow.querySelector(".mkit-score-shield")).not.toBeNull();

    controller.updateSettings({
      ...DEFAULT_SETTINGS,
      scoreShieldEnabled: false,
      updatedAt: 42,
    });
    await vi.waitFor(() => expect(adapter.scoreReveals).toBe(1));

    expect(adapter.scoreShieldApplications).toBe(1);
    expect(preflight.shadow.querySelector(".mkit-score-shield")).toBeNull();
    expect(preflight.protections.at(-1)).toBe("non-review");
    controller.dispose();
  });
});

describe("ReviewController resume position", () => {
  it("records the question number and jumps back to it on Resume", async () => {
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const atQuestion = (questionKey: string, current: number) => ({
      ...context(questionKey),
      progress: { scope: "unknown" as const, current, total: 30 },
    });
    const first = new ControlledAdapter([Promise.resolve(atQuestion("question-q27", 27))]);
    const firstPreflight = createPreflight();
    const firstVisit = new ReviewController({
      adapter: first,
      preflight: firstPreflight,
      repository,
      uiCss: "",
    });
    await firstVisit.reconcile();
    firstPreflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='practice']")?.click();
    await vi.waitFor(async () => {
      expect((await repository.listSessions())[0]?.currentQuestionNumber).toBe(27);
    });
    firstVisit.dispose();

    const reopened = new ControlledAdapter([]);
    let showing = 1;
    reopened.getQuestionContext = async () => {
      reopened.contextRequests += 1;
      return atQuestion(`question-q${showing}`, showing);
    };
    const preflight = createPreflight();
    const controller = new ReviewController({
      adapter: reopened,
      preflight,
      repository,
      uiCss: "",
    });
    // Page updates while the navigator opens must not resume on question 1
    reopened.goToQuestion = async (questionNumber) => {
      reopened.questionJumps.push(questionNumber);
      await controller.reconcile();
      showing = questionNumber;
      return true;
    };
    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='resume']")?.click();

    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    });
    const [session] = await repository.listSessions();
    expect(reopened.questionJumps).toEqual([27]);
    expect(session?.currentQuestionNumber).toBe(27);
    expect(
      (await repository.listAttempts(session?.id)).map((attempt) => attempt.questionKey),
    ).toEqual(["question-q27"]);
    controller.dispose();
  });

  it("resumes on the current question when the jump fails", async () => {
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: monotonicNow(),
    });
    const atQuestion = (questionKey: string, current: number) => ({
      ...context(questionKey),
      progress: { scope: "unknown" as const, current, total: 30 },
    });
    const now = Date.now();
    await repository.saveSession({
      id: "saved-session",
      examKey: "synthetic-exam",
      mode: "practice",
      status: "active",
      startedAt: now,
      updatedAt: now,
      currentQuestionKey: "question-q27",
      currentQuestionNumber: 27,
      completedAt: null,
      finishedSections: [],
    });
    const adapter = new ControlledAdapter([
      Promise.resolve(atQuestion("question-q1", 1)),
      Promise.resolve(atQuestion("question-q1", 1)),
    ]);
    const preflight = createPreflight();
    const controller = new ReviewController({ adapter, preflight, repository, uiCss: "" });
    await controller.reconcile();
    preflight.shadow.querySelector<HTMLButtonElement>("[data-focus-key='resume']")?.click();

    await vi.waitFor(() => {
      expect(preflight.shadow.querySelector(".mkit-study-rail")).not.toBeNull();
    });
    expect(adapter.questionJumps).toEqual([27]);
    expect((await repository.getSession("saved-session"))?.currentQuestionNumber).toBe(1);
    controller.dispose();
  });
});

class ControlledAdapter implements FullLengthReviewAdapter {
  annotationSeals = 0;
  anchorRequests = 0;
  contextRequests = 0;
  studyRailMounts = 0;
  readonly questionJumps: number[] = [];
  cleanSlatePreferences: CleanSlatePreferences | null = null;
  readonly #contexts: Array<Promise<SanitizedQuestionContext | null>>;

  constructor(contexts: Array<Promise<SanitizedQuestionContext | null>>) {
    this.#contexts = contexts;
  }

  classifyPage: FullLengthReviewAdapter["classifyPage"] = () => "review";
  inspectCapabilities = () => SAFE_REVIEW_REPORT;
  getExamKey = async () => "synthetic-exam";
  getQuestionContext = async () => {
    const request = this.#contexts[this.contextRequests];
    this.contextRequests += 1;
    return request ?? null;
  };
  configureCleanSlate = (preferences: CleanSlatePreferences) => {
    this.cleanSlatePreferences = preferences;
  };
  getStudyRailAnchor = () => {
    this.anchorRequests += 1;
    return this.anchorRequests === 1 ? { top: 297, right: 16 } : { top: 16, right: 16 };
  };
  applyCleanSlate = () => SAFE_REVIEW_REPORT;
  sealPriorAnnotations = () => {
    this.annotationSeals += 1;
  };
  applyScoreShield = () => SAFE_REVIEW_REPORT;
  applySectionOverviewCover = () => false;
  revealSectionOverview = () => undefined;
  getInitialOutcome = () => "needs-review" as const;
  gradeFresh = () => "unknown" as const;
  revealScores: FullLengthReviewAdapter["revealScores"] = () => undefined;
  revealFeedback = () => undefined;
  revealOriginalAttempt = () => undefined;
  remaskQuestion = () => undefined;
  restoreNormalReview = () => undefined;
  mountFreshAttemptEntry = () => true;
  mountStudyRail = (host: HTMLElement) => {
    this.studyRailMounts += 1;
    if (!host.isConnected) document.body.append(host);
    return true;
  };
  navigate = () => false;
  goToQuestion = async (questionNumber: number) => {
    this.questionJumps.push(questionNumber);
    return false;
  };
  observe = (_listener: (event: AdapterEvent) => void) => () => undefined;
}

class ScoreReportAdapter extends ControlledAdapter {
  scoreShieldApplications = 0;
  scoreReveals = 0;

  constructor() {
    super([]);
  }

  override classifyPage = () => "score-report" as const;
  override inspectCapabilities = () => ({
    ...SAFE_REVIEW_REPORT,
    pageKind: "score-report" as const,
    scoreRegionCount: 1,
  });
  override applyScoreShield = () => {
    this.scoreShieldApplications += 1;
    return this.inspectCapabilities();
  };
  override revealScores = () => {
    this.scoreReveals += 1;
  };
}

function context(questionKey: string): SanitizedQuestionContext {
  return {
    examKey: "synthetic-exam",
    questionKey,
    sectionKey: "cp",
    categoryCode: "1A",
    passageOrDiscrete: "passage",
    progress: {
      scope: "full-length",
      current: null,
      total: null,
    },
  };
}

function createPreflight(): MKitPreflight & { protections: PreflightProtection[] } {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  document.body.append(host);
  const protections: PreflightProtection[] = [];
  return {
    host,
    shadow,
    protections,
    setProtection: (protection) => {
      protections.push(protection);
    },
    showPreparing: () => undefined,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function monotonicNow(): () => number {
  let value = 100;
  return () => {
    value += 1;
    return value;
  };
}
