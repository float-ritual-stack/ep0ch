// Which machine keeps the artifacts, and asking another machine for a file (PIE-1644). The web client serves artifacts
// from one store, on the machine whose artifact host it frames (float-2's, at artifacts.ep0ch.sh): an outline on any
// other machine keeps its artifacts there too, so a name means the same in every outline and every page can run it.
//
// The machine is named once per outlines folder, `<outlines>/.host/artifact-machine` (its first line, an ssh name), or
// `EP0CH_ARTIFACT_MACHINE`; with neither, or naming this machine, the store is this machine's own, as before.
//
// Both ask over the shared forward (`<outlines>/.remote/<machine>.sock`: the link, else ssh; outline-core's
// ensureForward), as a plain client with no outline: a host answers `artifacts.*` and `media.read` for its machine.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMachineName, outlineLayout } from "@ep0ch/outline-core/outline-location";
import type { MediaRead } from "@ep0ch/outline-core/media-copy";
import { OutlinerClient } from "./client";
import { hostAnswers, forwardFor } from "./machine-forward";
import { localMachineName } from "./machine-name";

/** The file naming the artifact machine, in an outlines folder. */
export const artifactMachineFile = (outlines: string) => join(outlineLayout(outlines).hostDir, "artifact-machine");

/** The machine whose store keeps this folder's artifacts when it isn't this one; null when it's this machine's own. */
export function artifactMachine(outlines: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let named = env.EP0CH_ARTIFACT_MACHINE?.trim();
  if (!named) { try { named = readFileSync(artifactMachineFile(outlines), "utf8").split("\n")[0]!.trim(); } catch { /* none named */ } }
  if (!named || !isMachineName(named) || named === localMachineName(outlines)) return null;
  return named;
}

/** How long an artifact asked of the store's machine may take: a first import compiles. */
const ASK_MS = 120_000;

/** `request` answered by `machine`'s host, through its forward (started when nobody has). */
export async function askMachine<T>(outlines: string, machine: string, request: Record<string, unknown>, timeoutMs = ASK_MS): Promise<T> {
  const { socket } = await forwardFor(machine, outlines);
  const { id: _id, outline: _outline, ...rest } = request;
  return new OutlinerClient(socket, timeoutMs).request<T>(rest as never, timeoutMs);
}

/**
 * The machines this folder can ask for a file, in order: `first` (the artifact machine), then every other machine whose
 * forward answers now. Never one that would need a new connection, except `first`: asking every machine ever seen would
 * wait on the asleep ones.
 */
export async function machinesToAsk(outlines: string, first: string | null): Promise<string[]> {
  const dir = join(outlines, ".remote");
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { /* no forwards yet */ }
  const here = localMachineName(outlines);
  const named = new Set(files.filter(file => file.endsWith(".sock") && !file.endsWith(".link.sock")).map(file => file.slice(0, -5)));
  const machines = [...(first ? [first] : [])];
  for (const machine of [...named].sort()) {
    if (machine === here || machines.includes(machine) || !isMachineName(machine)) continue;
    if (await hostAnswers(join(dir, `${machine}.sock`), 2_000)) machines.push(machine);
  }
  return machines;
}

/** What asking each machine for an absolute path found: its bytes and where, or the machines that were asked. */
export type ElsewhereRead = { found: MediaRead & { machine: string } } | { tried: { machine: string; said: string }[] };

/** The file at `path` from the first machine that has it (`media.read` with no outline: its own disk). */
export async function readElsewhere(outlines: string, path: string, first: string | null): Promise<ElsewhereRead> {
  const tried: { machine: string; said: string }[] = [];
  for (const machine of await machinesToAsk(outlines, first)) {
    try {
      const read = await askMachine<MediaRead>(outlines, machine, { action: "media.read", path }, 60_000);
      return { found: { ...read, machine } };
    } catch (error) {
      tried.push({ machine, said: error instanceof Error ? error.message : String(error) });
    }
  }
  return { tried };
}
