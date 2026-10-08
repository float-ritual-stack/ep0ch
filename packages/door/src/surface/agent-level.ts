// What an agent may do to a tile (PIE-639): one word per tile, `free`, `edit` or `off`, the screen's default with
// exceptions. The words and the refusal live here, so the layout's rules (src/desk/screen-layout.ts) and the
// dispatcher's actor rule (src/surface/dispatch.ts) say the same thing. The person's own keys are never limited.

/**
 * `free` (the default): an agent may open notes in the tile, navigate it, split it, close it or retarget it.
 * `edit`: it may edit the note the tile shows (patch, comment, set properties), not navigate, close, retarget or move
 * the tile; its own new tiles go elsewhere. `off`: it may read the tile through `peek`, and takes no action on it or
 * its note.
 */
export type AgentLevel = "free" | "edit" | "off";
export const AGENT_LEVELS: readonly AgentLevel[] = ["free", "edit", "off"];
export const isAgentLevel = (x: unknown): x is AgentLevel => typeof x === "string" && (AGENT_LEVELS as readonly string[]).includes(x);

/** The level in the words the tile's chip and the refusals use. */
export const AGENT_WORDS: Record<AgentLevel, string> = { free: "agents: free", edit: "agents: edit only", off: "agents: hands off" };
/** The glyph on the tile's frame (nothing for `free`). */
export const AGENT_GLYPH: Record<AgentLevel, string> = { free: "", edit: "✎", off: "⊘" };
/** The next level when the person cycles it (^W g, a click on the chip). */
export const nextAgentLevel = (l: AgentLevel): AgentLevel => AGENT_LEVELS[(AGENT_LEVELS.indexOf(l) + 1) % AGENT_LEVELS.length]!;

/**
 * What an agent may do to a tile at `level`: null when it may, else why not, with the person's command to change it.
 * `what` names the refused thing in a few words ("closing it", "open"); `note`: what the level allows (an edit of the tile's note under `edit`, a read under `off`).
 */
export function agentRefusal(level: AgentLevel, tile: string, what: string, opts: { by?: string; note?: boolean; command?: string } = {}): string | null {
  if (level === "free" || opts.note) return null;
  const set = opts.by && opts.by !== "tile" ? ` (${opts.by === "screen" ? "the screen's default" : `${opts.by}'s default`})` : "";
  const says = level === "edit" ? "edit only for agents" : "hands off for agents";
  const way = level === "edit" ? "patching, commenting and setting properties on its note are allowed; its own new tiles go elsewhere" : "peek reads it";
  return `${tile} is ${says}${set}: ${what} is refused · ${way} · the person's command: ${opts.command ?? `^W g, its ⋯ menu or a click on its chip, or tile.agent policy=free tile=${tile}`}`;
}
