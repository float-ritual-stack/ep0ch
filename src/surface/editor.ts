// The one edit control: a Draft (src/edit.ts) drawn in the same frame, with the same keys and the same
// status line, wherever text is written — a note's whole text, a comment, a reply. Ctrl+E hands any of
// them to $VISUAL/$EDITOR and back through the same path.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "../edit";
import { C, fg, pad, RESET } from "../style";
import { rule } from "../text";

export interface EditFrame {
  /** What is being written, after the `»`: "editing · <note>", "comment · <note>", "reply to x · <note>". */
  title: string;
  /** Status lines under the title (already coloured): revision and state, the last thing that happened. */
  status: string[];
  /** Context between the status and the text, such as the quoted passage. */
  context?: string[];
  /** Who else typed into this draft (an agent), shown so it is never silent. */
  by?: string | null;
}

/** The frame every draft is drawn in: title, status, context, a rule, then the text with its cursor. */
export function renderEditor(d: Draft, f: EditFrame, w: number, h: number): string[] {
  const top = [
    fg(C.yellow) + pad(`» ${f.title}`, w) + RESET,
    ...f.status,
    ...(f.by ? [fg(C.lmagenta) + pad(f.by, w) + RESET] : []),
    ...(f.context ?? []),
    rule(w),
  ];
  return [...top, ...d.render(Math.max(1, w - 2), Math.max(1, h - top.length)).map(l => " " + l)];
}

/** The keys line for a draft, the same words everywhere: `ctrl+s save · ctrl+e $EDITOR · … · esc done`. */
export function editHint(d: Draft, o: { save: "save" | "send"; reload?: string | null; close?: "done" | "back" }): string {
  return `ctrl+s ${o.save} · ctrl+e $EDITOR${o.reload ? ` · ctrl+r ${o.reload}` : ""} · esc ${d.dirty ? "twice discards" : o.close ?? "done"}`;
}

/** A note draft's state, for its status line. */
export function draftState(d: Draft): string {
  return d.conflict ? fg(C.lred) + `! ${d.conflict}`
    : d.saving ? fg(C.grey) + "saving…"
    : d.changedElsewhere ? fg(C.yellow) + "!! changed elsewhere · saving checks it first"
    : d.dirty ? fg(C.yellow) + "unsaved" : fg(C.dark) + "no changes";
}

export interface Suspender { suspend(run: () => void): void }

/**
 * Ctrl+E: the draft goes to $VISUAL/$EDITOR in a temp file and comes back, replacing the draft's text.
 * The base revision stays: the service still judges the save.
 */
export function openInEditor(ctx: Suspender, d: Draft): void {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-edit-"));
  const path = join(dir, `${d.blockId.slice(0, 8)}.md`);
  writeFileSync(path, d.text + "\n");
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  let code: number | null = null;
  try {
    ctx.suspend(() => {
      code = Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", path], { stdio: ["inherit", "inherit", "inherit"] }).exitCode;
    });
    if (code !== 0) d.note = `${editor} exited ${code}; the draft is unchanged`;
    else {
      const before = d.text;
      d.replace(readFileSync(path, "utf8"));
      d.note = d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
