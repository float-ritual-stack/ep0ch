// What a node that dials in may write here at `propose` (PIE-562). Its call does this outline's EchoNet toss for it
// (extensions/echonet/echonet.ts, `callIn`), so it writes what that toss would: the copies under this outline's
// subscriptions that name it, the ledger, a call log under the nodelist. `full` would open the whole outline (and the
// MCP gateway with it), so instead the access check lets EchoNet's relayed writes through when they stay in that scope:
//
//   create   under a subscription that names the node (its source board, its copies, an undeliverable note), or a
//            `[type::toss] [node::<it>]` log under the nodelist
//   update   a block under such a subscription, the subscription itself when only its `since` changes, or the ledger
//   draft.patch  a block under such a subscription (a newer version proposed beside a copy)
//
// Marks (netmail, seen-by) need only `propose` already. Nothing else is written; a named list (`@page`) doesn't count.
import { glob, parseMask, prop, type Block as ShapeBlock, values } from "../extensions/echonet/shapes";
import { replacePropertyTokens } from "@ep0ch/outline-core/property-grammar";
import type { Block } from "./types";

const asShape = (block: Block) => block as unknown as ShapeBlock;

/** Whether a subscription's masks name `node` (`<outline>@<machine>`): an exact name or a mask that matches it. */
export function subscriptionNames(sub: Block, node: string): boolean {
  const [outline, machine] = node.split("@") as [string, string];
  return values(asShape(sub), "subscribe").map(parseMask).some((mask) => mask?.kind === "node" && glob(mask.outline).test(outline) && glob(mask.machine).test(machine));
}

const isSubscription = (block: Block) => prop(asShape(block), "subscribe") !== undefined && prop(asShape(block), "from") === undefined;
const withoutSince = (text: string) => replacePropertyTokens(text, (token) => (token.key.toLowerCase() === "since" ? "" : token.raw)).replace(/\s+$/gm, "");

/**
 * Whether a relayed EchoNet write from `node` stays in the scope its call needs (above). `get` reads a block here.
 */
export function echonetCallMayWrite(action: string, request: Record<string, unknown>, node: string, get: (id: string) => Block | undefined): boolean {
  /** The subscription naming the node that `id` is, or is under (the block itself counts when `self`). */
  const underSubscription = (id: unknown, self: boolean): Block | undefined => {
    let at = typeof id === "string" ? get(id) : undefined;
    for (let depth = 0; at && depth < 64; depth += 1) {
      if ((self || depth > 0) && isSubscription(at)) return subscriptionNames(at, node) ? at : undefined;
      at = at.parentId ? get(at.parentId) : undefined;
    }
    return undefined;
  };
  if (action === "create") {
    if (underSubscription(request.parentId, true)) return true;
    const parent = typeof request.parentId === "string" ? get(request.parentId) : undefined;
    const head = typeof request.text === "string" ? request.text.split("\n", 1)[0]! : "";
    return !!parent && prop(asShape(parent), "type") === "nodelist" && head.includes("[type::toss]") && head.includes(`[node::${node}]`);
  }
  if (action === "update" || action === "draft.patch") {
    const block = typeof request.blockId === "string" ? get(request.blockId) : undefined;
    if (!block) return false;
    if (action === "update" && prop(asShape(block), "type") === "echo-ledger") return true;
    if (underSubscription(block.id, false)) return true;
    // The subscription itself: its `since`, written on its first toss, and nothing else.
    return action === "update" && isSubscription(block) && subscriptionNames(block, node) && typeof request.text === "string" && withoutSince(request.text) === withoutSince(block.text);
  }
  return false;
}
