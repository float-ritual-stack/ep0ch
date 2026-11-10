import { ReaderPane } from "../desk/panes";
import { NOTE_ACTIONS } from "../surface/note";
import type { Section, deskOf as MakeDeskFunction } from "./showcase";
type MakeDesk = typeof MakeDeskFunction;

export function completionSection(deskOf: MakeDesk): Section {
  return {
    key: "completion", need: "see what a completion row is before choosing it: what kind of thing, a dim detail, and its docs wrapped beside the list (PIE-1339)",
    part: "the completer's rows and docs panel (PIE-1339, PIE-1245): each row draws its own fields (CompletionItem's label, detail, kind, docs), never a switch on its kind; the docs go beside the list when 30 columns are free, else under it, each sized to what it holds (bar/list-preview.ts listWithDocs, Helix's completion.rs rule); ⏎ and tab both insert unless the footer says ⏎ is a new line (enterKeeps); the popup's keys are actions: complete.ask, complete.move, complete.accept, complete.dismiss, complete.docs",
    files: "src/surface/completion-popup.ts (renderCompletion, enterKeeps), src/surface/completion-actions.ts (COMPLETION_ACTIONS), src/bar/list-preview.ts, src/surface/note-actions/editing.ts (the complete.* forwards)",
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

export function completionPlaceSection(deskOf: MakeDesk): Section {
  return {
    key: "completion-place", need: "see the matches right where you type, the preview beside them and the note still readable around them (PIE-1511)",
    part: "the completion popup's one placement (completion-float.ts drawCompletionFloat), used by every host (the desk, a screen, the board's composer, the power bar) and every source (pages, Work IDs, properties, an extension's): it measures the popup, then places it. A: under the caret, at its column, as tall as its rows, the preview a column to its right, moved left when the right edge is near. B: where A won't fit under the caret, a short sheet along the bottom, list left and preview right. Near the bottom it goes above the caret. The key hints are the status bar's (popupHint); a click lights a row and previews it, a second click inserts (RowPresses, as the power bar's rows), the wheel moves (complete.move)",
    files: "src/surface/completion-float.ts (drawCompletionFloat), src/surface/completion-popup.ts (renderCompletion, anchoredRows), src/bar/list-preview.ts (listWithDocs), src/surface/completer.ts (Completer.click, drawn.layout)",
    aside: "Go in (⏎): the edit is open with [[sow- typed on Bed 1's line, and the sowing weeks drop under the cursor with the preview beside them · ↓ some lines, End, type ((Sowing week: where the list won't fit under the cursor (a list taller than a third of the screen: a short terminal or tile) it opens as a sheet along the bottom; near the bottom it goes above · a click lights a row and previews it, a second click inserts, the wheel moves · ↑↓ ⏎ tab esc are said in the status bar · act: draft.place line=20, draft.paste text=[[sow-, complete.ask; peek's completion.layout says below, above or sheet",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · completion placement", panes: [r], names: ["calendar"] }, show, [[r, n.completionPlace]], d => {
        void d.press(r, NOTE_ACTIONS, "edit")
          .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 5 }))
          .then(() => d.press(r, NOTE_ACTIONS, "draft.paste", { text: "[[sow-" }))
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

/** The editing keys (PIE-1607): the edit open with a phrase lit, ready for its keys. */
export function editKeysSection(deskOf: MakeDesk): Section {
  return {
  key: "edit-keys", need: "edit with the keys a Mac editor's hands know: select to a line's edge, move a line, go to the text's ends, wrap a selection, in every place a person types", part: "the one key table, DRAFT_KEYS, read by Draft.binding through exactKeyName: draft.go, draft.select, draft.line, draft.erase, draft.cut, draft.wrap, every key beside a twin that arrives where a terminal takes the cmd chord (UI-GRAMMAR, The keys of a draft); the selection is the theme's focus.selection, a clear blue that's never the cursor's cyan", files: "src/edit.ts, src/kbd.ts, src/surface/actions.ts, src/surface/line.ts, src/draft-view.ts, src/theme.ts, test/edit-keys.test.ts",
  aside: "the edit is open with \"early peas\" lit: type [ twice and it's [[early peas]], still lit; ( \" ' ` * _ ~ { wrap the same, ** by the key twice, with=[[ or with=** by act · cmd+shift+←/→ select to the line's edge from the cursor (shift+Home, shift+End, alt+H, alt+E) · alt+↑ alt+↓ move the line or the selected lines, alt+shift+↑↓ copy them, alt+D (cmd+shift+k) deletes them · cmd+↑↓, ctrl+Home, ctrl+End or alt+< alt+> go to the text's ends; alt+{ alt+} select to them · alt+←→ (Ghostty sends alt+b alt+f) go by word, with shift select by word, alt+W selects the word, alt+L the line, alt+S all · alt+backspace, alt+delete erase a word, cmd+backspace or ctrl+u to the line's start · alt+x (cmd+x) cuts · the same in a comment and the power bar's line, where alt+←→ stay its scope (ctrl+←→ or alt+shift+←→ there) · the keys window (?) lists and rebinds each",
  stage(n, show) {
    const r = new ReaderPane();
    return deskOf({ title: "showcase · editing keys", panes: [r] }, show, [[r, n.editKeys]], d => {
      void d.press(r, NOTE_ACTIONS, "edit")
        .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 3, col: 11 }))
        .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 3, col: 21, extend: true }));
    });
  },
};
}
