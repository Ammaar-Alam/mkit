import "./popup.css";
import { readSettings, writeSettings } from "../shared/settings";

const protectInput = requiredElement<HTMLInputElement>("protect-reviews");
const shieldInput = requiredElement<HTMLInputElement>("score-shield");
const protectionStatus = requiredElement("protection-status");
const protectState = requiredElement("protect-state");
const shieldState = requiredElement("shield-state");
const saveStatus = requiredElement("save-status");

void initialize();

async function initialize(): Promise<void> {
  const settings = await readSettings();
  render(settings.enabled, settings.scoreShieldEnabled);

  protectInput.addEventListener("change", async () => {
    const next = await writeSettings({ enabled: protectInput.checked });
    render(next.enabled, next.scoreShieldEnabled);
    announceSaved();
  });

  shieldInput.addEventListener("change", async () => {
    const next = await writeSettings({ scoreShieldEnabled: shieldInput.checked });
    render(next.enabled, next.scoreShieldEnabled);
    announceSaved();
  });
}

function render(enabled: boolean, scoreShieldEnabled: boolean): void {
  protectInput.checked = enabled;
  shieldInput.checked = scoreShieldEnabled;
  protectState.textContent = enabled ? "On" : "Off";
  shieldState.textContent = scoreShieldEnabled ? "On" : "Off";
  protectionStatus.textContent = enabled ? "Protection on" : "Protection off";
}

function announceSaved(): void {
  saveStatus.textContent = "Saved";
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1_500);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required popup element: ${id}`);
  }
  return element as T;
}
