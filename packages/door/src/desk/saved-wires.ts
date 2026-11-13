// How a saved layout's wires come back (PIE-1778, out of the desk's build): each tile's saved select source and wires,
// written with the saved ids and names, become wires between this layout's tiles; one whose end isn't here is a wire
// across (to a tile of another screen, PIE-1520); a source that names a container or no tile here is kept as the tile's
// select seed. Pure over the revived tree, its names and the saved-to-new id map.
import { leaves, node, type AltRule, type LNode } from "./layout";
import type { AcrossWire, Wire, WireVerb } from "./screen-layout";

/** A wire as a saved tile wrote it: from the revived tile, to a saved id or name. */
export interface SavedWire { from: number; verb: WireVerb; to: string; rule?: AltRule }

export function reviveWires(saved: { sources: readonly (readonly [number, string])[]; wires: readonly SavedWire[] }, at: {
  tree: LNode; names: ReadonlyMap<number, string>; references: ReadonlyMap<string, string>;
  tileId(id: number): string; group(id: number): boolean; own: boolean;
}): { wires: Wire[]; across: AcrossWire[]; seeds: Map<number, string> } {
  const wires: Wire[] = [], across: AcrossWire[] = [], seeds = new Map<number, string>(), sourceWires: SavedWire[] = [];
  const tileNamed = (ref: string) => [...at.names].find(([id, n]) => at.tileId(id) === ref || n === ref)?.[0];
  for (const [to, savedSource] of saved.sources) {
    const source = at.references.get(savedSource) ?? savedSource;
    const src = tileNamed(source), container = node(at.tree, source);
    if (container || src === undefined) seeds.set(to, source);
    for (const from of src !== undefined ? [src] : container ? leaves(container) : []) sourceWires.push({ from, verb: "select", to: at.tileId(to) });
  }
  for (const { from, verb, to: savedTo, rule } of [...sourceWires, ...saved.wires]) {
    if (at.group(from)) continue;
    for (let i = wires.length - 1; i >= 0; i--) if (verb !== "select" && wires[i]!.from === from && wires[i]!.verb === verb) wires.splice(i, 1);
    for (let i = across.length - 1; i >= 0; i--) if (verb !== "select" && across[i]!.from === from && across[i]!.verb === verb) across.splice(i, 1);
    const to = at.references.get(savedTo) ?? savedTo;
    const target = tileNamed(to);
    if (target === undefined) { if (!across.some(w => w.from === from && w.verb === verb && w.to === to)) across.push({ from, to, verb, rule }); continue; }
    if (target === from && !at.own && !rule && verb !== "open") continue;   // an open wired to itself is in place (PIE-1516): kept through a restart and into a group
    if (!wires.some(w => w.from === from && w.verb === verb && w.to === target)) wires.push({ from, verb, to: target, ...(rule ? { rule } : {}) });
  }
  return { wires, across, seeds };
}
