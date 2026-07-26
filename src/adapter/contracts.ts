import type { AnswerChoice, AttemptOutcome, PassageOrDiscrete } from "../storage/schema";

export type PageKind =
  | "review"
  | "score-report"
  | "section-overview"
  | "non-review"
  | "unknown-review";

export type AdapterIssueCode =
  | "QUESTION_REGION_MISSING"
  | "ANSWER_CHOICES_INCOMPLETE"
  | "NAVIGATOR_MISSING"
  | "FEEDBACK_REGION_MISSING"
  | "REVIEW_SWITCH_MISSING"
  | "SCORE_REGION_MISSING"
  | "REVIEW_CONTROL_MISSING"
  | "STABLE_EXAM_ID_MISSING"
  | "STABLE_QUESTION_ID_MISSING"
  | "CHILD_FRAME_UNVERIFIED"
  | "SHADOW_ROOT_UNSUPPORTED";

export interface CapabilityReport {
  pageKind: PageKind;
  safeToReveal: boolean;
  questionRegionFound: boolean;
  answerChoiceCount: number;
  navigatorFound: boolean;
  feedbackRegionFound: boolean;
  explanationFound: boolean;
  correctAnswerParseable: boolean;
  categoryCodeFound: boolean;
  scoreRegionCount: number;
  reviewControlFound: boolean;
  issues: AdapterIssueCode[];
}

export interface SanitizedQuestionContext {
  examKey: string;
  questionKey: string;
  sectionKey: string;
  categoryCode: string | null;
  passageOrDiscrete: PassageOrDiscrete;
  progress: {
    scope: "full-length" | "section" | "unknown";
    current: number | null;
    total: number | null;
  };
}

export type AdapterEvent =
  | { type: "page-change"; pageKind: PageKind }
  | { type: "question-change" }
  | { type: "capability-change"; report: CapabilityReport };

export interface FullLengthReviewAdapter {
  classifyPage(): PageKind;
  inspectCapabilities(): CapabilityReport;
  getExamKey(): Promise<string | null>;
  getQuestionContext(): Promise<SanitizedQuestionContext | null>;
  applyCleanSlate(): CapabilityReport;
  applyScoreShield(): CapabilityReport;
  /** Neutralizes row-level correctness cues on a completed section overview. */
  applySectionOverviewCover(): boolean;
  revealSectionOverview(): void;
  gradeFresh(selection: AnswerChoice): AttemptOutcome;
  revealScores(): void;
  revealFeedback(): void;
  revealOriginalAttempt(): void;
  remaskQuestion(): void;
  restoreNormalReview(): void;
  mountFreshAttemptEntry(host: HTMLElement): boolean;
  mountStudyRail(host: HTMLElement): boolean;
  navigate(direction: "previous" | "next"): boolean;
  observe(listener: (event: AdapterEvent) => void): () => void;
}
