/*
 * The drawer's own program is the tile with role `agent` (PIE-1286), saved on its leaf. A layout saved by an older door
 * says which tile it is only by the program key it runs under (`kept: "drawer.json:drawer.agent"`, or `drawer.json#<n>:…`
 * once it had left for a screen and come back), and may have lost its name (`shell`) and its place (`slot`). This gives that
 * leaf its role, and in the drawer's own file its name, slot and kind too.
 *
 *   ep0ch session end --all --yes     # first: a running session holds the old layout and saves over this one
 *                                     # (or, to keep the agent running, run this right before `ep0ch install --apply`)
 *   bun packages/door/scripts/migrations/drawer-own-role.ts [<state dir>]          # says what it would change
 *   bun packages/door/scripts/migrations/drawer-own-role.ts [<state dir>] --write  # changes it
 *
 * In the door's state dir (EP0CH_STATE, else $XDG_STATE_HOME/ep0ch-door), every folder's drawer-tiles.json and every other
 * saved layout (*.json) that holds such a leaf. Run once on each machine that matters (float-2 for pie), then delete this file.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../../src/state";

const OWN_KEY = /^drawer\.json(#\d+)?:drawer\.agent$/;

/** A saved layout with the drawer's own program's leaf given its role; the leaves it changed. `drawer`: the drawer's own file. */
export function migrateLayout(v: unknown, drawer: boolean): { value: unknown; changed: number } {
  let changed = 0;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    const mine = o.t === "leaf" && typeof o.kept === "string" && OWN_KEY.test(o.kept);
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(o).map(([k, y]) => [k, walk(y)]));
    if (mine && out.role !== "agent") {
      changed++;
      out.role = "agent";
      if (drawer) Object.assign(out, { kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent" });
    }
    return out;
  };
  return { value: walk(v), changed };
}

function main() {
  const args = process.argv.slice(2), write = args.includes("--write");
  const root = args.find(a => !a.startsWith("--")) ?? stateDir();
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else if (name.endsWith(".json")) files.push(p);
    }
  };
  if (!existsSync(root)) { console.error(`no state dir ${root}; pass it: bun ${process.argv[1]} <state dir>`); process.exit(1); }
  visit(root);
  let total = 0;
  for (const file of files) {
    let json: unknown;
    try { json = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const { value, changed } = migrateLayout(json, file.endsWith("drawer-tiles.json"));
    if (!changed) continue;
    total += changed;
    console.log(`${write ? "changed" : "would change"} ${changed} leaf in ${file}`);
    if (write) writeFileSync(file, JSON.stringify(value));
  }
  console.log(total ? (write ? `done: ${total} leaf` : `${total} leaf: run again with --write`) : "nothing to change");
}

if (import.meta.main) main();
