import "./popup.css";
import { summarizeSession } from "../core/summary";
import {
  type AttemptRecord,
  createChromeStorageRepository,
  type SessionRecord,
  type SettingsRecord,
} from "../storage";
import { getPopupPageState, type PopupPageState, reconcilePopupPageState } from "./page-status";

const mkitControl = requiredElement("mkit-control");
const mkitInput = requiredElement<HTMLInputElement>("mkit-enabled");
const mkitState = requiredElement("mkit-state");
const shieldInput = requiredElement<HTMLInputElement>("score-shield");
const pageState = requiredElement("page-state");
const pageContext = requiredElement("page-status").parentElement;
const pageStatus = requiredElement("page-status");
const pageDetail = requiredElement("page-detail");
const hideSectionResultMarksInput = requiredElement<HTMLInputElement>("hide-section-result-marks");
const resultMarksState = requiredElement("result-marks-state");
const clearPreviousHighlightsInput = requiredElement<HTMLInputElement>("clear-previous-highlights");
const highlightsState = requiredElement("highlights-state");
const clearPreviousCrossOutsInput = requiredElement<HTMLInputElement>("clear-previous-cross-outs");
const crossOutsState = requiredElement("cross-outs-state");
const shieldState = requiredElement("shield-state");
const saveStatus = requiredElement("save-status");
const activeSessions = requiredElement("active-sessions");
const sessionHistory = requiredElement("session-history");
const historySection = requiredElement("history-section");
const storageState = requiredElement("storage-state");
const storageDetail = requiredElement("storage-detail");
const openSettings = requiredElement<HTMLButtonElement>("open-settings");
const repository = createChromeStorageRepository();
let currentSettings: SettingsRecord | null = null;
let currentPageState: PopupPageState | null = null;

void initialize();

async function initialize(): Promise<void> {
  const [settings, sessions, attempts, syncStatus] = await Promise.all([
    repository.getSettings(),
    repository.listSessions(),
    repository.listAttempts(),
    repository.getSyncStatus(),
  ]);
  currentSettings = settings;
  renderSettings(settings);
  renderSessions(sessions, attempts);
  renderStorage(
    settings.syncEnabled,
    syncStatus.dirty,
    syncStatus.someNotesLocalOnly,
    syncStatus.lastErrorCode !== undefined,
  );
  currentPageState = await getPopupPageState();
  renderPageState(currentPageState, settings.enabled);
  void repository.retryDirtySync().catch(() => undefined);

  mkitInput.addEventListener("change", () => {
    void saveEnabledSetting();
  });

  shieldInput.addEventListener("change", () => {
    void savePageSetting({ scoreShieldEnabled: shieldInput.checked });
  });

  hideSectionResultMarksInput.addEventListener("change", () => {
    void savePageSetting({
      hideSectionResultMarksEnabled: hideSectionResultMarksInput.checked,
    });
  });

  clearPreviousHighlightsInput.addEventListener("change", () => {
    void savePageSetting({
      clearPreviousHighlightsEnabled: clearPreviousHighlightsInput.checked,
    });
  });

  clearPreviousCrossOutsInput.addEventListener("change", () => {
    void savePageSetting({
      clearPreviousCrossOutsEnabled: clearPreviousCrossOutsInput.checked,
    });
  });

  openSettings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

async function saveEnabledSetting(): Promise<void> {
  await savePageSetting({ enabled: mkitInput.checked });
}

async function savePageSetting(
  patch: Parameters<typeof repository.writeSettings>[0],
): Promise<void> {
  const settings = await saveSetting(patch);
  if (!settings) return;
  currentPageState = await reconcilePopupPageState();
  renderPageState(currentPageState, settings.enabled);
}

function renderSettings(settings: SettingsRecord): void {
  mkitInput.checked = settings.enabled;
  mkitState.textContent = settings.enabled ? "On" : "Off";
  mkitControl.dataset.enabled = String(settings.enabled);
  hideSectionResultMarksInput.checked = settings.hideSectionResultMarksEnabled;
  resultMarksState.textContent = settings.hideSectionResultMarksEnabled ? "On" : "Off";
  clearPreviousHighlightsInput.checked = settings.clearPreviousHighlightsEnabled;
  highlightsState.textContent = settings.clearPreviousHighlightsEnabled ? "On" : "Off";
  clearPreviousCrossOutsInput.checked = settings.clearPreviousCrossOutsEnabled;
  crossOutsState.textContent = settings.clearPreviousCrossOutsEnabled ? "On" : "Off";
  shieldInput.checked = settings.scoreShieldEnabled;
  shieldState.textContent = settings.scoreShieldEnabled ? "On" : "Off";
}

function renderPageState(state: PopupPageState, enabled: boolean): void {
  if (!enabled) {
    if (pageContext instanceof HTMLElement) {
      pageContext.dataset.status = "disabled";
    }
    pageState.textContent = "Off";
    pageStatus.textContent = "MKit is off";
    pageDetail.textContent = "This page is unchanged.";
    return;
  }
  if (pageContext instanceof HTMLElement) {
    pageContext.dataset.status = state.status;
  }
  if (state.status === "active") {
    pageState.textContent = "Ready";
    pageStatus.textContent =
      state.surface === "section-overview" ? "Results are hidden" : "Fresh Attempt is ready";
  } else if (state.status === "supported-not-running") {
    pageState.textContent = "Not covered";
    pageStatus.textContent = "Review not verified";
  } else {
    pageState.textContent = "Not on a review";
    pageStatus.textContent = "No supported review open";
  }
  pageDetail.textContent =
    state.issues && state.issues.length > 0
      ? `${state.detail} (${state.issues.join(", ")})`
      : state.detail;
}

async function saveSetting(
  patch: Parameters<typeof repository.writeSettings>[0],
): Promise<SettingsRecord | null> {
  const previous = currentSettings;
  try {
    const next = await repository.writeSettings(patch);
    currentSettings = next;
    renderSettings(next);
    if (currentPageState) {
      renderPageState(currentPageState, next.enabled);
    }
    announce("Saved");
    return next;
  } catch {
    if (previous) {
      renderSettings(previous);
      if (currentPageState) {
        renderPageState(currentPageState, previous.enabled);
      }
    }
    announce("Couldn’t save");
    return null;
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
      ? [emptyState("No active attempts.", "Start from a completed score report.")]
      : active.map((session) =>
          sessionCard(
            session,
            examNumbers.get(session.examKey) ?? 1,
            attempts.filter((attempt) => attempt.sessionId === session.id),
            "Saved here.",
          ),
        )),
  );
  historySection.hidden = history.length === 0;
  sessionHistory.replaceChildren(
    ...(history.length === 0
      ? []
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
