import {
  assertAttempt,
  assertDebugLog,
  assertScoreReveal,
  assertSession,
  createDefaultStore,
  decodeStore,
  migrateLegacySettings,
  UnsupportedStoreVersionError,
} from "./codec";
import {
  buildSyncSnapshot,
  type DecodedSyncSnapshot,
  decodeSyncSnapshot,
  SYNC_PREFIX,
} from "./sync";
import {
  type AttemptRecord,
  attemptKey,
  type DebugLogRecord,
  type MKitStore,
  type ScoreRevealRecord,
  type SessionRecord,
  type SettingsRecord,
  STORE_SCHEMA_VERSION,
  type StorageAreaLike,
  type StorageRepositoryOptions,
  type SyncStateRecord,
  type SyncStatus,
} from "./types";

export const LOCAL_STORE_KEY = `mkit.store.v${STORE_SCHEMA_VERSION}`;
export const LEGACY_SETTINGS_STORAGE_KEY = "mkit.settings.v1";
export const DEFAULT_DEBUG_LOG_LIMIT = 100;
export const DEFAULT_SYNC_MIN_INTERVAL_MS = 600;

type SettingsPatch = Partial<
  Pick<
    SettingsRecord,
    | "enabled"
    | "defaultMode"
    | "encouragementEnabled"
    | "scoreShieldEnabled"
    | "clearPreviousHighlightsEnabled"
    | "clearPreviousCrossOutsEnabled"
    | "hideSectionResultMarksEnabled"
    | "showInitialCorrectnessEnabled"
    | "syncEnabled"
  >
>;

export class StorageRepository {
  private readonly local: StorageAreaLike;
  private readonly sync: StorageAreaLike | undefined;
  private readonly now: () => number;
  private readonly debugLogLimit: number;
  private readonly syncMinIntervalMs: number;
  private readonly delay: (durationMs: number) => Promise<void>;
  private localTail: Promise<void> = Promise.resolve();
  private syncTail: Promise<void> = Promise.resolve();
  private mutationVersion = 0;
  private syncRequested = false;
  private syncDrainActive = false;
  private lastSyncStartedAt: number | undefined;

  constructor(options: StorageRepositoryOptions) {
    this.local = options.local;
    this.sync = options.sync;
    this.now = options.now ?? Date.now;
    this.debugLogLimit = options.debugLogLimit ?? DEFAULT_DEBUG_LOG_LIMIT;
    this.syncMinIntervalMs = options.syncMinIntervalMs ?? DEFAULT_SYNC_MIN_INTERVAL_MS;
    this.delay =
      options.delay ??
      ((durationMs) =>
        new Promise((resolve) => {
          globalThis.setTimeout(resolve, durationMs);
        }));
  }

  async getStore(): Promise<MKitStore> {
    await this.localTail;
    return this.readStoreUnlocked();
  }

  async getSettings(): Promise<SettingsRecord> {
    return { ...(await this.getStore()).settings };
  }

  async writeSettings(patch: SettingsPatch): Promise<SettingsRecord> {
    const affectsSync = Object.keys(patch).some((key) => key !== "enabled");
    const store = await this.mutate((draft) => {
      const current = draft.settings;
      const next: SettingsRecord = {
        schemaVersion: STORE_SCHEMA_VERSION,
        enabled: patch.enabled ?? current.enabled,
        defaultMode: patch.defaultMode ?? current.defaultMode,
        encouragementEnabled: patch.encouragementEnabled ?? current.encouragementEnabled,
        scoreShieldEnabled: patch.scoreShieldEnabled ?? current.scoreShieldEnabled,
        clearPreviousHighlightsEnabled:
          patch.clearPreviousHighlightsEnabled ?? current.clearPreviousHighlightsEnabled,
        clearPreviousCrossOutsEnabled:
          patch.clearPreviousCrossOutsEnabled ?? current.clearPreviousCrossOutsEnabled,
        hideSectionResultMarksEnabled:
          patch.hideSectionResultMarksEnabled ?? current.hideSectionResultMarksEnabled,
        showInitialCorrectnessEnabled:
          patch.showInitialCorrectnessEnabled ?? current.showInitialCorrectnessEnabled,
        timerDisplayEnabled: false,
        syncEnabled: patch.syncEnabled ?? current.syncEnabled,
        updatedAt: affectsSync ? nextTimestamp(current.updatedAt, this.now()) : current.updatedAt,
      };
      if (current.aiHandoffTarget !== undefined) {
        next.aiHandoffTarget = current.aiHandoffTarget;
      }
      draft.settings = next;
    }, affectsSync);
    return { ...store.settings };
  }

