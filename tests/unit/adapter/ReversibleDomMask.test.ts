import { describe, expect, it } from "vitest";
import { ReversibleDomMask } from "../../../src/adapter/ReversibleDomMask";

describe("ReversibleDomMask", () => {
  it("removes elements from display, focus, and the accessibility tree, then restores exact state", () => {
    document.body.innerHTML = `
      <button
        id="spoiler"
        class="is-correct was-selected was-highlighted"
        title="synthetic title"
        aria-label="synthetic label"
        tabindex="3"
        style="border: 4px solid green"
      >
        Synthetic spoiler
      </button>
    `;
    const element = document.querySelector<HTMLElement>("#spoiler");
    if (!element) throw new Error("Fixture element is missing.");
    const original = snapshotElement(element);
    const mask = new ReversibleDomMask();

    mask.hide([element], "clean");
    mask.removeAttributes([element], ["title", "aria-label", "aria-describedby"], "clean");
    mask.removeClasses([element], ["is-correct", "was-selected", "was-highlighted"], "clean");
    mask.clearInlineStyles([element], "clean");

    expect(element.hidden).toBe(true);
    expect(element.inert).toBe(true);
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("tabindex")).toBe("-1");
    expect(element.hasAttribute("data-mkit-hidden")).toBe(true);
    expect(element.getAttribute("title")).toBeNull();
    expect(element.getAttribute("aria-label")).toBeNull();
    expect(element.className).toBe("");
    expect(element.getAttribute("style")).toBeNull();

    mask.restoreGroup("clean");

    expect(snapshotElement(element)).toEqual(original);
  });

  it("is idempotent across repeated masking and preserves a pre-existing marker", () => {
    document.body.innerHTML =
      '<div id="spoiler" data-mkit-hidden aria-hidden="false" tabindex="2">Synthetic</div>';
    const element = document.querySelector<HTMLElement>("#spoiler");
    if (!element) throw new Error("Fixture element is missing.");
    const original = snapshotElement(element);
    const mask = new ReversibleDomMask();

    mask.hide([element], "clean");
    mask.hide([element], "clean");
    mask.removeAttributes([element], ["title"], "clean");
    mask.removeAttributes([element], ["title"], "clean");
    mask.restoreAll();

    expect(snapshotElement(element)).toEqual(original);
    expect(element.hasAttribute("data-mkit-hidden")).toBe(true);
  });

  it("restores the latest page-authored attribute and style after remasking", () => {
    document.body.innerHTML =
      '<div id="spoiler" title="first" style="border: 4px solid red">Synthetic</div>';
    const element = document.querySelector<HTMLElement>("#spoiler");
    if (!element) throw new Error("Fixture element is missing.");
    const mask = new ReversibleDomMask();

    mask.removeAttributes([element], ["title"], "clean");
    mask.clearInlineStyles([element], "clean");

    element.title = "latest";
    element.setAttribute("style", "border: 6px solid blue");
    mask.removeAttributes([element], ["title"], "clean");
    mask.clearInlineStyles([element], "clean");
    mask.restoreGroup("clean");

    expect(element.title).toBe("latest");
    expect(element.getAttribute("style")).toBe("border: 6px solid blue");
  });

  it("removes only correctness visuals and restores the latest authored style exactly", () => {
    document.body.innerHTML = `
      <div
        id="workspace"
        style="padding: 12px; outline: 4px solid green; box-shadow: 0 0 0 3px red; background-color: pink"
      >
        Synthetic
      </div>
    `;
    const element = document.querySelector<HTMLElement>("#workspace");
    if (!element) throw new Error("Fixture element is missing.");
    const mask = new ReversibleDomMask();
    const properties = ["background-color", "box-shadow", "outline", "outline-color"] as const;

    mask.sanitizeInlineStyles([element], properties, "clean");
    expect(element.style.padding).toBe("12px");
    expect(element.style.outline).toBe("");
    expect(element.style.boxShadow).toBe("");
    expect(element.style.backgroundColor).toBe("");

    mask.sanitizeInlineStyles([element], properties, "clean");
    element.setAttribute(
      "style",
      "padding: 18px; outline: 2px solid blue; background-color: yellow",
    );
    mask.sanitizeInlineStyles([element], properties, "clean");
    expect(element.getAttribute("style")).toBe("padding: 18px;");

    mask.restoreGroup("clean");
    expect(element.getAttribute("style")).toBe(
      "padding: 18px; outline: 2px solid blue; background-color: yellow",
    );
  });
});

function snapshotElement(element: HTMLElement): object {
  return {
    attributes: [...element.attributes]
      .map(({ name, value }) => [name, value] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    hidden: element.hidden,
    inert: element.inert,
    text: element.textContent,
  };
}
