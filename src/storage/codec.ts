import {
  type AiHandoffTarget,
  type AnswerSelection,
  type AttemptRecord,
  type AttemptTag,
  type DebugLogRecord,
  type MKitStore,
  type ScoreRevealRecord,
  type SessionRecord,
  type SessionTombstone,
  type SettingsRecord,
  STORE_SCHEMA_VERSION,
  type SyncStateRecord,
} from "./types";

const ANSWERS = ["A", "B", "C", "D"] as const;
const TAGS = ["content gap", "reasoning", "misread", "timing"] as const;
const MAX_KEY_LENGTH = 256;
const MAX_STORAGE_IDENTITY_LENGTH = MAX_KEY_LENGTH * 2 + 32;
const MAX_NOTE_LENGTH = 20_000;
const MAX_DEBUG_FACTS = 24;

export const DEFAULT_SETTINGS: SettingsRecord = {
  schemaVersion: STORE_SCHEMA_VERSION,
  enabled: true,
  defaultMode: "practice",
  encouragementEnabled: true,
  scoreShieldEnabled: true,
  clearPreviousHighlightsEnabled: true,
  clearPreviousCrossOutsEnabled: true,
  hideSectionResultMarksEnabled: true,
  timerDisplayEnabled: false,
  syncEnabled: false,
  updatedAt: 0,
};

export const DEFAULT_SYNC_STATE: SyncStateRecord = {
  dirty: false,
  someNotesLocalOnly: false,
  localOnlyNoteKeys: [],
  localOnlyRecordKeys: [],
};

export function createDefaultStore(): MKitStore {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    sessionTombstones: [],
    attempts: [],
    scoreReveals: [],
    debugLog: [],
    syncState: { ...DEFAULT_SYNC_STATE },
  };
}

export function decodeSettings(value: unknown): SettingsRecord | undefined {
  if (!isRecord(value) || value.schemaVersion !== STORE_SCHEMA_VERSION) {
    return undefined;
  }
  if (
    typeof value.enabled !== "boolean" ||
    (value.defaultMode !== "practice" && value.defaultMode !== "test") ||
    typeof value.encouragementEnabled !== "boolean" ||
    typeof value.scoreShieldEnabled !== "boolean" ||
    (value.clearPreviousHighlightsEnabled !== undefined &&
      typeof value.clearPreviousHighlightsEnabled !== "boolean") ||
    (value.clearPreviousCrossOutsEnabled !== undefined &&
      typeof value.clearPreviousCrossOutsEnabled !== "boolean") ||
    (value.hideSectionResultMarksEnabled !== undefined &&
      typeof value.hideSectionResultMarksEnabled !== "boolean") ||
    value.timerDisplayEnabled !== false ||
    typeof value.syncEnabled !== "boolean" ||
    (value.aiHandoffTarget !== undefined && !isAiHandoffTarget(value.aiHandoffTarget)) ||
    !isTimestamp(value.updatedAt)
  ) {
    return undefined;
  }
  const result: SettingsRecord = {
    schemaVersion: STORE_SCHEMA_VERSION,
    enabled: value.enabled,
    defaultMode: value.defaultMode,
    encouragementEnabled: value.encouragementEnabled,
    scoreShieldEnabled: value.scoreShieldEnabled,
    clearPreviousHighlightsEnabled: value.clearPreviousHighlightsEnabled ?? true,
    clearPreviousCrossOutsEnabled: value.clearPreviousCrossOutsEnabled ?? true,
    hideSectionResultMarksEnabled: value.hideSectionResultMarksEnabled ?? true,
    timerDisplayEnabled: false,
    syncEnabled: value.syncEnabled,
    updatedAt: value.updatedAt,
  };
  if (value.aiHandoffTarget !== undefined) {
    result.aiHandoffTarget = value.aiHandoffTarget;
  }
  return result;
}

