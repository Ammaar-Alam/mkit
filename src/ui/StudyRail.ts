import type { AnswerSelection, AttemptTag, Confidence } from "../storage/schema";
import {
  button,
  element,
  folioHeader,
  icon,
  mountView,
  nextId,
  primaryButton,
  scheduleFocus,
} from "./dom";
import type { MKitViewHandle, StudyRailProps } from "./types";

const ANSWERS: readonly AnswerSelection[] = ["A", "B", "C", "D"];
const CONFIDENCE: readonly Confidence[] = ["guessing", "unsure", "confident"];
const TAGS: readonly AttemptTag[] = ["content gap", "reasoning", "misread", "timing"];

export function mountStudyRail(
  target: HTMLElement | ShadowRoot,
  props: StudyRailProps,
): MKitViewHandle<StudyRailProps> {
  const headingId = nextId("rail-heading");
  const answersId = nextId("answers");
  const noteId = nextId("note");
  const reflectionId = nextId("reflection");
  const contentId = nextId("rail-content");
  let previousStage: StudyRailProps["stage"] | undefined;
  let previousFinishConfirmation = false;
  let minimized = false;

  return mountView(target, "mkit-surface mkit-study-rail", props, (root, next) => {
    root.replaceChildren();
    root.classList.toggle("is-minimized", minimized);
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", headingId);

    const modeLabel = next.mode === "practice" ? "Practice" : "Test";
    const content = element("div", {
      className: "mkit-study-rail__body",
      attributes: {
        id: contentId,
        "aria-hidden": minimized ? "true" : undefined,
      },
    });
    content.inert = minimized;
    root.append(
      folioHeader(
        "Fresh Attempt",
        modeLabel,
        headingId,
        railToggle(
          root,
          content,
          contentId,
          () => minimized,
          (value) => {
            minimized = value;
          },
        ),
      ),
    );
    content.append(
      progress(next),
      answerControls(next),
      confidenceControls(next),
      reflectionToggles(next),
    );

    const feedbackVisible =
      next.stage === "practice-checked" ||
      next.stage === "practice-revealed" ||
      next.stage === "original-revealed" ||
      next.stage === "test-finished";
    if (feedbackVisible && next.outcome) content.append(outcome(next.outcome));

    if (next.mode === "practice") {
      content.append(practiceActions(next, answersId, reflectionId));
    } else {
      content.append(testActions(next, answersId, reflectionId));
    }

    if (next.answersRevealed) {
      content.append(
        element("p", {
          className: "mkit-reveal-status",
          text: "Answers shown in the review.",
          attributes: { id: answersId, role: "status", "aria-live": "polite" },
        }),
      );
    }

    if (next.stage === "original-revealed") {
      content.append(reflectionEditor(next, noteId, reflectionId));
    }

    if (next.encouragement) {
      content.append(
        element("p", {
          className: "mkit-encouragement",
          text: encouragementCopy(next.encouragement),
        }),
      );
    }

    if (next.canNavigatePrevious || next.canNavigateNext) {
      content.append(navigation(next));
    }
    if (next.saveState !== "idle") {
      content.append(saveStatus(next.saveState));
    }
    root.append(content);
    if (previousStage !== next.stage) {
      if (next.stage === "original-revealed") {
        scheduleFocus(root.querySelector<HTMLElement>("[data-focus-key='private-note']"));
      } else if (next.stage === "practice-checked" || next.stage === "test-finished") {
        scheduleFocus(root.querySelector<HTMLElement>("[data-focus-key='reveal-answers']"));
      } else if (next.stage === "masked" && previousStage !== undefined) {
        scheduleFocus(root.querySelector<HTMLElement>("[data-focus-key='answer-A']"));
      }
    } else if (!previousFinishConfirmation && next.finishConfirmationOpen) {
      scheduleFocus(root.querySelector<HTMLElement>("[data-focus-key='finish-confirm']"));
    }
    previousStage = next.stage;
    previousFinishConfirmation = next.finishConfirmationOpen ?? false;
  });
}

