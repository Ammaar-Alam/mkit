export const SETTINGS_STORAGE_KEY = "mkit.settings.v1";

export type FreshAttemptMode = "practice" | "test";

export interface SettingsRecord {
  schemaVersion: 1;
  enabled: boolean;
  defaultMode: FreshAttemptMode;
  encouragementEnabled: boolean;
  scoreShieldEnabled: boolean;
  timerDisplayEnabled: false;
  syncEnabled: boolean;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  schemaVersion: 1,
  enabled: true,
  defaultMode: "practice",
  encouragementEnabled: true,
  scoreShieldEnabled: true,
  timerDisplayEnabled: false,
  syncEnabled: false,
  updatedAt: 0,
};

export async function readSettings(): Promise<SettingsRecord> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const value = stored[SETTINGS_STORAGE_KEY];
  if (!isSettingsRecord(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  return value;
}

export async function writeSettings(
  patch: Partial<Omit<SettingsRecord, "schemaVersion" | "timerDisplayEnabled">>,
): Promise<SettingsRecord> {
  const current = await readSettings();
  const next: SettingsRecord = {
    ...current,
    ...patch,
    schemaVersion: 1,
    timerDisplayEnabled: false,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

function isSettingsRecord(value: unknown): value is SettingsRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SettingsRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.enabled === "boolean" &&
    (candidate.defaultMode === "practice" || candidate.defaultMode === "test") &&
    typeof candidate.encouragementEnabled === "boolean" &&
    typeof candidate.scoreShieldEnabled === "boolean" &&
    candidate.timerDisplayEnabled === false &&
    typeof candidate.syncEnabled === "boolean" &&
    typeof candidate.updatedAt === "number"
  );
}
