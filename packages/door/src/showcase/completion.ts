import { ReaderPane } from "../desk/panes";
import { NOTE_ACTIONS } from "../surface/note";
import type { Section, deskOf as MakeDeskFunction } from "./showcase";
type MakeDesk = typeof MakeDeskFunction;

export function completionSection(deskOf: MakeDesk): Section {
  return {
    key: "completion", need: "see what a completion row is before choosing it: what kind of thing, a dim detail, and its docs wrapped beside the list (PIE-1339)",
    part: "the completer's rows and docs panel (PIE-1339, PIE-1245): each row draws its own fields (CompletionItem's label, detail, kind, docs), never a switch on its kind; the docs go beside the list when 30 columns are free, else under it, each sized to what it holds (bar/list-preview.ts listWithDocs, Helix's completion.rs rule); ⏎ and tab both insert unless the footer says ⏎ is a new line (enterKeeps); the popup's keys are actions: complete.ask, complete.move, complete.accept, complete.dismiss, complete.docs",
    files: "src/surface/completion-popup.ts (renderCompletion, enterKeeps), src/surface/completion-actions.ts (COMPLETION_ACTIONS), src/bar/list-preview.ts, src/surface/note.ts (the complete.* forwards)",
    aside: "Go in (⏎): the reader is writing a comment that ends in ((Gree, and its popup is open: each row says what it is at its right edge (block, anchor, page) with a dim detail on the next line; the lit row's docs wrap beside the list on a wide screen, under it on a narrow one · ↑↓, ctrl+n/p, hover or the wheel light another row and the docs follow · ⏎ or tab inserts it · shift+↑↓, PgUp/PgDn or the wheel over the docs scroll them · esc closes it · type ## Calls :: on a new line: the footer says ⏎ is a new line until you choose with ↑↓ or tab · ctrl+n and ctrl+p move while the popup is open; otherwise they stay a new note and the edit preview (UI-GRAMMAR §7) · After esc, type [heading-p, then a and t: pattern and padding narrow to pattern; an unmatched z closes the list · act: complete.ask, complete.move by=1, complete.accept, complete.dismiss, complete.docs by=1",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · completion", panes: [r], names: ["guide"] }, show, [[r, n.deepLinks]], d => {
        void d.press(r, NOTE_ACTIONS, "passage.select")
          .then(() => d.press(r, NOTE_ACTIONS, "comment.write", { body: "Ask about the beds, see ((Gree" }))
          .then(() => d.press(r, NOTE_ACTIONS, "complete.ask"));
      });
    },
  };
}

export function snippetSection(deskOf: MakeDesk): Section {
  return {
    key: "snippets", need: "fill a component or button's slots without losing the insertion to several undo steps (PIE-1480)",
    part: "completion's SourceInsert slots, selected and tracked by outline-core's SnippetSession in both editors; complete.accept inserts, snippet.next/previous/end move through the same draft; completion-float places the popup with keepOnScreen",
    files: "outline-core/src/completion-snippet.ts, outline-core/src/button-call.ts (slotReferences), src/edit.ts, src/surface/editor.ts, outliner/src/text-buffer.ts, outliner/extensions/issues",
    aside: "Go in (Enter), accept graph-stat with Tab: its first value is selected. Type a title, Tab to the query, Shift+Tab back, then Esc keeps the draft open; ctrl+z removes the whole insertion. The previous, next and end controls above the editor do the same. Try ::button issue next: Issues supplies a button with {label} and {note} slots. A completion with ready candidates takes Tab first; while loading or empty, snippet.next takes Tab; with no snippet, Tab returns to the editor. act: snippet.next, snippet.previous, snippet.end.",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · snippets", panes: [r], names: ["guide"] }, show, [[r, n.sources]], d => {
        void d.press(r, NOTE_ACTIONS, "passage.select")
          .then(() => d.press(r, NOTE_ACTIONS, "comment.write", { body: "::graph-stat" }))
          .then(() => d.press(r, NOTE_ACTIONS, "complete.ask"));
      });
    },
  };
}
