import "./options.css";
import {
  createChromeStorageRepository,
  type DebugLogRecord,
  type FreshAttemptMode,
} from "../storage";

const protectInput = requiredElement<HTMLInputElement>("protect-reviews");
const shieldInput = requiredElement<HTMLInputElement>("score-shield");
const encouragementInput = requiredElement<HTMLInputElement>("encouragement");
const syncInput = requiredElement<HTMLInputElement>("browser-sync");
const syncDescription = requiredElement("sync-description");
const saveStatus = requiredElement("save-status");
const modeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="default-mode"]'),
);
const debugLog = requiredElement("debug-log");
const clearDebugLog = requiredElement<HTMLButtonElement>("clear-debug-log");
const repository = createChromeStorageRepository();

void initialize();

async function initialize(): Promise<void> {
  const [settings, records] = await Promise.all([
    repository.getSettings(),
    repository.listDebugLog(),
  ]);
  protectInput.checked = settings.enabled;
  shieldInput.checked = settings.scoreShieldEnabled;
  encouragementInput.checked = settings.encouragementEnabled;
  syncInput.checked = settings.syncEnabled;
  renderSyncDescription(settings.syncEnabled);
  for (const input of modeInputs) {
    input.checked = input.value === settings.defaultMode;
  }

  protectInput.addEventListener("change", () => save({ enabled: protectInput.checked }));
  shieldInput.addEventListener("change", () => save({ scoreShieldEnabled: shieldInput.checked }));
  encouragementInput.addEventListener("change", () =>
    save({ encouragementEnabled: encouragementInput.checked }),
  );
  syncInput.addEventListener("change", async () => {
    await save({ syncEnabled: syncInput.checked });
    renderSyncDescription(syncInput.checked);
  });
  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        void save({ defaultMode: input.value as FreshAttemptMode });
      }
    });
  }
  renderDebugLog(records);
  clearDebugLog.addEventListener("click", async () => {
    await repository.clearDebugLog();
    renderDebugLog([]);
    announceSaved("Log cleared");
  });
  void repository.retryDirtySync().catch(() => undefined);
}

async function save(patch: Parameters<typeof repository.writeSettings>[0]): Promise<void> {
  try {
    await repository.writeSettings(patch);
    announceSaved("Settings saved");
  } catch {
    announceSaved("Couldn’t save");
  }
}

function renderDebugLog(records: DebugLogRecord[]): void {
  debugLog.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "debug-empty";
    empty.textContent = "No compatibility events.";
    debugLog.append(empty);
    clearDebugLog.hidden = true;
    return;
  }
  clearDebugLog.hidden = false;
  for (const record of [...records].reverse().slice(0, 20)) {
    const row = document.createElement("article");
    const heading = document.createElement("strong");
    heading.textContent = record.event;
    const details = document.createElement("span");
    const facts = Object.entries(record.facts)
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join(" · ");
    details.textContent = `${formatTimestamp(record.occurredAt)}${facts ? ` · ${facts}` : ""}`;
    row.append(heading, details);
    debugLog.append(row);
  }
}

function announceSaved(message: string): void {
  saveStatus.textContent = message;
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1_500);
}

function renderSyncDescription(enabled: boolean): void {
  syncDescription.textContent = enabled
    ? "Saved here and synced by your browser."
    : "Progress stays on this device.";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required settings element: ${id}`);
  }
  return element as T;
}
