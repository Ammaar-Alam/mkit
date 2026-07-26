import { describe, expect, it, vi } from "vitest";
import type {
  AdapterEvent,
  CapabilityReport,
  FullLengthReviewAdapter,
  SanitizedQuestionContext,
} from "../../../src/adapter/contracts";
import type { MKitPreflight, PreflightProtection } from "../../../src/content/preflight";
import { ReviewController } from "../../../src/core/review-controller";
import { StorageRepository } from "../../../src/storage";
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

    controller.dispose();
  });
});

class ControlledAdapter implements FullLengthReviewAdapter {
  contextRequests = 0;
  studyRailMounts = 0;
  readonly #contexts: Array<Promise<SanitizedQuestionContext | null>>;

  constructor(contexts: Array<Promise<SanitizedQuestionContext | null>>) {
    this.#contexts = contexts;
  }

  classifyPage = () => "review" as const;
  inspectCapabilities = () => SAFE_REVIEW_REPORT;
  getExamKey = async () => "synthetic-exam";
  getQuestionContext = async () => {
    const request = this.#contexts[this.contextRequests];
    this.contextRequests += 1;
    return request ?? null;
  };
  applyCleanSlate = () => SAFE_REVIEW_REPORT;
  applyScoreShield = () => SAFE_REVIEW_REPORT;
  applySectionOverviewCover = () => false;
  revealSectionOverview = () => undefined;
  gradeFresh = () => "unknown" as const;
  revealScores = () => undefined;
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
  observe = (_listener: (event: AdapterEvent) => void) => () => undefined;
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
