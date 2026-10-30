// Lens (extensions/lens, PIE-1461): one `lens::` line draws a live table of what a query holds, relative to the note
// it's in. Installing it seeds the lab; a day note's line reads {{this.page}} so each day shows its own meetings; a
// computed column and its sum; a group; a cell pressed through lens-set changes the row's property and the table
// redraws; uninstalling keeps the notes. A scratch service in a temp folder; every note and name is made up.
import { expect, test } from "bun:test";
import type { ScriptEnded } from "@ep0ch/outline-core/protocol";
import { setup, until } from "./script-harness";

async function lab() {
  const h = await setup();
  const ended = new Map<string, ScriptEnded>();
  let connected = false;
  const watcher = h.client.watch({ client: { clientId: "lens-reader", role: "observer", contextId: "lens" },
    onConnect: () => { connected = true; }, onEvent: e => { if (e.ended) ended.set(e.ended.run, e.ended); } });
  await until("the answer reader", () => connected);
  const installed = await h.client.request<{ state?: string; page?: string }>({ action: "extensions.install", extension: "lens" });
  const byTitle = (start: string) => h.store.queryBlocks({ where: "updated >= -1d", limit: 500 }).blocks.find(b => b.text.startsWith(start))!;
  /** Draws a note and waits for its lens's output, as a reader would. */
  const drawn = async (id: string, holds: string) => {
    await h.draw(id);
    return await until(`${holds} in the lens`, () => h.output(id).find(o => o?.includes(holds)));
  };
  /** One `lens-set` as a press would run it: the action script on the row's note, answered when the run ends. */
  const set = async (args: Record<string, string>) => {
    const run = await h.client.request<{ undo: string }>({ action: "extensions.act", extension: "script:lens-set", extensionAction: "run", args, clientId: "lens-reader", mutation: { author: "user" } });
    return await until(`lens-set ${JSON.stringify(args)}`, () => ended.get(run.undo));
  };
  const chips = (id: string) => Object.fromEntries(h.store.require(id).properties.map(p => [p.key, p.value]));
  return { ...h, installed, byTitle, drawn, set, chips, stop: () => watcher.stop() };
}

test("a day note's lens reads this.page, a computed column sums, and a group folds the rows", async () => {
  const { installed, byTitle, drawn, stop } = await lab();
  try {
    expect(installed.state).toBe("active");
    // Each day shows its own meetings: the same line in both notes, two different tables.
    const dayOne = byTitle("2031-03-02 "), dayTwo = byTitle("2031-03-03 ");
    const one = await drawn(dayOne.id, "Standup");
    expect(one).toContain("Retro");
    expect(one).not.toContain("Planning");
    const two = await drawn(dayTwo.id, "Planning");
    expect(two).not.toContain("Standup");
    // The computed column and its footer: 5*2 + 3*4 + 2*3 = 28 over 10 seeds.
    const order = await drawn(byTitle("Seed order").id, "Σ");
    expect(order).toContain("| Beans | 5 | 2 | 10 |");
    expect(order).toContain("| Σ | 10 |  | 28 |");
    // Grouped by priority: a box per value with its count.
    const jobs = await drawn(byTitle("Jobs").id, "high · 2");
    expect(jobs).toContain("low · 1");
    expect(jobs).toContain("| Fix the gate latch | todo | Ada |");
    // The saved view works as the source, with its sort.
    const meetings = await drawn(byTitle("Meetings ").id, "Planning");
    expect(meetings.indexOf("Standup")).toBeLessThan(meetings.indexOf("Planning"));
  } finally { stop(); }
}, 60_000);

