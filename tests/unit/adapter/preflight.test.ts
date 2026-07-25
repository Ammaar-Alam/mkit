import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const PREFLIGHT_CSS = readFileSync(resolve(process.cwd(), "src/content/preflight.css"), "utf8");

describe("document-start preflight", () => {
  beforeAll(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "__mkitPreflight");
  });

  it("defaults to a static fail-closed boot veil and keeps Normal review explicit", async () => {
    document.head.innerHTML = `<style>${PREFLIGHT_CSS}</style>`;
    document.body.innerHTML = '<main id="native-review">Synthetic native review</main>';

    await import("../../../src/content/preflight");

    const preflight = globalThis.__mkitPreflight;
    if (!preflight) throw new Error("Preflight did not initialize.");
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
    expect(PREFLIGHT_CSS).toMatch(
      /html:not\(\[data-mkit-protection="normal-review"\]\)[\s\S]*display:\s*none\s*!important/,
    );
    expect(PREFLIGHT_CSS).not.toMatch(/filter\s*:\s*blur|opacity\s*:\s*0|visibility\s*:\s*hidden/);
  });

  it("mounts only one host when evaluated repeatedly", async () => {
    document.head.innerHTML = `<style>${PREFLIGHT_CSS}</style>`;
    document.body.insertAdjacentHTML(
      "beforeend",
      '<main id="native-review">Synthetic native review</main>',
    );

    vi.resetModules();
    await import("../../../src/content/preflight");
    vi.resetModules();
    await import("../../../src/content/preflight");

    expect(document.querySelectorAll("[data-mkit-host]")).toHaveLength(1);
  });
});
