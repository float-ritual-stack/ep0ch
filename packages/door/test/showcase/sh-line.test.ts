import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { ReaderPane } from "../../src/desk/panes";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("sh:: lines in the showcase", () => {
  const h = useShowcaseScreen();
  const actor = { kind: "agent", id: "garden-helper" } as const;
  const act = (action: string, args = {}, tile?: string) => h.app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, actor);

  test("a shell line owns replaceable output, keeps edits, and explains failed commands and formatters", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "sh-lines" } }, { kind: "user" });
    await until(() => h.screen().includes("Shell lines keep their output"), "runbook reader");
    await h.app.dispatch.act({ action: "section.try" }, { kind: "user" });
    writeFileSync(join(h.scratch.root, "beds.md"), "Garden beds\n");
    const note = await h.board.createBlock(null, `Garden files [cwd::${h.scratch.root}]\n\nsh:: ls *.md | sed 's/.*/&/' | as files`);
    const reader = h.sc.tilesHere()!.pane("reader") as ReaderPane;
    reader.show(note, h.sc.tilesHere()!);
    h.screen();
    expect(h.screen()).toContain("ls *.md | sed 's/.*/&/' | as files");
    const run = () => act("ext.runbook.run-sh", { block: note.id, line: 2 });
    await run();
    let saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)[0]?.body).toContain(`- [file::${join(h.scratch.root, "beds.md")}]`);
    await until(() => h.screen().includes("as of") && h.screen().includes("run again"), "the shell output's provenance");
    writeFileSync(join(h.scratch.root, "seeds.md"), "Garden seeds\n");
    await run();
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(1);
    expect(findOutputRegions(saved.text)[0]!.body).toContain("seeds.md");
    await h.board.update(note.id, saved.text.replace("> - [file::", "> My own words\n> - [file::"), saved.revision!);
    await expect(run()).rejects.toThrow("edited");
    expect((await h.board.get(note.id))!.text).toContain("My own words");
    await h.app.dispatch.act({ action: "ext.runbook.run-sh", args: { block: note.id, line: 2 } }, { kind: "user" });
    await until(() => h.app.bar?.scope === "ask", "confirmation beside the edited output");
    expect(h.app.bar!.draw(200, 60).lines.join("\n")).toContain("This output was edited");
    h.press({ kind: "paste", text: "Replace output" });
    await until(() => h.app.bar?.items.some(i => i.row.data === "Replace output") ?? false, "replace choice");
    h.press({ kind: "enter" });
    for (let end = Date.now() + 10000; (await h.board.get(note.id))!.text.includes("My own words");) {
      if (Date.now() > end) throw new Error("confirmed replacement did not arrive");
      await Bun.sleep(30);
    }
    saved = (await h.board.get(note.id))!;
    await h.board.update(note.id, saved.text.replace("> - [file::", "> My own words\n> - [file::"), saved.revision!);
    await act("ext.runbook.keep-sh", { block: note.id, line: 2 });
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(0);
    expect(saved.text).toContain("\nMy own words\n");
    await h.board.update(note.id, "Garden failure\n\nsh:: printf 'bad pot\\n' >&2; exit 2", saved.revision!);
    await expect(run()).rejects.toThrow("exit 2: bad pot");
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(0);
    await until(() => h.screen().includes("exit 2: bad pot"), "failure beside the line");
    await h.board.update(note.id, "Garden formatter\n\nsh:: printf beds | as nothere", saved.revision!);
    await expect(run()).rejects.toThrow(/script.*nothere.*(nearest|mean|Scripts)/i);
    expect(findOutputRegions((await h.board.get(note.id))!.text)).toHaveLength(0);
  }, 45000);
});