test("a pressed cell steps the property through its choices (then its values, then unset), and the table redraws", async () => {
  const { byTitle, drawn, set, chips, store, stop } = await lab();
  try {
    const gate = byTitle("Fix the gate latch");
    const jobs = byTitle("Jobs");
    await drawn(jobs.id, "todo");
    // What the stage cell's press runs: next among the choices the line gave.
    const stepped = await set({ note: gate.id, key: "stage", next: "1", choices: "todo|doing|done" });
    expect(stepped.reason).toBe("done");
    expect(stepped.message).toBe("Fix the gate latch: stage todo → doing");
    expect(chips(gate.id).stage).toBe("doing");
    // The door declares the presser (`mutation`): the cell's write is theirs, the script its how (PIE-1462).
    expect(store.revisions(gate.id).revisions.find(r => r.revision === 2)).toMatchObject({ author: "user" });
    await until("the table redrawn", () => h2(store, jobs.id).some(o => o?.includes("| Fix the gate latch | doing | Ada |")));
    // Without choices: every value the key has in the outline, in order, then unset.
    const shed = byTitle("Paint the shed");
    expect((await set({ note: shed.id, key: "stage", next: "1" })).message).toBe("Paint the shed: stage doing → done");
    expect((await set({ note: shed.id, key: "stage", next: "1" })).message).toBe("Paint the shed: stage done → (unset)");
    expect(chips(shed.id).stage).toBeUndefined();
    expect((await set({ note: shed.id, key: "stage", next: "1" })).message).toBe("Paint the shed: stage (unset) → doing");
    // A value, as an agent writes it.
    expect((await set({ note: shed.id, key: "owner", value: "Ada" })).message).toBe("Paint the shed: owner Sam → Ada");
    const refused = await set({ note: shed.id, key: "stage" });
    expect(refused.reason).not.toBe("done");
  } finally { stop(); }
}, 60_000);

test("the line's words are checked, and uninstalling keeps the notes", async () => {
  const { byTitle, drawn, client, store, create, stop } = await lab();
  try {
    const bare = create("No query\nlens::");
    expect(await drawn(bare.id, "needs query=")).toContain("lens: needs query=");
    const broken = create('Bad expression\nlens:: query="type=seed-line" columns=title,cost cost="qty *"');
    expect(await drawn(broken.id, "lens:")).toMatch(/cost="qty \\?\*": unexpected token/);
    const empty = create('Empty\nlens:: query="type=nothing-has-this" empty="no rows yet"');
    expect(await drawn(empty.id, "no rows yet")).toContain("no rows yet");
    // A reserved word as a key ([default::…]) doesn't stop the computed column compiling; a value shows as written.
    create("Zip [type::crate] [qty::2] [price::1.50] [default::yes] [zip::02134]");
    create("Zap [type::crate] [qty::3] [price::2]");
    // A row without qty computes NaN: an empty cell, left out of the sum (not "NaN" in both).
    create("Zop [type::crate] [price::4]");
    const crates = create('Crates\nlens:: query="type=crate" columns=title,zip,price,cost cost="qty * price" sum=cost sort=title');
    const drawnCrates = await drawn(crates.id, "| Σ |");
    expect(drawnCrates).toContain("| Zip | 02134 | 1.50 | 3 |");
    expect(drawnCrates).toContain("| Zop |  | 4 |  |");
    expect(drawnCrates).toContain("| Σ |  |  | 9 |");
    expect(drawnCrates).not.toContain("NaN");
    // The saved view by its page, as the lab's prose says.
    const byPage = create('By page\nlens:: view="[[meetings]]" columns=title');
    expect(await drawn(byPage.id, "Standup")).toContain("Planning");
    // A typo in an expression is said once, not once per row.
    const typo = create('Typo\nlens:: query="type=crate" columns=title,cost cost="qty * prise"');
    const said = await drawn(typo.id, "prise");
    expect(said.split("prise is not defined").length - 1).toBe(1);
    // A view that doesn't resolve, and a query the grammar refuses, are said by the lens, not the runtime.
    const noView = create('No view\nlens:: view="[[no-such-view]]"');
    expect(await drawn(noView.id, "lens: view=")).toContain("no-such-view");
    const badQuery = create('Bad query\nlens:: query="(type=crate" columns=title');
    expect(await drawn(badQuery.id, "lens: query=")).toContain("Unclosed (");
    await client.request({ action: "extensions.uninstall", extension: "lens", demo: "keep" });
    expect(store.require(byTitle("Seed order").id).text).toContain("lens::");
    await expect(client.request({ action: "extensions.act", extension: "script:lens-set", extensionAction: "run", args: { note: "x", key: "y", value: "z" }, clientId: "lens-reader" }))
      .rejects.toThrow("No extension script:lens-set is active here");
  } finally { stop(); }
}, 60_000);

const h2 = (store: { extensionOutputs(id: string): { result: unknown; error?: string | null }[] }, id: string) =>
  store.extensionOutputs(id).map(row => (row.result as { markdown?: string } | null)?.markdown ?? row.error ?? null);
