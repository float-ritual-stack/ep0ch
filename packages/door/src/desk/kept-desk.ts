// The desk kept alive with its programs, to come back to (the menu's D, `Desk.resume`): one for the process.
interface KeptDesk { panes: ReadonlyMap<unknown, { kill?(): void }>; holdsPrograms(): boolean; dispose(): unknown }

export const kept: { desk: (KeptDesk & object) | null } = { desk: null };

// The test run's teardown between files, when there is one (test/preload.ts): the kept desk is that file's, not the next
// one's (PIE-1562). Its programs end, then it does. Nothing outside tests sets it.
(globalThis as { [k: symbol]: Set<() => Promise<void>> | undefined })[Symbol.for("ep0ch.test.putBack")]?.add(async () => {
  const d = kept.desk;
  if (!d) return;
  for (const p of d.panes.values()) p.kill?.();
  const end = Date.now() + 3000;
  while (d.holdsPrograms() && Date.now() < end) await Bun.sleep(20);
  kept.desk = null;
  d.dispose();
  kept.desk = null;
});
