export interface TimingEnvironment {
  now(): number;
  isDocumentVisible(): boolean;
  isWindowFocused(): boolean;
  addDocumentListener(type: "visibilitychange", listener: () => void): void;
  removeDocumentListener(type: "visibilitychange", listener: () => void): void;
  addWindowListener(type: "focus" | "blur" | "pagehide", listener: () => void): void;
  removeWindowListener(type: "focus" | "blur" | "pagehide", listener: () => void): void;
}

export interface TimingSample {
  questionKey: string;
  durationMs: number;
}

export class ActiveQuestionTimer {
  readonly #environment: TimingEnvironment;
  readonly #onSample: (sample: TimingSample) => void | Promise<void>;
  #questionKey: string | null = null;
  #startedAt: number | null = null;
  #sessionActive = false;
  #disposed = false;

  readonly #handleVisibility = (): void => {
    this.#reconcile();
  };
  readonly #handleFocus = (): void => {
    this.#reconcile();
  };
  readonly #handleBlur = (): void => {
    this.flush();
  };
  readonly #handlePageHide = (): void => {
    this.flush();
  };

  constructor(
    onSample: (sample: TimingSample) => void | Promise<void>,
    environment: TimingEnvironment = browserTimingEnvironment(),
  ) {
    this.#onSample = onSample;
    this.#environment = environment;
    environment.addDocumentListener("visibilitychange", this.#handleVisibility);
    environment.addWindowListener("focus", this.#handleFocus);
    environment.addWindowListener("blur", this.#handleBlur);
    environment.addWindowListener("pagehide", this.#handlePageHide);
  }

  setSessionActive(active: boolean): void {
    if (this.#sessionActive === active) return;
    if (!active) this.flush();
    this.#sessionActive = active;
    this.#reconcile();
  }

  visitQuestion(questionKey: string): void {
    if (questionKey === this.#questionKey) {
      this.#reconcile();
      return;
    }
    this.flush();
    this.#questionKey = questionKey;
    this.#reconcile();
  }

  stopQuestion(): void {
    this.flush();
    this.#questionKey = null;
  }

  flush(): void {
    if (this.#startedAt === null || !this.#questionKey) {
      this.#startedAt = null;
      return;
    }
    const durationMs = Math.max(0, Math.round(this.#environment.now() - this.#startedAt));
    const questionKey = this.#questionKey;
    this.#startedAt = null;
    if (durationMs > 0) {
      void this.#onSample({ questionKey, durationMs });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.flush();
    this.#disposed = true;
    this.#environment.removeDocumentListener("visibilitychange", this.#handleVisibility);
    this.#environment.removeWindowListener("focus", this.#handleFocus);
    this.#environment.removeWindowListener("blur", this.#handleBlur);
    this.#environment.removeWindowListener("pagehide", this.#handlePageHide);
  }

  #reconcile(): void {
    if (this.#disposed) return;
    const shouldRun =
      this.#sessionActive &&
      this.#questionKey !== null &&
      this.#environment.isDocumentVisible() &&
      this.#environment.isWindowFocused();
    if (shouldRun && this.#startedAt === null) {
      this.#startedAt = this.#environment.now();
    } else if (!shouldRun && this.#startedAt !== null) {
      this.flush();
    }
  }
}

function browserTimingEnvironment(): TimingEnvironment {
  return {
    now: () => performance.now(),
    isDocumentVisible: () => document.visibilityState === "visible",
    isWindowFocused: () => document.hasFocus(),
    addDocumentListener: (type, listener) => document.addEventListener(type, listener),
    removeDocumentListener: (type, listener) => document.removeEventListener(type, listener),
    addWindowListener: (type, listener) => window.addEventListener(type, listener),
    removeWindowListener: (type, listener) => window.removeEventListener(type, listener),
  };
}
