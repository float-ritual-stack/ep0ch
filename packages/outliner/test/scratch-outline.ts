import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";

// A temp folder short enough for the sockets a test makes under it, whatever TMPDIR is (agent-env's is long): one rule
// for the door's tests and these (PIE-1654).
export { scratchDir } from "../../../scripts/scratch-dir";

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
