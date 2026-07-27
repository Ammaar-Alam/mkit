import type { FullLengthReviewAdapter } from "../adapter/contracts";
import type { ReviewController } from "../core/review-controller";
import {
  CONTENT_DETECTION_FAILED_ISSUE,
  CONTENT_STARTUP_FAILED_ISSUE,
  type ContentRouteKind,
  type ContentRuntimeState,
  type ContentStatusResponse,
} from "../shared/popup-status";
import type { SettingsRecord } from "../storage";
import { type DisposableMKitPreflight, NORMAL_REVIEW_REQUEST_EVENT } from "./preflight";

export interface ContentLifecycleDependencies {
  createAdapter(): FullLengthReviewAdapter;
  createController(
    adapter: FullLengthReviewAdapter,
    preflight: DisposableMKitPreflight,
  ): ReviewController;
  createPreflight(): DisposableMKitPreflight;
}

export interface ContentLifecycle {
  applySettings(settings: SettingsRecord): void;
  dispose(): void;
  reconcile(): void;
  setEnabled(enabled: boolean): void;
  setHideSectionResultMarksEnabled(enabled: boolean): void;
  status(): ContentStatusResponse;
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
  let enabled = true;
  let hideSectionResultMarksEnabled = true;
  let normalReviewBypass = false;
  let routeKind: ContentRouteKind = "non-review";
  let routeIssues: string[] = [];
  let runtimeState: ContentRuntimeState = "unsupported";
  /**
   * The adapter that covered a section overview. Its class mask is reversible, so
   * leaving that page has to restore it even though no host was ever mounted.
   */
  let sectionOverviewAdapter: FullLengthReviewAdapter | null = null;
  let stopSectionOverviewObserver: (() => void) | null = null;

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

