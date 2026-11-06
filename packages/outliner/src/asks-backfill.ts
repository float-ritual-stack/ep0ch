// `ep0ch review asks` (PIE-1612): the asks extension's settle over past notes, a dry run unless told to write.
/** How many notes it reads at once: Jev answers each in about a second. */
const AT_ONCE = 4;

export type Sender = { send(action: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>; address: { outline: string } };

/**
 * The asks extension's own action over the past: its rule's query says which notes (nothing here lists them again), and
 * each note goes through `settle`, so a backfill's writes and a settle's are one path, remembered the same way.
 */
export async function asksBackfill(board: Sender, o: { since: string; write: boolean; limit?: number }, io: { out(s: string): void; err(s: string): void }): Promise<number> {
  if (!/^\d+[dhw]$/.test(o.since)) { io.err(`ep0ch review asks: --since is a count of days, hours or weeks (30d, 12h, 2w), not ${o.since}`); return 2; }
  const list = await board.send("extensions.list", {}, 60_000) as { rules?: { name: string; match: { query?: string } }[] };
  const query = list.rules?.find(rule => rule.name === "asks/settle")?.match.query;
  if (!query) { io.err(`ep0ch review asks: ${board.address.outline} has no asks extension: ep0ch ext add asks --outline-folder <that outline's folder>`); return 1; }
  const found = await board.send("blocks.query", { query: { where: `(${query}) AND updated >= -${o.since}`, sort: "updated desc", limit: 1000 } }, 60_000) as { blocks: { id: string; author?: string; actorId?: string; text: string }[] };
  // A note you alone wrote isn't marked, as the rule hears only agents.
  const notes = found.blocks.filter(b => b.author === "agent" && b.actorId && !/^(?:ext:|jev\/)/.test(b.actorId)).slice(0, o.limit ?? 1000);
  if (found.blocks.length >= 1000) io.out(`The window holds more than 1000 notes: the newest were read; narrow --since for the rest.`);
  let marked = 0, failed = 0;
  for (let i = 0; i < notes.length; i += AT_ONCE) {
    await Promise.all(notes.slice(i, i + AT_ONCE).map(async note => {
      try {
        const answer = await board.send("extensions.act", { extension: "asks", extensionAction: "settle", blockId: note.id, args: o.write ? {} : { dry: "yes" }, mutation: { author: "agent", actorId: "review-asks" } }, 120_000) as { message?: string };
        if (!/^(?:would write|wrote|proposed)/.test(answer.message ?? "")) return;
        marked++;
        io.out(`${note.id}  ${note.text.split("\n")[0]!.slice(0, 60)}\n${answer.message!.split("\n").map(l => `  ${l}`).join("\n")}`);
      } catch (e) { failed++; io.err(`${note.id}: ${(e as Error).message}`); }
    }));
  }
  io.out(`${notes.length} notes read, ${marked} ${o.write ? "written" : "would be written"}${failed ? `, ${failed} failed` : ""}${o.write ? "" : ". Dry run: nothing was written; --write writes it."}`);
  return failed ? 1 : 0;
}