  async listSessions(options: { includeDeleted?: boolean } = {}): Promise<SessionRecord[]> {
    const store = await this.getStore();
    const tombstones = new Set(store.sessionTombstones.map((item) => item.sessionId));
    return store.sessions
      .filter((session) => options.includeDeleted || !tombstones.has(session.id))
      .map(cloneSession);
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const store = await this.getStore();
    if (store.sessionTombstones.some((item) => item.sessionId === sessionId)) {
      return undefined;
    }
    const session = store.sessions.find((item) => item.id === sessionId);
    return session === undefined ? undefined : cloneSession(session);
  }

  async saveSession(input: SessionRecord): Promise<SessionRecord> {
    const record = assertSession(input);
    const store = await this.mutate((draft) => {
      const tombstone = draft.sessionTombstones.find((item) => item.sessionId === record.id);
      if (tombstone !== undefined && tombstone.updatedAt >= record.updatedAt) {
        throw new Error("A deleted session ID cannot be reused");
      }
      if (record.status === "active") {
        const conflict = draft.sessions.find(
          (session) =>
            session.id !== record.id &&
            session.examKey === record.examKey &&
            session.mode === record.mode &&
            session.status === "active" &&
            !isSessionDeleted(draft, session.id),
        );
        if (conflict !== undefined) {
          throw new ActiveSessionConflictError(conflict.id);
        }
      }
      draft.sessions = upsertByKey(
        draft.sessions,
        record,
        (session) => session.id,
        pickNewestRecord,
      );
      draft.sessionTombstones = draft.sessionTombstones.filter(
        (item) => item.sessionId !== record.id,
      );
    });
    const saved = store.sessions.find((session) => session.id === record.id);
    if (saved === undefined) {
      throw new Error("Session was not saved");
    }
    return cloneSession(saved);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.mutate((draft) => {
      const existing = draft.sessions.find((session) => session.id === sessionId);
      if (existing === undefined) {
        return;
      }
      const deletedAt = nextTimestamp(
        Math.max(
          existing.updatedAt,
          draft.sessionTombstones.find((item) => item.sessionId === sessionId)?.updatedAt ?? 0,
        ),
        this.now(),
      );
      draft.sessions = draft.sessions.filter((session) => session.id !== sessionId);
      draft.sessionTombstones = upsertByKey(
        draft.sessionTombstones,
        { sessionId, updatedAt: deletedAt },
        (item) => item.sessionId,
        (left, right) => (left.updatedAt >= right.updatedAt ? left : right),
      );
      draft.attempts = draft.attempts.map((attempt) =>
        attempt.sessionId === sessionId ? redactDeletedAttempt(attempt, deletedAt) : attempt,
      );
    });
  }

