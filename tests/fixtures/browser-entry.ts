import { AamcFullLengthReviewAdapter } from "../../src/adapter/AamcFullLengthReviewAdapter";
import type { AdapterEvent, CapabilityReport } from "../../src/adapter/contracts";
import { createPreflight } from "../../src/content/preflight";
import {
  type FreshAttemptKeyboardActions,
  FreshAttemptKeyboardController,
} from "../../src/core/keyboard";
import { ReviewController } from "../../src/core/review-controller";
import { type StorageAreaLike, StorageRepository } from "../../src/storage";

createPreflight();

interface KeyboardLog {
  checks: number;
  eliminations: string[];
  flags: number;
  navigation: string[];
  reviewAgain: number;
  selections: string[];
}

interface PrivacyHarness {
  readonly events: AdapterEvent[];
  capabilities(): CapabilityReport;
  mask(): CapabilityReport;
  maskAndObserve(): CapabilityReport;
  normalReview(): void;
  scoreShield(): CapabilityReport;
  revealScores(): void;
  grade(selection: "A" | "B" | "C" | "D"): string;
  keyboardLog(): KeyboardLog;
  navigate(direction: "previous" | "next"): boolean;
  restartController(): void;
  setKeyboardEnabled(enabled: boolean): void;
  startController(): void;
  stopController(): void;
  stop(): void;
}

declare global {
  interface Window {
    __freshReviewMarkup: string;
    __mkitLeaks: Array<{ id: string; label: string; time: number }>;
    __mkitPrivacyHarness: PrivacyHarness;
    __nativeEvents: {
      answer: number;
      next: number;
      previous: number;
      reset: number;
      submit: number;
    };
    __sampleSpoilers(label: string): void;
    __syncBootDisplay: string;
    find(
      text: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
      searchInFrames?: boolean,
      showDialog?: boolean,
    ): boolean;
  }
}

const adapter = new AamcFullLengthReviewAdapter(document, () => new URL(location.href));
const events: AdapterEvent[] = [];
let stopObserver: (() => void) | null = null;
let reviewController: ReviewController | null = null;
let reviewRepository: StorageRepository | null = null;
const keyboardLog: KeyboardLog = {
  checks: 0,
  eliminations: [],
  flags: 0,
  navigation: [],
  reviewAgain: 0,
  selections: [],
};
const keyboardActions: FreshAttemptKeyboardActions = {
  select: (choice) => keyboardLog.selections.push(choice),
  toggleElimination: (choice) => keyboardLog.eliminations.push(choice),
  check: () => {
    keyboardLog.checks += 1;
  },
  toggleFlag: () => {
    keyboardLog.flags += 1;
  },
  toggleReviewAgain: () => {
    keyboardLog.reviewAgain += 1;
  },
  navigate: (direction) => keyboardLog.navigation.push(direction),
};
const keyboard = new FreshAttemptKeyboardController(keyboardActions, document);

const setProtectionFrom = (report: CapabilityReport): void => {
  globalThis.__mkitPreflight?.setProtection(report.safeToReveal ? "masked" : "unsupported");
};

window.__mkitPrivacyHarness = {
  events,
  capabilities: () => adapter.inspectCapabilities(),
  mask: () => {
    const report = adapter.applyCleanSlate();
    setProtectionFrom(report);
    return report;
  },
  maskAndObserve: () => {
    const report = adapter.applyCleanSlate();
    setProtectionFrom(report);
    stopObserver ??= adapter.observe((event) => {
      events.push(event);
      if (event.type === "capability-change") {
        setProtectionFrom(event.report);
      }
    });
    return report;
  },
  normalReview: () => {
    if (reviewController) {
      reviewController.normalReview();
    } else {
      adapter.restoreNormalReview();
      globalThis.__mkitPreflight?.setProtection("normal-review");
    }
  },
  scoreShield: () => {
    const report = adapter.applyScoreShield();
    setProtectionFrom(report);
    return report;
  },
  revealScores: () => adapter.revealScores(),
  grade: (selection) => adapter.gradeFresh(selection),
  keyboardLog: () => structuredClone(keyboardLog),
  navigate: (direction) => adapter.navigate(direction),
  restartController: () => {
    reviewController?.dispose();
    reviewController = null;
    startReviewController();
  },
  setKeyboardEnabled: (enabled) => keyboard.setEnabled(enabled),
  startController: () => startReviewController(),
  stopController: () => {
    reviewController?.dispose();
    reviewController = null;
  },
  stop: () => {
    stopObserver?.();
    stopObserver = null;
  },
};

function startReviewController(): void {
  if (reviewController) return;
  const preflight = globalThis.__mkitPreflight;
  if (!preflight) {
    throw new Error("Synthetic preflight is unavailable.");
  }
  reviewRepository ??= new StorageRepository({ local: new MemoryStorageArea() });
  reviewController = new ReviewController({
    adapter: new AamcFullLengthReviewAdapter(
      document,
      () =>
        new URL(
          "https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1#exams/answers/synthetic-exam/synthetic-question",
        ),
    ),
    preflight,
    repository: reviewRepository,
    uiCss: __MKIT_UI_CSS__,
  });
  reviewController.start();
}

class MemoryStorageArea implements StorageAreaLike {
  readonly #values: Record<string, unknown> = {};

  async get(keys: string | string[] | null = null): Promise<Record<string, unknown>> {
    if (keys === null) return structuredClone(this.#values);
    const selected = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      selected
        .filter((key) => Object.hasOwn(this.#values, key))
        .map((key) => [key, structuredClone(this.#values[key])]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.#values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.#values[key];
    }
  }
}
