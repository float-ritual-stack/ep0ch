// PIE-1294: the showcase's while-typing section, its demo and its end-to-end test. The person is in an edit in the
// left reader; an agent opens, follows a link, comments and asks for what's the person's alone, through `act`, and
// every refusal is the owner's words (the actor rule, holdsEdit), never a screen's own. Scratch services only.
import { describe, expect, test } from "bun:test";
import type { Desk } from "../../src/desk/desk";
import type { ReaderPane } from "../../src/desk/panes";
import { USER } from "../../src/socket";
import { holdsEdit } from "../../src/whereabouts";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase: an agent works while the person types (PIE-1294)", () => {
  const h = useShowcaseScreen();

  test("an agent's open, follow, comment and person-only ask leave the person's edit, keys and focus where they are", async () => {
    await h.app.act({ action: "section", args: { name: "while-typing" }, as: "tester" });
    h.press({ kind: "enter" });                                                       // the person goes into the section
    const desk = () => h.S().stages.get(h.S().sel).top as Desk;
    const [left, right] = [...(desk() as any).panes.values()] as ReaderPane[];
    await until(() => !!left!.draft, "the person's edit in the left reader");
    const editing = left!.msg!.id, shed = h.seeded.notes.shed!.id;
    const keys = () => h.app.person();
    // The harness arms an edit first (EP0CH_EDIT_ARM, as the door does): ⏎ opens it, the person's keys in it.
    if (keys().typingIn === null) h.press({ kind: "enter" });
    await until(() => keys().typingIn !== null, "the person's keys in the edit");
    const before = keys();
    const fern = (action: string, args: Record<string, unknown> = {}, tile?: string) => h.app.act({ action, args, ...(tile ? { tile } : {}), as: "fern" });

    // Following a link in the reader the person types in: the actor rule's words.
    await expect(fern("link.follow", {}, before.typingIn!)).rejects.toThrow(`the person is typing in ${before.typingIn}`);
    // An open lands where placement says, never over the edit: the left reader stays on its note with its draft.
    const opened = await fern("open", { id: shed }) as { name: string; id: string };
    expect(opened).toMatchObject({ id: shed });
    expect(opened.name).not.toBe(before.typingIn);
    expect([...(desk() as any).panes.values()].some((p: any) => p !== left && p.msg?.id === shed)).toBe(true);
    expect(left!.msg!.id).toBe(editing);
    expect(left!.draft).toBeTruthy();
    // Seen in use, Oct 29: an agent's open never resizes the tile the person types in. Its size on screen, in cells:
    const size = () => { h.screen(); const r = desk().rectOf(left!)!; return { cols: r.cols, rows: r.rows }; };
    const wide = size();
    // A new tile beside the tile with the keys is refused in the owner's words; beside another, it opens.
    await expect(fern("tile.open", { kind: "reader", mode: "held", note: shed })).rejects.toThrow(`the person is typing in ${before.typingIn}; an agent doesn't resize it`);
    expect(size()).toEqual(wide);
    // A short id (the first 8 characters, as show and find take it) opens, and the edit keeps its size.
    const short = await fern("open", { id: h.seeded.notes.shed!.id.slice(0, 8) }) as { id: string };
    expect(short.id).toBe(shed);
    expect(size()).toEqual(wide);
    // A comment on the other reader's note goes through, attributed, and the keys stay put.
    await fern("comment.note", { body: "A made-up note from fern" }, "2");
    const end = Date.now() + 10_000;
    while (!(await h.board.children(right!.msg!.id)).some(c => c.text.includes("A made-up note from fern"))) { if (Date.now() > end) throw new Error("fern's comment never landed"); await Bun.sleep(50); }
    // What's the person's alone stays theirs, on their press too.
    await expect(fern("agents.yolo", { on: true })).rejects.toThrow("yolo is the person's to hand over");
    // Why the edited reader keeps its note, as every screen asks it: the one answer and its one wording.
    expect(left!.keepsOff(right!.msg)).toBe(holdsEdit("the reader"));

    const after = keys();
    expect({ focus: after.focus, typingIn: after.typingIn }).toEqual({ focus: before.focus, typingIn: before.typingIn });
    expect(left!.draft).toBeTruthy();
  }, 60_000);
});
