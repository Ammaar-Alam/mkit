import { createChromeStorageRepository, type SettingsRecord } from "../storage";

export {
  DEFAULT_SETTINGS,
  type FreshAttemptMode,
  LEGACY_SETTINGS_STORAGE_KEY as SETTINGS_STORAGE_KEY,
  type SettingsRecord,
} from "../storage";

let repository: ReturnType<typeof createChromeStorageRepository> | undefined;

export async function readSettings(): Promise<SettingsRecord> {
  const storage = getRepository();
  const settings = await storage.getSettings();
  void storage.retryDirtySync().catch(() => undefined);
  return settings;
}

export async function writeSettings(
  patch: Partial<
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
  >,
): Promise<SettingsRecord> {
  return getRepository().writeSettings(patch);
}

function getRepository(): ReturnType<typeof createChromeStorageRepository> {
  repository ??= createChromeStorageRepository();
  return repository;
}