  async listAttempts(
    sessionId?: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<AttemptRecord[]> {
    const store = await this.getStore();
    return store.attempts
      .filter(
        (attempt) =>
          (sessionId === undefined || attempt.sessionId === sessionId) &&
          (options.includeDeleted || attempt.deletedAt === undefined) &&
          !isSessionDeleted(store, attempt.sessionId),
      )
      .map(cloneAttempt);
  }

  async getAttempt(sessionId: string, questionKey: string): Promise<AttemptRecord | undefined> {
    const store = await this.getStore();
    if (isSessionDeleted(store, sessionId)) {
      return undefined;
    }
    const record = store.attempts.find(
      (attempt) =>
        attempt.sessionId === sessionId &&
        attempt.questionKey === questionKey &&
        attempt.deletedAt === undefined,
    );
    return record === undefined ? undefined : cloneAttempt(record);
  }

  async saveAttempt(input: AttemptRecord): Promise<AttemptRecord> {
    const record = assertAttempt(input);
    const store = await this.mutate((draft) => {
      if (isSessionDeleted(draft, record.sessionId)) {
        throw new Error("Cannot save an attempt for a deleted session");
      }
      draft.attempts = upsertByKey(draft.attempts, record, attemptKey, pickNewestRecord);
    });
    const saved = store.attempts.find((attempt) => attemptKey(attempt) === attemptKey(record));
    if (saved === undefined) {
      throw new Error("Attempt was not saved");
    }
    return cloneAttempt(saved);
  }

  async mutateAttempt(
    sessionId: string,
    questionKey: string,
    update: (current: AttemptRecord) => AttemptRecord,
  ): Promise<AttemptRecord> {
    const store = await this.mutate((draft) => {
      if (isSessionDeleted(draft, sessionId)) {
        throw new Error("Cannot update an attempt for a deleted session");
      }
      const index = draft.attempts.findIndex(
        (attempt) =>
          attempt.sessionId === sessionId &&
          attempt.questionKey === questionKey &&
          attempt.deletedAt === undefined,
      );
      const current = draft.attempts[index];
      if (current === undefined) {
        throw new Error("Cannot update an unknown Fresh Attempt question.");
      }
      const next = assertAttempt(update(cloneAttempt(current)));
      if (next.sessionId !== sessionId || next.questionKey !== questionKey) {
        throw new Error("An attempt mutation cannot change its identity.");
      }
      draft.attempts[index] = next;
    });
    const saved = store.attempts.find(
      (attempt) =>
        attempt.sessionId === sessionId &&
        attempt.questionKey === questionKey &&
        attempt.deletedAt === undefined,
    );
    if (saved === undefined) {
      throw new Error("Attempt mutation was not saved.");
    }
    return cloneAttempt(saved);
  }

  async accumulateDuration(
    sessionId: string,
    questionKey: string,
    additionalDurationMs: number,
  ): Promise<AttemptRecord> {
    if (!Number.isSafeInteger(additionalDurationMs) || additionalDurationMs < 0) {
      throw new TypeError("Duration must be a non-negative integer");
    }
    let updated: AttemptRecord | undefined;
    await this.mutate((draft) => {
      const index = draft.attempts.findIndex(
        (attempt) =>
          attempt.sessionId === sessionId &&
          attempt.questionKey === questionKey &&
          attempt.deletedAt === undefined,
      );
      const current = draft.attempts[index];
      if (current === undefined) {
        throw new Error("Cannot accumulate time for an unknown attempt");
      }
      const durationMs = current.durationMs + additionalDurationMs;
      if (!Number.isSafeInteger(durationMs)) {
        throw new RangeError("Accumulated duration exceeds the safe integer range");
      }
      updated = {
        ...current,
        durationMs,
        updatedAt: nextTimestamp(current.updatedAt, this.now()),
      };
      draft.attempts[index] = updated;
    });
    if (updated === undefined) {
      throw new Error("Attempt duration was not updated");
    }
    return cloneAttempt(updated);
  }

  async deleteAttempt(sessionId: string, questionKey: string): Promise<void> {
    await this.mutate((draft) => {
      const index = draft.attempts.findIndex(
        (attempt) => attempt.sessionId === sessionId && attempt.questionKey === questionKey,
      );
      const existing = draft.attempts[index];
      if (existing === undefined) {
        return;
      }
      const deletedAt = nextTimestamp(
        Math.max(existing.updatedAt, existing.deletedAt ?? 0),
        this.now(),
      );
      draft.attempts[index] = redactDeletedAttempt(existing, deletedAt);
    });
  }

  async getScoreReveal(examKey: string): Promise<boolean> {
    const store = await this.getStore();
    const record = store.scoreReveals.find(
      (item) => item.examKey === examKey && item.deletedAt === undefined,
    );
    return record?.revealed ?? false;
  }

  async setScoreReveal(examKey: string, revealed: boolean): Promise<ScoreRevealRecord> {
    const existingStore = await this.getStore();
    const existing = existingStore.scoreReveals.find((item) => item.examKey === examKey);
    const input = assertScoreReveal({
      examKey,
      revealed,
      updatedAt: nextTimestamp(existing?.updatedAt ?? 0, this.now()),
    });
    const store = await this.mutate((draft) => {
      draft.scoreReveals = upsertByKey(
        draft.scoreReveals,
        input,
        (item) => item.examKey,
        pickNewestRecord,
      );
    });
    const saved = store.scoreReveals.find((item) => item.examKey === examKey);
    if (saved === undefined) {
      throw new Error("Score reveal state was not saved");
    }
    return { ...saved };
  }

  async clearScoreReveal(examKey: string): Promise<void> {
    await this.mutate((draft) => {
      const existing = draft.scoreReveals.find((item) => item.examKey === examKey);
      if (existing === undefined) {
        return;
      }
      const deletedAt = nextTimestamp(
        Math.max(existing.updatedAt, existing.deletedAt ?? 0),
        this.now(),
      );
      draft.scoreReveals = upsertByKey(
        draft.scoreReveals,
        {
          examKey,
          revealed: false,
          updatedAt: deletedAt,
          deletedAt,
        },
        (item) => item.examKey,
        pickNewestRecord,
      );
    });
  }

  async appendDebugLog(input: DebugLogRecord): Promise<void> {
    const record = assertDebugLog(input);
    await this.mutate((draft) => {
      const withoutDuplicate = draft.debugLog.filter((item) => item.id !== record.id);
      draft.debugLog = [...withoutDuplicate, record]
        .sort((left, right) => left.occurredAt - right.occurredAt)
        .slice(-this.debugLogLimit);
    }, false);
  }

  async listDebugLog(): Promise<DebugLogRecord[]> {
    return (await this.getStore()).debugLog.map((record) => ({
      ...record,
      facts: { ...record.facts },
    }));
  }

  async clearDebugLog(): Promise<void> {
    await this.mutate((draft) => {
      draft.debugLog = [];
    }, false);
  }

  async getSyncStatus(): Promise<SyncStatus> {
    const store = await this.getStore();
    const state = store.syncState;
    const status: SyncStatus = {
      enabled: store.settings.syncEnabled,
      dirty: state.dirty,
      someNotesLocalOnly: state.someNotesLocalOnly,
      localOnlyNoteKeys: [...state.localOnlyNoteKeys],
      localOnlyRecordKeys: [...state.localOnlyRecordKeys],
    };
    if (state.lastAttemptAt !== undefined) {
      status.lastAttemptAt = state.lastAttemptAt;
    }
    if (state.lastSuccessAt !== undefined) {
      status.lastSuccessAt = state.lastSuccessAt;
    }
    if (state.lastErrorCode !== undefined) {
      status.lastErrorCode = state.lastErrorCode;
    }
    return status;
  }

  async synchronize(): Promise<void> {
    this.scheduleSync();
    await this.flushPendingSync();
  }

  async retryDirtySync(): Promise<void> {
    const store = await this.getStore();
    if (store.settings.syncEnabled && store.syncState.dirty) {
      await this.synchronize();
    }
  }

  async flushPendingSync(): Promise<void> {
    await this.syncTail;
  }

  private async mutate(update: (draft: MKitStore) => void, affectsSync = true): Promise<MKitStore> {
    const store = await this.enqueueLocal(async () => {
      const draft = await this.readStoreUnlocked();
      update(draft);
      if (affectsSync && draft.settings.syncEnabled) {
        draft.syncState.dirty = true;
      }
      const sanitized = canonicalizeStore(draft);
      await this.local.set({ [LOCAL_STORE_KEY]: sanitized });
      if (affectsSync) {
        this.mutationVersion += 1;
      }
      return sanitized;
    });
    if (affectsSync && store.settings.syncEnabled) {
      this.scheduleSync();
    }
    return store;
  }

  private scheduleSync(): void {
    this.syncRequested = true;
    if (this.syncDrainActive) {
      return;
    }
    this.syncDrainActive = true;
    this.syncTail = this.syncTail
      .then(
        () => this.drainSyncRequests(),
        () => this.drainSyncRequests(),
      )
      .finally(() => {
        this.syncDrainActive = false;
        if (this.syncRequested) {
          this.scheduleSync();
        }
      });
  }

  private async drainSyncRequests(): Promise<void> {
    while (this.syncRequested) {
      this.syncRequested = false;
      if (this.lastSyncStartedAt !== undefined) {
        const waitMs = Math.max(0, this.lastSyncStartedAt + this.syncMinIntervalMs - this.now());
        if (waitMs > 0) {
          await this.delay(waitMs);
        }
      }
      this.lastSyncStartedAt = this.now();
      await this.syncOnce();
    }
  }

  private async syncOnce(): Promise<void> {
    if (this.sync === undefined) {
      return;
    }
    let localStore = await this.getStore();
    if (!localStore.settings.syncEnabled) {
      return;
    }
    const attemptedAt = this.now();
    let remoteItems: Record<string, unknown>;
    try {
      remoteItems = await this.sync.get(null);
    } catch {
      await this.markSyncFailure("sync-read-failed", attemptedAt);
      return;
    }

    const remote = decodeSyncSnapshot(remoteItems);
    localStore = await this.enqueueLocal(async () => {
      const current = await this.readStoreUnlocked();
      const merged = mergeLocalAndRemote(current, remote);
      merged.syncState.dirty = true;
      merged.syncState.lastAttemptAt = attemptedAt;
      const sanitized = canonicalizeStore(merged);
      await this.local.set({ [LOCAL_STORE_KEY]: sanitized });
      return sanitized;
    });

    const snapshot = buildSyncSnapshot(localStore);
    localStore.syncState.someNotesLocalOnly = snapshot.omittedNoteKeys.length > 0;
    localStore.syncState.localOnlyNoteKeys = snapshot.omittedNoteKeys;
    localStore.syncState.localOnlyRecordKeys = snapshot.omittedRecordKeys;
    const snapshotVersion = this.mutationVersion;

    try {
      await this.sync.set(snapshot.items);
      const staleKeys = Object.keys(remoteItems).filter(
        (key) => key.startsWith(SYNC_PREFIX) && !(key in snapshot.items),
      );
      if (staleKeys.length > 0) {
        await this.sync.remove(staleKeys);
      }
    } catch {
      await this.markSyncFailure("sync-write-failed", attemptedAt, snapshot);
      return;
    }

    await this.enqueueLocal(async () => {
      const current = await this.readStoreUnlocked();
      current.syncState = {
        dirty: this.mutationVersion !== snapshotVersion,
        someNotesLocalOnly: snapshot.omittedNoteKeys.length > 0,
        localOnlyNoteKeys: snapshot.omittedNoteKeys,
        localOnlyRecordKeys: snapshot.omittedRecordKeys,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: this.now(),
      };
      const sanitized = canonicalizeStore(current);
      await this.local.set({ [LOCAL_STORE_KEY]: sanitized });
      return sanitized;
    });
  }

  private async markSyncFailure(
    code: "sync-read-failed" | "sync-write-failed",
    attemptedAt: number,
    snapshot?: ReturnType<typeof buildSyncSnapshot>,
  ): Promise<void> {
    await this.enqueueLocal(async () => {
      const current = await this.readStoreUnlocked();
      const state: SyncStateRecord = {
        ...current.syncState,
        dirty: true,
        lastAttemptAt: attemptedAt,
        lastErrorCode: code,
      };
      if (snapshot !== undefined) {
        state.someNotesLocalOnly = snapshot.omittedNoteKeys.length > 0;
        state.localOnlyNoteKeys = snapshot.omittedNoteKeys;
        state.localOnlyRecordKeys = snapshot.omittedRecordKeys;
      }
      current.syncState = state;
      const sanitized = canonicalizeStore(current);
      await this.local.set({ [LOCAL_STORE_KEY]: sanitized });
      return sanitized;
    });
  }

  private enqueueLocal<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.localTail.then(operation, operation);
    this.localTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readStoreUnlocked(): Promise<MKitStore> {
    const stored = await this.local.get([LOCAL_STORE_KEY, LEGACY_SETTINGS_STORAGE_KEY]);
    if (Object.hasOwn(stored, LOCAL_STORE_KEY)) {
      const decoded = decodeStore(stored[LOCAL_STORE_KEY]);
      if (decoded === undefined) {
        throw new StorageCorruptionError();
      }
      return canonicalizeStore(decoded);
    }

    const store = createDefaultStore();
    const legacy = migrateLegacySettings(stored[LEGACY_SETTINGS_STORAGE_KEY], this.now());
    if (legacy !== undefined) {
      store.settings = legacy;
      store.syncState.dirty = legacy.syncEnabled;
      const sanitized = canonicalizeStore(store);
      await this.local.set({ [LOCAL_STORE_KEY]: sanitized });
      await this.local.remove(LEGACY_SETTINGS_STORAGE_KEY);
      return sanitized;
    }
    return store;
  }
}

export function mergeLocalAndRemote(local: MKitStore, remote: DecodedSyncSnapshot): MKitStore {
  const merged = canonicalizeStore(local);
  if (remote.settings !== undefined) {
    const localEnabled = merged.settings.enabled;
    const syncableLocalSettings = {
      ...merged.settings,
      enabled: true,
    };
    merged.settings = {
      ...pickNewestRecord(syncableLocalSettings, remote.settings),
      enabled: localEnabled,
    };
  }

  merged.sessionTombstones = mergeByKey(
    merged.sessionTombstones,
    remote.sessionTombstones,
    (item) => item.sessionId,
    (left, right) => (left.updatedAt >= right.updatedAt ? left : right),
  );
  merged.sessions = mergeByKey(
    merged.sessions,
    remote.sessions,
    (item) => item.id,
    pickNewestRecord,
  ).filter((session) => {
    const tombstone = merged.sessionTombstones.find((item) => item.sessionId === session.id);
    return tombstone === undefined || tombstone.updatedAt < session.updatedAt;
  });

  merged.attempts = mergeByKey(merged.attempts, remote.attempts, attemptKey, mergeAttempts).filter(
    (attempt) => !isSessionDeleted(merged, attempt.sessionId),
  );
  merged.scoreReveals = mergeByKey(
    merged.scoreReveals,
    remote.scoreReveals,
    (item) => item.examKey,
    pickNewestRecord,
  );
  merged.syncState.localOnlyNoteKeys = [
    ...new Set([...merged.syncState.localOnlyNoteKeys, ...remote.omittedNoteKeys]),
  ].sort((left, right) => left.localeCompare(right));
  merged.syncState.someNotesLocalOnly = merged.syncState.localOnlyNoteKeys.length > 0;
  return canonicalizeStore(merged);
}

export class ActiveSessionConflictError extends Error {
  readonly activeSessionId: string;

