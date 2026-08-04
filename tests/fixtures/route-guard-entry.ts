import { AamcFullLengthReviewAdapter } from "../../src/adapter/AamcFullLengthReviewAdapter";
import { startContentLifecycle } from "../../src/content/lifecycle";
import { createPreflight } from "../../src/content/preflight";
import { ReviewController } from "../../src/core/review-controller";
import { DEFAULT_SETTINGS, type StorageAreaLike, StorageRepository } from "../../src/storage";

interface RouteGuardHarness {
  armGateMutationOnPointerDown(): void;
  dispose(): void;
  setEnabled(enabled: boolean): void;
  setHideSectionResultMarksEnabled(enabled: boolean): void;
  setShowInitialCorrectnessEnabled(enabled: boolean): void;
  status(): { issues: string[]; route: string; state: string };
  restoreCompletedReviewCapability(): {
    footerDisplay: string;
    hostConnected: boolean;
    wrapperDisplay: string;
  };
  setHash(hash: string): void;
}

declare global {
  interface Window {
    __mkitRouteGuardAuthoredMarkup: string;
    __mkitRouteGuardAuthoredSurface: string;
    __mkitRouteGuardHarness: RouteGuardHarness;
    __mkitRouteGuardSyncDisplay: string;
    __mkitRouteGuardSyncFooterDisplay: string;
    __mkitRouteGuardSyncQuestionVisibility: string;
    __mkitRouteGuardStartupMutations: number;
  }
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

const searchParams = new URL(location.href).searchParams;
const bootstrapFailure = searchParams.has("bootstrap-fail");
const controllerFailure = searchParams.has("controller-fail");
const disconnectedPreflight = searchParams.has("disconnected-preflight");
const initialHash = searchParams.has("section-overview")
  ? "#exams/details/exam_section/synthetic-section"
  : searchParams.has("section")
    ? "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question"
    : searchParams.has("answer")
      ? "#exams/answers/synthetic-exam/synthetic-question"
      : "#exams";
let route = new URL(`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${initialHash}`);
const repository = new StorageRepository({ local: new MemoryStorageArea() });
window.__mkitRouteGuardStartupMutations = 0;
const startupObserver = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes" && record.attributeName?.startsWith("data-mkit")) {
      window.__mkitRouteGuardStartupMutations += 1;
    }
    for (const node of record.addedNodes) {
      if (
        node instanceof Element &&
        (node.matches("[data-mkit-host], [data-mkit-hidden], [data-mkit-outcome-hidden]") ||
          node.querySelector("[data-mkit-host], [data-mkit-hidden], [data-mkit-outcome-hidden]"))
      ) {
        window.__mkitRouteGuardStartupMutations += 1;
      }
    }
  }
});
startupObserver.observe(document, {
  attributes: true,
  childList: true,
  subtree: true,
});
const lifecycle = startContentLifecycle({
  createAdapter: () => new AamcFullLengthReviewAdapter(document, () => new URL(route.href)),
  createPreflight: () => {
    if (bootstrapFailure) {
      throw new Error("Synthetic preflight failure.");
    }
    const preflight = createPreflight();
    if (disconnectedPreflight) {
      preflight.host.remove();
    }
    return preflight;
  },
  createController: (adapter, preflight) => {
    if (controllerFailure) {
      throw new Error("Synthetic controller failure.");
    }
    return new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: __MKIT_UI_CSS__,
    });
  },
});
lifecycle.applySettings({
  ...DEFAULT_SETTINGS,
  enabled: !searchParams.has("disabled"),
});

window.__mkitRouteGuardHarness = {
  armGateMutationOnPointerDown: () => {
    document.addEventListener(
      "pointerdown",
      () => {
        document.querySelector("#main-footer")?.classList.toggle("synthetic-live-mutation");
      },
      { capture: true, once: true },
    );
  },
  dispose: () => {
    startupObserver.disconnect();
    lifecycle.dispose();
  },
  setEnabled: (enabled) => lifecycle.setEnabled(enabled),
  setHideSectionResultMarksEnabled: (enabled) =>
    lifecycle.setHideSectionResultMarksEnabled(enabled),
  setShowInitialCorrectnessEnabled: (enabled) =>
    lifecycle.setShowInitialCorrectnessEnabled(enabled),
  status: () => lifecycle.status(),
  restoreCompletedReviewCapability: () => {
    const reviewControl = document.querySelector(".review-answer");
    if (reviewControl && !reviewControl.querySelector(".view-answers.switchable")) {
      const input = document.createElement("input");
      input.className = "view-answers switchable";
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-checked", "false");
      reviewControl.append(input);
    }
    lifecycle.reconcile();
    const host = document.querySelector("[data-mkit-host]");
    const wrapper = document.querySelector("#wrapper");
    const footer = document.querySelector("#main-footer");
    return {
      footerDisplay: footer ? getComputedStyle(footer).display : "",
      hostConnected: Boolean(host?.isConnected),
      wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "",
    };
  },
  setHash: (hash) => {
    route = new URL(`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${hash}`);
    dispatchEvent(new HashChangeEvent("hashchange"));
  },
};
