import { AamcFullLengthReviewAdapter } from "../../src/adapter/AamcFullLengthReviewAdapter";
import { startContentLifecycle } from "../../src/content/lifecycle";
import { createPreflight } from "../../src/content/preflight";
import { ReviewController } from "../../src/core/review-controller";
import { type StorageAreaLike, StorageRepository } from "../../src/storage";

interface RouteGuardHarness {
  dispose(): void;
  setHash(hash: string): void;
}

declare global {
  interface Window {
    __mkitRouteGuardHarness: RouteGuardHarness;
    __mkitRouteGuardSyncDisplay: string;
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

const initialHash = new URL(location.href).searchParams.has("answer")
  ? "#exams/answers/synthetic-exam/synthetic-question"
  : "#exams";
let route = new URL(`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${initialHash}`);
const repository = new StorageRepository({ local: new MemoryStorageArea() });
const lifecycle = startContentLifecycle({
  createAdapter: () => new AamcFullLengthReviewAdapter(document, () => new URL(route.href)),
  createPreflight,
  createController: (adapter, preflight) =>
    new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss: __MKIT_UI_CSS__,
    }),
});

window.__mkitRouteGuardHarness = {
  dispose: () => lifecycle.dispose(),
  setHash: (hash) => {
    route = new URL(`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-1${hash}`);
    dispatchEvent(new HashChangeEvent("hashchange"));
  },
};
