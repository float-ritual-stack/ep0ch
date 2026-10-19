import { isRunbook, runbookSteps, type RunbookNode } from "@ep0ch/outline-core/runbook";
import type { OutlinerStore } from "./store";
import type { Block } from "./types";

export function runbookPlan(store: OutlinerStore, block: Block) {
  const root = [block, ...store.blockContext(block.id).ancestors.reverse()].find(b => isRunbook(b.text));
  if (!root) return undefined;
  const tree = (b: Block): RunbookNode => ({ id: b.id, text: b.text, children: store.children(b.id).map(tree) });
  return { steps: runbookSteps(tree(root)), records: store.children(root.id).filter(b => b.properties.some(p => p.key === "type" && p.value === "run")) };
}
