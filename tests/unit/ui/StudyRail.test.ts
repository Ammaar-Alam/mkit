import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyRailProps } from "../../../src/ui";
import { mountScoreShield, mountStudyRail } from "../../../src/ui";

const RAIL_WIDTH = 352;
const RAIL_HEIGHT = 600;

describe("Study Rail placement", () => {
  let railHeight = RAIL_HEIGHT;
  let viewportWidth = 1_000;
  let viewportHeight = 800;

  beforeEach(() => {
    railHeight = RAIL_HEIGHT;
    viewportWidth = 1_000;
    viewportHeight = 800;
    vi.spyOn(window, "innerWidth", "get").mockImplementation(() => viewportWidth);
    vi.spyOn(window, "innerHeight", "get").mockImplementation(() => viewportHeight);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.classList.contains("mkit-study-rail")) return new DOMRect();
      const top = numericStyle(this.style.top);
      const width = Math.min(RAIL_WIDTH, viewportWidth - 32);
      const maxHeight = numericStyle(this.style.maxHeight);
      const height = this.classList.contains("is-minimized") ? 48 : Math.min(railHeight, maxHeight);
      const left = this.style.left
        ? numericStyle(this.style.left)
        : viewportWidth - numericStyle(this.style.right) - width;
      return new DOMRect(left, top, width, height);
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("uses a finite viewport anchor and derives its height from that top edge", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 220, right: 28 }));

    expect(view.element.style.top).toBe("220px");
    expect(view.element.style.right).toBe("28px");
    expect(view.element.style.left).toBe("");
    expect(view.element.style.maxHeight).toBe("564px");
    expect(view.element.classList.contains("is-moved")).toBe(false);

    view.update(props({ top: Number.NaN, right: Number.POSITIVE_INFINITY }));

    expect(view.element.style.top).toBe("16px");
    expect(view.element.style.right).toBe("16px");
    expect(view.element.style.maxHeight).toBe("768px");
    view.destroy();
  });

  it("preserves its rendered height when moved toward the top", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 220, right: 28 }));
    const initialHeight = view.element.getBoundingClientRect().height;
    const grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Study Rail grip was not rendered.");

    for (let index = 0; index < 6; index += 1) {
      grip.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp", shiftKey: true }),
      );
    }

    expect(initialHeight).toBe(564);
    expect(view.element.style.top).toBe("16px");
    expect(view.element.style.maxHeight).toBe(`${initialHeight}px`);
    expect(view.element.getBoundingClientRect().height).toBe(initialHeight);
    view.destroy();
  });

  it("allows downward movement by shrinking within the remaining viewport", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 220, right: 28 }));
    const grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Study Rail grip was not rendered.");

    grip.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", shiftKey: true }),
    );

    expect(view.element.style.top).toBe("260px");
    expect(view.element.style.maxHeight).toBe("524px");
    expect(view.element.getBoundingClientRect().height).toBe(524);
    expect(view.element.getBoundingClientRect().bottom).toBe(784);
    view.destroy();
  });

  it("refreshes the preserved height on later keyboard movements", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 120, right: 32 }));
    const grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Study Rail grip was not rendered.");

    grip.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(view.element.style.maxHeight).toBe("600px");

    railHeight = 320;
    grip.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(view.element.style.maxHeight).toBe("320px");

    railHeight = RAIL_HEIGHT;
    expect(view.element.getBoundingClientRect().height).toBe(320);
    view.destroy();
  });

  it("keeps a manual move ephemeral, clamps it on resize, and sends Home to the latest anchor", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 120, right: 32 }));
    let grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Study Rail grip was not rendered.");

    for (let index = 0; index < 20; index += 1) {
      grip.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", shiftKey: true }),
      );
    }

    expect(view.element.classList.contains("is-moved")).toBe(true);
    expect(view.element.style.left).toBe("632px");
    expect(view.element.style.right).toBe("");

    view.update(props({ top: 240, right: 48 }));
    expect(view.element.classList.contains("is-moved")).toBe(true);
    expect(view.element.style.top).toBe("120px");

    viewportWidth = 500;
    viewportHeight = 400;
    window.dispatchEvent(new Event("resize"));

    expect(view.element.style.left).toBe("132px");
    expect(view.element.style.top).toBe("120px");
    expect(view.element.style.maxHeight).toBe("264px");

    grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Updated Study Rail grip was not rendered.");
    grip.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));

    expect(view.element.classList.contains("is-moved")).toBe(false);
    expect(view.element.style.left).toBe("");
    expect(view.element.style.top).toBe("192px");
    expect(view.element.style.right).toBe("48px");
    expect(view.element.style.maxHeight).toBe("192px");
    view.destroy();
  });

  it("clamps a minimized moved rail against its expanded height on resize", () => {
    const view = mountStudyRail(mountTarget(), props({ top: 120, right: 32 }));
    const grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    const toggle = view.element.querySelector<HTMLButtonElement>("[data-focus-key='rail-toggle']");
    if (!grip || !toggle) throw new Error("Study Rail movement controls were not rendered.");

    grip.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    toggle.click();
    expect(view.element.classList.contains("is-minimized")).toBe(true);

    viewportHeight = 400;
    window.dispatchEvent(new Event("resize"));

    expect(view.element.style.top).toBe("120px");
    expect(view.element.style.maxHeight).toBe("264px");
    toggle.click();
    expect(view.element.classList.contains("is-minimized")).toBe(false);
    expect(view.element.getBoundingClientRect().bottom).toBe(384);
    view.destroy();
  });

  it("reserves usable height when the native toolbar anchor is near the viewport bottom", () => {
    viewportHeight = 320;
    const view = mountStudyRail(mountTarget(), props({ top: 500, right: 16 }));

    expect(view.element.style.top).toBe("112px");
    expect(view.element.style.maxHeight).toBe("192px");

    const grip = view.element.querySelector<HTMLElement>("[data-focus-key='rail-grip']");
    if (!grip) throw new Error("Study Rail grip was not rendered.");
    grip.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", shiftKey: true }),
    );

    expect(view.element.style.top).toBe("112px");
    expect(view.element.style.maxHeight).toBe("192px");
    view.destroy();
  });
});

