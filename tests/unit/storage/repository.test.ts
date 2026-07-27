import { describe, expect, it, vi } from "vitest";
import {
  ActiveSessionConflictError,
  attemptKey,
  buildSyncSnapshot,
  decodeSyncSnapshot,
  LOCAL_STORE_KEY,
  mergeLocalAndRemote,
  StorageRepository,
} from "../../../src/storage";
import { deferred, FakeStorageArea } from "./fake-storage";
import { makeAttempt, makeSession, makeStore } from "./fixtures";

describe("local-first storage repository", () => {
  it("persists all review concealment preferences independently", async () => {
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: () => 10,
    });

    await repository.writeSettings({
      clearPreviousHighlightsEnabled: false,
      clearPreviousCrossOutsEnabled: false,
      hideSectionResultMarksEnabled: false,
    });

    await expect(repository.getSettings()).resolves.toMatchObject({
      clearPreviousHighlightsEnabled: false,
      clearPreviousCrossOutsEnabled: false,
      hideSectionResultMarksEnabled: false,
    });
  });

  it("awaits the local write before starting nonblocking sync", async () => {
    const events: string[] = [];
    const local = new FakeStorageArea("local", {}, events);
    const sync = new FakeStorageArea("sync", {}, events);
    const gate = deferred();
    sync.setGate = gate.promise;
    const repository = new StorageRepository({ local, sync, now: () => 100 });

    const write = repository.writeSettings({ syncEnabled: true });
    const settings = await write;

    expect(settings.syncEnabled).toBe(true);
    expect(local.values[LOCAL_STORE_KEY]).toBeDefined();
    await vi.waitFor(() => expect(events).toContain("sync:set"));
    expect(events.indexOf("local:set")).toBeLessThan(events.indexOf("sync:set"));
    gate.resolve();
    await repository.flushPendingSync();
  });

  it("keeps local data and marks it dirty when sync is offline", async () => {
    const local = new FakeStorageArea("local");
    const sync = new FakeStorageArea("sync");
    sync.failGetCount = 1;
    const repository = new StorageRepository({ local, sync, now: () => 20 });

    await repository.writeSettings({ syncEnabled: true });
    await repository.flushPendingSync();

    expect((await repository.getSettings()).syncEnabled).toBe(true);
    expect(await repository.getSyncStatus()).toMatchObject({
      dirty: true,
      lastErrorCode: "sync-read-failed",
    });
  });

  it("keeps the browser switch local without overwriting newer synced preferences", async () => {
    const localStore = makeStore();
    localStore.settings = {
      ...localStore.settings,
      enabled: true,
      syncEnabled: true,
      scoreShieldEnabled: true,
      clearPreviousHighlightsEnabled: true,
      updatedAt: 10,
    };
    const remoteStore = makeStore();
    remoteStore.settings = {
      ...remoteStore.settings,
      syncEnabled: true,
      scoreShieldEnabled: false,
      clearPreviousHighlightsEnabled: false,
      updatedAt: 20,
    };
    const events: string[] = [];
    const local = new FakeStorageArea("local", { [LOCAL_STORE_KEY]: localStore }, events);
    const sync = new FakeStorageArea("sync", buildSyncSnapshot(remoteStore).items, events);
    const repository = new StorageRepository({
      local,
      sync,
      now: () => 30,
      syncMinIntervalMs: 0,
    });

    const toggled = await repository.writeSettings({ enabled: false });
    await repository.flushPendingSync();

    expect(toggled).toMatchObject({ enabled: false, updatedAt: 10 });
    expect(events.filter((event) => event === "sync:set")).toHaveLength(0);

    await repository.synchronize();

    await expect(repository.getSettings()).resolves.toMatchObject({
      enabled: false,
      scoreShieldEnabled: false,
      clearPreviousHighlightsEnabled: false,
      updatedAt: 20,
    });
    expect(decodeSyncSnapshot(sync.values).settings).toMatchObject({
      enabled: true,
      scoreShieldEnabled: false,
      clearPreviousHighlightsEnabled: false,
      updatedAt: 20,
    });
  });

  it("retries dirty sync best-effort and clears the error after success", async () => {
    const local = new FakeStorageArea("local");
    const sync = new FakeStorageArea("sync");
    sync.failSetCount = 1;
    let now = 30;
    const repository = new StorageRepository({
      local,
      sync,
      now: () => now++,
      syncMinIntervalMs: 0,
    });

    await repository.writeSettings({ syncEnabled: true });
    await repository.flushPendingSync();
    expect((await repository.getSyncStatus()).dirty).toBe(true);

    await repository.retryDirtySync();

    const status = await repository.getSyncStatus();
    expect(status.dirty).toBe(false);
    expect(status).not.toHaveProperty("lastErrorCode");
  });

  it("enforces one active session for each exam and mode until it is archived", async () => {
    const repository = new StorageRepository({ local: new FakeStorageArea("local") });
    await repository.saveSession(makeSession());

    await expect(
      repository.saveSession(makeSession({ id: "session-2", updatedAt: 2 })),
    ).rejects.toBeInstanceOf(ActiveSessionConflictError);

    await repository.saveSession(makeSession({ status: "archived", updatedAt: 3 }));
    await expect(
      repository.saveSession(makeSession({ id: "session-2", updatedAt: 4 })),
    ).resolves.toMatchObject({ id: "session-2", status: "active" });
  });

  it("accumulates active-viewing duration without accepting negative time", async () => {
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: () => 50,
    });
    await repository.saveSession(makeSession());
    await repository.saveAttempt(makeAttempt({ durationMs: 800 }));

    expect(await repository.accumulateDuration("session-1", "cp-1", 350)).toMatchObject({
      durationMs: 1_150,
      updatedAt: 50,
    });
    await expect(repository.accumulateDuration("session-1", "cp-1", -1)).rejects.toThrow(
      "non-negative",
    );
  });

  it("keeps debug events bounded and local-only", async () => {
    const local = new FakeStorageArea("local");
    const sync = new FakeStorageArea("sync");
    const repository = new StorageRepository({
      local,
      sync,
      debugLogLimit: 2,
      now: () => 100,
    });
    await repository.writeSettings({ syncEnabled: true });
    await repository.flushPendingSync();
    for (let index = 0; index < 3; index += 1) {
      await repository.appendDebugLog({
        id: `event-${index}`,
        event: "adapter.capability",
        occurredAt: index,
        facts: { navigatorFound: index > 0 },
      });
    }
    await repository.flushPendingSync();

    expect((await repository.listDebugLog()).map((item) => item.id)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(JSON.stringify(sync.values)).not.toContain("adapter.capability");
  });

  it("coalesces rapid local changes and rate-limits browser sync writes", async () => {
    const events: string[] = [];
    const local = new FakeStorageArea("local", {}, events);
    const sync = new FakeStorageArea("sync", {}, events);
    const gate = deferred();
    sync.setGate = gate.promise;
    let clock = 1_000;
    const delays: number[] = [];
    const repository = new StorageRepository({
      local,
      sync,
      now: () => clock,
      syncMinIntervalMs: 600,
      delay: async (durationMs) => {
        delays.push(durationMs);
        clock += durationMs;
      },
    });

    await repository.writeSettings({ syncEnabled: true });
    await vi.waitFor(() => expect(events).toContain("sync:set"));
    const rapidWrites = Array.from({ length: 12 }, (_, index) =>
      repository.writeSettings({ encouragementEnabled: index % 2 === 0 }),
    );
    await Promise.all(rapidWrites);
    gate.resolve();
    await repository.flushPendingSync();

    expect(events.filter((event) => event === "local:set").length).toBeGreaterThanOrEqual(13);
    expect(events.filter((event) => event === "sync:set")).toHaveLength(2);
    expect(delays).toEqual([600]);
    expect((await repository.getSyncStatus()).dirty).toBe(false);
  });

  it("removes stale MKit shards without touching unrelated sync data", async () => {
    const local = new FakeStorageArea("local");
    const sync = new FakeStorageArea("sync", {
      "mkit.sync.v2.attempts.9999": {
        schemaVersion: 2,
        kind: "attempts",
        records: [],
      },
      "another-extension": { keep: true },
    });
    const repository = new StorageRepository({
      local,
      sync,
      now: () => 70,
      syncMinIntervalMs: 0,
    });

    await repository.writeSettings({ syncEnabled: true });
    await repository.flushPendingSync();

    expect(sync.values).not.toHaveProperty("mkit.sync.v2.attempts.9999");
    expect(sync.values).toHaveProperty("another-extension", { keep: true });
  });

  it("stores only a boolean for score reveal state", async () => {
    const local = new FakeStorageArea("local");
    const repository = new StorageRepository({ local, now: () => 60 });

    await repository.setScoreReveal("fl-1", true);

    expect(await repository.getScoreReveal("fl-1")).toBe(true);
    expect(await repository.getScoreReveal("fl-2")).toBe(false);
    const serialized = JSON.stringify(local.values);
    expect(serialized).toContain('"revealed":true');
    expect(serialized).not.toMatch(/scoreValue|scaledScore|percentile/u);
  });
});