function railToggle(
  root: HTMLElement,
  content: HTMLElement,
  contentId: string,
  getMinimized: () => boolean,
  setMinimized: (value: boolean) => void,
): HTMLButtonElement {
  const control = button(
    getMinimized() ? "Expand" : "Collapse",
    "mkit-rail-toggle",
    () => {
      const minimize = !getMinimized();
      setMinimized(minimize);
      root.classList.toggle("is-minimized", minimize);
      control.setAttribute("aria-expanded", String(!minimize));
      control.setAttribute("aria-label", `${minimize ? "Expand" : "Collapse"} Fresh Attempt rail`);
      control.querySelector("span")?.replaceChildren(minimize ? "Expand" : "Collapse");
      content.setAttribute("aria-hidden", String(minimize));
      content.inert = minimize;
    },
    {
      expanded: !getMinimized(),
      controls: contentId,
      focusKey: "rail-toggle",
      ariaLabel: `${getMinimized() ? "Expand" : "Collapse"} Fresh Attempt rail`,
      icon: "plus-minus",
    },
  );
  return control;
}

function progress(props: StudyRailProps): HTMLElement {
  const current = Math.max(0, Math.min(props.progress.current, props.progress.total));
  const section = props.progress.section ? `${props.progress.section} · ` : "";
  return element(
    "div",
    { className: "mkit-progress" },
    element(
      "div",
      { className: "mkit-progress__copy" },
      element("span", { text: "Current session" }),
      element("strong", { text: `${section}${current} of ${props.progress.total}` }),
    ),
    element("progress", {
      attributes: {
        max: Math.max(props.progress.total, 1),
        value: current,
        "aria-label": "Fresh Attempt progress",
      },
    }),
  );
}

function answerControls(props: StudyRailProps): HTMLElement {
  const group = element("div", {
    className: "mkit-answer-group",
    attributes: { role: "radiogroup", "aria-label": "Fresh answer" },
  });
  for (const choice of ANSWERS) {
    const eliminated = props.eliminations.includes(choice);
    const selected = !eliminated && props.selection === choice;
    const answer = element(
      "button",
      {
        className: `mkit-answer${selected ? " is-selected" : ""}${
          eliminated ? " is-eliminated" : ""
        }`,
        attributes: {
          type: "button",
          role: "radio",
          "aria-checked": String(selected),
          "aria-disabled": eliminated ? "true" : undefined,
          "aria-label": eliminated ? `Choice ${choice}, eliminated` : undefined,
          disabled: eliminated,
          "data-focus-key": `answer-${choice}`,
        },
      },
      element("span", { className: "mkit-answer__letter", text: choice }),
      element("span", {
        className: "mkit-answer__state",
        text: eliminated ? "" : selected ? "Selected" : "Choose",
      }),
    );
    answer.addEventListener("click", () => props.onSelect(choice));
    answer.addEventListener("keydown", (event) => moveWithinAnswers(event, choice, props));

    const eliminate = element(
      "button",
      {
        className: `mkit-eliminate${eliminated ? " is-active" : ""}`,
        attributes: {
          type: "button",
          "aria-pressed": String(eliminated),
          "aria-label": `${eliminated ? "Restore" : "Eliminate"} choice ${choice}`,
          "data-focus-key": `eliminate-${choice}`,
        },
      },
      icon("slash"),
      element("span", { text: eliminated ? "Restore" : "Eliminate" }),
    );
    eliminate.addEventListener("click", () => props.onToggleElimination(choice));
    group.append(
      element(
        "div",
        {
          className: `mkit-answer-row${selected ? " is-selected" : ""}${
            eliminated ? " is-eliminated" : ""
          }`,
        },
        answer,
        eliminate,
      ),
    );
  }
  return element(
    "fieldset",
    { className: "mkit-fieldset" },
    element("legend", { text: "Your answer" }),
    group,
  );
}

function moveWithinAnswers(
  event: KeyboardEvent,
  current: AnswerSelection,
  props: StudyRailProps,
): void {
  const delta =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (delta === 0) return;
  event.preventDefault();
  const index = ANSWERS.indexOf(current);
  for (let offset = 1; offset <= ANSWERS.length; offset += 1) {
    const next = ANSWERS[(index + delta * offset + ANSWERS.length) % ANSWERS.length];
    if (next && !props.eliminations.includes(next)) {
      props.onSelect(next);
      return;
    }
  }
}

