import { shellLines } from "@ep0ch/outline-core/shell-line";
import { anchorRunbookSteps, runnableFences, isRunbook, runbookSteps, type RunbookNode } from "@ep0ch/outline-core/runbook";
import type { OutlinerStore } from "./store";
import type { Block } from "./types";
import { answerSite } from "./site-answer";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";

const isRecord = (text: string) => parsePropertyRecords(text).some(p => p.scope === "block" && p.key === "type" && p.value === "run");

export function runbookPlan(store: OutlinerStore, block: Block) {
  const root = [block, ...store.blockContext(block.id).ancestors.reverse()].find(b => isRunbook(b.text)) ?? block;
  const tree = (b: Block): RunbookNode => ({ id: b.id, text: b.text, children: store.children(b.id).map(tree) });
  const steps = runbookSteps(tree(root));
  for (const step of steps) if (step.shell) {
    const cwd = answerSite(store, { blockId: step.block, line: step.line, paths: ["cwd"] }, Date.now).paths?.[0]?.values?.[0];
    step.cwd = resolve(store.workspaceRoot ?? homedir(), (cwd ?? "").replace(/^~(?=$|\/)/, homedir()));
  }
  return { steps, records: store.children(root.id).filter(b => b.properties.some(p => p.key === "type" && p.value === "run")) };
}

export function runbookText(store: OutlinerStore, text: string, parentId: string | null, id?: string): string {
  if (isRecord(text)) return text;
  const inline = shellLines(text);
  if (!runnableFences(text).length && !inline.length) return text;
  const ancestors = parentId ? store.blockContext(parentId) : null;
  const root = isRunbook(text) ? null : [...(ancestors?.ancestors ?? []), ...(ancestors?.selected ? [ancestors.selected] : [])].reverse().find(b => isRunbook(b.text));
  if (!isRunbook(text) && !root && !inline.length) return text;
  const used = new Set<string>();
  const collect = (block: Block) => {
    if (isRecord(block.text)) return;
    if (block.id !== id) for (const fence of runnableFences(block.text)) if (fence.anchor) used.add(fence.anchor);
    if (block.id !== id) for (const line of shellLines(block.text)) if (line.anchor) used.add(line.anchor);
    for (const child of store.children(block.id)) collect(child);
  };
  if (root) collect(root);
  else if (id && isRunbook(text)) for (const child of store.children(id)) collect(child);
  return anchorRunbookSteps(text, used);
}
