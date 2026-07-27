import { LEGACY_SETTINGS_STORAGE_KEY, LOCAL_STORE_KEY } from "../storage";

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export function hasSettingsStorageChange(
  changes: Readonly<Record<string, StorageChange>>,
  areaName: string,
): boolean {
  if (areaName !== "local") return false;
  if (Object.hasOwn(changes, LEGACY_SETTINGS_STORAGE_KEY)) return true;

  const storeChange = changes[LOCAL_STORE_KEY];
  if (!storeChange) return false;
  const previous = settingsPayload(storeChange.oldValue);
  const next = settingsPayload(storeChange.newValue);
  if (!previous || !next) return true;

  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length !== nextKeys.length ||
    previousKeys.some((key) => !Object.hasOwn(next, key) || !Object.is(previous[key], next[key]))
  );
}

function settingsPayload(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = (value as Record<string, unknown>).settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return null;
  return settings as Readonly<Record<string, unknown>>;
}
