interface ElementSnapshot {
  hidden: boolean | null;
  inert: boolean | null;
  ariaHidden: string | null;
  tabIndex: string | null;
  hadMarker: boolean;
}

interface AttributeSnapshot {
  present: boolean;
  value: string;
}

export class ReversibleDomMask {
  readonly #hiddenByGroup = new Map<string, Map<Element, ElementSnapshot>>();
  readonly #attributesByGroup = new Map<string, Map<Element, Map<string, AttributeSnapshot>>>();
  readonly #classesByGroup = new Map<string, Map<Element, Set<string>>>();
  readonly #stylesByGroup = new Map<string, Map<HTMLElement, string | null>>();
  readonly #originalClassAttributes = new WeakMap<Element, string | null>();

  hide(elements: Iterable<Element>, group: string): void {
    const snapshots = getOrCreate(this.#hiddenByGroup, group, () => new Map());
    for (const element of elements) {
      if (!snapshots.has(element)) {
        snapshots.set(element, {
          hidden: element instanceof HTMLElement ? element.hidden : null,
          inert: element instanceof HTMLElement ? element.inert : null,
          ariaHidden: element.getAttribute("aria-hidden"),
          tabIndex: element.getAttribute("tabindex"),
          hadMarker: element.hasAttribute("data-mkit-hidden"),
        });
      } else {
        const snapshot = snapshots.get(element);
        if (snapshot) {
          if (element instanceof HTMLElement) {
            if (element.hidden !== true) snapshot.hidden = element.hidden;
            if (element.inert !== true) snapshot.inert = element.inert;
          }
          if (element.getAttribute("aria-hidden") !== "true") {
            snapshot.ariaHidden = element.getAttribute("aria-hidden");
          }
          if (element.getAttribute("tabindex") !== "-1") {
            snapshot.tabIndex = element.getAttribute("tabindex");
          }
        }
      }
      element.setAttribute("data-mkit-hidden", "");
      if (element instanceof HTMLElement) {
        element.hidden = true;
        element.inert = true;
      }
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("tabindex", "-1");
      if (element.contains(document.activeElement)) {
        window.getSelection()?.removeAllRanges();
      }
    }
  }

  removeAttributes(
    elements: Iterable<Element>,
    attributes: readonly string[],
    group: string,
  ): void {
    const elementSnapshots = getOrCreate(this.#attributesByGroup, group, () => new Map());
    for (const element of elements) {
      const snapshots = getOrCreate(elementSnapshots, element, () => new Map());
      for (const attribute of attributes) {
        if (element.hasAttribute(attribute)) {
          const current = element.getAttribute(attribute) ?? "";
          snapshots.set(attribute, { present: true, value: current });
          element.removeAttribute(attribute);
        } else if (!snapshots.has(attribute)) {
          snapshots.set(attribute, { present: false, value: "" });
        }
      }
    }
  }

  removeClasses(elements: Iterable<Element>, classes: readonly string[], group: string): void {
    const elementSnapshots = getOrCreate(this.#classesByGroup, group, () => new Map());
    for (const element of elements) {
      if (!this.#originalClassAttributes.has(element)) {
        this.#originalClassAttributes.set(element, element.getAttribute("class"));
      }
      const removed = getOrCreate(elementSnapshots, element, () => new Set());
      for (const className of classes) {
        if (element.classList.contains(className)) {
          removed.add(className);
          element.classList.remove(className);
        }
      }
    }
  }

  clearInlineStyles(elements: Iterable<Element>, group: string): void {
    const snapshots = getOrCreate(this.#stylesByGroup, group, () => new Map());
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element.hasAttribute("style")) {
        snapshots.set(element, element.getAttribute("style"));
      } else if (!snapshots.has(element)) {
        snapshots.set(element, null);
      }
      element.removeAttribute("style");
    }
  }

  restoreGroup(group: string): void {
    for (const [element, snapshot] of this.#hiddenByGroup.get(group) ?? []) {
      if (!snapshot.hadMarker) {
        element.removeAttribute("data-mkit-hidden");
      }
      if (element instanceof HTMLElement) {
        if (snapshot.hidden !== null) element.hidden = snapshot.hidden;
        if (snapshot.inert !== null) element.inert = snapshot.inert;
      }
      restoreAttribute(element, "aria-hidden", snapshot.ariaHidden);
      restoreAttribute(element, "tabindex", snapshot.tabIndex);
    }
    this.#hiddenByGroup.delete(group);

    for (const [element, snapshots] of this.#attributesByGroup.get(group) ?? []) {
      for (const [attribute, snapshot] of snapshots) {
        if (snapshot.present) {
          element.setAttribute(attribute, snapshot.value);
        } else {
          element.removeAttribute(attribute);
        }
      }
    }
    this.#attributesByGroup.delete(group);

    for (const [element, classes] of this.#classesByGroup.get(group) ?? []) {
      element.classList.add(...classes);
      this.#restoreClassOrder(element);
    }
    this.#classesByGroup.delete(group);

    for (const [element, style] of this.#stylesByGroup.get(group) ?? []) {
      restoreAttribute(element, "style", style);
    }
    this.#stylesByGroup.delete(group);
  }

  restoreAll(): void {
    const groups = new Set([
      ...this.#hiddenByGroup.keys(),
      ...this.#attributesByGroup.keys(),
      ...this.#classesByGroup.keys(),
      ...this.#stylesByGroup.keys(),
    ]);
    for (const group of groups) {
      this.restoreGroup(group);
    }
  }

  #restoreClassOrder(element: Element): void {
    const original = this.#originalClassAttributes.get(element);
    if (original === undefined) {
      return;
    }
    const current = [...element.classList];
    const currentSet = new Set(current);
    const originalOrder = original?.split(/\s+/).filter(Boolean) ?? [];
    const originalSet = new Set(originalOrder);
    const ordered = [
      ...originalOrder.filter((className) => currentSet.has(className)),
      ...current.filter((className) => !originalSet.has(className)),
    ];
    if (ordered.length === 0) {
      if (original === null) {
        element.removeAttribute("class");
      } else {
        element.setAttribute("class", "");
      }
      return;
    }
    element.setAttribute("class", ordered.join(" "));
  }
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}
