import type { MKitMountTarget, MKitViewHandle } from "./types";

type Child = Node | string | null | undefined | false;

let idCounter = 0;

export function nextId(prefix: string): string {
  idCounter += 1;
  return `mkit-${prefix}-${idCounter}`;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attributes?: Record<string, string | boolean | number | null | undefined>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

interface ButtonOptions {
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  focusKey?: string;
  title?: string;
  ariaLabel?: string;
  type?: "button" | "submit";
  icon?: IconName | null;
}

export function button(
  label: string,
  className: string,
  onClick: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const node = element("button", {
    className,
    attributes: {
      type: options.type ?? "button",
      disabled: options.disabled,
      "aria-label": options.ariaLabel,
      "aria-pressed": options.pressed === undefined ? undefined : String(options.pressed),
      "aria-expanded": options.expanded === undefined ? undefined : String(options.expanded),
      "aria-controls": options.controls,
      "data-focus-key": options.focusKey,
      title: options.title,
    },
  });
  node.addEventListener("click", onClick);
  if (options.icon !== null) node.append(icon(options.icon ?? "arrow"));
  node.append(element("span", { text: label }));
  return node;
}

export function primaryButton(
  label: string,
  onClick: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  return button(label, "mkit-button mkit-button--primary", onClick, options);
}

export type IconName =
  | "arrow"
  | "check"
  | "circle"
  | "flag"
  | "plus-minus"
  | "slash"
  | "shield"
  | "spark"
  | "warning";

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `mkit-icon mkit-icon--${name}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const paths: Record<IconName, readonly string[]> = {
    arrow: ["M5 12h14", "m13-6 6 6-6 6"],
    check: ["m5 12 4 4L19 6"],
    circle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"],
    flag: ["M6 21V4", "M6 5h10l-2 4 2 4H6"],
    "plus-minus": ["M5 12h14", "M12 5v14"],
    slash: ["M5 19 19 5"],
    shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-5"],
    spark: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4"],
    warning: [
      "M12 9v4",
      "M12 17h.01",
      "M10.3 3.9 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    ],
  };
  for (const pathData of paths[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

export function folioHeader(
  eyebrow: string,
  heading: string,
  headingId: string,
  action?: HTMLElement,
): HTMLElement {
  return element(
    "header",
    { className: "mkit-folio" },
    element("span", {
      className: "mkit-folio__mark",
      text: "MK",
      attributes: { "aria-hidden": true },
    }),
    element(
      "span",
      { className: "mkit-folio__copy" },
      element("span", { className: "mkit-eyebrow", text: eyebrow }),
      element("h2", { className: "mkit-heading", text: heading, attributes: { id: headingId } }),
    ),
    action ??
      element(
        "span",
        { className: "mkit-folio__registration", attributes: { "aria-hidden": true } },
        element("i"),
        element("i"),
      ),
  );
}

export function mountView<Props>(
  target: MKitMountTarget,
  className: string,
  initialProps: Props,
  render: (element: HTMLElement, props: Props, firstRender: boolean) => void,
): MKitViewHandle<Props> {
  const mountRoot =
    target instanceof ShadowRoot
      ? target
      : (target.shadowRoot ?? target.attachShadow({ mode: "open" }));
  const root = element("section", { className });
  mountRoot.append(root);
  let currentProps = initialProps;
  let firstRender = true;

  const draw = (): void => {
    const active = mountRoot.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined;
    render(root, currentProps, firstRender);
    firstRender = false;
    if (focusKey) {
      const next =
        Array.from(root.querySelectorAll<HTMLElement>("[data-focus-key]")).find(
          (candidate) => candidate.dataset.focusKey === focusKey,
        ) ?? firstFocusable(root);
      next?.focus({ preventScroll: true });
    }
  };

  draw();
  return {
    element: root,
    update(props: Props): void {
      currentProps = props;
      draw();
    },
    focus(): void {
      firstFocusable(root)?.focus({ preventScroll: true });
    },
    destroy(): void {
      root.remove();
    },
  };
}

export function firstFocusable(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
  );
}

export function trapFocus(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const rootNode = root.getRootNode();
  const active = rootNode instanceof ShadowRoot ? rootNode.activeElement : document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function scheduleFocus(node: HTMLElement | null): void {
  if (!node) return;
  queueMicrotask(() => {
    if (node.isConnected) node.focus({ preventScroll: true });
  });
}
