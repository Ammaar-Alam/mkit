import type { StorageAreaLike } from "../../../src/storage";

export class FakeStorageArea implements StorageAreaLike {
  readonly events: string[];
  readonly values: Record<string, unknown>;
  failGetCount = 0;
  failSetCount = 0;
  setGate: Promise<void> | undefined;

  constructor(
    readonly name: string,
    initial: Record<string, unknown> = {},
    events: string[] = [],
  ) {
    this.values = structuredClone(initial);
    this.events = events;
  }

  async get(keys: string | string[] | null = null): Promise<Record<string, unknown>> {
    this.events.push(`${this.name}:get`);
    if (this.failGetCount > 0) {
      this.failGetCount -= 1;
      throw new Error(`${this.name} unavailable`);
    }
    if (keys === null) {
      return structuredClone(this.values);
    }
    const selected = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of selected) {
      if (Object.hasOwn(this.values, key)) {
        result[key] = structuredClone(this.values[key]);
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.events.push(`${this.name}:set`);
    if (this.setGate !== undefined) {
      await this.setGate;
    }
    if (this.failSetCount > 0) {
      this.failSetCount -= 1;
      throw new Error(`${this.name} quota failure`);
    }
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    this.events.push(`${this.name}:remove`);
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

export function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}