describe("Study Rail notes", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps the note editor available throughout Practice and Test", () => {
    const onNoteChange = vi.fn();
    const stages: readonly StudyRailProps["stage"][] = [
      "masked",
      "selected",
      "practice-checked",
      "practice-revealed",
      "original-revealed",
      "test-active",
      "test-finished",
    ];
    const view = mountStudyRail(
      mountTarget(),
      props(
        { top: 120, right: 16 },
        {
          onNoteChange,
        },
      ),
    );

    const mark = view.element.querySelector(".mkit-folio__mark");
    expect(mark?.textContent).toBe("");

    for (const stage of stages) {
      view.update(
        props(
          { top: 120, right: 16 },
          {
            mode: stage.startsWith("test-") ? "test" : "practice",
            stage,
            onNoteChange,
          },
        ),
      );
      const note = view.element.querySelector<HTMLTextAreaElement>(
        "[data-focus-key='private-note']",
      );
      expect(note, stage).not.toBeNull();
      expect(note?.disabled, stage).toBe(false);
      expect(note?.closest(".mkit-study-rail__scroller"), stage).not.toBeNull();
    }

    const note = view.element.querySelector<HTMLTextAreaElement>("[data-focus-key='private-note']");
    if (!note) throw new Error("Study Rail note editor was not rendered.");
    const tags = view.element.querySelector(".mkit-tags");
    expect(
      Boolean(tags && tags.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    note.value = "Compare the limiting cases.";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onNoteChange).toHaveBeenCalledWith("Compare the limiting cases.");

    view.update(
      props(
        { top: 120, right: 16 },
        {
          stage: "practice-revealed",
          onNoteChange,
        },
      ),
    );
    const revealOriginal = view.element.querySelector<HTMLElement>(
      "[data-focus-key='reveal-original']",
    );
    expect(revealOriginal?.hasAttribute("aria-controls")).toBe(false);
    expect(revealOriginal?.hasAttribute("aria-expanded")).toBe(false);
    view.destroy();
  });
});

describe("Study Rail initial outcome", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows only the coarse initial result when the preference supplies one", () => {
    const view = mountStudyRail(
      mountTarget(),
      props({ top: 120, right: 16 }, { initialOutcome: "correct" }),
    );

    const correct = view.element.querySelector(".mkit-initial-outcome--correct");
    expect(correct?.textContent).toBe("Initially correct");
    expect(correct?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    view.update(props({ top: 120, right: 16 }, { initialOutcome: "incorrect" }));
    expect(view.element.querySelector(".mkit-initial-outcome--correct")).toBeNull();
    expect(view.element.querySelector(".mkit-initial-outcome--incorrect")?.textContent).toBe(
      "Initially incorrect",
    );

    view.update(props({ top: 120, right: 16 }, { initialOutcome: null }));
    expect(view.element.querySelector(".mkit-initial-outcome")).toBeNull();
    view.destroy();
  });
});

describe("Score Shield interaction", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opts back into pointer input inside a non-interactive overlay host", () => {
    const host = document.createElement("div");
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = __MKIT_UI_CSS__;
    shadow.append(style);
    document.body.append(host);

    const onReveal = vi.fn();
    const view = mountScoreShield(shadow, {
      state: "shielded",
      onReveal,
      onFreshAttempt: vi.fn(),
    });
    const reveal = view.element.querySelector<HTMLButtonElement>("[data-focus-key='reveal-score']");
    if (!reveal) throw new Error("Score Shield reveal button was not rendered.");

    expect(getComputedStyle(host).pointerEvents).toBe("none");
    expect(getComputedStyle(view.element).pointerEvents).toBe("auto");
    reveal.click();
    expect(onReveal).toHaveBeenCalledOnce();
    view.destroy();
  });
});

function props(
  anchor: StudyRailProps["anchor"],
  overrides: Partial<StudyRailProps> = {},
): StudyRailProps {
  return {
    anchor,
    mode: "practice",
    stage: "masked",
    progress: { scope: "section", current: null, total: null },
    selection: null,
    eliminations: [],
    confidence: null,
    flagged: false,
    reviewAgain: false,
    initialOutcome: null,
    outcome: null,
    saveState: "idle",
    answersRevealed: false,
    note: "",
    tags: [],
    canNavigatePrevious: false,
    canNavigateNext: false,
    onSelect: vi.fn(),
    onToggleElimination: vi.fn(),
    onConfidenceChange: vi.fn(),
    onFlagChange: vi.fn(),
    onReviewAgainChange: vi.fn(),
    onCheck: vi.fn(),
    onRevealAnswers: vi.fn(),
    onRevealOriginal: vi.fn(),
    onRetry: vi.fn(),
    onFinishRequest: vi.fn(),
    onFinishConfirm: vi.fn(),
    onFinishCancel: vi.fn(),
    onNavigate: vi.fn(),
    onNoteChange: vi.fn(),
    onTagsChange: vi.fn(),
    ...overrides,
  };
}

function numericStyle(value: string): number {
  return Number.parseFloat(value) || 0;
}

function mountTarget(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}
