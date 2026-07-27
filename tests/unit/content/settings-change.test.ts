import { describe, expect, it } from "vitest";
import { hasSettingsStorageChange } from "../../../src/content/settings-change";
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_STORAGE_KEY,
  LOCAL_STORE_KEY,
} from "../../../src/storage";
import { makeAttempt, makeStore } from "../storage/fixtures";

describe("content settings storage changes", () => {
  it("ignores attempt-only writes to the combined local store", () => {
    const previous = makeStore();
    previous.settings = { ...DEFAULT_SETTINGS, updatedAt: 10 };
    const next = structuredClone(previous);
    next.attempts = [makeAttempt({ note: "Compare the limiting cases.", updatedAt: 11 })];

    expect(
      hasSettingsStorageChange(
        {
          [LOCAL_STORE_KEY]: {
            oldValue: previous,
            newValue: next,
          },
        },
        "local",
      ),
    ).toBe(false);
  });

  it("recognizes current and legacy settings changes only in local storage", () => {
    const previous = makeStore();
    previous.settings = { ...DEFAULT_SETTINGS, updatedAt: 10 };
    const next = structuredClone(previous);
    next.settings = {
      ...next.settings,
      clearPreviousHighlightsEnabled: false,
      updatedAt: 11,
    };
    const currentChange = {
      [LOCAL_STORE_KEY]: {
        oldValue: previous,
        newValue: next,
      },
    };

    expect(hasSettingsStorageChange(currentChange, "local")).toBe(true);
    expect(hasSettingsStorageChange(currentChange, "sync")).toBe(false);
    expect(
      hasSettingsStorageChange(
        {
          [LEGACY_SETTINGS_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: { ...DEFAULT_SETTINGS, schemaVersion: 1 },
          },
        },
        "local",
      ),
    ).toBe(true);
  });
});
