import { ReaderPane } from "../desk/panes";
import { extensionList } from "../extensions";
import { leaf } from "../desk/screen-layout";
import type { Section, stageDesk, deskOf } from "./showcase";

export function runbookSections(parts: { stageDesk: typeof stageDesk; deskOf: typeof deskOf }): Section[] {
  const { stageDesk, deskOf } = parts;
  return [
  {
    key: "runbook", need: "run a note's steps in a terminal and answer a masked prompt",
    part: "runbook extension plans and records; compact asks through askInBar and ListPicker; PtyPane through PtyBackend in the desk",
    files: "src/runbook.ts, src/bar/ask.ts, src/desk/pty.ts, outliner/extensions/runbook",
    aside: "run each fence by mouse or keyboard; context flows down the note, prompts stay private, and the Runs table keeps each result",
    stage(_n, show) {
      const reader = new ReaderPane();
      const d = stageDesk({ title: "showcase · runbook", panes: [reader], layout: ([a]) => leaf(a!) });
      show(ctx => void (async () => {
        const listed = extensionList() ?? await ctx.board.listExtensions();
        const page = listed.pages?.runbook;
        const book = page && (await ctx.board.children(page)).find(b => b.text.startsWith("Try a terminal runbook"));
        if (book) reader.show(book, d);
        ctx.redraw();
      })());
      return d;
    },
  },
  {
    key: "sh-lines", need: "run a shell line and keep replaceable output beside it",
    part: "runbook handlers, script notes, Site cwd and materialized output regions; the shared component row carries status and actions",
    files: "outliner/extensions/runbook, outline-core/src/shell-line.ts",
    aside: "x or the run chip executes; K keeps output as your text. Edited output asks before replacement. Try | as files, tasks, links, list, table or code.",
    stage(n, show) {
      const reader = new ReaderPane();
      return deskOf({ title: "showcase · sh:: lines", panes: [reader], layout: ([a]) => leaf(a!) }, show, [[reader, n.shLines]]);
    },
  },
  ];
}
