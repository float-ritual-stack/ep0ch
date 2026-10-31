export const fig = (kind: string, yaml: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", "::", ""];

export const READING_CELL = "PLOT-42 — The greenhouse logger records every opening of the east window, including the quiet interval after dusk, until the last lantern goes out.";
export const READING_REASON = "Keep every sample from the greenhouse window so the gardener can compare the cool morning air with the warm evening breeze, including the final reading beside the lantern.";
/** One fictional audit, read on a phone and in narrow and wide terminal tiles. */
export function pageReadingText(view: string): string {
  return [
    "One garden report, every width [page::garden-reading]",
    "", "> [!summary] **Window readings** follow [the garden plan](https://example.org/garden-plan).", "",
    ...fig("stat", ["title: Window counters", "items:",
      "  - { label: samples at the east window, value: 31 }", "  - { label: opening events, value: 17 }",
      "  - { label: quiet intervals, value: 23 }", "  - { label: longest pause, value: '2.8 s' }"]),
    ...fig("table", ["title: Window facts", "headers: [Observation, Detail]", `rows: [[Logger, ${JSON.stringify(READING_CELL)}]]`]),
    ...fig("rank", ["title: Window timings", "items:",
      "  - { label: samples taken after the gardener closed the east window, value: 31 }",
      "  - { label: samples taken while the lantern was still lit, value: 17 }"]),
    ...fig("decision", ["title: Window decision", "options:", `  - { label: Keep the logger, state: chosen, reason: ${JSON.stringify(READING_REASON)} }`]),
    ...fig("table", ["title: Five recent readings", `view: ${view}`, "limit: 5", "columns: [title, merged-at]"]),
  ].join("\n");
}

