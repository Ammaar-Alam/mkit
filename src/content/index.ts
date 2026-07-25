import "./preflight";
import { AamcFullLengthReviewAdapter } from "../adapter/AamcFullLengthReviewAdapter";
import { ReviewController } from "../core/review-controller";
import { createChromeStorageRepository } from "../storage";

const preflight = globalThis.__mkitPreflight;
if (!preflight) {
  throw new Error("MKit preflight failed to initialize.");
}

const runtimeUrl = (path: string): string =>
  typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
const uiCss = __MKIT_UI_CSS__
  .replaceAll("__MKIT_ATKINSON_URL__", runtimeUrl("fonts/AtkinsonHyperlegibleNext-Variable.ttf"))
  .replaceAll("__MKIT_LITERATA_URL__", runtimeUrl("fonts/Literata-Variable.ttf"));

const controller = new ReviewController({
  adapter: new AamcFullLengthReviewAdapter(document, () => new URL(location.href)),
  preflight,
  repository: createChromeStorageRepository(),
  uiCss,
});
controller.start();
