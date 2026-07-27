import { describe, expect, it } from "vitest";
import type {
  CapabilityReport,
  FullLengthReviewAdapter,
  PageKind,
} from "../../../src/adapter/contracts";
import { startContentLifecycle } from "../../../src/content/lifecycle";
import {
  type DisposableMKitPreflight,
  NORMAL_REVIEW_REQUEST_EVENT,
} from "../../../src/content/preflight";
import type { ReviewController } from "../../../src/core/review-controller";
import { DEFAULT_SETTINGS } from "../../../src/storage";

function stubAdapter(
  pageKind: PageKind,
  safeToReveal: boolean,
  issues: string[] = [],
): FullLengthReviewAdapter {
  const report = { pageKind, safeToReveal, issues } as unknown as CapabilityReport;
  return {
    classifyPage: () => pageKind,
    inspectCapabilities: () => report,
    restoreNormalReview: () => undefined,
  } as unknown as FullLengthReviewAdapter;
}

function stubPreflight(): DisposableMKitPreflight {
  const host = document.createElement("div");
  host.dataset.mkitHost = "";
  document.body.append(host);
  return {
    host,
    shadow: host.attachShadow({ mode: "open" }),
    setProtection: () => undefined,
    showPreparing: () => undefined,
    destroy: () => host.remove(),
  };
}

function stubController(): ReviewController {
  return {
    start: () => undefined,
    dispose: () => undefined,
    normalReview: () => undefined,
    updateSettings: () => undefined,
  } as unknown as ReviewController;
}

