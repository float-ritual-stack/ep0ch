// One-off: `[welcome::n]` numbers become the Welcome view's hand-set order, and every welcome value becomes `true`.
// Welcome notes are marked by the property's presence now (any value), ordered by the Welcome view ([query::welcome],
// #190's order). Run it by hand once per outline that has welcome notes, then delete it (git keeps it). The door has no
// runtime fallback to the numbers: one version.
//
//   bun packages/door/scripts/welcome-order.ts --ws <outline> [--as <actor id>] [--apply]
//
// Without --apply it prints the order it would set and the values it would rewrite. It reads the order as the door did
// before: numbered notes first, lowest first; any other value after them, by title; ties by when they were written.
// The order is set once, by the run that makes the Welcome view; a run that finds the view there (a second run, one
// that failed part way) only rewrites the values left, so a retry never re-orders from half-converted values. Each
// value is rewritten only if its note is still at the revision this run read (else it's said, and left). Recorded as
// the agent named by --as (default welcome-order).
import { relative } from "node:path";
import { subject, type Msg } from "../src/board";
import { connectTarget } from "../src/door";
import { WELCOME_KEY, WELCOME_VIEW_TEXT, welcomeView } from "../src/hub/welcome";
import type { Actor } from "../src/socket";

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const ws = flag("--ws"), apply = args.includes("--apply");
const me = relative(process.cwd(), import.meta.path) || "welcome-order.ts";
if (!ws) { console.error(`say which outline: bun ${me} --ws <outline> [--as <actor id>] [--apply]`); process.exit(2); }
const actor: Actor = { kind: "agent", id: flag("--as") ?? "welcome-order" };

/** The order the door used before: numbers first, lowest first; then the rest by title; ties by age. */
const number = (m: Msg): number | null => { const v = m.props[WELCOME_KEY]?.trim() ?? ""; return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
const before = (list: Msg[]) => [...list].sort((a, b) => {
  const x = number(a), y = number(b);
  if (x !== null && y !== null && x !== y) return x - y;
  if ((x === null) !== (y === null)) return x === null ? 1 : -1;
  return subject(a).localeCompare(subject(b)) || a.createdAt - b.createdAt;
});

const target = await connectTarget(["--ws", ws]);
if ("error" in target) { console.error(target.error); process.exit(1); }
const { board } = target;
const notes = before(await board.query(WELCOME_KEY, 500, "created", "asc", false));
let view = await welcomeView(board);
console.log(`${notes.length} welcome note(s) on ${ws}, in this order:`);
notes.forEach((m, i) => console.log(`  ${i + 1}. ${subject(m)} [${WELCOME_KEY}::${m.props[WELCOME_KEY] ?? ""}] ((${m.id}))`));
console.log(view ? `the Welcome view: ${subject(view)} ((${view.id}))` : "no Welcome view yet");
const rewrite = notes.filter(m => (m.props[WELCOME_KEY] ?? "").trim() !== "true");
const ordering = !view && notes.some(m => number(m) !== null);
console.log(ordering ? "this order is set on the Welcome view this run makes" : view ? "the Welcome view is there: its order is left as it is (only values are rewritten)" : "no numbered welcome notes: no order to set");
console.log(`${rewrite.length} value(s) to rewrite to true`);
if (!apply) {
  console.log(`\nnothing written yet · bun ${me} ${args.join(" ")} --apply`);
  board.close();
  process.exit(0);
}

// The order is set by the run that makes the view, from the values as read; a later run (the view there) never re-orders.
if (!view && notes.some(m => number(m) !== null)) {
  view = await board.createBlock(null, WELCOME_VIEW_TEXT, actor);
  console.log(`✓ made the Welcome view ((${view.id}))`);
  const order = await board.moveInView({ view: view.id, blocks: notes.map(m => m.id) }, actor);
  console.log(`✓ the Welcome view's hand-set order: ${order.blockIds.slice(0, notes.length).map(id => subject(notes.find(m => m.id === id) ?? { text: id } as Msg)).join(" · ")}`);
}
let done = 0, failed = 0;
for (const m of rewrite) {
  try {
    const { revision, tokens } = await board.propertyTokens(m.id, WELCOME_KEY);
    // Changed since this run read it (its order was taken from that read): left for the person, said.
    if (m.revision !== undefined && revision !== m.revision) throw new Error(`it changed since this run read it (revision ${m.revision}, now ${revision}); check its place in the Welcome view`);
    const ops = tokens.filter(t => t.scope === "block" && t.value.trim() !== "true").map(t => ({ op: "replace" as const, ordinal: t.ordinal, value: "true" }));
    if (ops.length) await board.patchProperties(m.id, revision, ops, actor);
    done++;
  } catch (e) {
    failed++;
    console.log(`✗ ${subject(m)} ((${m.id})): ${(e as Error).message} · set it by hand to [${WELCOME_KEY}::true], or run this again`);
  }
}
board.close();
console.log(`\n✓ ${done} value(s) rewritten to true${failed ? ` · ✗ ${failed} not (above)` : ""} · open the door's Welcome (C) to check the order`);
process.exit(failed ? 1 : 0);
