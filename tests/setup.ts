import { webcrypto } from "node:crypto";
import { afterEach, vi } from "vitest";

const NativeMutationObserver = globalThis.MutationObserver;
const activeMutationObservers = new Set<MutationObserver>();

class TrackedMutationObserver extends NativeMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    activeMutationObservers.add(this);
  }

  override disconnect(): void {
    activeMutationObservers.delete(this);
    super.disconnect();
  }
}

Object.defineProperty(globalThis, "MutationObserver", {
  configurable: true,
  value: TrackedMutationObserver,
});

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

if (!("inert" in HTMLElement.prototype)) {
  const inertState = new WeakMap<HTMLElement, boolean>();
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement): boolean {
      return inertState.get(this) ?? false;
    },
    set(this: HTMLElement, value: boolean) {
      inertState.set(this, Boolean(value));
    },
  });
}

afterEach(() => {
  for (const observer of [...activeMutationObservers]) observer.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-mkit-protection");
  document.head.innerHTML = "";
  const preflightHost = globalThis.__mkitPreflight?.host;
  for (const child of [...document.body.children]) {
    if (child !== preflightHost) child.remove();
  }
});
