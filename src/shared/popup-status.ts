export const POPUP_STATUS_MESSAGE = "mkit:popup-status";

/**
 * Reported when a recognized review passed capability admission but MKit's own
 * startup could not finish. A fixed code keeps the report content-free: an
 * exception message can embed page-derived text.
 */
export const CONTENT_STARTUP_FAILED_ISSUE = "STARTUP_FAILED";

/** Reported when route or capability detection itself threw. */
export const CONTENT_DETECTION_FAILED_ISSUE = "DETECTION_FAILED";

export type ContentRouteKind = "review" | "incomplete-review" | "non-review";

export interface ContentStatusResponse {
  attached: boolean;
  route: ContentRouteKind;
  /**
   * Content-free adapter issue codes explaining why a recognized review was not
   * covered. Empty when protection is armed or the page is not a review.
   */
  issues: string[];
}
