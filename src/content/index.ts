import { AamcFullLengthReviewAdapter } from "../adapter/AamcFullLengthReviewAdapter";
import { ReviewController } from "../core/review-controller";
import { POPUP_STATUS_MESSAGE } from "../shared/popup-status";
import { createChromeStorageRepository } from "../storage";
import { startContentLifecycle } from "./lifecycle";
import { createPreflight } from "./preflight";

const runtimeUrl = (path: string): string =>
  typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
const uiCss = __MKIT_UI_CSS__
  .replaceAll("__MKIT_ATKINSON_URL__", runtimeUrl("fonts/AtkinsonHyperlegibleNext-Variable.ttf"))
  .replaceAll("__MKIT_LITERATA_URL__", runtimeUrl("fonts/Literata-Variable.ttf"));

const lifecycle = startContentLifecycle({
  createAdapter: () => new AamcFullLengthReviewAdapter(document, () => new URL(location.href)),
  createPreflight,
  createController: (adapter, preflight) =>
    new ReviewController({
      adapter,
      preflight,
      repository: createChromeStorageRepository(),
      uiCss,
    }),
});

// The popup cannot read tab URLs without a host permission, so the content script
// reports its own attachment state instead.
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if ((message as { type?: unknown } | null)?.type !== POPUP_STATUS_MESSAGE) {
    return false;
  }
  sendResponse(lifecycle.status());
  return false;
});
