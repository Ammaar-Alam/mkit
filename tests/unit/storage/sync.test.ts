import { describe, expect, it } from "vitest";
import {
  buildSyncSnapshot,
  decodeSyncSnapshot,
  SYNC_ITEM_MAX_BYTES,
  SYNC_TOTAL_MAX_BYTES,
  storageItemBytes,
  syncSnapshotBytes,
} from "../../../src/storage";
import { makeAttempt, makeSession, makeStore } from "./fixtures";

describe("quota-aware sync serialization", () => {
  it("serializes enabled as on without changing the browser-local setting", () => {
    const store = makeStore();
    store.settings = {
      ...store.settings,
      enabled: false,
      clearPreviousCrossOutsEnabled: false,
      showInitialCorrectnessEnabled: true,
      updatedAt: 12,
    };

    const snapshot = buildSyncSnapshot(store);
    const decoded = decodeSyncSnapshot(snapshot.items);

    expect(decoded.settings).toMatchObject({
      enabled: true,
      clearPreviousCrossOutsEnabled: false,
      showInitialCorrectnessEnabled: true,
      updatedAt: 12,
    });
    expect(store.settings.enabled).toBe(false);
  });

  it("measures UTF-8 bytes rather than JavaScript string length", () => {
    const key = "mkit.😀";
    const value = { note: "漢字🙂" };

    expect(storageItemBytes(key, value)).toBe(
      new TextEncoder().encode(key).byteLength +
        new TextEncoder().encode(JSON.stringify(value)).byteLength,
    );
    expect(storageItemBytes(key, value)).toBeGreaterThan(key.length + JSON.stringify(value).length);
  });

  it("produces deterministic shards below 7 KB and a 90 KB aggregate ceiling", () => {
    const store = makeStore();
    store.sessions = [makeSession()];
    store.attempts = Array.from({ length: 80 }, (_, index) =>
      makeAttempt({
        questionKey: `cp-${index.toString().padStart(3, "0")}`,
        note: `私のノート🙂${"x".repeat(1_900)}`,
        noteUpdatedAt: index + 1,
        updatedAt: index + 1,
      }),
    );

    const first = buildSyncSnapshot(store);
    const second = buildSyncSnapshot(store);

    expect(first).toEqual(second);
    expect(syncSnapshotBytes(first.items)).toBe(first.totalBytes);
    expect(first.totalBytes).toBeLessThanOrEqual(SYNC_TOTAL_MAX_BYTES);
    for (const [key, value] of Object.entries(first.items)) {
      expect(storageItemBytes(key, value)).toBeLessThan(SYNC_ITEM_MAX_BYTES);
    }
  });

  it("omits overflowing notes with an explicit marker while leaving local notes unchanged", () => {
    const store = makeStore();
    store.sessions = [makeSession()];
    store.attempts = Array.from({ length: 50 }, (_, index) =>
      makeAttempt({
        questionKey: `cp-${index}`,
        note: `LOCAL_NOTE_${index}_${"🙂".repeat(900)}`,
        noteUpdatedAt: index + 10,
        updatedAt: index + 10,
      }),
    );
    const localBefore = structuredClone(store);

    const snapshot = buildSyncSnapshot(store);
    const serializedSync = JSON.stringify(snapshot.items);
    const decoded = decodeSyncSnapshot(snapshot.items);

    expect(snapshot.omittedNoteKeys).toHaveLength(50);
    expect(serializedSync).not.toContain("LOCAL_NOTE_");
    expect(serializedSync).toContain('"noteOmitted":true');
    expect(decoded.omittedNoteKeys).toHaveLength(50);
    expect(store).toEqual(localBefore);
  });

  it("reports records that cannot fit the aggregate budget", () => {
    const store = makeStore();
    store.sessions = Array.from({ length: 1_000 }, (_, index) =>
      makeSession({
        id: `session-${index.toString().padStart(4, "0")}`,
        examKey: `exam-${index}-${"e".repeat(180)}`,
        status: "archived",
        updatedAt: index + 1,
      }),
    );

    const snapshot = buildSyncSnapshot(store);

    expect(snapshot.totalBytes).toBeLessThanOrEqual(SYNC_TOTAL_MAX_BYTES);
    expect(snapshot.omittedRecordKeys.length).toBeGreaterThan(0);
  });

  it("decodes only whitelisted sync fields", () => {
    const store = makeStore();
    store.sessions = [
      {
        ...makeSession(),
        questionText: "SYNC_QUESTION_SENTINEL",
      } as ReturnType<typeof makeSession>,
    ];
    store.attempts = [
      {
        ...makeAttempt(),
        explanation: "SYNC_EXPLANATION_SENTINEL",
        originalAnswer: "SYNC_ORIGINAL_SENTINEL",
      } as ReturnType<typeof makeAttempt>,
    ];

    const snapshot = buildSyncSnapshot(store);
    const serialized = JSON.stringify(snapshot.items);

    expect(serialized).not.toContain("SYNC_QUESTION_SENTINEL");
    expect(serialized).not.toContain("SYNC_EXPLANATION_SENTINEL");
    expect(serialized).not.toContain("SYNC_ORIGINAL_SENTINEL");
  });
});
