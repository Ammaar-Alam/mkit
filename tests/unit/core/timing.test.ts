import { describe, expect, it, vi } from "vitest";
import {
  ActiveQuestionTimer,
  type TimingEnvironment,
  type TimingSample,
} from "../../../src/core/timing";

class FakeTimingEnvironment implements TimingEnvironment {
  time = 100;
  visible = true;
  focused = true;
  readonly documentListeners = new Map<string, Set<() => void>>();
  readonly windowListeners = new Map<string, Set<() => void>>();

  now = (): number => this.time;
  isDocumentVisible = (): boolean => this.visible;
  isWindowFocused = (): boolean => this.focused;
  addDocumentListener = (type: "visibilitychange", listener: () => void): void => {
    addListener(this.documentListeners, type, listener);
  };
  removeDocumentListener = (type: "visibilitychange", listener: () => void): void => {
    this.documentListeners.get(type)?.delete(listener);
  };
  addWindowListener = (type: "focus" | "blur" | "pagehide", listener: () => void): void => {
    addListener(this.windowListeners, type, listener);
  };
  removeWindowListener = (type: "focus" | "blur" | "pagehide", listener: () => void): void => {
    this.windowListeners.get(type)?.delete(listener);
  };

  emitDocument(type: "visibilitychange"): void {
    for (const listener of this.documentListeners.get(type) ?? []) listener();
  }

  emitWindow(type: "focus" | "blur" | "pagehide"): void {
    for (const listener of this.windowListeners.get(type) ?? []) listener();
  }
}

describe("active question timing", () => {
  it("accumulates only visible, focused active-view intervals across revisits", () => {
    const environment = new FakeTimingEnvironment();
    const samples: TimingSample[] = [];
    const timer = new ActiveQuestionTimer((sample) => {
      samples.push(sample);
    }, environment);

    timer.visitQuestion("q1");
    timer.setSessionActive(true);
    environment.time = 600;
    environment.visible = false;
    environment.emitDocument("visibilitychange");

    environment.time = 1_600;
    environment.visible = true;
    environment.emitDocument("visibilitychange");
    environment.time = 1_900;
    timer.visitQuestion("q2");

    environment.time = 2_500;
    timer.visitQuestion("q1");
    environment.time = 2_800;
    environment.emitWindow("pagehide");

    environment.time = 5_000;
    timer.setSessionActive(false);
    timer.setSessionActive(true);
    environment.time = 5_300;
    timer.flush();

    expect(sumByQuestion(samples)).toEqual({
      q1: 1_400,
      q2: 600,
    });
  });

  it("does not duplicate intervals when state is reconciled repeatedly", () => {
    const environment = new FakeTimingEnvironment();
    const onSample = vi.fn();
    const timer = new ActiveQuestionTimer(onSample, environment);

    timer.visitQuestion("q1");
    timer.setSessionActive(true);
    timer.setSessionActive(true);
    environment.emitWindow("focus");
    environment.emitWindow("focus");
    environment.time = 400;
    timer.flush();

    expect(onSample).toHaveBeenCalledOnce();
    expect(onSample).toHaveBeenCalledWith({ questionKey: "q1", durationMs: 300 });
  });
});

function addListener(
  target: Map<string, Set<() => void>>,
  type: string,
  listener: () => void,
): void {
  let listeners = target.get(type);
  if (!listeners) {
    listeners = new Set();
    target.set(type, listeners);
  }
  listeners.add(listener);
}

function sumByQuestion(samples: readonly TimingSample[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const sample of samples) {
    result[sample.questionKey] = (result[sample.questionKey] ?? 0) + sample.durationMs;
  }
  return result;
}
