export {
  DEFAULT_SETTINGS,
  DEFAULT_SYNC_STATE,
  UnsupportedStoreVersionError,
} from "./codec";
export {
  ActiveSessionConflictError,
  DEFAULT_DEBUG_LOG_LIMIT,
  DEFAULT_SYNC_MIN_INTERVAL_MS,
  LEGACY_SETTINGS_STORAGE_KEY,
  LOCAL_STORE_KEY,
  mergeLocalAndRemote,
  StorageCorruptionError,
  StorageRepository,
} from "./repository";
export * from "./schema";
export {
  buildSyncSnapshot,
  type DecodedSyncSnapshot,
  decodeSyncSnapshot,
  SYNC_ITEM_MAX_BYTES,
  SYNC_META_KEY,
  SYNC_PREFIX,
  SYNC_TOTAL_MAX_BYTES,
  type SyncAttemptRecord,
  type SyncSnapshot,
  storageItemBytes,
  syncSnapshotBytes,
} from "./sync";

import { StorageRepository } from "./repository";
import type { StorageAreaLike } from "./types";

export function createChromeStorageRepository(): StorageRepository {
  if (typeof chrome === "undefined" || chrome.storage?.local === undefined) {
    throw new Error("Chrome storage is unavailable");
  }
  const options: ConstructorParameters<typeof StorageRepository>[0] = {
    local: chromeStorageArea(chrome.storage.local),
  };
  if (chrome.storage.sync !== undefined) {
    options.sync = chromeStorageArea(chrome.storage.sync);
  }
  return new StorageRepository(options);
}

function chromeStorageArea(area: chrome.storage.StorageArea): StorageAreaLike {
  return {
    get: async (keys) => area.get(keys),
    set: async (items) => area.set(items),
    remove: async (keys) => area.remove(keys),
  };
}
