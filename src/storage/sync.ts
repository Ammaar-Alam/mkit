import {
  assertAttempt,
  assertScoreReveal,
  assertSession,
  decodeAttempt,
  decodeScoreReveal,
  decodeSession,
  decodeSessionTombstone,
  decodeSettings,
} from "./codec";
import {
  type AttemptRecord,
  attemptKey,
  type MKitStore,
  type ScoreRevealRecord,
  type SessionRecord,
  type SessionTombstone,
  type SettingsRecord,
  STORE_SCHEMA_VERSION,
} from "./types";

export const SYNC_PREFIX = `mkit.sync.v${STORE_SCHEMA_VERSION}.`;
export const SYNC_META_KEY = `${SYNC_PREFIX}meta`;
export const SYNC_ITEM_MAX_BYTES = 7_000;
export const SYNC_TOTAL_MAX_BYTES = 90_000;

type SyncKind = "session-tombstones" | "sessions" | "attempts" | "score-reveals";
type SyncRecord = SessionTombstone | SessionRecord | SyncAttemptRecord | ScoreRevealRecord;

export interface SyncAttemptRecord extends AttemptRecord {
  noteOmitted?: true;
}

interface SyncEnvelope {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  kind: SyncKind;
  records: SyncRecord[];
}

interface SyncMeta {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  settings: SettingsRecord;
}

export interface SyncSnapshot {
  items: Record<string, unknown>;
  totalBytes: number;
  omittedNoteKeys: string[];
  omittedRecordKeys: string[];
}

export interface DecodedSyncSnapshot {
  settings?: SettingsRecord;
  sessions: SessionRecord[];
  sessionTombstones: SessionTombstone[];
  attempts: SyncAttemptRecord[];
  scoreReveals: ScoreRevealRecord[];
  omittedNoteKeys: string[];
}

interface PackedItem {
  key: string;
  value: SyncEnvelope;
  recordKeys: string[];
}

interface CandidateSnapshot {
  items: PackedItem[];
  omittedNoteKeys: Set<string>;
  oversizedRecordKeys: string[];
}

