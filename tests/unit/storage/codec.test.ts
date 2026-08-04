import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_STORAGE_KEY,
  LOCAL_STORE_KEY,
  STORE_SCHEMA_VERSION,
  StorageCorruptionError,
  StorageRepository,
  UnsupportedStoreVersionError,
} from "../../../src/storage";
import { FakeStorageArea } from "./fake-storage";
import { futureStore, legacySettings, makeAttempt, makeSession, makeStore } from "./fixtures";

describe("storage codec and migrations", () => {
  it("migrates the legacy settings record without inventing a future AI target", async () => {
    const local = new FakeStorageArea("local", {
      [LEGACY_SETTINGS_STORAGE_KEY]: legacySettings({
        defaultMode: "test",
        enabled: false,
        updatedAt: 42,
      }),
    });
    const repository = new StorageRepository({ local, now: () => 100 });

    const settings = await repository.getSettings();

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      defaultMode: "test",
      updatedAt: 42,
    });
    expect(settings).not.toHaveProperty("aiHandoffTarget");
    expect(local.values).not.toHaveProperty(LEGACY_SETTINGS_STORAGE_KEY);
    expect(local.values[LOCAL_STORE_KEY]).toMatchObject({
      schemaVersion: STORE_SCHEMA_VERSION,
      settings,
    });
  });

  it("defaults newly added review settings safely when an existing v2 store omits them", async () => {
    const existingStore = makeStore();
    const existingSettings = existingStore.settings as unknown as Record<string, unknown>;
    delete existingSettings.clearPreviousHighlightsEnabled;
    delete existingSettings.clearPreviousCrossOutsEnabled;
    delete existingSettings.hideSectionResultMarksEnabled;
    delete existingSettings.showInitialCorrectnessEnabled;
    const repository = new StorageRepository({
      local: new FakeStorageArea("local", { [LOCAL_STORE_KEY]: existingStore }),
    });

    await expect(repository.getSettings()).resolves.toMatchObject({
      clearPreviousHighlightsEnabled: true,
      clearPreviousCrossOutsEnabled: true,
      hideSectionResultMarksEnabled: true,
      showInitialCorrectnessEnabled: false,
    });
  });

  it("rejects invalid concealment setting values without rewriting storage", async () => {
    const malformed = makeStore();
    (malformed.settings as unknown as Record<string, unknown>).clearPreviousHighlightsEnabled =
      "yes";
    (malformed.settings as unknown as Record<string, unknown>).showInitialCorrectnessEnabled =
      "yes";
    const local = new FakeStorageArea("local", { [LOCAL_STORE_KEY]: malformed });
    const repository = new StorageRepository({ local });

    await expect(repository.getSettings()).rejects.toBeInstanceOf(StorageCorruptionError);
    expect(local.values[LOCAL_STORE_KEY]).toEqual(malformed);
    expect(local.events).not.toContain("local:set");
  });

  it("does not overwrite a future storage version", async () => {
    const future = futureStore();
    const local = new FakeStorageArea("local", { [LOCAL_STORE_KEY]: future });
    const repository = new StorageRepository({ local });

    await expect(repository.getSettings()).rejects.toBeInstanceOf(UnsupportedStoreVersionError);
    expect(local.values[LOCAL_STORE_KEY]).toEqual(future);
    expect(local.events).not.toContain("local:set");
  });

  it("leaves a malformed current store untouched", async () => {
    const malformed = { schemaVersion: STORE_SCHEMA_VERSION, settings: "broken" };
    const local = new FakeStorageArea("local", { [LOCAL_STORE_KEY]: malformed });
    const repository = new StorageRepository({ local });

    await expect(repository.writeSettings({ enabled: false })).rejects.toBeInstanceOf(
      StorageCorruptionError,
    );
    expect(local.values[LOCAL_STORE_KEY]).toEqual(malformed);
    expect(local.events).not.toContain("local:set");
  });

  it("reconstructs allowlisted records and drops arbitrary DOM and proprietary fields", async () => {
    const local = new FakeStorageArea("local");
    const repository = new StorageRepository({ local });
    const session = {
      ...makeSession(),
      questionText: "OFFICIAL_QUESTION_SENTINEL",
      originalAnswer: "ORIGINAL_ANSWER_SENTINEL",
      pageElement: { nodeType: 1, textContent: "DOM_TEXT_SENTINEL" },
    };
    const attempt = {
      ...makeAttempt(),
      explanation: "OFFICIAL_EXPLANATION_SENTINEL",
      correctAnswer: "CORRECT_ANSWER_SENTINEL",
      score: "SCORE_VALUE_SENTINEL",
      screenshot: new Blob(["SCREENSHOT_SENTINEL"]),
    };

    await repository.saveSession(session);
    await repository.saveAttempt(attempt);

    const serialized = JSON.stringify(local.values);
    expect(serialized).not.toContain("OFFICIAL_QUESTION_SENTINEL");
    expect(serialized).not.toContain("ORIGINAL_ANSWER_SENTINEL");
    expect(serialized).not.toContain("OFFICIAL_EXPLANATION_SENTINEL");
    expect(serialized).not.toContain("CORRECT_ANSWER_SENTINEL");
    expect(serialized).not.toContain("SCORE_VALUE_SENTINEL");
    expect(serialized).not.toContain("SCREENSHOT_SENTINEL");
    expect(serialized).not.toContain("DOM_TEXT_SENTINEL");
    expect(await repository.getAttempt("session-1", "cp-1")).toEqual(makeAttempt());
  });

  it("normalizes set-like fields and keeps deletedAt absent on active attempts", async () => {
    const local = new FakeStorageArea("local");
    const repository = new StorageRepository({ local });
    await repository.saveSession(makeSession());

    const saved = await repository.saveAttempt(
      makeAttempt({
        eliminations: ["D", "A", "D"],
        tags: ["timing", "reasoning", "timing"],
      }),
    );

    expect(saved.eliminations).toEqual(["A", "D"]);
    expect(saved.tags).toEqual(["reasoning", "timing"]);
    expect(saved).not.toHaveProperty("deletedAt");
  });
});
