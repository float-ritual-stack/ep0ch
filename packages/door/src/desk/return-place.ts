import { chainOf, isLine, kidsOf, leaves, replaceNode, type Dock, type Split, type LNode } from "./layout";
import type { At, LayoutState } from "./screen-layout";

export type ReturnShell = Omit<Split, "kids"> | Omit<Dock, "kid" | "view">;

/** Containers that disappeared with their last tile, rebuilt inside the ordinary layout open. */
export function wrapReturn<I>(tree: LNode<I>, tile: I, shells: ReturnShell[] = []): LNode<I> {
  if (!shells.length) return tree;
  const parent = chainOf(tree, tile).at(-1);
  const target = parent ? kidsOf(parent).find(k => k.t === "leaf" && k.id === tile)! : tree;
  const wrapped = shells.reduce<LNode<I>>((kid, shell) => shell.t === "dock" ? { ...shell, kid } : { ...shell, kids: [kid] }, target);
  return replaceNode(tree, target, wrapped);
}

/** The place a closed tile can return to, expressed in the layout module's ordinary open operation. */
export function returnPlace<I>(state: LayoutState<I>, tile: I): At<I> {
  const float = state.floats.find(f => f.id === tile);
  if (float) return { kind: "float", rect: { ...float.rect } };
  const restore: ReturnShell[] = [];
  const placed = (at: At<I>): At<I> => restore.length ? { ...at, restore } : at;
  for (const parent of chainOf(state.tree, tile).reverse()) {
    if (parent.t === "tabs") {
      const target = parent.ids.find(id => id !== tile);
      if (target !== undefined) return placed({ kind: "tabs", target, index: parent.ids.indexOf(tile) });
    }
    if (isLine(parent)) {
      const index = parent.kids.findIndex(k => leaves(k).includes(tile));
      if (parent.t === "split" && leaves(parent).length === 1) {
        const { kids, ...shell } = parent; restore.push(shell); continue;
      }
      if (parent.key) return placed({ kind: "in", key: parent.key, node: parent.id, index, weight: parent.weights?.[index] });
      const sibling = parent.kids[index + 1] ?? parent.kids[index - 1];
      if (sibling) return placed({ kind: "split", target: leaves(sibling)[0]!, dir: parent.dir === "row" ? (parent.kids[index + 1] ? "left" : "right") : (parent.kids[index + 1] ? "up" : "down"), weight: parent.weights?.[index] });
    }
    if (parent.t === "dock") { const { kid, view, ...shell } = parent; restore.push(shell); }
  }
  return placed({ kind: "edge", dir: "right" });
}
export function mapPlace<I, J>(at: At<I>, map: (id: I) => J): At<J> {
  switch (at.kind) {
    case "split": case "tabs": return { ...at, target: map(at.target) };
    case "next": return { ...at, from: map(at.from) };
    case "float": return { ...at, near: at.near === undefined ? undefined : map(at.near) };
    default: return at;
  }
}
