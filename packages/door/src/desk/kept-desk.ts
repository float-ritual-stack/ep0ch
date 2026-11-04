// The desk kept alive with its programs, to come back to (the menu's D, `Desk.resume`): one for the process.
import type { Desk } from "./desk";

export const kept: { desk: Desk | null } = { desk: null };

type Holder = { panes: Map<unknown, { kill?(): void; inner?: Holder | null }>; holdsPrograms(): boolean };
/** A desk and the desks in its groups: a terminal in a group would go on to the drawer as the desk goes. */
const withGroups = (d: Holder): Holder[] => [d, ...[...d.panes.values()].flatMap(p => (p.inner ? withGroups(p.inner) : []))];

// The test run's teardown between files, when there is one (test/preload.ts): the kept desk is that file's, not the next
// one's (PIE-1562). Its programs end, then it does; what won't end is said, and the run fails. Nothing outside tests sets it.
(globalThis as { [k: symbol]: Set<() => Promise<string | void>> | undefined })[Symbol.for("ep0ch.test.putBack")]?.add(async () => {
  const d = kept.desk;
  if (!d) return;
  kept.desk = null;
  const desks = withGroups(d as unknown as Holder);
  for (const h of desks) for (const p of h.panes.values()) p.kill?.();
  const end = Date.now() + 3000;
  while (desks.some(h => h.holdsPrograms()) && Date.now() < end) await Bun.sleep(20);
  if (desks.some(h => h.holdsPrograms())) return "a kept desk's program that won't end";
  d.dispose();
});