function confidenceControls(props: StudyRailProps): HTMLElement {
  return element(
    "fieldset",
    { className: "mkit-fieldset mkit-fieldset--compact" },
    element("legend", { text: "Confidence" }),
    element(
      "div",
      {
        className: "mkit-segments",
        attributes: { role: "radiogroup", "aria-label": "Confidence" },
      },
      ...CONFIDENCE.map((confidence) => {
        const selected = props.confidence === confidence;
        const control = element("button", {
          className: `mkit-segment${selected ? " is-selected" : ""}`,
          text: confidenceLabel(confidence),
          attributes: {
            type: "button",
            role: "radio",
            "aria-checked": String(selected),
            "data-focus-key": `confidence-${confidence}`,
          },
        });
        control.addEventListener("click", () =>
          props.onConfidenceChange(selected ? null : confidence),
        );
        return control;
      }),
    ),
  );
}

function reflectionToggles(props: StudyRailProps): HTMLElement {
  return element(
    "div",
    { className: "mkit-toggle-list" },
    toggleButton("Flag for review", "flag", props.flagged, () =>
      props.onFlagChange(!props.flagged),
    ),
    toggleButton("Review again", "circle", props.reviewAgain, () =>
      props.onReviewAgainChange(!props.reviewAgain),
    ),
  );
}

function toggleButton(
  label: string,
  iconName: "flag" | "circle",
  pressed: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const control = element(
    "button",
    {
      className: `mkit-toggle${pressed ? " is-active" : ""}`,
      attributes: {
        type: "button",
        "aria-pressed": String(pressed),
        "data-focus-key": label.toLowerCase().replaceAll(" ", "-"),
      },
    },
    icon(iconName),
    element("span", { text: label }),
    element("strong", { text: pressed ? "On" : "Off" }),
  );
  control.addEventListener("click", onClick);
  return control;
}

function outcome(value: NonNullable<StudyRailProps["outcome"]>): HTMLElement {
  const copy =
    value === "correct"
      ? { label: "Correct", icon: "check" as const }
      : value === "needs-review"
        ? { label: "Incorrect", icon: "circle" as const }
        : { label: "Couldn’t auto-check this question.", icon: "warning" as const };
  return element(
    "div",
    {
      className: `mkit-outcome mkit-outcome--${value}`,
      attributes: { role: "status", "aria-live": "polite" },
    },
    icon(copy.icon),
    element("strong", { text: copy.label }),
  );
}

function practiceActions(
  props: StudyRailProps,
  answersId: string,
  reflectionId: string,
): HTMLElement {
  const checked =
    props.stage === "practice-checked" ||
    props.stage === "practice-revealed" ||
    props.stage === "original-revealed";
  const actions = element("div", { className: "mkit-actions mkit-actions--stacked" });
  if (!checked) {
    actions.append(
      primaryButton("Check", props.onCheck, {
        disabled: props.selection === null,
        focusKey: "check",
        icon: "check",
      }),
    );
    return actions;
  }

  if (props.stage === "practice-checked") {
    actions.append(
      primaryButton("Reveal answers", props.onRevealAnswers, {
        expanded: false,
        controls: answersId,
        focusKey: "reveal-answers",
        icon: "arrow",
      }),
    );
  } else if (props.stage === "practice-revealed") {
    actions.append(
      button(
        "Reveal original attempt",
        "mkit-button mkit-button--secondary",
        props.onRevealOriginal,
        {
          expanded: false,
          controls: reflectionId,
          focusKey: "reveal-original",
          icon: "shield",
        },
      ),
    );
  }
  actions.append(
    button("Retry", "mkit-button mkit-button--quiet", props.onRetry, {
      focusKey: "retry",
      icon: null,
    }),
  );
  return actions;
}

function testActions(props: StudyRailProps, answersId: string, reflectionId: string): HTMLElement {
  const actions = element("div", { className: "mkit-actions mkit-actions--stacked" });
  if (props.stage === "test-finished" || props.stage === "original-revealed") {
    if (!props.answersRevealed && props.stage !== "original-revealed") {
      actions.append(
        primaryButton("Reveal answers", props.onRevealAnswers, {
          expanded: false,
          controls: answersId,
          focusKey: "reveal-answers",
          icon: "arrow",
        }),
      );
    }
    if (props.answersRevealed && props.stage !== "original-revealed") {
      actions.append(
        button(
          "Reveal original attempt",
          "mkit-button mkit-button--secondary",
          props.onRevealOriginal,
          {
            expanded: false,
            controls: reflectionId,
            focusKey: "reveal-original",
            icon: "shield",
          },
        ),
      );
    }
    return actions;
  }

  if (props.finishScope) {
    const finishLabel = props.finishScope === "section" ? "Finish section" : "Finish attempt";
    actions.append(
      button(finishLabel, "mkit-button mkit-button--secondary", props.onFinishRequest, {
        focusKey: "finish-request",
        icon: null,
      }),
    );
    if (props.finishConfirmationOpen) {
      actions.append(finishConfirmation(props, finishLabel));
    }
  }
  return actions;
}