describe("content lifecycle status", () => {
  it("reports an attached review only once a controller and connected host exist", () => {
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => stubAdapter("review", true),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({ state: "active", route: "review", issues: [] });
    lifecycle.dispose();
  });

  it("reports a recognized but unverified review as an unattached review route", () => {
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => stubAdapter("unknown-review", false, ["REVIEW_SWITCH_MISSING"]),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({
      state: "supported-not-running",
      route: "incomplete-review",
      issues: ["REVIEW_SWITCH_MISSING"],
    });
    lifecycle.dispose();
  });

  it("reports a non-review page as unattached without claiming review support", () => {
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => stubAdapter("non-review", false),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({ state: "unsupported", route: "non-review", issues: [] });
    lifecycle.dispose();
  });

  it("does not claim attachment when startup fails after recognizing the route", () => {
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => stubAdapter("review", true),
      createPreflight: stubPreflight,
      createController: () => {
        throw new Error("Synthetic controller failure.");
      },
    });

    expect(lifecycle.status()).toEqual({
      state: "supported-not-running",
      route: "review",
      issues: ["STARTUP_FAILED"],
    });
    lifecycle.dispose();
  });

  it("reports a detection failure as a recognized route without claiming attachment", () => {
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => {
        const adapter = stubAdapter("review", true);
        return {
          ...adapter,
          inspectCapabilities: () => {
            throw new Error("Synthetic detection failure.");
          },
        } as unknown as FullLengthReviewAdapter;
      },
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({
      state: "supported-not-running",
      route: "review",
      issues: ["DETECTION_FAILED"],
    });
    lifecycle.dispose();
  });

  it("owns Normal review teardown and keeps the bypass through completed-question routes", () => {
    let pageKind: PageKind = "review";
    let controllerNormalReviews = 0;
    const preflights: DisposableMKitPreflight[] = [];
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => mutableAdapter(() => pageKind),
      createPreflight: () => {
        const next = stubPreflight();
        preflights.push(next);
        return next;
      },
      createController: () =>
        ({
          start: () => undefined,
          dispose: () => undefined,
          normalReview: () => {
            controllerNormalReviews += 1;
          },
        }) as unknown as ReviewController,
    });

    expect(lifecycle.status()).toEqual({ state: "active", route: "review", issues: [] });
    preflights[0]?.host.dispatchEvent(new CustomEvent(NORMAL_REVIEW_REQUEST_EVENT));

    expect(controllerNormalReviews).toBe(1);
    expect(preflights[0]?.host.isConnected).toBe(false);
    expect(lifecycle.status()).toEqual({
      state: "normal-review",
      route: "review",
      issues: [],
    });

    pageKind = "unknown-review";
    lifecycle.reconcile();
    pageKind = "review";
    lifecycle.reconcile();
    expect(preflights).toHaveLength(1);
    expect(lifecycle.status()).toEqual({
      state: "normal-review",
      route: "review",
      issues: [],
    });

    pageKind = "non-review";
    lifecycle.reconcile();
    expect(lifecycle.status()).toEqual({
      state: "unsupported",
      route: "non-review",
      issues: [],
    });

    pageKind = "review";
    lifecycle.reconcile();
    expect(preflights).toHaveLength(2);
    expect(lifecycle.status()).toEqual({ state: "active", route: "review", issues: [] });
    lifecycle.dispose();
  });

  it("turns protection off and back on without a reload, releasing overview coverage", () => {
    let pageKind: PageKind = "section-overview";
    let covers = 0;
    let restores = 0;
    let adapterCreations = 0;
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => {
        adapterCreations += 1;
        return {
          ...mutableAdapter(() => pageKind),
          applySectionOverviewCover: () => {
            covers += 1;
            return true;
          },
          restoreNormalReview: () => {
            restores += 1;
          },
        } as FullLengthReviewAdapter;
      },
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(covers).toBe(1);
    lifecycle.setEnabled(false);
    expect(restores).toBe(1);
    expect(lifecycle.status()).toEqual({
      state: "disabled",
      route: "section-overview",
      issues: [],
    });

    lifecycle.setEnabled(true);
    expect(adapterCreations).toBe(2);
    expect(covers).toBe(2);

    pageKind = "review";
    lifecycle.reconcile();
    const host = document.querySelector<HTMLElement>("[data-mkit-host]");
    host?.dispatchEvent(new CustomEvent(NORMAL_REVIEW_REQUEST_EVENT));
    expect(lifecycle.status().state).toBe("normal-review");

    lifecycle.setEnabled(false);
    lifecycle.setEnabled(true);
    expect(lifecycle.status()).toEqual({ state: "active", route: "review", issues: [] });
    lifecycle.dispose();
  });

  it("releases and reapplies section result coverage when its setting changes", () => {
    let covers = 0;
    let observations = 0;
    let observerStops = 0;
    let restores = 0;
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () =>
        ({
          ...mutableAdapter(() => "section-overview"),
          applySectionOverviewCover: () => {
            covers += 1;
            return true;
          },
          observe: () => {
            observations += 1;
            return () => {
              observerStops += 1;
            };
          },
          restoreNormalReview: () => {
            restores += 1;
          },
        }) as FullLengthReviewAdapter,
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(covers).toBe(1);
    expect(observations).toBe(1);
    expect(lifecycle.status()).toEqual({
      state: "active",
      route: "section-overview",
      issues: [],
    });

    lifecycle.setHideSectionResultMarksEnabled(false);
    expect(observerStops).toBe(1);
    expect(restores).toBe(1);
    expect(lifecycle.status()).toEqual({
      state: "supported-not-running",
      route: "section-overview",
      issues: [],
    });

    lifecycle.setHideSectionResultMarksEnabled(true);
    expect(covers).toBe(2);
    expect(observations).toBe(2);
    expect(lifecycle.status()).toEqual({
      state: "active",
      route: "section-overview",
      issues: [],
    });
    lifecycle.dispose();
    expect(observerStops).toBe(2);
  });

  it("passes live popup preferences into the active review controller", () => {
    const updates: (typeof DEFAULT_SETTINGS)[] = [];
    const lifecycle = startHydratedContentLifecycle({
      createAdapter: () => stubAdapter("review", true),
      createPreflight: stubPreflight,
      createController: () =>
        ({
          ...stubController(),
          updateSettings: (settings: typeof DEFAULT_SETTINGS) => {
            updates.push(settings);
          },
        }) as ReviewController,
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      clearPreviousHighlightsEnabled: false,
      clearPreviousCrossOutsEnabled: false,
      updatedAt: 42,
    };

    lifecycle.applySettings(settings);

    expect(updates).toEqual([settings]);
    lifecycle.dispose();
  });

  it("leaves the native page untouched until persisted settings enable protection", () => {
    let adapterCreations = 0;
    let preflightCreations = 0;
    let controllerCreations = 0;
    let covers = 0;
    let pageKind: PageKind = "section-overview";
    const lifecycle = startContentLifecycle({
      createAdapter: () => {
        adapterCreations += 1;
        return {
          ...mutableAdapter(() => pageKind),
          applySectionOverviewCover: () => {
            covers += 1;
            return true;
          },
        } as FullLengthReviewAdapter;
      },
      createPreflight: () => {
        preflightCreations += 1;
        return stubPreflight();
      },
      createController: () => {
        controllerCreations += 1;
        return stubController();
      },
    });
    const disabledSettings = {
      ...DEFAULT_SETTINGS,
      enabled: false,
      updatedAt: 42,
    };

    expect(lifecycle.status().state).toBe("disabled");
    expect(adapterCreations).toBe(0);
    expect(preflightCreations).toBe(0);
    expect(controllerCreations).toBe(0);
    expect(covers).toBe(0);
    expect(document.querySelector("[data-mkit-host]")).toBeNull();
    expect(document.documentElement.hasAttribute("data-mkit-protection")).toBe(false);

    lifecycle.applySettings(disabledSettings);
    expect(adapterCreations).toBe(0);
    expect(preflightCreations).toBe(0);
    expect(controllerCreations).toBe(0);
    expect(covers).toBe(0);

    pageKind = "review";
    lifecycle.applySettings({ ...DEFAULT_SETTINGS, updatedAt: 43 });
    expect(adapterCreations).toBe(1);
    expect(preflightCreations).toBe(1);
    expect(controllerCreations).toBe(1);
    expect(covers).toBe(0);
    lifecycle.dispose();
  });
});

function startHydratedContentLifecycle(
  dependencies: Parameters<typeof startContentLifecycle>[0],
): ReturnType<typeof startContentLifecycle> {
  return startContentLifecycle(dependencies, DEFAULT_SETTINGS);
}

function mutableAdapter(pageKind: () => PageKind): FullLengthReviewAdapter {
  return {
    classifyPage: pageKind,
    inspectCapabilities: () => {
      const kind = pageKind();
      return {
        pageKind: kind,
        safeToReveal: kind === "review",
        issues: [],
      } as unknown as CapabilityReport;
    },
    applySectionOverviewCover: () => false,
    observe: () => () => undefined,
    restoreNormalReview: () => undefined,
  } as unknown as FullLengthReviewAdapter;
}
