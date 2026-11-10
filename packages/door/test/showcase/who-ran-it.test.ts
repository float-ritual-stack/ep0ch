// PIE-1651, PIE-1406: an action that changes something says who ran it, in one shape (`recordedAs`, built by
// `recordedAnswer` from `recorded()` in socket.ts), and the screen says it too. Three actions took an actor and dropped
// it: tile.type (an agent typing into a terminal tile), agents.yolo (an agent taking the door back) and access.apply
// (the person's alone: an agent's is refused, naming it). Driven on the showcase's terminal and access sections through
// `act`, as an agent and as the person. Scratch service, the showcase's fictional seed.
import { describe, expect, test } from "bun:test";
import { Desk } from "../../src/desk/desk";
import { PtyPane } from "../../src/desk/pty";
import { PTY_ACTIONS } from "../../src/desk/pty-actions";
import { ACCESS_MATRIX_ACTIONS } from "../../src/desk/access-matrix";
import { BOARD_ACTIONS } from "../../src/desk/lanes";
import { TILE_ACTIONS } from "../../src/desk/tile-actions";
import { SHELL_ACTIONS } from "../../src/screens";
import { NOTE_ACTIONS } from "../../src/surface/note";
import { SECTIONS } from "../../src/showcase/showcase";
import { WELCOME_ACTIONS } from "../../src/hub/welcome";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner || process.platform !== "linux")("who ran it (PIE-1651, PIE-1406)", () => {
  const h = useShowcaseScreen();
  const AS = "garden-bot-1651";
  const said = () => String((h.app as any).message ?? "");

  test("an agent's tile.type answers who typed, the tile keeps it, and the status bar names the agent", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "terminal" }, as: AS });
    await until(() => !!h.S().stages.get(h.S().sel), "the terminal section");
    const d = h.S().stages.get(h.S().sel).top as Desk;
    const shell = () => d.pane("pty") as PtyPane;
    await until(() => shell().running, "the shell runs", 10_000);
    const r = await h.app.act({ action: "tile.type", args: { text: "echo planted\\n" }, tile: "pty", as: AS }) as Record<string, unknown>;
    expect(r).toMatchObject({ chars: 14, recordedAs: { author: "agent", actorId: AS, says: `an agent (${AS})'s` } });
    expect(said()).toContain(`an agent (${AS}) typed into pty`);
    // The tile's own record, as peek reads it: who typed into it last.
    expect(shell().describe()).toMatchObject({ typed: { by: AS, chars: 14 } });
  }, 30_000);

  test("an agent takes yolo back: its answer and the service's record name it, and the status bar says who", async () => {
    (h.app as any).lastInput = 0;
    // The person hands the door over (theirs alone: an agent's on=true is refused, naming why).
    await expect(h.app.act({ action: "agents.yolo", args: { on: true }, as: AS })).rejects.toThrow(/person's to hand over/);
    const mine = await h.app.dispatch.act({ action: "agents.yolo", args: { on: true } }, { kind: "user" }) as Record<string, unknown>;
    expect(mine).toMatchObject({ on: true, recordedAs: { author: "user", says: "yours" } });
    await until(() => h.app.agentsYolo, "yolo on");
    const back = await h.app.act({ action: "agents.yolo", args: { on: false }, as: AS }) as Record<string, unknown>;
    expect(back).toMatchObject({ on: false, recordedAs: { author: "agent", actorId: AS, says: `an agent (${AS})'s` } });
    expect(said()).toContain(`an agent (${AS})`);
    expect(said()).toContain("back under the person guards");
    // The service took it back too: it was told who asked (an agent may only take it back).
    expect((await h.board.request("mcp.access.status", {})).yolo).not.toBe(true);
  }, 30_000);

  test("access.apply: an agent's is refused naming it; the person's answers recordedAs yours", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "access" }, as: AS });
    await until(() => h.screen().includes("● full"), "the matrix", 10_000);
    const args = { caller: "claude-code@float-2", outline: "gurgle", level: "propose" };
    await expect(h.app.act({ action: "access.apply", tile: "access", args, as: AS })).rejects.toThrow(/person/i);
    expect(said()).toContain(`an agent (${AS}) · access.apply refused`);
    const r = await h.app.dispatch.act({ action: "access.apply", tile: "access", args }, { kind: "user" }) as Record<string, unknown>;
    expect(r).toMatchObject({ ran: ["ep0ch mcp access propose --ws gurgle"], recordedAs: { author: "user", says: "yours" } });
  }, 30_000);

  // PIE-1655: the three PIE-1406 left out. Each, run by an agent through act, answers recordedAs and the status bar names it.
  const agent = { author: "agent", actorId: AS, says: `an agent (${AS})'s` };

  test("card.move: an agent's move answers who it was recorded as, and the status bar names the agent", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "spine" }, as: AS });
    const model = () => { h.screen(); return (h.S().stage(SECTIONS.findIndex(s => s.key === "spine")).top as any).modelFor("lanes") as any; };
    await until(() => !!model()?.lanes?.length && model().lanes.every((l: any) => l.items), "the board's lanes", 8000);
    const card = model().lanes.find((l: any) => l.name === "Queued").items[0].id as string;
    const r = await h.app.act({ action: "card.move", args: { lane: "Doing", card }, as: AS }) as Record<string, unknown>;
    expect(r).toMatchObject({ card, lane: "Doing", recordedAs: agent });
    expect(said()).toContain(`an agent (${AS}) · moved to Doing`);
  }, 30_000);

  test("a comment, a reply and a whole-note comment sent by an agent answer who they were recorded as", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "scripts" }, as: AS });
    h.screen();
    const tile = "notes";
    const sent = await h.app.act({ action: "comment", tile, args: { quote: "Prepare the seed labels", body: "Which pen for the labels?" }, as: AS }) as { threads: { id: string }[]; recordedAs?: unknown };
    expect(sent).toMatchObject({ sent: "comment", recordedAs: agent });
    expect(said()).toContain(`an agent (${AS})`);
    const thread = sent.threads.at(-1)!.id;
    expect(await h.app.act({ action: "reply", tile, args: { thread, body: "The waterproof one" }, as: AS })).toMatchObject({ sent: "reply", recordedAs: agent });
    expect(await h.app.act({ action: "comment.note", tile, args: { body: "Labels before sowing" }, as: AS })).toMatchObject({ whole: true, recordedAs: agent });
    expect(said()).toContain(`an agent (${AS}) · commented on the whole note`);
    await h.app.act({ action: "comment.close", tile, args: { discard: true }, as: AS }).catch(() => undefined);
  }, 30_000);

  test("welcome.move: an agent's reorder answers who it was recorded as, and the status bar names the agent", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "screen.open", args: { name: "welcome" }, as: AS });
    const top = () => h.app.screens().at(-1) as any;
    const items = () => (top().pane?.("welcome")?.items ?? null) as { id: string }[] | null;
    await until(() => top().name === "welcome" && items()?.length === 2, "the two seeded welcome notes");
    const r = await h.app.act({ action: "welcome.move", args: { id: items()![1]!.id, to: 1 }, as: AS }) as Record<string, unknown>;
    expect(r).toMatchObject({ n: 1, of: 2, recordedAs: agent });
    expect(said()).toContain(`an agent (${AS}) moved House rules to welcome 1 of 2`);
    await h.app.act({ action: "screen.back", args: {}, as: AS });
  }, 30_000);

  test("every writing action's page says the recordedAs field, from the action's own answer", () => {
    const sets = [PTY_ACTIONS, SHELL_ACTIONS, ACCESS_MATRIX_ACTIONS, NOTE_ACTIONS, BOARD_ACTIONS, TILE_ACTIONS, WELCOME_ACTIONS];
    for (const name of ["tile.type", "agents.yolo", "access.apply", "edit.save", "card.create", "card.reorder", "note.trash", "note.move", "props.edit", "image.size", "settings.set", "card.move", "comment.send", "comment", "reply", "comment.note", "welcome.move"]) {
      const info = sets.flatMap(s => s.list()).find(x => x.name === name);
      expect({ name, field: info?.answer?.recordedAs?.type }).toEqual({ name, field: "object" });
    }
  });
});
