export type PreflightProtection =
  | "boot"
  | "non-review"
  | "masked"
  | "unsupported"
  | "normal-review";

export interface MKitPreflight {
  host: HTMLElement;
  shadow: ShadowRoot;
  setProtection(protection: PreflightProtection): void;
  showPreparing(): void;
}

declare global {
  var __mkitPreflight: MKitPreflight | undefined;
}

if (!globalThis.__mkitPreflight) {
  const host = document.createElement("div");
  host.dataset.mkitHost = "";
  host.dataset.mkitPlacement = "gate";
  const shadow = host.attachShadow({ mode: "open" });

  const setProtection = (protection: PreflightProtection): void => {
    document.documentElement.dataset.mkitProtection = protection;
    host.hidden = protection === "non-review" || protection === "normal-review";
  };

  const showPreparing = (): void => {
    host.dataset.mkitPlacement = "gate";
    host.hidden = false;
    shadow.innerHTML = `
      <style>
        :host {
          color-scheme: light;
          font-family: "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", Verdana, sans-serif;
        }
        .veil {
          display: grid;
          min-height: 100vh;
          place-items: center;
          background: oklch(96.5% 0.016 84);
          color: oklch(24% 0.026 60);
        }
        .folio {
          display: grid;
          width: min(28rem, calc(100vw - 2rem));
          gap: 1rem;
          padding: 2rem;
          border: 1px solid oklch(82% 0.02 80);
          background: oklch(98.5% 0.01 84);
          clip-path: polygon(0 0, calc(100% - 1.5rem) 0, 100% 1.5rem, 100% 100%, 0 100%);
        }
        .mark {
          display: grid;
          width: 2.5rem;
          height: 2.5rem;
          place-items: center;
          background: oklch(24% 0.026 60);
          color: oklch(98.5% 0.01 84);
          font-family: Georgia, serif;
          font-weight: 700;
          clip-path: polygon(0 0, 100% 0, 100% 78%, 76% 100%, 0 100%);
        }
        strong {
          font-family: Georgia, serif;
          font-size: 1.25rem;
        }
        p {
          max-width: 35ch;
          margin: 0;
          color: oklch(43% 0.022 65);
        }
        button {
          min-height: 2.75rem;
          justify-self: start;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          font-weight: 700;
          text-decoration: underline;
          text-underline-offset: 0.2em;
          cursor: pointer;
        }
        button:focus-visible {
          outline: 2px solid oklch(40% 0.06 132);
          outline-offset: 3px;
        }
      </style>
      <main class="veil" aria-busy="true">
        <section class="folio" aria-labelledby="mkit-preparing-title">
          <span class="mark" aria-hidden="true">M</span>
          <strong id="mkit-preparing-title">Preparing a clean view…</strong>
          <p>Your prior attempt stays covered while MKit checks this page.</p>
          <button type="button" data-normal-review>Normal review</button>
        </section>
      </main>
    `;
    shadow.querySelector("[data-normal-review]")?.addEventListener("click", () => {
      host.dispatchEvent(new CustomEvent("mkit:normal-review", { bubbles: true, composed: true }));
      setProtection("normal-review");
    });
  };

  const mount = (): void => {
    if (!host.isConnected) {
      const ownerDocument = host.ownerDocument;
      (ownerDocument.body ?? ownerDocument.documentElement).append(host);
    }
  };

  document.documentElement.dataset.mkitProtection = "boot";
  showPreparing();
  mount();

  const mountObserver = new MutationObserver(() => {
    if (!host.isConnected) {
      mount();
    }
  });
  mountObserver.observe(host.ownerDocument, { childList: true, subtree: true });

  globalThis.__mkitPreflight = {
    host,
    shadow,
    setProtection,
    showPreparing,
  };
}
