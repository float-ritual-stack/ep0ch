// The showcase's "who can reach what" (PIE-1034): made-up outlines with grants on the showcase's private host, a cap file
// and a few usage records for made-up callers. Nothing real: the cap file lives in the door's own state folder and the
// section's tile reads and writes only that.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { hostRequest, SocketBoard } from "../../socket";
import { recordUsage } from "../../mcp-usage";
import { stateDir } from "../../state";

/** The outlines the demo adds beside the showcase's own, each with the grant its owner set. */
export const ACCESS_OUTLINES: readonly { name: string; level: McpAccessLevel }[] = [
  { name: "showcase", level: "propose" }, { name: "garden", level: "full" }, { name: "rotfield", level: "full" }, { name: "gurgle", level: "read" }, { name: "vault", level: "none" },
];
/** The made-up callers' caps: garden-bot is a named path capped at propose, but may do more in gurgle's own. */
export const ACCESS_CAPS = "garden-bot=propose,garden-bot@gurgle=full,seed-sorter=read";

/** Make the outlines and set their grants (the seed's, through the host). */
export async function seedAccess(board: SocketBoard): Promise<void> {
  for (const { name, level } of ACCESS_OUTLINES) {
    try { await hostRequest(board.path, "outlines.create", { name }); } catch { /* it exists already */ }
    const b = new SocketBoard(board.path, undefined, name);
    try { await b.configureMcpAccess(level); } finally { b.close(); }
  }
}

/** Where the section's caps live: its own folder in the door's state, never `~/.config`. */
export const accessDemoEnv = (): Record<string, string> => ({ XDG_CONFIG_HOME: join(stateDir(), "showcase-access") });

/** The cap file and the usage records, once (the section's first visit); later visits keep what the person changed. */
export function seedAccessFiles(now = Date.now()): Record<string, string> {
  const env = accessDemoEnv(), dir = join(env.XDG_CONFIG_HOME!, "ep0ch"), file = join(dir, "mcp.env");
  if (existsSync(file)) return env;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, `EP0CH_MCP_PATH_ACCESS=${ACCESS_CAPS}\n`, { mode: 0o600 });
  const row = (actor: string, outline: string, hoursAgo: number, tool = "outline_read") => recordUsage({
    time: new Date(now - hoursAgo * 3_600_000).toISOString(), actor, tool, outline, shape: {},
    requestBytes: 120, responseBytes: 900, requestTokens: 30, responseTokens: 225, durationMs: 40,
  });
  for (const h of [1, 3, 20, 30]) row("mcp:garden-bot/claude.ai", "garden", h);
  row("mcp:garden-bot/claude.ai", "rotfield", 52, "outline_patch");
  row("mcp:claude-code@float-2", "showcase", 0.5);
  row("mcp:claude-code@float-2", "garden", 70);
  row("mcp:kitty-batch/claude-code@float-2", "garden", 6, "outline_comment");
  return env;
}
