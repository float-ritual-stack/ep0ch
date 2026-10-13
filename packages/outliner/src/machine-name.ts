// This machine's name in a canonical ep0ch:// URI (ADR 0002). One rule for every client and the service: the door's
// control socket, main and MCP server, the outline service's `notes.address` (what an extension builds its
// `ep0ch://` links from, PIE-767) and EchoNet's node names. It lives here, not in outline-core, because it reads the
// host name, a file and hashes.
//
// The name is the person's choice, so the ssh name other machines reach this one by and its own name agree (a node
// with two names splits EchoNet's nodelist and seen-by): `EP0CH_MACHINE_NAME`, else `<outlines>/.host/machine-name`
// (written by `ep0ch install --apply`; its first line is the name, the lines after it the names it had before), else
// the host name as before.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { isMachineName, MACHINE_NAME_PATTERN, outlineLayout } from "@ep0ch/outline-core/outline-location";
import { resolveOutlinesFolder } from "./paths";

/** A stable URI machine name for a host name, shaped like the ssh names the URI grammar allows. */
export function hostMachineName(raw = hostname()): string {
  const cleaned = raw.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "local";
  if (MACHINE_NAME_PATTERN.test(cleaned)) return cleaned;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  const prefix = cleaned.slice(0, 23).replace(/[^A-Za-z0-9]+$/g, "") || "local";
  return `${prefix}-${hash}`;
}

/**
 * The name the person gave this machine (EP0CH_MACHINE_NAME, else the outlines folder's `.host/machine-name`), if any.
 * `outlines`: a host's own folder (it may serve one other than EP0CH_OUTLINES names).
 */
export function configuredMachineName(env: NodeJS.ProcessEnv = process.env, outlines?: string): string | undefined {
  const named = env.EP0CH_MACHINE_NAME?.trim();
  if (named) return isMachineName(named) ? named : undefined;
  return namesInFile(outlines ?? resolveOutlinesFolder(env))[0];
}

/** The machine-name file's names: the current one first, then the ones it had before; none when it isn't there. */
function namesInFile(outlines: string): string[] {
  try {
    return readFileSync(outlineLayout(outlines).machineName, "utf8").split("\n").map((line) => line.trim()).filter(isMachineName);
  } catch {
    return [];
  }
}

/**
 * This machine's name in URIs: the configured one, else its host name's. `raw` names a host outright (another
 * machine's, as its ping says it), and is only cleaned.
 */
export function canonicalLocalMachineName(raw?: string): string {
  return raw !== undefined ? hostMachineName(raw) : localMachineName();
}

/** This machine's name as the host serving `outlines` gives it (the configured one, else its host name's). */
export const localMachineName = (outlines?: string) => configuredMachineName(process.env, outlines) ?? hostMachineName();

/**
 * The other names this machine went by, once it has one: the names the file had before, and its host name's. Old URIs
 * and EchoNet marks still say them.
 */
export function localMachineAliases(outlines?: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const named = configuredMachineName(env, outlines);
  if (!named) return [];
  return [...new Set([...namesInFile(outlines ?? resolveOutlinesFolder(env)), hostMachineName()])].filter((name) => name !== named);
}

/** Whether a URI's machine is this one: its name, or a name it went by. */
export function isLocalMachine(machine: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return machine === (configuredMachineName(env) ?? hostMachineName()) || localMachineAliases(undefined, env).includes(machine);
}

/** The short host name (`evans-MacBook-Pro` of `evans-MacBook-Pro.local`), as a machine name: the default to offer. */
export const suggestedMachineName = (raw = hostname()) => hostMachineName(raw.split(".")[0] || raw);

/** Writes this machine's name (`<outlines>/.host/machine-name`), the names it had before kept under it; answers the file. */
export function writeMachineName(name: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isMachineName(name)) throw new Error(`"${name}" isn't a machine name: an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  const folder = resolveOutlinesFolder(env);
  const file = outlineLayout(folder).machineName;
  const before = namesInFile(folder).filter((old) => old !== name);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, [name, ...before].map((line) => `${line}\n`).join(""));
  renameSync(temporary, file);
  return file;
}
