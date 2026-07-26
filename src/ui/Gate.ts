import {
  button,
  element,
  firstFocusable,
  folioHeader,
  icon,
  mountView,
  nextId,
  primaryButton,
  scheduleFocus,
  trapFocus,
} from "./dom";
import type { GateProps, MKitViewHandle } from "./types";

export function mountGate(
  target: HTMLElement | ShadowRoot,
  props: GateProps,
): MKitViewHandle<GateProps> {
  const headingId = nextId("gate-heading");
  const handle = mountView(target, "mkit-surface mkit-gate", props, (root, next, firstRender) => {
    root.replaceChildren();
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", headingId);
    root.setAttribute("aria-busy", String(next.state === "busy"));
    root.setAttribute("tabindex", "-1");
    if (!root.hasAttribute("data-focus-trap-ready")) {
      root.setAttribute("data-focus-trap-ready", "true");
      root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          return;
        }
        trapFocus(event, root);
      });
    }

    const panel = element("div", { className: "mkit-gate__panel" });
    if (next.state === "busy") {
      panel.append(
        folioHeader("Fresh Attempt", "Preparing a clean view…", headingId),
        element(
          "div",
          { className: "mkit-preparing", attributes: { role: "status", "aria-live": "polite" } },
          icon("shield"),
          element("span", { text: "Checking this review before anything is shown." }),
        ),
      );
    } else if (next.state === "unsupported") {
      panel.append(
        folioHeader("Fresh Attempt", "This review is still covered.", headingId),
        element("p", {
          className: "mkit-lede",
          text: "MKit couldn’t verify this page layout.",
        }),
        capabilityList(next.capabilities),
        element(
          "div",
          { className: "mkit-actions mkit-actions--stacked" },
          button("Try again", "mkit-button mkit-button--primary", next.onRetryDetection, {
            focusKey: "retry-detection",
            icon: "shield",
          }),
          button("Normal review", "mkit-button mkit-button--quiet", next.onNormalReview, {
            focusKey: "normal-review",
            icon: null,
          }),
        ),
      );
    } else if (next.state === "conflict") {
      panel.append(
        folioHeader("Fresh Attempt", "An attempt is already in progress.", headingId),
        element("p", {
          className: "mkit-lede",
          text: "Resume it, or archive it before starting again.",
        }),
        element(
          "div",
          { className: "mkit-actions mkit-actions--stacked" },
          primaryButton("Resume", next.onResume, {
            focusKey: "resume",
          }),
          button("Archive attempt", "mkit-button mkit-button--secondary", next.onArchive, {
            focusKey: "archive",
            icon: null,
          }),
          button("Keep studying", "mkit-button mkit-button--quiet", next.onResume, {
            focusKey: "keep-studying",
            icon: null,
          }),
          button("Normal review", "mkit-button mkit-button--quiet", next.onNormalReview, {
            focusKey: "normal-review",
            icon: null,
          }),
        ),
      );
      if (next.activeSession) {
        panel.insertBefore(
          activeSession(next.activeSession, next.onResume, false),
          panel.children[1] ?? null,
        );
      }
    } else {
      panel.append(
        folioHeader("Fresh Attempt", "How do you want to review?", headingId),
        element("p", {
          className: "mkit-lede",
          text: "Your prior attempt stays hidden until you choose otherwise.",
        }),
      );
      if (next.activeSession) {
        panel.append(activeSession(next.activeSession, next.onResume));
        if (next.encouragementEnabled) {
          panel.append(
            element("p", {
              className: "mkit-encouragement",
              text: "Saved. Pick up here when you’re ready.",
            }),
          );
        }
      }
      panel.append(
        element(
          "div",
          { className: "mkit-mode-grid", attributes: { "aria-label": "Fresh Attempt mode" } },
          modeButton(
            "Practice",
            "Check each answer when you’re ready.",
            () => next.onSelectMode("practice"),
            "practice",
          ),
          modeButton(
            "Test",
            "Finish before seeing results.",
            () => next.onSelectMode("test"),
            "test",
          ),
        ),
        button(
          "Normal review",
          "mkit-button mkit-button--quiet mkit-normal-review",
          next.onNormalReview,
          {
            focusKey: "normal-review",
            icon: null,
          },
        ),
      );
    }

    root.append(panel);
    if (firstRender && next.autoFocus !== false) {
      const preferred =
        root.querySelector<HTMLElement>("[data-focus-key='resume']") ??
        firstFocusable(root) ??
        root;
      scheduleFocus(preferred);
    }
  });
  return handle;
}

function modeButton(
  label: string,
  description: string,
  onSelect: () => void,
  focusKey: string,
): HTMLButtonElement {
  const control = element("button", {
    className: "mkit-mode",
    attributes: { type: "button", "data-focus-key": focusKey },
  });
  control.addEventListener("click", onSelect);
  control.append(
    element("span", { className: "mkit-mode__name", text: label }),
    element("span", { className: "mkit-mode__description", text: description }),
    icon("arrow"),
  );
  return control;
}

function activeSession(
  session: NonNullable<GateProps["activeSession"]>,
  onResume: () => void,
  showButton = true,
): HTMLElement {
  const { progress } = session;
  const progressText = `${progress.current} of ${progress.total}`;
  const sectionText = progress.section ? `${progress.section} · ` : "";
  const container = element("section", {
    className: `mkit-resume${showButton ? "" : " mkit-resume--summary"}`,
    attributes: { "aria-label": "Active Fresh Attempt" },
  });
  container.append(
    element(
      "span",
      { className: "mkit-resume__copy" },
      element("strong", { text: session.mode === "practice" ? "Practice" : "Test" }),
      element("span", { text: `${sectionText}${progressText}` }),
    ),
  );
  if (showButton) {
    container.append(
      primaryButton("Resume", onResume, {
        focusKey: "resume",
      }),
    );
  }
  return container;
}

function capabilityList(capabilities: GateProps["capabilities"]): HTMLElement {
  const values = [
    ["Question area", capabilities?.questionArea ?? false],
    ["Question navigator", capabilities?.navigator ?? false],
    ["Answer feedback", capabilities?.answerFeedback ?? false],
  ] as const;
  return element(
    "ul",
    { className: "mkit-capabilities", attributes: { "aria-label": "Page checks" } },
    ...values.map(([label, found]) =>
      element(
        "li",
        { className: found ? "is-found" : "is-missing" },
        icon(found ? "check" : "warning"),
        element("span", { text: label }),
        element("strong", { text: found ? "Found" : "Not found" }),
      ),
    ),
  );
}
