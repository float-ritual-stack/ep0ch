// A tailnet page's "inside" list (PIE-775, PIE-1333): a note's children, folded the way the door and outline_query's
// `fold` fold them. What people wrote is listed; what exists only because of the note (a proposal, a delivery:
// outline-core's derived.ts) folds into its changes, one line each, its page (the diff) a click away; what tools write
// for their own bookkeeping ([machine::…]) folds below the rest. No property of a change is printed, so a proposal's
// `[draft-patch::…]` never is. The publisher owns the rows' links and titles; this file owns the folding.
import { changesSummary, countChanges, derivedKindOf } from "@ep0ch/outline-core/derived";
import { isMachinery } from "@ep0ch/outline-core/machinery";
import { proposalLine } from "./draft-patch";
import { getProperty } from "./properties";
import { timeHtml } from "./publish-time";
import type { Block } from "./types";

/** A folder page lists at most this many children. */
export const MAX_LISTED_CHILDREN = 500;

/** What a child is when it only exists because of its note: a proposal, a comment, a delivery. */
const derivedOf = (block: Pick<Block, "properties">) => derivedKindOf(getProperty(block.properties, "type"));

export interface InsideParts {
  /** What people wrote, and the part of it listed. */
  children: Block[]; people: Block[];
  /** The note's changes, and the part listed. */
  derived: Block[]; changed: Block[];
  /** What tools wrote, and the part listed. */
  machinery: Block[]; byTools: Block[];
}

/** A note's children (views already taken out), split three ways, with the list's room going to people first. */
export function insideParts(blocks: readonly Block[]): InsideParts {
  const derived = blocks.filter((block) => derivedOf(block));
  const children = blocks.filter((block) => !derivedOf(block) && !isMachinery(block.properties));
  const machinery = blocks.filter((block) => !derivedOf(block) && isMachinery(block.properties));
  const people = children.slice(0, MAX_LISTED_CHILDREN);
  const changed = derived.slice(0, Math.max(0, MAX_LISTED_CHILDREN - people.length));
  const byTools = machinery.slice(0, Math.max(0, MAX_LISTED_CHILDREN - people.length - changed.length));
  return { children, people, derived, changed, machinery, byTools };
}

/** How the publisher draws a row: a note's folder row, and a change's link and title. */
export interface InsideRows {
  row: (block: Block) => string;
  href: (block: Block) => string;
  title: (block: Block) => string;
}

/** The section, or "" when the note has no children. */
export function insideHtml(parts: InsideParts, rows: InsideRows): string {
  const { children, people, derived, changed, machinery, byTools } = parts;
  if (!children.length && !derived.length && !machinery.length) return "";
  const list = (blocks: readonly Block[], row: (block: Block) => string) => blocks.length ? `<ul class="kids">\n${blocks.map(row).join("\n")}\n</ul>\n` : "";
  const moreOf = (n: number) => n > 0 ? `<p class="dim">and ${n} more (open it in the door to see them all)</p>\n` : "";
  const counted = countChanges(derived.map(derivedOf));
  const changes = derived.length
    ? `<details class="changes"><summary>${escapeHtml(changesSummary(counted))}</summary>\n${list(changed, (block) => changeRow(block, rows))}${moreOf(derived.length - changed.length)}</details>\n`
    : "";
  const tools = machinery.length
    ? `<details class="machinery"><summary>${machinery.length} written by tools <span class="dim">(snapshots, records, logs)</span></summary>\n${list(byTools, rows.row)}${moreOf(machinery.length - byTools.length)}</details>\n`
    : "";
  const counts = `${children.length}${derived.length ? ` · ${counted.count} ${counted.count === 1 ? "change" : "changes"}` : ""}${machinery.length ? ` · ${machinery.length} by tools` : ""}`;
  return `<section class="inside"><h2>Inside <span class="dim">${counts}</span></h2>\n${list(people, rows.row)}${moreOf(children.length - people.length)}${changes}${tools}</section>\n`;
}

/** A change as one line: a proposal says who sent how many edits and what became of them, anything else its title. */
function changeRow(block: Block, rows: InsideRows): string {
  const said = (derivedOf(block) === "proposal" ? proposalLine(block.text, block.properties) : null) ?? (rows.title(block) || "untitled");
  return `<li data-block="${escapeHtml(block.id)}"><a href="${escapeHtml(rows.href(block))}"><span class="t">${escapeHtml(said)}</span></a><span class="m">${timeHtml(block.updatedAt)}</span></li>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
