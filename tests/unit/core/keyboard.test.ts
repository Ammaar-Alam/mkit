import { describe, expect, it, vi } from "vitest";
import {
  type FreshAttemptKeyboardActions,
  FreshAttemptKeyboardController,
} from "../../../src/core/keyboard";

describe("Fresh Attempt keyboard controls", () => {
  it("maps answers, eliminations, actions, and navigation without page controls", () => {
    const actions = actionSpies();
    const controller = new FreshAttemptKeyboardController(actions);
    controller.setEnabled(true);

    document.body.dispatchEvent(key("b"));
    document.body.dispatchEvent(key("3"));
    document.body.dispatchEvent(key("C", { shiftKey: true }));
    document.body.dispatchEvent(key("Enter"));
    document.body.dispatchEvent(key("f"));
    document.body.dispatchEvent(key("r"));
    document.body.dispatchEvent(key("["));
    document.body.dispatchEvent(key("]"));

    expect(actions.select).toHaveBeenNthCalledWith(1, "B");
    expect(actions.select).toHaveBeenNthCalledWith(2, "C");
    expect(actions.toggleElimination).toHaveBeenCalledWith("C");
    expect(actions.check).toHaveBeenCalledOnce();
    expect(actions.toggleFlag).toHaveBeenCalledOnce();
    expect(actions.toggleReviewAgain).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenNthCalledWith(1, "previous");
    expect(actions.navigate).toHaveBeenNthCalledWith(2, "next");

    controller.dispose();
  });

  it("ignores editable fields, modifier shortcuts, repeats, and disabled sessions", () => {
    const actions = actionSpies();
    const controller = new FreshAttemptKeyboardController(actions);
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    controller.setEnabled(true);

    textarea.dispatchEvent(key("a"));
    document.body.dispatchEvent(key("a", { metaKey: true }));
    document.body.dispatchEvent(key("a", { ctrlKey: true }));
    document.body.dispatchEvent(key("a", { altKey: true }));
    document.body.dispatchEvent(key("a", { repeat: true }));
    controller.setEnabled(false);
    document.body.dispatchEvent(key("a"));

    expect(actions.select).not.toHaveBeenCalled();
    expect(actions.toggleElimination).not.toHaveBeenCalled();

    controller.dispose();
  });
});

function actionSpies(): FreshAttemptKeyboardActions {
  return {
    select: vi.fn(),
    toggleElimination: vi.fn(),
    check: vi.fn(),
    toggleFlag: vi.fn(),
    toggleReviewAgain: vi.fn(),
    navigate: vi.fn(),
  };
}

function key(value: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: value,
    ...init,
  });
}
