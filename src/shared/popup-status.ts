export const POPUP_STATUS_MESSAGE = "mkit:popup-status";

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
