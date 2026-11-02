import { chainOf, isLine, leaves } from "./layout";
import type { At, LayoutState } from "./screen-layout";

/** The place a closed tile can return to, expressed in the layout module's ordinary open operation. */
export function returnPlace<I>(state: LayoutState<I>, tile: I): At<I> {
  const float = state.floats.find(f => f.id === tile);
  if (float) return { kind: "float", rect: { ...float.rect } };
  for (const parent of chainOf(state.tree, tile).reverse()) {
    if (parent.t === "tabs") {
      const target = parent.ids.find(id => id !== tile);
      if (target !== undefined) return { kind: "tabs", target, index: parent.ids.indexOf(tile) };
    }
    if (isLine(parent)) {
      const index = parent.kids.findIndex(k => leaves(k).includes(tile));
      if (parent.key) return { kind: "in", key: parent.key, index, weight: parent.weights?.[index] };
      const sibling = parent.kids[index + 1] ?? parent.kids[index - 1];
      if (sibling) return { kind: "split", target: leaves(sibling)[0]!, dir: parent.dir === "row" ? (parent.kids[index + 1] ? "left" : "right") : (parent.kids[index + 1] ? "up" : "down"), weight: parent.weights?.[index] };
    }
    if (parent.t === "dock") return { kind: "edge", dir: parent.edge };
  }
  return { kind: "edge", dir: "right" };
}
export function mapPlace<I, J>(at: At<I>, map: (id: I) => J): At<J> {
  switch (at.kind) {
    case "split": case "tabs": return { ...at, target: map(at.target) };
    case "next": return { ...at, from: map(at.from) };
    case "float": return { ...at, near: at.near === undefined ? undefined : map(at.near) };
    default: return at;
  }
}
