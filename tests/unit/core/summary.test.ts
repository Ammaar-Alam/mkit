import { describe, expect, it } from "vitest";
import { summarizeSession } from "../../../src/core/summary";
import type { AttemptRecord, SessionRecord } from "../../../src/storage/schema";

const session: SessionRecord = {
  id: "session-1",
  examKey: "exam-guard",
  mode: "test",
  status: "finished",
  startedAt: 100,
  updatedAt: 1_000,
  currentQuestionKey: "q4",
  completedAt: 1_000,
  finishedSections: ["cp", "cars"],
};

describe("session summaries", () => {
  it("reports only factual counts, breakdowns, categories, and timing", () => {
    const attempts: AttemptRecord[] = [
      attempt({ questionKey: "q1", outcome: "correct", durationMs: 1_000 }),
      attempt({
        questionKey: "q2",
        outcome: "needs-review",
        durationMs: 2_000,
        categoryCode: "1A",
        confidence: "guessing",
        flagged: true,
      }),
      attempt({
        questionKey: "q3",
        sectionKey: "cars",
        passageOrDiscrete: "discrete",
        outcome: "unknown",
        durationMs: 9_000,
        reviewAgain: true,
      }),
      attempt({
        questionKey: "q4",
        sectionKey: "cars",
        passageOrDiscrete: "discrete",
        selection: null,
        outcome: "unknown",
        durationMs: 0,
      }),
    ];

    const summary = summarizeSession(session, attempts);
    const cpSummary = summary.bySection.cp;
    const carsSummary = summary.bySection.cars;
    if (!cpSummary || !carsSummary) {
      throw new Error("Expected CP and CARS section summaries.");
    }

    expect(summary.counts).toMatchObject({
      correct: 1,
      needsReview: 1,
      unknown: 1,
      unanswered: 1,
      flagged: 1,
      reviewAgain: 1,
    });
    expect(cpSummary.needsReview).toBe(1);
    expect(carsSummary.unanswered).toBe(1);
    expect(summary.byQuestionType.discrete.unknown).toBe(1);
    expect(summary.categoryNeedsReview).toEqual({ "1A": 1 });
    expect(summary.timing.averageMs).toBe(4_000);
    expect(summary.timing.outliers).toEqual([{ questionKey: "q3", durationMs: 9_000 }]);
    expect(JSON.stringify(summary)).not.toMatch(/score|percentile|mastery|readiness/i);
  });

  it("excludes tombstoned attempts and other sessions", () => {
    const attempts = [
      attempt({ questionKey: "active", outcome: "correct" }),
      attempt({ questionKey: "deleted", outcome: "needs-review", deletedAt: 400 }),
      attempt({ sessionId: "other", questionKey: "other", outcome: "needs-review" }),
    ];

    expect(summarizeSession(session, attempts).counts.correct).toBe(1);
    expect(summarizeSession(session, attempts).counts.needsReview).toBe(0);
  });
});

function attempt(overrides: Partial<AttemptRecord>): AttemptRecord {
  return {
    sessionId: "session-1",
    questionKey: "q1",
    selection: "A",
    eliminations: [],
    confidence: "confident",
    flagged: false,
    reviewAgain: false,
    tags: [],
    outcome: "unknown",
    categoryCode: null,
    sectionKey: "cp",
    passageOrDiscrete: "passage",
    durationMs: 1_000,
    updatedAt: 300,
    ...overrides,
  };
}
