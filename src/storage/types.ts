export const STORE_SCHEMA_VERSION = 2 as const;

export type FreshAttemptMode = "practice" | "test";
export type AiHandoffTarget = "chatgpt" | "claude";
export type SessionStatus = "active" | "archived" | "finished";
export type AnswerSelection = "A" | "B" | "C" | "D";
export type Confidence = "guessing" | "unsure" | "confident";
export type AttemptTag = "content gap" | "reasoning" | "misread" | "timing";
export type AttemptOutcome = "correct" | "needs-review" | "unknown";
export type QuestionKind = "passage" | "discrete";

export interface SettingsRecord {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  enabled: boolean;
  defaultMode: FreshAttemptMode;
  encouragementEnabled: boolean;
  scoreShieldEnabled: boolean;
  clearPreviousHighlightsEnabled: boolean;
  clearPreviousCrossOutsEnabled: boolean;
  hideSectionResultMarksEnabled: boolean;
  showInitialCorrectnessEnabled: boolean;
  timerDisplayEnabled: false;
  syncEnabled: boolean;
  aiHandoffTarget?: AiHandoffTarget;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  examKey: string;
  mode: FreshAttemptMode;
  status: SessionStatus;
  startedAt: number;
  updatedAt: number;
  currentQuestionKey: string | null;
  completedAt: number | null;
  finishedSections: string[];
}

export interface SessionTombstone {
  sessionId: string;
  updatedAt: number;
}

export interface AttemptRecord {
  sessionId: string;
  questionKey: string;
  selection: AnswerSelection | null;
  eliminations: AnswerSelection[];
  confidence: Confidence | null;
  flagged: boolean;
  reviewAgain: boolean;
  note?: string;
  noteUpdatedAt?: number;
  tags: AttemptTag[];
  outcome: AttemptOutcome;
  categoryCode: string | null;
  sectionKey: string;
  passageOrDiscrete: QuestionKind;
  durationMs: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ScoreRevealRecord {
  examKey: string;
  revealed: boolean;
  updatedAt: number;
  deletedAt?: number;
}

export interface DebugLogRecord {
  id: string;
  event: string;
  occurredAt: number;
  facts: Record<string, boolean | number | null>;
}

export type SyncErrorCode = "sync-read-failed" | "sync-write-failed";

export interface SyncStateRecord {
  dirty: boolean;
  someNotesLocalOnly: boolean;
  localOnlyNoteKeys: string[];
  localOnlyRecordKeys: string[];
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: SyncErrorCode;
}

export interface MKitStore {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  settings: SettingsRecord;
  sessions: SessionRecord[];
  sessionTombstones: SessionTombstone[];
  attempts: AttemptRecord[];
  scoreReveals: ScoreRevealRecord[];
  debugLog: DebugLogRecord[];
  syncState: SyncStateRecord;
}

export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageRepositoryOptions {
  local: StorageAreaLike;
  sync?: StorageAreaLike;
  now?: () => number;
  debugLogLimit?: number;
  syncMinIntervalMs?: number;
  delay?: (durationMs: number) => Promise<void>;
}

export interface SyncStatus {
  enabled: boolean;
  dirty: boolean;
  someNotesLocalOnly: boolean;
  localOnlyNoteKeys: string[];
  localOnlyRecordKeys: string[];
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: SyncErrorCode;
}

export function attemptKey(record: Pick<AttemptRecord, "sessionId" | "questionKey">): string {
  return `${record.sessionId.length}:${record.sessionId}${record.questionKey}`;
}