  const releaseSectionOverview = (): void => {
    const stopObserver = stopSectionOverviewObserver;
    stopSectionOverviewObserver = null;
    try {
      stopObserver?.();
    } catch {
      // Restoration below must still run if observation teardown is incomplete.
    }
    const owner = sectionOverviewAdapter;
    sectionOverviewAdapter = null;
    if (!owner) return;
    try {
      owner.restoreNormalReview();
    } catch {
      // Leaving the overview must not depend on the cover restoring cleanly.
    }
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

  const requestNormalReview = (): void => {
    if (disposed || !enabled) return;
    normalReviewBypass = true;
    routeIssues = [];
    runtimeState = "normal-review";
    releaseSectionOverview();
    deactivate();
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
    if (!enabled) {
      runtimeState = "disabled";
      return;
    }

    if (!controller) {
      clearPageMarkers();
    }

    let candidate: FullLengthReviewAdapter;
    let pageKind: ReturnType<FullLengthReviewAdapter["classifyPage"]>;
    let answerRoute = false;
    routeKind = "non-review";
    routeIssues = [];
    try {
      candidate = dependencies.createAdapter();
      pageKind = candidate.classifyPage();
      answerRoute = pageKind === "review" || pageKind === "unknown-review";
      routeKind =
        pageKind === "review"
          ? "review"
          : answerRoute
            ? "incomplete-review"
            : pageKind === "section-overview"
              ? "section-overview"
              : "non-review";

      if (normalReviewBypass) {
        if (answerRoute) {
          runtimeState = "normal-review";
          stopProbe();
          releaseSectionOverview();
          restoreNativePage(null, null, null);
          return;
        }
        normalReviewBypass = false;
      }

      // The completed section overview is covered in place: it needs no host,
      // controller, or protection marker, so the native page stays intact and
      // only its row-level correctness cues are neutralized.
      if (pageKind === "section-overview") {
        if (controller || adapter || preflight) {
          deactivate();
        }
        if (!hideSectionResultMarksEnabled) {
          stopProbe();
          releaseSectionOverview();
          runtimeState = "supported-not-running";
          return;
        }
        sectionOverviewAdapter ??= candidate;
        if (sectionOverviewAdapter.applySectionOverviewCover()) {
          stopSectionOverviewObserver ??= sectionOverviewAdapter.observe((event) => {
            if (event.type === "page-change") {
              scheduleProbe();
            }
          });
          stopProbe();
          runtimeState = "active";
        } else {
          scheduleProbe();
          runtimeState = "supported-not-running";
        }
        return;
      }
      releaseSectionOverview();

      const report = candidate.inspectCapabilities();
      const ready = pageKind === "review" && report.safeToReveal;
      if (answerRoute && !ready) {
        routeIssues = [...report.issues];
      }

      if (!ready) {
        runtimeState = answerRoute ? "supported-not-running" : "unsupported";
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
      routeIssues = [CONTENT_DETECTION_FAILED_ISSUE];
      runtimeState = answerRoute ? "supported-not-running" : "unsupported";
      releaseSectionOverview();
      if (controller || adapter || preflight) {
        deactivate();
      } else {
        restoreNativePage(null, null, null);
      }
      if (answerRoute || routeKind === "section-overview") scheduleProbe();
      return;
    }

    stopProbe();
    if (controller && preflight?.host.isConnected) {
      document.documentElement.dataset.mkitRoute = routeMarker;
      runtimeState = "active";
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
      nextPreflight.host.addEventListener(NORMAL_REVIEW_REQUEST_EVENT, requestNormalReview);
      nextController = dependencies.createController(candidate, nextPreflight);
      nextController.start();
      if (!nextPreflight.host.isConnected) {
        throw new Error("MKit preflight host disconnected during startup.");
      }
    } catch {
      routeIssues = [CONTENT_STARTUP_FAILED_ISSUE];
      runtimeState = "supported-not-running";
      restoreNativePage(candidate, nextController, nextPreflight);
      scheduleProbe();
      return;
    }

    adapter = candidate;
    preflight = nextPreflight;
    controller = nextController;
    document.documentElement.dataset.mkitRoute = routeMarker;
    runtimeState = "active";
  };

  const routeListener = (): void => reconcile();
  addEventListener("hashchange", routeListener);
  addEventListener("popstate", routeListener);
  addEventListener("pageshow", routeListener);
  document.addEventListener("DOMContentLoaded", routeListener);
  reconcile();

  const setEnabled = (nextEnabled: boolean): void => {
    if (disposed || enabled === nextEnabled) return;
    enabled = nextEnabled;
    normalReviewBypass = false;
    routeIssues = [];
    if (!enabled) {
      runtimeState = "disabled";
      stopProbe();
      releaseSectionOverview();
      deactivate();
      return;
    }
    runtimeState = "unsupported";
    reconcile();
  };

  const setHideSectionResultMarksEnabled = (nextEnabled: boolean): void => {
    if (disposed || hideSectionResultMarksEnabled === nextEnabled) return;
    hideSectionResultMarksEnabled = nextEnabled;
    if (!hideSectionResultMarksEnabled) {
      releaseSectionOverview();
    }
    if (enabled) {
      reconcile();
    }
  };

  return {
    applySettings(settings: SettingsRecord): void {
      if (disposed) return;
      if (!settings.enabled) {
        setEnabled(false);
        hideSectionResultMarksEnabled = settings.hideSectionResultMarksEnabled;
        return;
      }
      setHideSectionResultMarksEnabled(settings.hideSectionResultMarksEnabled);
      setEnabled(true);
      controller?.updateSettings(settings);
    },
    reconcile,
    setEnabled,
    setHideSectionResultMarksEnabled,
    status(): ContentStatusResponse {
      return {
        state: runtimeState,
        route: routeKind,
        issues: runtimeState === "active" || runtimeState === "normal-review" ? [] : routeIssues,
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      removeEventListener("hashchange", routeListener);
      removeEventListener("popstate", routeListener);
      removeEventListener("pageshow", routeListener);
      document.removeEventListener("DOMContentLoaded", routeListener);
      releaseSectionOverview();
      deactivate();
    },
  };
}
