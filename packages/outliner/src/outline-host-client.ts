import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { OutlinerClient } from "./client";
import { clientSocket, type OutlinerClientPaths, resolveClientPaths } from "./paths";
import { socketAbsent } from "./socket-probe";
import type { ImportReport } from "./outline-import";
import type { HostedOutlineAttachment, HostedOutlineList, HostedOutlineSummary, HostedPaneOutline } from "./types";

/**
 * A client for the outline host's own requests (`outlines.*`): this machine's host, or EP0CH_SOCKET's when set;
 * undefined when none answers there. It names no outline.
 */
export async function outlineHostClient(env: NodeJS.ProcessEnv = process.env, timeoutMs = 3_000): Promise<OutlinerClient | undefined> {
  const { socket } = clientSocket(env);
  if (await socketAbsent(socket, 500)) return undefined;
  return new OutlinerClient(socket, timeoutMs);
}

/**
 * The host client once the host answers, waiting up to `waitMs` like a remote client waits for its tunnel: a host
 * that is restarting comes back. Undefined when it never answers.
 */
export async function waitForOutlineHost(env: NodeJS.ProcessEnv = process.env, waitMs = 60_000): Promise<OutlinerClient | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const host = await outlineHostClient(env);
    if (host || Date.now() >= deadline) return host;
    await sleep(250);
  }
}

export function listHostedOutlines(host: OutlinerClient): Promise<HostedOutlineList> {
  return host.request<HostedOutlineList>({ action: "outlines.list" });
}

/** Opens a session's outline on the host; `create` makes it first when missing (session openers only). */
export function attachHostedOutline(host: OutlinerClient, name: string, create: boolean): Promise<HostedOutlineAttachment> {
  return host.request<HostedOutlineAttachment>({ action: "outlines.attach", name, create });
}

/** A new outline named `name`; refused when the name is taken. */
export function createHostedOutline(host: OutlinerClient, name: string): Promise<HostedOutlineSummary> {
  return host.request<HostedOutlineSummary>({ action: "outlines.create", name });
}

/** A new outline named `name` from an older database at `path` (read, never moved or changed). */
export function importHostedOutline(host: OutlinerClient, path: string, name: string): Promise<HostedOutlineSummary & { imported: ImportReport }> {
  return host.request({ action: "outlines.import", path, name }, 600_000);
}

/** The outline a live pane on this machine is registered on, per the host; undefined when none is. */
export async function registeredPaneOutline(host: OutlinerClient, paneId: string): Promise<string | undefined> {
  return (await host.request<HostedPaneOutline>({ action: "outlines.pane", paneId, hostname: hostname() })).outline;
}

/**
 * Where a Herdr action invoked from `paneId` connects: the outline that pane is registered on, when it is an
 * outliner pane (outlineSource `pane`), else the usual resolution of `env`. So an action from a pane on `fred`
 * stays on `fred` after its folder's `.ep0ch` changed, and a Detail opened by name works in a folder that names
 * none. EP0CH_WS still wins.
 */
export async function resolveInvocationPaths(env: NodeJS.ProcessEnv, paneId: string | undefined, waitMs = 60_000): Promise<OutlinerClientPaths> {
  if (paneId && !env.EP0CH_WS?.trim()) {
    const host = await waitForOutlineHost(env, waitMs);
    const outline = host ? await registeredPaneOutline(host, paneId).catch(() => undefined) : undefined;
    if (outline) return { ...resolveClientPaths({ ...env, EP0CH_WS: outline }), outlineSource: "pane" };
  }
  return resolveClientPaths(env);
}
