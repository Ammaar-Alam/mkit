import { describe, expect, it } from "vitest";
import type {
  CapabilityReport,
  FullLengthReviewAdapter,
  PageKind,
} from "../../../src/adapter/contracts";
import { startContentLifecycle } from "../../../src/content/lifecycle";
import type { DisposableMKitPreflight } from "../../../src/content/preflight";
import type { ReviewController } from "../../../src/core/review-controller";

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
  } as unknown as ReviewController;
}

describe("content lifecycle status", () => {
  it("reports an attached review only once a controller and connected host exist", () => {
    const lifecycle = startContentLifecycle({
      createAdapter: () => stubAdapter("review", true),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({ attached: true, route: "review", issues: [] });
    lifecycle.dispose();
  });

  it("reports a recognized but unverified review as an unattached review route", () => {
    const lifecycle = startContentLifecycle({
      createAdapter: () => stubAdapter("unknown-review", false, ["REVIEW_SWITCH_MISSING"]),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({
      attached: false,
      route: "incomplete-review",
      issues: ["REVIEW_SWITCH_MISSING"],
    });
    lifecycle.dispose();
  });

  it("reports a non-review page as unattached without claiming review support", () => {
    const lifecycle = startContentLifecycle({
      createAdapter: () => stubAdapter("non-review", false),
      createPreflight: stubPreflight,
      createController: stubController,
    });

    expect(lifecycle.status()).toEqual({ attached: false, route: "non-review", issues: [] });
    lifecycle.dispose();
  });

  it("does not claim attachment when startup fails after recognizing the route", () => {
    const lifecycle = startContentLifecycle({
      createAdapter: () => stubAdapter("review", true),
      createPreflight: stubPreflight,
      createController: () => {
        throw new Error("Synthetic controller failure.");
      },
    });

    expect(lifecycle.status()).toEqual({
      attached: false,
      route: "review",
      issues: ["STARTUP_FAILED"],
    });
    lifecycle.dispose();
  });

  it("reports a detection failure as a recognized route without claiming attachment", () => {
    const lifecycle = startContentLifecycle({
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
      attached: false,
      route: "review",
      issues: ["DETECTION_FAILED"],
    });
    lifecycle.dispose();
  });
});
