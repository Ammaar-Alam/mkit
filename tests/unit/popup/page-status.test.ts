import { describe, expect, it } from "vitest";
import { getPopupPageState, reconcilePopupPageState } from "../../../src/popup/page-status";

describe("popup page status", () => {
  it("reports a running Fresh Attempt only when the content script confirms it", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({ state: "active", route: "review", issues: [] }),
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
          state: "supported-not-running",
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
        getContentStatus: async () => ({
          state: "supported-not-running",
          route: "review",
          issues: [],
        }),
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
        getContentStatus: async () => ({ state: "unsupported", route: "non-review", issues: [] }),
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
        getContentStatus: async () => ({ state: "active", route: "review", issues: [] }),
      }),
    ).resolves.toEqual({
      status: "unsupported",
      detail: "Open a completed review to use Fresh Attempt.",
    });
  });

  it("reports intentional Normal review without claiming that Fresh Attempt is running", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({
          state: "normal-review",
          route: "review",
          issues: [],
        }),
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "Normal review is open on this page.",
    });
  });

  it("reports the explicit off state", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({
          state: "disabled",
          route: "review",
          issues: [],
        }),
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "MKit is turned off.",
    });
  });

  it("reports protected and intentionally visible section result lists", async () => {
    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({
          state: "active",
          route: "section-overview",
          issues: [],
        }),
      }),
    ).resolves.toEqual({
      status: "active",
      detail: "Section result marks are hidden.",
      surface: "section-overview",
    });

    await expect(
      getPopupPageState({
        getActiveTab: async () => ({ id: 7 }),
        getContentStatus: async () => ({
          state: "supported-not-running",
          route: "section-overview",
          issues: [],
        }),
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "Section result marks are visible.",
      surface: "section-overview",
    });
  });

  it("asks the active content lifecycle to reconcile immediately after the master switch changes", async () => {
    const reconciledTabs: number[] = [];
    await expect(
      reconcilePopupPageState({
        getActiveTab: async () => ({ id: 19 }),
        reconcileContent: async (tabId) => {
          reconciledTabs.push(tabId);
          return { state: "disabled", route: "review", issues: [] };
        },
      }),
    ).resolves.toEqual({
      status: "supported-not-running",
      detail: "MKit is turned off.",
    });
    expect(reconciledTabs).toEqual([19]);
  });
});
