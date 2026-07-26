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

  const clearPageMarkers = (): void => {
    document.documentElement.removeAttribute("data-mkit-route");
    document.documentElement.removeAttribute("data-mkit-protection");
  };

  const restoreNativePage = (
    targetAdapter: FullLengthReviewAdapter | null,
    targetController: ReviewController | null,
    targetPreflight: DisposableMKitPreflight | null,
  ): void => {
    clearPageMarkers();

    let restoredByController = false;
    if (targetController) {
      try {
        targetController.normalReview();
        restoredByController = true;
      } catch {
        // Continue fail-open cleanup even if a partial controller cannot restore itself.
      }
    }
    if (!restoredByController && targetAdapter) {
      try {
        targetAdapter.restoreNormalReview();
      } catch {
        // Marker and host cleanup below still restores the native page-level surface.
      }
    }
    try {
      targetController?.dispose();
    } catch {
      // A failed disposal must not leave the native page covered.
    }

    const preflights = new Set<DisposableMKitPreflight>();
    if (targetPreflight) preflights.add(targetPreflight);
    if (globalThis.__mkitPreflight) preflights.add(globalThis.__mkitPreflight);
    for (const ownedPreflight of preflights) {
      try {
        ownedPreflight.destroy();
      } catch {
        // Remove any remaining owned host directly below.
      }
    }
    globalThis.__mkitPreflight = undefined;
    for (const host of document.querySelectorAll("[data-mkit-host]")) {
      host.remove();
    }

    clearPageMarkers();
  };

  const deactivate = (): void => {
    stopProbe();
    const currentAdapter = adapter;
    const currentController = controller;
    const currentPreflight = preflight;
    controller = null;
    adapter = null;
    preflight = null;
    restoreNativePage(currentAdapter, currentController, currentPreflight);
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

    if (!controller) {
      clearPageMarkers();
    }

    let candidate: FullLengthReviewAdapter;
    let pageKind: ReturnType<FullLengthReviewAdapter["classifyPage"]>;
    let answerRoute = false;
    try {
      candidate = dependencies.createAdapter();
      pageKind = candidate.classifyPage();
      answerRoute = pageKind === "review" || pageKind === "unknown-review";
      const report = candidate.inspectCapabilities();
      const ready = pageKind === "review" && report.safeToReveal;

      if (!ready) {
        if (controller || adapter || preflight) {
          deactivate();
        } else {
          restoreNativePage(null, null, null);
        }
        if (answerRoute) {
          scheduleProbe();
        } else {
          stopProbe();
        }
        return;
      }
    } catch {
      if (controller || adapter || preflight) {
        deactivate();
      } else {
        restoreNativePage(null, null, null);
      }
      if (answerRoute) scheduleProbe();
      return;
    }

    stopProbe();
    if (controller && preflight?.host.isConnected) {
      document.documentElement.dataset.mkitRoute = routeMarker;
      return;
    }
    if (controller || adapter || preflight) {
      deactivate();
    }

    let nextPreflight: DisposableMKitPreflight | null = null;
    let nextController: ReviewController | null = null;
    try {
      nextPreflight = dependencies.createPreflight();
      if (!nextPreflight.host.isConnected) {
        throw new Error("MKit preflight host did not mount synchronously.");
      }
      nextPreflight.setProtection("boot");
      nextController = dependencies.createController(candidate, nextPreflight);
      nextController.start();
      if (!nextPreflight.host.isConnected) {
        throw new Error("MKit preflight host disconnected during startup.");
      }
    } catch {
      restoreNativePage(candidate, nextController, nextPreflight);
      scheduleProbe();
      return;
    }

    adapter = candidate;
    preflight = nextPreflight;
    controller = nextController;
    document.documentElement.dataset.mkitRoute = routeMarker;
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
      deactivate();
    },
  };
}