export function migrateLegacySettings(value: unknown, now: number): SettingsRecord | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return undefined;
  }
  if (
    typeof value.enabled !== "boolean" ||
    (value.defaultMode !== "practice" && value.defaultMode !== "test") ||
    typeof value.encouragementEnabled !== "boolean" ||
    typeof value.scoreShieldEnabled !== "boolean" ||
    value.timerDisplayEnabled !== false ||
    typeof value.syncEnabled !== "boolean"
  ) {
    return undefined;
  }
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    enabled: value.enabled,
    defaultMode: value.defaultMode,
    encouragementEnabled: value.encouragementEnabled,
    scoreShieldEnabled: value.scoreShieldEnabled,
    clearPreviousHighlightsEnabled:
      typeof value.clearPreviousHighlightsEnabled === "boolean"
        ? value.clearPreviousHighlightsEnabled
        : true,
    clearPreviousCrossOutsEnabled:
      typeof value.clearPreviousCrossOutsEnabled === "boolean"
        ? value.clearPreviousCrossOutsEnabled
        : true,
    hideSectionResultMarksEnabled:
      typeof value.hideSectionResultMarksEnabled === "boolean"
        ? value.hideSectionResultMarksEnabled
        : true,
    timerDisplayEnabled: false,
    syncEnabled: value.syncEnabled,
    updatedAt: isTimestamp(value.updatedAt) ? value.updatedAt : now,
  };
}

export function decodeSession(value: unknown): SessionRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = decodeOpaqueKey(value.id);
  const examKey = decodeOpaqueKey(value.examKey);
  const currentQuestionKey =
    value.currentQuestionKey === null ? null : decodeOpaqueKey(value.currentQuestionKey);
  const completedAt = value.completedAt === null ? null : decodeTimestamp(value.completedAt);
  const finishedSections = decodeKeyArray(value.finishedSections);
  if (
    id === undefined ||
    examKey === undefined ||
    (value.mode !== "practice" && value.mode !== "test") ||
    (value.status !== "active" && value.status !== "archived" && value.status !== "finished") ||
    !isTimestamp(value.startedAt) ||
    !isTimestamp(value.updatedAt) ||
    currentQuestionKey === undefined ||
    completedAt === undefined ||
    finishedSections === undefined
  ) {
    return undefined;
  }
  return {
    id,
    examKey,
    mode: value.mode,
    status: value.status,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    currentQuestionKey,
    completedAt,
    finishedSections,
  };
}

export function decodeSessionTombstone(value: unknown): SessionTombstone | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sessionId = decodeOpaqueKey(value.sessionId);
  if (sessionId === undefined || !isTimestamp(value.updatedAt)) {
    return undefined;
  }
  return { sessionId, updatedAt: value.updatedAt };
}

export function decodeAttempt(value: unknown): AttemptRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sessionId = decodeOpaqueKey(value.sessionId);
  const questionKey = decodeOpaqueKey(value.questionKey);
  const selection = value.selection === null ? null : decodeAnswer(value.selection);
  const eliminations = decodeAnswers(value.eliminations);
  const confidence =
    value.confidence === null
      ? null
      : value.confidence === "guessing" ||
          value.confidence === "unsure" ||
          value.confidence === "confident"
        ? value.confidence
        : undefined;
  const tags = decodeTags(value.tags);
  const categoryCode = value.categoryCode === null ? null : decodeCategoryCode(value.categoryCode);
  const sectionKey = decodeOpaqueKey(value.sectionKey);
  const deletedAt = value.deletedAt === undefined ? undefined : decodeTimestamp(value.deletedAt);
  const note = value.note === undefined ? undefined : decodeNote(value.note);
  const noteUpdatedAt =
    value.noteUpdatedAt === undefined ? undefined : decodeTimestamp(value.noteUpdatedAt);

  if (
    sessionId === undefined ||
    questionKey === undefined ||
    selection === undefined ||
    eliminations === undefined ||
    confidence === undefined ||
    typeof value.flagged !== "boolean" ||
    typeof value.reviewAgain !== "boolean" ||
    tags === undefined ||
    (value.outcome !== "correct" &&
      value.outcome !== "needs-review" &&
      value.outcome !== "unknown") ||
    categoryCode === undefined ||
    sectionKey === undefined ||
    (value.passageOrDiscrete !== "passage" && value.passageOrDiscrete !== "discrete") ||
    !isNonNegativeInteger(value.durationMs) ||
    !isTimestamp(value.updatedAt) ||
    (deletedAt === undefined && value.deletedAt !== undefined) ||
    (note === undefined && value.note !== undefined) ||
    (noteUpdatedAt === undefined && value.noteUpdatedAt !== undefined)
  ) {
    return undefined;
  }

  const result: AttemptRecord = {
    sessionId,
    questionKey,
    selection,
    eliminations,
    confidence,
    flagged: value.flagged,
    reviewAgain: value.reviewAgain,
    tags,
    outcome: value.outcome,
    categoryCode,
    sectionKey,
    passageOrDiscrete: value.passageOrDiscrete,
    durationMs: value.durationMs,
    updatedAt: value.updatedAt,
  };
  if (note !== undefined) {
    result.note = note;
  }
  if (noteUpdatedAt !== undefined) {
    result.noteUpdatedAt = noteUpdatedAt;
  }
  if (deletedAt !== undefined) {
    result.deletedAt = deletedAt;
  }
  return result;
}