describe("updatedAt merge and tombstones", () => {
  it("keeps enabled browser-local while merging newer synced preferences", () => {
    const local = makeStore();
    local.settings = {
      ...local.settings,
      enabled: false,
      clearPreviousHighlightsEnabled: true,
      updatedAt: 10,
    };
    const remoteStore = makeStore();
    remoteStore.settings = {
      ...remoteStore.settings,
      enabled: true,
      clearPreviousHighlightsEnabled: false,
      updatedAt: 20,
    };

    const merged = mergeLocalAndRemote(
      local,
      decodeSyncSnapshot(buildSyncSnapshot(remoteStore).items),
    );

    expect(merged.settings.enabled).toBe(false);
    expect(merged.settings.clearPreviousHighlightsEnabled).toBe(false);
    expect(merged.settings.updatedAt).toBe(20);
  });

  it("takes newer records in both directions", () => {
    const localNewer = makeStore();
    localNewer.sessions = [makeSession({ updatedAt: 20, status: "archived" })];
    const remoteOlderStore = makeStore();
    remoteOlderStore.sessions = [makeSession({ updatedAt: 10, status: "active" })];

    const localWinner = mergeLocalAndRemote(
      localNewer,
      decodeSyncSnapshot(buildSyncSnapshot(remoteOlderStore).items),
    );
    expect(localWinner.sessions[0]?.status).toBe("archived");

    const remoteNewerStore = makeStore();
    remoteNewerStore.sessions = [makeSession({ updatedAt: 30, status: "finished" })];
    const remoteWinner = mergeLocalAndRemote(
      localNewer,
      decodeSyncSnapshot(buildSyncSnapshot(remoteNewerStore).items),
    );
    expect(remoteWinner.sessions[0]?.status).toBe("finished");
  });

  it("gives a session tombstone precedence on an updatedAt tie", () => {
    const local = makeStore();
    local.sessions = [makeSession({ updatedAt: 10 })];
    const remote = makeStore();
    remote.sessions = [makeSession({ updatedAt: 10 })];
    remote.sessionTombstones = [{ sessionId: "session-1", updatedAt: 10 }];

    const merged = mergeLocalAndRemote(local, decodeSyncSnapshot(buildSyncSnapshot(remote).items));

    expect(merged.sessions).toEqual([]);
    expect(merged.sessionTombstones).toEqual([{ sessionId: "session-1", updatedAt: 10 }]);
  });

  it("gives an attempt deletion precedence on an updatedAt tie", () => {
    const local = makeStore();
    local.attempts = [makeAttempt({ updatedAt: 10, note: "keep?" })];
    const remote = makeStore();
    remote.attempts = [
      makeAttempt({
        selection: null,
        eliminations: [],
        confidence: null,
        updatedAt: 10,
        deletedAt: 10,
      }),
    ];
    delete remote.attempts[0]?.note;

    const merged = mergeLocalAndRemote(local, decodeSyncSnapshot(buildSyncSnapshot(remote).items));

    expect(merged.attempts[0]?.deletedAt).toBe(10);
    expect(merged.attempts[0]).not.toHaveProperty("note");
  });

  it("does not erase a local note when an incoming sync record marks it omitted", () => {
    const local = makeStore();
    local.attempts = [
      makeAttempt({
        note: "My private local note",
        noteUpdatedAt: 5,
        updatedAt: 5,
      }),
    ];
    const remoteStore = makeStore();
    remoteStore.attempts = [
      makeAttempt({
        note: `A newer note that overflowed sync ${"x".repeat(8_000)}`,
        noteUpdatedAt: 10,
        updatedAt: 10,
      }),
    ];
    const noteKey = attemptKey(remoteStore.attempts[0] ?? makeAttempt());
    remoteStore.syncState.localOnlyNoteKeys = [noteKey];
    remoteStore.syncState.someNotesLocalOnly = true;
    const snapshot = buildSyncSnapshot(remoteStore);
    const remote = decodeSyncSnapshot(snapshot.items);

    const merged = mergeLocalAndRemote(local, remote);

    expect(merged.attempts[0]?.note).toBe("My private local note");
    expect(merged.syncState.someNotesLocalOnly).toBe(true);
    expect(merged.syncState.localOnlyNoteKeys).toEqual([noteKey]);
  });
});