export function buildSyncSnapshot(store: MKitStore): SyncSnapshot {
  const meta: SyncMeta = {
    schemaVersion: STORE_SCHEMA_VERSION,
    settings: decodeSettings(store.settings) ?? { ...store.settings },
  };
  const metaBytes = storageItemBytes(SYNC_META_KEY, meta);
  if (metaBytes >= SYNC_ITEM_MAX_BYTES || metaBytes > SYNC_TOTAL_MAX_BYTES) {
    throw new Error("Sanitized settings exceed the browser sync budget");
  }

  let candidate = buildCandidate(store, true);
  if (metaBytes + sumItemBytes(candidate.items) > SYNC_TOTAL_MAX_BYTES) {
    candidate = buildCandidate(store, false);
  }

  const items: Record<string, unknown> = { [SYNC_META_KEY]: meta };
  const omittedRecordKeys = [...candidate.oversizedRecordKeys];
  let totalBytes = metaBytes;
  for (const item of candidate.items) {
    const bytes = storageItemBytes(item.key, item.value);
    if (totalBytes + bytes > SYNC_TOTAL_MAX_BYTES) {
      omittedRecordKeys.push(...item.recordKeys);
      continue;
    }
    items[item.key] = item.value;
    totalBytes += bytes;
  }

  return {
    items,
    totalBytes,
    omittedNoteKeys: [...candidate.omittedNoteKeys].sort((left, right) =>
      left.localeCompare(right),
    ),
    omittedRecordKeys: [...new Set(omittedRecordKeys)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function decodeSyncSnapshot(items: Record<string, unknown>): DecodedSyncSnapshot {
  const result: DecodedSyncSnapshot = {
    sessions: [],
    sessionTombstones: [],
    attempts: [],
    scoreReveals: [],
    omittedNoteKeys: [],
  };
  const metaValue = items[SYNC_META_KEY];
  if (isRecord(metaValue) && metaValue.schemaVersion === STORE_SCHEMA_VERSION) {
    const settings = decodeSettings(metaValue.settings);
    if (settings !== undefined) {
      result.settings = settings;
    }
  }

  for (const [key, value] of Object.entries(items).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (key === SYNC_META_KEY || !key.startsWith(SYNC_PREFIX) || !isEnvelope(value)) {
      continue;
    }
    if (value.kind === "session-tombstones") {
      pushDecoded(value.records, decodeSessionTombstone, result.sessionTombstones);
    } else if (value.kind === "sessions") {
      pushDecoded(value.records, decodeSession, result.sessions);
    } else if (value.kind === "attempts") {
      for (const raw of value.records) {
        const decoded = decodeAttempt(raw);
        if (decoded === undefined) {
          continue;
        }
        const syncAttempt: SyncAttemptRecord = decoded;
        if (isRecord(raw) && raw.noteOmitted === true) {
          delete syncAttempt.note;
          syncAttempt.noteOmitted = true;
          result.omittedNoteKeys.push(attemptKey(syncAttempt));
        }
        result.attempts.push(syncAttempt);
      }
    } else {
      pushDecoded(value.records, decodeScoreReveal, result.scoreReveals);
    }
  }
  result.omittedNoteKeys = [...new Set(result.omittedNoteKeys)].sort((left, right) =>
    left.localeCompare(right),
  );
  return result;
}

export function storageItemBytes(key: string, value: unknown): number {
  return utf8Bytes(key) + utf8Bytes(JSON.stringify(value));
}

export function syncSnapshotBytes(items: Record<string, unknown>): number {
  return Object.entries(items).reduce(
    (total, [key, value]) => total + storageItemBytes(key, value),
    0,
  );
}

function buildCandidate(store: MKitStore, includeNotes: boolean): CandidateSnapshot {
  const omittedNoteKeys = new Set<string>();
  const previouslyOmittedNotes = new Set(store.syncState.localOnlyNoteKeys);
  const attempts = store.attempts.map((record) => {
    const safe = assertAttempt(record) as SyncAttemptRecord;
    if (safe.note !== undefined && !includeNotes) {
      delete safe.note;
      safe.noteOmitted = true;
      omittedNoteKeys.add(attemptKey(safe));
    } else if (safe.note === undefined && previouslyOmittedNotes.has(attemptKey(safe))) {
      safe.noteOmitted = true;
      omittedNoteKeys.add(attemptKey(safe));
    }
    return safe;
  });

  const groups: Array<[SyncKind, SyncRecord[]]> = [
    [
      "session-tombstones",
      store.sessionTombstones
        .map((record) => decodeSessionTombstone(record))
        .filter((record): record is SessionTombstone => record !== undefined),
    ],
    ["sessions", store.sessions.map(assertSession)],
    ["attempts", attempts],
    ["score-reveals", store.scoreReveals.map(assertScoreReveal)],
  ];
  const items: PackedItem[] = [];
  const oversizedRecordKeys: string[] = [];
  for (const [kind, records] of groups) {
    const packed = packRecords(kind, records, omittedNoteKeys);
    items.push(...packed.items);
    oversizedRecordKeys.push(...packed.oversizedRecordKeys);
  }
  return { items, omittedNoteKeys, oversizedRecordKeys };
}

function packRecords(
  kind: SyncKind,
  unsortedRecords: SyncRecord[],
  omittedNoteKeys: Set<string>,
): { items: PackedItem[]; oversizedRecordKeys: string[] } {
  const records = [...unsortedRecords].sort((left, right) =>
    recordKey(kind, left).localeCompare(recordKey(kind, right)),
  );
  const items: PackedItem[] = [];
  const oversizedRecordKeys: string[] = [];
  let currentRecords: SyncRecord[] = [];
  let currentRecordKeys: string[] = [];

  const finalize = (): void => {
    if (currentRecords.length === 0) {
      return;
    }
    const index = items.length.toString().padStart(4, "0");
    const key = `${SYNC_PREFIX}${kind}.${index}`;
    items.push({
      key,
      value: {
        schemaVersion: STORE_SCHEMA_VERSION,
        kind,
        records: currentRecords,
      },
      recordKeys: currentRecordKeys,
    });
    currentRecords = [];
    currentRecordKeys = [];
  };

  for (const input of records) {
    let record = input;
    const identity = recordKey(kind, record);
    let key = `${SYNC_PREFIX}${kind}.${items.length.toString().padStart(4, "0")}`;
    let envelope: SyncEnvelope = {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind,
      records: [...currentRecords, record],
    };
    if (storageItemBytes(key, envelope) >= SYNC_ITEM_MAX_BYTES && currentRecords.length > 0) {
      finalize();
      key = `${SYNC_PREFIX}${kind}.${items.length.toString().padStart(4, "0")}`;
      envelope = {
        schemaVersion: STORE_SCHEMA_VERSION,
        kind,
        records: [record],
      };
    }
    if (storageItemBytes(key, envelope) >= SYNC_ITEM_MAX_BYTES && isSyncAttempt(record)) {
      if (record.note !== undefined) {
        const noteOmittedRecord: SyncAttemptRecord = { ...record, noteOmitted: true };
        delete noteOmittedRecord.note;
        record = noteOmittedRecord;
        omittedNoteKeys.add(attemptKey(noteOmittedRecord));
        envelope = {
          schemaVersion: STORE_SCHEMA_VERSION,
          kind,
          records: [record],
        };
      }
    }
    if (storageItemBytes(key, envelope) >= SYNC_ITEM_MAX_BYTES) {
      oversizedRecordKeys.push(identity);
      continue;
    }
    currentRecords.push(record);
    currentRecordKeys.push(identity);
  }
  finalize();
  return { items, oversizedRecordKeys };
}

function sumItemBytes(items: PackedItem[]): number {
  return items.reduce((total, item) => total + storageItemBytes(item.key, item.value), 0);
}

function recordKey(kind: SyncKind, record: SyncRecord): string {
  if (kind === "session-tombstones") {
    return `session:${(record as SessionTombstone).sessionId}`;
  }
  if (kind === "sessions") {
    return `session:${(record as SessionRecord).id}`;
  }
  if (kind === "attempts") {
    return `attempt:${attemptKey(record as AttemptRecord)}`;
  }
  return `score:${(record as ScoreRevealRecord).examKey}`;
}

function isSyncAttempt(value: SyncRecord): value is SyncAttemptRecord {
  return "questionKey" in value && "sessionId" in value;
}

function isEnvelope(value: unknown): value is SyncEnvelope {
  return (
    isRecord(value) &&
    value.schemaVersion === STORE_SCHEMA_VERSION &&
    (value.kind === "session-tombstones" ||
      value.kind === "sessions" ||
      value.kind === "attempts" ||
      value.kind === "score-reveals") &&
    Array.isArray(value.records)
  );
}

function pushDecoded<T>(
  values: SyncRecord[],
  decode: (value: unknown) => T | undefined,
  destination: T[],
): void {
  for (const value of values) {
    const decoded = decode(value);
    if (decoded !== undefined) {
      destination.push(decoded);
    }
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
