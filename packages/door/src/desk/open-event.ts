import type { DoorOpen } from "@ep0ch/outline-core/door-open";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "../socket";
import type { Ctx } from "../app";
import type { TrailPlace } from "../trail";
import { probe } from "../surface/probe";
import { messageContext } from "../status-log";

/** Carries the original cause across a wire to another desk. */
export const openCause = new AsyncLocalStorage<{ source?: DoorOpen["source"]; method: DoorOpen["method"] }>();
export function openMethod(ctx: Ctx, actor: Actor, preview = false): DoorOpen["method"] {
  const action = messageContext.getStore()?.action ?? "";
  if (ctx.board.inScriptRun) return "script";
  if (action === "back" || action === "forward") return action;
  if (/hover/.test(action)) return "hover";
  if (preview) return "select";
  if (/search|bar\.open|bar\.choose/.test(action)) return "search";
  if (/^list\.(open|enter)$/.test(action)) return "open";
  if (/link|element\.open|page\.follow/.test(action)) return "link";
  return actor.kind === "agent" ? "agent" : "action";
}

export function opening(ctx: Ctx, actor: Actor, tile: string | undefined, note?: string, preview = false, verb?: DoorOpen["method"], place?: TrailPlace) {
  if (tile && place && ctx.trail) ctx.trail.places[tile] ??= place;
  const prior = tile ? ctx.lastOpen?.(tile) ?? ctx.trail?.current(tile)?.open : undefined;
  const inherited = openCause.getStore();
  return { source: inherited?.source ?? (tile ? { tile, note: prior?.target.note ?? note, visit: prior?.target.visit } : undefined),
    method: ctx.board.inScriptRun ? "script" : verb ?? (preview ? openMethod(ctx, actor, true) : inherited?.method ?? openMethod(ctx, actor)) };
}
/** Called only by placement after it has landed, including a select-wire delivery. */
export function landed(ctx: Ctx, actor: Actor, cause: ReturnType<typeof opening>, tile: string, note: string, title: string, place: TrailPlace, address?: DoorOpen["target"]["address"]): DoorOpen {
  const event: DoorOpen = { kind: "door.open", type: "door.open", at: Date.now(), actor, target: { tile, note, ...(address ? { address } : {}), visit: crypto.randomUUID() }, ...cause };
  ctx.trail?.locate(tile, place, note, title);
  ctx.opened?.(event);
  messageContext.run({ ...messageContext.getStore(), tile }, () => probe("open.land"));
  return event;
}
