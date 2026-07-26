import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPreflight } from "../../../src/content/preflight";

const PREFLIGHT_CSS = readFileSync(resolve(process.cwd(), "src/content/preflight.css"), "utf8");

describe("document-start preflight", () => {
  beforeAll(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "__mkitPreflight");
  });

  it("has no import-time page side effects before an eligible review is confirmed", () => {
    document.body.innerHTML = '<main id="dashboard">Synthetic dashboard</main>';

    expect(document.querySelector("[data-mkit-host]")).toBeNull();
    expect(document.documentElement.hasAttribute("data-mkit-protection")).toBe(false);
    expect(globalThis.__mkitPreflight).toBeUndefined();
  });

  it("defaults to a static fail-closed boot veil and keeps Normal review explicit", async () => {
    document.head.innerHTML = `<style>${PREFLIGHT_CSS}</style>`;
    document.body.innerHTML = '<main id="native-review">Synthetic native review</main>';

    const preflight = createPreflight();
    const nativeReview = document.querySelector<HTMLElement>("#native-review");
    if (!nativeReview) throw new Error("Native review fixture is missing.");

    expect(document.documentElement.dataset.mkitProtection).toBe("boot");
    expect(preflight.host.isConnected).toBe(true);
    expect(preflight.host.dataset.mkitPlacement).toBe("gate");
    expect(preflight.shadow.textContent).toContain("Preparing a clean view");
    expect(preflight.shadow.querySelector("[data-normal-review]")).not.toBeNull();
    expect(getComputedStyle(nativeReview).display).toBe("none");
    expect(getComputedStyle(preflight.host).display).toBe("block");

    preflight.setProtection("unsupported");
    expect(getComputedStyle(nativeReview).display).toBe("none");
    expect(preflight.host.hidden).toBe(false);

    preflight.shadow.querySelector<HTMLButtonElement>("[data-normal-review]")?.click();
    expect(document.documentElement.dataset.mkitProtection).toBe("normal-review");
    expect(preflight.host.hidden).toBe(true);
    expect(getComputedStyle(nativeReview).display).not.toBe("none");
  });

  it("contains static print protection and never relies on blur, opacity, or an overlay", () => {
    expect(PREFLIGHT_CSS).toMatch(/@media print/);
    expect(PREFLIGHT_CSS).toMatch(/\[data-mkit-hidden\]\s*\{[\s\S]*display:\s*none\s*!important/);
    expect(PREFLIGHT_CSS).toMatch(/data-mkit-protection="boot"/);
    expect(PREFLIGHT_CSS).toMatch(/data-mkit-protection="unsupported"/);
    expect(PREFLIGHT_CSS).not.toMatch(/filter\s*:\s*blur|opacity\s*:\s*0|visibility\s*:\s*hidden/);
  });

  it("mounts only one host when evaluated repeatedly", async () => {
    document.head.innerHTML = `<style>${PREFLIGHT_CSS}</style>`;
    document.body.insertAdjacentHTML(
      "beforeend",
      '<main id="native-review">Synthetic native review</main>',
    );

    createPreflight();
    createPreflight();

    expect(document.querySelectorAll("[data-mkit-host]")).toHaveLength(1);
  });
});
