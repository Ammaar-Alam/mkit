import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings surfaces", () => {
  it("puts the global MKit switch before current-page status in the popup", async () => {
    const page = parse(await readFile(sourceUrl("popup/index.html"), "utf8"));
    const main = requiredElement(page, ".popup-shell");
    const master = requiredElement(page, "#mkit-control");
    const pageContext = requiredElement(page, ".page-context");
    const input = requiredElement<HTMLInputElement>(page, "#mkit-enabled");
    const label = input.closest("label");
    const mark = requiredElement<HTMLImageElement>(page, ".folio-mark");

    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("src")).toBe("../icons/icon-48.png");
    expect(mark.getAttribute("alt")).toBe("");
    expect(label?.textContent).toContain("MKit");
    expect(label?.textContent).toContain("On");
    expect([...main.children].indexOf(master)).toBeLessThan(
      [...main.children].indexOf(pageContext),
    );
  });

  it("exposes the global switch and all concealment preferences in options", async () => {
    const page = parse(await readFile(sourceUrl("options/index.html"), "utf8"));
    const mark = requiredElement<HTMLImageElement>(page, ".folio-mark");
    const expectedLabels = new Map([
      ["mkit-enabled", "Use MKit on supported reviews"],
      ["hide-section-result-marks", "Hide section result marks"],
      ["clear-previous-highlights", "Clear previous highlights"],
      ["clear-previous-cross-outs", "Clear previous cross-outs"],
    ]);

    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("src")).toBe("../icons/icon-48.png");
    expect(mark.getAttribute("alt")).toBe("");
    for (const [id, copy] of expectedLabels) {
      const input = requiredElement<HTMLInputElement>(page, `#${id}`);
      expect(input.type).toBe("checkbox");
      expect(input.closest("label")?.textContent).toContain(copy);
    }
  });

  it("keeps all new review controls in the extension popup", async () => {
    const page = parse(await readFile(sourceUrl("popup/index.html"), "utf8"));
    const main = requiredElement(page, ".popup-shell");
    const protection = requiredElement(page, "#protection-section");
    const activeAttempt = requiredElement(page, "#continue-section");
    const expectedLabels = new Map([
      ["mkit-enabled", "MKit"],
      ["hide-section-result-marks", "Hide section result marks"],
      ["clear-previous-highlights", "Clear previous highlights"],
      ["clear-previous-cross-outs", "Clear previous cross-outs"],
    ]);

    for (const [id, copy] of expectedLabels) {
      const input = requiredElement<HTMLInputElement>(page, `#${id}`);
      expect(input.type).toBe("checkbox");
      expect(input.closest("label")?.textContent).toContain(copy);
    }
    expect([...main.children].indexOf(protection)).toBeLessThan(
      [...main.children].indexOf(activeAttempt),
    );
    expect(requiredElement(page, "#open-settings").textContent).toContain("All settings");
  });
});

function sourceUrl(path: string): string {
  return resolve(process.cwd(), "src", path);
}

function parse(source: string): Document {
  return new DOMParser().parseFromString(source, "text/html");
}

function requiredElement<T extends Element = HTMLElement>(document: Document, selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }
  return element as T;
}
