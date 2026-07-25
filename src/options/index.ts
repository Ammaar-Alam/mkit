import "./options.css";
import { type FreshAttemptMode, readSettings, writeSettings } from "../shared/settings";

const protectInput = requiredElement<HTMLInputElement>("protect-reviews");
const shieldInput = requiredElement<HTMLInputElement>("score-shield");
const encouragementInput = requiredElement<HTMLInputElement>("encouragement");
const syncInput = requiredElement<HTMLInputElement>("browser-sync");
const syncDescription = requiredElement("sync-description");
const saveStatus = requiredElement("save-status");
const modeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="default-mode"]'),
);

void initialize();

async function initialize(): Promise<void> {
  const settings = await readSettings();
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
}

async function save(patch: Parameters<typeof writeSettings>[0]): Promise<void> {
  await writeSettings(patch);
  saveStatus.textContent = "Settings saved";
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1_500);
}

function renderSyncDescription(enabled: boolean): void {
  syncDescription.textContent = enabled
    ? "Saved here and synced by your browser."
    : "Progress stays on this device.";
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required settings element: ${id}`);
  }
  return element as T;
}
