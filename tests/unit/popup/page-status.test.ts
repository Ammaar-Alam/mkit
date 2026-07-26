import { describe, expect, it } from "vitest";
import { getPopupPageState } from "../../../src/popup/page-status";

describe("popup page status", () => {
  it("reports a running Fresh Attempt only when the content script confirms it", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({ attached: true, route: "review", issues: [] }),
      }),
    ).resolves.toEqual({
      status: "active",
      detail: "Fresh Attempt is ready on this review.",
    });
  });

  it("distinguishes a recognized review that has not armed protection", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({
          attached: false,
          route: "incomplete-review",
          issues: ["REVIEW_SWITCH_MISSING"],
        }),
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "This review is still loading or its layout could not be verified.",
      issues: ["REVIEW_SWITCH_MISSING"],
    });
  });

  it("stays honest when a verified review route never armed protection", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({ attached: false, route: "review", issues: [] }),
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "This review is still loading or its layout could not be verified.",
    });
  });

  it("claims no support when the content script reports a non-review route", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({ attached: false, route: "non-review", issues: [] }),
      }),
    ).resolves.toEqual({
      status: "unsupported",
      detail: "Open a completed review to use Fresh Attempt.",
    });
  });

  it("claims no support when no content script answers", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => {
          throw new Error("No receiver");
        },
      }),
    ).resolves.toEqual({
      status: "unsupported",
      detail: "Open a completed review to use Fresh Attempt.",
    });
  });

  it("claims no support when the active tab has no addressable id", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({}),
        getContentStatus: async () => ({ attached: true, route: "review", issues: [] }),
      }),
    ).resolves.toEqual({
      status: "unsupported",
      detail: "Open a completed review to use Fresh Attempt.",
    });
  });
});