  constructor(activeSessionId: string) {
    super("Archive the active session before starting another in the same mode");
    this.name = "ActiveSessionConflictError";
    this.activeSessionId = activeSessionId;
  }
}

export class StorageCorruptionError extends Error {
  constructor() {
    super("MKit storage is malformed; the existing data was left untouched");
    this.name = "StorageCorruptionError";
  }
}

export { UnsupportedStoreVersionError };

function mergeAttempts(left: AttemptRecord, right: AttemptRecord): AttemptRecord {
  const winner = pickNewestRecord(left, right);
  if (winner.deletedAt !== undefined) {
    return cloneAttempt(winner);
  }
  const rightWithMarker = right as AttemptRecord & { noteOmitted?: true };
  if (winner === right && rightWithMarker.noteOmitted === true) {
    const result = cloneAttempt(right);
    delete result.note;
    delete result.noteUpdatedAt;
    if (left.note !== undefined) {
      result.note = left.note;
    }
    if (left.noteUpdatedAt !== undefined) {
      result.noteUpdatedAt = left.noteUpdatedAt;
    }
    return result;
  }
  if (
    left.updatedAt === right.updatedAt &&
    left.deletedAt === undefined &&
    right.deletedAt === undefined &&
    (left.noteUpdatedAt ?? 0) > (right.noteUpdatedAt ?? 0)
  ) {
    const result = cloneAttempt(winner);
    if (left.note !== undefined) {
      result.note = left.note;
    } else {
      delete result.note;
    }
    if (left.noteUpdatedAt !== undefined) {
      result.noteUpdatedAt = left.noteUpdatedAt;
    } else {
      delete result.noteUpdatedAt;
    }
    return result;
  }
  return cloneAttempt(winner);
}

function pickNewestRecord<T extends { updatedAt: number; deletedAt?: number }>(
  left: T,
  right: T,
): T {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  const leftDeleted = left.deletedAt !== undefined;
  const rightDeleted = right.deletedAt !== undefined;
  if (leftDeleted !== rightDeleted) {
    return leftDeleted ? left : right;
  }
  return stableJson(left) >= stableJson(right) ? left : right;
}

function upsertByKey<T>(
  records: T[],
  incoming: T,
  keyOf: (record: T) => string,
  merge: (left: T, right: T) => T,
): T[] {
  const index = records.findIndex((record) => keyOf(record) === keyOf(incoming));
  if (index === -1) {
    return [...records, incoming];
  }
  const current = records[index];
  if (current === undefined) {
    return [...records, incoming];
  }
  const next = [...records];
  next[index] = merge(current, incoming);
  return next;
}

function mergeByKey<T>(
  local: T[],
  remote: T[],
  keyOf: (record: T) => string,
  merge: (left: T, right: T) => T,
): T[] {
  let result = [...local];
  for (const record of remote) {
    result = upsertByKey(result, record, keyOf, merge);
  }
  return result.sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

function redactDeletedAttempt(record: AttemptRecord, deletedAt: number): AttemptRecord {
  return {
    sessionId: record.sessionId,
    questionKey: record.questionKey,
    selection: null,
    eliminations: [],
    confidence: null,
    flagged: false,
    reviewAgain: false,
    tags: [],
    outcome: "unknown",
    categoryCode: null,
    sectionKey: record.sectionKey,
    passageOrDiscrete: record.passageOrDiscrete,
    durationMs: 0,
    updatedAt: deletedAt,
    deletedAt,
  };
}

function canonicalizeStore(input: MKitStore): MKitStore {
  const decoded = decodeStore(input);
  if (decoded === undefined) {
    throw new StorageCorruptionError();
  }
  decoded.sessions.sort((left, right) => left.id.localeCompare(right.id));
  decoded.sessionTombstones.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  decoded.attempts.sort((left, right) => attemptKey(left).localeCompare(attemptKey(right)));
  decoded.scoreReveals.sort((left, right) => left.examKey.localeCompare(right.examKey));
  decoded.debugLog.sort((left, right) => left.occurredAt - right.occurredAt);
  decoded.syncState.localOnlyNoteKeys.sort((left, right) => left.localeCompare(right));
  decoded.syncState.localOnlyRecordKeys.sort((left, right) => left.localeCompare(right));
  return decoded;
}

function cloneSession(record: SessionRecord): SessionRecord {
  return { ...record, finishedSections: [...record.finishedSections] };
}

function cloneAttempt(record: AttemptRecord): AttemptRecord {
  return {
    ...record,
    eliminations: [...record.eliminations],
    tags: [...record.tags],
  };
}

function isSessionDeleted(store: Pick<MKitStore, "sessionTombstones">, sessionId: string): boolean {
  return store.sessionTombstones.some((item) => item.sessionId === sessionId);
}

function nextTimestamp(previous: number, now: number): number {
  return Math.max(now, previous + 1);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
