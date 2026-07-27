import { AamcFullLengthReviewAdapter } from "../adapter/AamcFullLengthReviewAdapter";
import { ReviewController } from "../core/review-controller";
import { CONTENT_RECONCILE_MESSAGE, POPUP_STATUS_MESSAGE } from "../shared/popup-status";
import { createChromeStorageRepository } from "../storage";
import { startContentLifecycle } from "./lifecycle";
import { createPreflight } from "./preflight";
import { hasSettingsStorageChange } from "./settings-change";

const runtimeUrl = (path: string): string =>
  typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
const uiCss = __MKIT_UI_CSS__
  .replaceAll("__MKIT_ATKINSON_URL__", runtimeUrl("fonts/AtkinsonHyperlegibleNext-Variable.ttf"))
  .replaceAll("__MKIT_LITERATA_URL__", runtimeUrl("fonts/Literata-Variable.ttf"))
  .replaceAll("__MKIT_MARK_URL__", runtimeUrl("icons/icon-48.png"));
const repository = createChromeStorageRepository();

const lifecycle = startContentLifecycle({
  createAdapter: () => new AamcFullLengthReviewAdapter(document, () => new URL(location.href)),
  createPreflight,
  createController: (adapter, preflight) =>
    new ReviewController({
      adapter,
      preflight,
      repository,
      uiCss,
    }),
});

let settingsRefreshGeneration = 0;

const refreshSettings = async (): Promise<void> => {
  const generation = ++settingsRefreshGeneration;
  const settings = await repository.getSettings();
  if (generation !== settingsRefreshGeneration) return;
  lifecycle.applySettings(settings);
};

void refreshSettings().catch(() => undefined);

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (!hasSettingsStorageChange(changes, areaName)) return;
  void refreshSettings().catch(() => undefined);
});

// The popup cannot read tab URLs without a host permission, so the content script
// reports its own attachment state instead.
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: unknown } | null)?.type;
  if (type === POPUP_STATUS_MESSAGE) {
    sendResponse(lifecycle.status());
    return false;
  }
  if (type === CONTENT_RECONCILE_MESSAGE) {
    void refreshSettings()
      .catch(() => undefined)
      .then(() => sendResponse(lifecycle.status()));
    return true;
  }
  return false;
});
