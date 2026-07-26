import { describe, expect, it } from "vitest";
import { INITIAL_REVIEW_STATE, reduceReviewState } from "../../../src/core/state";

describe("review state", () => {
  it("keeps protection, session, and reveal state independent", () => {
    const masked = reduceReviewState(INITIAL_REVIEW_STATE, { type: "MASK_VERIFIED" });
    const practice = reduceReviewState(masked, { type: "START_PRACTICE" });
    const selected = reduceReviewState(practice, { type: "SELECT", selection: "B" });
    const checked = reduceReviewState(selected, { type: "CHECK" });
    const original = reduceReviewState(checked, { type: "REVEAL_ORIGINAL" });

    expect(original).toEqual({
      protection: "MASKED",
      session: "PRACTICE_ACTIVE",
      reveal: "ORIGINAL",
      selection: "B",
    });
  });

  it("remasks and clears only the fresh selection on Retry", () => {
    const state = {
      protection: "MASKED" as const,
      session: "PRACTICE_ACTIVE" as const,
      reveal: "FEEDBACK" as const,
      selection: "D" as const,
    };

    expect(reduceReviewState(state, { type: "RETRY" })).toEqual({
      ...state,
      reveal: "CONCEALED",
      selection: null,
    });
  });

  it("rejects feedback before a Practice selection", () => {
    const state = {
      protection: "MASKED" as const,
      session: "PRACTICE_ACTIVE" as const,
      reveal: "CONCEALED" as const,
      selection: null,
    };

    expect(() => reduceReviewState(state, { type: "CHECK" })).toThrow("Practice Check requires");
  });

  it("allows an active concealed answer to be explicitly cleared", () => {
    const state = {
      protection: "MASKED" as const,
      session: "PRACTICE_ACTIVE" as const,
      reveal: "CONCEALED" as const,
      selection: "A" as const,
    };

    expect(reduceReviewState(state, { type: "SELECT", selection: null })).toEqual({
      ...state,
      selection: null,
    });
  });

  it("keeps unsupported and Normal review explicit", () => {
    const unsupported = reduceReviewState(INITIAL_REVIEW_STATE, {
      type: "MASK_UNSUPPORTED",
    });
    const normal = reduceReviewState(unsupported, { type: "NORMAL_REVIEW" });

    expect(unsupported.protection).toBe("UNSUPPORTED");
    expect(normal).toEqual({
      ...INITIAL_REVIEW_STATE,
      protection: "NORMAL_REVIEW",
    });
  });
});
