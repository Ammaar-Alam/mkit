import { describe, expect, it } from "vitest";
import { INITIAL_REVIEW_STATE, reduceReviewState } from "../../../src/core/state";

describe("review state", () => {
  it("keeps protection, session, and reveal state independent", () => {
    const masked = reduceReviewState(INITIAL_REVIEW_STATE, { type: "MASK_VERIFIED" });
    const practice = reduceReviewState(masked, { type: "START_PRACTICE" });
    const selected = reduceReviewState(practice, { type: "SELECT", selection: "B" });
    const checked = reduceReviewState(selected, { type: "CHECK" });
    const feedback = reduceReviewState(checked, { type: "REVEAL_FEEDBACK" });
    const original = reduceReviewState(feedback, { type: "REVEAL_ORIGINAL" });

    expect(original).toEqual({
      protection: "MASKED",
      session: "PRACTICE_ACTIVE",
      reveal: "ORIGINAL",
      selection: "B",
    });
  });

  it("keeps Practice outcome separate from native answer feedback", () => {
    const checked = reduceReviewState(
      {
        protection: "MASKED",
        session: "PRACTICE_ACTIVE",
        reveal: "CONCEALED",
        selection: "A",
      },
      { type: "CHECK" },
    );

    expect(checked.reveal).toBe("OUTCOME");
    expect(reduceReviewState(checked, { type: "REVEAL_FEEDBACK" }).reveal).toBe("FEEDBACK");
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
    expect(() => reduceReviewState(state, { type: "REVEAL_FEEDBACK" })).toThrow(
      "Answers are available",
    );
  });

  it("keeps Test feedback concealed until the Test is finished", () => {
    const active = {
      protection: "MASKED" as const,
      session: "TEST_ACTIVE" as const,
      reveal: "CONCEALED" as const,
      selection: "C" as const,
    };

    expect(() => reduceReviewState(active, { type: "REVEAL_FEEDBACK" })).toThrow(
      "Answers are available",
    );
    const finished = reduceReviewState(active, { type: "FINISH_TEST" });
    expect(finished.reveal).toBe("CONCEALED");
    expect(reduceReviewState(finished, { type: "REVEAL_FEEDBACK" }).reveal).toBe("FEEDBACK");
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
