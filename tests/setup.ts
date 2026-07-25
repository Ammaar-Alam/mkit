import { webcrypto } from "node:crypto";
import { afterEach, vi } from "vitest";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "__mkitPreflight");
  document.documentElement.removeAttribute("data-mkit-protection");
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