export function decodeScoreReveal(value: unknown): ScoreRevealRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const examKey = decodeOpaqueKey(value.examKey);
  const deletedAt = value.deletedAt === undefined ? undefined : decodeTimestamp(value.deletedAt);
  if (
    examKey === undefined ||
    typeof value.revealed !== "boolean" ||
    !isTimestamp(value.updatedAt) ||
    (deletedAt === undefined && value.deletedAt !== undefined)
  ) {
    return undefined;
  }
  const result: ScoreRevealRecord = {
    examKey,
    revealed: value.revealed,
    updatedAt: value.updatedAt,
  };
  if (deletedAt !== undefined) {
    result.deletedAt = deletedAt;
  }
  return result;
}

export function decodeDebugLog(value: unknown): DebugLogRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = decodeDiagnosticCode(value.id);
  const event = decodeDiagnosticCode(value.event);
  if (
    id === undefined ||
    event === undefined ||
    !isTimestamp(value.occurredAt) ||
    !isRecord(value.facts)
  ) {
    return undefined;
  }
  const facts: Record<string, boolean | number | null> = {};
  const entries = Object.entries(value.facts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_DEBUG_FACTS) {
    return undefined;
  }
  for (const [key, fact] of entries) {
    if (
      decodeDiagnosticFactKey(key) === undefined ||
      (typeof fact !== "boolean" && typeof fact !== "number" && fact !== null) ||
      (typeof fact === "number" && !Number.isFinite(fact))
    ) {
      return undefined;
    }
    facts[key] = fact;
  }
  return { id, event, occurredAt: value.occurredAt, facts };
}

export function decodeSyncState(value: unknown): SyncStateRecord {
  if (!isRecord(value)) {
    return { ...DEFAULT_SYNC_STATE };
  }
  const localOnlyNoteKeys = decodeStorageIdentityArray(value.localOnlyNoteKeys) ?? [];
  const localOnlyRecordKeys = decodeStorageIdentityArray(value.localOnlyRecordKeys) ?? [];
  const result: SyncStateRecord = {
    dirty: typeof value.dirty === "boolean" ? value.dirty : false,
    someNotesLocalOnly:
      typeof value.someNotesLocalOnly === "boolean"
        ? value.someNotesLocalOnly
        : localOnlyNoteKeys.length > 0,
    localOnlyNoteKeys,
    localOnlyRecordKeys,
  };
  if (isTimestamp(value.lastAttemptAt)) {
    result.lastAttemptAt = value.lastAttemptAt;
  }
  if (isTimestamp(value.lastSuccessAt)) {
    result.lastSuccessAt = value.lastSuccessAt;
  }
  if (value.lastErrorCode === "sync-read-failed" || value.lastErrorCode === "sync-write-failed") {
    result.lastErrorCode = value.lastErrorCode;
  }
  return result;
}

