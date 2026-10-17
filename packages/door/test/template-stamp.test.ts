// PIE-533 S4: `template.stamp` through the door's `act`: today's daily note from a template with {{now.date}} filled, an
// agent's attributed stamp that moves nothing of the person's, the person's own stamp asked in the power bar (the template,
// then a prop in the picker of its kind) and opened, a refusal that names the fix. Scratch service, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { asked, propQuestion } from "../src/template-stamp";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const term = (onKey: (f: (k: any) => void) => void) => ({ info: { cols: 160, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey, onResize() {}, stop() {}, resume() {} });

describe("which props a person is asked for", () => {
  test("a choice, a note, or a needed one with no default; the rest take their defaults silently", () => {
    const spec = {
      mood: { kind: "choice" as const, choices: ["good", "meh"], default: "good" },
      owner: { kind: "text" as const, required: true },
      weeks: { kind: "number" as const, default: "2" },
      guide: { kind: "note" as const },
      note: { kind: "text" as const },
    };
    expect(asked(spec, {}).map(q => [q.name, q.type])).toEqual([["mood", "choice"], ["owner", "text"], ["guide", "note"]]);
    expect(asked(spec, { owner: "ada", mood: "meh" }).map(q => q.name)).toEqual(["guide"]);
    expect(propQuestion("mood", spec.mood)).toMatchObject({ type: "choice", choices: ["good", "meh"], value: "good", required: false });
    expect(propQuestion("date", { kind: "text", default: "{{now.date}}" }).value).toBeUndefined();
  });
});

describe.skipIf(!outliner)("template.stamp through act (PIE-533 S4)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App(term(() => {}) as any, board, Date.now(), () => {});
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });
  const mk = (text: string, parentId: string | null = null) => board.request<any>("create", { parentId, text, author: "agent" });
  const act = (args: Record<string, unknown>, as = "test-agent") => app.act({ action: "template.stamp", args, as }) as Promise<any>;

  test("an agent stamps today's daily note: {{now.date}} filled, the template's own chips gone, attributed, nothing of the person's moved", async () => {
    await mk("{{now.date}} [page::daily-template] [type::template] [template-for::daily]\nPlanned: {{this.owner}}");
    const notes = await mk("Daily notes [page::daily notes] [owner::ada]");
    const out = await act({ of: "[[daily-template]]", as: "new", parent: "[[daily notes]]" });
    expect(out.stamped).toHaveLength(1);
    const made = (await board.get(out.stamped[0].id))!;
    expect(made.text).toMatch(/^\d{4}-\d\d-\d\d \[type::daily\] \[from-template::\(\([0-9a-f-]+\)\)\]\nPlanned: \{\{this\.owner\}\}$/);
    expect(made.parentId).toBe(notes.id);
    // Recorded as the agent who asked (the door's own id for the actor).
    expect(made.author).toBe("test-agent");
    expect(out.said).toContain("stamped");
  });

  test("a prop the template needs is refused for an agent with the call that works; an unknown one with the nearest name", async () => {
    await mk("Meeting {{props.with}} [page::meeting-tpl] [type::template] [template-for::meeting]\n[form-field::with text required]\n[form-field::mood choice good|meh default=good]\n{{props.mood}}");
    await expect(act({ of: "[[meeting-tpl]]" })).rejects.toThrow(/needs `with`/);
    await expect(act({ of: "[[meeting-tpl]]", with: JSON.stringify({ with: "Jay", mod: "meh" }) })).rejects.toThrow(/did you mean `mood`\?/);
    const out = await act({ of: "type:meeting", with: JSON.stringify({ with: "Jay" }), freeze: "all" });
    expect((await board.get(out.stamped[0].id))!.text).toStartWith("Meeting Jay [type::meeting]");
    await expect(act({ of: "[[meeting-tpl]]", with: "not json" })).rejects.toThrow(/with= is JSON/);
    await expect(act({})).rejects.toThrow(/needs of=/);
    await expect(act({ of: "[[meeting-tpl]]", into: "((abcd1234^weekly))", with: JSON.stringify({ with: "Jay" }) })).rejects.toThrow(/place\(\)/);
  });

  test("for= stamps once per match; a second run adds nothing", async () => {
    const asks = await mk("Asks");
    await mk("PC-{{props.for.number}} {{props.for.title}} [page::ticket-tpl] [type::template] [template-for::ticket]");
    await mk("Fix the gate [kind::ask] [number::101]", asks.id);
    await mk("Paint the shed [kind::ask] [number::102]", asks.id);
    const first = await act({ of: "[[ticket-tpl]]", parent: asks.id, for: "kind=ask" });
    expect(first.stamped).toHaveLength(2);
    expect((await board.get(first.stamped[0].id))!.text).toMatch(/^PC-10[12] /);
    const again = await act({ of: "[[ticket-tpl]]", parent: asks.id, for: "kind=ask" });
    expect(again.stamped).toHaveLength(0);
    expect(again.skipped).toHaveLength(2);
  });
});
