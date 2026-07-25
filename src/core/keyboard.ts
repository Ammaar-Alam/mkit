import type { AnswerChoice } from "../storage/schema";

export interface FreshAttemptKeyboardActions {
  select(choice: AnswerChoice): void;
  toggleElimination(choice: AnswerChoice): void;
  check(): void;
  toggleFlag(): void;
  toggleReviewAgain(): void;
  navigate(direction: "previous" | "next"): void;
}

export class FreshAttemptKeyboardController {
  readonly #actions: FreshAttemptKeyboardActions;
  #enabled = false;

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.#enabled ||
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableTarget(event.target)
    ) {
      return;
    }

    const choice = answerChoiceForKey(event.key);
    if (choice) {
      event.preventDefault();
      if (event.shiftKey) {
        this.#actions.toggleElimination(choice);
      } else {
        this.#actions.select(choice);
      }
      return;
    }

    if (event.shiftKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === "Enter") {
      event.preventDefault();
      this.#actions.check();
    } else if (key === "f") {
      event.preventDefault();
      this.#actions.toggleFlag();
    } else if (key === "r") {
      event.preventDefault();
      this.#actions.toggleReviewAgain();
    } else if (event.key === "[") {
      event.preventDefault();
      this.#actions.navigate("previous");
    } else if (event.key === "]") {
      event.preventDefault();
      this.#actions.navigate("next");
    }
  };

  constructor(actions: FreshAttemptKeyboardActions, target: Document = document) {
    this.#actions = actions;
    target.addEventListener("keydown", this.#handleKeyDown, { capture: true });
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  dispose(target: Document = document): void {
    target.removeEventListener("keydown", this.#handleKeyDown, { capture: true });
  }
}

function answerChoiceForKey(key: string): AnswerChoice | null {
  const normalized = key.toUpperCase();
  if (normalized === "A" || key === "1") return "A";
  if (normalized === "B" || key === "2") return "B";
  if (normalized === "C" || key === "3") return "C";
  if (normalized === "D" || key === "4") return "D";
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
  );
}
