// PIE-1402: on a phone, a table of records (Jev's suggestions: note, said, passage, outcome) hid its columns past the
// edge. A table of three or more columns reads as cards there: each cell labelled by its header, the title cell first.
import { expect, test } from "bun:test";
import { FIGURE_STYLE, figureBodyHtml } from "../src/publish-figures";

test("a table of three or more columns labels each cell for its phone card; a two-column table stays a table", () => {
  const html = figureBodyHtml("table", { headers: ["note", "said", "passage"], rows: [["Shed status", "line 3 stacks 3 points", "The shed roof went on at nine"]] }, () => null)!;
  expect(html).toContain('<table class="fig-cards">');
  expect(html).toContain('<td class="lead" data-label="note">Shed status</td>');
  expect(html).toContain('<td data-label="said">line 3 stacks 3 points</td>');
  expect(figureBodyHtml("table", { headers: ["job", "stage"], rows: [["Fix the gate", "queued"]] }, () => null)).not.toContain("fig-cards");
  // The phone's rule: cells stacked, the header said before each, the header row hidden.
  expect(FIGURE_STYLE).toMatch(/@media \(max-width:36rem\)\{[^}]*\.fig-cards td\{display:block/s);
  expect(FIGURE_STYLE).toContain('content:attr(data-label) ": "');
});