function finishConfirmation(props: StudyRailProps, finishLabel: string): HTMLElement {
  const scope = props.finishScope === "section" ? "section" : "attempt";
  return element(
    "section",
    {
      className: "mkit-confirm",
      attributes: {
        role: "alertdialog",
        "aria-label": `Confirm ${finishLabel.toLowerCase()}`,
      },
    },
    element("p", {
      text: `Finish this ${scope}? Results will be available for answered questions.`,
    }),
    element(
      "div",
      { className: "mkit-actions mkit-actions--inline" },
      button(finishLabel, "mkit-button mkit-button--primary", props.onFinishConfirm, {
        focusKey: "finish-confirm",
        icon: "check",
      }),
      button("Keep working", "mkit-button mkit-button--quiet", props.onFinishCancel, {
        focusKey: "finish-cancel",
        icon: null,
      }),
    ),
  );
}

function reflectionEditor(
  props: StudyRailProps,
  noteId: string,
  reflectionId: string,
): HTMLElement {
  const note = element("textarea", {
    className: "mkit-note",
    attributes: {
      id: noteId,
      rows: 3,
      maxlength: 500,
      placeholder: "What changed in your reasoning?",
      "data-focus-key": "private-note",
    },
  });
  note.value = props.note;
  note.addEventListener("input", () => props.onNoteChange(note.value));

  return element(
    "section",
    { className: "mkit-reflection", attributes: { id: reflectionId } },
    element("label", {
      className: "mkit-label",
      text: "Private note",
      attributes: { for: noteId },
    }),
    note,
    element(
      "fieldset",
      { className: "mkit-fieldset mkit-fieldset--compact" },
      element("legend", { text: "Quick tags" }),
      element(
        "div",
        { className: "mkit-tags" },
        ...TAGS.map((tag) => {
          const selected = props.tags.includes(tag);
          const control = element("button", {
            className: `mkit-tag${selected ? " is-selected" : ""}`,
            text: tagLabel(tag),
            attributes: {
              type: "button",
              "aria-pressed": String(selected),
              "data-focus-key": `tag-${tag}`,
            },
          });
          control.addEventListener("click", () => {
            const tags = selected
              ? props.tags.filter((value) => value !== tag)
              : [...props.tags, tag];
            props.onTagsChange(tags);
          });
          return control;
        }),
      ),
    ),
  );
}

function navigation(props: StudyRailProps): HTMLElement {
  return element(
    "nav",
    { className: "mkit-navigation", attributes: { "aria-label": "Question navigation" } },
    button("Previous", "mkit-button mkit-button--quiet", () => props.onNavigate("previous"), {
      disabled: !props.canNavigatePrevious,
      focusKey: "previous",
      icon: null,
    }),
    button("Next", "mkit-button mkit-button--quiet", () => props.onNavigate("next"), {
      disabled: !props.canNavigateNext,
      focusKey: "next",
    }),
  );
}

function saveStatus(state: StudyRailProps["saveState"]): HTMLElement {
  const copy = {
    idle: "",
    saving: "Saving…",
    saved: "Saved on this device",
    error: "Couldn’t save. Your answer is still here.",
  }[state];
  return element("p", {
    className: `mkit-save mkit-save--${state}`,
    text: copy,
    attributes: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });
}

function confidenceLabel(confidence: Confidence): string {
  return confidence === "guessing" ? "Guessing" : confidence === "unsure" ? "Unsure" : "Confident";
}

function tagLabel(tag: AttemptTag): string {
  return tag === "content gap" ? "Content gap" : `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

function encouragementCopy(kind: NonNullable<StudyRailProps["encouragement"]>): string {
  if (kind === "section") return "Good place to take a breath.";
  if (kind === "complete") return "That was a full pass.";
  return "Saved. Pick up here when you’re ready.";
}
