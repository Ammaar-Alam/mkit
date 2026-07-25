import "./popup.css";
import { summarizeSession } from "../core/summary";
import { type AttemptRecord, createChromeStorageRepository, type SessionRecord } from "../storage";

const protectInput = requiredElement<HTMLInputElement>("protect-reviews");
const shieldInput = requiredElement<HTMLInputElement>("score-shield");
const protectionStatus = requiredElement("protection-status");
const protectState = requiredElement("protect-state");
const shieldState = requiredElement("shield-state");
const saveStatus = requiredElement("save-status");
const activeSessions = requiredElement("active-sessions");
const sessionHistory = requiredElement("session-history");
const storageState = requiredElement("storage-state");
const storageDetail = requiredElement("storage-detail");
const openSettings = requiredElement<HTMLButtonElement>("open-settings");
const repository = createChromeStorageRepository();

void initialize();

async function initialize(): Promise<void> {
  const [settings, sessions, attempts, syncStatus] = await Promise.all([
    repository.getSettings(),
    repository.listSessions(),
    repository.listAttempts(),
    repository.getSyncStatus(),
  ]);
  render(settings.enabled, settings.scoreShieldEnabled);
  renderSessions(sessions, attempts);
  renderStorage(
    settings.syncEnabled,
    syncStatus.dirty,
    syncStatus.someNotesLocalOnly,
    syncStatus.lastErrorCode !== undefined,
  );
  void repository.retryDirtySync().catch(() => undefined);

  protectInput.addEventListener("change", async () => {
    await saveSetting({ enabled: protectInput.checked });
  });

  shieldInput.addEventListener("change", async () => {
    await saveSetting({ scoreShieldEnabled: shieldInput.checked });
  });

  openSettings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

function render(enabled: boolean, scoreShieldEnabled: boolean): void {
  protectInput.checked = enabled;
  shieldInput.checked = scoreShieldEnabled;
  protectState.textContent = enabled ? "On" : "Off";
  shieldState.textContent = scoreShieldEnabled ? "On" : "Off";
  protectionStatus.textContent = enabled ? "Protection on" : "Protection off";
}

async function saveSetting(patch: Parameters<typeof repository.writeSettings>[0]): Promise<void> {
  try {
    const next = await repository.writeSettings(patch);
    render(next.enabled, next.scoreShieldEnabled);
    announce("Saved");
  } catch {
    renderError();
  }
}

function renderSessions(sessions: SessionRecord[], attempts: AttemptRecord[]): void {
  const examNumbers = new Map(
    [...new Set(sessions.map((session) => session.examKey))]
      .sort((left, right) => left.localeCompare(right))
      .map((examKey, index) => [examKey, index + 1]),
  );
  const active = sessions
    .filter((session) => session.status === "active")
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const history = sessions
    .filter((session) => session.status !== "active")
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 4);

  activeSessions.replaceChildren(
    ...(active.length === 0
      ? [emptyState("No active attempts.", "Open a completed score report to start.")]
      : active.map((session) =>
          sessionCard(
            session,
            examNumbers.get(session.examKey) ?? 1,
            attempts.filter((attempt) => attempt.sessionId === session.id),
            "Saved. Open the review to continue.",
          ),
        )),
  );
  sessionHistory.replaceChildren(
    ...(history.length === 0
      ? [emptyState("No finished sessions yet.", "Your reflections will collect here.")]
      : history.map((session) =>
          sessionCard(
            session,
            examNumbers.get(session.examKey) ?? 1,
            attempts.filter((attempt) => attempt.sessionId === session.id),
          ),
        )),
  );
}

function sessionCard(
  session: SessionRecord,
  examNumber: number,
  attempts: AttemptRecord[],
  detail?: string,
): HTMLElement {
  const article = document.createElement("article");
  article.className = "session-card";
  const summary = summarizeSession(session, attempts);
  const heading = document.createElement("strong");
  heading.textContent = `Full-length ${examNumber} · ${titleCase(session.mode)}`;
  const meta = document.createElement("span");
  meta.textContent =
    detail ??
    `${formatDate(session.completedAt ?? session.updatedAt)} · ${summary.counts.correct} got it · ${summary.counts.needsReview} need review`;
  article.append(heading, meta);
  return article;
}

function emptyState(title: string, detail: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = detail;
  empty.append(heading, copy);
  return empty;
}

function renderStorage(
  syncEnabled: boolean,
  dirty: boolean,
  someNotesLocalOnly: boolean,
  failed: boolean,
): void {
  storageState.textContent = syncEnabled ? "Browser sync on" : "Saved on this device";
  storageDetail.textContent = someNotesLocalOnly
    ? "Some notes are only on this device"
    : failed
      ? "Sync will retry"
      : dirty && syncEnabled
        ? "Syncing"
        : "";
}

function renderError(): void {
  announce("Couldn’t save");
  protectInput.disabled = true;
  shieldInput.disabled = true;
}

function announce(message: string): void {
  saveStatus.textContent = message;
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1_500);
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required popup element: ${id}`);
  }
  return element as T;
}
