import type { FullLengthReviewAdapter } from "../adapter/contracts";
import type { ReviewController } from "../core/review-controller";
import type { DisposableMKitPreflight } from "./preflight";

export interface ContentLifecycleDependencies {
  createAdapter(): FullLengthReviewAdapter;
  createController(
    adapter: FullLengthReviewAdapter,
    preflight: DisposableMKitPreflight,
  ): ReviewController;
  createPreflight(): DisposableMKitPreflight;
}

export interface ContentLifecycle {
  dispose(): void;
  reconcile(): void;
}

export function startContentLifecycle(
  dependencies: ContentLifecycleDependencies,
): ContentLifecycle {
  const routeMarker = "answer-review";
  let adapter: FullLengthReviewAdapter | null = null;
  let controller: ReviewController | null = null;
  let preflight: DisposableMKitPreflight | null = null;
  let probeFrame: number | null = null;
  let disposed = false;

  const stopProbe = (): void => {
    if (probeFrame === null) return;
    cancelAnimationFrame(probeFrame);
    probeFrame = null;
  };

  const deactivate = (): void => {
    stopProbe();
    if (controller) {
      controller.normalReview();
      controller.dispose();
    }
    controller = null;
    adapter = null;
    preflight?.destroy();
    preflight = null;
  };

  const scheduleProbe = (): void => {
    if (probeFrame !== null || disposed) return;
    probeFrame = requestAnimationFrame(() => {
      probeFrame = null;
      reconcile();
    });
  };

  const reconcile = (): void => {
    if (disposed) return;
    const candidate = dependencies.createAdapter();
    const pageKind = candidate.classifyPage();
    const report = candidate.inspectCapabilities();
    const ready = pageKind === "review" && report.safeToReveal;
    const answerRoute = pageKind === "review" || pageKind === "unknown-review";
    if (answerRoute) {
      document.documentElement.dataset.mkitRoute = routeMarker;
    } else {
      document.documentElement.removeAttribute("data-mkit-route");
    }

    if (!ready) {
      if (controller) deactivate();
      if (pageKind === "review" || pageKind === "unknown-review") {
        scheduleProbe();
      } else {
        stopProbe();
      }
      return;
    }

    stopProbe();
    if (controller) return;
    adapter = candidate;
    preflight = dependencies.createPreflight();
    controller = dependencies.createController(adapter, preflight);
    controller.start();
  };

  const routeListener = (): void => reconcile();
  addEventListener("hashchange", routeListener);
  addEventListener("popstate", routeListener);
  addEventListener("pageshow", routeListener);
  document.addEventListener("DOMContentLoaded", routeListener);
  reconcile();

  return {
    reconcile,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      removeEventListener("hashchange", routeListener);
      removeEventListener("popstate", routeListener);
      removeEventListener("pageshow", routeListener);
      document.removeEventListener("DOMContentLoaded", routeListener);
      document.documentElement.removeAttribute("data-mkit-route");
      deactivate();
    },
  };
}
