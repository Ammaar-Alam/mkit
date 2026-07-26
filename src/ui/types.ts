import type {
  AnswerSelection,
  AttemptOutcome,
  AttemptTag,
  Confidence,
  FreshAttemptMode,
} from "../storage/schema";

export type MKitMountTarget = HTMLElement | ShadowRoot;

export interface MKitViewHandle<Props> {
  readonly element: HTMLElement;
  update(props: Props): void;
  focus(): void;
  destroy(): void;
}

export type SectionLabel = "C/P" | "CARS" | "B/B" | "P/S";

export interface FreshProgress {
  scope: "full-length" | "section" | "unknown";
  current: number | null;
  total: number | null;
  section?: SectionLabel;
}

export interface ActiveSessionSummary {
  mode: FreshAttemptMode;
  progress: FreshProgress;
}

export interface CapabilityStatus {
  questionArea: boolean;
  navigator: boolean;
  answerFeedback: boolean;
}

export type GateState = "busy" | "ready" | "conflict" | "unsupported";

export interface GateProps {
  state: GateState;
  activeSession?: ActiveSessionSummary;
  capabilities?: CapabilityStatus;
  encouragementEnabled?: boolean;
  autoFocus?: boolean;
  onSelectMode(mode: FreshAttemptMode): void;
  onResume(): void;
  onArchive(): void;
  onRetryDetection(): void;
  onNormalReview(): void;
}

export type SaveState = "idle" | "saving" | "saved" | "error";
export type StudyRailStage =
  | "masked"
  | "selected"
  | "practice-checked"
  | "practice-revealed"
  | "original-revealed"
  | "test-active"
  | "test-finished";

export interface StudyRailProps {
  mode: FreshAttemptMode;
  stage: StudyRailStage;
  progress: FreshProgress;
  selection: AnswerSelection | null;
  eliminations: readonly AnswerSelection[];
  confidence: Confidence | null;
  flagged: boolean;
  reviewAgain: boolean;
  outcome: AttemptOutcome | null;
  saveState: SaveState;
  answersRevealed: boolean;
  note: string;
  tags: readonly AttemptTag[];
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  finishScope?: "section" | "attempt";
  finishConfirmationOpen?: boolean;
  encouragement?: "pause" | "section" | "complete";
  onSelect(choice: AnswerSelection): void;
  onToggleElimination(choice: AnswerSelection): void;
  onConfidenceChange(confidence: Confidence | null): void;
  onFlagChange(flagged: boolean): void;
  onReviewAgainChange(reviewAgain: boolean): void;
  onCheck(): void;
  onRevealAnswers(): void;
  onRevealOriginal(): void;
  onRetry(): void;
  onFinishRequest(): void;
  onFinishConfirm(): void;
  onFinishCancel(): void;
  onNavigate(direction: "previous" | "next"): void;
  onNoteChange(note: string): void;
  onTagsChange(tags: readonly AttemptTag[]): void;
}

export type ScoreShieldState = "shielded" | "unsupported";

export interface ScoreShieldProps {
  state: ScoreShieldState;
  showFreshAttemptAction?: boolean;
  onReveal(): void;
  onFreshAttempt(): void;
}

export interface SummaryCounts {
  correct: number;
  needsReview: number;
  unknown: number;
  unanswered: number;
  flagged: number;
  reviewAgain: number;
  confidence: Record<Confidence, number>;
}

export interface SummaryTiming {
  averageMs: number;
  outlierCount: number;
}

export interface SectionSummary {
  section: SectionLabel;
  counts: SummaryCounts;
  timing: SummaryTiming;
}

export interface CategorySummary {
  code: string;
  needsReview: number;
}

export interface SummaryProps {
  counts: SummaryCounts;
  sections: readonly SectionSummary[];
  questionTypes: {
    passage: SummaryCounts;
    discrete: SummaryCounts;
  };
  timing: SummaryTiming;
  categories: readonly CategorySummary[];
  encouragementEnabled?: boolean;
  autoFocus?: boolean;
  onClose?(): void;
}
