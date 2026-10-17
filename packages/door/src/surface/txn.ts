// The dispatcher-reserved arguments (PIE-957, S7; design §4.8–4.9), open to every actor beside `tile=` and `expected=`:
//   txn=<id>      joins a transaction: every layout change the action makes joins one history entry the desk keeps, which
//                 closes at the run's end (a script gets it from its run id), on `layout.txn.end txn=<id>`, or after a minute.
//   motion=<style>  a presentation hint (S8 draws it, capped by the person's setting); recorded with the transaction.
// They are not an action's own arguments, so the dispatcher takes them out of the request before any set sees it, and
// carries them to the code that changes the layout in an AsyncLocalStorage, whatever the action awaits.
import { AsyncLocalStorage } from "node:async_hooks";
import { ActionRefused } from "./actions";

export interface TxnScope { txn: string; motion?: string }

/** The transaction the running action belongs to, if it named one. */
export const TXN = new AsyncLocalStorage<TxnScope>();

/** The names no action may use for its own arguments. */
export const RESERVED_ARGS = ["txn", "motion"] as const;

const TXN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MOTION = /^[a-z][a-z-]{0,23}$/;

/** Take `txn` and `motion` out of `args` (checked); the scope they make, or undefined when neither was given. */
export function takeReserved(args: Record<string, unknown>): TxnScope | undefined {
  const txn = args.txn, motion = args.motion;
  delete args.txn;
  delete args.motion;
  if (txn === undefined && motion === undefined) return undefined;
  if (txn === undefined) throw new ActionRefused("motion= is part of a transaction: say which one with txn=<id>");
  if (typeof txn !== "string" || !TXN_ID.test(txn)) throw new ActionRefused(`txn= is an id of letters, digits and . _ : - (up to 64), not ${JSON.stringify(txn)}`);
  if (motion !== undefined && (typeof motion !== "string" || !MOTION.test(motion))) throw new ActionRefused(`motion= is a style's name such as fantasia or settle, not ${JSON.stringify(motion)}`);
  return { txn, ...(motion !== undefined ? { motion: motion as string } : {}) };
}
