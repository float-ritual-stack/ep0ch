// An extension attaches a surface beside a reader (Nov 3 review card 16, ledger H), end to end on a scratch service
// seeded with the showcase: install Beside by `act` as a person does, open its facts card beside the note, see the rows
// its render script drew, place and scroll it, close it, and uninstall: the kind goes with the extension.
import { describe, expect, test } from "bun:test";
import { attachmentKinds } from "../../src/surface/attachments";
import { USER } from "../../src/socket";
import { visible } from "../../src/style";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: an extension's attached surface", () => {
  const h = useShowcaseScreen();
  /** What the door painted, as text. */
  const painted = () => { h.app.flush(); return h.painted.map(visible).join("\n"); };
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => h.app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER) as Promise<any>;

  test("Beside's facts card opens beside the note, follows the reader, floats, closes, and goes with the extension", async () => {
    await act("section", { name: "beside" });
    h.screen();
    // Not installed: the kind is nobody's, and the refusal says what is known.
    expect(attachmentKinds()).not.toContain("beside.facts");
    const tile = (await act("tile.open", { kind: "reader", mode: "held", note: h.seeded.notes.shed.id, name: "facts-reader" })).tile as string;
    await act("tile.focus", {}, tile);
    await expect(act("attachment.open", { target: "beside.facts" }, tile)).rejects.toThrow("no attachment kind");

    // Installed the way a person does it (the power bar's install row runs this).
    await act("extensions.install", { id: "beside" });
    await h.app.loadExtensions(true);
    expect(attachmentKinds()).toContain("beside.facts");
    expect(await act("attachment.open", { target: "beside.facts" }, tile)).toMatchObject({ kind: "beside.facts", place: "split" });
    // The rows are the extension's own: the render script ran on the host with this note as props.note.
    await until(() => /\d+ notes? sits? under it|\d+ notes? sit under it/.test(painted()), "the facts card is drawn beside the note");
    expect(painted()).toMatch(/\d+ propert(y|ies):/);

    // Placed and scrolled like any attachment; the layer owns where it goes.
    expect(await act("attachment.place", { target: "beside.facts", place: "floating" }, tile)).toMatchObject({ place: "floating" });
    expect(await act("attachment.scroll", { target: "beside.facts", by: 1 }, tile)).toMatchObject({ kind: "beside.facts" });
    await act("attachment.scroll", { target: "beside.facts", by: -9 }, tile);

    // Put away, then uninstalled: the kind is refused again and the card is gone.
    expect(await act("attachment.close", { target: "beside.facts" }, tile)).toMatchObject({ closed: true });
    await act("attachment.open", { target: "beside.facts" }, tile);
    await act("extensions.uninstall", { id: "beside", demo: "remove" });
    await h.app.loadExtensions(true);
    expect(attachmentKinds()).not.toContain("beside.facts");
    await until(() => !/notes? sits? under it|notes? sit under it/.test(painted()), "the card goes with the extension");
    await expect(act("attachment.open", { target: "beside.facts" }, tile)).rejects.toThrow("no attachment kind");
  }, 60_000);
});
