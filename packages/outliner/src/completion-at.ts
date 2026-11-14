/**
 * `completion.rows` asked with the text and the cursor (PIE-1340, native W5): what a client that reads no Blockdown
 * needs to complete a token. The door finds the token itself, asks for its sources' answers and merges them; a
 * native window can do none of that, so the service does all three here with the same parts: the one detector
 * (`completionTargetAtCursor`), the sources' own answers (`completionRows`) and the one merge (`mergeSourceAnswers`).
 * What comes back is the token to replace and rows ready to draw and to write.
 *
 * A row says what its source said of it (`docs`), and the one that is lit (`lit`, the first unless said) carries what
 * choosing it makes, drawn (`view`): its source's `example` as written and lowered through the page's own walk
 * (`drawnExample`), so the window draws a component, a value or a callout beside the list with the parts it draws a
 * note with. One row's, never every row's: an example is a note walked, with the questions it asks.
 *
 * A row also says which letters of its label were typed (`matches`, the merge's own), how what it writes looks when
 * a primitive draws that (`sample`: a heading pattern's strip; the lit row's `view` is then its `shown`, the look on
 * an example, and no note is walked), every stop of what it writes (`slots`), and whether choosing it leaves the
 * cursor in a token, so the list is asked again at once (`next`: outline-core's `asksAgain`, the door's rule, with
 * the one detector run over the line as the choice leaves it).
 *
 * A page nobody has written is offered as the door offers it, with the request that makes it (`makes`: `pages.follow`,
 * sent by the client as whoever chose, before the link is written). An anchor on a heading and a new component need
 * more than one request and a check between them: the door runs those, and such a row is left out here.
 */
import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
import { asksAgain, completionSaid, enterKeeps, insertSelection, insertSlots, insertText, mergeSourceAnswers, pickId, pickKey, triggerOf } from "@ep0ch/outline-core/completion-source";
import type { PagePrimitive } from "@ep0ch/outline-core/note-page";
import type { CompletionAtRequest, CompletionAtRow, CompletionRowsRequest, CompletionRowsResult } from "@ep0ch/outline-core/protocol";

/** An example as written and as drawn, about the note `about` (`this`): `drawnExample`, handed over by whoever has the service. */
export type DrawsExample = (about: string, example: { use: string; note?: string }) => Promise<PagePrimitive[]>;

/** The request has the text and the cursor in place of a detected token. */
export const asksAtCursor = (request: CompletionRowsRequest | CompletionAtRequest): request is CompletionAtRequest => !("target" in request) && typeof (request as CompletionAtRequest).text === "string";

/** The token at the cursor and its rows, with `rows` asking the sources for a detected token as `completion.rows` does. */
export async function completionAt(request: CompletionAtRequest, rows: (asked: CompletionRowsRequest) => Promise<CompletionRowsResult>, draws?: DrawsExample): Promise<CompletionRowsResult> {
  const { text, cursor, lit = 0, ...rest } = request;
  if (!Number.isSafeInteger(lit) || lit < 0) throw new Error("completion.rows lit is a row of the list, from 0");
  if (text.length > 2 * 1024 * 1024) throw new Error("completion.rows takes text of at most 2 MiB");
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > text.length) throw new Error("completion.rows with text needs cursor: a UTF-16 offset in it");
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  const lines = text.split("\n");
  const row = text.slice(0, lineStart).split("\n").length - 1;
  const target = completionTargetAtCursor(lines[row] ?? "", cursor - lineStart, lines, row);
  // No token, or one only a door's own sources answer (its actions, its tiles): nothing to list.
  if (!target || !triggerOf(target.kind)) return { answers: [], picks: {}, token: null, rows: [] };
  const { start, end, ...asked } = target;
  // The text being written is its note's own draft (`((#heading` searches it): said once, as `text`, with `near`.
  const found = await rows({ ...rest, target: asked, ...(rest.draft === undefined && rest.near ? { draft: { blockId: rest.near, text } } : {}) });
  // A row that makes something when chosen is left out (see above), and with it what its source said of that row
  // alone: a source whose every row went says only that it has nothing (`empty`), never how to choose what wasn't sent.
  const answers = found.answers.map(answer => {
    const rows = answer.rows.filter(row => !row.anchor && !row.newComponent);
    if (rows.length === answer.rows.length) return answer;
    const { partial: _, ...rest } = answer;
    return rows.length ? { ...answer, rows } : { ...rest, rows };
  });
  const merged = mergeSourceAnswers(answers, target.query, { picks: found.picks });
  const listed: CompletionAtRow[] = merged.map((merged, index) => {
    const insert = insertText(merged.insert), select = insertSelection(merged.insert);
    // Whether Return is the field's while this row is lit and nothing has been chosen: the one rule's answer, said on
    // the row (a row that would leave the line as typed among them), so the window compares no text to know.
    const enter = enterKeeps({ insertion: insert, ...(merged.enter ? { enter: merged.enter } : {}), ...(merged.newPage ? { newPage: merged.newPage } : {}) }, { chosen: false, line: lines[row] ?? "", start, end });
    const slots = insertSlots(merged.insert);
    // Whether the list is asked again once this row is in: the door's rule, with the one detector run over the line
    // as the choice leaves it (the cursor after what was written; a row with stops puts it in the first, and waits).
    const written = (lines[row] ?? "").slice(0, start) + insert + (lines[row] ?? "").slice(end);
    const after = written.split("\n"), last = after.length - 1, col = after[last]!.length - ((lines[row] ?? "").length - end);
    const next = !slots.length && asksAgain(target.kind, merged) && !!completionTargetAtCursor(after[last]!, col, [...lines.slice(0, row), ...after, ...lines.slice(row + 1)], row + last);
    return {
      id: `${index}`, label: merged.label, from: merged.from, insert, pick: pickId(insert),
      ...(merged.kind ? { kind: merged.kind } : {}), ...(merged.detail ? { detail: merged.detail } : {}), ...(merged.group ? { group: merged.group } : {}),
      ...(select ? { select } : {}), ...(enter ? { enter } : {}), ...(merged.docs ? { docs: merged.docs } : {}),
      ...(merged.matches.length ? { matches: merged.matches } : {}), ...(slots.length ? { slots } : {}), ...(merged.sample ? { sample: merged.sample } : {}),
      ...(next ? { next } : {}), ...(merged.newPage ? { makes: { action: "pages.follow", params: { address: merged.newPage } } } : {}),
    };
  });
  // What the lit row makes, drawn. An example that can't be drawn (it asks about a note that is gone) leaves the row its words.
  // A row whose look a primitive draws shows that, on its example: nothing is walked for it, and nothing is said to
  // be drawn that the page's walk would leave as words (a heading's style).
  const example = merged[lit]?.example, shown = merged[lit]?.shown;
  if (shown) listed[lit] = { ...listed[lit]!, view: shown };
  else if (example && draws && rest.near) {
    const view = await draws(rest.near, example).catch(() => null);
    if (view) listed[lit] = { ...listed[lit]!, view: { type: "box", children: view } };
  }
  const said = completionSaid(answers, listed.length);
  return {
    answers: [], picks: {}, token: { kind: target.kind, start: lineStart + start, end: lineStart + end, query: target.query }, rows: listed,
    heading: said.heading, ...(said.message ? { message: said.message } : {}), pickKey: pickKey({ trigger: triggerOf(target.kind), kind: target.kind, key: target.key }),
  };
}
