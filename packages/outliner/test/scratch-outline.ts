import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "../../outline-core/src/outline-location";

/**
 * A scratch outline as every client resolves it (PIE-530): the outlines folder `<root>/outlines`, the outline
 * `name`, and the folder the client acts for. Only the host's private `.host/` is made, so a test's own
 * OutlinerServer can listen where a client looks for the host. Never a real outline.
 */
export function scratchOutline(root: string, options: { name?: string; folder?: string } = {}) {
  const name = options.name ?? "scratch";
  const outlines = join(root, "outlines");
  const layout = outlineLayout(outlines);
  mkdirSync(layout.hostDir, { recursive: true, mode: 0o700 });
  const workspaceRoot = options.folder ?? root;
  const env = { EP0CH_OUTLINES: outlines, EP0CH_WS: name, OUTLINER_WORKSPACE_ROOT: workspaceRoot };
  return { env, name, outlines, socket: layout.socket, database: layout.database(name), stateDir: layout.folder(name), workspaceRoot };
}