export function decodeStore(value: unknown): MKitStore | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.schemaVersion === "number" &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion > STORE_SCHEMA_VERSION
  ) {
    throw new UnsupportedStoreVersionError(value.schemaVersion);
  }
  if (value.schemaVersion !== STORE_SCHEMA_VERSION) {
    return undefined;
  }
  const settings = decodeSettings(value.settings);
  if (settings === undefined) {
    return undefined;
  }
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    settings,
    sessions: decodeArray(value.sessions, decodeSession),
    sessionTombstones: decodeArray(value.sessionTombstones, decodeSessionTombstone),
    attempts: decodeArray(value.attempts, decodeAttempt),
    scoreReveals: decodeArray(value.scoreReveals, decodeScoreReveal),
    debugLog: decodeArray(value.debugLog, decodeDebugLog),
    syncState: decodeSyncState(value.syncState),
  };
}

export function assertSettings(value: unknown): SettingsRecord {
  const decoded = decodeSettings(value);
  if (decoded === undefined) {
    throw new TypeError("Invalid settings record");
  }
  return decoded;
}

export function assertSession(value: unknown): SessionRecord {
  const decoded = decodeSession(value);
  if (decoded === undefined) {
    throw new TypeError("Invalid session record");
  }
  return decoded;
}

export function assertAttempt(value: unknown): AttemptRecord {
  const decoded = decodeAttempt(value);
  if (decoded === undefined) {
    throw new TypeError("Invalid attempt record");
  }
  return decoded;
}

export function assertScoreReveal(value: unknown): ScoreRevealRecord {
  const decoded = decodeScoreReveal(value);
  if (decoded === undefined) {
    throw new TypeError("Invalid score reveal record");
  }
  return decoded;
}

export function assertDebugLog(value: unknown): DebugLogRecord {
  const decoded = decodeDebugLog(value);
  if (decoded === undefined) {
    throw new TypeError("Invalid debug log record");
  }
  return decoded;
}

export class UnsupportedStoreVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`MKit storage schema ${version} is newer than this build supports`);
    this.name = "UnsupportedStoreVersionError";
    this.version = version;
  }
}

function decodeArray<T>(value: unknown, decoder: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const decoded = decoder(item);
    return decoded === undefined ? [] : [decoded];
  });
}

function decodeOpaqueKey(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_KEY_LENGTH ||
    hasControlCharacter(value)
  ) {
    return undefined;
  }
  return value;
}

function decodeKeyArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const decoded = value.map(decodeOpaqueKey);
  if (decoded.some((item) => item === undefined)) {
    return undefined;
  }
  return [...new Set(decoded as string[])].sort((left, right) => left.localeCompare(right));
}

function decodeStorageIdentityArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const decoded = value.map((item) =>
    typeof item === "string" &&
    item.length > 0 &&
    item.length <= MAX_STORAGE_IDENTITY_LENGTH &&
    !hasControlCharacter(item)
      ? item
      : undefined,
  );
  if (decoded.some((item) => item === undefined)) {
    return undefined;
  }
  return [...new Set(decoded as string[])].sort((left, right) => left.localeCompare(right));
}

function decodeAnswer(value: unknown): AnswerSelection | undefined {
  return ANSWERS.find((answer) => answer === value);
}

function decodeAnswers(value: unknown): AnswerSelection[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const decoded = value.map(decodeAnswer);
  if (decoded.some((answer) => answer === undefined)) {
    return undefined;
  }
  const selected = new Set(decoded as AnswerSelection[]);
  return ANSWERS.filter((answer) => selected.has(answer));
}

function decodeTags(value: unknown): AttemptTag[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.some((tag) => !TAGS.includes(tag as AttemptTag))) {
    return undefined;
  }
  const selected = new Set(value as AttemptTag[]);
  return TAGS.filter((tag) => selected.has(tag));
}

function decodeCategoryCode(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32 ||
    !/^[A-Za-z0-9][A-Za-z0-9 ./&()+-]*$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function decodeNote(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_NOTE_LENGTH ? value : undefined;
}

function decodeDiagnosticCode(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function decodeDiagnosticFactKey(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function decodeTimestamp(value: unknown): number | undefined {
  return isTimestamp(value) ? value : undefined;
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAiHandoffTarget(value: unknown): value is AiHandoffTarget {
  return value === "chatgpt" || value === "claude";
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
