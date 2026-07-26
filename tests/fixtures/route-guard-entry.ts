import { AamcFullLengthReviewAdapter } from "../../src/adapter/AamcFullLengthReviewAdapter";
import { startContentLifecycle } from "../../src/content/lifecycle";
import { createPreflight } from "../../src/content/preflight";
import { ReviewController } from "../../src/core/review-controller";
import { type StorageAreaLike, StorageRepository } from "../../src/storage";

interface RouteGuardHarness {
  dispose(): void;
  status(): { attached: boolean; issues: string[]; route: string };
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
const initialHash = searchParams.has("section")
  ? "#exams/synthetic-exam/exam_sections/synthetic-section/synthetic-question"
  : searchParams.has("answer")
    ? "#exams/answers/synthetic-exam/synthetic-question"
    : "#exams";
let route = new URL(`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${initialHash}`);
const repository = new StorageRepository({ local: new MemoryStorageArea() });
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

window.__mkitRouteGuardHarness = {
  dispose: () => lifecycle.dispose(),
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
