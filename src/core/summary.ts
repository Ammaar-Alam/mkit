import type {
  AttemptRecord,
  Confidence,
  PassageOrDiscrete,
  SessionRecord,
} from "../storage/schema";

export interface CountSummary {
  correct: number;
  needsReview: number;
  unknown: number;
  unanswered: number;
  flagged: number;
  reviewAgain: number;
  confidence: Record<Confidence, number>;
}

export interface TimingSummary {
  totalMs: number;
  averageMs: number;
  outliers: Array<{ questionKey: string; durationMs: number }>;
}

export interface SessionSummary {
  sessionId: string;
  counts: CountSummary;
  bySection: Record<string, CountSummary>;
  byQuestionType: Record<PassageOrDiscrete, CountSummary>;
  timing: TimingSummary;
  timingBySection: Record<string, TimingSummary>;
  categoryNeedsReview: Record<string, number>;
}

export function summarizeSession(
  session: SessionRecord,
  attempts: readonly AttemptRecord[],
): SessionSummary {
  const activeAttempts = attempts.filter(
    (attempt) => attempt.sessionId === session.id && attempt.deletedAt == null,
  );
  const counts = emptyCounts();
  const bySection: Record<string, CountSummary> = {};
  const byQuestionType: Record<PassageOrDiscrete, CountSummary> = {
    passage: emptyCounts(),
    discrete: emptyCounts(),
  };
  const timingBySectionRecords: Record<string, AttemptRecord[]> = {};
  const categoryNeedsReview: Record<string, number> = {};

  for (const attempt of activeAttempts) {
    incrementCounts(counts, attempt);
    let section = bySection[attempt.sectionKey];
    if (!section) {
      section = emptyCounts();
      bySection[attempt.sectionKey] = section;
    }
    incrementCounts(section, attempt);
    incrementCounts(byQuestionType[attempt.passageOrDiscrete], attempt);
    let sectionTimingRecords = timingBySectionRecords[attempt.sectionKey];
    if (!sectionTimingRecords) {
      sectionTimingRecords = [];
      timingBySectionRecords[attempt.sectionKey] = sectionTimingRecords;
    }
    sectionTimingRecords.push(attempt);

    if (attempt.categoryCode && (attempt.outcome === "needs-review" || attempt.reviewAgain)) {
      categoryNeedsReview[attempt.categoryCode] =
        (categoryNeedsReview[attempt.categoryCode] ?? 0) + 1;
    }
  }

  const timingBySection = Object.fromEntries(
    Object.entries(timingBySectionRecords).map(([sectionKey, sectionAttempts]) => [
      sectionKey,
      summarizeTiming(sectionAttempts),
    ]),
  );

  return {
    sessionId: session.id,
    counts,
    bySection,
    byQuestionType,
    timing: summarizeTiming(activeAttempts),
    timingBySection,
    categoryNeedsReview,
  };
}

function emptyCounts(): CountSummary {
  return {
    correct: 0,
    needsReview: 0,
    unknown: 0,
    unanswered: 0,
    flagged: 0,
    reviewAgain: 0,
    confidence: {
      guessing: 0,
      unsure: 0,
      confident: 0,
    },
  };
}

function incrementCounts(counts: CountSummary, attempt: AttemptRecord): void {
  if (!attempt.selection) {
    counts.unanswered += 1;
  } else if (attempt.outcome === "correct") {
    counts.correct += 1;
  } else if (attempt.outcome === "needs-review") {
    counts.needsReview += 1;
  } else {
    counts.unknown += 1;
  }
  if (attempt.flagged) counts.flagged += 1;
  if (attempt.reviewAgain) counts.reviewAgain += 1;
  if (attempt.confidence) counts.confidence[attempt.confidence] += 1;
}

function summarizeTiming(attempts: readonly AttemptRecord[]): TimingSummary {
  const timed = attempts.filter((attempt) => attempt.durationMs > 0);
  const durations = timed.map((attempt) => attempt.durationMs).sort((a, b) => a - b);
  const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageMs = durations.length === 0 ? 0 : Math.round(totalMs / durations.length);
  const median =
    durations.length === 0
      ? 0
      : durations.length % 2 === 1
        ? (durations[Math.floor(durations.length / 2)] ?? 0)
        : Math.round(
            ((durations[durations.length / 2 - 1] ?? 0) + (durations[durations.length / 2] ?? 0)) /
              2,
          );
  const outliers = timed
    .filter((attempt) => median > 0 && attempt.durationMs >= median * 2)
    .map((attempt) => ({
      questionKey: attempt.questionKey,
      durationMs: attempt.durationMs,
    }))
    .sort((left, right) => right.durationMs - left.durationMs);

  return { totalMs, averageMs, outliers };
}
