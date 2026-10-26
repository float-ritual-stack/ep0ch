/*
 * A saved leaf's `role` was the slot its screen's spec gave the tile; it is now `slot`, and `role` says what the tile is for
 * (PIE-1286). A layout saved by an older door is moved to the new words: every leaf's `role` becomes its `slot`. The drawer's
 * own program is the tile with role `agent`; an older layout says which tile it is only by the program key it runs under
 * (`kept: "drawer.json:drawer.agent"`, or `drawer.json#<n>:…` once it had left for a screen and come back), and may have lost
 * its name (`shell`) and place: that leaf gets role `agent`, and in the drawer's own file its name, slot and kind too.
 *
 *   ep0ch session end --all --yes     # first: a running session writes its old layout back over this one, at a handover too.
 *                                     # This ends the programs in its tiles (the drawer's claude resumes with --continue).
 *   bun packages/door/scripts/migrations/tile-roles.ts [<state dir>]          # says what it would change
 *   bun packages/door/scripts/migrations/tile-roles.ts [<state dir>] --write  # changes it
 *   ep0ch install --apply             # or just start the door: it reads the new words
 *
 * In the door's state dir (EP0CH_STATE, else $XDG_STATE_HOME/ep0ch-door), every folder's drawer-tiles.json and every other
 * saved layout (*.json) that holds such a leaf. Run once on each machine that matters (float-2 for pie), then delete this file.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../../src/state";

const OWN_KEY = /^drawer\.json(#\d+)?:drawer\.agent$/;

/**
 * A saved layout in the new words, the drawer's own program's leaf given its role; the leaves it changed. `drawer`: the drawer's
 * own file. A layout the new door saved carries `records: 1`; one that does is left alone (so this is safe to run again, and
 * after a new door has saved), and one that doesn't is migrated and marked.
 */
export function migrateLayout(v: unknown, drawer: boolean): { value: unknown; changed: number } {
  let changed = 0;
  const walk = (x: unknown, old: boolean): unknown => {
    if (Array.isArray(x)) return x.map(y => walk(y, old));
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    // A saved layout (it has a tree): old unless the new door marked it.
    const layout = !!o.root && typeof o.root === "object" && "t" in (o.root as object);
    const isOld = layout ? o.records === undefined : old;
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(o).map(([k, y]) => [k, walk(y, isOld)]));
    if (layout && o.records === undefined) { out.records = 1; changed++; }
    if (!isOld || o.t !== "leaf") return out;
    const mine = typeof o.kept === "string" && OWN_KEY.test(o.kept);
    if (mine && out.role !== "agent") {
      changed++;
      out.role = "agent";
      if (drawer) Object.assign(out, { kind: "drawer.own", name: "drawer.agent", slot: "drawer.agent" });
      else if (out.slot === undefined && typeof o.role === "string") out.slot = o.role;
    } else if (typeof o.role === "string" && o.slot === undefined) {
      changed++;
      out.slot = o.role;
      delete out.role;
    }
    return out;
  };
  return { value: walk(v, false), changed };
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
    // Whole or not at all: a file cut short would read as no layout and be skipped by the next run.
    if (write) { writeFileSync(`${file}.tile-roles`, JSON.stringify(value)); renameSync(`${file}.tile-roles`, file); }
  }
  console.log(total ? (write ? `done: ${total} leaf` : `${total} leaf: run again with --write`) : "nothing to change");
}

if (import.meta.main) main();
