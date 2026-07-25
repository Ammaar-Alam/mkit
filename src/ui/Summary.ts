import { button, element, folioHeader, icon, mountView, nextId, scheduleFocus } from "./dom";
import type { MKitViewHandle, SectionSummary, SummaryCounts, SummaryProps } from "./types";

export function mountSummary(
  target: HTMLElement | ShadowRoot,
  props: SummaryProps,
): MKitViewHandle<SummaryProps> {
  const headingId = nextId("summary-heading");
  return mountView(target, "mkit-surface mkit-summary", props, (root, next, firstRender) => {
    root.replaceChildren();
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", headingId);
    root.setAttribute("tabindex", "-1");

    const header = folioHeader("Fresh Attempt", "Session summary", headingId);
    if (next.onClose) {
      header.append(
        button("Close", "mkit-button mkit-button--quiet mkit-summary__close", next.onClose, {
          focusKey: "close-summary",
          icon: null,
        }),
      );
    }
    root.append(header);
    if (next.encouragementEnabled) {
      root.append(element("p", { className: "mkit-encouragement", text: "That was a full pass." }));
    }
    root.append(
      headlineCounts(next.counts),
      sectionTable(next.sections),
      questionTypeTable(next.questionTypes),
      timing(next),
      categoryList(next),
    );

    if (next.counts.unknown > 0) {
      root.append(
        element(
          "p",
          { className: "mkit-unknown" },
          icon("warning"),
          element("span", {
            text: `${next.counts.unknown} ${next.counts.unknown === 1 ? "question" : "questions"} couldn’t be auto-checked.`,
          }),
        ),
      );
    }

    if (firstRender && next.autoFocus !== false) scheduleFocus(root);
  });
}

function headlineCounts(counts: SummaryCounts): HTMLElement {
  return element(
    "dl",
    { className: "mkit-summary-counts", attributes: { "aria-label": "Session totals" } },
    count("Got it", counts.correct, "check"),
    count("Needs review", counts.needsReview, "circle"),
    count("Unanswered", counts.unanswered, "warning"),
    count("Flagged", counts.flagged, "flag"),
  );
}

function count(
  label: string,
  value: number,
  iconName: "check" | "circle" | "flag" | "warning",
): HTMLElement {
  return element(
    "div",
    { className: "mkit-summary-count" },
    icon(iconName),
    element("dt", { text: label }),
    element("dd", { text: String(value) }),
  );
}

function sectionTable(sections: readonly SectionSummary[]): HTMLElement {
  const body = element("tbody");
  for (const section of sections) {
    body.append(
      element(
        "tr",
        {},
        element("th", { text: section.section, attributes: { scope: "row" } }),
        element("td", { text: String(section.counts.correct) }),
        element("td", { text: String(section.counts.needsReview) }),
        element("td", { text: String(section.counts.unanswered) }),
        element("td", { text: formatDuration(section.timing.averageMs) }),
      ),
    );
  }
  if (sections.length === 0) {
    body.append(
      element(
        "tr",
        {},
        element("td", {
          text: "No section results yet.",
          attributes: { colspan: 5 },
        }),
      ),
    );
  }
  return summaryTable(
    "By section",
    ["Section", "Got it", "Needs review", "Unanswered", "Average"],
    body,
  );
}

function questionTypeTable(props: SummaryProps["questionTypes"]): HTMLElement {
  const body = element(
    "tbody",
    {},
    questionTypeRow("Passage-based", props.passage),
    questionTypeRow("Discrete", props.discrete),
  );
  return summaryTable(
    "By question type",
    ["Type", "Got it", "Needs review", "Unanswered", "Flagged"],
    body,
  );
}

function questionTypeRow(label: string, counts: SummaryCounts): HTMLElement {
  return element(
    "tr",
    {},
    element("th", { text: label, attributes: { scope: "row" } }),
    element("td", { text: String(counts.correct) }),
    element("td", { text: String(counts.needsReview) }),
    element("td", { text: String(counts.unanswered) }),
    element("td", { text: String(counts.flagged) }),
  );
}

function summaryTable(title: string, headings: readonly string[], body: HTMLElement): HTMLElement {
  return element(
    "section",
    { className: "mkit-summary-section" },
    element("h3", { text: title }),
    element(
      "div",
      {
        className: "mkit-table-scroll",
        attributes: { tabindex: "0", role: "region", "aria-label": title },
      },
      element(
        "table",
        {},
        element(
          "thead",
          {},
          element(
            "tr",
            {},
            ...headings.map((heading) =>
              element("th", { text: heading, attributes: { scope: "col" } }),
            ),
          ),
        ),
        body,
      ),
    ),
  );
}

function timing(props: SummaryProps): HTMLElement {
  return element(
    "section",
    { className: "mkit-summary-section" },
    element("h3", { text: "Timing" }),
    element(
      "dl",
      { className: "mkit-timing" },
      element(
        "div",
        {},
        element("dt", { text: "Average per question" }),
        element("dd", { text: formatDuration(props.timing.averageMs) }),
      ),
      element(
        "div",
        {},
        element("dt", { text: "Pacing outliers" }),
        element("dd", { text: String(props.timing.outlierCount) }),
      ),
    ),
  );
}

function categoryList(props: SummaryProps): HTMLElement {
  const safeCategories = props.categories.filter(({ code }) =>
    /^[A-Z0-9][A-Z0-9 /.-]{0,15}$/i.test(code),
  );
  return element(
    "section",
    { className: "mkit-summary-section" },
    element("h3", { text: "Topics to revisit" }),
    safeCategories.length > 0
      ? element(
          "ul",
          { className: "mkit-category-list" },
          ...safeCategories.map(({ code, needsReview }) =>
            element(
              "li",
              {},
              element("span", { text: code }),
              element("strong", {
                text: `${needsReview} ${needsReview === 1 ? "question" : "questions"}`,
              }),
            ),
          ),
        )
      : element("p", { className: "mkit-empty", text: "No category codes were available." }),
  );
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "—";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
