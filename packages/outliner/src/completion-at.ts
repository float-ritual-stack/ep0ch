/**
 * `completion.rows` asked with the text and the cursor (PIE-1340, native W5): what a client that reads no Blockdown
 * needs to complete a token. The door finds the token itself, asks for its sources' answers and merges them; a
 * native window can do none of that, so the service does all three here with the same parts: the one detector
 * (`completionTargetAtCursor`), the sources' own answers (`completionRows`) and the one merge (`mergeSourceAnswers`).
 * What comes back is the token to replace and rows ready to draw and to write.
 *
 * A row that makes something when it is chosen (a page nobody has written, an anchor on a heading, a new component)
 * needs a client that runs that write first: the door does, and such a row is left out here until a thin client can.
 */
import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
import { completionSaid, enterKeeps, insertSelection, insertText, mergeSourceAnswers, pickId, pickKey, triggerOf } from "@ep0ch/outline-core/completion-source";
import type { CompletionAtRequest, CompletionAtRow, CompletionRowsRequest, CompletionRowsResult } from "@ep0ch/outline-core/protocol";

/** The request has the text and the cursor in place of a detected token. */
export const asksAtCursor = (request: CompletionRowsRequest | CompletionAtRequest): request is CompletionAtRequest => !("target" in request) && typeof (request as CompletionAtRequest).text === "string";

/** The token at the cursor and its rows, with `rows` asking the sources for a detected token as `completion.rows` does. */
export async function completionAt(request: CompletionAtRequest, rows: (asked: CompletionRowsRequest) => Promise<CompletionRowsResult>): Promise<CompletionRowsResult> {
  const { text, cursor, ...rest } = request;
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
    const rows = answer.rows.filter(row => !row.anchor && !row.newPage && !row.newComponent);
    if (rows.length === answer.rows.length) return answer;
    const { partial: _, ...rest } = answer;
    return rows.length ? { ...answer, rows } : { ...rest, rows };
  });
  const merged = mergeSourceAnswers(answers, target.query, { picks: found.picks });
  const listed: CompletionAtRow[] = merged.map((merged, index) => {
    const insert = insertText(merged.insert), select = insertSelection(merged.insert);
    // Whether Return is the field's while this row is lit and nothing has been chosen: the one rule's answer, said on
    // the row (a row that would leave the line as typed among them), so the window compares no text to know.
    const enter = enterKeeps({ insertion: insert, ...(merged.enter ? { enter: merged.enter } : {}) }, { chosen: false, line: lines[row] ?? "", start, end });
    return {
      id: `${index}`, label: merged.label, from: merged.from, insert, pick: pickId(insert),
      ...(merged.kind ? { kind: merged.kind } : {}), ...(merged.detail ? { detail: merged.detail } : {}), ...(merged.group ? { group: merged.group } : {}),
      ...(select ? { select } : {}), ...(enter ? { enter } : {}),
    };
  });
  const said = completionSaid(answers, listed.length);
  return {
    answers: [], picks: {}, token: { kind: target.kind, start: lineStart + start, end: lineStart + end, query: target.query }, rows: listed,
    heading: said.heading, ...(said.message ? { message: said.message } : {}), pickKey: pickKey({ trigger: triggerOf(target.kind), kind: target.kind, key: target.key }),
  };
}
