// `ep0ch review asks` (PIE-1612): the asks extension's settle over past notes, a dry run unless told to write. Only the
// sure lines (PIE-1620): the maybe lane is for what was just written, and a month of old maybes is noise to read.
/** How many notes it reads at once: Jev answers each in about a second. */
const AT_ONCE = 4;
/** How `settle`'s answer starts a line the model turned down. */
const TURNED_DOWN = "turned down: ";
/** How many notes one read of the window asks for: the most a query answers. */
const PAGE = 1000;

export type Sender = { send(action: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>; address: { outline: string } };

/**
 * The asks extension's own action over the past: its rule's query says which notes (nothing here lists them again), and
 * each note goes through `settle`, so a backfill's writes and a settle's are one path, remembered the same way.
 */
export async function asksBackfill(board: Sender, o: { since: string; write: boolean; limit?: number; pageSize?: number }, io: { out(s: string): void; err(s: string): void }): Promise<number> {
  if (!/^\d+[dhw]$/.test(o.since)) { io.err(`ep0ch review asks: --since is a count of days, hours or weeks (30d, 12h, 2w), not ${o.since}`); return 2; }
  const list = await board.send("extensions.list", {}, 60_000) as { rules?: { name: string; match: { query?: string } }[] };
  const query = list.rules?.find(rule => rule.name === "asks/settle")?.match.query;
  if (!query) { io.err(`ep0ch review asks: ${board.address.outline} has no asks extension: ep0ch ext add asks --outline-folder <that outline's folder>`); return 1; }
  // The whole window is listed before anything is read, oldest note first: a note saved meanwhile keeps its place, and a
  // new one lands after the last page, so no page shifts. Read newest save first, as a run cut short would want.
  type Note = { id: string; author?: string; actorId?: string; updatedAt: string; text: string };
  const found: Note[] = [];
  for (let offset: number | undefined = 0; offset !== undefined;) {
    const page = await board.send("blocks.query", { query: { where: `(${query}) AND updated >= -${o.since}`, sort: "created", limit: o.pageSize ?? PAGE, ...(offset ? { offset } : {}) } }, 60_000) as { blocks: Note[]; nextOffset?: number };
    found.push(...page.blocks);
    offset = page.nextOffset;
  }
  // A note you alone wrote isn't marked, as the rule hears only agents.
  const notes = found.filter(b => b.author === "agent" && b.actorId && !/^(?:ext:|jev\/)/.test(b.actorId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, o.limit ?? Infinity);
  let marked = 0, failed = 0, read = 0, stopped = false;
  const struck: string[] = [];
  /** Each failure's words, with the notes that failed them: a failure every note shares (the model's command) is said once. */
  const failures = new Map<string, string[]>();
  for (let i = 0; i < notes.length && !stopped; i += AT_ONCE) {
    const batch = notes.slice(i, i + AT_ONCE);
    read += batch.length;
    const before = new Map([...failures].map(([why, ids]) => [why, ids.length]));
    await Promise.all(batch.map(async note => {
      try {
        const answer = await board.send("extensions.act", { extension: "asks", extensionAction: "settle", blockId: note.id, args: { sure: "yes", ...(o.write ? {} : { dry: "yes" }) }, mutation: { author: "agent", actorId: "review-asks" } }, 300_000) as { message?: string; answer?: string };
        const title = `${note.id}  ${note.text.split("\n")[0]!.slice(0, 60)}`;
        const said = (answer.answer ?? answer.message ?? "").split("\n");
        const down = said.filter(l => l.startsWith(TURNED_DOWN));
        if (down.length) struck.push(title, ...down.map(l => `  ${l.slice(TURNED_DOWN.length)}`));
        if (!/^(?:would write|wrote|proposed)/.test(answer.message ?? "")) return;
        marked++;
        io.out(`${title}\n${said.filter(l => !l.startsWith(TURNED_DOWN)).map(l => `  ${l}`).join("\n")}`);
      } catch (e) { failed++; const why = (e as Error).message; failures.set(why, [...(failures.get(why) ?? []), note.id]); }
    }));
    for (const [why, ids] of failures) {
      const fresh = ids.slice(before.get(why) ?? 0);
      if (fresh.length) io.err(`${fresh.join(", ")}: ${why}`);
    }
    // The same failure twice is the run's, not a note's (PIE-1715: every note failed on one model command): stop, said once.
    stopped = [...failures.values()].some(ids => ids.length > 1);
  }
  if (struck.length) io.out(`Turned down by the model, not written:\n${struck.join("\n")}`);
  const rest = notes.length - read;
  io.out(`${read} notes read, ${marked} ${o.write ? "written" : "would be written"}${failed ? `, ${failed} failed` : ""}${stopped && rest ? `; stopped, ${rest} not read: the notes failed the same way, so fix that and run it again` : stopped ? "; they failed the same way, so fix that and run it again" : ""}${o.write ? "" : ". Dry run: nothing was written; --write writes it."}`);
  return failed ? 1 : 0;
}
