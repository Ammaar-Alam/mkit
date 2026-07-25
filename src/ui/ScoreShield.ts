import { button, element, folioHeader, mountView, nextId, scheduleFocus } from "./dom";
import type { MKitViewHandle, ScoreShieldProps } from "./types";

export function mountScoreShield(
  target: HTMLElement | ShadowRoot,
  props: ScoreShieldProps,
): MKitViewHandle<ScoreShieldProps> {
  const headingId = nextId("score-shield-heading");
  return mountView(target, "mkit-surface mkit-score-shield", props, (root, next, firstRender) => {
    root.replaceChildren();
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", headingId);

    const heading =
      next.state === "unsupported" ? "This score area is still covered." : "Score hidden";
    const copy =
      next.state === "unsupported"
        ? "MKit couldn’t verify every score area."
        : "Review first, when you’re ready.";
    const reveal = button("Show my score", "mkit-button mkit-button--primary", next.onReveal, {
      focusKey: "reveal-score",
      icon: "shield",
    });
    root.append(
      element(
        "div",
        { className: "mkit-score-shield__panel" },
        folioHeader("Score Shield", heading, headingId),
        element(
          "div",
          {
            className: "mkit-score-smudges",
            attributes: { "aria-hidden": true },
          },
          element("i"),
          element("i"),
          element("i"),
        ),
        element("p", { className: "mkit-lede", text: copy }),
        reveal,
      ),
    );
    if (next.showFreshAttemptAction) {
      root.append(
        button("Fresh Attempt", "mkit-button mkit-button--fresh", next.onFreshAttempt, {
          focusKey: "fresh-attempt",
          icon: "arrow",
        }),
      );
    }
    if (firstRender && next.state === "unsupported") scheduleFocus(reveal);
  });
}
