// A refusal of the layout's, as data: what an operation throws when a rule says no, and the ways out the rules name.
// The layout's rules (desk/screen-layout.ts, desk/landing.ts) answer why not and each way out as an act (outline-core's
// way-out.ts: an action, its arguments, what it does), never a sentence with a key or an action in it: a key is the
// door's own, read from its key tables when the refusal is said (surface/way-out.ts, which the asker hands the layout
// as `Ctx.says`). The ways several rules share are made here once.
import { way, whyNot, withWays, type Way, type Why } from "@ep0ch/outline-core/way-out";
export { way, whyNot, type Way, type Why } from "@ep0ch/outline-core/way-out";

/** A layout as the person reads about it: `name` in a sentence ("your drawer is locked"), `chip` on its ▣ chip ("▣ drawer locked"); a group has none. */
export interface LayoutSelf {
  name: string; chip?: string;
  /** Its chip is drawn, but something lies over it now (PIE-1455): the drawer open over the hint row, or a drawer tile lifted over the screen. */
  covered?: "drawer" | "lift";
}
export const SCREEN_SELF: LayoutSelf = { name: "the screen", chip: "screen" };
/** A locked layout's ▣ chip, padded as a chip is drawn (the hint row's, the drawer frame's): what its refusals tell the person to click. */
export const lockChipText = (self: LayoutSelf): string => ` ▣ ${self.chip ?? self.name} locked `;


// ── the ways out, each an act: a door words it by its own key or as an act line (surface/way-out.ts) ──

/** How a locked layout is unlocked, the way out of every refusal it causes (the lock is rare, PIE-1346). */
export const unlockWays = (self: LayoutSelf = SCREEN_SELF): Way[] => {
  const chip = lockChipText(self).trim();
  const unlock = (more: Omit<Way, "act" | "does" | "args"> = {}) => way("layout.lock", "unlocks it", { args: { on: false }, ...more });
  // A refusal names a control the person can see (PIE-1455): one under the drawer or a lifted tile is reached past it.
  if (self.chip && self.covered === "drawer") return [way("host.toggle", "puts the drawer away", { args: { open: false } }), unlock({ at: `with the keys in ${self.name}`, on: chip, then: true })];
  if (self.chip && self.covered === "lift") return [way("agent.lift", "drops the lifted tile", { args: { on: false } }), unlock({ at: `with the keys in ${self.name}`, on: chip, then: true })];
  return [self.chip ? unlock({ on: chip }) : unlock({ at: "in it" })];
};
/** A policy's layer as `layout.policy` names it: the screen, or a container by its id. A kind's own default is no node. */
export const nodeOf = (by: string | undefined): { node?: string } => (by !== undefined && (by === "screen" || /^[sgdcf]\d+$/.test(by)) ? { node: by } : {});
/**
 * The container a way's act names by its id, when it is one (never the screen: every tile is in it). An act line says
 * the place in its arguments; a key means its act only where the person's keys are, so the door's sayer reads this to
 * know a key alone may lead nowhere.
 */
export const containerNamed = (w: Way): string | undefined => { const node = w.args?.node; return typeof node === "string" && node !== "screen" ? nodeOf(node).node : undefined; };
/** The way out of a policy that says no: its flag turned on at the layer that says it (the policy panel's row, for the person with their keys there). */
export const turnsOn = (flag: string, by: string | undefined): Way => way("layout.policy", `turns ${flag} on`, { args: { ...nodeOf(by), [flag]: true }, at: "there" });
/** Why an open landed somewhere other than where it was aimed, and what undoes that, each an act (a pinned reader's pin let go). */
export interface LandedWhy { why?: string; ways?: Way[] }
/** An open aimed at pinned reader `name` landed `where` ("beside it", "in spare"): why, and its pin let go as the way back (the reader's own key, with the keys in it). */
export const pinnedWhy = (name: string, where: string): Required<LandedWhy> => ({ why: `${name} is pinned: opened ${where}`, ways: [way("reader.pin", "unpins it", { args: { on: false }, tile: name, at: `in ${name}` })] });
/** Why an open landed elsewhere, as the asker's door says it (the reason, then what undoes it): told through `tell` and answered. Undefined: it landed where it was aimed. */
export const landedSaid = (ctx: { says?(why: Why): string }, plan: LandedWhy, tell: (said: string) => void): string | undefined => {
  if (plan.why === undefined) return undefined;
  const said = saidBy(ctx, { reason: plan.why, ways: plan.ways ?? [] });
  tell(said);
  return said;
};
/** The read that names every container: what a refusal about an id nothing has points at. */
export const ids = (does: string): Way => way("layout.get", does);

/** A refusal inside an operation: caught by `apply`, which answers it with nothing changed. */
export class Refused extends Error { constructor(readonly why: Why) { super(why.reason); } }
/** Refuse with a reason and its ways out (a refusal already made takes more ways after its own); nothing for null. */
export const refuse = (why: string | Why | null | undefined, ...ways: Way[]): void => { if (why) throw new Refused(typeof why === "string" ? whyNot(why, ...ways) : withWays(why, ...ways)); };
/** A refusal as the asker's door says it: by `ctx.says`, else its reason alone. */
export const saidBy = (ctx: { says?(why: Why): string }, why: Why): string => ctx.says?.(why) ?? why.reason;
